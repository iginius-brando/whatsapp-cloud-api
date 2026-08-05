import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import type {
  CompanyPrivacySettings,
  MessageStatus,
  MessageType,
} from "@/lib/types";

const CONVERSATIONS = "conversations";

function conversationRef(waId: string) {
  return adminDb.collection(CONVERSATIONS).doc(waId);
}

function messageRef(waId: string, messageId: string) {
  return conversationRef(waId).collection("messages").doc(messageId);
}

interface InboundMessageInput {
  waId: string;
  profileName?: string;
  messageId: string;
  type: MessageType;
  text?: string;
  mediaCaption?: string;
  timestamp: number;
  /** Presenti solo sulle risposte a un Flow (nfm_reply). */
  flowToken?: string;
  flowResponse?: Record<string, unknown>;
}

/** Salva un messaggio in ingresso e aggiorna i metadati della conversazione. */
export async function saveInboundMessage(input: InboundMessageInput): Promise<void> {
  const {
    waId,
    profileName,
    messageId,
    type,
    text,
    mediaCaption,
    timestamp,
    flowToken,
    flowResponse,
  } = input;

  const preview = text || mediaCaption || `[${type}]`;

  const batch = adminDb.batch();

  batch.set(
    conversationRef(waId),
    {
      waId,
      ...(profileName ? { name: profileName } : {}),
      lastMessage: preview,
      lastMessageAt: timestamp,
      lastMessageDirection: "in",
      lastInboundAt: timestamp,
      unreadCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  batch.set(
    messageRef(waId, messageId),
    {
      id: messageId,
      direction: "in",
      type,
      ...(text ? { text } : {}),
      ...(mediaCaption ? { mediaCaption } : {}),
      ...(flowToken ? { flowToken } : {}),
      ...(flowResponse ? { flowResponse } : {}),
      timestamp,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit();
}

interface OutboundMessageInput {
  waId: string;
  messageId: string;
  text: string;
  timestamp: number;
  status?: MessageStatus;
  /** Default "text": vale "interactive" per l'invio di un Flow. */
  type?: MessageType;
  flowToken?: string;
}

/** Salva un messaggio inviato dall'operatore e aggiorna la conversazione. */
export async function saveOutboundMessage(
  input: OutboundMessageInput,
): Promise<void> {
  const {
    waId,
    messageId,
    text,
    timestamp,
    status = "sent",
    type = "text",
    flowToken,
  } = input;

  const batch = adminDb.batch();

  batch.set(
    conversationRef(waId),
    {
      waId,
      lastMessage: text,
      lastMessageAt: timestamp,
      lastMessageDirection: "out",
      unreadCount: 0,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  batch.set(
    messageRef(waId, messageId),
    {
      id: messageId,
      direction: "out",
      type,
      text,
      status,
      ...(flowToken ? { flowToken } : {}),
      timestamp,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit();
}

interface FlowBookingInput {
  /** Token della sessione di Flow: lega la prenotazione alla conversazione. */
  flowToken: string;
  booking: Record<string, unknown>;
  createdAt: number;
}

/**
 * Registra una prenotazione completata dal Flow Endpoint.
 * Il flow_token che generiamo all'invio ha forma "<waId>:<timestamp>", quindi
 * da lì ricaviamo la conversazione a cui associare la prenotazione.
 */
export async function saveFlowBooking(input: FlowBookingInput): Promise<void> {
  const { flowToken, booking, createdAt } = input;
  const waId = flowToken.split(":")[0] || "sconosciuto";

  await adminDb.collection("flowBookings").add({
    waId,
    flowToken,
    booking,
    createdAt,
    createdAtServer: FieldValue.serverTimestamp(),
  });
}

/** Aggiorna lo stato (sent/delivered/read/failed) di un messaggio in uscita. */
export async function updateMessageStatus(
  waId: string,
  messageId: string,
  status: MessageStatus,
  error?: string,
): Promise<void> {
  await messageRef(waId, messageId)
    .set(
      {
        status,
        ...(error ? { error } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    .catch(() => {
      // Lo status può arrivare prima che il messaggio sia stato salvato in rari
      // casi di corsa: il merge crea comunque il documento, quindi ignoriamo.
    });
}

const SETTINGS = "settings";
const COMPANY_SETTINGS_ID = "company";

export async function getCompanyPrivacySettings(): Promise<CompanyPrivacySettings> {
  const snap = await adminDb.collection(SETTINGS).doc(COMPANY_SETTINGS_ID).get();
  if (!snap.exists) return {};

  const data = snap.data() ?? {};
  return {
    companyName: typeof data.companyName === "string" ? data.companyName : undefined,
    appName: typeof data.appName === "string" ? data.appName : undefined,
    legalName: typeof data.legalName === "string" ? data.legalName : undefined,
    legalAddress:
      typeof data.legalAddress === "string" ? data.legalAddress : undefined,
    taxId: typeof data.taxId === "string" ? data.taxId : undefined,
    privacyEmail: typeof data.privacyEmail === "string" ? data.privacyEmail : undefined,
    retentionPeriod:
      typeof data.retentionPeriod === "string" ? data.retentionPeriod : undefined,
    messageRetentionPeriod:
      typeof data.messageRetentionPeriod === "string"
        ? data.messageRetentionPeriod
        : undefined,
    legalRetentionPeriod:
      typeof data.legalRetentionPeriod === "string"
        ? data.legalRetentionPeriod
        : undefined,
    updatedAt: data.updatedAt ?? null,
  };
}

export async function saveCompanyPrivacySettings(
  settings: CompanyPrivacySettings,
): Promise<void> {
  await adminDb.collection(SETTINGS).doc(COMPANY_SETTINGS_ID).set(
    {
      companyName: settings.companyName ?? "",
      appName: settings.appName ?? "",
      legalName: settings.legalName ?? "",
      legalAddress: settings.legalAddress ?? "",
      taxId: settings.taxId ?? "",
      privacyEmail: settings.privacyEmail ?? "",
      retentionPeriod: settings.retentionPeriod ?? "",
      messageRetentionPeriod: settings.messageRetentionPeriod ?? "",
      legalRetentionPeriod: settings.legalRetentionPeriod ?? "",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
