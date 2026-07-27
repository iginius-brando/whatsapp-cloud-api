"use client";

import type { ChatMessage } from "@/lib/types";
import { formatTime } from "@/lib/format";

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

export default function MessageBubble({ message }: { message: ChatMessage }) {
  const isOut = message.direction === "out";
  const content = message.text || message.mediaCaption || "";
  const isFlowInvite = isOut && message.type === "interactive";

  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"} px-2`}>
      <div
        className={`relative my-0.5 max-w-[75%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm ${
          isOut ? "bg-wa-bubbleOut" : "bg-wa-bubbleIn"
        }`}
      >
        <p className="whitespace-pre-wrap break-words pr-12 text-gray-800">
          {content}
        </p>
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
    </div>
  );
}
