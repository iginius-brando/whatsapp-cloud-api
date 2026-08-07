import "server-only";

import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "stream/web";
import { mediaBucket } from "@/lib/firebase/admin";
import {
  markMediaArchived,
  markMediaUnavailable,
} from "@/lib/firebase/firestore-admin";
import {
  MediaUnavailableError,
  downloadMedia,
  getMediaMetadata,
} from "@/lib/whatsapp";

/**
 * Copia degli allegati su Firebase Storage.
 *
 * Meta conserva i media 30 giorni: passati quelli, `media.id` non risolve più e
 * lo storico della chat resta con le anteprime rotte. Qui ne teniamo una copia
 * nel bucket del progetto, che diventa la fonte da cui il proxy serve i byte.
 *
 * Il percorso deriva solo dal media id, così il proxy può cercare la copia
 * senza prima leggere il messaggio su Firestore. Gli id di WhatsApp sono già
 * univoci a livello di account.
 */

const MEDIA_PREFIX = "whatsapp-media";

/**
 * Soglia per l'archiviazione fatta dentro al webhook.
 *
 * Il vincolo non è il limite di WhatsApp (100 MB sui documenti) ma la pazienza
 * di Meta: se il webhook non risponde in pochi secondi l'evento viene
 * riconsegnato. Sotto i 5 MB scaricare e ricaricare il file costa poco e
 * conviene farlo subito — è la taglia di immagini, sticker e note vocali, cioè
 * la stragrande maggioranza degli allegati. Sopra la soglia il file resta
 * `pending` e se ne occupa lo sweeper di manutenzione, che di tempo ne ha.
 */
export const INLINE_ARCHIVE_MAX_BYTES = 5 * 1024 * 1024;

export function mediaObjectPath(mediaId: string): string {
  return `${MEDIA_PREFIX}/${mediaId}`;
}

export interface ArchivedMediaRead {
  stream: NodeJS.ReadableStream;
  mimeType: string;
  size?: number;
}

/**
 * Legge la copia archiviata di un allegato, se esiste.
 * Restituisce `null` quando il file non è (ancora) stato archiviato: il
 * chiamante ripiega sulla Graph API.
 */
export async function readArchivedMedia(
  mediaId: string,
): Promise<ArchivedMediaRead | null> {
  const file = mediaBucket().file(mediaObjectPath(mediaId));

  const [exists] = await file.exists();
  if (!exists) return null;

  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);

  return {
    stream: file.createReadStream(),
    mimeType: metadata.contentType || "application/octet-stream",
    size: Number.isFinite(size) && size > 0 ? size : undefined,
  };
}

export type ArchiveOutcome =
  /** Copia disponibile nel bucket (appena creata o già presente). */
  | { status: "done"; storagePath: string }
  /** Troppo grande per la finestra a disposizione: da riprendere più tardi. */
  | { status: "skipped"; reason: string }
  /** Meta non ha più il file: inutile riprovare. */
  | { status: "unavailable"; reason: string };

export interface ArchiveOptions {
  /** Limite oltre il quale rimandare l'archiviazione; assente = nessun limite. */
  maxBytes?: number;
  /** Nome originale del file, conservato nei metadati dell'oggetto. */
  filename?: string;
}

/**
 * Copia un allegato di WhatsApp nel bucket. Se la copia c'è già non riscarica
 * nulla, quindi è sicuro richiamarla su un messaggio rielaborato.
 */
export async function archiveMedia(
  mediaId: string,
  options: ArchiveOptions = {},
): Promise<ArchiveOutcome> {
  const storagePath = mediaObjectPath(mediaId);
  const file = mediaBucket().file(storagePath);

  const [exists] = await file.exists();
  if (exists) return { status: "done", storagePath };

  let metadata;
  try {
    metadata = await getMediaMetadata(mediaId);
  } catch (err) {
    if (err instanceof MediaUnavailableError) {
      return { status: "unavailable", reason: err.message };
    }
    throw err;
  }

  if (
    options.maxBytes !== undefined &&
    metadata.fileSize !== undefined &&
    metadata.fileSize > options.maxBytes
  ) {
    return {
      status: "skipped",
      reason: `${metadata.fileSize} byte oltre il limite di ${options.maxBytes}`,
    };
  }

  const { body, mimeType } = await downloadMedia(mediaId, metadata);
  if (!body) {
    return { status: "unavailable", reason: "Risposta senza contenuto" };
  }

  // `resumable: false` è la scelta giusta per file di queste dimensioni: evita
  // il giro di handshake dell'upload ripartibile, che qui non serve.
  await pipeline(
    Readable.fromWeb(body as NodeWebReadableStream<Uint8Array>),
    file.createWriteStream({
      resumable: false,
      contentType: mimeType,
      metadata: {
        contentType: mimeType,
        ...(options.filename
          ? { metadata: { originalFilename: options.filename } }
          : {}),
      },
    }),
  );

  return { status: "done", storagePath };
}

/**
 * Archivia un allegato appena inviato dall'operatore.
 *
 * Qui i byte li abbiamo già in mano — sono quelli che l'operatore ha appena
 * caricato — quindi non ha senso passare dalla Graph API per riscaricarli.
 * Best-effort come il resto dell'archiviazione: se fallisce, il messaggio resta
 * `pending` e ci penserà lo sweeper.
 */
export async function archiveOutboundMedia(
  waId: string,
  messageId: string,
  mediaId: string,
  file: Blob,
  mimeType: string,
  filename?: string,
): Promise<void> {
  try {
    const storagePath = mediaObjectPath(mediaId);
    await mediaBucket()
      .file(storagePath)
      .save(Buffer.from(await file.arrayBuffer()), {
        resumable: false,
        contentType: mimeType,
        metadata: {
          contentType: mimeType,
          ...(filename ? { metadata: { originalFilename: filename } } : {}),
        },
      });

    await markMediaArchived(waId, messageId, storagePath);
  } catch (err) {
    console.error(
      `Archiviazione dell'allegato inviato ${mediaId} non riuscita, resta in coda:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Archivia l'allegato di un messaggio e ne aggiorna lo stato su Firestore.
 *
 * Non solleva mai: l'archiviazione è un miglioramento della conservazione, non
 * una precondizione per registrare il messaggio. Se fallisce, il messaggio
 * resta `pending` e lo sweeper riproverà finché Meta ha ancora il file.
 */
export async function archiveMessageMedia(
  waId: string,
  messageId: string,
  media: { id: string; filename?: string },
  options: ArchiveOptions = {},
): Promise<ArchiveOutcome> {
  try {
    const outcome = await archiveMedia(media.id, {
      ...options,
      filename: media.filename,
    });

    if (outcome.status === "done") {
      await markMediaArchived(waId, messageId, outcome.storagePath);
    } else if (outcome.status === "unavailable") {
      await markMediaUnavailable(waId, messageId);
    }

    return outcome;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "errore sconosciuto";
    console.error(
      `Archiviazione allegato ${media.id} non riuscita, resta in coda:`,
      reason,
    );
    return { status: "skipped", reason };
  }
}
