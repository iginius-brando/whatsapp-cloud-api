"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  formatFileSize,
  maxBytesFor,
  mediaKindLabel,
  normalizeMimeType,
  resolveMediaKind,
  type MediaKind,
} from "@/lib/media";

interface Props {
  waId: string;
  file: File;
  onCancel: () => void;
  onSent: () => void;
}

interface SendMediaResponse {
  messageId?: string;
  error?: string;
}

/**
 * `fetch` non espone l'avanzamento dell'upload: per un video da 16 MB una barra
 * di progresso fa la differenza, quindi qui si usa XMLHttpRequest.
 */
function uploadWithProgress(
  form: FormData,
  idToken: string,
  onProgress: (percent: number) => void,
): Promise<SendMediaResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/whatsapp/send-media");
    xhr.setRequestHeader("Authorization", `Bearer ${idToken}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      let data: SendMediaResponse = {};
      try {
        data = JSON.parse(xhr.responseText) as SendMediaResponse;
      } catch {
        // Risposta non JSON: sotto usiamo comunque lo status code.
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        reject(new Error(data.error || `Invio non riuscito (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error("Connessione interrotta durante l'invio"));
    xhr.onabort = () => reject(new Error("Invio annullato"));

    xhr.send(form);
  });
}

function KindIcon({ kind }: { kind: MediaKind }) {
  const path =
    kind === "audio"
      ? "M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"
      : kind === "video"
        ? "M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"
        : "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 2.5L18.5 9H14V4.5z";

  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-wa-teal/10 text-wa-teal">
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
        <path d={path} />
      </svg>
    </span>
  );
}

/** Anteprima dell'allegato scelto, con didascalia e invio. */
export default function AttachmentComposer({ waId, file, onCancel, onSent }: Props) {
  const { user } = useAuth();
  const [caption, setCaption] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { kind, limit, tooBig, downgradedFrom } = useMemo(() => {
    const mimeType = normalizeMimeType(file.type, file.name);
    const resolved = resolveMediaKind(mimeType);
    const max = maxBytesFor(resolved);

    // Un jpeg parte come immagine, un webp no: WhatsApp accetta solo alcuni
    // formati per immagine/video/audio, gli altri viaggiano come documento.
    const topLevel = mimeType.split("/")[0];
    const downgraded =
      resolved === "document" && ["image", "video", "audio"].includes(topLevel)
        ? topLevel
        : null;

    return {
      kind: resolved,
      limit: max,
      tooBig: file.size > max,
      downgradedFrom: downgraded,
    };
  }, [file]);

  // Anteprima locale: nessun round-trip al server prima dell'invio.
  useEffect(() => {
    if (kind !== "image" && kind !== "video") return;

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setPreviewUrl(null);
    };
  }, [file, kind]);

  // Meta ignora la didascalia su audio e sticker: meglio non offrirla affatto.
  const acceptsCaption = kind !== "audio" && kind !== "sticker";

  async function send() {
    if (!user || sending || tooBig) return;

    setSending(true);
    setProgress(0);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const form = new FormData();
      form.append("to", waId);
      form.append("file", file, file.name);
      if (acceptsCaption && caption.trim()) form.append("caption", caption.trim());

      await uploadWithProgress(form, idToken, setProgress);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore di invio");
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-xl border border-wa-teal/20 bg-white p-3 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-gray-800">
          Invia {mediaKindLabel(kind)}
        </p>
        <button
          type="button"
          onClick={onCancel}
          disabled={sending}
          className="shrink-0 text-gray-400 transition hover:text-gray-700 disabled:opacity-50"
          aria-label="Rimuovi allegato"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-3">
        {previewUrl && kind === "image" ? (
          /* Anteprima locale da object URL: next/image non la può ottimizzare. */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={previewUrl}
            alt="Anteprima"
            className="h-20 w-20 shrink-0 rounded-lg object-cover"
          />
        ) : previewUrl && kind === "video" ? (
          <video
            src={previewUrl}
            className="h-20 w-20 shrink-0 rounded-lg bg-black object-cover"
            muted
          />
        ) : (
          <KindIcon kind={kind} />
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-800">{file.name}</p>
          <p className="text-xs text-gray-500">
            {formatFileSize(file.size)}
            {file.type ? ` · ${file.type}` : ""}
          </p>
          {downgradedFrom && (
            <p className="mt-0.5 text-[11px] text-amber-700">
              WhatsApp non accetta questo formato come {downgradedFrom}: sarà
              inviato come documento.
            </p>
          )}
        </div>
      </div>

      {tooBig && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          File troppo grande: il limite per un {mediaKindLabel(kind)} è{" "}
          {formatFileSize(limit)}.
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      {acceptsCaption && (
        <input
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          disabled={sending}
          placeholder="Aggiungi una didascalia (facoltativa)"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-wa-teal disabled:bg-gray-50"
        />
      )}

      {sending && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-wa-teal transition-all"
            style={{ width: `${Math.max(progress, 5)}%` }}
          />
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={sending}
          className="rounded-lg px-3 py-2 text-sm text-gray-600 transition hover:bg-black/5 disabled:opacity-50"
        >
          Annulla
        </button>
        <button
          type="submit"
          disabled={sending || tooBig}
          className="flex items-center gap-2 rounded-lg bg-wa-teal px-4 py-2 text-sm font-semibold text-white transition hover:bg-wa-dark disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
          {sending ? `Invio… ${progress}%` : "Invia"}
        </button>
      </div>
    </form>
  );
}
