import "server-only";

import { markMessageAsRead } from "@/lib/whatsapp";
import {
  saveInboundMessage,
  updateMessageStatus,
} from "@/lib/firebase/firestore-admin";
import {
  INLINE_ARCHIVE_MAX_BYTES,
  archiveMessageMedia,
} from "@/lib/firebase/media-archive";
import type { MessageMedia, MessageStatus, MessageType } from "@/lib/types";
import { mediaPlaceholder, type MediaKind } from "@/lib/media";

/**
 * Elaborazione degli eventi del webhook WhatsApp.
 *
 * Sta qui e non nella route perché ha due chiamanti: la consegna in diretta di
 * Meta e la ri-elaborazione degli eventi rimasti in coda
 * (`/api/whatsapp/maintenance`). Le due strade devono fare esattamente le
 * stesse cose, altrimenti un evento ripreso dalla coda finirebbe salvato in
 * modo diverso da uno arrivato al primo colpo.
 */
export async function processWebhookPayload(
  payload: WhatsAppWebhookPayload,
): Promise<void> {
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
  let media: MessageMedia | undefined;
  let flowToken: string | undefined;
  let flowResponse: Record<string, unknown> | undefined;

  switch (message.type) {
    case "text":
      text = message.text?.body;
      break;
    case "interactive": {
      // Risposta a un Flow: i campi compilati arrivano in response_json,
      // che è una stringa JSON, non un oggetto.
      const interactive = message.interactive;
      if (interactive?.type === "nfm_reply") {
        const reply = interactive.nfm_reply;
        try {
          flowResponse = reply?.response_json
            ? JSON.parse(reply.response_json)
            : undefined;
        } catch {
          console.error("response_json del Flow non parsabile");
        }
        flowToken =
          typeof flowResponse?.flow_token === "string"
            ? flowResponse.flow_token
            : undefined;
        mediaCaption = reply?.body || "[modulo compilato]";
      } else {
        // Risposte a bottoni/liste: il titolo scelto è già un buon testo.
        text =
          interactive?.button_reply?.title ||
          interactive?.list_reply?.title ||
          undefined;
        if (!text) mediaCaption = "[risposta interattiva]";
      }
      break;
    }
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker": {
      // Il payload contiene solo l'id del media: i byte si scaricano a parte
      // dalla Graph API e li archiviamo su Storage subito dopo il salvataggio.
      const kind = message.type as MediaKind;
      const attachment = message[kind] as WhatsAppMediaObject | undefined;

      if (attachment?.id) {
        media = {
          id: attachment.id,
          mimeType: attachment.mime_type?.split(";")[0],
          filename: attachment.filename,
          sha256: attachment.sha256,
          ...(attachment.voice != null ? { voice: attachment.voice } : {}),
          ...(attachment.animated != null ? { animated: attachment.animated } : {}),
        };
      }

      text = attachment?.caption || undefined;
      mediaCaption =
        attachment?.filename || mediaPlaceholder(kind, attachment?.voice);
      break;
    }
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
    media,
    // `context` compare anche sui messaggi inoltrati o arrivati da un annuncio:
    // solo quando porta un id si tratta davvero di una risposta.
    replyToMessageId: message.context?.id,
    timestamp,
    flowToken,
    flowResponse,
  });

  // Copia dell'allegato nel bucket, così resta leggibile anche dopo i 30 giorni
  // di conservazione di Meta. I file oltre la soglia restano in coda per lo
  // sweeper: scaricarli qui rischierebbe di far scadere la richiesta di Meta.
  // Non blocca né fa fallire l'evento: al peggio l'allegato resta `pending`.
  if (media?.id) {
    await archiveMessageMedia(waId, message.id, media, {
      maxBytes: INLINE_ARCHIVE_MAX_BYTES,
    });
  }

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

export interface WhatsAppWebhookPayload {
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

/** Oggetto allegato dei messaggi image/video/audio/document/sticker. */
interface WhatsAppMediaObject {
  id?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  /** Solo sui documenti. */
  filename?: string;
  /** Solo sugli audio: true se è un messaggio vocale registrato. */
  voice?: boolean;
  /** Solo sugli sticker. */
  animated?: boolean;
}

interface WhatsAppInboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  image?: WhatsAppMediaObject;
  video?: WhatsAppMediaObject;
  audio?: WhatsAppMediaObject;
  document?: WhatsAppMediaObject;
  sticker?: WhatsAppMediaObject;
  /** Presente quando il cliente risponde a un messaggio o lo inoltra. */
  context?: {
    /** Numero di chi ha scritto il messaggio citato. */
    from?: string;
    /** wamid del messaggio citato: c'è solo sulle risposte. */
    id?: string;
    forwarded?: boolean;
    frequently_forwarded?: boolean;
  };
  interactive?: {
    type?: string;
    /** Risposta a un Flow. */
    nfm_reply?: { name?: string; body?: string; response_json?: string };
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  [key: string]: unknown;
}

interface WhatsAppStatus {
  id: string;
  status: string;
  recipient_id: string;
  errors?: Array<{ title?: string }>;
}
