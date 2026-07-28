import "server-only";

import type { FlowRequestPayload } from "@/lib/flows/crypto";
import { saveFlowBooking } from "@/lib/firebase/firestore-admin";

/**
 * Logica applicativa del Flow "Prenotazioni".
 *
 * Ricalca il percorso già in uso dal cliente via liste WhatsApp:
 *
 *   MENU ──┬─ prenotazione ────────────► DATE ─► TIME ─► DETAILS ─► SUMMARY
 *          └─ gestione appuntamenti ──► APPOINTMENTS ─┬─ spostare ─► DATE ─► TIME ─► SUMMARY
 *                                                     ├─ disdire ──────────────────► SUMMARY
 *                                                     └─ vedere ───────────────────► SUMMARY
 *
 * Il Flow non ha memoria tra una richiesta e l'altra: lo stato viaggia avanti e
 * indietro dentro il campo `context`, una stringa JSON che ogni schermata riceve
 * nei propri `data` e rispedisce nel payload del footer.
 *
 * Le funzioni della sezione "Sorgenti dati" restituiscono valori fittizi ma
 * deterministici: la stessa data produce sempre gli stessi orari, così l'elenco
 * mostrato nella schermata DATE coincide con quello della schermata TIME. Sono
 * il punto in cui innestare il gestionale reale.
 */

/** Risposta al client: schermata da mostrare e dati con cui popolarla. */
export interface FlowResponse {
  screen: string;
  data: Record<string, unknown>;
}

/** Voce di un elenco selezionabile del Flow. */
interface ListItem {
  id: string;
  title: string;
  description?: string;
  enabled?: boolean;
}

/** Cosa ha scelto di fare l'utente nel menu iniziale. */
type ActionId =
  | "single_self"
  | "single_other"
  | "double_same"
  | "reschedule"
  | "cancel"
  | "view";

/** Stato che attraversa le schermate dentro il campo `context`. */
interface BookingContext {
  action?: ActionId;
  appointmentId?: string;
  /** Mese in formato YYYY-MM. */
  month?: string;
  /** Data in formato YYYY-MM-DD. */
  date?: string;
  /** Orario di inizio in formato HH:MM. */
  time?: string;
  name?: string;
  phone?: string;
  guestName?: string;
  notes?: string;
}

/** Durata di un appuntamento, in minuti. */
const SLOT_MINUTES = 45;

/** Quante date proporre al massimo in una schermata. */
const MAX_DATES = 12;

// --- Formattazione -------------------------------------------------------

const DATE_LABEL = new Intl.DateTimeFormat("it-IT", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const MONTH_LABEL = new Intl.DateTimeFormat("it-IT", {
  month: "long",
  year: "numeric",
});

function formatDate(isoDate: string): string {
  return DATE_LABEL.format(new Date(`${isoDate}T12:00:00`));
}

function formatMonth(month: string): string {
  const label = MONTH_LABEL.format(new Date(`${month}-01T12:00:00`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Orario di fine dello slot, dato quello di inizio. */
function slotEnd(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + SLOT_MINUTES;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// --- Sorgenti dati -------------------------------------------------------
// Sostituisci il corpo di queste funzioni con le query al gestionale reale:
// le firme e la forma dei risultati restano identiche.

/** Hash stabile: serve solo a rendere ripetibile la disponibilità finta. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const ALL_SLOTS = [
  "10:30",
  "11:00",
  "11:15",
  "11:45",
  "12:00",
  "15:00",
  "16:30",
  "17:15",
];

/** Orari liberi di un giorno. Weekend chiuso, giorni passati esclusi. */
function slotsFor(isoDate: string): string[] {
  if (isoDate < todayIso()) return [];

  const day = new Date(`${isoDate}T12:00:00`).getDay();
  if (day === 0 || day === 6) return [];

  const bits = hash(isoDate);
  return ALL_SLOTS.filter((_, index) => (bits >>> index) & 1);
}

/** Mesi selezionabili: quello corrente più i tre successivi. */
function listMonths(): ListItem[] {
  const items: ListItem[] = [];
  const cursor = new Date();
  cursor.setDate(1);

  for (let i = 0; i < 4; i++) {
    const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    items.push({ id: month, title: formatMonth(month) });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return items;
}

/** Giorni con almeno uno slot libero nel mese indicato. */
function listDates(month: string): ListItem[] {
  const [year, monthIndex] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthIndex, 0).getDate();
  const items: ListItem[] = [];

  for (let day = 1; day <= daysInMonth && items.length < MAX_DATES; day++) {
    const isoDate = `${month}-${String(day).padStart(2, "0")}`;
    const slots = slotsFor(isoDate);
    if (slots.length === 0) continue;

    items.push({
      id: isoDate,
      title: formatDate(isoDate),
      description:
        slots.length === 1
          ? `unico orario rimasto: ${slots[0]}`
          : `orari disponibili: ${slots.join(", ")}`,
    });
  }

  return items;
}

/** Slot di un giorno, nel formato mostrato all'utente. */
function listSlots(isoDate: string): ListItem[] {
  return slotsFor(isoDate).map((time) => ({
    id: time,
    title: `alle ${time}`,
    description: `dalle ${time} alle ${slotEnd(time)}`,
  }));
}

/** Appuntamenti futuri del cliente. */
function listAppointments(waId: string): ListItem[] {
  // Finti ma stabili per numero: due appuntamenti a distanza di qualche giorno.
  const bits = hash(waId);
  const items: ListItem[] = [];
  const cursor = new Date();

  for (let i = 0; i < 2; i++) {
    // Shift senza segno: con `>>` un hash oltre 2^31 darebbe un indice negativo.
    cursor.setDate(cursor.getDate() + 3 + ((bits >>> (i * 3)) & 7));
    const isoDate = cursor.toISOString().slice(0, 10);
    const time = ALL_SLOTS[(bits >>> (i * 2)) % ALL_SLOTS.length];

    items.push({
      id: `${isoDate}T${time}`,
      title: `${formatDate(isoDate)} alle ${time}`,
      description: i === 0 ? "Visita singola" : "Visita doppia",
    });
  }

  return items;
}

/** Voci del menu iniziale. */
function listActions(hasAppointments: boolean): ListItem[] {
  const booking: ListItem[] = [
    {
      id: "single_self",
      title: "Singola per me",
      description: "Prenota una visita solo per te stesso",
    },
    {
      id: "single_other",
      title: "Singola per altri",
      description: "Prenota una visita per un'altra persona",
    },
    {
      id: "double_same",
      title: "Doppia stesso orario",
      description: "Prenota per te e un'altra persona alla stessa ora",
    },
  ];

  if (!hasAppointments) return booking;

  return [
    ...booking,
    {
      id: "reschedule",
      title: "Spostare",
      description: "Sposta un tuo appuntamento ad altra data o orario",
    },
    {
      id: "cancel",
      title: "Disdire",
      description: "Disdici un tuo appuntamento",
    },
    {
      id: "view",
      title: "Visualizzare",
      description: "Vedi i tuoi appuntamenti futuri",
    },
  ];
}

// --- Stato ---------------------------------------------------------------

function str(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key];
  return typeof value === "string" ? value : "";
}

function decodeContext(data: Record<string, unknown> | undefined): BookingContext {
  const raw = str(data, "context");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as BookingContext;
  } catch {
    return {};
  }
}

function encodeContext(context: BookingContext): string {
  return JSON.stringify(context);
}

/** Numero del cliente, ricavato dal flow_token che generiamo all'invio. */
function waIdFrom(flowToken?: string): string {
  return flowToken?.split(":")[0] || "sconosciuto";
}

/** True se l'azione scelta riguarda un appuntamento già esistente. */
function isManagement(action?: ActionId): boolean {
  return action === "reschedule" || action === "cancel" || action === "view";
}

/** True se la prenotazione coinvolge una seconda persona. */
function needsGuest(action?: ActionId): boolean {
  return action === "single_other" || action === "double_same";
}

// --- Schermate -----------------------------------------------------------

function menuScreen(waId: string): FlowResponse {
  const hasAppointments = listAppointments(waId).length > 0;

  return {
    screen: "MENU",
    data: {
      actions: listActions(hasAppointments),
      context: encodeContext({}),
    },
  };
}

function appointmentsScreen(
  waId: string,
  context: BookingContext,
): FlowResponse {
  const labels: Record<string, { intro: string; footer: string }> = {
    reschedule: {
      intro: "Scegli l'appuntamento da spostare.",
      footer: "Scegli nuova data",
    },
    cancel: {
      intro: "Scegli l'appuntamento da disdire.",
      footer: "Continua",
    },
    view: {
      intro: "Questi sono i tuoi appuntamenti futuri.",
      footer: "Vedi dettagli",
    },
  };

  const copy = labels[context.action ?? "view"] ?? labels.view;

  return {
    screen: "APPOINTMENTS",
    data: {
      appointments: listAppointments(waId),
      intro: copy.intro,
      footer_label: copy.footer,
      context: encodeContext(context),
    },
  };
}

function dateScreen(context: BookingContext): FlowResponse {
  const months = listMonths();
  const month = context.month || months[0].id;
  const dates = listDates(month);

  return {
    screen: "DATE",
    data: {
      months,
      selected_month: month,
      dates,
      has_dates: dates.length > 0,
      intro:
        dates.length > 0
          ? "Scegli una data tra quelle disponibili."
          : "Nessuna disponibilità in questo mese: prova con un altro mese.",
      context: encodeContext({ ...context, month }),
    },
  };
}

function timeScreen(context: BookingContext): FlowResponse {
  const date = context.date ?? "";
  const slots = listSlots(date);

  return {
    screen: "TIME",
    data: {
      times: slots,
      intro: `Orari disponibili per ${formatDate(date)}.`,
      context: encodeContext(context),
    },
  };
}

function detailsScreen(context: BookingContext): FlowResponse {
  return {
    screen: "DETAILS",
    data: {
      needs_guest: needsGuest(context.action),
      guest_label:
        context.action === "double_same"
          ? "Nome della seconda persona"
          : "Nome della persona che riceverà la visita",
      context: encodeContext(context),
    },
  };
}

/** Riepilogo finale: cambia testo e pulsante a seconda dell'azione. */
function summaryScreen(
  context: BookingContext,
  appointments: ListItem[],
): FlowResponse {
  const selected = appointments.find((a) => a.id === context.appointmentId);

  let title = "Riepilogo";
  let body = "";
  let footerLabel = "Conferma";
  let showTerms = false;

  if (context.action === "view") {
    title = "Dettagli appuntamento";
    body = selected
      ? `${selected.title}\n${selected.description ?? ""}`
      : "Nessun appuntamento selezionato.";
    footerLabel = "Chiudi";
  } else if (context.action === "cancel") {
    title = "Confermi la disdetta?";
    body = selected
      ? `Stai per disdire:\n${selected.title}\n\nL'operazione non è reversibile.`
      : "Nessun appuntamento selezionato.";
    footerLabel = "Disdici appuntamento";
  } else if (context.action === "reschedule") {
    title = "Confermi lo spostamento?";
    body = [
      selected ? `Da: ${selected.title}` : "",
      `A: ${formatDate(context.date ?? "")} alle ${context.time}`,
      `Durata: dalle ${context.time} alle ${slotEnd(context.time ?? "00:00")}`,
    ]
      .filter(Boolean)
      .join("\n");
    footerLabel = "Sposta appuntamento";
  } else {
    const tipo =
      context.action === "single_self"
        ? "Visita singola"
        : context.action === "single_other"
          ? "Visita singola per un'altra persona"
          : "Visita doppia allo stesso orario";

    title = "Confermi la prenotazione?";
    body = [
      tipo,
      `${formatDate(context.date ?? "")} alle ${context.time}`,
      `Durata: dalle ${context.time} alle ${slotEnd(context.time ?? "00:00")}`,
      "",
      `Nome: ${context.name}`,
      `Telefono: ${context.phone}`,
      context.guestName ? `Seconda persona: ${context.guestName}` : "",
      context.notes ? `Note: ${context.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    footerLabel = "Conferma prenotazione";
    showTerms = true;
  }

  return {
    screen: "SUMMARY",
    data: {
      title,
      body,
      footer_label: footerLabel,
      show_terms: showTerms,
      context: encodeContext(context),
    },
  };
}

// --- Macchina a stati ----------------------------------------------------

/**
 * Gestisce una richiesta decifrata e restituisce la schermata successiva.
 * Le azioni di sistema (ping, error) sono gestite a monte, nella route.
 */
export async function handleBookingFlow(
  payload: FlowRequestPayload,
): Promise<FlowResponse> {
  const { action, screen, data, flow_token: flowToken } = payload;
  const waId = waIdFrom(flowToken);

  if (action === "INIT") {
    return menuScreen(waId);
  }

  if (action === "BACK") {
    // Il client gestisce da sé il ritorno alle schermate statiche; qui
    // ricostruiamo quelle dinamiche partendo dal contesto ricevuto.
    const context = decodeContext(data);
    if (screen === "TIME") return dateScreen(context);
    if (screen === "DATE" && isManagement(context.action)) {
      return appointmentsScreen(waId, context);
    }
    return menuScreen(waId);
  }

  if (action !== "data_exchange") {
    throw new Error(`Azione non gestita: ${action}`);
  }

  const context = decodeContext(data);

  switch (screen) {
    case "MENU": {
      const chosen = str(data, "action") as ActionId;
      const next: BookingContext = { action: chosen };
      return isManagement(chosen)
        ? appointmentsScreen(waId, next)
        : dateScreen(next);
    }

    case "APPOINTMENTS": {
      const next: BookingContext = {
        ...context,
        appointmentId: str(data, "appointment"),
      };

      if (next.action === "reschedule") return dateScreen(next);
      return summaryScreen(next, listAppointments(waId));
    }

    case "DATE": {
      // Il cambio di mese ricarica la stessa schermata con le nuove date.
      if (str(data, "trigger") === "month_selected") {
        return dateScreen({ ...context, month: str(data, "month") });
      }

      return timeScreen({
        ...context,
        month: str(data, "month") || context.month,
        date: str(data, "date"),
      });
    }

    case "TIME": {
      const next: BookingContext = { ...context, time: str(data, "time") };
      // Per uno spostamento data e ora bastano: i dati anagrafici ci sono già.
      return next.action === "reschedule"
        ? summaryScreen(next, listAppointments(waId))
        : detailsScreen(next);
    }

    case "DETAILS": {
      const next: BookingContext = {
        ...context,
        name: str(data, "name"),
        phone: str(data, "phone"),
        guestName: str(data, "guest_name"),
        notes: str(data, "notes"),
      };
      return summaryScreen(next, listAppointments(waId));
    }

    case "SUMMARY": {
      // Ultimo passo: registriamo l'operazione e chiudiamo il Flow.
      await saveFlowBooking({
        flowToken: flowToken ?? "",
        booking: { ...context, completedAt: new Date().toISOString() },
        createdAt: Date.now(),
      });

      return {
        screen: "SUCCESS",
        data: {
          extension_message_response: {
            params: {
              flow_token: flowToken,
              action: context.action,
              date: context.date,
              time: context.time,
              appointment_id: context.appointmentId,
            },
          },
        },
      };
    }

    default:
      throw new Error(`Schermata non gestita: ${screen}`);
  }
}
