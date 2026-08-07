"use client";

import { useCallback, useEffect, useState } from "react";
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

/** Messaggi caricati all'apertura della chat, e passo di ogni "carica altri". */
export const MESSAGES_PAGE_SIZE = 50;

export interface MessagesState {
  /** Messaggi dal più vecchio al più recente, pronti da renderizzare. */
  messages: ChatMessage[];
  /** Primo caricamento della conversazione. */
  loading: boolean;
  /** Caricamento di una pagina di messaggi più vecchi. */
  loadingMore: boolean;
  /** True finché il server ha restituito una pagina piena: potrebbero essercene altri. */
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * Sottoscrizione realtime ai messaggi di una conversazione.
 *
 * L'ordinamento è **discendente** con `limit`: Firestore ordina e poi taglia,
 * quindi chiedendo `asc` si otterrebbero i messaggi più *vecchi* e la chat non
 * mostrerebbe mai gli ultimi arrivati. Prendiamo la coda più recente e la
 * invertiamo qui per il rendering.
 *
 * Il "carica altri" allarga la finestra della stessa query invece di aprirne
 * una seconda: così resta una sola sottoscrizione, che continua a ricevere in
 * realtime i messaggi nuovi anche dopo aver risalito lo storico.
 */
export function useMessages(waId: string | null): MessagesState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [pageSize, setPageSize] = useState(MESSAGES_PAGE_SIZE);

  // Cambio conversazione: si riparte dalla prima pagina. L'aggiornamento in
  // fase di render evita il doppio abbonamento che si avrebbe azzerando
  // `pageSize` da un `useEffect` dopo che la query è già partita.
  const [renderedWaId, setRenderedWaId] = useState(waId);
  if (waId !== renderedWaId) {
    setRenderedWaId(waId);
    setPageSize(MESSAGES_PAGE_SIZE);
    setMessages([]);
    setLoading(true);
    setLoadingMore(false);
    setHasMore(false);
  }

  useEffect(() => {
    if (!waId) {
      setMessages([]);
      setLoading(false);
      setHasMore(false);
      return;
    }

    const q = query(
      collection(getClientDb(), "conversations", waId, "messages"),
      orderBy("timestamp", "desc"),
      limit(pageSize),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setMessages(
          snap.docs.map((d) => d.data() as ChatMessage).reverse(),
        );
        // Pagina piena: con ogni probabilità c'è altro storico da risalire.
        setHasMore(snap.size >= pageSize);
        setLoading(false);
        setLoadingMore(false);
      },
      (err) => {
        console.error("Errore lettura messaggi:", err);
        setLoading(false);
        setLoadingMore(false);
      },
    );

    return () => unsub();
  }, [waId, pageSize]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setPageSize((current) => current + MESSAGES_PAGE_SIZE);
  }, [loadingMore, hasMore]);

  return { messages, loading, loadingMore, hasMore, loadMore };
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
