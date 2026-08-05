import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { sendTextMessage } from "@/lib/whatsapp";
import { saveOutboundMessage } from "@/lib/firebase/firestore-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — invia un messaggio di testo a un cliente.
 * Body: { to: string (waId), text: string, replyTo?: string (wamid citato) }
 * Richiede header Authorization: Bearer <Firebase ID token> dell'operatore.
 */
export async function POST(request: Request) {
  // 1. Verifica autenticazione operatore.
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!idToken) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  try {
    await adminAuth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "Token non valido" }, { status: 401 });
  }

  // 2. Valida input.
  let body: { to?: string; text?: string; replyTo?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }

  const to = body.to?.trim();
  const text = body.text?.trim();
  const replyTo = body.replyTo?.trim() || undefined;

  if (!to || !text) {
    return NextResponse.json(
      { error: "Campi 'to' e 'text' obbligatori" },
      { status: 400 },
    );
  }

  // 3. Invia via Cloud API e salva su Firestore.
  try {
    const { messageId } = await sendTextMessage(to, text, replyTo);
    const timestamp = Date.now();

    await saveOutboundMessage({
      waId: to,
      messageId,
      text,
      replyToMessageId: replyTo,
      timestamp,
      status: "sent",
    });

    return NextResponse.json({ messageId });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Errore sconosciuto nell'invio";
    console.error("Invio WhatsApp fallito:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
