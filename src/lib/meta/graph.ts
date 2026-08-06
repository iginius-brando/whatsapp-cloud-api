import "server-only";

/**
 * Helper comuni per le Graph API di Meta, condivisi fra la Cloud API
 * (`src/lib/whatsapp.ts`) e l'onboarding dei clienti via Embedded Signup
 * (`src/lib/meta/embedded-signup.ts`).
 */

export const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v22.0";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variabile d'ambiente mancante: ${name}`);
  }
  return value;
}

export function graphUrl(path: string): string {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${path}`;
}

/**
 * Errore restituito dalla Graph API. Conserva `code` e `subcode` perché alcuni
 * passi dell'onboarding vanno distinti dal messaggio: un numero già registrato,
 * per esempio, non è un fallimento.
 */
export class GraphError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly subcode?: number;

  constructor(
    message: string,
    status: number,
    code?: number,
    subcode?: number,
  ) {
    super(message);
    this.name = "GraphError";
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
}

export interface GraphRequestOptions {
  method?: "GET" | "POST";
  /** Access token da usare: quello del provider o quello del cliente. */
  token: string;
  /** Query string; le chiavi con valore undefined vengono ignorate. */
  searchParams?: Record<string, string | undefined>;
  /** Corpo JSON, solo per le POST. */
  body?: Record<string, unknown>;
}

/** Chiamata alla Graph API con gestione uniforme degli errori. */
export async function graphRequest<T>(
  path: string,
  options: GraphRequestOptions,
): Promise<T> {
  const { method = "GET", token, searchParams, body } = options;

  const url = new URL(graphUrl(path));
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = (data as { error?: Record<string, unknown> })?.error;
    const message =
      typeof error?.message === "string" ? error.message : JSON.stringify(data);
    throw new GraphError(
      message,
      res.status,
      typeof error?.code === "number" ? error.code : undefined,
      typeof error?.error_subcode === "number" ? error.error_subcode : undefined,
    );
  }

  return data as T;
}
