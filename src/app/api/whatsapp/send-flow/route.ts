import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { sendFlowMessage } from "@/lib/whatsapp";
import { saveOutboundMessage } from "@/lib/firebase/firestore-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — invia a un cliente il messaggio interattivo che apre un Flow.
 * Body: { to: string (waId), flowId?: string, body?: string, cta?: string }
 * Richiede header Authorization: Bearer <Firebase ID token> dell'operatore.
 *
 * Se `flowId` non è nel body si usa WHATSAPP_FLOW_ID.
 */
export async function POST(request: Request) {
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

  let payload: {
    to?: string;
    flowId?: string;
    body?: string;
    cta?: string;
    header?: string;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }

  const to = payload.to?.trim();
  if (!to) {
    return NextResponse.json({ error: "Campo 'to' obbligatorio" }, { status: 400 });
  }

  const flowId = payload.flowId?.trim() || process.env.WHATSAPP_FLOW_ID;
  if (!flowId) {
    return NextResponse.json(
      { error: "Nessun Flow configurato (WHATSAPP_FLOW_ID)" },
      { status: 400 },
    );
  }

  const body =
    payload.body?.trim() ||
    "Da qui puoi prenotare una visita o gestire i tuoi appuntamenti.";
  const cta = payload.cta?.trim() || "Apri";
  const header = payload.header?.trim();

  // Il flow_token lega la sessione di Flow alla conversazione: lo ritroviamo
  // in ogni richiesta all'endpoint e nella risposta finale del cliente.
  const flowToken = `${to}:${Date.now()}`;

  try {
    const { messageId } = await sendFlowMessage(to, {
      flowId,
      body,
      cta,
      header,
      flowToken,
      // Il Flow in bozza si può inviare solo ai numeri di test dell'app.
      draft: process.env.WHATSAPP_FLOW_DRAFT_MODE === "true",
    });

    await saveOutboundMessage({
      waId: to,
      messageId,
      text: body,
      type: "interactive",
      flowToken,
      timestamp: Date.now(),
      status: "sent",
    });

    return NextResponse.json({ messageId, flowToken });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Errore sconosciuto nell'invio";
    console.error("Invio Flow fallito:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
