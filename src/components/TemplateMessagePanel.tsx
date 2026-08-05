"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";

interface TemplateButton {
  type?: string;
  text?: string;
  url?: string;
}

interface TemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: string;
  text?: string;
  buttons?: TemplateButton[];
}

interface MessageTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  components?: TemplateComponent[];
}

interface Props {
  waId: string;
  onSent?: () => void;
}

interface VariableField {
  key: string;
  label: string;
  componentType: "HEADER" | "BODY" | "BUTTONS";
  index?: number;
  buttonIndex?: number;
}

const VARIABLE_PATTERN = /{{\s*(\d+)\s*}}/g;

function extractVariables(text: string | undefined): number[] {
  if (!text) return [];
  const variables = new Set<number>();
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    variables.add(Number(match[1]));
  }
  return [...variables].sort((a, b) => a - b);
}

function renderPreview(template: MessageTemplate, values: Record<string, string>) {
  return (template.components ?? [])
    .filter((component) => component.type !== "BUTTONS")
    .map((component) => {
      let text = component.text ?? "";
      for (const variable of extractVariables(text)) {
        const key = `${component.type}-${variable}`;
        text = text.replaceAll(
          new RegExp(`{{\\s*${variable}\\s*}}`, "g"),
          values[key] || `{{${variable}}}`,
        );
      }
      return text;
    })
    .filter(Boolean)
    .join("\n");
}

export default function TemplateMessagePanel({ waId, onSent }: Props) {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    const currentUser = user;
    let cancelled = false;

    async function loadTemplates() {
      setLoading(true);
      setError(null);
      try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch("/api/whatsapp/templates", {
          headers: { Authorization: `Bearer ${idToken}` },
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Template non caricati");
        }

        const data = await res.json();
        const nextTemplates = (data.templates ?? []) as MessageTemplate[];
        if (!cancelled) {
          setTemplates(nextTemplates);
          setSelectedId(nextTemplates[0]?.id ?? "");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Template non caricati");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTemplates();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const selectedTemplate = templates.find((template) => template.id === selectedId);

  const variableFields = useMemo<VariableField[]>(() => {
    if (!selectedTemplate) return [];

    const fields: VariableField[] = [];
    for (const component of selectedTemplate.components ?? []) {
      if ((component.type === "HEADER" || component.type === "BODY") && component.text) {
        for (const variable of extractVariables(component.text)) {
          fields.push({
            key: `${component.type}-${variable}`,
            label: `${component.type === "HEADER" ? "Header" : "Corpo"} {{${variable}}}`,
            componentType: component.type,
            index: variable,
          });
        }
      }

      if (component.type === "BUTTONS") {
        component.buttons?.forEach((button, buttonIndex) => {
          if (button.type === "URL" && extractVariables(button.url).length > 0) {
            fields.push({
              key: `BUTTONS-${buttonIndex}`,
              label: `Parametro URL bottone ${button.text || buttonIndex + 1}`,
              componentType: "BUTTONS",
              buttonIndex,
            });
          }
        });
      }
    }

    return fields;
  }, [selectedTemplate]);

  const preview = selectedTemplate ? renderPreview(selectedTemplate, values) : "";

  async function sendTemplate() {
    if (!user || !selectedTemplate || sending) return;

    const missingField = variableFields.find((field) => !values[field.key]?.trim());
    if (missingField) {
      setError(`Compila il campo ${missingField.label}.`);
      return;
    }

    const components = [];
    const headerValues = variableFields
      .filter((field) => field.componentType === "HEADER")
      .map((field) => ({ type: "text", text: values[field.key].trim() }));
    const bodyValues = variableFields
      .filter((field) => field.componentType === "BODY")
      .map((field) => ({ type: "text", text: values[field.key].trim() }));

    if (headerValues.length > 0) components.push({ type: "header", parameters: headerValues });
    if (bodyValues.length > 0) components.push({ type: "body", parameters: bodyValues });
    variableFields
      .filter((field) => field.componentType === "BUTTONS")
      .forEach((field) => {
        components.push({
          type: "button",
          sub_type: "url",
          index: String(field.buttonIndex ?? 0),
          parameters: [{ type: "text", text: values[field.key].trim() }],
        });
      });

    setSending(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/whatsapp/send-template", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          to: waId,
          templateName: selectedTemplate.name,
          language: selectedTemplate.language,
          components,
          previewText: preview || `Template: ${selectedTemplate.name}`,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Invio template non riuscito");
      }

      setValues({});
      onSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore di invio template");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-wa-teal/20 bg-white p-3 text-left shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-800">Messaggio template</p>
          <p className="text-xs text-gray-500">Seleziona un template approvato e invialo al cliente.</p>
        </div>
        {loading && <span className="text-xs text-gray-400">Caricamento…</span>}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <select
        value={selectedId}
        onChange={(event) => {
          setSelectedId(event.target.value);
          setValues({});
          setError(null);
        }}
        disabled={loading || templates.length === 0}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-wa-teal disabled:bg-gray-50"
      >
        {templates.length === 0 ? (
          <option>Nessun template approvato disponibile</option>
        ) : (
          templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} · {template.language}
            </option>
          ))
        )}
      </select>

      {variableFields.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {variableFields.map((field) => (
            <label key={field.key} className="text-xs font-medium text-gray-600">
              {field.label}
              <input
                value={values[field.key] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal outline-none focus:border-wa-teal"
                placeholder="Valore da inserire"
              />
            </label>
          ))}
        </div>
      )}

      {selectedTemplate && (
        <div className="rounded-lg bg-wa-panel/70 p-3 text-xs text-gray-600">
          <p className="mb-1 font-semibold text-gray-700">Anteprima</p>
          <p className="whitespace-pre-wrap">{preview || selectedTemplate.name}</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => void sendTemplate()}
        disabled={!selectedTemplate || sending || loading}
        className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-wa-teal to-wa-green px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-wa-teal/20 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-wa-teal/25 disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 transition group-hover:bg-white/30">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </span>
        {sending ? "Invio template…" : "Invia template"}
      </button>
    </div>
  );
}
