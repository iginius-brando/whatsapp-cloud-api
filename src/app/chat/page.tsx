"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useConversations } from "@/hooks/useChat";
import ChatList from "@/components/ChatList";
import ChatWindow from "@/components/ChatWindow";
import ConnectionChecks from "@/components/ConnectionChecks";

export default function ChatPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { conversations, loading } = useConversations();
  const [selectedWaId, setSelectedWaId] = useState<string | null>(null);
  const [showChecks, setShowChecks] = useState(false);

  // Protezione rotta: senza login torna alla pagina di accesso.
  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const selected = useMemo(
    () => conversations.find((c) => c.waId === selectedWaId) ?? null,
    [conversations, selectedWaId],
  );

  if (authLoading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-wa-panel text-wa-teal">
        Caricamento…
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-white">
      {/* Su mobile mostriamo lista o conversazione, non entrambe. */}
      <div className={`${selected ? "hidden md:flex" : "flex"} h-full min-h-0 w-full md:w-auto`}>
        <ChatList
          conversations={conversations}
          loading={loading}
          selectedWaId={selectedWaId}
          onSelect={setSelectedWaId}
          onOpenChecks={() => setShowChecks(true)}
        />
      </div>

      <div
        className={`${selected ? "flex" : "hidden md:flex"} h-full min-h-0 min-w-0 flex-1`}
      >
        <ChatWindow
          conversation={selected}
          onBack={() => setSelectedWaId(null)}
        />
      </div>

      {showChecks && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Check collegamenti</h2>
                <p className="text-sm text-gray-500">Verifica numero WhatsApp, webhook e flow quando serve.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowChecks(false)}
                className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                aria-label="Chiudi check collegamenti"
              >
                ✕
              </button>
            </div>
            <ConnectionChecks />
          </div>
        </div>
      )}
    </div>
  );
}
