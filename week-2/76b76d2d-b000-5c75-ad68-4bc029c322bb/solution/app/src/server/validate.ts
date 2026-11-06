import { validationError, type FieldProblem } from "./errors.ts";

const EMAIL = /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[^\s@,;<>()"]+$/;
const PHONE = /^[0-9 +\-()]{7,20}$/;

/** Collects field problems for one request; `done()` throws `validation` when any exist. */
export class Fields {
  private readonly problems: Record<string, FieldProblem> = {};

  constructor(private readonly body: Record<string, unknown>) {}

  add(name: string, problem: FieldProblem): void {
    this.problems[name] ??= problem;
  }

  has(name: string): boolean {
    return name in this.problems;
  }

  private value(path: string): unknown {
    let current: unknown = this.body;
    for (const key of path.split(".")) {
      current = current !== null && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined;
    }
    return current;
  }

  /** A string of `min` to `max` characters (trimmed); empty optional text becomes "". */
  text(path: string, min: number, max: number, optional = false): string {
    const raw = this.value(path);
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (value === undefined || value === null || value === "") {
      if (!optional) this.add(path, { kind: "required" });
      return "";
    }
    const length = typeof value === "string" ? [...value].length : -1;
    if (length < min || length > max) {
      this.add(path, { kind: "length", params: { min, max } });
      return "";
    }
    return value as string;
  }

  email(path: string): string {
    const raw = this.value(path);
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (value === undefined || value === null || value === "") {
      this.add(path, { kind: "required" });
      return "";
    }
    if (typeof value !== "string" || value.length > 254 || !EMAIL.test(value)) {
      this.add(path, { kind: "email" });
      return "";
    }
    return value;
  }

  phone(path: string): string | null {
    const raw = this.value(path);
    if (raw === undefined || raw === null || raw === "") return null;
    if (typeof raw !== "string" || !PHONE.test(raw.trim())) {
      this.add(path, { kind: "length", params: { min: 7, max: 20 } });
      return null;
    }
    return raw.trim();
  }

  choice<T extends string>(path: string, options: readonly T[]): T {
    const value = this.value(path);
    if (value === undefined || value === null || value === "") {
      this.add(path, { kind: "required" });
      return options[0] as T;
    }
    if (!options.includes(value as T)) this.add(path, { kind: "choice" });
    return value as T;
  }

  integer(path: string, min: number, max: number, problem: FieldProblem): number {
    const value = this.value(path);
    if (value === undefined || value === null || value === "") {
      this.add(path, { kind: "required" });
      return min;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) this.add(path, problem);
    return typeof value === "number" ? value : min;
  }

  done(): void {
    if (Object.keys(this.problems).length) throw validationError(this.problems);
  }
}

export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;
