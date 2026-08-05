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

export type WhatsAppTemplateComponentType =
  | "HEADER"
  | "BODY"
  | "FOOTER"
  | "BUTTONS";

export interface WhatsAppTemplateButton {
  type?: string;
  text?: string;
  url?: string;
}

export interface WhatsAppTemplateComponent {
  type: WhatsAppTemplateComponentType;
  format?: string;
  text?: string;
  buttons?: WhatsAppTemplateButton[];
}

export interface WhatsAppMessageTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  components?: WhatsAppTemplateComponent[];
}

export interface SendTemplateComponentParameter {
  type: "text";
  text: string;
}

export interface SendTemplateComponent {
  type: "header" | "body" | "button";
  sub_type?: "url" | "quick_reply" | "copy_code";
  index?: string;
  parameters: SendTemplateComponentParameter[];
}

export interface SendTemplateOptions {
  name: string;
  language: string;
  components?: SendTemplateComponent[];
}

export interface SendTextResult {
  /** wamid del messaggio inviato. */
  messageId: string;
}

/** POST su /{phone-number-id}/messages, con gestione uniforme degli errori. */
async function postMessage(
  payload: Record<string, unknown>,
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
      ...payload,
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

/** Invia un messaggio di testo libero tramite la Cloud API. */
export async function sendTextMessage(
  to: string,
  body: string,
): Promise<SendTextResult> {
  return postMessage({
    to,
    type: "text",
    text: { preview_url: true, body },
  });
}

export interface SendFlowOptions {
  /** ID del Flow pubblicato (o in bozza, se `draft` è true). */
  flowId: string;
  /** Testo del corpo del messaggio che accompagna il bottone. */
  body: string;
  /** Etichetta del bottone che apre il Flow. */
  cta: string;
  header?: string;
  footer?: string;
  /**
   * Token opaco che ci ritorna in ogni richiesta all'endpoint e nella risposta
   * finale: serve a collegare la sessione di Flow alla conversazione.
   */
  flowToken: string;
  /**
   * "data_exchange" (default) fa richiedere la prima schermata al nostro
   * endpoint; "navigate" apre direttamente una schermata statica.
   */
  action?: "data_exchange" | "navigate";
  /** Schermata iniziale e dati, solo per action = "navigate". */
  screen?: string;
  screenData?: Record<string, unknown>;
  /** True per inviare un Flow ancora in bozza (solo verso numeri di test). */
  draft?: boolean;
}

/**
 * Invia un messaggio interattivo che apre un Flow.
 * Utilizzabile solo entro la finestra di servizio di 24 ore; fuori da quella
 * finestra serve un template approvato con bottone di tipo flow.
 */
export async function sendFlowMessage(
  to: string,
  options: SendFlowOptions,
): Promise<SendTextResult> {
  const {
    flowId,
    body,
    cta,
    header,
    footer,
    flowToken,
    action = "data_exchange",
    screen,
    screenData,
    draft = false,
  } = options;

  if (action === "navigate" && !screen) {
    throw new Error("Con flow_action 'navigate' serve la schermata iniziale");
  }

  return postMessage({
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      ...(header ? { header: { type: "text", text: header } } : {}),
      body: { text: body },
      ...(footer ? { footer: { text: footer } } : {}),
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: flowToken,
          flow_id: flowId,
          flow_cta: cta,
          flow_action: action,
          ...(draft ? { mode: "draft" } : {}),
          ...(action === "navigate"
            ? {
                flow_action_payload: {
                  screen,
                  ...(screenData ? { data: screenData } : {}),
                },
              }
            : {}),
        },
      },
    },
  });
}

export async function listWhatsAppMessageTemplates(): Promise<WhatsAppMessageTemplate[]> {
  const businessAccountId = requireEnv("WHATSAPP_BUSINESS_ACCOUNT_ID");

  const data = await getGraphResource<{ data?: WhatsAppMessageTemplate[] }>(
    `${businessAccountId}/message_templates`,
    "id,name,language,status,category,components",
  );

  return (data.data ?? [])
    .filter((template) => template.status === "APPROVED")
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function sendTemplateMessage(
  to: string,
  options: SendTemplateOptions,
): Promise<SendTextResult> {
  return postMessage({
    to,
    type: "template",
    template: {
      name: options.name,
      language: { code: options.language },
      ...(options.components?.length ? { components: options.components } : {}),
    },
  });
}

export interface WhatsAppPhoneNumberCheck {
  id: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: string;
}

export interface WhatsAppFlowCheck {
  id: string;
  name?: string;
  status?: string;
}

async function getGraphResource<T>(path: string, fields: string): Promise<T> {
  const token = requireEnv("WHATSAPP_ACCESS_TOKEN");
  const res = await fetch(graphUrl(`${path}?fields=${fields}`), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const data = await res.json();

  if (!res.ok) {
    const detail = data?.error?.message || JSON.stringify(data);
    throw new Error(`Errore verifica WhatsApp (${res.status}): ${detail}`);
  }

  return data as T;
}

/** Verifica che token e Phone Number ID puntino a un numero WhatsApp raggiungibile. */
export async function checkWhatsAppPhoneNumber(): Promise<WhatsAppPhoneNumberCheck> {
  const phoneNumberId = requireEnv("WHATSAPP_PHONE_NUMBER_ID");

  return getGraphResource<WhatsAppPhoneNumberCheck>(
    phoneNumberId,
    "id,display_phone_number,verified_name,quality_rating",
  );
}

/** Verifica che il Flow configurato sia leggibile dall'app/token corrente. */
export async function checkWhatsAppFlow(): Promise<WhatsAppFlowCheck> {
  const flowId = requireEnv("WHATSAPP_FLOW_ID");

  return getGraphResource<WhatsAppFlowCheck>(flowId, "id,name,status");
}

export function checkWhatsAppWebhookConfig(): { verifyToken: boolean; appSecret: boolean } {
  return {
    verifyToken: Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
    appSecret: Boolean(process.env.WHATSAPP_APP_SECRET),
  };
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
