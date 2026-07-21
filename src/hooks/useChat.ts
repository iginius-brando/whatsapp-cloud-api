"use client";

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import type { ChatMessage, Conversation } from "@/lib/types";

/** Sottoscrizione realtime all'elenco conversazioni (inbox condivisa). */
export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(getClientDb(), "conversations"),
      orderBy("lastMessageAt", "desc"),
      limit(200),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setConversations(
          snap.docs.map((d) => ({ waId: d.id, ...d.data() }) as Conversation),
        );
        setLoading(false);
      },
      (err) => {
        console.error("Errore lettura conversazioni:", err);
        setLoading(false);
      },
    );

    return () => unsub();
  }, []);

  return { conversations, loading };
}

/** Sottoscrizione realtime ai messaggi di una conversazione. */
export function useMessages(waId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!waId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(
      collection(getClientDb(), "conversations", waId, "messages"),
      orderBy("timestamp", "asc"),
      limit(500),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setMessages(snap.docs.map((d) => d.data() as ChatMessage));
        setLoading(false);
      },
      (err) => {
        console.error("Errore lettura messaggi:", err);
        setLoading(false);
      },
    );

    return () => unsub();
  }, [waId]);

  return { messages, loading };
}

/** Azzera il contatore dei non letti quando l'operatore apre la chat. */
export async function markConversationRead(waId: string): Promise<void> {
  try {
    await updateDoc(doc(getClientDb(), "conversations", waId), {
      unreadCount: 0,
    });
  } catch (err) {
    console.error("Impossibile azzerare i non letti:", err);
  }
}
