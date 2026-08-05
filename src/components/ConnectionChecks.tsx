"use client";

import { useState } from "react";
import { getClientAuth } from "@/lib/firebase/client";

type CheckKey = "phone" | "webhook" | "flow";
type CheckState = "idle" | "loading" | "ok" | "ko";

interface CheckResult {
  state: CheckState;
  label?: string;
  details?: string;
}

const checks: Array<{ key: CheckKey; title: string; description: string }> = [
  {
    key: "phone",
    title: "Numero WhatsApp",
    description: "Token + Phone Number ID",
  },
  {
    key: "webhook",
    title: "Webhook",
    description: "Verify token + App secret",
  },
  {
    key: "flow",
    title: "Flow/App",
    description: "Flow configurato nell'app Meta",
  },
];

function statusText(result?: CheckResult) {
  if (!result || result.state === "idle") return "Da controllare";
  if (result.state === "loading") return "Controllo…";
  return result.state === "ok" ? "Collegato" : "Da sistemare";
}

export default function ConnectionChecks() {
  const [results, setResults] = useState<
    Partial<Record<CheckKey, CheckResult>>
  >({});

  async function runCheck(key: CheckKey) {
    setResults((current) => ({
      ...current,
      [key]: { state: "loading" },
    }));

    try {
      const token = await getClientAuth().currentUser?.getIdToken();
      if (!token) throw new Error("Sessione operatore non valida");

      const res = await fetch(`/api/whatsapp/check?target=${key}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || data.details || "Check non riuscito");
      }

      setResults((current) => ({
        ...current,
        [key]: { state: "ok", label: data.label, details: data.details },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Check non riuscito";
      setResults((current) => ({
        ...current,
        [key]: { state: "ko", label: "Errore", details: message },
      }));
    }
  }

  return (
    <section className="bg-white p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">
            Check collegamenti
          </h2>
          <p className="text-xs text-gray-500">
            Verifica rapidamente numero, webhook e app.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {checks.map((check) => {
          const result = results[check.key];
          const isLoading = result?.state === "loading";
          const isOk = result?.state === "ok";
          const isKo = result?.state === "ko";

          return (
            <button
              key={check.key}
              type="button"
              onClick={() => void runCheck(check.key)}
              disabled={isLoading}
              className="w-full rounded-xl border border-gray-200 p-3 text-left shadow-sm transition hover:border-wa-teal hover:bg-wa-panel disabled:cursor-wait disabled:opacity-70"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-700">
                  {check.title}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    isOk
                      ? "bg-green-100 text-green-700"
                      : isKo
                        ? "bg-red-100 text-red-700"
                        : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {statusText(result)}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-gray-500">
                {result?.details || result?.label || check.description}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
