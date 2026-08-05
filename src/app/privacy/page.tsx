import { getCompanyPrivacySettings } from "@/lib/firebase/firestore-admin";

export const metadata = {
  title: "Privacy Policy | WhatsApp Cloud Chat",
  description: "Informativa privacy per l'utilizzo del canale WhatsApp.",
};

export const dynamic = "force-dynamic";

const lastUpdated = "05 Agosto 2026";

export default async function PrivacyPage() {
  const settings = await getCompanyPrivacySettings();
  const companyName = settings.companyName || "[NOME AZIENDA / NOMINATIVO TITOLARE]";
  const legalName = settings.legalName || "[NOME RAGIONE SOCIALE / NOME E COGNOME]";
  const legalAddress = settings.legalAddress || "[INDIRIZZO COMPLETO, VIA, CITTÀ, CAP, NAZIONE]";
  const taxId = settings.taxId || "[NUMERO P.IVA O CF]";
  const privacyEmail = settings.privacyEmail || "[EMAIL DEDICATA, es. privacy@tuodominio.it]";
  const appName = settings.appName || "[NOME DELLA TUA APP]";
  const messageRetentionPeriod =
    settings.messageRetentionPeriod ||
    settings.retentionPeriod ||
    "[INDICARE PERIODO, es. 30 giorni / 6 mesi]";
  const legalRetentionPeriod =
    settings.legalRetentionPeriod ||
    "la durata stabilita dalle normative vigenti (es. 10 anni per documentazione fiscale)";

  return (
    <main className="min-h-screen bg-wa-panel px-4 py-10 text-gray-800">
      <article className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow-sm md:p-10">
        <p className="text-sm font-medium text-wa-teal">Privacy Policy</p>
        <h1 className="mt-2 text-3xl font-semibold text-gray-900">
          Informativa sulla Privacy
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Ultimo aggiornamento: {lastUpdated}
        </p>

        <div className="mt-8 space-y-7 text-sm leading-6 text-gray-700">
          <p>
            La presente Informativa sulla Privacy descrive le modalità con cui{" "}
            <strong>{companyName}</strong> (&quot;noi&quot;, &quot;nostro&quot; o
            &quot;Titolare&quot;) raccoglie, utilizza, conserva e protegge i dati
            personali degli utenti (&quot;Utente&quot; o &quot;tu&quot;) tramite
            l&apos;applicazione <strong>{appName}</strong> integrata con i servizi
            WhatsApp Cloud API di Meta Platforms.
          </p>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              1. Titolare del Trattamento dei Dati
            </h2>
            <dl className="mt-3 space-y-2">
              <div>
                <dt className="font-semibold text-gray-900">Titolare del Trattamento:</dt>
                <dd>{legalName}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-900">Sede Legale:</dt>
                <dd>{legalAddress}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-900">Codice Fiscale / P.IVA:</dt>
                <dd>{taxId}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-900">Email di contatto Privacy:</dt>
                <dd>{privacyEmail}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              2. Tipologia di Dati Raccolti
            </h2>
            <p className="mt-2">
              L&apos;applicazione raccoglie ed elabora esclusivamente i dati personali
              necessari all&apos;erogazione del servizio tramite WhatsApp Cloud API:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <strong>Dati di identificazione WhatsApp:</strong> numero di
                telefono, nome profilo WhatsApp, ID utente WhatsApp e dati
                collegati all&apos;account WhatsApp Business.
              </li>
              <li>
                <strong>Contenuto delle comunicazioni:</strong> testo dei messaggi,
                file multimediali, allegati e comandi inviati dall&apos;utente.
              </li>
              <li>
                <strong>Metadati delle comunicazioni:</strong> data e ora di
                invio/ricezione, stato di consegna dei messaggi e ID univoci dei
                messaggi.
              </li>
              <li>
                <strong>Dati di log e tecnici:</strong> indirizzo IP, timestamp
                delle chiamate API e registrazioni di sistema necessarie per la
                sicurezza e il debug.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              3. Finalità e Base Giuridica del Trattamento
            </h2>
            <p className="mt-2">Trattiamo i dati personali per le seguenti finalità:</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <strong>Erogazione del servizio:</strong> gestire e rispondere ai
                messaggi dell&apos;utente, fornire assistenza clienti e inviare
                notifiche o informazioni richieste. Base giuridica: esecuzione di
                un contratto o di misure precontrattuali.
              </li>
              <li>
                <strong>Adempimento di obblighi di legge:</strong> ottemperare a
                normative contabili, fiscali o richieste delle autorità competenti.
                Base giuridica: obbligo legale.
              </li>
              <li>
                <strong>Sicurezza e miglioramento del servizio:</strong> prevenire
                frodi, abusi o malfunzionamenti tecnici dell&apos;integrazione. Base
                giuridica: legittimo interesse del Titolare.
              </li>
              <li>
                <strong>Comunicazioni promozionali:</strong> invio di aggiornamenti
                o comunicazioni di marketing tramite WhatsApp, previa
                autorizzazione. Base giuridica: consenso esplicito dell&apos;utente.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              4. Utilizzo di WhatsApp Cloud API e Terze Parti (Meta)
            </h2>
            <p className="mt-2">
              L&apos;integrazione dell&apos;applicazione avviene tramite la WhatsApp Cloud
              API, un servizio fornito da Meta Platforms Ireland Limited per gli
              utenti residenti nell&apos;UE/SEE e da Meta Platforms, Inc.:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                I dati transitano e vengono elaborati sui server sicuri di Meta in
                qualità di Responsabile del Trattamento, ove applicabile.
              </li>
              <li>
                Il trattamento dei dati da parte di Meta è regolato dai Termini di
                servizio di WhatsApp Business e dall&apos;Informativa sulla Privacy di
                WhatsApp, consultabile all&apos;indirizzo:{" "}
                <a
                  href="https://www.whatsapp.com/legal/privacy-policy"
                  className="text-wa-teal hover:underline"
                >
                  https://www.whatsapp.com/legal/privacy-policy
                </a>
                .
              </li>
              <li>
                Non vendiamo, affittiamo o cediamo a terzi i dati raccolti tramite
                l&apos;applicazione per scopi di marketing autonomo di terze parti.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              5. Trasferimento dei Dati Extra-UE
            </h2>
            <p className="mt-2">
              L&apos;utilizzo della WhatsApp Cloud API implica il trasferimento di dati
              verso i server di Meta negli Stati Uniti o in altri Paesi al di fuori
              dello Spazio Economico Europeo (SEE). Tale trasferimento avviene nel
              rispetto delle garanzie previste dal GDPR (artt. 44-49 GDPR),
              comprese le Clausole Contrattuali Standard (SCC) approvate dalla
              Commissione Europea e il EU-U.S. Data Privacy Framework.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              6. Conservazione dei Dati
            </h2>
            <p className="mt-2">
              I dati personali raccolti saranno conservati per il tempo strettamente
              necessario a completare le finalità per cui sono stati raccolti:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <strong>Dati di messaggistica/interazione:</strong> conservati per{" "}
                {messageRetentionPeriod} o fino alla richiesta di cancellazione da
                parte dell&apos;utente, ove applicabile.
              </li>
              <li>
                <strong>Dati contabili/legali:</strong> conservati per{" "}
                {legalRetentionPeriod}.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              7. Diritti dell&apos;Interessato (GDPR)
            </h2>
            <p className="mt-2">
              In conformità agli articoli 15-22 del Regolamento UE 2016/679
              (GDPR), l&apos;utente ha il diritto di:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Chiedere l&apos;accesso ai propri dati personali.</li>
              <li>
                Richiedere la rettifica o la cancellazione degli stessi
                (&quot;diritto all&apos;oblio&quot;).
              </li>
              <li>Richiedere la limitazione del trattamento o opporsi al trattamento.</li>
              <li>Richiedere la portabilità dei dati.</li>
              <li>
                Revocare il consenso in qualsiasi momento, senza pregiudicare la
                liceità del trattamento basato sul consenso prestato prima della
                revoca.
              </li>
              <li>
                Proporre reclamo all&apos;Autorità Garante per la Protezione dei Dati
                Personali:{" "}
                <a
                  href="https://www.garanteprivacy.it"
                  className="text-wa-teal hover:underline"
                >
                  https://www.garanteprivacy.it
                </a>
                .
              </li>
            </ul>
            <p className="mt-3">
              Per esercitare uno qualsiasi di questi diritti, inviare una richiesta
              scritta a: <strong>{privacyEmail}</strong>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              8. Modifiche alla presente Privacy Policy
            </h2>
            <p className="mt-2">
              Ci riserviamo il diritto di aggiornare la presente Informativa sulla
              Privacy in qualsiasi momento. Qualsiasi modifica sarà pubblicata su
              questa pagina con l&apos;indicazione della data di ultimo aggiornamento.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
