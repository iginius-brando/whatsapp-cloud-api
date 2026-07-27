import "server-only";

import type { FlowRequestPayload } from "@/lib/flows/crypto";
import { saveFlowBooking } from "@/lib/firebase/firestore-admin";

/**
 * Logica applicativa del Flow "Flusso Prenotazione" (template Appointment).
 *
 * Il Flow è dinamico: a ogni passo il client chiede a noi quale schermata
 * mostrare e con quali dati. Qui c'è la macchina a stati che risponde.
 *
 * Le schermate del template sono:
 *   APPOINTMENT → DETAILS → SUMMARY → (TERMS è una pagina informativa)
 *
 * Le funzioni `list*` più sotto sono il punto in cui collegare la vera
 * disponibilità (gestionale, calendario, Firestore…): oggi restituiscono dati
 * di esempio ma la forma del risultato è già quella definitiva.
 */

/** Risposta al client: schermata da mostrare e dati con cui popolarla. */
export interface FlowResponse {
  screen: string;
  data: Record<string, unknown>;
}

/** Opzione di un Dropdown del Flow. */
interface FlowOption {
  id: string;
  title: string;
  enabled?: boolean;
}

// --- Sorgenti dati -------------------------------------------------------
// Sostituisci queste tre funzioni con le query al tuo sistema di prenotazione.

function listDepartments(): FlowOption[] {
  return [
    { id: "shopping", title: "Consulenza acquisti" },
    { id: "clothing", title: "Abbigliamento" },
    { id: "issue", title: "Assistenza" },
  ];
}

function listLocations(departmentId: string): FlowOption[] {
  const all: Record<string, FlowOption[]> = {
    shopping: [
      { id: "1", title: "Milano — Corso Buenos Aires" },
      { id: "2", title: "Roma — Via del Corso" },
    ],
    clothing: [{ id: "1", title: "Milano — Corso Buenos Aires" }],
    issue: [
      { id: "1", title: "Milano — Corso Buenos Aires" },
      { id: "3", title: "Torino — Via Roma" },
    ],
  };
  return all[departmentId] ?? [];
}

function listDates(departmentId: string, locationId: string): FlowOption[] {
  // Prossimi 5 giorni lavorativi, come esempio: la disponibilità reale va letta
  // dal calendario tenendo conto di reparto e sede.
  void departmentId;
  void locationId;

  const options: FlowOption[] = [];
  const cursor = new Date();
  const formatter = new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  while (options.length < 5) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day === 0 || day === 6) continue;
    options.push({
      id: cursor.toISOString().slice(0, 10),
      title: formatter.format(cursor),
    });
  }

  return options;
}

function listTimes(dateId: string): FlowOption[] {
  void dateId;
  return [
    { id: "10:30", title: "10:30" },
    { id: "11:00", title: "11:00" },
    { id: "14:30", title: "14:30" },
    { id: "16:00", title: "16:00", enabled: false },
  ];
}

// --- Macchina a stati ----------------------------------------------------

function str(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key];
  return typeof value === "string" ? value : "";
}

function titleOf(options: FlowOption[], id: string): string {
  return options.find((o) => o.id === id)?.title ?? id;
}

/**
 * Schermata iniziale: solo il primo dropdown è attivo, gli altri si abilitano
 * man mano che l'utente sceglie (il client li ri-chiede a noi via data_exchange).
 */
function appointmentScreen(data?: Record<string, unknown>): FlowResponse {
  const department = str(data, "department");
  const location = str(data, "location");
  const date = str(data, "date");

  const locations = department ? listLocations(department) : [];
  const dates = department && location ? listDates(department, location) : [];
  const times = date ? listTimes(date) : [];

  return {
    screen: "APPOINTMENT",
    data: {
      department: listDepartments(),
      location: locations,
      date: dates,
      time: times,
      // Il Flow JSON usa questi flag per abilitare/disabilitare i dropdown.
      is_location_enabled: locations.length > 0,
      is_date_enabled: dates.length > 0,
      is_time_enabled: times.length > 0,
    },
  };
}

/** Riepilogo leggibile della scelta fatta nella prima schermata. */
function appointmentSummary(data: Record<string, unknown>): string {
  const department = str(data, "department");
  const location = str(data, "location");
  const date = str(data, "date");
  const time = str(data, "time");

  const parts = [
    titleOf(listDepartments(), department),
    titleOf(listLocations(department), location),
    `${titleOf(listDates(department, location), date)} alle ${time}`,
  ];

  return parts.filter(Boolean).join("\n");
}

function detailsSummary(data: Record<string, unknown>): string {
  const parts = [
    str(data, "name"),
    str(data, "email"),
    str(data, "phone"),
    str(data, "more_details"),
  ];
  return parts.filter(Boolean).join("\n");
}

/**
 * Gestisce una richiesta decifrata e restituisce la schermata successiva.
 * Le azioni di sistema (ping, error) sono gestite a monte, nella route.
 */
export async function handleAppointmentFlow(
  payload: FlowRequestPayload,
): Promise<FlowResponse> {
  const { action, screen, data, flow_token: flowToken } = payload;

  // Apertura del Flow: il client non ha ancora nessuna schermata.
  if (action === "INIT") {
    return appointmentScreen();
  }

  if (action === "BACK") {
    // Torniamo indietro rigenerando la schermata precedente con i dati noti.
    if (screen === "SUMMARY") return { screen: "DETAILS", data: data ?? {} };
    return appointmentScreen(data);
  }

  if (action !== "data_exchange") {
    throw new Error(`Azione non gestita: ${action}`);
  }

  switch (screen) {
    case "APPOINTMENT": {
      // Il client ci interpella sia quando l'utente seleziona un dropdown
      // (per popolare quello successivo) sia quando preme Continua. Se manca
      // ancora qualche scelta, restiamo sulla stessa schermata aggiornata.
      const complete =
        str(data, "department") &&
        str(data, "location") &&
        str(data, "date") &&
        str(data, "time");

      if (!complete) return appointmentScreen(data);

      return {
        screen: "DETAILS",
        data: {
          department: str(data, "department"),
          location: str(data, "location"),
          date: str(data, "date"),
          time: str(data, "time"),
        },
      };
    }

    case "DETAILS": {
      const merged = data ?? {};
      return {
        screen: "SUMMARY",
        data: {
          ...merged,
          appointment: appointmentSummary(merged),
          details: detailsSummary(merged),
        },
      };
    }

    case "SUMMARY": {
      // Ultimo passo: registriamo la prenotazione e chiudiamo il Flow.
      const booking = data ?? {};
      await saveFlowBooking({
        flowToken: flowToken ?? "",
        booking,
        createdAt: Date.now(),
      });

      return {
        screen: "SUCCESS",
        data: {
          extension_message_response: {
            params: {
              flow_token: flowToken,
              // Questi parametri tornano nel messaggio nfm_reply del webhook.
              booking_confirmed: true,
            },
          },
        },
      };
    }

    default:
      throw new Error(`Schermata non gestita: ${screen}`);
  }
}
