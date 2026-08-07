import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/whatsapp";
import {
  markWebhookEventDone,
  markWebhookEventFailed,
  recordWebhookEvent,
} from "@/lib/firebase/webhook-events";
import {
  processWebhookPayload,
  type WhatsAppWebhookPayload,
} from "@/lib/whatsapp-events";

// Il webhook deve girare nel runtime Node (Admin SDK + crypto), non su Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — verifica del webhook.
 * Meta chiama questo endpoint con hub.mode / hub.verify_token / hub.challenge.
 * Se il token coincide con WHATSAPP_WEBHOOK_VERIFY_TOKEN restituiamo la challenge.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token &&
    token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  ) {
    return new Response(challenge ?? "", { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

/**
 * POST — eventi in ingresso: messaggi dei clienti e aggiornamenti di stato.
 *
 * L'ordine dei passi è la parte importante:
 *
 * 1. verifica della firma e parsing — se falliscono il payload non è di Meta o
 *    non è leggibile, e ritentarlo non cambierebbe nulla;
 * 2. registrazione dell'evento grezzo su Firestore. È l'unico punto in cui
 *    rispondiamo **500**: se non riusciamo a mettere al sicuro il payload
 *    vogliamo che Meta lo riconsegni, perché non abbiamo ancora fatto niente;
 * 3. elaborazione. Da qui in poi rispondiamo sempre 200 — un errore lascia
 *    l'evento in coda e lo sweeper di manutenzione lo riprende, mentre un 500
 *    farebbe ritentare Meta per ore sullo stesso payload.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyWebhookSignature(rawBody, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  let eventId: string;
  try {
    const recorded = await recordWebhookEvent(rawBody);

    // Meta riconsegna gli eventi che non ha visto confermare: se l'abbiamo già
    // elaborato non c'è nulla da rifare.
    if (recorded.alreadyProcessed) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    eventId = recorded.id;
  } catch (err) {
    console.error("Impossibile registrare l'evento del webhook:", err);
    return new Response("Storage unavailable", { status: 500 });
  }

  try {
    await processWebhookPayload(payload);
    await markWebhookEventDone(eventId);
  } catch (err) {
    console.error("Errore elaborazione webhook WhatsApp:", err);
    await markWebhookEventFailed(eventId, err).catch((markErr) => {
      console.error("Impossibile registrare l'errore dell'evento:", markErr);
    });
    return NextResponse.json({ received: true, queued: true });
  }

  return NextResponse.json({ received: true });
}
