import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { saveOutboundMessage } from "@/lib/firebase/firestore-admin";
import { sendMediaMessage, uploadMedia } from "@/lib/whatsapp";
import {
  fallbackFileName,
  formatFileSize,
  maxBytesFor,
  mediaKindLabel,
  mediaPlaceholder,
  normalizeMimeType,
  resolveMediaKind,
  MAX_UPLOAD_BYTES,
} from "@/lib/media";

/** Margine per boundary multipart e campi di testo oltre al file. */
const MULTIPART_OVERHEAD = 1024 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — invia un allegato (immagine, video, audio o documento) a un cliente.
 * Body: multipart/form-data con i campi `to`, `file` e, facoltativi, `caption`
 * e `replyTo` (wamid del messaggio citato).
 * Richiede header Authorization: Bearer <Firebase ID token> dell'operatore.
 *
 * Il file viene prima caricato sul nodo /media della Cloud API e poi inviato
 * per id: così non serve esporre pubblicamente alcun URL.
 */
export async function POST(request: Request) {
  // 1. Verifica autenticazione operatore.
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!idToken) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  try {
    await adminAuth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "Token non valido" }, { status: 401 });
  }

  // 2. Valida input.
  // `formData()` tiene tutto il corpo in memoria: le richieste palesemente
  // fuori misura vanno respinte prima di leggerle.
  const declaredSize = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredSize) &&
    declaredSize > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD
  ) {
    return NextResponse.json(
      {
        error: `File troppo grande: il limite per richiesta è ${formatFileSize(MAX_UPLOAD_BYTES)}.`,
      },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Richiesta non valida: attesa multipart/form-data" },
      { status: 400 },
    );
  }

  const to = form.get("to")?.toString().trim();
  const caption = form.get("caption")?.toString().trim() || undefined;
  const replyTo = form.get("replyTo")?.toString().trim() || undefined;
  const file = form.get("file");

  if (!to) {
    return NextResponse.json({ error: "Campo 'to' obbligatorio" }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Campo 'file' obbligatorio" }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "Il file è vuoto" }, { status: 400 });
  }

  const mimeType = normalizeMimeType(file.type, file.name);
  const kind = resolveMediaKind(mimeType);
  const filename = file.name?.trim() || fallbackFileName(kind, mimeType);
  const limit = maxBytesFor(kind);

  if (file.size > limit) {
    return NextResponse.json(
      {
        error:
          `File troppo grande: ${formatFileSize(file.size)}. ` +
          `Il limite per un ${mediaKindLabel(kind)} è ${formatFileSize(limit)}.`,
      },
      { status: 413 },
    );
  }

  // 3. Carica su WhatsApp, invia e salva su Firestore.
  try {
    const { mediaId } = await uploadMedia(file, filename, mimeType);
    const { messageId } = await sendMediaMessage(to, {
      kind,
      mediaId,
      caption,
      filename,
      replyToMessageId: replyTo,
    });

    // Meta scarta la didascalia su audio e sticker: non salviamo un testo che
    // il cliente non ha mai visto.
    const deliveredCaption =
      kind === "audio" || kind === "sticker" ? undefined : caption;

    await saveOutboundMessage({
      waId: to,
      messageId,
      type: kind,
      text: deliveredCaption,
      mediaCaption: kind === "document" ? filename : mediaPlaceholder(kind),
      media: { id: mediaId, mimeType, filename, size: file.size },
      replyToMessageId: replyTo,
      timestamp: Date.now(),
      status: "sent",
    });

    return NextResponse.json({ messageId, mediaId, type: kind });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Errore sconosciuto nell'invio";
    console.error("Invio allegato WhatsApp fallito:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
