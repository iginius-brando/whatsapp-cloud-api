"use client";

import { useEffect, useRef } from "react";
import type { Conversation } from "@/lib/types";
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
  const { messages, loading } = useMessages(waId);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll all'ultimo messaggio a ogni aggiornamento.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Azzera i non letti all'apertura della chat.
  useEffect(() => {
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
    <section className="flex h-full flex-1 flex-col">
      {/* Header conversazione */}
      <header className="flex items-center gap-3 border-b bg-wa-panel px-3 py-2.5">
        <button
          onClick={onBack}
          className="text-gray-500 hover:text-gray-800 md:hidden"
          aria-label="Indietro"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
          </svg>
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-wa-teal font-semibold text-white">
          {initialOf(conversation.name, conversation.waId)}
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium text-gray-800">
            {conversation.name || formatPhone(conversation.waId)}
          </p>
          <p className="truncate text-xs text-gray-500">
            {formatPhone(conversation.waId)}
          </p>
        </div>
      </header>

      {/* Messaggi */}
      <div className="chat-bg flex-1 overflow-y-auto py-3 thin-scroll">
        {loading && (
          <p className="text-center text-sm text-gray-500">Caricamento…</p>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <MessageComposer waId={conversation.waId} canSendFreeform={canSendFreeform} />
    </section>
  );
}
