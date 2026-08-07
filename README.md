# WhatsApp Cloud Chat

Interfaccia di chat in stile WhatsApp costruita **direttamente** sulle
[WhatsApp Cloud API di Meta](https://developers.facebook.com/docs/whatsapp/cloud-api),
senza partner intermedi (tipo SendPulse). Gli operatori accedono con Firebase
Authentication e condividono un'unica inbox: tutti vedono e rispondono a tutte
le conversazioni del numero WhatsApp aziendale.

## Stack

- **Next.js 15** (App Router, TypeScript) — SSR + API routes
- **Firebase App Hosting** — deploy
- **Firestore** — conversazioni, messaggi e coda degli eventi del webhook, con
  aggiornamento realtime
- **Firebase Authentication** — login operatori (Google + email/password)
- **Firebase Storage** — copia degli allegati, che su WhatsApp scadono a 30 giorni
- **WhatsApp Cloud API** — invio/ricezione messaggi

## Come funziona

```
Cliente WhatsApp
      │  (messaggio)
      ▼
Meta Cloud API ──POST──►  /api/whatsapp/webhook
      ▲                        │
      │                        ├─► webhookEvents (payload grezzo)  ──┐
      │                        └─► conversations/messages            │ ripresa
      │                                    │                         │
      │  (invio via Graph API)             │ realtime      /api/whatsapp/maintenance
      │                                    ▼                   ▲ (Cloud Scheduler)
/api/whatsapp/send  ◄── operatore ◄──── UI chat (onSnapshot)    │
```

- **Ricezione**: Meta invia gli eventi (messaggi + stati di consegna) al webhook
  `POST /api/whatsapp/webhook`. La firma `X-Hub-Signature-256` viene verificata
  con l'App Secret. Il payload grezzo viene prima messo al sicuro in
  `webhookEvents`, poi elaborato e salvato su Firestore tramite l'Admin SDK
  (vedi [Durabilità del webhook](#durabilità-del-webhook)).
- **Realtime**: la UI ascolta Firestore con `onSnapshot`, quindi le nuove chat e
  i nuovi messaggi compaiono senza refresh. La chat carica gli ultimi 50
  messaggi e risale lo storico a richiesta (*Carica messaggi precedenti*),
  allargando la finestra della stessa sottoscrizione: resta un solo listener,
  che continua a ricevere i messaggi nuovi anche dopo aver risalito la
  conversazione. L'ordinamento della query è **discendente**, perché Firestore
  ordina prima di applicare il `limit`: chiedendo `asc` si otterrebbero i
  messaggi più vecchi e la chat non mostrerebbe mai gli ultimi arrivati.
- **Invio**: l'operatore scrive dalla UI → `POST /api/whatsapp/send` (protetto da
  ID token Firebase) → Graph API → il messaggio viene salvato su Firestore.
- **Allegati**: immagini, video, audio e documenti viaggiano in entrambe le
  direzioni e vengono archiviati su Firebase Storage
  (vedi [Allegati](#allegati-immagini-video-audio-e-documenti)).
- **Risposte**: ogni messaggio può citarne uno precedente
  (vedi [Risposte](#risposte-a-un-messaggio)).
- **Stati**: le spunte (inviato ✓, consegnato/letto ✓✓) arrivano dagli eventi
  `statuses` del webhook.
- **Onboarding clienti**: il pannello `/onboarding` collega la WABA di un cliente
  con l'Embedded Signup di Meta
  (vedi [Tech provider](#tech-provider-embedded-signup)).

## Struttura del progetto

```
src/
├── app/
│   ├── api/whatsapp/
│   │   ├── webhook/route.ts   # GET verifica + POST eventi (messaggi/stati)
│   │   ├── maintenance/route.ts    # ripresa eventi in coda + archiviazione media
│   │   ├── send/route.ts      # invio testo (auth con ID token Firebase)
│   │   ├── send-media/route.ts     # invio allegati (multipart)
│   │   ├── embedded-signup/route.ts # onboarding clienti (solo admin)
│   │   └── media/[mediaId]/route.ts # proxy autenticato per scaricare i media
│   ├── chat/page.tsx          # UI chat (protetta)
│   ├── onboarding/page.tsx    # pannello Embedded Signup (solo admin)
│   ├── login/page.tsx         # login Google + email/password
│   ├── layout.tsx / page.tsx  # root + redirect
│   └── globals.css
├── components/                # ChatList, ChatWindow, MessageBubble, Composer,
│                              # MediaAttachment, AttachmentComposer
├── context/AuthContext.tsx    # stato autenticazione
├── hooks/
│   ├── useChat.ts             # sottoscrizioni Firestore realtime
│   ├── useMedia.ts            # download allegati + cache degli object URL
│   └── useSwipeToReply.ts     # gesto "trascina per rispondere" su touch
└── lib/
    ├── firebase/client.ts     # SDK client
    ├── firebase/admin.ts      # SDK admin (server) + bucket degli allegati
    ├── firebase/firestore-admin.ts  # scritture messaggi/conversazioni/tenant
    ├── firebase/webhook-events.ts   # coda durevole degli eventi del webhook
    ├── firebase/media-archive.ts    # copia degli allegati su Storage
    ├── whatsapp-events.ts     # elaborazione dei payload del webhook
    ├── meta/graph.ts          # helper comuni Graph API
    ├── meta/embedded-signup.ts # onboarding clienti (tech provider)
    ├── meta/token-vault.ts    # cifratura a riposo dei token dei clienti
    ├── whatsapp.ts            # Cloud API + verifica firma webhook
    ├── media.ts               # tipi, limiti e MIME degli allegati
    └── types.ts / format.ts
```

## Modello dati Firestore

```
conversations/{waId}
  waId, name, lastMessage, lastMessageAt, lastMessageDirection,
  unreadCount, lastInboundAt
  └── messages/{messageId}
        id, direction (in|out), type, text, status, timestamp
        mediaCaption            # etichetta di ripiego, es. "[immagine]"
        media                   # solo sui messaggi con allegato:
          { id, storagePath, mimeType, filename, size, sha256, voice, animated }
        mediaArchive            # pending | done | unavailable (vedi Allegati)
        replyTo                 # solo sulle risposte:
          { id, direction, type, text }

webhookEvents/{sha256(payload)}  # coda durevole degli eventi di Meta
  raw, status (pending|done|abandoned), attempts, lastError,
  receivedAt, lastDeliveryAt, processedAt, expireAt

whatsappTenants/{wabaId}        # clienti onboardati via Embedded Signup
  wabaId, businessId, name, currency, timezoneId, accountReviewStatus,
  phoneNumbers[], defaultPhoneNumberId, grantedScopes[], tokenExpiresAt,
  subscribed, registered, status, steps[], connectedByUid, connectedByEmail
  accessToken, tokenEncrypted, registrationPin   # solo lato server
```

`waId` = numero del cliente in formato E.164 senza `+` (es. `393331234567`).

I byte degli allegati **non** finiscono su Firestore: su Firestore restano il
`media.id` di WhatsApp e il percorso della copia archiviata su Firebase Storage.

### Regole di accesso

Le regole (`firestore.rules`) partono da un deny totale. Dal browser un
operatore autenticato può **leggere** conversazioni e messaggi — l'inbox è
condivisa per scelta — ma l'unica scrittura consentita è azzerare `unreadCount`
sulla conversazione che sta aprendo. Tutto il resto (messaggi in ingresso,
invii, stati di consegna, token dei clienti, coda del webhook) passa
dall'Admin SDK lato server, che le regole non le applica.

Anche `storage.rules` nega ogni accesso client: gli allegati archiviati si
leggono solo dal proxy `/api/whatsapp/media/{id}`.

---

## Setup passo-passo

### 1. Progetto Firebase

1. Crea un progetto su [console.firebase.google.com](https://console.firebase.google.com).
2. **Authentication** → abilita i provider **Google** ed **Email/Password**.
3. **Firestore Database** → crea il database (modalità produzione).
4. **Impostazioni progetto** → *Le tue app* → aggiungi un'app Web e copia la
   configurazione (`apiKey`, `authDomain`, ecc.).

### 2. App WhatsApp su Meta

1. Vai su [developers.facebook.com](https://developers.facebook.com) → crea
   un'app di tipo **Business** e aggiungi il prodotto **WhatsApp**.
2. In *API Setup* prendi nota di:
   - **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - **WhatsApp Business Account ID (WABA ID)** → `WHATSAPP_BUSINESS_ACCOUNT_ID`
   - **Access token** (per la produzione genera un token permanente da un
     System User) → `WHATSAPP_ACCESS_TOKEN`
3. In *Impostazioni app → Base* copia l'**App secret** → `WHATSAPP_APP_SECRET`.
4. Scegli un **verify token** a piacere (una stringa segreta) →
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.

### 3. Configurazione del webhook (dopo il primo deploy)

Nel pannello WhatsApp → *Configuration → Webhook*:

- **Callback URL**: `https://<il-tuo-dominio>/api/whatsapp/webhook`
- **Verify token**: lo stesso valore di `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- **Sottoscrivi** al campo `messages`.

### 4. Sviluppo locale

```bash
cp .env.local.example .env.local   # compila i valori
npm install
npm run dev                        # http://localhost:3000
```

Per l'Admin SDK in locale scarica una chiave service account da Firebase e
imposta `GOOGLE_APPLICATION_CREDENTIALS` (vedi `.env.local.example`).

Al primo accesso a **Gestione utenti**, se non esiste ancora alcun account con
il ruolo admin, l'app assegna automaticamente il ruolo al più vecchio account
Firebase abilitato. I successivi account possono essere creati e promossi solo
da un admin.

Per testare il webhook in locale esponi la porta con un tunnel (es.
`ngrok http 3000`) e usa l'URL pubblico nella configurazione Meta.

### 5. Deploy su Firebase App Hosting

```bash
npm install -g firebase-tools
firebase login
# imposta il project id in .firebaserc, poi:
firebase experiments:enable webframeworks   # se richiesto
```

Crea i segreti WhatsApp in Cloud Secret Manager:

```bash
firebase apphosting:secrets:set whatsapp-access-token
firebase apphosting:secrets:set whatsapp-phone-number-id
firebase apphosting:secrets:set WHATSAPP_BUSINESS_ACCOUNT_ID
firebase apphosting:secrets:set whatsapp-webhook-verify-token
firebase apphosting:secrets:set whatsapp-app-secret
# Token della manutenzione periodica (vedi più avanti). Valore casuale:
#   openssl rand -base64 32
firebase apphosting:secrets:set whatsapp-maintenance-token
```

L'invio dei template richiede `WHATSAPP_BUSINESS_ACCOUNT_ID`, dichiarato in
`apphosting.yaml` come secret **`WHATSAPP_BUSINESS_ACCOUNT_ID`** (maiuscolo con
underscore, a differenza degli altri che usano il kebab-case). Il nome nel campo
`secret:` deve combaciare esattamente con quello in Cloud Secret Manager,
altrimenti il rollout fallisce nello step `preparer` con
`fah/misconfigured-secret` prima ancora della build.

Ricorda di concedere l'accesso al backend dopo aver creato un secret:

```bash
firebase apphosting:secrets:grantaccess WHATSAPP_BUSINESS_ACCOUNT_ID --backend <nome-backend>
```

Aggiorna in `apphosting.yaml` i valori `NEXT_PUBLIC_FIREBASE_*` con quelli della
tua app Web, poi collega il repository ad App Hosting dalla console Firebase
(*App Hosting → Get started*) oppure fai il deploy da CLI. Ad ogni push sul
branch collegato App Hosting eseguirà build e rollout.

Pubblica infine regole e indici:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Gli indici sono necessari: senza di essi la coda del webhook e l'archiviazione
degli allegati non riescono a leggere le rispettive liste di lavoro. Il deploy
di `storage` chiude il bucket a ogni accesso client — i media si leggono solo
dal proxy autenticato.

Conviene anche impostare una **TTL policy** su `webhookEvents`, così i payload
grezzi non si accumulano per sempre. Il campo è già scritto dall'applicazione:

```bash
gcloud firestore fields ttls update expireAt \
  --collection-group=webhookEvents --enable-ttl
```

---

## Durabilità del webhook

Il webhook ha un vincolo scomodo: **non può rispondere 500 a Meta** per un
errore proprio. Meta interpreta l'errore come mancata consegna e ritenta lo
stesso payload per ore, moltiplicando il problema invece di risolverlo. Ma
rispondere sempre 200 significa che una scrittura fallita su Firestore fa
sparire un messaggio del cliente senza che nessuno se ne accorga.

La via d'uscita è separare *mettere al sicuro* da *elaborare*:

```
POST /api/whatsapp/webhook
  1. verifica firma X-Hub-Signature-256      → 401 se non torna
  2. parsing del JSON                        → 400 se non è leggibile
  3. scrittura in webhookEvents (payload)    → 500 se fallisce: Meta ritenti
  4. elaborazione e salvataggio              → sempre 200, anche in errore
```

Solo il passo 3 può restituire 500, ed è il caso giusto: a quel punto non
abbiamo ancora fatto nulla, quindi una riconsegna di Meta è esattamente ciò che
serve. Superato quel punto il payload è al sicuro e l'elaborazione può fallire
senza perdere niente: l'evento resta `pending` e viene ripreso dalla
[manutenzione](#manutenzione-periodica).

Due dettagli che rendono il meccanismo utilizzabile davvero:

- **Deduplica.** L'id del documento è lo `sha256` del corpo grezzo. I retry di
  Meta ripetono il payload identico, quindi ricadono sullo stesso documento: se
  risulta già `done` la risposta è immediata e non si rielabora nulla.
- **Idempotenza.** `saveInboundMessage` gira in una transazione che controlla se
  il messaggio esiste già. Rielaborare un evento non incrementa una seconda
  volta i non letti e non riporta indietro l'anteprima della conversazione, che
  nel frattempo può essere passata a un messaggio più recente.

Dopo `MAX_PROCESSING_ATTEMPTS` tentativi falliti l'evento passa ad `abandoned`:
continuare a ritentare un payload che non va giù bloccherebbe la coda dietro di
sé. Quei documenti restano su Firestore con `lastError` per l'analisi.

> **Nota sui limiti.** Questa è una coda su Firestore, non un broker: la ripresa
> avviene alla cadenza dello scheduler, non entro pochi secondi. Per retry
> immediati il passo successivo naturale è Cloud Tasks, che può chiamare
> `/api/whatsapp/maintenance` a ogni fallimento invece di aspettare il giro
> successivo.

---

## Manutenzione periodica

`POST /api/whatsapp/maintenance` fa il lavoro che non può stare dentro alla
richiesta del webhook:

- **rielabora gli eventi rimasti in coda** (fino a 25 per esecuzione);
- **archivia gli allegati** ancora solo sui server di Meta (fino a 10 per
  esecuzione), compresi quelli troppo grandi per la copia inline.

Ogni esecuzione lavora a lotti: se resta arretrato, ci pensa la corsa successiva.

L'endpoint non usa Firebase Auth — chi lo chiama è uno scheduler, non un
operatore — ma un token condiviso nell'header `x-maintenance-token`, confrontato
a tempo costante con `WHATSAPP_MAINTENANCE_TOKEN`. **Senza quel secret l'endpoint
risponde 503** e la manutenzione non parte.

```bash
gcloud scheduler jobs create http whatsapp-maintenance \
  --schedule="*/10 * * * *" \
  --uri="https://<il-tuo-dominio>/api/whatsapp/maintenance" \
  --http-method=POST \
  --headers="x-maintenance-token=<valore-del-secret>" \
  --location=<regione>
```

Dieci minuti sono una cadenza ragionevole: la coda del webhook si svuota in
fretta e per l'archiviazione dei media la scadenza vera è a 30 giorni. La
risposta riepiloga il lavoro svolto, comoda da controllare a mano:

```json
{
  "ok": true,
  "events": { "processed": 2, "failed": 0, "abandoned": 0 },
  "media":  { "archived": 5, "skipped": 0, "unavailable": 1 }
}
```

---

## Allegati (immagini, video, audio e documenti)

Gli allegati funzionano in **entrambe le direzioni** e non richiedono alcuna
configurazione aggiuntiva: bastano `WHATSAPP_ACCESS_TOKEN` e
`WHATSAPP_PHONE_NUMBER_ID`, gli stessi già usati per il testo.

```
Invio      file dal composer ──► POST /api/whatsapp/send-media
                                   ├─ upload su /{phone-number-id}/media  → media id
                                   ├─ invio del messaggio per id          → wamid
                                   └─ copia dei byte su Storage

Ricezione  webhook ──► salva { type, media.id, mimeType, filename } su Firestore
                   └─ copia da Graph API a Storage (sotto i 16 MB)
           UI ──► GET /api/whatsapp/media/{id} ──► Storage, o Graph API se manca
```

### Perché serve un proxy per la lettura

Né i media di Meta né il bucket sono pubblici. Il webhook consegna solo un `id`;
per ottenere i byte da Meta bisogna prima risolverlo in un URL temporaneo (scade
in pochi minuti) e poi scaricarlo passando l'access token, che non può stare nel
browser. Anche la copia su Storage è chiusa a ogni client (`storage.rules`).

`GET /api/whatsapp/media/{mediaId}` fa quindi da proxy: verifica l'ID token
Firebase dell'operatore, **preferisce la copia archiviata** e ripiega sulla
Graph API quando non c'è ancora. La UI lo chiama via `fetch` e converte la
risposta in un object URL (`src/hooks/useMedia.ts`), che tiene in cache finché il
componente è montato.

### Archiviazione su Storage

**Meta conserva i media 30 giorni.** Senza una copia, passato quel periodo la
chat mostrerebbe ancora il messaggio ma non l'allegato. Ogni allegato viene
perciò copiato in `whatsapp-media/{mediaId}` sul bucket del progetto, e il
messaggio tiene traccia di dove sta il file (`media.storagePath`) e a che punto è
la copia (`mediaArchive`):

| Momento | Cosa succede |
|---|---|
| Invio dell'operatore | I byte sono già nella richiesta: si archivia subito, senza riscaricare nulla |
| Ricezione sotto i 5 MB | Copia dentro all'elaborazione del webhook |
| Ricezione sopra i 5 MB | Resta `pending`: il vincolo non è il limite di WhatsApp ma la pazienza di Meta, che riconsegna l'evento se il webhook tarda a rispondere |
| `pending` rimasti indietro | Li archivia lo sweeper di [manutenzione](#manutenzione-periodica) |
| Media già scaduto su Meta | Passa a `unavailable`: non è più recuperabile e si smette di ritentare |

L'archiviazione non è mai bloccante: se fallisce, il messaggio viene salvato lo
stesso e l'allegato resta in coda. Finché resta `pending` il proxy continua a
servirlo dalla Graph API, quindi per l'operatore non cambia nulla.

> **Cloud Scheduler non è opzionale per la conservazione completa.** Senza,
> restano archiviati gli allegati inviati dagli operatori e quelli ricevuti
> sotto i 5 MB — immagini, sticker, note vocali. Video e documenti pesanti
> restano `pending` e a 30 giorni li si perde: è proprio il caso che lo sweeper
> esiste per coprire.

### Formati e limiti

| Categoria | MIME accettati da Meta | Limite |
|---|---|---|
| Immagine | `image/jpeg`, `image/png` | 5 MB |
| Video | `video/mp4`, `video/3gpp` (H.264 + AAC) | 16 MB |
| Audio | `audio/aac`, `audio/amr`, `audio/mpeg`, `audio/mp4`, `audio/ogg` | 16 MB |
| Documento | qualsiasi | 100 MB |
| Sticker | `image/webp` (solo in ricezione) | 500 KB |

Tutto ciò che non rientra nei formati di immagine/video/audio (webp, gif, wav,
zip, …) viene inviato **come documento**: arriva comunque al cliente, invece di
essere rifiutato dalla Graph API. Il composer lo segnala prima dell'invio.

Un paio di dettagli imposti da Meta e riflessi nella UI:

- **audio e sticker non accettano didascalia**: il campo non compare e, se
  arrivasse comunque, il server la scarta invece di salvarne una mai recapitata.
- **solo i documenti hanno un nome file** visibile al cliente.

Il limite pratico di una singola richiesta è **30 MB**
(`MAX_UPLOAD_BYTES` in `src/lib/media.ts`): Cloud Run, su cui gira App Hosting,
rifiuta le richieste oltre i 32 MB, quindi i documenti molto grandi vanno
bloccati prima con un messaggio chiaro anziché farsi troncare la richiesta.
Alzarlo ha senso solo dietro a un'infrastruttura che regga richieste più grandi.

### Dal lato operatore

Nel composer la graffetta apre un menu con *Foto e video*, *Audio* e
*Documento*; in alternativa si può **trascinare** un file sulla barra di scrittura
o **incollare** uno screenshot dagli appunti. Prima dell'invio compaiono
anteprima, dimensione ed eventuale campo didascalia, con barra di avanzamento
durante l'upload.

In chat le immagini e gli audio si caricano da soli, i video partono al clic su
*Riproduci* (fino a 16 MB: inutile scaricarli tutti all'apertura della
conversazione) e i documenti si scaricano con un clic sulla scheda del file.

---

## Risposte a un messaggio

Rispondere citando un messaggio precedente — quello che WhatsApp mostra come
riquadro sopra la bolla — si fa aggiungendo l'oggetto `context` al payload:

```jsonc
{
  "messaging_product": "whatsapp",
  "to": "393331234567",
  "context": { "message_id": "wamid.HBgM…" },  // il messaggio citato
  "type": "text",
  "text": { "body": "Certo, confermo per giovedì" }
}
```

Vale per il testo e per tutti gli allegati: `sendTextMessage` e
`sendMediaMessage` accettano il wamid da citare, e le route `send` e
`send-media` lo prendono dai campi `replyTo`.

In ricezione è il webhook a segnalarlo: quando il cliente risponde, il messaggio
porta `context.id` con il wamid citato. Attenzione che `context` compare anche
sui messaggi inoltrati o arrivati da un annuncio *click-to-WhatsApp*, dove però
`id` manca: solo la presenza dell'id indica una risposta vera.

### Cosa salviamo

Accanto al messaggio finisce `replyTo: { id, direction, type, text }`, cioè il
riferimento **più un'istantanea** del contenuto citato, risolta leggendo il
messaggio originale da Firestore al momento della scrittura.

La ridondanza è voluta: la chat carica gli ultimi 50 messaggi per volta, quindi
con il solo id una citazione a un messaggio più vecchio resterebbe vuota. Con
l'istantanea la citazione è sempre leggibile; l'id serve in più a saltare
all'originale quando è ancora in pagina. Costo: una lettura Firestore per ogni
risposta.

### Dal lato operatore

Per citare un messaggio, come nell'app WhatsApp:

- **Da telefono o tablet**: si trascina la bolla verso destra e si rilascia
  (`src/hooks/useSwipeToReply.ts`).
- **Da computer**: compare l'icona *Rispondi* passando sopra la bolla, come su
  WhatsApp Web. Col mouse il trascinamento serve a selezionare il testo, quindi
  il gesto è riservato a dito e pennino.

Il messaggio scelto appare come striscia sopra la casella di scrittura, con la X
per annullare, e vale sia per il testo che per un allegato. Cliccando una
citazione la chat salta al messaggio originale, che lampeggia un istante.

Sullo swipe ci sono tre dettagli che è facile sbagliare, e che il codice gestisce
esplicitamente:

- il gesto si prende solo i movimenti **orizzontali** (`touch-action: pan-y` più
  un confronto fra le due componenti), altrimenti lo scorrimento della chat
  diventerebbe inutilizzabile;
- la barra di avanzamento di audio e video usa già il trascinamento
  orizzontale, quindi quegli elementi sono esclusi dal gesto;
- lo swipe che finisce su un'immagine o un bottone genera comunque un click, che
  viene soppresso in fase di cattura.

Durante il trascinamento la traslazione viene scritta direttamente sul DOM: un
`setState` per ogni `pointermove` rirenderizzerebbe la bolla e il suo allegato
sessanta volte al secondo.

> **Nota:** la citazione **non** viene applicata ai template. Aprendo il
> pannello dei template la striscia di risposta viene quindi scartata, invece di
> sparire in silenzio al momento dell'invio.

---

## WhatsApp Flows

Il progetto invia Flows **dinamici** (`data_api_version: "3.0"`): a ogni passo il
client chiede al nostro server quale schermata mostrare, quindi serve un *Flow
Endpoint* pubblico e cifrato.

```
Operatore ──► /api/whatsapp/send-flow ──► Cloud API ──► messaggio con bottone
                                                              │
Cliente apre il modulo                                        ▼
   Meta ──POST cifrata──► /api/whatsapp/flow-endpoint ──► schermata successiva
                                                              │
Cliente conferma ──► nfm_reply ──► /api/whatsapp/webhook ──► Firestore
```

- `src/lib/flows/crypto.ts` — decifra le richieste (RSA-OAEP + AES-GCM) e cifra
  le risposte con l'IV invertito, come richiede la specifica.
- `src/lib/flows/booking.ts` — macchina a stati delle schermate.
- `flows/prenotazione.flow.json` — il Flow JSON da incollare nel Flow Builder.
  Va tenuto allineato a `booking.ts`: i nomi dei campi devono corrispondere.
- `src/app/api/whatsapp/flow-endpoint/route.ts` — l'endpoint da configurare su Meta.
- `src/app/api/whatsapp/send-flow/route.ts` — invio del messaggio che apre il Flow.

### Percorso del Flow

```
MENU ──┬─ prenotazione ──────► PERIOD ─► DATE ─► TIME ─► DETAILS ─► SUMMARY
       └─ gestione ─► APPOINTMENTS ─┬─ spostare ─► PERIOD ─► … ─► SUMMARY
                                    ├─ disdire ─────────────────► SUMMARY
                                    └─ vedere ──────────────────► SUMMARY
```

La schermata PERIOD ("prime disponibilità" oppure un mese) esiste come passo a
sé perché nei Flows un `Dropdown` non può interrogare l'endpoint alla selezione:
il suo `on-select-action` accetta solo `update_data`, che aggiorna i dati lato
client senza chiamare il server. Solo il footer di una schermata può fare
`data_exchange`, quindi ogni passaggio che richiede dati nuovi è una schermata.

Il Flow non ha memoria tra una richiesta e l'altra: lo stato viaggia dentro il
campo `context`, una stringa JSON che ogni schermata riceve nei propri `data` e
rispedisce nel payload del footer. Chi aggiunge una schermata deve ricordarsi di
inoltrare `"context": "${data.context}"`, altrimenti le scelte precedenti si
perdono.

### Dove innestare i dati reali

In `booking.ts`, nella sezione *Sorgenti dati*:

| Funzione | Restituisce |
|---|---|
| `slotsFor(isoDate)` | orari liberi di un giorno |
| `listPeriods()` | prime disponibilità e mesi successivi |
| `listDates(period)` | giorni con almeno uno slot libero nel periodo |
| `listSlots(isoDate)` | slot di un giorno, già formattati |
| `listAppointments(waId)` | appuntamenti futuri del cliente |

Oggi restituiscono dati fittizi ma **deterministici**: la stessa data produce
sempre gli stessi orari, così l'elenco mostrato nella schermata DATE coincide con
quello della schermata TIME. Sostituendole con query reali va mantenuta questa
coerenza, altrimenti l'utente vede orari che poi non trova.

### 1. Genera la coppia di chiavi

Meta accetta solo chiavi private protette da passphrase.

```bash
openssl genrsa -des3 -out private.pem 2048     # chiede la passphrase
openssl rsa -in private.pem -pubout -out public.pem
```

### 2. Configura i segreti

```bash
firebase apphosting:secrets:set whatsapp-flow-private-key            # contenuto di private.pem
firebase apphosting:secrets:set whatsapp-flow-private-key-passphrase
```

In `apphosting.yaml` togli il commento dal blocco `WHATSAPP_FLOW_ID` e inserisci
l'ID del Flow. Attenzione: App Hosting rifiuta un `value` vuoto con l'errore
`fah/invalid-apphosting-yaml`, quindi la variabile va lasciata commentata finché
non si ha l'ID vero, non valorizzata con `""`.

Imposta anche `WHATSAPP_FLOW_DRAFT_MODE: "true"` finché il Flow è in bozza (in
bozza l'invio funziona solo verso i numeri di test dell'app). Poi fai il deploy:
l'endpoint deve essere già online prima del passo successivo.

### 3. Carica la chiave pubblica

```bash
curl -X POST "https://graph.facebook.com/v22.0/<PHONE_NUMBER_ID>/whatsapp_business_encryption" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  --data-urlencode "business_public_key=$(cat public.pem)"
```

In alternativa si può usare il passo *Firma chiave pubblica* nel pannello del Flow.

### 4. Collega l'endpoint

In WhatsApp Manager → Flows → il tuo Flow → *Endpoint*:

- **URI endpoint**: `https://<il-tuo-dominio>/api/whatsapp/flow-endpoint`
- Esegui il **Controllo integrità**: Meta invia un `ping` cifrato e si aspetta
  `{"data":{"status":"active"}}`. Se fallisce con 421 la chiave pubblica caricata
  non corrisponde alla privata configurata.

Quando il controllo è verde, **pubblica** il Flow e togli `WHATSAPP_FLOW_DRAFT_MODE`.

### 5. Ricezione delle risposte

Il modulo compilato arriva al webhook come messaggio `interactive` di tipo
`nfm_reply`: i campi stanno in `response_json` (una stringa JSON) e vengono
salvati nel messaggio Firestore sotto `flowResponse`, insieme al `flowToken` che
identifica la sessione. Le prenotazioni completate finiscono anche nella
collection `flowBookings`.

> **Nota:** il messaggio interattivo che apre un Flow è soggetto alla finestra di
> 24 ore. Per riaprire una conversazione scaduta serve un template approvato con
> bottone di tipo `flow`.

---

## Tech provider: Embedded Signup

L'Embedded Signup è il flusso con cui un cliente collega **il proprio** numero
WhatsApp alla nostra app senza uscire dal nostro pannello: è il primo mattone
per diventare *tech provider* di Meta, cioè per gestire le WABA di terzi invece
del solo numero aziendale.

```
Admin apre /onboarding ──► bottone "Collega un cliente"
        │
        ▼
FB.login (config_id, response_type=code) ──► popup Meta: il cliente sceglie
        │                                     business, WABA e numero
        ├── postMessage WA_EMBEDDED_SIGNUP ──► waba_id + phone_number_id
        └── callback ──► code (monouso)
                 │
                 ▼
POST /api/whatsapp/embedded-signup   (solo admin)
   1. code ─► GET /oauth/access_token          → token DEL CLIENTE
   2. GET /debug_token                          → permessi + WABA condivise
   3. POST /{waba-id}/subscribed_apps           → webhook della WABA a noi
   4. POST /{phone-number-id}/register (+ PIN)  → numero attivo su Cloud API
   5. GET /{waba-id} e /{waba-id}/phone_numbers → dati da mostrare
                 │
                 ▼
        Firestore: whatsappTenants/{wabaId}
```

Lo scambio del `code` è l'unico passo bloccante: senza token non c'è nulla da
configurare. I passi successivi vengono tentati tutti e riportati **uno per
uno** nella UI, perché il `code` è monouso — se il primo errore facesse fallire
tutta la richiesta, l'unico modo per riprovare sarebbe rifare il signup da capo
con il cliente davanti. Un numero da verificare o un permesso non concesso
lasciano quindi il cliente in stato *Da completare*, non lo perdono.

### Prerequisiti sul lato Meta

1. App di tipo **Business** con il prodotto WhatsApp e la **verifica business**
   completata.
2. **Accesso avanzato** (App Review) ai permessi `whatsapp_business_management`,
   `whatsapp_business_messaging` e `business_management`. Con il solo accesso
   standard il flusso funziona unicamente con gli utenti di test dell'app.
3. Una configurazione di **Facebook Login for Business** con variante *Embedded
   Signup*: il suo ID è il `config_id` passato a `FB.login`.
4. Il dominio dell'app fra quelli consentiti nelle impostazioni del Facebook
   Login (in locale serve un tunnel HTTPS, non `http://localhost`).
5. Webhook configurato **a livello di app** (Meta for Developers → WhatsApp →
   Configuration), non sul singolo numero: l'iscrizione per cliente la fa il
   passo `subscribed_apps` di questo pannello.

### Variabili d'ambiente

| Variabile | A cosa serve |
|---|---|
| `NEXT_PUBLIC_META_APP_ID` | App ID, usato dall'SDK JS nel browser |
| `META_APP_SECRET` | Scambio del `code`; se manca si usa `WHATSAPP_APP_SECRET` |
| `NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID` | `config_id` della configurazione di login |
| `NEXT_PUBLIC_META_GRAPH_API_VERSION` | Versione dell'SDK JS (default `v22.0`) |
| `NEXT_PUBLIC_META_EMBEDDED_SIGNUP_SESSION_INFO_VERSION` | `3` per le configurazioni attuali, `none` per le v4 |
| `NEXT_PUBLIC_META_EMBEDDED_SIGNUP_FEATURE_TYPE` | `whatsapp_business_app_onboarding` solo per la coesistenza |
| `WHATSAPP_TENANT_TOKEN_SECRET` | Passphrase per cifrare i token dei clienti a riposo |

Le `NEXT_PUBLIC_*` finiscono nel bundle del browser, quindi in `apphosting.yaml`
vanno dichiarate con `availability: [BUILD, RUNTIME]`. Come per `WHATSAPP_FLOW_ID`,
App Hosting rifiuta un `value` vuoto: finché non hai gli ID veri lascia le voci
commentate. Senza App ID, App secret e Configuration ID il bottone di onboarding
resta disattivato e lo spiega a schermo; il check *Embedded Signup* nella chat
dice quale dei tre manca.

> **Versioni del flusso.** L'Embedded Signup v2 va in dismissione il **15 ottobre
> 2026**. Nelle configurazioni v4 le scelte del flusso stanno tutte nella
> configurazione di Facebook Login e l'oggetto `extras` va vuoto: per questo
> `sessionInfoVersion` si può disattivare con il valore `none` invece di
> modificare il codice.

### Sicurezza dei token dei clienti

Il token ottenuto dallo scambio permette di inviare messaggi a nome del cliente,
quindi:

- non esce mai dal server: la POST restituisce solo l'esito dei passi, e
  `listWhatsAppTenants()` scarta `accessToken` e `registrationPin` prima di
  rispondere;
- la collection `whatsappTenants` è negata a qualunque client dalle regole
  Firestore (ci si arriva solo con l'Admin SDK);
- con `WHATSAPP_TENANT_TOKEN_SECRET` impostato il token è cifrato con AES-256-GCM
  (`src/lib/meta/token-vault.ts`) e il documento resta marcato
  `tokenEncrypted: true`. Senza la chiave l'onboarding funziona lo stesso, ma il
  pannello segnala che i token sono in chiaro.

Anche il **PIN** della verifica in due passaggi viene salvato: serve a ogni nuova
registrazione dello stesso numero, e senza di esso il numero va sbloccato dal
cliente. Viene mostrato una volta sola all'admin che ha completato il flusso.

### Cosa manca per essere davvero multi-tenant

L'onboarding è completo, l'inbox no. Oggi webhook e invio usano il numero unico
letto dalle variabili d'ambiente:

- **Webhook**: `POST /api/whatsapp/webhook` salva tutto in `conversations/{waId}`
  senza guardare `entry[].id` (la WABA) né `value.metadata.phone_number_id`.
  Appena un cliente è collegato, i suoi messaggi finiscono nella stessa inbox.
  Il punto giusto dove intervenire è la chiave delle conversazioni, che va estesa
  con la WABA o il numero di destinazione.
- **Invio**: `src/lib/whatsapp.ts` legge `WHATSAPP_PHONE_NUMBER_ID` e
  `WHATSAPP_ACCESS_TOKEN`. Per inviare a nome di un cliente vanno passati il suo
  numero e il suo token: `getWhatsAppTenantAccessToken(wabaId)` è già lì per
  questo.
- **Token**: quelli dei clienti possono avere scadenza (`tokenExpiresAt`); con le
  configurazioni che rilasciano token permanenti il campo vale `0`. Un controllo
  periodico delle scadenze non c'è ancora.

Finché quei tre punti non sono coperti, conviene collegare clienti solo in un
ambiente di prova.

---

## Nota sulla finestra di 24 ore

Per policy di Meta puoi inviare **messaggi liberi** — testo *e* allegati — solo
entro **24 ore** dall'ultimo messaggio del cliente (*customer service window*).
Oltre quella finestra serve un **template approvato**. La UI rileva la finestra
(`lastInboundAt`) e, se scaduta, nasconde casella di scrittura e graffetta
mostrando il selettore dei template (`TemplateMessagePanel`).
