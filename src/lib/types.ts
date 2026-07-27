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
  /** Messaggio interattivo: invio di un Flow o risposta a un Flow. */
  | "interactive"
  | "unsupported";

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
