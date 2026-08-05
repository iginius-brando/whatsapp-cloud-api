"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

interface ManagedUser {
  uid: string;
  email: string;
  displayName: string;
  disabled: boolean;
  admin: boolean;
}

export default function UsersPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [makeAdmin, setMakeAdmin] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const loadUsers = useCallback(async (currentUser = user) => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const idToken = await currentUser.getIdToken();
      const res = await fetch("/api/users", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Utenti non caricati");
      }
      setUsers(data.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Utenti non caricati");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) void loadUsers(user);
  }, [user, loadUsers]);

  async function createUser(e: FormEvent) {
    e.preventDefault();
    if (!user || saving) return;

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ email, password, displayName, admin: makeAdmin }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Creazione utente non riuscita");
      }
      setEmail("");
      setDisplayName("");
      setPassword("");
      setMakeAdmin(false);
      setSuccess("Utente creato correttamente.");
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creazione utente non riuscita");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || !user) {
    return <div className="flex min-h-dvh items-center justify-center bg-wa-panel text-wa-teal">Caricamento…</div>;
  }

  return (
    <main className="min-h-dvh bg-wa-panel p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-wa-teal">Area admin</p>
            <h1 className="text-2xl font-semibold text-gray-800">Gestione utenti</h1>
            <p className="text-sm text-gray-500">L&apos;app è chiusa: solo gli admin possono creare nuovi account.</p>
          </div>
          <Link href="/chat" className="rounded-full border border-wa-teal/30 bg-white px-4 py-2 text-sm font-semibold text-wa-teal shadow-sm transition hover:border-wa-teal hover:bg-wa-teal hover:text-white">
            Torna alla chat
          </Link>
        </div>

        {(error || success) && (
          <p className={`rounded-xl px-4 py-3 text-sm ${error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
            {error || success}
          </p>
        )}

        <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <form onSubmit={createUser} className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-800">Crea nuovo utente</h2>
            <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-wa-teal" />
            <input placeholder="Nome visualizzato" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-wa-teal" />
            <input type="password" required minLength={6} placeholder="Password temporanea" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-wa-teal" />
            <label className="flex items-center gap-2 rounded-xl bg-wa-panel/70 px-3 py-2 text-sm text-gray-700">
              <input type="checkbox" checked={makeAdmin} onChange={(e) => setMakeAdmin(e.target.checked)} className="h-4 w-4 accent-wa-teal" />
              Rendi questo utente admin
            </label>
            <button type="submit" disabled={saving} className="w-full rounded-xl bg-wa-teal px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-wa-dark disabled:opacity-60">
              {saving ? "Creazione…" : "Crea utente"}
            </button>
          </form>

          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="border-b px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-800">Utenti abilitati</h2>
            </div>
            {loading ? (
              <p className="p-5 text-sm text-gray-500">Caricamento…</p>
            ) : (
              <div className="divide-y">
                {users.map((managedUser) => (
                  <div key={managedUser.uid} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div>
                      <p className="font-medium text-gray-800">{managedUser.displayName || managedUser.email}</p>
                      <p className="text-xs text-gray-500">{managedUser.email}</p>
                    </div>
                    <div className="flex gap-2">
                      {managedUser.admin && <span className="rounded-full bg-wa-teal/10 px-2.5 py-1 text-xs font-semibold text-wa-teal">Admin</span>}
                      {managedUser.disabled && <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">Disabilitato</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
