import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import type { MessageStatus, MessageType } from "@/lib/types";

const CONVERSATIONS = "conversations";

function conversationRef(waId: string) {
  return adminDb.collection(CONVERSATIONS).doc(waId);
}

function messageRef(waId: string, messageId: string) {
  return conversationRef(waId).collection("messages").doc(messageId);
}

interface InboundMessageInput {
  waId: string;
  profileName?: string;
  messageId: string;
  type: MessageType;
  text?: string;
  mediaCaption?: string;
  timestamp: number;
}

/** Salva un messaggio in ingresso e aggiorna i metadati della conversazione. */
export async function saveInboundMessage(input: InboundMessageInput): Promise<void> {
  const { waId, profileName, messageId, type, text, mediaCaption, timestamp } =
    input;

  const preview = text || mediaCaption || `[${type}]`;

  const batch = adminDb.batch();

  batch.set(
    conversationRef(waId),
    {
      waId,
      ...(profileName ? { name: profileName } : {}),
      lastMessage: preview,
      lastMessageAt: timestamp,
      lastMessageDirection: "in",
      lastInboundAt: timestamp,
      unreadCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  batch.set(
    messageRef(waId, messageId),
    {
      id: messageId,
      direction: "in",
      type,
      ...(text ? { text } : {}),
      ...(mediaCaption ? { mediaCaption } : {}),
      timestamp,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit();
}

interface OutboundMessageInput {
  waId: string;
  messageId: string;
  text: string;
  timestamp: number;
  status?: MessageStatus;
}

/** Salva un messaggio inviato dall'operatore e aggiorna la conversazione. */
export async function saveOutboundMessage(
  input: OutboundMessageInput,
): Promise<void> {
  const { waId, messageId, text, timestamp, status = "sent" } = input;

  const batch = adminDb.batch();

  batch.set(
    conversationRef(waId),
    {
      waId,
      lastMessage: text,
      lastMessageAt: timestamp,
      lastMessageDirection: "out",
      unreadCount: 0,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  batch.set(
    messageRef(waId, messageId),
    {
      id: messageId,
      direction: "out",
      type: "text",
      text,
      status,
      timestamp,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit();
}

/** Aggiorna lo stato (sent/delivered/read/failed) di un messaggio in uscita. */
export async function updateMessageStatus(
  waId: string,
  messageId: string,
  status: MessageStatus,
  error?: string,
): Promise<void> {
  await messageRef(waId, messageId)
    .set(
      {
        status,
        ...(error ? { error } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    .catch(() => {
      // Lo status può arrivare prima che il messaggio sia stato salvato in rari
      // casi di corsa: il merge crea comunque il documento, quindi ignoriamo.
    });
}
