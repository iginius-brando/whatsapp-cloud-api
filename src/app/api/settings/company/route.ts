import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import {
  getCompanyPrivacySettings,
  saveCompanyPrivacySettings,
} from "@/lib/firebase/firestore-admin";
import type { CompanyPrivacySettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyOperator(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!idToken) throw new Error("Non autenticato");
  await adminAuth.verifyIdToken(idToken);
}

function normalize(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

export async function GET(request: Request) {
  try {
    await verifyOperator(request);
    const settings = await getCompanyPrivacySettings();
    return NextResponse.json(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function PUT(request: Request) {
  try {
    await verifyOperator(request);
    const body = await request.json();
    const settings: CompanyPrivacySettings = {
      companyName: normalize(body.companyName),
      legalAddress: normalize(body.legalAddress),
      privacyEmail: normalize(body.privacyEmail),
      retentionPeriod: normalize(body.retentionPeriod),
    };

    await saveCompanyPrivacySettings(settings);
    return NextResponse.json(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
