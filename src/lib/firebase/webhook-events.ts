import "server-only";

import crypto from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";

/**
 * Coda durevole degli eventi del webhook WhatsApp.
 *
 * Il webhook non può rispondere 500 a Meta per un errore nostro: Meta
 * ritenterebbe lo stesso payload per ore. Ma rispondere 200 e basta significa
 * perdere in silenzio un messaggio se la scrittura su Firestore fallisce.
 *
 * La via d'uscita è registrare il payload grezzo **prima** di elaborarlo:
 * quella è l'unica scrittura che deve riuscire perché il messaggio sia al
 * sicuro, ed è abbastanza piccola e veloce da poter essere ritentata da Meta
 * (l'unico caso in cui rispondiamo 500). Da lì in poi l'elaborazione può
 * fallire quante volte vuole: l'evento resta in coda e lo sweeper di
 * manutenzione lo riprende.
 */

const COLLECTION = "webhookEvents";

/** Per quanto teniamo i payload: allinea la TTL policy di Firestore a `expireAt`. */
const RETENTION_DAYS = 30;

/** Dopo questi tentativi falliti smettiamo di riprovare da solo. */
export const MAX_PROCESSING_ATTEMPTS = 5;

export type WebhookEventStatus =
  /** Da elaborare, o da rielaborare dopo un errore. */
  | "pending"
  /** Elaborato con successo. */
  | "done"
  /** Troppi tentativi falliti: serve un intervento. */
  | "abandoned";

export interface RecordedWebhookEvent {
  id: string;
  /** True se questo identico payload era già stato elaborato con successo. */
  alreadyProcessed: boolean;
}

export interface PendingWebhookEvent {
  id: string;
  /** Corpo grezzo della richiesta di Meta, da riparsare. */
  raw: string;
  attempts: number;
}

/**
 * Registra un evento in arrivo. L'id è l'impronta del corpo grezzo: i retry di
 * Meta ripetono lo stesso identico payload, quindi ricadono sullo stesso
 * documento invece di creare un doppione.
 */
export async function recordWebhookEvent(
  rawBody: string,
): Promise<RecordedWebhookEvent> {
  const id = crypto.createHash("sha256").update(rawBody).digest("hex");
  const ref = adminDb.collection(COLLECTION).doc(id);

  const alreadyProcessed = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    if (snap.exists) {
      if (snap.data()?.status === "done") return true;
      // Meta ha ripetuto la consegna di un evento che non eravamo riusciti a
      // elaborare: teniamo traccia e lasciamo che si riprovi.
      tx.set(
        ref,
        { status: "pending", lastDeliveryAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      return false;
    }

    tx.set(ref, {
      raw: rawBody,
      status: "pending",
      attempts: 0,
      receivedAt: FieldValue.serverTimestamp(),
      lastDeliveryAt: FieldValue.serverTimestamp(),
      expireAt: Timestamp.fromMillis(
        Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ),
    });
    return false;
  });

  return { id, alreadyProcessed };
}

export async function markWebhookEventDone(id: string): Promise<void> {
  await adminDb.collection(COLLECTION).doc(id).set(
    {
      status: "done",
      processedAt: FieldValue.serverTimestamp(),
      lastError: FieldValue.delete(),
    },
    { merge: true },
  );
}

/**
 * Registra un tentativo fallito. Oltre `MAX_PROCESSING_ATTEMPTS` l'evento passa
 * ad `abandoned`: continuare a ritentare un payload che non va giù non aiuta, e
 * lasciarlo `pending` bloccherebbe la coda dietro di sé.
 */
export async function markWebhookEventFailed(
  id: string,
  error: unknown,
): Promise<void> {
  const ref = adminDb.collection(COLLECTION).doc(id);
  const message = error instanceof Error ? error.message : String(error);

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const attempts = (snap.data()?.attempts ?? 0) + 1;

    tx.set(
      ref,
      {
        attempts,
        status: attempts >= MAX_PROCESSING_ATTEMPTS ? "abandoned" : "pending",
        lastError: message.slice(0, 500),
        lastFailedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}

/** Eventi ancora da elaborare, dal più vecchio: l'ordine di arrivo conta. */
export async function listPendingWebhookEvents(
  max: number,
): Promise<PendingWebhookEvent[]> {
  const snapshot = await adminDb
    .collection(COLLECTION)
    .where("status", "==", "pending")
    .orderBy("receivedAt", "asc")
    .limit(max)
    .get();

  return snapshot.docs.flatMap((doc) => {
    const raw = doc.data().raw;
    if (typeof raw !== "string") return [];
    return [{ id: doc.id, raw, attempts: doc.data().attempts ?? 0 }];
  });
}
