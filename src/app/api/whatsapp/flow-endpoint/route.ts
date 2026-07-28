import {
  FlowDecryptionError,
  decryptFlowRequest,
  encryptFlowResponse,
  type EncryptedFlowRequest,
} from "@/lib/flows/crypto";
import { handleBookingFlow } from "@/lib/flows/booking";
import { verifyWebhookSignature } from "@/lib/whatsapp";

// Serve il runtime Node: crypto e chiavi RSA non esistono su Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Flow Endpoint: l'URL che si configura in WhatsApp Manager alla voce
 * "Imposta URI endpoint". Riceve richieste cifrate a ogni passo del Flow e
 * risponde con la schermata successiva, cifrata con la stessa chiave AES.
 *
 * Codici di errore previsti dalla specifica di Meta:
 *   421 → non riusciamo a decifrare: il client ricarica la chiave pubblica.
 *   432 → firma della richiesta non valida.
 *   427 → il Flow va chiuso (es. flow_token scaduto o revocato).
 *   500 → errore generico: il client mostra un messaggio d'errore all'utente.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  // 1. Firma HMAC con l'App Secret, come per il webhook dei messaggi.
  if (
    !verifyWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"))
  ) {
    return new Response("Invalid signature", { status: 432 });
  }

  let encrypted: EncryptedFlowRequest;
  try {
    encrypted = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 421 });
  }

  // 2. Decifratura. Qualsiasi problema qui è un 421: la causa quasi sempre è
  //    un disallineamento tra la chiave pubblica caricata su Meta e la privata.
  let decrypted;
  try {
    decrypted = decryptFlowRequest(encrypted);
  } catch (err) {
    const message =
      err instanceof FlowDecryptionError ? err.message : "Decryption failed";
    console.error("Flow endpoint — decifratura fallita:", message);
    return new Response("Decryption failed", { status: 421 });
  }

  const { payload, context } = decrypted;

  // 3. Azioni di sistema, prima della logica applicativa.
  //    "ping" è il controllo integrità che Meta esegue dalla UI del Flow.
  if (payload.action === "ping") {
    return encryptedResponse({ data: { status: "active" } }, context);
  }

  //    "error" segnala un problema lato client: va solo confermata.
  if (payload.action === "error") {
    console.error("Flow endpoint — errore segnalato dal client:", payload.data);
    return encryptedResponse({ data: { acknowledged: true } }, context);
  }

  // 4. Logica del Flow.
  try {
    const response = await handleBookingFlow(payload);
    return encryptedResponse(response, context);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    console.error("Flow endpoint — errore applicativo:", message);
    return new Response("Internal error", { status: 500 });
  }
}

/** Corpo della risposta: base64 in testo semplice, non JSON. */
function encryptedResponse(
  response: unknown,
  context: Parameters<typeof encryptFlowResponse>[1],
): Response {
  return new Response(encryptFlowResponse(response, context), {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
