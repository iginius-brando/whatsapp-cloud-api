"use client";

import type { ChatMessage, MessageReply } from "@/lib/types";
import { formatTime, messagePreview } from "@/lib/format";
import { isMediaMessageType } from "@/lib/media";
import { useSwipeToReply } from "@/hooks/useSwipeToReply";
import MediaAttachment from "./MediaAttachment";

/** Freccia di risposta, usata sia dal bottone desktop che dall'indicatore. */
function ReplyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
    </svg>
  );
}

/**
 * Porta in vista il messaggio citato. Se è più vecchio della finestra caricata
 * dalla chat non c'è nulla da raggiungere: l'anteprima resta comunque leggibile.
 */
function scrollToMessage(messageId: string): void {
  const element = document.getElementById(`msg-${messageId}`);
  if (!element) return;

  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.classList.add("quote-flash");
  window.setTimeout(() => element.classList.remove("quote-flash"), 1200);
}

/** Blocco della citazione, sopra al contenuto della bolla. */
function QuotedMessage({ reply }: { reply: MessageReply }) {
  return (
    <button
      type="button"
      onClick={() => scrollToMessage(reply.id)}
      title="Vai al messaggio originale"
      className="mb-1 block w-full overflow-hidden rounded-md border-l-4 border-wa-teal bg-black/[0.06] px-2 py-1 text-left transition hover:bg-black/10"
    >
      <span className="block text-xs font-semibold text-wa-teal">
        {reply.direction === "out" ? "Tu" : "Cliente"}
      </span>
      <span className="block truncate text-xs text-gray-600">
        {messagePreview(reply)}
      </span>
    </button>
  );
}

/** Doppia spunta / stato di consegna per i messaggi in uscita. */
function StatusTicks({ status }: { status?: ChatMessage["status"] }) {
  if (status === "failed") {
    return <span className="text-red-500" title="Non consegnato">!</span>;
  }

  const isRead = status === "read";
  const isDelivered = status === "delivered" || isRead;
  const color = isRead ? "text-sky-500" : "text-gray-400";

  // Una spunta se solo inviato, doppia se consegnato/letto.
  return (
    <span className={color} title={status}>
      {isDelivered ? "✓✓" : "✓"}
    </span>
  );
}

/** Dati compilati dal cliente in un Flow, mostrati come coppie campo/valore. */
function FlowResponse({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(
    // flow_token è un dettaglio tecnico, non un campo del modulo.
    ([key, value]) => key !== "flow_token" && value !== "" && value != null,
  );

  if (entries.length === 0) return null;

  return (
    <dl className="mt-1.5 space-y-1 rounded-md bg-black/5 px-2 py-1.5 text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2">
          <dt className="shrink-0 text-gray-500">{key}</dt>
          <dd className="min-w-0 break-words font-medium text-gray-700">
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

interface Props {
  message: ChatMessage;
  /** Assente se la conversazione non accetta risposte (finestra 24h scaduta). */
  onReply?: (message: ChatMessage) => void;
}

export default function MessageBubble({ message, onReply }: Props) {
  const isOut = message.direction === "out";
  const hasAttachment =
    isMediaMessageType(message.type) && Boolean(message.media?.id);
  // Sui media `mediaCaption` è solo l'etichetta di ripiego ("[immagine]"):
  // ha senso mostrarla solo quando l'allegato non c'è.
  const content =
    message.text || (hasAttachment ? "" : message.mediaCaption) || "";
  const isFlowInvite = isOut && message.type === "interactive";

  const swipe = useSwipeToReply(onReply ? () => onReply(message) : undefined);

  // Col dito si trascina la bolla (vedi useSwipeToReply); col mouse quel gesto
  // serve a selezionare il testo, quindi su desktop resta il bottone.
  const replyButton = onReply ? (
    <button
      type="button"
      onClick={() => onReply(message)}
      title="Rispondi"
      aria-label="Rispondi a questo messaggio"
      className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 opacity-0 transition hover:bg-black/10 hover:text-wa-teal focus-visible:opacity-100 group-hover:opacity-100 md:flex"
    >
      <ReplyIcon className="h-4 w-4" />
    </button>
  ) : null;

  return (
    <div
      id={`msg-${message.id}`}
      {...swipe.handlers}
      className={`group flex touch-pan-y items-center gap-1 px-2 ${
        isOut ? "justify-end" : "justify-start"
      }`}
    >
      {isOut && replyButton}
      <div
        ref={swipe.contentRef}
        className={`relative my-0.5 max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm sm:max-w-[75%] ${
          isOut ? "bg-wa-bubbleOut" : "bg-wa-bubbleIn"
        }`}
      >
        {onReply && (
          <span
            ref={swipe.indicatorRef}
            aria-hidden
            className="pointer-events-none absolute -left-9 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/10 text-gray-600 opacity-0"
          >
            <ReplyIcon className="h-4 w-4" />
          </span>
        )}
        {message.replyTo && <QuotedMessage reply={message.replyTo} />}
        {hasAttachment && (
          <div className="mb-1 mt-0.5 overflow-hidden">
            <MediaAttachment message={message} />
          </div>
        )}
        {content && (
          <p className="whitespace-pre-wrap break-words pr-12 text-gray-800">
            {content}
          </p>
        )}
        {isFlowInvite && (
          <p className="mt-1 border-t border-black/10 pt-1 text-center text-xs font-medium text-wa-teal">
            Modulo inviato
          </p>
        )}
        {message.flowResponse && <FlowResponse data={message.flowResponse} />}
        <span className="float-right -mb-1 ml-2 mt-1 flex items-center gap-1 text-[10px] text-gray-500">
          {formatTime(message.timestamp)}
          {isOut && <StatusTicks status={message.status} />}
        </span>
      </div>
      {!isOut && replyButton}
    </div>
  );
}
