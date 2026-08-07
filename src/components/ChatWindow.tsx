"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage, Conversation } from "@/lib/types";
import { isWithinServiceWindow } from "@/lib/types";
import { useMessages, markConversationRead } from "@/hooks/useChat";
import { initialOf, formatPhone } from "@/lib/format";
import MessageBubble from "./MessageBubble";
import MessageComposer from "./MessageComposer";

interface Props {
  conversation: Conversation | null;
  onBack: () => void;
}

export default function ChatWindow({ conversation, onBack }: Props) {
  const waId = conversation?.waId ?? null;
  const { messages, loading, loadingMore, hasMore, loadMore } = useMessages(waId);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Altezza della lista prima di caricare i messaggi più vecchi: dopo che la
  // lista si è allungata in cima, la differenza rimette la vista sullo stesso
  // messaggio invece di far saltare la chat.
  const restoreFromHeight = useRef<number | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);

  // Scroll all'ultimo messaggio a ogni aggiornamento, tranne quando stiamo
  // risalendo lo storico. `useLayoutEffect` corregge la posizione prima che il
  // browser dipinga, così non si vede lo scatto.
  useLayoutEffect(() => {
    const list = listRef.current;

    if (restoreFromHeight.current !== null) {
      if (list) list.scrollTop += list.scrollHeight - restoreFromHeight.current;
      restoreFromHeight.current = null;
      return;
    }

    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleLoadMore() {
    if (loadingMore || !hasMore) return;
    restoreFromHeight.current = listRef.current?.scrollHeight ?? 0;
    loadMore();
  }

  // Azzera i non letti all'apertura della chat e scarta la citazione in sospeso:
  // appartiene alla conversazione che stiamo lasciando.
  useEffect(() => {
    setReplyTo(null);
    if (waId) void markConversationRead(waId);
  }, [waId]);

  if (!conversation) {
    return (
      <div className="hidden flex-1 items-center justify-center bg-wa-panel text-center md:flex">
        <div className="max-w-sm px-6 text-gray-400">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white text-wa-green">
            <svg viewBox="0 0 24 24" className="h-10 w-10" fill="currentColor">
              <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2z" />
            </svg>
          </div>
          <p className="text-lg font-medium text-gray-600">
            Seleziona una conversazione
          </p>
          <p className="mt-1 text-sm">
            Scegli una chat dall&apos;elenco per iniziare a rispondere.
          </p>
        </div>
      </div>
    );
  }

  const canSendFreeform = isWithinServiceWindow(conversation.lastInboundAt);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {/* Header conversazione */}
      <header className="flex min-w-0 items-center gap-3 border-b bg-wa-panel px-3 py-2.5">
        <button
          onClick={onBack}
          className="text-gray-500 hover:text-gray-800 md:hidden"
          aria-label="Indietro"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
          </svg>
        </button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wa-teal font-semibold text-white">
          {initialOf(conversation.name, conversation.waId)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-gray-800">
            {conversation.name || formatPhone(conversation.waId)}
          </p>
          <p className="truncate text-xs text-gray-500">
            {formatPhone(conversation.waId)}
          </p>
        </div>
      </header>

      {/* Messaggi */}
      {/* overflow-x-hidden: durante lo swipe la bolla esce dal bordo e non deve
          comparire una barra di scorrimento orizzontale. */}
      <div
        ref={listRef}
        className="chat-bg min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-3 thin-scroll"
      >
        {loading && (
          <p className="text-center text-sm text-gray-500">Caricamento…</p>
        )}
        {!loading && hasMore && (
          <div className="mb-2 text-center">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="rounded-full bg-white/80 px-4 py-1.5 text-sm font-medium text-wa-teal shadow-sm hover:bg-white disabled:opacity-60"
            >
              {loadingMore ? "Caricamento…" : "Carica messaggi precedenti"}
            </button>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onReply={canSendFreeform ? setReplyTo : undefined}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <MessageComposer
        waId={conversation.waId}
        canSendFreeform={canSendFreeform}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />
    </section>
  );
}
