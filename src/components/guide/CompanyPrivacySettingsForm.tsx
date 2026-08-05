"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getClientAuth } from "@/lib/firebase/client";
import type { CompanyPrivacySettings } from "@/lib/types";

const emptySettings: CompanyPrivacySettings = {
  companyName: "",
  legalAddress: "",
  privacyEmail: "",
  retentionPeriod: "",
};

export default function CompanyPrivacySettingsForm() {
  const [settings, setSettings] = useState<CompanyPrivacySettings>(emptySettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSettings() {
      try {
        const token = await getClientAuth().currentUser?.getIdToken();
        if (!token) throw new Error("Sessione operatore non valida");

        const res = await fetch("/api/settings/company", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Caricamento non riuscito");
        setSettings({ ...emptySettings, ...data });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Caricamento non riuscito");
      } finally {
        setLoading(false);
      }
    }

    void loadSettings();
  }, []);

  function updateField(key: keyof CompanyPrivacySettings, value: string) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const token = await getClientAuth().currentUser?.getIdToken();
      if (!token) throw new Error("Sessione operatore non valida");

      const res = await fetch("/api/settings/company", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Salvataggio non riuscito");
      setSettings({ ...emptySettings, ...data });
      setMessage("Dati salvati. Ora sono visibili sulla pagina /privacy.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Salvataggio non riuscito");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-wa-teal">Dati privacy azienda</p>
          <h2 className="text-xl font-semibold text-gray-900">
            Compila i dati mostrati su /privacy
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Questi campi sostituiscono i placeholder della privacy policy
            pubblica. Puoi aggiornarli prima di inviare l&apos;app a Meta.
          </p>
        </div>
        <a
          href="/privacy"
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-gray-200 px-4 py-2 text-center text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Apri /privacy
        </a>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium text-gray-700">
          Nome azienda / titolare
          <input
            value={settings.companyName ?? ""}
            onChange={(e) => updateField("companyName", e.target.value)}
            placeholder="Es. Acme S.r.l."
            disabled={loading || saving}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-wa-teal disabled:bg-gray-50"
          />
        </label>
        <label className="text-sm font-medium text-gray-700">
          Email privacy
          <input
            type="email"
            value={settings.privacyEmail ?? ""}
            onChange={(e) => updateField("privacyEmail", e.target.value)}
            placeholder="privacy@azienda.it"
            disabled={loading || saving}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-wa-teal disabled:bg-gray-50"
          />
        </label>
        <label className="text-sm font-medium text-gray-700 md:col-span-2">
          Indirizzo / sede legale
          <input
            value={settings.legalAddress ?? ""}
            onChange={(e) => updateField("legalAddress", e.target.value)}
            placeholder="Via, città, CAP, Paese"
            disabled={loading || saving}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-wa-teal disabled:bg-gray-50"
          />
        </label>
        <label className="text-sm font-medium text-gray-700 md:col-span-2">
          Periodo di conservazione
          <textarea
            value={settings.retentionPeriod ?? ""}
            onChange={(e) => updateField("retentionPeriod", e.target.value)}
            placeholder="Es. conserviamo le conversazioni per 24 mesi, salvo obblighi di legge."
            disabled={loading || saving}
            rows={3}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-wa-teal disabled:bg-gray-50"
          />
        </label>

        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={loading || saving}
            className="rounded-lg bg-wa-teal px-5 py-2.5 text-sm font-medium text-white transition hover:bg-wa-dark disabled:opacity-60"
          >
            {saving ? "Salvataggio…" : "Salva dati privacy"}
          </button>
          {message && <p className="mt-3 text-sm text-green-700">{message}</p>}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>
      </form>
    </section>
  );
}
