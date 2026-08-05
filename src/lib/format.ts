/** Utility di formattazione per la UI della chat. */

import { isMediaMessageType, mediaPlaceholder } from "@/lib/media";
import type { MessageType } from "@/lib/types";

interface PreviewSource {
  type?: MessageType;
  text?: string;
  mediaCaption?: string;
}

/**
 * Riassume un messaggio in una riga: serve alle citazioni e all'anteprima del
 * composer. Sui media senza didascalia ripiega sull'etichetta del tipo.
 */
export function messagePreview(message: PreviewSource): string {
  if (message.text) return message.text;
  if (message.mediaCaption) return message.mediaCaption;
  if (message.type && isMediaMessageType(message.type)) {
    return mediaPlaceholder(message.type);
  }
  return "Messaggio";
}

const timeFmt = new Intl.DateTimeFormat("it-IT", {
  hour: "2-digit",
  minute: "2-digit",
});

const dateFmt = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});

/** Ora breve (es. 14:32). */
export function formatTime(ms?: number): string {
  if (!ms) return "";
  return timeFmt.format(new Date(ms));
}

/** Etichetta relativa per la lista chat: ora se oggi, "Ieri", altrimenti data. */
export function formatListTimestamp(ms?: number): string {
  if (!ms) return "";
  const date = new Date(ms);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return timeFmt.format(date);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Ieri";

  return dateFmt.format(date);
}

/** Formatta un waId (E.164 senza +) come numero leggibile. */
export function formatPhone(waId: string): string {
  return waId.startsWith("+") ? waId : `+${waId}`;
}

/** Iniziale per l'avatar. */
export function initialOf(name: string | undefined, waId: string): string {
  const source = (name || waId).trim();
  return source ? source[0].toUpperCase() : "?";
}
