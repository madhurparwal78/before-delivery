// The request form used to create a draft and to edit one.
import type { Named, RequestView } from "../../shared/api.js";
import { SETTING_LABELS, SETTINGS } from "../../shared/domain.js";
import { agencyInput, fromAgencyInput } from "../../shared/time.js";
import { get } from "../api.js";
import { h } from "../dom.js";
import { field, select, textInput, type Field } from "../ui.js";

interface RequestForm {
  form: HTMLFormElement;
  fields: Record<string, Field>;
  /** The body to send: typed agency times become ISO times with offset; unreadable text is sent as typed for the server to name. */
  body: () => Record<string, string>;
}

const HINT = "Agency time (Eastern), 24-hour, as YYYY-MM-DDTHH:MM, for example 2026-10-27T14:00.";

export async function requestForm(name: string, initial: RequestView | null, submitLabel: string): Promise<RequestForm> {
  const consumers = await get<{ consumers: Named[] }>("/api/consumers");
  const consumerOptions: [string, string][] = consumers.ok ? consumers.data.consumers.map((c) => [c.id, c.name]) : [];
  const fields = {
    title: field("Title", textInput({ maxlength: "120" })),
    setting: field("Setting", select(SETTINGS.map((s) => [s, SETTING_LABELS[s]]), "Choose a setting")),
    location: field("Location", textInput({ maxlength: "200" })),
    start: field("Start", textInput({ inputmode: "numeric", placeholder: "2026-10-27T14:00" }), HINT),
    end: field("End", textInput({ inputmode: "numeric", placeholder: "2026-10-27T15:00" })),
    consumer_id: field("Deaf consumer", select(consumerOptions, "Choose a Deaf consumer")),
    notes: field("Notes", h("textarea", { rows: "4", maxlength: "2000" })),
  };
  if (initial) {
    fields.title.control.value = initial.title;
    fields.setting.control.value = initial.setting;
    fields.location.control.value = initial.location;
    fields.start.control.value = agencyInput(new Date(initial.start));
    fields.end.control.value = agencyInput(new Date(initial.end));
    fields.consumer_id.control.value = initial.consumer.id;
    fields.notes.control.value = initial.notes;
  }
  const form = h(
    "form",
    { class: "stack request-form", "aria-label": name, novalidate: true },
    h("div", { class: "grid-2" }, fields.title.wrap, fields.setting.wrap),
    fields.location.wrap,
    h("div", { class: "grid-2" }, fields.start.wrap, fields.end.wrap),
    fields.consumer_id.wrap,
    fields.notes.wrap,
    h("div", { class: "actions" }, h("button", { type: "submit", class: "button primary" }, submitLabel)),
  );
  const iso = (text: string): string => fromAgencyInput(text)?.toISOString() ?? text;
  const body = (): Record<string, string> => ({
    title: fields.title.control.value,
    setting: fields.setting.control.value,
    location: fields.location.control.value,
    start: iso(fields.start.control.value),
    end: iso(fields.end.control.value),
    consumer_id: fields.consumer_id.control.value,
    notes: fields.notes.control.value,
  });
  return { form, fields, body };
}
