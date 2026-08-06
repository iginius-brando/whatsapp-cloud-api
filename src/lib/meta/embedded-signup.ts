import "server-only";

import crypto from "crypto";
import {
  GraphError,
  graphRequest,
  graphUrl,
  GRAPH_VERSION,
} from "@/lib/meta/graph";
import { hasTokenEncryptionKey } from "@/lib/meta/token-vault";
import type {
  OnboardingStep,
  OnboardingStepId,
  WhatsAppTenant,
  WhatsAppTenantPhoneNumber,
} from "@/lib/types";

/**
 * Embedded Signup: onboarding dei clienti come tech provider.
 *
 * Il browser apre il flusso di Meta (vedi `src/components/EmbeddedSignupButton.tsx`)
 * e alla fine riceve due cose: un `code` scambiabile e le informazioni di
 * sessione con la WABA e il numero del cliente. Il `code` va speso qui lato
 * server — richiede l'app secret, che non può stare nel browser — per ottenere
 * un token *del cliente* con cui:
 *
 *   1. iscrivere la nostra app ai webhook della sua WABA (`subscribed_apps`);
 *   2. registrare il suo numero sulla Cloud API (`/register` con un PIN).
 *
 * Da quel momento i messaggi di quel numero arrivano al nostro webhook e
 * possiamo inviare a nome suo usando il token salvato.
 */

/** L'app id serve anche al browser, quindi accettiamo entrambe le varianti. */
function metaAppId(): string {
  return process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || "";
}

/**
 * L'app secret è lo stesso già usato per verificare la firma dei webhook:
 * WHATSAPP_APP_SECRET resta valido come ripiego per non duplicare un segreto.
 */
function metaAppSecret(): string {
  return process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET || "";
}

function embeddedSignupConfigId(): string {
  return (
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID ||
    process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID ||
    ""
  );
}

function requireAppCredentials(): { appId: string; appSecret: string } {
  const appId = metaAppId();
  const appSecret = metaAppSecret();

  if (!appId || !appSecret) {
    throw new Error(
      "Embedded Signup non configurato: servono META_APP_ID e META_APP_SECRET",
    );
  }

  return { appId, appSecret };
}

export interface EmbeddedSignupConfigStatus {
  appId: boolean;
  appSecret: boolean;
  configId: boolean;
  /** True se i token dei clienti vengono cifrati a riposo. */
  tokenEncryption: boolean;
  graphVersion: string;
}

/** Stato della configurazione, per il pannello di onboarding e i check. */
export function checkEmbeddedSignupConfig(): EmbeddedSignupConfigStatus {
  return {
    appId: Boolean(metaAppId()),
    appSecret: Boolean(metaAppSecret()),
    configId: Boolean(embeddedSignupConfigId()),
    tokenEncryption: hasTokenEncryptionKey(),
    graphVersion: GRAPH_VERSION,
  };
}

export interface ExchangedToken {
  accessToken: string;
  /** Secondi alla scadenza; assente sui token che non scadono. */
  expiresIn?: number;
}

/**
 * Scambia il `code` dell'Embedded Signup con il token del cliente.
 * Nota: è uno scambio server-to-server e il `code` è monouso, quindi un
 * secondo tentativo con lo stesso valore fallisce.
 */
export async function exchangeEmbeddedSignupCode(
  code: string,
): Promise<ExchangedToken> {
  const { appId, appSecret } = requireAppCredentials();

  const url = new URL(graphUrl("oauth/access_token"));
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("code", code);

  const res = await fetch(url, { method: "GET", cache: "no-store" });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data?.access_token) {
    const detail = data?.error?.message || JSON.stringify(data);
    throw new Error(`Scambio del code non riuscito (${res.status}): ${detail}`);
  }

  return {
    accessToken: data.access_token as string,
    expiresIn:
      typeof data.expires_in === "number" ? data.expires_in : undefined,
  };
}

export interface BusinessTokenInfo {
  scopes: string[];
  /**
   * WABA che il cliente ci ha condiviso, lette dai `granular_scopes` del token:
   * è la fonte autorevole, mentre la WABA arrivata dal browser va confrontata
   * con questa lista.
   */
  wabaIds: string[];
  /** Millisecondi epoch della scadenza; 0 se il token non scade. */
  expiresAt: number;
  /** ID dell'utente di sistema della business integration. */
  systemUserId?: string;
}

interface DebugTokenResponse {
  data?: {
    user_id?: string;
    expires_at?: number;
    scopes?: string[];
    granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
  };
}

/**
 * Legge permessi e asset del token appena ottenuto.
 * Serve a due cose: verificare che il cliente abbia davvero concesso i permessi
 * WhatsApp, e ricavare l'id della WABA senza fidarsi solo del browser.
 */
export async function inspectBusinessToken(
  token: string,
): Promise<BusinessTokenInfo> {
  const { appId, appSecret } = requireAppCredentials();

  const response = await graphRequest<DebugTokenResponse>("debug_token", {
    // Il token dell'app (`appId|appSecret`) è quello richiesto da debug_token.
    token: `${appId}|${appSecret}`,
    searchParams: { input_token: token },
  });

  const data = response.data ?? {};
  const granular = data.granular_scopes ?? [];

  const wabaIds = new Set<string>();
  for (const entry of granular) {
    if (
      entry.scope === "whatsapp_business_management" ||
      entry.scope === "whatsapp_business_messaging"
    ) {
      for (const id of entry.target_ids ?? []) wabaIds.add(id);
    }
  }

  return {
    scopes: data.scopes ?? granular.map((entry) => entry.scope),
    wabaIds: [...wabaIds],
    // expires_at = 0 significa "non scade": lo conserviamo così com'è.
    expiresAt: typeof data.expires_at === "number" ? data.expires_at * 1000 : 0,
    systemUserId: data.user_id,
  };
}

/**
 * Iscrive la nostra app ai webhook della WABA del cliente.
 * Senza questa chiamata i messaggi del cliente non arrivano mai al webhook,
 * anche se il numero è registrato correttamente.
 */
export async function subscribeAppToWaba(
  wabaId: string,
  token: string,
): Promise<void> {
  await graphRequest(`${wabaId}/subscribed_apps`, { method: "POST", token });
}

/** PIN della verifica in due passaggi, richiesto dalla registrazione. */
export function generateRegistrationPin(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export interface RegistrationResult {
  /** True se il numero era già registrato: per noi è un esito valido. */
  alreadyRegistered: boolean;
}

/**
 * Registra il numero del cliente sulla Cloud API.
 * Il PIN è quello della verifica in due passaggi: va conservato, perché serve
 * di nuovo a ogni ri-registrazione dello stesso numero.
 */
export async function registerPhoneNumber(
  phoneNumberId: string,
  pin: string,
  token: string,
): Promise<RegistrationResult> {
  try {
    await graphRequest(`${phoneNumberId}/register`, {
      method: "POST",
      token,
      body: { messaging_product: "whatsapp", pin },
    });
    return { alreadyRegistered: false };
  } catch (error) {
    // Un numero già registrato sulla Cloud API risponde con un errore, ma per
    // l'onboarding è indistinguibile dal successo: il numero è utilizzabile.
    if (error instanceof GraphError && /already registered/i.test(error.message)) {
      return { alreadyRegistered: true };
    }
    throw error;
  }
}

interface WabaResponse {
  id: string;
  name?: string;
  currency?: string;
  timezone_id?: string;
  account_review_status?: string;
}

interface PhoneNumbersResponse {
  data?: Array<{
    id: string;
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
    code_verification_status?: string;
    platform_type?: string;
  }>;
}

/** Dati della WABA del cliente, per mostrarli nel pannello. */
export async function getWabaDetails(
  wabaId: string,
  token: string,
): Promise<WabaResponse> {
  return graphRequest<WabaResponse>(wabaId, {
    token,
    searchParams: {
      fields: "id,name,currency,timezone_id,account_review_status",
    },
  });
}

/** Numeri collegati alla WABA del cliente. */
export async function listWabaPhoneNumbers(
  wabaId: string,
  token: string,
): Promise<WhatsAppTenantPhoneNumber[]> {
  const response = await graphRequest<PhoneNumbersResponse>(
    `${wabaId}/phone_numbers`,
    {
      token,
      searchParams: {
        fields:
          "id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type",
      },
    },
  );

  return (response.data ?? []).map((number) => ({
    id: number.id,
    displayPhoneNumber: number.display_phone_number,
    verifiedName: number.verified_name,
    qualityRating: number.quality_rating,
    codeVerificationStatus: number.code_verification_status,
    platformType: number.platform_type,
  }));
}

export interface OnboardingInput {
  /** `code` restituito da FB.login al termine dell'Embedded Signup. */
  code: string;
  /** WABA dichiarata dalle informazioni di sessione del browser. */
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
  /** PIN da usare per la registrazione; se assente lo generiamo noi. */
  pin?: string;
  /**
   * False per saltare la registrazione del numero: serve nei casi di
   * coesistenza con l'app WhatsApp Business, dove il numero resta sull'app.
   */
  register?: boolean;
}

export interface OnboardingResult {
  /** Il tenant da salvare: non contiene il token. */
  tenant: WhatsAppTenant;
  /** Token del cliente, da cifrare e salvare separatamente. */
  accessToken: string;
  /** PIN usato per la registrazione, quando la registrazione è avvenuta. */
  pin?: string;
  steps: OnboardingStep[];
}

function step(
  id: OnboardingStepId,
  label: string,
  ok: boolean,
  detail: string,
): OnboardingStep {
  return { id, label, ok, detail };
}

/**
 * Esegue l'onboarding completo di un cliente.
 *
 * Lo scambio del `code` è l'unico passo bloccante: senza token non c'è nulla da
 * fare. I passi successivi vengono invece tentati tutti e riportati uno per uno,
 * perché un fallimento parziale (numero da verificare, permesso mancante) è
 * frequente e va mostrato all'operatore invece di far perdere il token appena
 * ottenuto — il `code` è monouso e non si può ritentare.
 */
export async function onboardEmbeddedSignupCustomer(
  input: OnboardingInput,
): Promise<OnboardingResult> {
  const steps: OnboardingStep[] = [];

  const { accessToken } = await exchangeEmbeddedSignupCode(input.code);
  steps.push(
    step("token", "Token del cliente ottenuto", true, "Scambio del code riuscito"),
  );

  let tokenInfo: BusinessTokenInfo | null = null;
  try {
    tokenInfo = await inspectBusinessToken(accessToken);
    const missing = [
      "whatsapp_business_management",
      "whatsapp_business_messaging",
    ].filter((scope) => !tokenInfo?.scopes.includes(scope));

    steps.push(
      step(
        "permissions",
        "Permessi concessi",
        missing.length === 0,
        missing.length === 0
          ? `Permessi WhatsApp presenti${
              tokenInfo.expiresAt
                ? ` · token in scadenza il ${new Date(tokenInfo.expiresAt).toLocaleDateString("it-IT")}`
                : " · token senza scadenza"
            }`
          : `Permessi mancanti: ${missing.join(", ")}`,
      ),
    );
  } catch (error) {
    steps.push(
      step("permissions", "Permessi concessi", false, errorMessage(error)),
    );
  }

  const wabaId = input.wabaId || tokenInfo?.wabaIds[0];
  if (!wabaId) {
    throw new Error(
      "WABA del cliente non determinabile: informazioni di sessione assenti e token senza WABA condivise",
    );
  }

  let subscribed = false;
  try {
    await subscribeAppToWaba(wabaId, accessToken);
    subscribed = true;
    steps.push(
      step(
        "subscribe",
        "Webhook sottoscritti",
        true,
        `App iscritta agli eventi della WABA ${wabaId}`,
      ),
    );
  } catch (error) {
    steps.push(
      step("subscribe", "Webhook sottoscritti", false, errorMessage(error)),
    );
  }

  const shouldRegister = input.register !== false && Boolean(input.phoneNumberId);
  const pin = shouldRegister ? input.pin || generateRegistrationPin() : undefined;
  let registered = false;

  if (shouldRegister && input.phoneNumberId && pin) {
    try {
      const result = await registerPhoneNumber(
        input.phoneNumberId,
        pin,
        accessToken,
      );
      registered = true;
      steps.push(
        step(
          "register",
          "Numero registrato sulla Cloud API",
          true,
          result.alreadyRegistered
            ? "Il numero era già registrato"
            : "Registrazione completata con la verifica in due passaggi",
        ),
      );
    } catch (error) {
      steps.push(
        step(
          "register",
          "Numero registrato sulla Cloud API",
          false,
          errorMessage(error),
        ),
      );
    }
  } else {
    steps.push(
      step(
        "register",
        "Numero registrato sulla Cloud API",
        false,
        input.phoneNumberId
          ? "Registrazione saltata su richiesta"
          : "Nessun numero restituito dal flusso: registrazione da completare a mano",
      ),
    );
  }

  let details: WabaResponse | null = null;
  let phoneNumbers: WhatsAppTenantPhoneNumber[] = [];
  try {
    [details, phoneNumbers] = await Promise.all([
      getWabaDetails(wabaId, accessToken),
      listWabaPhoneNumbers(wabaId, accessToken),
    ]);
    steps.push(
      step(
        "details",
        "Dati della WABA letti",
        true,
        `${details.name || wabaId} · ${phoneNumbers.length} numero/i`,
      ),
    );
  } catch (error) {
    steps.push(step("details", "Dati della WABA letti", false, errorMessage(error)));
  }

  const tenant: WhatsAppTenant = {
    wabaId,
    ...(input.businessId ? { businessId: input.businessId } : {}),
    ...(details?.name ? { name: details.name } : {}),
    ...(details?.currency ? { currency: details.currency } : {}),
    ...(details?.timezone_id ? { timezoneId: details.timezone_id } : {}),
    ...(details?.account_review_status
      ? { accountReviewStatus: details.account_review_status }
      : {}),
    phoneNumbers,
    ...(input.phoneNumberId ? { defaultPhoneNumberId: input.phoneNumberId } : {}),
    ...(tokenInfo ? { grantedScopes: tokenInfo.scopes } : {}),
    tokenExpiresAt: tokenInfo?.expiresAt ?? 0,
    subscribed,
    registered,
    status: steps.every((entry) => entry.ok) ? "connected" : "incomplete",
    steps,
  };

  return { tenant, accessToken, pin, steps };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Errore sconosciuto";
}
