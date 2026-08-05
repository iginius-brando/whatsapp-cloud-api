import { getCompanyPrivacySettings } from "@/lib/firebase/firestore-admin";

export const metadata = {
  title: "Privacy Policy | WhatsApp Cloud Chat",
  description: "Informativa privacy per l'utilizzo del canale WhatsApp.",
};

export const dynamic = "force-dynamic";

const lastUpdated = "5 agosto 2026";

export default async function PrivacyPage() {
  const settings = await getCompanyPrivacySettings();
  const companyName = settings.companyName || "[Nome azienda]";
  const legalAddress = settings.legalAddress || "[Indirizzo sede legale]";
  const privacyEmail = settings.privacyEmail || "[Email privacy]";
  const retentionPeriod =
    settings.retentionPeriod ||
    "[Inserire il periodo di conservazione adottato dall&apos;azienda]";

  return (
    <main className="min-h-screen bg-wa-panel px-4 py-10 text-gray-800">
      <article className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow-sm md:p-10">
        <p className="text-sm font-medium text-wa-teal">Privacy Policy</p>
        <h1 className="mt-2 text-3xl font-semibold text-gray-900">
          Informativa privacy per il canale WhatsApp
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Ultimo aggiornamento: {lastUpdated}
        </p>

        <div className="mt-8 space-y-6 text-sm leading-6 text-gray-700">
          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              1. Titolare del trattamento
            </h2>
            <p className="mt-2">
              <strong>{companyName}</strong> gestisce questa applicazione e usa
              il canale WhatsApp Business per comunicare con clienti e utenti.
              Sede/indirizzo: <strong>{legalAddress}</strong>. Per richieste
              privacy: <strong>{privacyEmail}</strong>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              2. Dati trattati
            </h2>
            <p className="mt-2">
              Possiamo trattare numero di telefono WhatsApp, nome profilo,
              messaggi inviati e ricevuti, eventuali allegati, stato di consegna
              dei messaggi e dati inseriti nei moduli o Flow WhatsApp.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              3. Finalità
            </h2>
            <p className="mt-2">
              I dati vengono usati per rispondere alle richieste, gestire
              conversazioni, appuntamenti, prenotazioni, assistenza clienti e
              comunicazioni collegate al servizio richiesto dall&apos;utente.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              4. Base giuridica
            </h2>
            <p className="mt-2">
              Il trattamento può basarsi sull&apos;esecuzione di una richiesta
              dell&apos;utente, sull&apos;adempimento di obblighi contrattuali o
              precontrattuali, sul consenso ove richiesto e sul legittimo
              interesse alla gestione delle comunicazioni di servizio.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              5. Servizi terzi
            </h2>
            <p className="mt-2">
              Le comunicazioni passano tramite WhatsApp Business Platform di Meta
              e l&apos;applicazione può usare Firebase/Google Cloud per autenticazione,
              hosting, database e gestione dei segreti tecnici.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              6. Conservazione
            </h2>
            <p className="mt-2">
              {retentionPeriod}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              7. Diritti dell&apos;utente
            </h2>
            <p className="mt-2">
              L&apos;utente può richiedere accesso, rettifica, cancellazione,
              limitazione, opposizione e portabilità dei dati, ove applicabile.
              Le richieste possono essere inviate a <strong>{privacyEmail}</strong>.
            </p>
          </section>

          <section className="rounded-xl bg-amber-50 p-4 text-amber-900">
            <h2 className="font-semibold">Nota operativa</h2>
            <p className="mt-1">
              Questa informativa è pensata come base operativa per Meta. Prima
              di usarla definitivamente, falla validare dal consulente privacy o
              legale. I dati aziendali visibili qui possono essere aggiornati
              dalla sezione Guida dell&apos;app.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
