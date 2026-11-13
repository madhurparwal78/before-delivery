import type { ReactNode } from "react";
import type { Reference } from "../../shared/api";
import { tenthsToTyped, type SizeUnit } from "../../shared/sizes";
import { ColourSelect, TextField } from "./controls";

export interface FactsValues {
  title: string;
  maker: string;
  year: string;
  width: string;
  height: string;
  depth: string;
  materials: string;
  finish: string;
  colour_family: string;
  source_url: string;
  source_note: string;
  notes: string;
}

export const EMPTY_FACTS: FactsValues = {
  title: "",
  maker: "",
  year: "",
  width: "",
  height: "",
  depth: "",
  materials: "",
  finish: "",
  colour_family: "",
  source_url: "",
  source_note: "",
  notes: "",
};

export function factsOf(reference: Reference, unit: SizeUnit): FactsValues {
  return {
    title: reference.title,
    maker: reference.maker ?? "",
    year: reference.year === null ? "" : String(reference.year),
    width: tenthsToTyped(reference.size_tenths_mm.width, unit),
    height: tenthsToTyped(reference.size_tenths_mm.height, unit),
    depth: tenthsToTyped(reference.size_tenths_mm.depth, unit),
    materials: reference.materials.join(", "),
    finish: reference.finish,
    colour_family: reference.colour_family,
    source_url: reference.source_url ?? "",
    source_note: reference.source_note,
    notes: reference.notes,
  };
}

/** The published order of the capture form; the facts edit form follows it for the fields it shows. */
const FORM_ORDER = [
  "photo",
  "swatch",
  "title",
  "maker",
  "year",
  "unit",
  "width",
  "height",
  "depth",
  "materials",
  "finish",
  "colour_family",
  "source_url",
  "source_note",
  "notes",
] as const;

export type Errors = Readonly<Record<string, string>>;

function formKey(serverKey: string): string {
  return serverKey === "swatch_x" || serverKey === "swatch_y" || serverKey === "x" || serverKey === "y" ? "swatch" : serverKey;
}

export function errorsByControl(fields: Errors): Errors {
  const byControl: Record<string, string> = {};
  for (const [key, copy] of Object.entries(fields)) byControl[formKey(key)] ??= copy;
  return byControl;
}

/** Moves focus to the first invalid control in the published form order. */
export function focusFirstInvalid(errors: Errors): void {
  for (const key of FORM_ORDER) {
    if (!errors[key]) continue;
    const control = document.getElementById(`f-${key}`);
    if (control) {
      control.focus();
      return;
    }
  }
}

interface ReferenceFieldsProps {
  values: FactsValues;
  errors: Errors;
  onChange: (key: keyof FactsValues, value: string) => void;
  unit: SizeUnit;
  /** Rendered between Year and Width, where the published form order puts the size unit. */
  unitControl?: ReactNode;
}

export function ReferenceFields({ values, errors, onChange, unit, unitControl }: ReferenceFieldsProps) {
  const text = (key: keyof FactsValues, label: string, extra: { inputMode?: "numeric" | "decimal" | "url"; multiline?: boolean; hint?: string } = {}) => (
    <TextField id={`f-${key}`} label={label} value={values[key]} error={errors[key]} onChange={(value) => onChange(key, value)} {...extra} />
  );
  return (
    <>
      {text("title", "Name")}
      {text("maker", "Maker")}
      {text("year", "Year", { inputMode: "numeric" })}
      {unitControl}
      {text("width", "Width", { inputMode: "decimal", hint: unit })}
      {text("height", "Height", { inputMode: "decimal", hint: unit })}
      {text("depth", "Depth", { inputMode: "decimal", hint: unit })}
      {text("materials", "Materials")}
      {text("finish", "Finish")}
      <ColourSelect id="f-colour_family" value={values.colour_family} error={errors.colour_family} onChange={(value) => onChange("colour_family", value)} />
      {text("source_url", "Source link", { inputMode: "url" })}
      {text("source_note", "Where you found it")}
      {text("notes", "Notes", { multiline: true })}
    </>
  );
}
