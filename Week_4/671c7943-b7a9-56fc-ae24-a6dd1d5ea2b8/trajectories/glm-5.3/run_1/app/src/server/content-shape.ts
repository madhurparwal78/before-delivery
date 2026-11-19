import type { Content, Project, Statistic, StatisticPart } from "../domain/model.js";

type Json = unknown;

interface ShapeError {
  path: string;
  message: string;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const SLUG_RE = /^[a-z][a-z0-9-]*$/;

function isObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: Json): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 1200;
}

function isWholeNumber(value: Json): boolean {
  return typeof value === "number" && Number.isInteger(value);
}

function checkObject(obj: Json, keys: string[], path: string, errors: ShapeError[]): Record<string, Json> | null {
  if (!isObject(obj)) {
    errors.push({ path, message: "must be an object" });
    return null;
  }
  const present = Object.keys(obj);
  for (const key of keys) {
    if (!(key in obj)) errors.push({ path: `${path}.${key}`, message: "is required" });
  }
  for (const key of present) {
    if (!keys.includes(key)) errors.push({ path: `${path}.${key}`, message: "is not allowed" });
  }
  return obj;
}

function checkTextArray(value: Json, min: number, max: number, path: string, errors: ShapeError[]): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    errors.push({ path, message: `must be a list of ${min} to ${max} items` });
    return [];
  }
  const items: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (!isText(item)) {
      errors.push({ path: `${path}[${i}]`, message: "must be text of 1 to 1,200 characters" });
    } else {
      items.push(item);
    }
  }
  return items;
}

function checkProject(value: Json, errors: ShapeError[]): Project | null {
  const path = "projects[]";
  const obj = checkObject(value, [
    "slug", "title", "client", "category", "year", "hue", "motif", "role", "duration",
    "standfirst", "overview", "objectives", "palette", "screens", "process", "results",
  ], path, errors);
  if (!obj) return null;

  let ok = true;
  const text = (key: string): string => {
    const v: Json = obj[key];
    if (!isText(v)) {
      errors.push({ path: `${path}.${key}`, message: "must be text of 1 to 1,200 characters" });
      ok = false;
      return "";
    }
    return v as string;
  };
  const whole = (key: string, min: number, max: number): number => {
    const v: Json = obj[key];
    if (!isWholeNumber(v) || (v as number) < min || (v as number) > max) {
      errors.push({ path: `${path}.${key}`, message: `must be a whole number from ${min} to ${max}` });
      ok = false;
      return min;
    }
    return v as number;
  };

  const slug = text("slug");
  if (ok && !SLUG_RE.test(slug)) {
    errors.push({ path: `${path}.slug`, message: "must be 2 to 40 characters of lowercase letters, digits and hyphens, starting with a letter" });
    ok = false;
  }
  const category: Json = obj.category;
  const categories = ["brand-identity", "website-design", "digital-product-design"];
  if (typeof category !== "string" || !categories.includes(category)) {
    errors.push({ path: `${path}.category`, message: "must be one of brand-identity, website-design, digital-product-design" });
    ok = false;
  }
  const motif: Json = obj.motif;
  if (typeof motif !== "string" || !["arcs", "grid", "stack"].includes(motif)) {
    errors.push({ path: `${path}.motif`, message: "must be one of arcs, grid, stack" });
    ok = false;
  }
  const objectives = checkTextArray(obj.objectives, 1, 5, `${path}.objectives`, errors);
  const paletteRaw: Json = obj.palette;
  const palette: Project["palette"] = [];
  if (!Array.isArray(paletteRaw) || paletteRaw.length < 1 || paletteRaw.length > 5) {
    errors.push({ path: `${path}.palette`, message: "must be a list of 1 to 5 colours" });
    ok = false;
  } else {
    for (let i = 0; i < paletteRaw.length; i++) {
      const colour = checkObject(paletteRaw[i], ["name", "hex"], `${path}.palette[${i}]`, errors);
      if (!colour) {
        ok = false;
        continue;
      }
      const name = colour.name;
      const hex = colour.hex;
      if (!isText(name) || (typeof hex !== "string" || !HEX_RE.test(hex))) {
        errors.push({ path: `${path}.palette[${i}]`, message: "must hold a name and a hex code of # plus six hex digits" });
        ok = false;
        continue;
      }
      palette.push({ name, hex });
    }
  }
  const screensRaw: Json = obj.screens;
  const screens: Project["screens"] = [];
  if (!Array.isArray(screensRaw) || screensRaw.length < 1 || screensRaw.length > 6) {
    errors.push({ path: `${path}.screens`, message: "must be a list of 1 to 6 screens" });
    ok = false;
  } else {
    for (let i = 0; i < screensRaw.length; i++) {
      const screen = checkObject(screensRaw[i], ["caption"], `${path}.screens[${i}]`, errors);
      if (!screen) {
        ok = false;
        continue;
      }
      if (!isText(screen.caption)) {
        errors.push({ path: `${path}.screens[${i}].caption`, message: "must be text of 1 to 1,200 characters" });
        ok = false;
        continue;
      }
      screens.push({ caption: screen.caption });
    }
  }
  const processRaw: Json = obj.process;
  const process: number[] = [];
  if (!Array.isArray(processRaw) || processRaw.length !== 4 || !processRaw.every((w) => isWholeNumber(w) && (w as number) >= 1 && (w as number) <= 12)) {
    errors.push({ path: `${path}.process`, message: "must be exactly four whole numbers, each from 1 to 12" });
    ok = false;
  } else {
    processRaw.forEach((w) => process.push(w as number));
  }
  const resultsRaw: Json = obj.results;
  const results: Project["results"] = [];
  if (!Array.isArray(resultsRaw) || resultsRaw.length < 1 || resultsRaw.length > 4) {
    errors.push({ path: `${path}.results`, message: "must be a list of 1 to 4 results" });
    ok = false;
  } else {
    for (let i = 0; i < resultsRaw.length; i++) {
      const result = checkObject(resultsRaw[i], ["value", "label"], `${path}.results[${i}]`, errors);
      if (!result) {
        ok = false;
        continue;
      }
      if (!isText(result.value) || !isText(result.label)) {
        errors.push({ path: `${path}.results[${i}]`, message: "must hold a value and a label of 1 to 1,200 characters" });
        ok = false;
        continue;
      }
      results.push({ value: result.value, label: result.label });
    }
  }
  if (!ok) return null;
  return {
    slug,
    title: text("title"),
    client: text("client"),
    category: category as Project["category"],
    year: whole("year", 2000, 2026),
    hue: whole("hue", 0, 359),
    motif: motif as Project["motif"],
    role: text("role"),
    duration: text("duration"),
    standfirst: text("standfirst"),
    overview: text("overview"),
    objectives,
    palette,
    screens,
    process,
    results,
  };
}

function checkStatistic(item: Json, errors: ShapeError[]): Statistic | null {
  const path = "stats[]";
  const obj = checkObject(item, ["id", "value", "label", "note", "parts"], path, errors);
  if (!obj) return null;
  let ok = true;
  if (!isText(obj.id)) {
    errors.push({ path: `${path}.id`, message: "must be text of 1 to 1,200 characters" });
    ok = false;
  }
  const value: Json = obj.value;
  if (!isWholeNumber(value) || (value as number) < 1 || (value as number) > 99999) {
    errors.push({ path: `${path}.value`, message: "must be a whole number from 1 to 99,999" });
    ok = false;
  }
  if (!isText(obj.label)) {
    errors.push({ path: `${path}.label`, message: "must be text of 1 to 1,200 characters" });
    ok = false;
  }
  if (!isText(obj.note)) {
    errors.push({ path: `${path}.note`, message: "must be text of 1 to 1,200 characters" });
    ok = false;
  }
  const partsRaw: Json = obj.parts;
  const parts: StatisticPart[] = [];
  if (!Array.isArray(partsRaw) || partsRaw.length < 2 || partsRaw.length > 4) {
    errors.push({ path: `${path}.parts`, message: "must be a list of 2 to 4 parts" });
    ok = false;
  } else {
    for (let i = 0; i < partsRaw.length; i++) {
      const part = checkObject(partsRaw[i], ["label", "value"], `${path}.parts[${i}]`, errors);
      if (!part) {
        ok = false;
        continue;
      }
      const partValue: Json = part.value;
      if (!isText(part.label) || !isWholeNumber(partValue)) {
        errors.push({ path: `${path}.parts[${i}]`, message: "must hold a label and a whole-number value" });
        ok = false;
        continue;
      }
      parts.push({ label: part.label, value: partValue as number });
    }
  }
  if (ok && parts.length >= 2 && isWholeNumber(value)) {
    const sum = parts.reduce((acc, part) => acc + part.value, 0);
    if (sum !== (value as number)) {
      errors.push({ path: `${path}.parts`, message: "part values must add up to the statistic's value" });
      ok = false;
    }
  }
  if (!ok) return null;
  return {
    id: obj.id as string,
    value: value as number,
    label: obj.label as string,
    note: obj.note as string,
    parts,
  };
}

export function parseContent(body: Json): Content | null {
  const errors: ShapeError[] = [];
  const obj = checkObject(body, ["projects", "stats"], "body", errors);
  if (!obj) return null;
  const projectsRaw = obj.projects;
  if (!Array.isArray(projectsRaw) || projectsRaw.length < 1 || projectsRaw.length > 24) {
    errors.push({ path: "projects", message: "must be a list of 1 to 24 projects" });
    return null;
  }
  const statsRaw = obj.stats;
  if (!Array.isArray(statsRaw) || statsRaw.length < 1 || statsRaw.length > 4) {
    errors.push({ path: "stats", message: "must be a list of 1 to 4 statistics" });
    return null;
  }
  const projects: Project[] = [];
  const stats: Statistic[] = [];
  for (const p of projectsRaw) {
    const project = checkProject(p, errors);
    if (project) projects.push(project);
  }
  for (const s of statsRaw) {
    const stat = checkStatistic(s, errors);
    if (stat) stats.push(stat);
  }
  if (errors.length > 0) return null;
  const slugs = new Set(projects.map((p) => p.slug));
  if (slugs.size !== projects.length) return null;
  const ids = new Set(stats.map((s) => s.id));
  if (ids.size !== stats.length) return null;
  return { projects, stats };
}
