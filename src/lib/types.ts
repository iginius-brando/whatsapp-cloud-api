import type { Timestamp } from "firebase/firestore";

export type MessageDirection = "in" | "out";

export type MessageStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export type MessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contacts"
  /** Messaggio template approvato Meta. */
  | "template"
  /** Messaggio interattivo: invio di un Flow o risposta a un Flow. */
  | "interactive"
  | "unsupported";

/** Allegato di un messaggio: l'id di WhatsApp più la copia su Storage. */
export interface MessageMedia {
  /**
   * Media id di WhatsApp. Si scarica da `/api/whatsapp/media/{id}`; Meta
   * conserva i file 30 giorni, dopodiché resta solo la copia archiviata.
   */
  id: string;
  /**
   * Percorso della copia su Firebase Storage, quando l'archiviazione è
   * riuscita. È il proxy a decidere da dove servire i byte: il browser non
   * accede mai al bucket.
   */
  storagePath?: string;
  mimeType?: string;
  /** Nome originale del file (documenti). */
  filename?: string;
  /** Dimensione in byte, quando nota. */
  size?: number;
  sha256?: string;
  /** True sui messaggi vocali registrati, false sugli audio allegati. */
  voice?: boolean;
  /** True sugli sticker animati. */
  animated?: boolean;
}

/**
 * Stato della copia dell'allegato su Firebase Storage.
 * - `pending`: da archiviare (lo sweeper di manutenzione ci riproverà);
 * - `done`: copia disponibile, il proxy la serve da lì;
 * - `unavailable`: Meta ha già cancellato il file, non è più recuperabile.
 */
export type MediaArchiveStatus = "pending" | "done" | "unavailable";

/**
 * Messaggio citato in risposta. Oltre all'id teniamo un'istantanea del
 * contenuto: il messaggio originale può essere fuori dalla finestra di
 * messaggi caricata dalla chat, e la citazione deve restare leggibile.
 */
export interface MessageReply {
  /** wamid del messaggio a cui si risponde. */
  id: string;
  direction?: MessageDirection;
  type?: MessageType;
  /** Anteprima testuale, fotografata al momento della risposta. */
  text?: string;
}

export interface ChatMessage {
  /** wamid del messaggio WhatsApp (o id temporaneo per gli outbound in coda). */
  id: string;
  direction: MessageDirection;
  type: MessageType;
  /** Contenuto testuale (per i messaggi type=text o didascalie). */
  text?: string;
  status?: MessageStatus;
  /** Descrizione del media / tipo non testuale, quando `text` non basta. */
  mediaCaption?: string;
  /** Allegato, sui messaggi image/video/audio/document/sticker. */
  media?: MessageMedia;
  /** Stato dell'archiviazione dell'allegato; assente sui messaggi senza media. */
  mediaArchive?: MediaArchiveStatus;
  /** Messaggio citato, quando questo è una risposta. */
  replyTo?: MessageReply;
  error?: string;
  /** Millisecondi epoch del momento in cui WhatsApp ha registrato il messaggio. */
  timestamp: number;
  createdAt?: Timestamp | null;
  /** Token della sessione di Flow, sui messaggi che ne inviano o ricevono uno. */
  flowToken?: string;
  /** Dati compilati dal cliente, sulle risposte a un Flow (nfm_reply). */
  flowResponse?: Record<string, unknown>;
}

export interface Conversation {
  /** Numero di telefono del cliente in formato E.164 senza "+", usato come doc id. */
  waId: string;
  /** Nome profilo WhatsApp del cliente, se disponibile. */
  name?: string;
  lastMessage?: string;
  lastMessageAt?: number;
  lastMessageDirection?: MessageDirection;
  unreadCount?: number;
  /** Millisecondi epoch dell'ultimo messaggio in ingresso: serve per la finestra di 24h. */
  lastInboundAt?: number;
}

/** True se siamo entro la finestra di servizio di 24h e si possono inviare messaggi liberi. */
export function isWithinServiceWindow(lastInboundAt?: number): boolean {
  if (!lastInboundAt) return false;
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Date.now() - lastInboundAt < DAY_MS;
}

export interface CompanyPrivacySettings {
  companyName?: string;
  appName?: string;
  legalName?: string;
  legalAddress?: string;
  taxId?: string;
  privacyEmail?: string;
  /** Campo legacy mantenuto per compatibilità con impostazioni già salvate. */
  retentionPeriod?: string;
  messageRetentionPeriod?: string;
  legalRetentionPeriod?: string;
  updatedAt?: Timestamp | null;
}

export interface SecuritySettings {
  twoFactorEnabled: boolean;
  accessLogsEnabled: boolean;
  adminAuditEnabled: boolean;
  updatedAt?: Timestamp | null;
}

/** Passi dell'onboarding di un cliente via Embedded Signup. */
export type OnboardingStepId =
  /** Scambio del `code` con il token del cliente. */
  | "token"
  /** Permessi WhatsApp effettivamente concessi dal cliente. */
  | "permissions"
  /** Iscrizione della nostra app ai webhook della WABA del cliente. */
  | "subscribe"
  /** Registrazione del numero sulla Cloud API. */
  | "register"
  /** Lettura di WABA e numeri collegati. */
  | "details";

export interface OnboardingStep {
  id: OnboardingStepId;
  label: string;
  ok: boolean;
  detail: string;
}

/** Numero collegato alla WABA di un cliente. */
export interface WhatsAppTenantPhoneNumber {
  /** Phone Number ID da usare negli invii per quel numero. */
  id: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: string;
  codeVerificationStatus?: string;
  /** "CLOUD_API" oppure "NOT_APPLICABLE" sui numeri in coesistenza. */
  platformType?: string;
}

export type WhatsAppTenantStatus = "connected" | "incomplete";

/**
 * Cliente onboardato come tech provider: una WABA condivisa con la nostra app.
 * Il token del cliente **non** fa parte di questo tipo: resta lato server, in
 * un campo separato del documento Firestore (vedi `firestore-admin.ts`).
 */
export interface WhatsAppTenant {
  /** ID della WhatsApp Business Account del cliente, usato come doc id. */
  wabaId: string;
  /** Business portfolio del cliente, quando il flusso lo restituisce. */
  businessId?: string;
  name?: string;
  currency?: string;
  timezoneId?: string;
  accountReviewStatus?: string;
  phoneNumbers?: WhatsAppTenantPhoneNumber[];
  /** Numero scelto durante l'Embedded Signup. */
  defaultPhoneNumberId?: string;
  grantedScopes?: string[];
  /** Millisecondi epoch della scadenza del token; 0 se non scade. */
  tokenExpiresAt?: number;
  /** True se il token è cifrato a riposo (vedi `token-vault.ts`). */
  tokenEncrypted?: boolean;
  subscribed?: boolean;
  registered?: boolean;
  status: WhatsAppTenantStatus;
  /** Esito dell'ultimo onboarding, passo per passo. */
  steps?: OnboardingStep[];
  connectedByEmail?: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}
