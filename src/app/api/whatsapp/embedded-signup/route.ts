import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import {
  listWhatsAppTenants,
  saveWhatsAppTenant,
} from "@/lib/firebase/firestore-admin";
import {
  checkEmbeddedSignupConfig,
  onboardEmbeddedSignupCustomer,
} from "@/lib/meta/embedded-signup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Onboarding dei clienti come tech provider.
 *
 * `POST` riceve il `code` dell'Embedded Signup e completa la configurazione
 * lato Meta; `GET` elenca i clienti già collegati. Entrambe sono riservate agli
 * admin: collegare una WABA significa acquisire un token con cui inviare
 * messaggi a nome del cliente.
 */

class ForbiddenError extends Error {}

async function verifyAdmin(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) throw new Error("Non autenticato");

  const decoded = await adminAuth.verifyIdToken(header.slice(7));
  const user = await adminAuth.getUser(decoded.uid);
  if (decoded.admin !== true && user.customClaims?.admin !== true) {
    throw new ForbiddenError(
      "Solo un admin può collegare gli account WhatsApp dei clienti",
    );
  }

  return { uid: decoded.uid, email: decoded.email };
}

function errorResponse(error: unknown, fallbackStatus: number) {
  const message = error instanceof Error ? error.message : "Errore sconosciuto";
  const status =
    error instanceof ForbiddenError
      ? 403
      : message === "Non autenticato"
        ? 401
        : fallbackStatus;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    await verifyAdmin(request);
    const tenants = await listWhatsAppTenants();
    return NextResponse.json({ tenants, config: checkEmbeddedSignupConfig() });
  } catch (error) {
    return errorResponse(error, 401);
  }
}

export async function POST(request: Request) {
  let actor: { uid: string; email?: string };
  try {
    actor = await verifyAdmin(request);
  } catch (error) {
    return errorResponse(error, 401);
  }

  try {
    const body = await request.json();
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) {
      return NextResponse.json(
        { error: "Manca il code restituito dall'Embedded Signup" },
        { status: 400 },
      );
    }

    const pin = typeof body.pin === "string" ? body.pin.trim() : undefined;
    if (pin && !/^\d{6}$/.test(pin)) {
      return NextResponse.json(
        { error: "Il PIN della verifica in due passaggi deve avere 6 cifre" },
        { status: 400 },
      );
    }

    const result = await onboardEmbeddedSignupCustomer({
      code,
      wabaId: typeof body.wabaId === "string" ? body.wabaId : undefined,
      phoneNumberId:
        typeof body.phoneNumberId === "string" ? body.phoneNumberId : undefined,
      businessId: typeof body.businessId === "string" ? body.businessId : undefined,
      pin,
      register: body.register !== false,
    });

    await saveWhatsAppTenant({
      tenant: result.tenant,
      accessToken: result.accessToken,
      pin: result.pin,
      actor,
    });

    return NextResponse.json({
      tenant: result.tenant,
      steps: result.steps,
      // Il PIN torna una volta sola all'admin che ha fatto l'onboarding: serve
      // per le ri-registrazioni future del numero. Resta anche su Firestore.
      ...(result.pin ? { pin: result.pin } : {}),
    });
  } catch (error) {
    return errorResponse(error, 502);
  }
}
