"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function LoginPage() {
  const { user, loading, signInWithEmail } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/chat");
  }, [user, loading, router]);

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInWithEmail(email, password);
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setBusy(false);
    }
  }


  return (
    <div className="flex min-h-dvh items-center justify-center bg-wa-panel px-4 py-6 sm:px-6">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-24 w-36 items-center justify-center overflow-hidden bg-white p-0">
            <Image
              src="https://cdn.wdgtsrc.com/86576be2592f4a9e17407e97420512d17735347/ineko.jpg"
              alt="Logo Ineko Sales Chat"
              width={144}
              height={96}
              className="h-full w-full object-contain"
              priority
            />
          </div>
          <h1 className="text-xl font-semibold text-gray-800">
            Ineko Sales Chat
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Accedi per gestire le conversazioni
          </p>
        </div>

        <form onSubmit={handleEmailSubmit} className="space-y-3">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-wa-teal"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-wa-teal"
          />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-wa-teal py-2.5 text-sm font-medium text-white transition hover:bg-wa-dark disabled:opacity-60"
          >
            Accedi
          </button>
        </form>

        <p className="mt-4 rounded-lg bg-wa-panel/80 px-3 py-2 text-center text-xs text-gray-500">
          Accesso riservato: gli account vengono creati esclusivamente da un admin.
        </p>
      </div>
    </div>
  );
}

function translateAuthError(err: unknown): string {
  const code =
    typeof err === "object" && err && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email o password non corretti.";
    case "auth/email-already-in-use":
      return "Questa email è già registrata.";
    case "auth/weak-password":
      return "La password deve avere almeno 6 caratteri.";
    case "auth/invalid-email":
      return "Email non valida.";
    case "auth/popup-closed-by-user":
      return "Accesso annullato.";
    default:
      return "Si è verificato un errore. Riprova.";
  }
}
