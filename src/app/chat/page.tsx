"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useConversations } from "@/hooks/useChat";
import ChatList from "@/components/ChatList";
import ChatWindow from "@/components/ChatWindow";

export default function ChatPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { conversations, loading } = useConversations();
  const [selectedWaId, setSelectedWaId] = useState<string | null>(null);

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
    </div>
  );
}
