import { NextResponse } from "next/server";
import {
  markMessageAsRead,
  verifyWebhookSignature,
} from "@/lib/whatsapp";
import {
  saveInboundMessage,
  updateMessageStatus,
} from "@/lib/firebase/firestore-admin";
import type { MessageStatus, MessageType } from "@/lib/types";

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
 * Rispondiamo sempre 200 rapidamente per non far ritentare Meta.
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

  try {
    await processPayload(payload);
  } catch (err) {
    // Logghiamo ma restituiamo 200: un 500 farebbe ritentare Meta all'infinito.
    console.error("Errore elaborazione webhook WhatsApp:", err);
  }

  return NextResponse.json({ received: true });
}

async function processPayload(payload: WhatsAppWebhookPayload): Promise<void> {
  if (payload.object !== "whatsapp_business_account") return;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      const profileByWaId = new Map<string, string>();
      for (const contact of value.contacts ?? []) {
        if (contact.wa_id) {
          profileByWaId.set(contact.wa_id, contact.profile?.name ?? "");
        }
      }

      // Messaggi in ingresso.
      for (const message of value.messages ?? []) {
        await handleInboundMessage(message, profileByWaId.get(message.from));
      }

      // Aggiornamenti di stato dei messaggi in uscita.
      for (const status of value.statuses ?? []) {
        await handleStatusUpdate(status);
      }
    }
  }
}

async function handleInboundMessage(
  message: WhatsAppInboundMessage,
  profileName?: string,
): Promise<void> {
  const waId = message.from;
  const timestamp = Number(message.timestamp) * 1000 || Date.now();
  const type = (message.type as MessageType) ?? "unsupported";

  let text: string | undefined;
  let mediaCaption: string | undefined;

  switch (message.type) {
    case "text":
      text = message.text?.body;
      break;
    case "image":
      mediaCaption = message.image?.caption || "[immagine]";
      break;
    case "video":
      mediaCaption = message.video?.caption || "[video]";
      break;
    case "document":
      mediaCaption = message.document?.caption || "[documento]";
      break;
    case "audio":
      mediaCaption = "[audio]";
      break;
    case "sticker":
      mediaCaption = "[sticker]";
      break;
    case "location":
      mediaCaption = "[posizione]";
      break;
    default:
      mediaCaption = `[${message.type}]`;
  }

  await saveInboundMessage({
    waId,
    profileName: profileName || undefined,
    messageId: message.id,
    type,
    text,
    mediaCaption,
    timestamp,
  });

  // Spunta blu lato cliente.
  await markMessageAsRead(message.id);
}

async function handleStatusUpdate(status: WhatsAppStatus): Promise<void> {
  const waId = status.recipient_id;
  const messageId = status.id;
  const mappedStatus = (status.status as MessageStatus) ?? "sent";
  const error = status.errors?.[0]?.title;

  await updateMessageStatus(waId, messageId, mappedStatus, error);
}

// --- Tipi (parziali) del payload del webhook Cloud API -------------------

interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      value?: WhatsAppChangeValue;
      field?: string;
    }>;
  }>;
}

interface WhatsAppChangeValue {
  messaging_product?: string;
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: WhatsAppInboundMessage[];
  statuses?: WhatsAppStatus[];
}

interface WhatsAppInboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string };
  [key: string]: unknown;
}

interface WhatsAppStatus {
  id: string;
  status: string;
  recipient_id: string;
  errors?: Array<{ title?: string }>;
}
