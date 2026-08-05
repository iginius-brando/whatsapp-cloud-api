"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { downloadMediaFile, useMediaObjectUrl } from "@/hooks/useMedia";
import { formatFileSize } from "@/lib/media";
import type { ChatMessage, MessageMedia } from "@/lib/types";

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-6 text-xs text-gray-500">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-wa-teal" />
      {label}
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
      <p>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 font-semibold underline underline-offset-2"
      >
        Riprova
      </button>
    </div>
  );
}

function ImageAttachment({ media, isSticker }: { media: MessageMedia; isSticker?: boolean }) {
  const { url, loading, error, retry } = useMediaObjectUrl(media);

  if (error) return <LoadError message={error} onRetry={retry} />;
  if (loading || !url) return <Spinner label="Caricamento immagine…" />;

  return (
    <a href={url} target="_blank" rel="noreferrer" title="Apri a schermo intero">
      {/* Object URL da blob: next/image non può ottimizzarlo. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={media.filename || "Immagine ricevuta"}
        className={
          isSticker
            ? "max-h-40 w-auto object-contain"
            : "max-h-80 w-auto rounded-lg object-contain"
        }
      />
    </a>
  );
}

function VideoAttachment({ media }: { media: MessageMedia }) {
  // I video arrivano fino a 16 MB: si scaricano solo su richiesta.
  const [opened, setOpened] = useState(false);
  const { url, loading, error, retry } = useMediaObjectUrl(media, opened);

  if (error) return <LoadError message={error} onRetry={retry} />;

  if (!opened) {
    return (
      <button
        type="button"
        onClick={() => setOpened(true)}
        className="flex w-56 items-center gap-3 rounded-lg bg-black/80 px-3 py-6 text-left text-white transition hover:bg-black/70"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">Riproduci video</span>
          {media.size ? (
            <span className="block text-xs text-white/70">
              {formatFileSize(media.size)}
            </span>
          ) : null}
        </span>
      </button>
    );
  }

  if (loading || !url) return <Spinner label="Caricamento video…" />;

  return (
    <video
      src={url}
      controls
      autoPlay
      className="max-h-80 w-full max-w-sm rounded-lg bg-black"
    />
  );
}

function AudioAttachment({ media }: { media: MessageMedia }) {
  const { url, loading, error, retry } = useMediaObjectUrl(media);

  if (error) return <LoadError message={error} onRetry={retry} />;
  if (loading || !url) return <Spinner label="Caricamento audio…" />;

  return (
    <div className="w-60 max-w-full sm:w-72">
      <audio src={url} controls className="w-full" />
      {media.voice ? null : (
        <p className="mt-0.5 truncate text-[11px] text-gray-500">
          {media.filename || "File audio"}
        </p>
      )}
    </div>
  );
}

function DocumentAttachment({ media }: { media: MessageMedia }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (!user || busy) return;

    setBusy(true);
    setError(null);
    try {
      await downloadMediaFile(media, user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download non riuscito");
    } finally {
      setBusy(false);
    }
  }

  const details = [
    media.filename ? null : "Documento",
    formatFileSize(media.size),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="w-60 max-w-full sm:w-72">
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        className="flex w-full items-center gap-2.5 rounded-lg bg-black/5 px-2.5 py-2 text-left transition hover:bg-black/10 disabled:opacity-60"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-wa-teal/10 text-wa-teal">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 2.5L18.5 9H14V4.5zM8 13h8v1.5H8V13zm0 3.5h8V18H8v-1.5z" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-800">
            {media.filename || "Documento"}
          </span>
          <span className="block text-[11px] text-gray-500">
            {busy ? "Download in corso…" : details || "Tocca per scaricare"}
          </span>
        </span>
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 text-gray-500"
          fill="currentColor"
        >
          <path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z" />
        </svg>
      </button>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

/** Anteprima dell'allegato dentro la bolla del messaggio. */
export default function MediaAttachment({ message }: { message: ChatMessage }) {
  const media = message.media;
  if (!media?.id) return null;

  switch (message.type) {
    case "image":
      return <ImageAttachment media={media} />;
    case "sticker":
      return <ImageAttachment media={media} isSticker />;
    case "video":
      return <VideoAttachment media={media} />;
    case "audio":
      return <AudioAttachment media={media} />;
    default:
      return <DocumentAttachment media={media} />;
  }
}
