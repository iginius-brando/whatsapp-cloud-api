"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import CompanyPrivacySettingsForm from "@/components/guide/CompanyPrivacySettingsForm";

const steps = [
  {
    title: "1. Apri Business Settings",
    body: "Vai su business.facebook.com/settings e seleziona il Business Manager collegato alla tua app WhatsApp.",
  },
  {
    title: "2. Crea o scegli un System User",
    body: "Dal menu Utenti > Utenti di sistema, crea un utente di sistema Admin oppure selezionane uno già presente.",
  },
  {
    title: "3. Assegna asset e permessi",
    body: "Assegna al System User l'app Meta e l'account WhatsApp Business. Concedi accesso completo agli asset necessari.",
  },
  {
    title: "4. Genera il token",
    body: "Nella scheda del System User clicca Genera token, scegli l'app Meta e abilita i permessi whatsapp_business_messaging e whatsapp_business_management.",
  },
  {
    title: "5. Salva il token stabile",
    body: "Copia il token generato e crea una nuova versione del secret whatsapp-access-token in Google Cloud Secret Manager.",
  },
  {
    title: "6. Fai rollout e controlla",
    body: "Dopo il redeploy dell'app, torna nella chat e usa la sezione Check collegamenti per verificare Numero WhatsApp, Webhook e Flow/App.",
  },
];

export default function GuidePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-wa-panel text-wa-teal">
        Caricamento…
      </div>
    );
  }

  return (
    <main className="min-h-dvh bg-wa-panel px-4 py-6 sm:py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-wa-teal">Guida</p>
            <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
              Token stabile WhatsApp da System User
            </h1>
          </div>
          <Link
            href="/chat"
            className="w-full rounded-lg bg-white px-4 py-2 text-center text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 sm:w-auto"
          >
            Torna alla chat
          </Link>
        </div>

        <CompanyPrivacySettingsForm />

        <section className="mt-6 rounded-2xl bg-white p-4 shadow-sm sm:p-6">
          <p className="text-sm leading-6 text-gray-600">
            Il token di test generato nel pannello API Setup di Meta può scadere.
            Per la produzione usa un token generato da un System User del Business
            Manager e salvalo nel secret Google Cloud usato dall&apos;app.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {steps.map((step) => (
              <article key={step.title} className="rounded-xl border border-gray-200 p-4">
                <h2 className="font-semibold text-gray-900">{step.title}</h2>
                <p className="mt-2 text-sm leading-6 text-gray-600">{step.body}</p>
              </article>
            ))}
          </div>

          <div className="mt-6 rounded-xl bg-wa-panel p-4 text-sm text-gray-700">
            <h2 className="font-semibold text-gray-900">Secret da aggiornare</h2>
            <p className="mt-1">
              In Google Cloud Secret Manager crea una nuova versione di
              <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-xs">
                whatsapp-access-token
              </code>
              . L&apos;app lo espone a runtime come
              <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-xs">
                WHATSAPP_ACCESS_TOKEN
              </code>
              .
            </p>
          </div>


          <div className="mt-6 rounded-xl bg-green-50 p-4 text-sm text-green-900">
            <h2 className="font-semibold">Checklist pubblicazione app Meta</h2>
            <p className="mt-1">
              Prima di cliccare &quot;Pubblica&quot; o inviare la configurazione a Meta,
              controlla questi punti nell&apos;ordine.
            </p>
            <ol className="mt-3 list-decimal space-y-1 pl-5">
              <li>La pagina privacy pubblica si apre dal dominio finale: /privacy.</li>
              <li>Il token di test è stato sostituito con un token da System User.</li>
              <li>Il secret whatsapp-access-token ha una nuova versione attiva.</li>
              <li>Il deploy/rollout è stato eseguito dopo il cambio secret.</li>
              <li>Il check Numero WhatsApp torna Collegato.</li>
              <li>Il webhook pubblico è configurato in WhatsApp Manager.</li>
              <li>Nel webhook Meta è sottoscritto il campo messages.</li>
              <li>Il Flow, se usato, è pubblicato o configurato correttamente in bozza.</li>
            </ol>
          </div>

          <div className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            <h2 className="font-semibold">Prima di passare in produzione</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Completa la verifica business se richiesta da Meta.</li>
              <li>Configura il webhook pubblico e sottoscrivi il campo messages.</li>
              <li>Inserisci in Meta il link pubblico della privacy policy: /privacy.</li>
              <li>Usa la sezione Check collegamenti dopo ogni cambio di secret.</li>
            </ul>
          </div>

          <div className="mt-6 text-sm">
            <h2 className="font-semibold text-gray-900">Link utili</h2>
            <ul className="mt-2 space-y-1 text-wa-teal">
              <li>
                <a
                  href="https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  Documentazione Meta sui token WhatsApp
                </a>
              </li>
              <li>
                <a
                  href="https://business.facebook.com/settings/system-users"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  Business Settings - System Users
                </a>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
