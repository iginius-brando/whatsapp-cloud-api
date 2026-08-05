import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import {
  checkWhatsAppFlow,
  checkWhatsAppPhoneNumber,
  checkWhatsAppWebhookConfig,
} from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckTarget = "phone" | "webhook" | "flow";

function isCheckTarget(value: string | null): value is CheckTarget {
  return value === "phone" || value === "webhook" || value === "flow";
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!idToken) {
    return NextResponse.json(
      { ok: false, error: "Non autenticato" },
      { status: 401 },
    );
  }

  try {
    await adminAuth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Token non valido" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const target = searchParams.get("target");

  if (!isCheckTarget(target)) {
    return NextResponse.json(
      { ok: false, error: "Parametro target non valido" },
      { status: 400 },
    );
  }

  try {
    if (target === "phone") {
      const phone = await checkWhatsAppPhoneNumber();
      return NextResponse.json({
        ok: true,
        label: phone.displayPhoneNumber || phone.verifiedName || phone.id,
        details: `Numero leggibile da Cloud API${
          phone.qualityRating ? ` · qualità ${phone.qualityRating}` : ""
        }`,
      });
    }

    if (target === "flow") {
      const flow = await checkWhatsAppFlow();
      return NextResponse.json({
        ok: true,
        label: flow.name || flow.id,
        details: flow.status
          ? `Flow ${flow.status}`
          : "Flow leggibile da Cloud API",
      });
    }

    const webhook = checkWhatsAppWebhookConfig();
    return NextResponse.json({
      ok: webhook.verifyToken && webhook.appSecret,
      label:
        webhook.verifyToken && webhook.appSecret
          ? "Configurazione presente"
          : "Configurazione incompleta",
      details: `Verify token: ${
        webhook.verifyToken ? "presente" : "mancante"
      } · App secret: ${webhook.appSecret ? "presente" : "mancante"}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verifica non riuscita";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
