"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useAuth } from "@/context/AuthContext";

interface Props {
  waId: string;
  /** True se siamo entro la finestra di 24h e si possono inviare messaggi liberi. */
  canSendFreeform: boolean;
}

export default function MessageComposer({ waId, canSendFreeform }: Props) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const body = text.trim();
    if (!body || sending || !user) return;

    setSending(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ to: waId, text: body }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Invio non riuscito");
      }
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore di invio");
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  if (!canSendFreeform) {
    return (
      <div className="border-t bg-wa-panel px-4 py-3 text-center text-xs text-gray-500">
        Sono passate più di 24 ore dall&apos;ultimo messaggio del cliente. Per la
        policy di WhatsApp puoi ricontattarlo solo con un{" "}
        <span className="font-medium">modello approvato</span>, non con testo
        libero.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border-t bg-wa-panel px-3 py-2.5">
      {error && (
        <p className="mb-1 px-1 text-xs text-red-600">{error}</p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Scrivi un messaggio"
          className="max-h-32 flex-1 resize-none rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-wa-teal thin-scroll"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-wa-teal text-white transition hover:bg-wa-dark disabled:opacity-50"
          aria-label="Invia"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </form>
  );
}
