"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function LoginPage() {
  const { user, loading, signInWithGoogle, signInWithEmail, registerWithEmail } =
    useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<"login" | "register">("login");
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
      if (mode === "login") {
        await signInWithEmail(email, password);
      } else {
        await registerWithEmail(email, password);
      }
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-wa-panel px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 h-20 w-20 overflow-hidden rounded-full bg-white shadow-sm ring-1 ring-gray-200">
            <Image
              src="https://cdn.wdgtsrc.com/86576be2592f4a9e17407e97420512d17735347/ineko.jpg"
              alt="Logo Ineko Sales Chat"
              width={80}
              height={80}
              className="h-full w-full object-cover"
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

        <button
          onClick={handleGoogle}
          disabled={busy}
          className="mb-5 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continua con Google
        </button>

        <div className="mb-5 flex items-center gap-3 text-xs text-gray-400">
          <div className="h-px flex-1 bg-gray-200" />
          oppure
          <div className="h-px flex-1 bg-gray-200" />
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
            {mode === "login" ? "Accedi" : "Registrati"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-500">
          {mode === "login" ? "Non hai un account?" : "Hai già un account?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
            className="font-medium text-wa-teal hover:underline"
          >
            {mode === "login" ? "Registrati" : "Accedi"}
          </button>
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
