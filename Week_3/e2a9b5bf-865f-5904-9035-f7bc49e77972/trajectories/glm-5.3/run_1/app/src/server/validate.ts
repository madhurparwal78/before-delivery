// Validation helpers shared by the API routes, all of them producing the
// published field messages.
import { fieldMessages } from "#shared/messages.js";
import { siteTimeZones } from "#shared/time.js";
import { trains } from "#shared/optics.js";
import type { TrainId } from "#shared/optics.js";

export function normaliseEmail(value: unknown): { normalised: string | null; error?: string } {
  if (typeof value !== "string") return { normalised: null, error: fieldMessages.email };
  const trimmed = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || trimmed.length > 254) return { normalised: null, error: fieldMessages.email };
  return { normalised: trimmed };
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export function validDisplayName(value: unknown): { name: string | null; error?: string } {
  if (typeof value !== "string") return { name: null, error: fieldMessages.display_name };
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 60) return { name: null, error: fieldMessages.display_name };
  if (CONTROL_CHARS.test(trimmed)) return { name: null, error: fieldMessages.display_name };
  return { name: trimmed };
}

export function validKitName(value: unknown): { name: string | null; error?: string } {
  if (typeof value !== "string") return { name: null, error: fieldMessages.name };
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 60) return { name: null, error: fieldMessages.name };
  if (CONTROL_CHARS.test(trimmed)) return { name: null, error: fieldMessages.name };
  return { name: trimmed };
}

export function validPassword(value: unknown): { password: string | null; error?: string } {
  if (typeof value !== "string" || value.length < 10) return { password: null, error: fieldMessages.password };
  return { password: value };
}

export interface NumberField {
  readonly value: number | null;
  readonly error?: string;
}

export function validAperture(value: unknown): NumberField {
  const parsed = parseNumber(value);
  if (parsed === null) return { value: null, error: fieldMessages.aperture };
  if (parsed < 25 || parsed > 1600) return { value: null, error: fieldMessages.aperture };
  return { value: parsed };
}

export function validTelescopeFocal(value: unknown): NumberField {
  const parsed = parseNumber(value);
  if (parsed === null) return { value: null, error: fieldMessages.focal_length_mm };
  if (parsed < 100 || parsed > 20000) return { value: null, error: fieldMessages.focal_length_mm };
  return { value: parsed };
}

export function validEyepieceFocal(value: unknown): NumberField {
  const parsed = parseNumber(value);
  if (parsed === null) return { value: null, error: fieldMessages.eyepiece_focal_length_mm };
  if (parsed < 2 || parsed > 60) return { value: null, error: fieldMessages.eyepiece_focal_length_mm };
  return { value: parsed };
}

export function validApparentField(value: unknown): NumberField {
  const parsed = parseNumber(value);
  if (parsed === null) return { value: null, error: fieldMessages.apparent_field_deg };
  if (parsed < 30 || parsed > 120) return { value: null, error: fieldMessages.apparent_field_deg };
  return { value: parsed };
}

export function validBarlowFactor(value: unknown): NumberField {
  const parsed = parseNumber(value);
  if (parsed === null) return { value: null, error: fieldMessages.factor };
  if (parsed < 1.1 || parsed > 5.0) return { value: null, error: fieldMessages.factor };
  return { value: parsed };
}

export function validLatitude(value: unknown): NumberField {
  const parsed = parseNumber(value);
  if (parsed === null) return { value: null, error: fieldMessages.latitude };
  if (parsed < -90 || parsed > 90) return { value: null, error: fieldMessages.latitude };
  return { value: parsed };
}

export function validLongitude(value: unknown): NumberField {
  const parsed = parseNumber(value);
  if (parsed === null) return { value: null, error: fieldMessages.longitude };
  if (parsed < -180 || parsed > 180) return { value: null, error: fieldMessages.longitude };
  return { value: parsed };
}

export function validTimeZone(value: unknown): { timeZone: string | null; error?: string } {
  if (typeof value !== "string") return { timeZone: null, error: fieldMessages.time_zone };
  if (!(siteTimeZones as readonly string[]).includes(value)) return { timeZone: null, error: fieldMessages.time_zone };
  return { timeZone: value };
}

export function validTrain(value: unknown): { train: TrainId | null; error?: string } {
  if (typeof value !== "string") return { train: null, error: fieldMessages.train };
  const found = trains.find((t) => t.id === value);
  if (!found) return { train: null, error: fieldMessages.train };
  return { train: value as TrainId };
}

export function validDeviceName(value: unknown): { device: string | null; error?: string } {
  if (typeof value !== "string") return { device: null, error: fieldMessages.device };
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 40) return { device: null, error: fieldMessages.device };
  return { device: trimmed };
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function validSeeing(value: unknown): { seeing: number | null; error?: string } {
  if (value === null) return { seeing: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10) {
    return { seeing: null, error: fieldMessages.seeing };
  }
  return { seeing: value };
}

export function validTransparency(value: unknown): { nelm: number | null; error?: string } {
  if (value === null) return { nelm: null };
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1.0 || value > 8.0) {
    return { nelm: null, error: fieldMessages.transparency_nelm };
  }
  const rounded = Math.round(value * 10) / 10;
  return { nelm: rounded };
}

export const concentrationClasses = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export function validConcentrationClass(value: unknown): { value: string | null; error?: string } {
  if (value === null) return { value: null };
  if (typeof value !== "string" || !concentrationClasses.includes(value)) {
    return { value: null, error: fieldMessages.concentration_class };
  }
  return { value };
}
