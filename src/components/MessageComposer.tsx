"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import TemplateMessagePanel from "./TemplateMessagePanel";

interface Props {
  waId: string;
  /** True se siamo entro la finestra di 24h e si possono inviare messaggi liberi. */
  canSendFreeform: boolean;
}

export default function MessageComposer({ waId, canSendFreeform }: Props) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendingFlow, setSendingFlow] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
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

  /** Invia il messaggio interattivo che apre il Flow di prenotazione. */
  async function sendFlow() {
    if (sendingFlow || !user) return;

    setSendingFlow(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/whatsapp/send-flow", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ to: waId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Invio del modulo non riuscito");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore di invio");
    } finally {
      setSendingFlow(false);
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

  return (
    <div className="border-t bg-wa-panel px-3 py-2.5">
      {error && <p className="mb-1 px-1 text-xs text-red-600">{error}</p>}

      {!canSendFreeform && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-800">
          Sono passate più di 24 ore dall&apos;ultimo messaggio del cliente: usa un
          template approvato per ricontattarlo.
        </p>
      )}

      {showTemplates || !canSendFreeform ? (
        <div className="mb-2">
          <TemplateMessagePanel
            waId={waId}
            onSent={() => setShowTemplates(false)}
          />
        </div>
      ) : null}

      {canSendFreeform && (
        <form onSubmit={handleSubmit}>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => setShowTemplates((current) => !current)}
              title="Invia un messaggio template"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-500 transition hover:bg-black/5 hover:text-wa-teal disabled:opacity-50"
              aria-label="Invia messaggio template"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 4v2h16V8H4zm0 4v2h10v-2H4zm0 4v2h7v-2H4z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => void sendFlow()}
              disabled={sendingFlow}
              title="Invia il modulo di prenotazione"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-500 transition hover:bg-black/5 hover:text-wa-teal disabled:opacity-50"
              aria-label="Invia modulo di prenotazione"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 13h8v2H8v-2zm0 4h8v2H8v-2z" />
              </svg>
            </button>
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
      )}
    </div>
  );
}
