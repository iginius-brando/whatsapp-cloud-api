import "server-only";

import crypto from "crypto";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v22.0";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variabile d'ambiente mancante: ${name}`);
  }
  return value;
}

function graphUrl(path: string): string {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${path}`;
}

export interface SendTextResult {
  /** wamid del messaggio inviato. */
  messageId: string;
}

/** Invia un messaggio di testo libero tramite la Cloud API. */
export async function sendTextMessage(
  to: string,
  body: string,
): Promise<SendTextResult> {
  const phoneNumberId = requireEnv("WHATSAPP_PHONE_NUMBER_ID");
  const token = requireEnv("WHATSAPP_ACCESS_TOKEN");

  const res = await fetch(graphUrl(`${phoneNumberId}/messages`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: true, body },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    const detail = data?.error?.message || JSON.stringify(data);
    throw new Error(`Errore invio WhatsApp (${res.status}): ${detail}`);
  }

  const messageId = data?.messages?.[0]?.id;
  if (!messageId) {
    throw new Error("Risposta WhatsApp senza message id");
  }

  return { messageId };
}

/** Segna un messaggio in ingresso come letto (doppia spunta blu lato cliente). */
export async function markMessageAsRead(messageId: string): Promise<void> {
  const phoneNumberId = requireEnv("WHATSAPP_PHONE_NUMBER_ID");
  const token = requireEnv("WHATSAPP_ACCESS_TOKEN");

  await fetch(graphUrl(`${phoneNumberId}/messages`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  }).catch(() => {
    // Non bloccante: se fallisce, il messaggio resta semplicemente "non letto"
    // lato cliente. Evitiamo di far fallire l'intero webhook.
  });
}

/**
 * Verifica la firma X-Hub-Signature-256 inviata da Meta usando l'App Secret.
 * Confronta l'HMAC-SHA256 del corpo grezzo con l'header ricevuto.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  // Se l'app secret non è configurato, saltiamo la verifica (utile in dev),
  // ma in produzione va sempre impostato.
  if (!appSecret) return true;
  if (!signatureHeader) return false;

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
