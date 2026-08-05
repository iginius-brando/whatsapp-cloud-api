"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "@/context/AuthContext";
import type { MessageMedia } from "@/lib/types";

/**
 * Gli allegati non sono URL pubblici: vanno chiesti a `/api/whatsapp/media/{id}`
 * con l'ID token dell'operatore, quindi non possono finire direttamente in un
 * `<img src>`. Qui li scarichiamo una volta sola e li trasformiamo in object URL
 * riutilizzabili dai vari componenti.
 */

interface CacheEntry {
  promise: Promise<string>;
  /** Quanti componenti stanno usando l'object URL in questo momento. */
  refs: number;
}

const cache = new Map<string, CacheEntry>();

/** Allegati inattivi tenuti in memoria prima di liberare gli object URL. */
const MAX_IDLE_CACHED = 20;

function mediaEndpoint(mediaId: string, filename?: string): string {
  const query = filename ? `?filename=${encodeURIComponent(filename)}` : "";
  return `/api/whatsapp/media/${encodeURIComponent(mediaId)}${query}`;
}

async function fetchObjectUrl(
  mediaId: string,
  filename: string | undefined,
  user: User,
): Promise<string> {
  const idToken = await user.getIdToken();
  const res = await fetch(mediaEndpoint(mediaId, filename), {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Allegato non disponibile");
  }

  return URL.createObjectURL(await res.blob());
}

/** Libera gli object URL più vecchi che nessun componente sta più mostrando. */
function evictIdleEntries(): void {
  // La Map conserva l'ordine di inserimento: i primi sono i più vecchi.
  const idle = [...cache.entries()].filter(([, entry]) => entry.refs === 0);

  for (const [key, entry] of idle.slice(0, idle.length - MAX_IDLE_CACHED)) {
    cache.delete(key);
    void entry.promise.then(URL.revokeObjectURL).catch(() => {});
  }
}

function acquireMedia(
  mediaId: string,
  filename: string | undefined,
  user: User,
): Promise<string> {
  const existing = cache.get(mediaId);
  if (existing) {
    existing.refs += 1;
    return existing.promise;
  }

  const promise = fetchObjectUrl(mediaId, filename, user).catch((err) => {
    // Un download fallito non va memorizzato: al prossimo tentativo si riprova.
    cache.delete(mediaId);
    throw err;
  });

  cache.set(mediaId, { promise, refs: 1 });
  return promise;
}

function releaseMedia(mediaId: string): void {
  const entry = cache.get(mediaId);
  if (!entry) return;

  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0) evictIdleEntries();
}

export interface MediaUrlState {
  /** Object URL pronto per `<img>`, `<video>` o `<audio>`. */
  url: string | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Scarica un allegato e ne restituisce l'object URL.
 * Con `enabled = false` non scarica nulla: serve per i media pesanti (video),
 * che partono solo quando l'operatore li apre davvero.
 */
export function useMediaObjectUrl(
  media: MessageMedia | undefined,
  enabled = true,
): MediaUrlState {
  const { user } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const mediaId = media?.id;
  const filename = media?.filename;

  useEffect(() => {
    if (!enabled || !mediaId || !user) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    acquireMedia(mediaId, filename, user)
      .then((objectUrl) => {
        if (!cancelled) setUrl(objectUrl);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Allegato non disponibile");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      releaseMedia(mediaId);
    };
  }, [enabled, mediaId, filename, user, attempt]);

  const retry = useCallback(() => {
    if (mediaId) cache.delete(mediaId);
    setUrl(null);
    setAttempt((current) => current + 1);
  }, [mediaId]);

  return { url, loading, error, retry };
}

/**
 * Scarica un allegato e lo salva sul computer dell'operatore.
 * Non passa dalla cache: i documenti possono pesare parecchio e vengono aperti
 * una volta sola.
 */
export async function downloadMediaFile(
  media: MessageMedia,
  user: User,
): Promise<void> {
  const objectUrl = await fetchObjectUrl(media.id, media.filename, user);

  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = media.filename || `allegato-${media.id}`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Revoca ritardata: alcuni browser annullano il download se l'object URL
  // sparisce prima che sia partito.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
