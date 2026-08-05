"use client";

import Link from "next/link";
import type { Conversation } from "@/lib/types";
import { formatListTimestamp, initialOf } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import ConnectionChecks from "./ConnectionChecks";

interface Props {
  conversations: Conversation[];
  loading: boolean;
  selectedWaId: string | null;
  onSelect: (waId: string) => void;
}

export default function ChatList({
  conversations,
  loading,
  selectedWaId,
  onSelect,
}: Props) {
  const { user, signOut } = useAuth();

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r bg-white md:w-[380px] md:max-w-[42vw]">
      {/* Header operatore */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-wa-panel px-3 py-3 sm:px-4">
        <div className="min-w-0 flex-1 flex items-center gap-2 truncate">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-wa-teal text-sm font-semibold text-white">
            {initialOf(user?.displayName || user?.email || undefined, "?")}
          </div>
          <span className="truncate text-sm font-medium text-gray-700">
            {user?.displayName || user?.email}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/guide"
            className="text-xs font-medium text-wa-teal hover:text-wa-dark"
          >
            Guida
          </Link>
          <button
            onClick={() => void signOut()}
            className="text-xs text-gray-500 hover:text-gray-800"
            title="Esci"
          >
            Esci
          </button>
        </div>
      </div>

      <ConnectionChecks />

      {/* Elenco conversazioni */}
      <div className="min-h-0 flex-1 overflow-y-auto thin-scroll">
        {loading && (
          <p className="p-4 text-center text-sm text-gray-400">Caricamento…</p>
        )}

        {!loading && conversations.length === 0 && (
          <div className="p-6 text-center text-sm text-gray-400">
            Nessuna conversazione. Le chat compariranno qui quando un cliente
            scriverà al tuo numero WhatsApp.
          </div>
        )}

        {conversations.map((c) => {
          const active = c.waId === selectedWaId;
          const unread = c.unreadCount ?? 0;
          return (
            <button
              key={c.waId}
              onClick={() => onSelect(c.waId)}
              className={`flex w-full items-center gap-3 border-b border-gray-100 px-4 py-3 text-left transition hover:bg-gray-50 ${
                active ? "bg-gray-100" : ""
              }`}
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-wa-teal text-lg font-semibold text-white">
                {initialOf(c.name, c.waId)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium text-gray-800">
                    {c.name || `+${c.waId}`}
                  </span>
                  <span className="shrink-0 text-[11px] text-gray-400">
                    {formatListTimestamp(c.lastMessageAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-gray-500">
                    {c.lastMessageDirection === "out" && "Tu: "}
                    {c.lastMessage}
                  </span>
                  {unread > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-wa-green px-1.5 text-[11px] font-semibold text-white">
                      {unread}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
