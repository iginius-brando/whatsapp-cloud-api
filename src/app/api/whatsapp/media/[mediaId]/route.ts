import { Readable } from "stream";
import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { readArchivedMedia } from "@/lib/firebase/media-archive";
import { downloadMedia } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Gli id dei media di Meta sono stringhe numeriche; niente altro va in URL. */
const MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Costruisce un Content-Disposition sicuro: il nome file arriva dal cliente,
 * quindi va ripulito prima di finire in un header.
 */
function contentDisposition(filename?: string | null): string {
  const clean = filename
    ?.replace(/[\r\n"\\/]/g, " ")
    .trim()
    .slice(0, 120);

  if (!clean) return "inline";
  return `inline; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

/** Corpo della risposta: i due sorgenti danno stream di tipo diverso. */
interface MediaSource {
  body: ReadableStream<Uint8Array> | null;
  mimeType: string;
  size?: number;
}

/**
 * Preferisce la copia archiviata su Firebase Storage e ripiega sulla Graph API.
 *
 * L'ordine conta: dopo 30 giorni Meta cancella i media, quindi per lo storico
 * la copia nel bucket è l'unica fonte rimasta. Per un allegato appena arrivato
 * e non ancora archiviato vale il contrario, e la Graph API copre il buco.
 */
async function loadMedia(mediaId: string): Promise<MediaSource> {
  const archived = await readArchivedMedia(mediaId).catch((err) => {
    console.error("Lettura dell'allegato archiviato fallita:", err);
    return null;
  });

  if (archived) {
    return {
      body: Readable.toWeb(
        archived.stream as Readable,
      ) as ReadableStream<Uint8Array>,
      mimeType: archived.mimeType,
      size: archived.size,
    };
  }

  return downloadMedia(mediaId);
}

/**
 * GET — scarica un allegato WhatsApp e lo inoltra all'operatore.
 *
 * Né i media di Meta né il bucket sono pubblici: l'URL temporaneo di Meta va
 * risolto con l'access token e Storage è chiuso a ogni client. Questa route fa
 * da proxy autenticato, quindi la UI la chiama con l'ID token Firebase e riceve
 * i byte.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ mediaId: string }> },
) {
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

  const { mediaId } = await context.params;

  if (!MEDIA_ID_PATTERN.test(mediaId)) {
    return NextResponse.json({ error: "Media id non valido" }, { status: 400 });
  }

  try {
    const { body, mimeType, size } = await loadMedia(mediaId);

    const filename = new URL(request.url).searchParams.get("filename");
    const headers = new Headers({
      "Content-Type": mimeType,
      "Content-Disposition": contentDisposition(filename),
      // Il contenuto di un media id non cambia mai: la cache privata del
      // browser evita di riscaricarlo a ogni apertura della chat.
      "Cache-Control": "private, max-age=86400, immutable",
    });
    if (size) headers.set("Content-Length", String(size));

    return new Response(body, { headers });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Allegato non recuperabile";
    console.error("Download allegato WhatsApp fallito:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
