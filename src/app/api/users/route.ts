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
    if (decoded.admin === true) {
      return { decoded } as const;
    }

    // Custom claims are cached in the ID token until Firebase refreshes it.
    // Check the current user record as well, so a newly promoted admin can use
    // this page immediately without signing out and back in.
    const currentUser = await adminAuth.getUser(decoded.uid);
    if (currentUser.customClaims?.admin === true) {
      return { decoded } as const;
    }

    // Existing installations may already have their first operator but no
    // custom admin claim (the claim was introduced with user management). If
    // no admin exists yet, promote only the oldest enabled account. This gives
    // the installation a deterministic, one-time bootstrap without opening
    // user creation to every authenticated operator.
    let pageToken: string | undefined;
    let hasAdmin = false;
    let oldestEnabledUser: { uid: string; createdAt: number } | undefined;

    do {
      const page = await adminAuth.listUsers(1_000, pageToken);
      for (const user of page.users) {
        if (user.customClaims?.admin === true) hasAdmin = true;
        if (!user.disabled) {
          const createdAt = Date.parse(user.metadata.creationTime);
          if (!oldestEnabledUser || createdAt < oldestEnabledUser.createdAt) {
            oldestEnabledUser = { uid: user.uid, createdAt };
          }
        }
      }
      pageToken = page.pageToken;
    } while (pageToken);

    if (!hasAdmin && oldestEnabledUser?.uid === decoded.uid) {
      await adminAuth.setCustomUserClaims(decoded.uid, {
        ...currentUser.customClaims,
        admin: true,
      });
      return { decoded } as const;
    }

    return { error: "Solo un admin può gestire gli utenti", status: 403 } as const;
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
