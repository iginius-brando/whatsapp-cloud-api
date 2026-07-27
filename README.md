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
- **Stati**: le spunte (inviato ✓, consegnato/letto ✓✓) arrivano dagli eventi
  `statuses` del webhook.

## Struttura del progetto

```
src/
├── app/
│   ├── api/whatsapp/
│   │   ├── webhook/route.ts   # GET verifica + POST eventi (messaggi/stati)
│   │   └── send/route.ts      # invio testo (auth con ID token Firebase)
│   ├── chat/page.tsx          # UI chat (protetta)
│   ├── login/page.tsx         # login Google + email/password
│   ├── layout.tsx / page.tsx  # root + redirect
│   └── globals.css
├── components/                # ChatList, ChatWindow, MessageBubble, Composer
├── context/AuthContext.tsx    # stato autenticazione
├── hooks/useChat.ts           # sottoscrizioni Firestore realtime
└── lib/
    ├── firebase/client.ts     # SDK client
    ├── firebase/admin.ts      # SDK admin (server)
    ├── firebase/firestore-admin.ts  # scritture messaggi/conversazioni
    ├── whatsapp.ts            # Graph API + verifica firma webhook
    └── types.ts / format.ts
```

## Modello dati Firestore

```
conversations/{waId}
  waId, name, lastMessage, lastMessageAt, lastMessageDirection,
  unreadCount, lastInboundAt
  └── messages/{messageId}
        id, direction (in|out), type, text, status, timestamp
```

`waId` = numero del cliente in formato E.164 senza `+` (es. `393331234567`).

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
firebase apphosting:secrets:set whatsapp-webhook-verify-token
firebase apphosting:secrets:set whatsapp-app-secret
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
- `src/lib/flows/appointment.ts` — macchina a stati delle schermate. Le funzioni
  `listDepartments` / `listLocations` / `listDates` / `listTimes` sono il punto in
  cui collegare la disponibilità reale: oggi restituiscono dati di esempio.
- `src/app/api/whatsapp/flow-endpoint/route.ts` — l'endpoint da configurare su Meta.
- `src/app/api/whatsapp/send-flow/route.ts` — invio del messaggio che apre il Flow.

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

In `apphosting.yaml` imposta `WHATSAPP_FLOW_ID` con l'ID del Flow e
`WHATSAPP_FLOW_DRAFT_MODE: "true"` finché il Flow è in bozza (in bozza l'invio
funziona solo verso i numeri di test dell'app). Poi fai il deploy: l'endpoint
deve essere già online prima del passo successivo.

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

## Nota sulla finestra di 24 ore

Per policy di Meta puoi inviare **testo libero** solo entro **24 ore**
dall'ultimo messaggio del cliente (*customer service window*). Oltre quella
finestra serve un **template approvato**. La UI rileva la finestra
(`lastInboundAt`) e, se scaduta, disabilita la casella di scrittura mostrando un
avviso. L'invio di template non è incluso in questo scaffold: si può aggiungere
in `lib/whatsapp.ts` con una funzione `sendTemplateMessage` e un selettore di
modelli nel composer.
