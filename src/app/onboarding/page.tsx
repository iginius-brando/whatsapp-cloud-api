"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import EmbeddedSignupButton from "@/components/EmbeddedSignupButton";
import { useAuth } from "@/context/AuthContext";
import type { WhatsAppTenant } from "@/lib/types";

interface SignupConfig {
  appId: boolean;
  appSecret: boolean;
  configId: boolean;
  tokenEncryption: boolean;
  graphVersion: string;
}

const requisiti = [
  "App Meta di tipo Business con il prodotto WhatsApp e la verifica business completata.",
  "Accesso avanzato ai permessi whatsapp_business_management, whatsapp_business_messaging e business_management.",
  "Configurazione di Facebook Login for Business con variante Embedded Signup: il suo ID va in NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID.",
  "Dominio dell'app fra quelli consentiti nelle impostazioni del Facebook Login.",
  "Webhook configurato a livello di app (non sul singolo numero): l'iscrizione per cliente la fa questo pannello.",
];

export default function OnboardingPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tenants, setTenants] = useState<WhatsAppTenant[]>([]);
  const [config, setConfig] = useState<SignupConfig | null>(null);
  const [loading, setLoading] = useState(true);
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
      const response = await fetch("/api/whatsapp/embedded-signup", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Elenco non disponibile");
      setTenants(data.tenants ?? []);
      setConfig(data.config ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Elenco non disponibile");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => void load(), [load]);

  if (authLoading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-wa-panel text-wa-teal">
        Caricamento…
      </div>
    );
  }

  const configReady = Boolean(
    config?.appId && config?.appSecret && config?.configId,
  );

  return (
    <main className="min-h-dvh bg-[#f5f7f7] px-4 py-7 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-wa-teal">
              Tech provider
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              Onboarding clienti
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">
              Con l&apos;Embedded Signup il cliente collega il proprio numero
              WhatsApp senza uscire da qui: al termine la nostra app viene iscritta
              ai suoi webhook e il numero registrato sulla Cloud API.
            </p>
          </div>
          <Link
            href="/chat"
            className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-gray-700 shadow-sm transition hover:border-wa-teal hover:text-wa-teal"
          >
            Torna alla chat
          </Link>
        </header>

        {error && (
          <p className="mb-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-5 sm:px-7">
            <h2 className="text-lg font-bold text-gray-900">Collega un cliente</h2>
            <p className="mt-1 text-sm text-gray-500">
              Apri il flusso di Meta insieme al cliente: sceglierà il proprio
              business, la WABA e il numero da usare.
            </p>
          </div>
          <div className="px-5 py-5 sm:px-7">
            {loading ? (
              <p className="text-sm text-gray-500">Caricamento…</p>
            ) : (
              <EmbeddedSignupButton
                configReady={configReady}
                onConnected={() => void load()}
              />
            )}

            {config && (
              <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
                <ConfigRow label="App ID" ok={config.appId} />
                <ConfigRow label="App secret" ok={config.appSecret} />
                <ConfigRow label="Configuration ID" ok={config.configId} />
                <ConfigRow
                  label="Token dei clienti cifrati"
                  ok={config.tokenEncryption}
                  optionalHint="WHATSAPP_TENANT_TOKEN_SECRET non impostato"
                />
              </dl>
            )}
          </div>
        </section>

        <section className="mt-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-5 sm:px-7">
            <h2 className="text-lg font-bold text-gray-900">Clienti collegati</h2>
            <p className="mt-1 text-sm text-gray-500">
              Una riga per WABA condivisa con la nostra app.
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            {tenants.length === 0 && (
              <p className="px-5 py-7 text-center text-sm text-gray-500">
                Nessun cliente collegato.
              </p>
            )}
            {tenants.map((tenant) => (
              <article key={tenant.wabaId} className="px-5 py-5 sm:px-7">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-gray-900">
                    {tenant.name || tenant.wabaId}
                  </h3>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      tenant.status === "connected"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-800"
                    }`}
                  >
                    {tenant.status === "connected" ? "Collegato" : "Da completare"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  WABA {tenant.wabaId}
                  {tenant.accountReviewStatus
                    ? ` · revisione ${tenant.accountReviewStatus}`
                    : ""}
                  {tenant.tokenExpiresAt
                    ? ` · token fino al ${new Date(tenant.tokenExpiresAt).toLocaleDateString("it-IT")}`
                    : " · token senza scadenza"}
                </p>
                <ul className="mt-3 space-y-1 text-sm text-gray-600">
                  {(tenant.phoneNumbers ?? []).map((number) => (
                    <li key={number.id}>
                      <span className="font-medium text-gray-800">
                        {number.displayPhoneNumber || number.id}
                      </span>
                      {number.verifiedName ? ` · ${number.verifiedName}` : ""}
                      {number.qualityRating ? ` · qualità ${number.qualityRating}` : ""}
                      {number.id === tenant.defaultPhoneNumberId
                        ? " · scelto nel signup"
                        : ""}
                    </li>
                  ))}
                  {(tenant.phoneNumbers ?? []).length === 0 && (
                    <li className="text-gray-500">Nessun numero letto dalla WABA.</li>
                  )}
                </ul>
                {tenant.steps?.some((step) => !step.ok) && (
                  <ul className="mt-3 space-y-1 text-xs text-amber-800">
                    {tenant.steps
                      .filter((step) => !step.ok)
                      .map((step) => (
                        <li key={step.id}>
                          {step.label}: {step.detail}
                        </li>
                      ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-lg font-bold text-gray-900">
            Cosa serve dal lato Meta
          </h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-gray-600">
            {requisiti.map((requisito) => (
              <li key={requisito}>{requisito}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-gray-500">
            Versione Graph API in uso: {config?.graphVersion ?? "—"}.
          </p>
        </section>
      </div>
    </main>
  );
}

function ConfigRow({
  label,
  ok,
  optionalHint,
}: {
  label: string;
  ok: boolean;
  optionalHint?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3">
      <dt className="text-gray-700">{label}</dt>
      <dd
        className={`text-xs font-semibold ${ok ? "text-emerald-700" : "text-amber-700"}`}
        title={ok ? undefined : optionalHint}
      >
        {ok ? "presente" : "mancante"}
      </dd>
    </div>
  );
}
