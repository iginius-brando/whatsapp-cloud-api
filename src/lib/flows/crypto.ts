import "server-only";

import crypto from "crypto";

/**
 * Crittografia del Flow Endpoint (WhatsApp Flows, data_api_version 3.0).
 *
 * Ogni richiesta che Meta invia all'endpoint è cifrata con uno schema ibrido:
 *
 *   1. Meta genera una chiave AES effimera per singola sessione di Flow.
 *   2. La chiave AES viene cifrata con la NOSTRA chiave pubblica RSA
 *      (RSA-OAEP + SHA-256) e arriva in `encrypted_aes_key`.
 *   3. Il payload JSON è cifrato in AES-GCM con quella chiave e con l'IV
 *      passato in chiaro in `initial_vector`; il tag di autenticazione (16
 *      byte) è appeso in coda al ciphertext.
 *
 * La risposta va cifrata con la STESSA chiave AES ma con l'IV invertito bit a
 * bit: è il modo con cui Meta distingue la direzione del messaggio ed evita il
 * riuso di (chiave, IV), che in GCM sarebbe catastrofico.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/flows/reference/implementingyourflowendpoint
 */

/** Lunghezza del tag di autenticazione GCM, in byte. */
const GCM_TAG_LENGTH = 16;

/** Corpo (cifrato) di ogni richiesta al Flow Endpoint. */
export interface EncryptedFlowRequest {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}

/** Payload in chiaro, una volta decifrata la richiesta. */
export interface FlowRequestPayload {
  version: string;
  /** "ping" (health check), "error" (segnalazione client), INIT, BACK, data_exchange. */
  action: string;
  /** Schermata da cui arriva la richiesta. Assente su INIT e ping. */
  screen?: string;
  data?: Record<string, unknown>;
  /** Token che abbiamo generato noi al momento dell'invio del Flow. */
  flow_token?: string;
}

/** Materiale crittografico della richiesta, necessario per cifrare la risposta. */
export interface FlowCryptoContext {
  aesKey: Buffer;
  initialVector: Buffer;
}

/** Sollevata quando la richiesta non è decifrabile: va tradotta in HTTP 421. */
export class FlowDecryptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FlowDecryptionError";
  }
}

/**
 * Carica la chiave privata RSA dall'ambiente.
 *
 * La chiave sta in una variabile d'ambiente, quindi accettiamo sia il PEM con
 * newline reali sia la forma "a riga singola" con `\n` letterali, che è quella
 * che sopravvive alla maggior parte dei gestori di segreti.
 */
function loadPrivateKey(): crypto.KeyObject {
  const raw = process.env.WHATSAPP_FLOW_PRIVATE_KEY;
  if (!raw) {
    throw new FlowDecryptionError(
      "Variabile d'ambiente mancante: WHATSAPP_FLOW_PRIVATE_KEY",
    );
  }

  const pem = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
  const passphrase = process.env.WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE;

  try {
    return crypto.createPrivateKey(
      passphrase ? { key: pem, passphrase } : { key: pem },
    );
  } catch (err) {
    throw new FlowDecryptionError(
      "Chiave privata del Flow non valida (PEM o passphrase errati)",
      { cause: err },
    );
  }
}

/** Nome dell'algoritmo GCM corrispondente alla lunghezza della chiave AES. */
function gcmAlgorithm(aesKey: Buffer): crypto.CipherGCMTypes {
  const bits = aesKey.length * 8;
  if (bits !== 128 && bits !== 192 && bits !== 256) {
    throw new FlowDecryptionError(`Lunghezza chiave AES inattesa: ${bits} bit`);
  }
  return `aes-${bits}-gcm`;
}

/** Decifra una richiesta del Flow Endpoint. */
export function decryptFlowRequest(body: EncryptedFlowRequest): {
  payload: FlowRequestPayload;
  context: FlowCryptoContext;
} {
  if (
    !body?.encrypted_flow_data ||
    !body?.encrypted_aes_key ||
    !body?.initial_vector
  ) {
    throw new FlowDecryptionError("Corpo della richiesta incompleto");
  }

  const privateKey = loadPrivateKey();

  // 1. Chiave AES: RSA-OAEP con SHA-256 (non SHA-1, che è il default di Node).
  let aesKey: Buffer;
  try {
    aesKey = crypto.privateDecrypt(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(body.encrypted_aes_key, "base64"),
    );
  } catch (err) {
    throw new FlowDecryptionError(
      "Impossibile decifrare la chiave AES: la chiave pubblica caricata su Meta non corrisponde a quella privata configurata",
      { cause: err },
    );
  }

  // 2. Payload: AES-GCM, con il tag di autenticazione negli ultimi 16 byte.
  const initialVector = Buffer.from(body.initial_vector, "base64");
  const encrypted = Buffer.from(body.encrypted_flow_data, "base64");

  if (encrypted.length <= GCM_TAG_LENGTH) {
    throw new FlowDecryptionError("Payload cifrato troppo corto");
  }

  const ciphertext = encrypted.subarray(0, encrypted.length - GCM_TAG_LENGTH);
  const authTag = encrypted.subarray(encrypted.length - GCM_TAG_LENGTH);

  let plaintext: string;
  try {
    const decipher = crypto.createDecipheriv(
      gcmAlgorithm(aesKey),
      aesKey,
      initialVector,
    );
    decipher.setAuthTag(authTag);
    plaintext =
      decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
  } catch (err) {
    throw new FlowDecryptionError("Payload del Flow non decifrabile", {
      cause: err,
    });
  }

  let payload: FlowRequestPayload;
  try {
    payload = JSON.parse(plaintext);
  } catch (err) {
    throw new FlowDecryptionError("Payload del Flow non è JSON valido", {
      cause: err,
    });
  }

  return { payload, context: { aesKey, initialVector } };
}

/**
 * Cifra la risposta con la chiave AES della richiesta e l'IV invertito.
 * Il valore restituito è la stringa base64 da mandare come corpo della risposta
 * (testo semplice, non JSON).
 */
export function encryptFlowResponse(
  response: unknown,
  context: FlowCryptoContext,
): string {
  const { aesKey, initialVector } = context;

  // IV invertito bit a bit, come richiesto dalla specifica.
  const flippedIv = Buffer.from(initialVector.map((byte) => ~byte & 0xff));

  const cipher = crypto.createCipheriv(
    gcmAlgorithm(aesKey),
    aesKey,
    flippedIv,
  );

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(response), "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  return encrypted.toString("base64");
}
