"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import type { SecuritySettings } from "@/lib/types";

const defaults: SecuritySettings = {
  twoFactorEnabled: false,
  accessLogsEnabled: false,
  adminAuditEnabled: false,
};

type AccessLog = { id: string; email: string; date: string; status: string };
type AuditLog = { id: string; action: string; actorEmail: string; createdAt: string | null };

const options: Array<{
  key: keyof Pick<SecuritySettings, "twoFactorEnabled" | "accessLogsEnabled" | "adminAuditEnabled">;
  title: string;
  description: string;
  icon: string;
}> = [
  {
    key: "twoFactorEnabled",
    title: "Autenticazione a due fattori (2FA)",
    description: "Aggiunge un secondo livello di verifica all'accesso degli operatori.",
    icon: "✦",
  },
  {
    key: "accessLogsEnabled",
    title: "Log accessi",
    description: "Mostra gli ultimi accessi degli utenti e il relativo esito.",
    icon: "↪",
  },
  {
    key: "adminAuditEnabled",
    title: "Audit Admin",
    description: "Registra le modifiche amministrative per garantire tracciabilità.",
    icon: "✓",
  },
];

export default function SecurityPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [settings, setSettings] = useState(defaults);
  const [accessLogs, setAccessLogs] = useState<AccessLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, router, user]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/settings/security", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Impostazioni non disponibili");
      setSettings({ ...defaults, ...data.settings });
      setAccessLogs(data.accessLogs ?? []);
      setAuditLogs(data.auditLogs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impostazioni non disponibili");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => void load(), [load]);

  async function save() {
    if (!user) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/settings/security", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Salvataggio non riuscito");
      setMessage("Impostazioni di sicurezza salvate.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Salvataggio non riuscito");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || !user) {
    return <div className="flex min-h-dvh items-center justify-center bg-wa-panel text-wa-teal">Caricamento…</div>;
  }

  return (
    <main className="min-h-dvh bg-[#f5f7f7] px-4 py-7 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-wa-teal">Impostazioni</p>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">Sicurezza</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">
              Proteggi l&apos;account e controlla le attività sensibili. Tutte le funzionalità sono facoltative.
            </p>
          </div>
          <Link href="/chat" className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-gray-700 shadow-sm transition hover:border-wa-teal hover:text-wa-teal">
            Torna alla chat
          </Link>
        </header>

        {(message || error) && (
          <p className={`mb-5 rounded-xl px-4 py-3 text-sm ${error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{error || message}</p>
        )}

        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-5 sm:px-7">
            <h2 className="text-lg font-bold text-gray-900">Protezione account</h2>
            <p className="mt-1 text-sm text-gray-500">Scegli quali controlli attivare per la tua organizzazione.</p>
          </div>
          <div className="divide-y divide-gray-100">
            {options.map((option) => (
              <div key={option.key} className="flex items-center gap-4 px-5 py-5 sm:px-7">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-xl font-bold text-wa-teal" aria-hidden="true">{option.icon}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-gray-900">{option.title}</h3>
                  <p className="mt-1 text-sm leading-5 text-gray-500">{option.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings[option.key]}
                  aria-label={`Abilita ${option.title}`}
                  disabled={loading || saving}
                  onClick={() => setSettings((current) => ({ ...current, [option.key]: !current[option.key] }))}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${settings[option.key] ? "bg-wa-teal" : "bg-gray-300"}`}
                >
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${settings[option.key] ? "left-6" : "left-1"}`} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex justify-end border-t border-gray-100 bg-gray-50/70 px-5 py-4 sm:px-7">
            <button type="button" onClick={() => void save()} disabled={loading || saving} className="rounded-xl bg-wa-teal px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-wa-dark disabled:opacity-50">
              {saving ? "Salvataggio…" : "Salva impostazioni"}
            </button>
          </div>
        </section>

        {settings.accessLogsEnabled && (
          <LogSection title="Ultimi accessi" subtitle="Accessi più recenti registrati da Firebase Authentication">
            {accessLogs.length ? accessLogs.map((log) => (
              <div key={log.id} className="grid gap-1 px-5 py-4 text-sm sm:grid-cols-[1fr_190px_110px] sm:items-center sm:px-7">
                <span className="font-medium text-gray-800">{log.email}</span>
                <span className="text-gray-500">{formatDate(log.date)}</span>
                <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${log.status === "Riuscito" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{log.status}</span>
              </div>
            )) : <Empty text="Nessun accesso registrato." />}
          </LogSection>
        )}

        {settings.adminAuditEnabled && (
          <LogSection title="Audit Admin" subtitle="Registro delle attività amministrative più recenti">
            {auditLogs.length ? auditLogs.map((log) => (
              <div key={log.id} className="grid gap-1 px-5 py-4 text-sm sm:grid-cols-[1fr_220px] sm:items-center sm:px-7">
                <div><p className="font-medium text-gray-800">{log.action}</p><p className="text-xs text-gray-500">{log.actorEmail || "Admin"}</p></div>
                <span className="text-gray-500 sm:text-right">{log.createdAt ? formatDate(log.createdAt) : "Poco fa"}</span>
              </div>
            )) : <Empty text="Nessuna attività amministrativa registrata." />}
          </LogSection>
        )}
      </div>
    </main>
  );
}

function LogSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="mt-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"><div className="border-b border-gray-100 px-5 py-5 sm:px-7"><h2 className="text-lg font-bold text-gray-900">{title}</h2><p className="mt-1 text-sm text-gray-500">{subtitle}</p></div><div className="divide-y divide-gray-100">{children}</div></section>;
}

function Empty({ text }: { text: string }) {
  return <p className="px-5 py-7 text-center text-sm text-gray-500">{text}</p>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
