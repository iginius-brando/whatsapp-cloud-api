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

export default function MessageBubble({ message }: { message: ChatMessage }) {
  const isOut = message.direction === "out";
  const content = message.text || message.mediaCaption || "";

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
        <span className="float-right -mb-1 ml-2 mt-1 flex items-center gap-1 text-[10px] text-gray-500">
          {formatTime(message.timestamp)}
          {isOut && <StatusTicks status={message.status} />}
        </span>
      </div>
    </div>
  );
}
