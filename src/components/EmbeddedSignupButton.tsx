"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { getClientAuth } from "@/lib/firebase/client";
import type { OnboardingStep, WhatsAppTenant } from "@/lib/types";

/**
 * Bottone che apre l'Embedded Signup di Meta.
 *
 * Il flusso restituisce due cose per due strade diverse:
 *
 * - la finestra di Meta manda un `postMessage` di tipo `WA_EMBEDDED_SIGNUP` con
 *   la WABA e il numero scelti dal cliente;
 * - la callback di `FB.login` restituisce un `code` da spendere lato server.
 *
 * Le due cose arrivano in momenti distinti (di norma il messaggio prima della
 * callback), quindi le informazioni di sessione vengono parcheggiate in un ref e
 * la callback le attende brevemente prima di chiamare la nostra API.
 */

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID ?? "";
const CONFIG_ID = process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID ?? "";
const SDK_VERSION = process.env.NEXT_PUBLIC_META_GRAPH_API_VERSION || "v22.0";
/**
 * Versione delle informazioni di sessione richieste nel flusso. Le
 * configurazioni v4 spostano ogni scelta nella configurazione di Facebook Login
 * for Business e vogliono un `extras` vuoto: in quel caso si imposta il valore
 * "none" e il campo non viene inviato.
 */
const SESSION_INFO_VERSION =
  process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_SESSION_INFO_VERSION ?? "3";
/** Es. "whatsapp_business_app_onboarding" per la coesistenza. Vuoto = standard. */
const FEATURE_TYPE =
  process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_FEATURE_TYPE ?? "";

interface FbLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}

declare global {
  interface Window {
    FB?: {
      init: (params: Record<string, unknown>) => void;
      login: (
        callback: (response: FbLoginResponse) => void,
        params: Record<string, unknown>,
      ) => void;
    };
  }
}

interface SignupSessionInfo {
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
  /** FINISH, CANCEL, ERROR o una delle varianti FINISH_* del flusso. */
  event?: string;
  /** Passo in cui il cliente ha abbandonato, sugli eventi CANCEL. */
  currentStep?: string;
  errorMessage?: string;
}

type Status = "idle" | "running" | "saving" | "done" | "error";

interface Props {
  /** Chiamata a onboarding riuscito, per ricaricare l'elenco dei clienti. */
  onConnected?: () => void;
  /** True se App ID, App secret e Configuration ID sono configurati. */
  configReady: boolean;
}

const FACEBOOK_ORIGINS = [
  "https://www.facebook.com",
  "https://web.facebook.com",
  "https://business.facebook.com",
];

function parseSessionInfo(raw: unknown): SignupSessionInfo | null {
  if (typeof raw !== "string") return null;

  let payload: {
    type?: string;
    event?: string;
    data?: Record<string, unknown>;
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    // Sul canale arrivano anche messaggi non JSON di altri script di Meta.
    return null;
  }

  if (payload?.type !== "WA_EMBEDDED_SIGNUP") return null;

  const data = payload.data ?? {};
  return {
    event: payload.event,
    wabaId: typeof data.waba_id === "string" ? data.waba_id : undefined,
    phoneNumberId:
      typeof data.phone_number_id === "string" ? data.phone_number_id : undefined,
    businessId:
      typeof data.business_id === "string" ? data.business_id : undefined,
    currentStep:
      typeof data.current_step === "string" ? data.current_step : undefined,
    errorMessage:
      typeof data.error_message === "string" ? data.error_message : undefined,
  };
}

export default function EmbeddedSignupButton({ onConnected, configReady }: Props) {
  const [sdkReady, setSdkReady] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [tenant, setTenant] = useState<WhatsAppTenant | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionInfo = useRef<SignupSessionInfo | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!FACEBOOK_ORIGINS.includes(event.origin)) return;
      const info = parseSessionInfo(event.data);
      if (info) sessionInfo.current = info;
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const initSdk = useCallback(() => {
    if (!window.FB || !APP_ID) return;
    window.FB.init({
      appId: APP_ID,
      cookie: true,
      xfbml: false,
      version: SDK_VERSION,
    });
    setSdkReady(true);
  }, []);

  /**
   * Le informazioni di sessione arrivano su un canale asincrono: se la callback
   * di FB.login le precede, le aspettiamo qualche decimo di secondo invece di
   * fallire. Oltre l'attesa proseguiamo comunque: la WABA si può ricavare dai
   * permessi del token, lato server.
   */
  async function waitForSessionInfo(timeoutMs = 3_000) {
    const deadline = Date.now() + timeoutMs;
    while (!sessionInfo.current?.wabaId && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return sessionInfo.current;
  }

  async function submit(code: string) {
    const info = await waitForSessionInfo();
    setStatus("saving");

    const idToken = await getClientAuth().currentUser?.getIdToken();
    if (!idToken) throw new Error("Sessione operatore non valida");

    const res = await fetch("/api/whatsapp/embedded-signup", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code,
        wabaId: info?.wabaId,
        phoneNumberId: info?.phoneNumberId,
        businessId: info?.businessId,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Onboarding non riuscito");

    setSteps(data.steps ?? []);
    setTenant(data.tenant ?? null);
    setPin(typeof data.pin === "string" ? data.pin : null);
    setStatus("done");
    onConnected?.();
  }

  function launch() {
    if (!window.FB) {
      setStatus("error");
      setError("SDK di Facebook non caricato: ricarica la pagina");
      return;
    }

    sessionInfo.current = null;
    setSteps([]);
    setTenant(null);
    setPin(null);
    setError(null);
    setStatus("running");

    const extras: Record<string, unknown> = { setup: {} };
    if (FEATURE_TYPE) extras.featureType = FEATURE_TYPE;
    if (SESSION_INFO_VERSION && SESSION_INFO_VERSION !== "none") {
      extras.sessionInfoVersion = SESSION_INFO_VERSION;
    }

    window.FB.login(
      (response) => {
        const code = response?.authResponse?.code;

        if (!code) {
          const info = sessionInfo.current;
          setStatus("error");
          setError(
            info?.errorMessage ||
              (info?.currentStep
                ? `Flusso interrotto al passo "${info.currentStep}"`
                : "Il cliente ha annullato l'Embedded Signup"),
          );
          return;
        }

        submit(code).catch((err: unknown) => {
          setStatus("error");
          setError(err instanceof Error ? err.message : "Onboarding non riuscito");
        });
      },
      {
        config_id: CONFIG_ID,
        response_type: "code",
        // Senza questo FB.login restituirebbe un access token lato browser: a
        // noi serve il code, da spendere lato server con l'app secret.
        override_default_response_type: true,
        extras,
      },
    );
  }

  const busy = status === "running" || status === "saving";

  return (
    <>
      <Script
        src="https://connect.facebook.net/it_IT/sdk.js"
        strategy="afterInteractive"
        crossOrigin="anonymous"
        onLoad={initSdk}
      />

      {!configReady && (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Configurazione incompleta: servono <code>META_APP_ID</code>,{" "}
          <code>META_APP_SECRET</code> e{" "}
          <code>NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID</code>. Il bottone
          resta disattivato finché non sono impostati.
        </p>
      )}

      <button
        type="button"
        onClick={launch}
        disabled={!configReady || !sdkReady || busy}
        className="rounded-xl bg-wa-teal px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-wa-dark disabled:opacity-50"
      >
        {status === "running"
          ? "Flusso Meta aperto…"
          : status === "saving"
            ? "Configurazione in corso…"
            : "Collega un cliente WhatsApp"}
      </button>

      {!sdkReady && configReady && (
        <p className="mt-2 text-xs text-gray-500">Caricamento dell&apos;SDK Meta…</p>
      )}

      {error && (
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {steps.length > 0 && (
        <ul className="mt-4 space-y-2">
          {steps.map((step) => (
            <li
              key={step.id}
              className="flex items-start gap-3 rounded-xl border border-gray-100 px-4 py-3 text-sm"
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  step.ok
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {step.ok ? "✓" : "!"}
              </span>
              <span className="min-w-0">
                <span className="font-semibold text-gray-800">{step.label}</span>
                <span className="block text-gray-500">{step.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {status === "done" && tenant && (
        <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <p className="font-semibold">
            {tenant.name || tenant.wabaId} collegato
            {tenant.status === "incomplete" ? " con passi da completare" : ""}.
          </p>
          {pin && (
            <p className="mt-1">
              PIN della verifica in due passaggi: <strong>{pin}</strong>. Conservalo:
              serve a ogni nuova registrazione dello stesso numero.
            </p>
          )}
        </div>
      )}
    </>
  );
}
