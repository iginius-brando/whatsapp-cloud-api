import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { saveOutboundMessage } from "@/lib/firebase/firestore-admin";
import { sendTemplateMessage, type SendTemplateComponent } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  to?: string;
  templateName?: string;
  language?: string;
  components?: SendTemplateComponent[];
  previewText?: string;
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!idToken) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  try {
    await adminAuth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "Token non valido" }, { status: 401 });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }

  const to = body.to?.trim();
  const templateName = body.templateName?.trim();
  const language = body.language?.trim();

  if (!to || !templateName || !language) {
    return NextResponse.json(
      { error: "Campi 'to', 'templateName' e 'language' obbligatori" },
      { status: 400 },
    );
  }

  try {
    const { messageId } = await sendTemplateMessage(to, {
      name: templateName,
      language,
      components: body.components,
    });
    const timestamp = Date.now();
    const text = body.previewText?.trim() || `Template: ${templateName}`;

    await saveOutboundMessage({
      waId: to,
      messageId,
      text,
      timestamp,
      status: "sent",
      type: "template",
    });

    return NextResponse.json({ messageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore sconosciuto nell'invio";
    console.error("Invio template WhatsApp fallito:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
