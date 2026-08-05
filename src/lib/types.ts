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

/** Allegato di un messaggio: i byte restano su WhatsApp, noi teniamo l'id. */
export interface MessageMedia {
  /**
   * Media id di WhatsApp. Si scarica da `/api/whatsapp/media/{id}`; Meta
   * conserva i file 30 giorni, poi l'allegato non è più recuperabile.
   */
  id: string;
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
 * Messaggio citato in risposta. Oltre all'id teniamo un'istantanea del
 * contenuto: il messaggio originale può essere fuori dalla finestra di 500
 * caricata dalla chat, e la citazione deve restare leggibile lo stesso.
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
