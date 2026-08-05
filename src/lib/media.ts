/**
 * Tipi, limiti e utilità per gli allegati WhatsApp.
 * Questo modulo è condiviso tra client e server: non importare qui nulla di
 * "server-only", altrimenti la UI non compila.
 *
 * Riferimento: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 */

/** Categorie di media gestite dalla Cloud API. */
export type MediaKind = "image" | "video" | "audio" | "document" | "sticker";

/** MIME accettati da Meta per ogni categoria, in invio. */
export const SUPPORTED_MIME_TYPES: Record<MediaKind, readonly string[]> = {
  image: ["image/jpeg", "image/png"],
  video: ["video/mp4", "video/3gpp"],
  audio: ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"],
  sticker: ["image/webp"],
  // Meta documenta questi tipi, ma di fatto accetta qualsiasi allegato come
  // documento: la lista serve al filtro del selettore file, non alla validazione.
  document: [
    "text/plain",
    "text/csv",
    "application/pdf",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
};

/** Limite di dimensione per categoria, in byte (valori ufficiali Meta). */
export const MAX_MEDIA_BYTES: Record<MediaKind, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  sticker: 500 * 1024,
  document: 100 * 1024 * 1024,
};

/**
 * Tetto pratico di una singola richiesta HTTP verso l'app.
 * Meta arriva a 100 MB per i documenti, ma Cloud Run (su cui gira App Hosting)
 * rifiuta le richieste oltre i 32 MB: meglio bloccare prima con un messaggio
 * chiaro che farsi troncare la richiesta dall'infrastruttura.
 */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

/** Dimensione massima davvero inviabile per una categoria. */
export function maxBytesFor(kind: MediaKind): number {
  return Math.min(MAX_MEDIA_BYTES[kind], MAX_UPLOAD_BYTES);
}

/**
 * Alias MIME che i browser usano ma che Meta non riconosce.
 * La mappa li riporta al tipo equivalente supportato.
 */
const MIME_ALIASES: Record<string, string> = {
  "audio/mp3": "audio/mpeg",
  "audio/x-mpeg": "audio/mpeg",
  "audio/mpeg3": "audio/mpeg",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-aac": "audio/aac",
  "audio/vnd.dlna.adts": "audio/aac",
  "audio/opus": "audio/ogg",
  "audio/x-amr": "audio/amr",
  "video/3gp": "video/3gpp",
  "video/x-m4v": "video/mp4",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
};

/** Estensione → MIME, per i file che il browser consegna senza `type`. */
const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  "3gp": "video/3gpp",
  "3gpp": "video/3gpp",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  amr: "audio/amr",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
};

/**
 * Normalizza il MIME dichiarato dal browser: toglie i parametri (`; codecs=…`),
 * risolve gli alias e, se manca del tutto, prova a dedurlo dall'estensione.
 */
export function normalizeMimeType(mimeType?: string, filename?: string): string {
  const base = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (base) return MIME_ALIASES[base] ?? base;

  const extension = filename?.split(".").pop()?.toLowerCase();
  return (extension && EXTENSION_MIME[extension]) || "application/octet-stream";
}

/**
 * Sceglie la categoria WhatsApp per un file.
 *
 * Solo i formati che Meta accetta davvero diventano image/video/audio: tutto il
 * resto (webp, gif, wav, zip, …) parte come **documento**, così l'allegato
 * arriva comunque al cliente invece di essere rifiutato dalla Graph API.
 */
export function resolveMediaKind(mimeType: string): MediaKind {
  if (SUPPORTED_MIME_TYPES.image.includes(mimeType)) return "image";
  if (SUPPORTED_MIME_TYPES.video.includes(mimeType)) return "video";
  if (SUPPORTED_MIME_TYPES.audio.includes(mimeType)) return "audio";
  return "document";
}

/** True se il tipo di messaggio trasporta un allegato scaricabile. */
export function isMediaMessageType(type: string): type is MediaKind {
  return (
    type === "image" ||
    type === "video" ||
    type === "audio" ||
    type === "document" ||
    type === "sticker"
  );
}

const KIND_LABELS: Record<MediaKind, string> = {
  image: "immagine",
  video: "video",
  audio: "audio",
  document: "documento",
  sticker: "sticker",
};

/** Etichetta usata nelle anteprime della lista chat, es. "[immagine]". */
export function mediaPlaceholder(kind: MediaKind, voice?: boolean): string {
  if (kind === "audio" && voice) return "[messaggio vocale]";
  return `[${KIND_LABELS[kind]}]`;
}

/** Nome leggibile della categoria, per messaggi di errore e tooltip. */
export function mediaKindLabel(kind: MediaKind): string {
  return KIND_LABELS[kind];
}

/** Dimensione in formato compatto, es. "1,4 MB". */
export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(decimals).replace(".", ",")} ${units[unitIndex]}`;
}

/** Nome file di ripiego quando il browser o Meta non ne forniscono uno. */
export function fallbackFileName(kind: MediaKind, mimeType: string): string {
  const extension = mimeType.split("/")[1]?.split("+")[0] || "bin";
  return `${KIND_LABELS[kind]}.${extension}`;
}

/** Valore dell'attributo `accept` per i selettori file del composer. */
export const FILE_ACCEPT = {
  media: [...SUPPORTED_MIME_TYPES.image, ...SUPPORTED_MIME_TYPES.video].join(","),
  audio: SUPPORTED_MIME_TYPES.audio.join(","),
  document: "*/*",
} as const;
