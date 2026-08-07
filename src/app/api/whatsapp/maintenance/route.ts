import crypto from "crypto";
import { NextResponse } from "next/server";
import {
  MAX_PROCESSING_ATTEMPTS,
  listPendingWebhookEvents,
  markWebhookEventDone,
  markWebhookEventFailed,
} from "@/lib/firebase/webhook-events";
import { listPendingMediaMessages } from "@/lib/firebase/firestore-admin";
import { archiveMessageMedia } from "@/lib/firebase/media-archive";
import {
  processWebhookPayload,
  type WhatsAppWebhookPayload,
} from "@/lib/whatsapp-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manutenzione periodica, pensata per Cloud Scheduler.
 *
 * Fa due cose che non possono stare nella richiesta del webhook:
 *
 * - **rielabora gli eventi rimasti in coda**, quelli il cui salvataggio era
 *   fallito. È la rete di sicurezza che permette al webhook di rispondere
 *   sempre 200 a Meta senza perdere messaggi;
 * - **archivia gli allegati** ancora solo sui server di Meta, compresi quelli
 *   troppo grandi per essere copiati dentro al webhook. Meta li cancella dopo
 *   30 giorni, quindi qui c'è una scadenza vera.
 *
 * Ogni esecuzione lavora a lotti: se resta arretrato, basta la corsa successiva.
 */

/** Quanti eventi rielaborare per esecuzione. */
const MAX_EVENTS_PER_RUN = 25;

/** Quanti allegati archiviare per esecuzione: possono pesare fino a 100 MB. */
const MAX_MEDIA_PER_RUN = 10;

const TOKEN_ENV = "WHATSAPP_MAINTENANCE_TOKEN";
const TOKEN_HEADER = "x-maintenance-token";

/**
 * L'endpoint non è protetto da Firebase Auth: chi lo chiama è uno scheduler,
 * non un operatore. Il confronto è a tempo costante per non far trapelare il
 * token un byte alla volta.
 */
function isAuthorized(request: Request, expected: string): boolean {
  const provided = request.headers.get(TOKEN_HEADER) ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface EventsReport {
  processed: number;
  failed: number;
  abandoned: number;
}

async function retryPendingEvents(): Promise<EventsReport> {
  const events = await listPendingWebhookEvents(MAX_EVENTS_PER_RUN);
  const report: EventsReport = { processed: 0, failed: 0, abandoned: 0 };

  for (const event of events) {
    try {
      const payload = JSON.parse(event.raw) as WhatsAppWebhookPayload;
      await processWebhookPayload(payload);
      await markWebhookEventDone(event.id);
      report.processed += 1;
    } catch (err) {
      console.error(`Rielaborazione evento ${event.id} fallita:`, err);
      await markWebhookEventFailed(event.id, err);
      report.failed += 1;
      if (event.attempts + 1 >= MAX_PROCESSING_ATTEMPTS) report.abandoned += 1;
    }
  }

  return report;
}

interface MediaReport {
  archived: number;
  skipped: number;
  unavailable: number;
}

async function archivePendingMedia(): Promise<MediaReport> {
  const pending = await listPendingMediaMessages(MAX_MEDIA_PER_RUN);
  const report: MediaReport = { archived: 0, skipped: 0, unavailable: 0 };

  for (const item of pending) {
    // Nessun limite di dimensione: qui non c'è un timeout di Meta da rispettare.
    const outcome = await archiveMessageMedia(
      item.waId,
      item.messageId,
      { id: item.mediaId, filename: item.filename },
    );

    if (outcome.status === "done") report.archived += 1;
    else if (outcome.status === "unavailable") report.unavailable += 1;
    else report.skipped += 1;
  }

  return report;
}

export async function POST(request: Request) {
  const expected = process.env[TOKEN_ENV];

  if (!expected) {
    return NextResponse.json(
      { ok: false, error: `Manutenzione non configurata: manca ${TOKEN_ENV}` },
      { status: 503 },
    );
  }

  if (!isAuthorized(request, expected)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  try {
    const events = await retryPendingEvents();
    const media = await archivePendingMedia();
    return NextResponse.json({ ok: true, events, media });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Manutenzione fallita";
    console.error("Manutenzione fallita:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
