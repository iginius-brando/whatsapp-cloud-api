"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useAuth } from "@/context/AuthContext";
import { messagePreview } from "@/lib/format";
import { FILE_ACCEPT } from "@/lib/media";
import type { ChatMessage } from "@/lib/types";
import AttachmentComposer from "./AttachmentComposer";
import TemplateMessagePanel from "./TemplateMessagePanel";

interface Props {
  waId: string;
  /** True se siamo entro la finestra di 24h e si possono inviare messaggi liberi. */
  canSendFreeform: boolean;
  /** Messaggio che si sta citando, scelto con "Rispondi" su una bolla. */
  replyTo?: ChatMessage | null;
  onCancelReply?: () => void;
}

/** Voci del menu della graffetta: ognuna filtra il selettore file. */
const ATTACH_OPTIONS = [
  {
    key: "media",
    label: "Foto e video",
    accept: FILE_ACCEPT.media,
    path: "M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z",
  },
  {
    key: "audio",
    label: "Audio",
    accept: FILE_ACCEPT.audio,
    path: "M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z",
  },
  {
    key: "document",
    label: "Documento",
    accept: FILE_ACCEPT.document,
    path: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 2.5L18.5 9H14V4.5z",
  },
] as const;

export default function MessageComposer({
  waId,
  canSendFreeform,
  replyTo,
  onCancelReply,
}: Props) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Chi clicca "Rispondi" vuole scrivere subito.
  useEffect(() => {
    if (replyTo && !attachment) textareaRef.current?.focus();
  }, [replyTo, attachment]);

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
        body: JSON.stringify({
          to: waId,
          text: body,
          ...(replyTo ? { replyTo: replyTo.id } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Invio non riuscito");
      }
      setText("");
      onCancelReply?.();
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

  /** Apre il selettore file con il filtro della voce di menu scelta. */
  function pickFile(accept: string) {
    setShowAttachMenu(false);
    const input = fileInputRef.current;
    if (!input) return;

    input.accept = accept;
    input.value = "";
    input.click();
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setError(null);
      setAttachment(file);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (!canSendFreeform) return;

    const file = e.dataTransfer.files?.[0];
    if (file) {
      setError(null);
      setAttachment(file);
    }
  }

  /** Incolla uno screenshot direttamente dagli appunti. */
  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const file = e.clipboardData.files?.[0];
    if (file) {
      e.preventDefault();
      setError(null);
      setAttachment(file);
    }
  }

  return (
    <div
      onDragOver={(e) => {
        if (!canSendFreeform) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        // Il dragleave scatta anche passando sui figli: ignoriamo quei casi.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={handleDrop}
      className={`relative shrink-0 border-t bg-wa-panel px-2 py-2.5 sm:px-3 ${
        dragging ? "ring-2 ring-inset ring-wa-teal" : ""
      }`}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-wa-panel/90 text-sm font-medium text-wa-teal">
          Rilascia il file per allegarlo
        </div>
      )}

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

      {canSendFreeform && replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border-l-4 border-wa-teal bg-white px-2.5 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-wa-teal">
              Risposta {replyTo.direction === "out" ? "a un tuo messaggio" : "al cliente"}
            </p>
            <p className="truncate text-xs text-gray-600">
              {messagePreview(replyTo)}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Annulla la risposta"
            className="shrink-0 text-gray-400 transition hover:text-gray-700"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
      )}

      {canSendFreeform && attachment && (
        <div className="mb-2">
          <AttachmentComposer
            waId={waId}
            file={attachment}
            replyToMessageId={replyTo?.id}
            onCancel={() => setAttachment(null)}
            onSent={() => {
              setAttachment(null);
              onCancelReply?.();
            }}
          />
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />

      {canSendFreeform && !attachment && (
        <form onSubmit={handleSubmit}>
          <div className="flex min-w-0 items-end gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => {
                // I template non portano con sé la citazione: meglio scartarla
                // subito che farla sparire in silenzio all'invio.
                if (!showTemplates) onCancelReply?.();
                setShowTemplates((current) => !current);
              }}
              title="Invia un messaggio template"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-500 transition hover:bg-black/5 hover:text-wa-teal disabled:opacity-50"
              aria-label="Invia messaggio template"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 4v2h16V8H4zm0 4v2h10v-2H4zm0 4v2h7v-2H4z" />
              </svg>
            </button>

            <div className="relative shrink-0">
              {showAttachMenu && (
                <>
                  {/* Chiude il menu al primo clic fuori. */}
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden
                    onClick={() => setShowAttachMenu(false)}
                    className="fixed inset-0 z-10 cursor-default"
                  />
                  <div className="absolute bottom-12 left-0 z-20 w-48 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                    {ATTACH_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => pickFile(option.accept)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-gray-700 transition hover:bg-wa-panel"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-5 w-5 text-wa-teal"
                          fill="currentColor"
                        >
                          <path d={option.path} />
                        </svg>
                        {option.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={() => setShowAttachMenu((current) => !current)}
                title="Allega un file"
                aria-label="Allega un file"
                aria-expanded={showAttachMenu}
                className="flex h-11 w-11 items-center justify-center rounded-full text-gray-500 transition hover:bg-black/5 hover:text-wa-teal"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                  <path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z" />
                </svg>
              </button>
            </div>

            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Scrivi un messaggio"
              className="max-h-32 min-w-0 flex-1 resize-none rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-wa-teal thin-scroll sm:px-4"
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
