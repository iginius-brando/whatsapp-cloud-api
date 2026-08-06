import "server-only";

import crypto from "crypto";

/**
 * Cifratura a riposo dei token dei clienti.
 *
 * Come tech provider non custodiamo più solo il nostro token: dopo l'Embedded
 * Signup teniamo un token per ogni cliente onboardato, e quel token dà accesso
 * alla sua WABA. Sta su Firestore, dove le regole negano ogni accesso dal
 * client, ma un secondo strato non guasta: con
 * `WHATSAPP_TENANT_TOKEN_SECRET` impostato il valore salvato è cifrato e chi
 * legge il database senza la chiave non ottiene un token utilizzabile.
 *
 * Senza la chiave il token viene salvato in chiaro e il documento resta marcato
 * con `tokenEncrypted: false`: l'onboarding funziona comunque (utile in
 * sviluppo) ma la UI lo segnala come configurazione da completare.
 */

const SECRET_ENV = "WHATSAPP_TENANT_TOKEN_SECRET";
const PREFIX = "v1";
/** Etichetta fissa: la derivazione deve essere riproducibile fra i deploy. */
const KEY_SALT = "whatsapp-tenant-token";

export function hasTokenEncryptionKey(): boolean {
  return Boolean(process.env[SECRET_ENV]);
}

function encryptionKey(): Buffer {
  const secret = process.env[SECRET_ENV];
  if (!secret) throw new Error(`Variabile d'ambiente mancante: ${SECRET_ENV}`);
  // scrypt accetta una passphrase qualsiasi e ne ricava i 32 byte di AES-256.
  return crypto.scryptSync(secret, KEY_SALT, 32);
}

export interface SealedToken {
  /** Token cifrato ("v1:iv:tag:ciphertext" in base64) oppure in chiaro. */
  value: string;
  encrypted: boolean;
}

export function sealToken(token: string): SealedToken {
  if (!hasTokenEncryptionKey()) return { value: token, encrypted: false };

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  return {
    value: [
      PREFIX,
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      ciphertext.toString("base64"),
    ].join(":"),
    encrypted: true,
  };
}

export function openToken(sealed: SealedToken): string {
  if (!sealed.encrypted) return sealed.value;

  const [prefix, iv, tag, ciphertext] = sealed.value.split(":");
  if (prefix !== PREFIX || !iv || !tag || !ciphertext) {
    throw new Error("Token del cliente in un formato non riconosciuto");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
