import type { LiveMessage, RecipeSummary, Version, VersionHeader } from "../../shared/api";
import { decodeUtf8Strict, firstUnencodable } from "../../shared/bytes";
import type { InputEncoding } from "../../shared/bytes";
import type { ArgValue } from "../../shared/operations/types";
import { announce } from "../announce";
import { api, ApiFailure, apiBytes, config, uploadFile } from "../api";
import { navigate } from "../router";
import { session } from "../session";
import { bakeFresh, cancelBake, scheduleAutobake, stopAutobake } from "./bake";
import { readLink, recipeLink } from "./link";
import { persistSoon, restore } from "./persist";
import { spanOf } from "./spanView";
import {
  activeTab, DEFAULT_FAVOURITES, inputBytes, newId, newStep, newTab, patch, stepsKey, workbench,
} from "./state";
import type { InputTab, StepItem } from "./state";

const SIGN_IN_ALERT = "Sign in to save recipes, open files or share snapshots.";
export const MAX_TABS = 10;

/** Compressed JSON the starter recipe opens over: gzip of the sample invoice event, in Standard Base64. */
const STARTER_INPUT =
  "H4sIAAAAAAACEzWLwQpAQBRF/+WuJw1Zzd4PKCtJGq9MzIx4lCb/7lGWp3NOAp0UGAYunNFZytbBjVA/wiQIf7rPdVmIGnw83qUstFawx7ZRsJc0VVPjlpXJ7zAtZmJeSA67RJ7Q3Q8eyU6SbgAAAA==";

/** Everything that follows a change to the recipe or an input: the pause ends and the next bake is planned. */
function changed(options: { bakeNow?: boolean } = {}): void {
  cancelBake();
  patch({ link: null });
  persistSoon();
  if (options.bakeNow) bakeFresh();
  else scheduleAutobake();
}

const updateTab = (change: (tab: InputTab) => InputTab): void =>
  workbench.set((state) => ({ ...state, tabs: state.tabs.map((tab, index) => (index === state.activeTab ? change(tab) : tab)) }));

export function requireSignIn(): boolean {
  if (session.get().user) return true;
  patch({ topAlert: SIGN_IN_ALERT });
  return false;
}

/* ----- steps ----- */

let focusNonce = 0;
const focusCard = (id: string): void => patch({ focusStep: { id, nonce: ++focusNonce } });

export function addStep(op: string): void {
  const step = newStep(op);
  const steps = [...workbench.get().steps, step];
  patch({ steps });
  announce(`Added ${op} at step ${steps.length}`);
  changed();
}

export function removeStep(id: string): void {
  const { steps } = workbench.get();
  const index = steps.findIndex((step) => step.id === id);
  const removed = steps[index] as StepItem;
  const remaining = steps.filter((step) => step.id !== id);
  patch({ steps: remaining });
  const next = remaining[Math.min(index, remaining.length - 1)];
  if (next) focusCard(next.id);
  announce(`Removed ${removed.op} from step ${index + 1}`);
  changed();
}

function moveTo(id: string, to: number): number {
  const { steps } = workbench.get();
  const from = steps.findIndex((step) => step.id === id);
  if (to < 0 || to >= steps.length || to === from) return from;
  const reordered = [...steps];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved as StepItem);
  patch({ steps: reordered });
  changed();
  return to;
}

/** Alt+ArrowUp and Alt+ArrowDown: one place, announced at once. */
export function moveStep(id: string, delta: -1 | 1): void {
  const { steps } = workbench.get();
  const from = steps.findIndex((step) => step.id === id);
  if (moveTo(id, from + delta) === from) return;
  announce(`Moved ${(steps[from] as StepItem).op} to step ${from + delta + 1}`);
  focusCard(id);
}

/** A drag moves the step as the pointer travels; the move is announced once, when it is dropped. */
export function dragStepTo(id: string, to: number): void {
  moveTo(id, to);
}

export function dropStep(id: string, startedAt: number): void {
  const { steps } = workbench.get();
  const index = steps.findIndex((step) => step.id === id);
  if (index !== startedAt) announce(`Moved ${(steps[index] as StepItem).op} to step ${index + 1}`);
}

const updateStep = (id: string, change: (step: StepItem) => StepItem): void =>
  patch({ steps: workbench.get().steps.map((step) => (step.id === id ? change(step) : step)) });

export function toggleDisabled(id: string): void {
  const { steps } = workbench.get();
  const index = steps.findIndex((step) => step.id === id);
  const disabled = !(steps[index] as StepItem).disabled;
  updateStep(id, (step) => ({ ...step, disabled }));
  announce(`${disabled ? "Disabled" : "Enabled"} step ${index + 1}`);
  changed();
}

export function toggleBreakpoint(id: string): void {
  const { steps } = workbench.get();
  const index = steps.findIndex((step) => step.id === id);
  const breakpoint = !(steps[index] as StepItem).breakpoint;
  updateStep(id, (step) => ({ ...step, breakpoint }));
  announce(`Breakpoint ${breakpoint ? "set on" : "cleared on"} step ${index + 1}`);
  changed();
}

export function setArgument(id: string, key: string, value: ArgValue): void {
  updateStep(id, (step) => ({ ...step, args: { ...step.args, [key]: value } }));
  changed();
}

export function clearRecipe(): void {
  patch({ steps: [] });
  announce("Recipe cleared");
  changed();
}

export function focusNeighbour(id: string, delta: -1 | 1): void {
  const { steps } = workbench.get();
  const neighbour = steps[steps.findIndex((step) => step.id === id) + delta];
  if (neighbour) focusCard(neighbour.id);
}

/* ----- inputs ----- */

const tooLarge = (size: number): string => `Input too large: ${size} bytes (limit ${config().inputMaxBytes} bytes).`;

export function setText(text: string, encoding?: InputEncoding): void {
  const tab = activeTab(workbench.get());
  const kind = encoding ?? tab.encoding;
  if (firstUnencodable(text, kind) === null) {
    const size = inputBytes({ ...tab, text, encoding: kind, file: null })?.length ?? 0;
    if (size > config().inputMaxBytes) {
      patch({ inputAlert: tooLarge(size) });
      return;
    }
  }
  updateTab((current) => ({ ...current, text, encoding: kind }));
  patch({ inputAlert: null });
  changed();
}

export function setEncoding(encoding: InputEncoding): void {
  setText(activeTab(workbench.get()).text, encoding);
}

export function setSelection(start: number, end: number): void {
  const tab = activeTab(workbench.get());
  if (tab.selection.start === start && tab.selection.end === end) return;
  updateTab((current) => ({ ...current, selection: { start, end } }));
  const state = workbench.get();
  const span = spanOf(state.steps, state.bake, activeTab(state));
  if (!span) return;
  if (span.lost) announce(`Span lost at step ${(span.at as number) + 1}`);
  else if (span.final) announce(`Span maps to characters ${span.final.start} to ${span.final.end - 1} at step ${(span.at as number) + 1}`);
}

export function addTab(): void {
  const { tabs } = workbench.get();
  if (tabs.length >= MAX_TABS) return;
  patch({ tabs: [...tabs, newTab()], activeTab: tabs.length, inputAlert: null });
  changed({ bakeNow: true });
}

export function selectTab(index: number): void {
  patch({ activeTab: index, inputAlert: null });
  changed({ bakeNow: true });
}

export function clearInput(): void {
  updateTab((tab) => ({ ...tab, text: "", file: null, selection: { start: 0, end: 0 } }));
  patch({ inputAlert: null });
  changed();
}

/** The file flow: refused before upload when over the cap, stored in MinIO before it becomes the input. */
export async function takeFile(file: File): Promise<void> {
  if (!requireSignIn()) return;
  if (file.size > config().fileMaxBytes) {
    patch({ inputAlert: `File too large: ${file.size} bytes (limit ${config().fileMaxBytes} bytes).` });
    return;
  }
  const tabId = activeTab(workbench.get()).id;
  patch({ inputAlert: `Uploading ${file.name}…` });
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const stored = await uploadFile(file.name, bytes);
    workbench.set((state) => ({
      ...state,
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, text: "", file: { name: stored.name, bytes, id: stored.id }, selection: { start: 0, end: 0 } } : tab)),
      inputAlert: null,
    }));
    changed();
  } catch (error) {
    patch({ inputAlert: error instanceof ApiFailure ? error.message : "The file could not be stored." });
  }
}

/* ----- link ----- */

export async function copyLink(): Promise<void> {
  const bytes = inputBytes(activeTab(workbench.get()));
  if (!bytes) return;
  const link = recipeLink(workbench.get().steps, bytes);
  patch({ link });
  await navigator.clipboard.writeText(link).catch(() => undefined);
  announce("Link copied");
}

/* ----- recipes ----- */

function adopt(summary: RecipeSummary, version: Version): void {
  patch({
    steps: version.steps.map((step) => ({ ...step, id: newId("s") })),
    binding: {
      recipeId: summary.id, name: version.name, tags: version.tags, owner: summary.owner, baseVersion: version.n,
      savedKey: stepsKey(version.steps),
    },
    update: null,
  });
}

async function fetchRecipe(id: string, wanted?: number): Promise<{ summary: RecipeSummary; version: Version }> {
  const detail = await api<{ recipe: RecipeSummary; versions: VersionHeader[] }>("GET", `/api/recipes/${id}`);
  const { version } = await api<{ version: Version }>("GET", `/api/recipes/${id}/versions/${wanted ?? detail.recipe.latestVersion}`);
  return { summary: detail.recipe, version };
}

/** "Load latest": the newest version replaces the steps; every input tab stays. */
export async function loadLatest(): Promise<void> {
  const binding = workbench.get().binding;
  if (!binding) return;
  const { summary, version } = await fetchRecipe(binding.recipeId);
  adopt(summary, version);
  changed({ bakeNow: true });
}

/** The recipe as saved: the binding follows the save, and the steps now match it. */
export function recordSave(summary: RecipeSummary, version: Version): void {
  patch({
    binding: {
      recipeId: summary.id, name: version.name, tags: version.tags, owner: summary.owner, baseVersion: version.n,
      savedKey: stepsKey(version.steps),
    },
    update: null,
  });
  persistSoon();
  announce(`Recipe saved as version ${version.n}`);
}

export function keepMine(): void {
  patch({ update: null });
}

let saving = false;
let heldDuringSave: LiveMessage[] = [];

/** Wraps a save so a live message about it is not mistaken for someone else's edit. */
export async function whileSaving<T>(save: () => Promise<T>, versionOf: (saved: T) => number): Promise<T> {
  saving = true;
  heldDuringSave = [];
  try {
    const saved = await save();
    const n = versionOf(saved);
    saving = false;
    heldDuringSave.filter((message) => message.type === "version_saved" && message.version > n).forEach(handleLive);
    return saved;
  } finally {
    saving = false;
    heldDuringSave = [];
  }
}

export function handleLive(message: LiveMessage): void {
  if (message.type !== "version_saved") return;
  if (saving) {
    heldDuringSave.push(message);
    return;
  }
  const { binding } = workbench.get();
  if (!binding || binding.recipeId !== message.recipeId || message.version <= binding.baseVersion) return;
  patch({ update: { authorName: message.authorName, version: message.version } });
  announce(`Recipe updated by ${message.authorName}`);
}

/** After the live channel returns: look for a version saved while it was down. */
export async function catchUp(): Promise<void> {
  const binding = workbench.get().binding;
  if (!binding) return;
  const detail = await api<{ recipe: RecipeSummary; versions: VersionHeader[] }>("GET", `/api/recipes/${binding.recipeId}`).catch(() => null);
  const newest = detail?.versions[0];
  if (!newest || newest.n <= binding.baseVersion) return;
  patch({ update: { authorName: newest.author.displayName, version: newest.n } });
  announce(`Recipe updated by ${newest.author.displayName}`);
}

/* ----- starting points ----- */

function startFresh(): void {
  patch({
    steps: ["From Base64", "Gunzip", "JSON Beautify"].map(newStep),
    tabs: [{ ...newTab(), text: STARTER_INPUT }],
    activeTab: 0,
    binding: null,
  });
}

function emptyWorkbench(): void {
  patch({ steps: [], tabs: [newTab()], activeTab: 0, binding: null, update: null, inputAlert: null });
}

function openLink(fragment: string): void {
  const contents = readLink(fragment);
  emptyWorkbench();
  if ("damaged" in contents) {
    patch({ topAlert: `This link is damaged: the ${contents.damaged} part is not valid.` });
    return;
  }
  const text = decodeUtf8Strict(contents.input);
  const tab: InputTab = text === null
    ? { ...newTab(), file: { name: "link input", bytes: contents.input, id: null } }
    : { ...newTab(), text };
  patch({ steps: contents.steps.map((step) => ({ ...step, id: newId("s") })), tabs: [tab], topAlert: null });
}

async function openRecipe(id: string, version?: number): Promise<void> {
  emptyWorkbench();
  try {
    const { summary, version: loaded } = await fetchRecipe(id, version);
    adopt(summary, loaded);
    patch({ topAlert: null });
    void api<void>("POST", `/api/recipes/${id}/opened`).catch(() => undefined);
  } catch (error) {
    patch({ topAlert: error instanceof ApiFailure && error.status === 401 ? SIGN_IN_ALERT : "This recipe is not available." });
  }
}

async function refetchFiles(pending: { tab: number; id: string; name: string }[]): Promise<void> {
  for (const file of pending) {
    try {
      const { bytes } = await apiBytes(`/api/files/${file.id}`);
      workbench.set((state) => ({
        ...state,
        tabs: state.tabs.map((tab, index) => (index === file.tab ? { ...tab, file: { name: file.name, bytes, id: file.id } } : tab)),
      }));
    } catch {
      continue;
    }
  }
  bakeFresh();
}

let started = false;

/** Opens the workbench from the address: a link, a recipe, what this browser remembers, or the starter recipe. */
export async function openFromAddress(): Promise<void> {
  const { pathname, search, hash } = window.location;
  const params = new URLSearchParams(search);
  if (hash.includes("r=")) {
    openLink(hash.slice(1));
    window.history.replaceState(null, "", pathname);
  } else if (params.get("recipe")) {
    const version = params.get("version");
    await openRecipe(params.get("recipe") as string, version ? Number(version) : undefined);
    navigate("/w", true);
  } else if (!started) {
    const remembered = restore();
    if (remembered) {
      patch({
        steps: remembered.steps, tabs: remembered.tabs, activeTab: remembered.activeTab, binding: remembered.binding,
        favourites: remembered.favourites ?? DEFAULT_FAVOURITES,
      });
      if (remembered.pendingFiles.length) void refetchFiles(remembered.pendingFiles);
      if (remembered.binding) void catchUp();
    } else {
      startFresh();
    }
  } else {
    return;
  }
  started = true;
  patch({ ready: true });
  persistSoon();
  bakeFresh();
}

export function setFavourites(favourites: string[]): void {
  patch({ favourites });
  persistSoon();
}

export function setAutoBake(autoBake: boolean): void {
  patch({ autoBake });
  if (!autoBake) stopAutobake();
}

