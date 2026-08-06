import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import {
  getAdminAuditLogs,
  getSecuritySettings,
  saveSecuritySettings,
} from "@/lib/firebase/firestore-admin";
import type { SecuritySettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyAdmin(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) throw new Error("Non autenticato");
  const decoded = await adminAuth.verifyIdToken(header.slice(7));
  const user = await adminAuth.getUser(decoded.uid);
  if (decoded.admin !== true && user.customClaims?.admin !== true) {
    throw new Error("Solo un admin può modificare la sicurezza");
  }
  return { uid: decoded.uid, email: decoded.email };
}

export async function GET(request: Request) {
  try {
    await verifyAdmin(request);
    const settings = await getSecuritySettings();
    const users = settings.accessLogsEnabled ? await adminAuth.listUsers(100) : null;
    const accessLogs = users?.users
      .filter((user) => user.metadata.lastSignInTime)
      .map((user) => ({
        id: user.uid,
        email: user.email ?? user.displayName ?? "Utente",
        date: new Date(user.metadata.lastSignInTime).toISOString(),
        status: user.disabled ? "Disabilitato" : "Riuscito",
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 20) ?? [];
    const auditLogs = settings.adminAuditEnabled ? await getAdminAuditLogs() : [];
    return NextResponse.json({ settings, accessLogs, auditLogs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore sconosciuto";
    return NextResponse.json({ error: message }, { status: message.startsWith("Solo") ? 403 : 401 });
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await verifyAdmin(request);
    const body = await request.json();
    const settings: SecuritySettings = {
      twoFactorEnabled: body.twoFactorEnabled === true,
      accessLogsEnabled: body.accessLogsEnabled === true,
      adminAuditEnabled: body.adminAuditEnabled === true,
    };
    await saveSecuritySettings(settings, actor);
    return NextResponse.json({ settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Salvataggio non riuscito";
    return NextResponse.json({ error: message }, { status: message.startsWith("Solo") ? 403 : 400 });
  }
}
