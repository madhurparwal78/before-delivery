import type { Owner } from "../../shared/api";
import { INPUT_ENCODINGS } from "../../shared/bytes";
import type { InputEncoding } from "../../shared/bytes";
import { parseSteps } from "../../shared/operations/validate";
import { fromBase64, toBase64 } from "./link";
import { compactSteps, newId, newTab, workbench } from "./state";
import type { InputTab, RecipeBinding, StepItem } from "./state";

const KEY = "wringbench.workbench.1";
const PERSIST_AFTER_MS = 300;

interface SavedTab {
  text: string;
  encoding: InputEncoding;
  file: { name: string; id: string | null; bytes: string | null } | null;
  selection: { start: number; end: number };
}

interface Saved {
  steps: unknown;
  tabs: SavedTab[];
  activeTab: number;
  binding: RecipeBinding | null;
  favourites: string[];
}

function save(): void {
  const { steps, tabs, activeTab, binding, favourites } = workbench.get();
  const saved: Saved = {
    steps: compactSteps(steps),
    tabs: tabs.map((tab) => ({
      text: tab.text,
      encoding: tab.encoding,
      file: tab.file ? { name: tab.file.name, id: tab.file.id, bytes: tab.file.id ? null : toBase64(tab.file.bytes) } : null,
      selection: tab.selection,
    })),
    activeTab,
    binding,
    favourites,
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // The browser refused to store this much; the workbench simply starts fresh next time.
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Remembers the workbench in this browser shortly after a change, and at once when the page goes away. */
export function persistSoon(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(save, PERSIST_AFTER_MS);
}

export function persistOnLeave(): () => void {
  const flush = (): void => save();
  window.addEventListener("pagehide", flush);
  return () => window.removeEventListener("pagehide", flush);
}

interface Restored {
  steps: StepItem[];
  tabs: InputTab[];
  activeTab: number;
  binding: RecipeBinding | null;
  favourites: string[] | null;
  /** Stored files whose bytes still have to be fetched, by tab index. */
  pendingFiles: { tab: number; id: string; name: string }[];
}

const isOwner = (value: unknown): value is Owner => typeof value === "object" && value !== null && "type" in value && "id" in value;

export function restore(): Restored | null {
  let saved: Saved;
  try {
    saved = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Saved;
  } catch {
    return null;
  }
  if (!saved || !Array.isArray(saved.tabs) || saved.tabs.length === 0) return null;
  const parsed = parseSteps(saved.steps);
  const steps: StepItem[] = "steps" in parsed ? parsed.steps.map((step) => ({ ...step, id: newId("s") })) : [];
  const pendingFiles: Restored["pendingFiles"] = [];
  const tabs = saved.tabs.map((entry, index): InputTab => {
    const tab: InputTab = {
      ...newTab(),
      text: entry.text,
      encoding: INPUT_ENCODINGS.includes(entry.encoding) ? entry.encoding : "UTF-8",
      selection: entry.selection,
    };
    if (entry.file?.bytes) tab.file = { name: entry.file.name, id: null, bytes: fromBase64(entry.file.bytes) };
    else if (entry.file?.id) pendingFiles.push({ tab: index, id: entry.file.id, name: entry.file.name });
    return tab;
  });
  const binding = saved.binding && isOwner(saved.binding.owner) ? saved.binding : null;
  return {
    steps, tabs, binding, pendingFiles,
    activeTab: Math.min(Math.max(saved.activeTab, 0), tabs.length - 1),
    favourites: Array.isArray(saved.favourites) ? saved.favourites : null,
  };
}
