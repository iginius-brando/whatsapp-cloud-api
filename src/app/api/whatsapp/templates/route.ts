import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { listWhatsAppMessageTemplates } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!idToken) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  try {
    await adminAuth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "Token non valido" }, { status: 401 });
  }

  try {
    const templates = await listWhatsAppMessageTemplates();
    return NextResponse.json({ templates });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Template non caricati";
    console.error("Caricamento template WhatsApp fallito:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
