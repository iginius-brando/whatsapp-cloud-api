# WhatsApp Cloud Chat

Interfaccia di chat in stile WhatsApp costruita **direttamente** sulle
[WhatsApp Cloud API di Meta](https://developers.facebook.com/docs/whatsapp/cloud-api),
senza partner intermedi (tipo SendPulse). Gli operatori accedono con Firebase
Authentication e condividono un'unica inbox: tutti vedono e rispondono a tutte
le conversazioni del numero WhatsApp aziendale.

## Stack

- **Next.js 15** (App Router, TypeScript) — SSR + API routes
- **Firebase App Hosting** — deploy
- **Firestore** — conversazioni e messaggi, con aggiornamento realtime
- **Firebase Authentication** — login operatori (Google + email/password)
- **WhatsApp Cloud API** — invio/ricezione messaggi

## Come funziona

```
Cliente WhatsApp
      │  (messaggio)
      ▼
Meta Cloud API ──POST──►  /api/whatsapp/webhook  ──►  Firestore
      ▲                                                   │
      │  (invio via Graph API)                            │ realtime
      │                                                   ▼
/api/whatsapp/send  ◄── operatore ◄──── UI chat (onSnapshot)
```

- **Ricezione**: Meta invia gli eventi (messaggi + stati di consegna) al webhook
  `POST /api/whatsapp/webhook`. La firma `X-Hub-Signature-256` viene verificata
  con l'App Secret. I messaggi vengono salvati su Firestore tramite l'Admin SDK.
- **Realtime**: la UI ascolta Firestore con `onSnapshot`, quindi le nuove chat e
  i nuovi messaggi compaiono senza refresh.
- **Invio**: l'operatore scrive dalla UI → `POST /api/whatsapp/send` (protetto da
  ID token Firebase) → Graph API → il messaggio viene salvato su Firestore.
- **Allegati**: immagini, video, audio e documenti viaggiano in entrambe le
  direzioni (vedi [Allegati](#allegati-immagini-video-audio-e-documenti)).
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
    ├── firebase/admin.ts      # SDK admin (server)
    ├── firebase/firestore-admin.ts  # scritture messaggi/conversazioni/tenant
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
          { id, mimeType, filename, size, sha256, voice, animated }
        replyTo                 # solo sulle risposte:
          { id, direction, type, text }

whatsappTenants/{wabaId}        # clienti onboardati via Embedded Signup
  wabaId, businessId, name, currency, timezoneId, accountReviewStatus,
  phoneNumbers[], defaultPhoneNumberId, grantedScopes[], tokenExpiresAt,
  subscribed, registered, status, steps[], connectedByUid, connectedByEmail
  accessToken, tokenEncrypted, registrationPin   # solo lato server
```

`waId` = numero del cliente in formato E.164 senza `+` (es. `393331234567`).

I byte degli allegati **non** finiscono su Firestore: si salva solo il `media.id`
di WhatsApp e il file si scarica al volo dalla Graph API.

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

Pubblica infine le regole Firestore:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

---

## Allegati (immagini, video, audio e documenti)

Gli allegati funzionano in **entrambe le direzioni** e non richiedono alcuna
configurazione aggiuntiva: bastano `WHATSAPP_ACCESS_TOKEN` e
`WHATSAPP_PHONE_NUMBER_ID`, gli stessi già usati per il testo.

```
Invio      file dal composer ──► POST /api/whatsapp/send-media
                                   ├─ upload su /{phone-number-id}/media  → media id
                                   └─ invio del messaggio per id          → wamid

Ricezione  webhook ──► salva { type, media.id, mimeType, filename } su Firestore
           UI ──► GET /api/whatsapp/media/{id} ──► Graph API ──► byte al browser
```

### Perché serve un proxy per la lettura

I media di Meta non sono pubblici. Il webhook consegna solo un `id`; per
ottenere i byte bisogna prima risolverlo in un URL temporaneo (scade in pochi
minuti) e poi scaricarlo passando l'access token. Quel token non può stare nel
browser, quindi `GET /api/whatsapp/media/{mediaId}` fa da proxy: verifica l'ID
token Firebase dell'operatore e inoltra lo stream. La UI lo chiama via `fetch` e
converte la risposta in un object URL (`src/hooks/useMedia.ts`), che tiene in
cache finché il componente è montato.

Conseguenza pratica: **Meta conserva i media 30 giorni**. Dopo quel periodo la
chat mostra ancora il messaggio, ma l'allegato non è più scaricabile. Se serve
conservarli a lungo, il punto giusto dove intervenire è il webhook: copiare il
file su Cloud Storage e salvarne il riferimento accanto a `media.id`.

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

La ridondanza è voluta: la chat carica gli ultimi 500 messaggi, quindi con il
solo id una citazione a un messaggio più vecchio resterebbe vuota. Con
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
