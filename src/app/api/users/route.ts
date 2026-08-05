import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyAdmin(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!idToken) {
    return { error: "Non autenticato", status: 401 } as const;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    if (decoded.admin !== true) {
      return { error: "Solo un admin può gestire gli utenti", status: 403 } as const;
    }
    return { decoded } as const;
  } catch {
    return { error: "Token non valido", status: 401 } as const;
  }
}

export async function GET(request: Request) {
  const auth = await verifyAdmin(request);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const users = await adminAuth.listUsers(100);
  return NextResponse.json({
    ok: true,
    users: users.users.map((user) => ({
      uid: user.uid,
      email: user.email ?? "",
      displayName: user.displayName ?? "",
      disabled: user.disabled,
      admin: user.customClaims?.admin === true,
      createdAt: user.metadata.creationTime,
      lastSignInAt: user.metadata.lastSignInTime,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await verifyAdmin(request);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    displayName?: string;
    admin?: boolean;
  };

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  const displayName = body.displayName?.trim();

  if (!email || !password) {
    return NextResponse.json({ ok: false, error: "Email e password sono obbligatorie" }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ ok: false, error: "La password deve avere almeno 6 caratteri" }, { status: 400 });
  }

  try {
    const user = await adminAuth.createUser({
      email,
      password,
      displayName: displayName || undefined,
      emailVerified: true,
      disabled: false,
    });

    if (body.admin === true) {
      await adminAuth.setCustomUserClaims(user.uid, { admin: true });
    }

    return NextResponse.json({ ok: true, uid: user.uid });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Creazione utente non riuscita";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
