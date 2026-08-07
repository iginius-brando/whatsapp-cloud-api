import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { openToken, sealToken } from "@/lib/meta/token-vault";
import type {
  CompanyPrivacySettings,
  SecuritySettings,
  MessageMedia,
  MessageReply,
  MessageStatus,
  MessageType,
  WhatsAppTenant,
} from "@/lib/types";

const CONVERSATIONS = "conversations";

function conversationRef(waId: string) {
  return adminDb.collection(CONVERSATIONS).doc(waId);
}

const SECURITY_SETTINGS_ID = "security";

const defaultSecuritySettings: SecuritySettings = {
  twoFactorEnabled: false,
  accessLogsEnabled: false,
  adminAuditEnabled: false,
};

export async function getSecuritySettings(): Promise<SecuritySettings> {
  const snap = await adminDb.collection("settings").doc(SECURITY_SETTINGS_ID).get();
  const data = snap.data();
  return {
    twoFactorEnabled: data?.twoFactorEnabled === true,
    accessLogsEnabled: data?.accessLogsEnabled === true,
    adminAuditEnabled: data?.adminAuditEnabled === true,
    updatedAt: data?.updatedAt ?? null,
  };
}

export async function saveSecuritySettings(
  settings: SecuritySettings,
  actor: { uid: string; email?: string },
): Promise<void> {
  const current = await getSecuritySettings().catch(() => defaultSecuritySettings);
  const batch = adminDb.batch();
  batch.set(
    adminDb.collection("settings").doc(SECURITY_SETTINGS_ID),
    { ...settings, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  if (settings.adminAuditEnabled || current.adminAuditEnabled) {
    batch.create(adminDb.collection("adminAuditLogs").doc(), {
      action: "Impostazioni di sicurezza aggiornate",
      actorUid: actor.uid,
      actorEmail: actor.email ?? "",
      changes: {
        twoFactorEnabled: settings.twoFactorEnabled,
        accessLogsEnabled: settings.accessLogsEnabled,
        adminAuditEnabled: settings.adminAuditEnabled,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

export async function getAdminAuditLogs(limit = 20) {
  const snapshot = await adminDb
    .collection("adminAuditLogs")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      action: typeof data.action === "string" ? data.action : "Attività amministrativa",
      actorEmail: typeof data.actorEmail === "string" ? data.actorEmail : "",
      createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    };
  });
}

function messageRef(waId: string, messageId: string) {
  return conversationRef(waId).collection("messages").doc(messageId);
}

/**
 * Firestore rifiuta i campi `undefined`: dell'allegato salviamo solo le
 * proprietà davvero valorizzate.
 */
function cleanMedia(media?: MessageMedia): MessageMedia | undefined {
  if (!media?.id) return undefined;

  const entries = Object.entries(media).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as MessageMedia;
}

/** Lunghezza massima dell'anteprima citata: basta per riconoscere il messaggio. */
const REPLY_PREVIEW_LENGTH = 200;

/**
 * Costruisce l'istantanea del messaggio citato leggendolo da Firestore.
 * Se non lo troviamo — conversazione più vecchia dei nostri dati, o messaggio
 * mai transitato da qui — restituiamo comunque l'id: la UI mostrerà una
 * citazione generica invece di perdere il riferimento.
 */
async function resolveReplyContext(
  waId: string,
  replyToMessageId: string,
): Promise<MessageReply> {
  const snap = await messageRef(waId, replyToMessageId)
    .get()
    .catch(() => null);
  const data = snap?.data();

  if (!data) return { id: replyToMessageId };

  const preview =
    (typeof data.text === "string" && data.text) ||
    (typeof data.mediaCaption === "string" && data.mediaCaption) ||
    "";

  return {
    id: replyToMessageId,
    ...(data.direction === "in" || data.direction === "out"
      ? { direction: data.direction }
      : {}),
    ...(typeof data.type === "string" ? { type: data.type as MessageType } : {}),
    ...(preview ? { text: preview.slice(0, REPLY_PREVIEW_LENGTH) } : {}),
  };
}

interface InboundMessageInput {
  waId: string;
  profileName?: string;
  messageId: string;
  type: MessageType;
  text?: string;
  mediaCaption?: string;
  /** Allegato ricevuto (image/video/audio/document/sticker). */
  media?: MessageMedia;
  /** wamid del messaggio citato, se il cliente ha risposto a un messaggio. */
  replyToMessageId?: string;
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
  const media = cleanMedia(input.media);
  const replyTo = input.replyToMessageId
    ? await resolveReplyContext(waId, input.replyToMessageId)
    : undefined;

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
      ...(media ? { media } : {}),
      ...(replyTo ? { replyTo } : {}),
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
  /** Testo del messaggio o didascalia dell'allegato. Può mancare sui media. */
  text?: string;
  /** Etichetta di ripiego per l'anteprima quando non c'è testo, es. "[video]". */
  mediaCaption?: string;
  /** Allegato inviato (image/video/audio/document/sticker). */
  media?: MessageMedia;
  /** wamid del messaggio citato, se l'operatore ha risposto a un messaggio. */
  replyToMessageId?: string;
  timestamp: number;
  status?: MessageStatus;
  /** Default "text": vale "interactive" per i Flow o "template" per i modelli Meta. */
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
    mediaCaption,
    timestamp,
    status = "sent",
    type = "text",
    flowToken,
  } = input;

  const preview = text || mediaCaption || `[${type}]`;
  const media = cleanMedia(input.media);
  const replyTo = input.replyToMessageId
    ? await resolveReplyContext(waId, input.replyToMessageId)
    : undefined;

  const batch = adminDb.batch();

  batch.set(
    conversationRef(waId),
    {
      waId,
      lastMessage: preview,
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
      ...(text ? { text } : {}),
      ...(mediaCaption ? { mediaCaption } : {}),
      ...(media ? { media } : {}),
      ...(replyTo ? { replyTo } : {}),
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

const WHATSAPP_TENANTS = "whatsappTenants";

export interface SaveWhatsAppTenantInput {
  tenant: WhatsAppTenant;
  /** Token del cliente: viene cifrato, se la chiave è configurata. */
  accessToken: string;
  /** PIN della verifica in due passaggi, quando il numero è stato registrato. */
  pin?: string;
  actor: { uid: string; email?: string };
}

/**
 * Salva (o aggiorna) un cliente onboardato via Embedded Signup.
 *
 * Il token e il PIN stanno in campi separati dal resto del documento e non
 * escono mai dal server: `listWhatsAppTenants` non li legge, e le regole
 * Firestore negano ogni accesso alla collection dal client.
 */
export async function saveWhatsAppTenant(
  input: SaveWhatsAppTenantInput,
): Promise<void> {
  const { tenant, accessToken, pin, actor } = input;
  const sealed = sealToken(accessToken);
  const ref = adminDb.collection(WHATSAPP_TENANTS).doc(tenant.wabaId);
  const existing = await ref.get();

  const batch = adminDb.batch();

  batch.set(
    ref,
    {
      ...tenant,
      tokenEncrypted: sealed.encrypted,
      accessToken: sealed.value,
      ...(pin ? { registrationPin: pin } : {}),
      connectedByUid: actor.uid,
      ...(actor.email ? { connectedByEmail: actor.email } : {}),
      ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const security = await getSecuritySettings().catch(() => defaultSecuritySettings);
  if (security.adminAuditEnabled) {
    batch.create(adminDb.collection("adminAuditLogs").doc(), {
      action: existing.exists
        ? "Cliente WhatsApp ricollegato via Embedded Signup"
        : "Cliente WhatsApp collegato via Embedded Signup",
      actorUid: actor.uid,
      actorEmail: actor.email ?? "",
      changes: {
        wabaId: tenant.wabaId,
        phoneNumberId: tenant.defaultPhoneNumberId ?? "",
        status: tenant.status,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
}

/** Elenco dei clienti collegati, senza token né PIN. */
export async function listWhatsAppTenants(): Promise<WhatsAppTenant[]> {
  const snapshot = await adminDb.collection(WHATSAPP_TENANTS).get();

  return snapshot.docs
    .map((doc) => {
      const { accessToken: _token, registrationPin: _pin, ...data } = doc.data();
      return {
        ...(data as Omit<WhatsAppTenant, "wabaId">),
        wabaId: doc.id,
      } as WhatsAppTenant;
    })
    .sort((a, b) => (a.name || a.wabaId).localeCompare(b.name || b.wabaId));
}

/**
 * Token del cliente da usare nelle chiamate Graph per conto suo.
 * È il punto d'ingresso per rendere multi-tenant l'invio dei messaggi.
 */
export async function getWhatsAppTenantAccessToken(
  wabaId: string,
): Promise<string | null> {
  const snap = await adminDb.collection(WHATSAPP_TENANTS).doc(wabaId).get();
  const data = snap.data();
  if (!data?.accessToken) return null;

  return openToken({
    value: data.accessToken as string,
    encrypted: data.tokenEncrypted === true,
  });
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
