import type { Owner } from "../../shared/api";
import type { StepLengths } from "../../shared/bake-protocol";
import { encodeText, firstUnencodable } from "../../shared/bytes";
import type { InputEncoding } from "../../shared/bytes";
import { defaultArgs, operationDefinition } from "../../shared/operations/catalogue";
import type { Step } from "../../shared/operations/types";
import { createStore } from "../store";

/** A step in the recipe being worked on; the id keeps its card stable while it moves. */
export interface StepItem extends Step {
  id: string;
}

interface InputFile {
  name: string;
  bytes: Uint8Array;
  /** The stored file's id, or null for bytes that arrived in a link. */
  id: string | null;
}

export interface InputTab {
  id: string;
  text: string;
  encoding: InputEncoding;
  file: InputFile | null;
  /** The selection in the text box, in characters. */
  selection: { start: number; end: number };
}

/** The saved recipe the workbench is editing. */
export interface RecipeBinding {
  recipeId: string;
  name: string;
  tags: string[];
  owner: Owner;
  baseVersion: number;
  /** The steps of the base version, so edits can be told from a clean copy. */
  savedKey: string;
}

interface RecipeUpdate {
  authorName: string;
  version: number;
}

export interface BakeView {
  phase: "idle" | "running" | "paused" | "done" | "error";
  busy: boolean;
  statusText: string;
  /** The steps and the input size this bake ran over, so span chips are never shown against a different recipe or input. */
  stepsKey: string;
  inputLength: number;
  current: number | null;
  errorStep: number | null;
  /** The published error line, which replaces the output after a failure. */
  failureText: string | null;
  output: Uint8Array;
  lengths: (StepLengths | null)[];
  reached: number;
}

export interface Layout {
  operations: number;
  recipe: number;
  inputShare: number;
}

export const DEFAULT_LAYOUT: Layout = { operations: 20, recipe: 50, inputShare: 50 };

export type OutputView = "Text" | "Hex";

interface WorkbenchState {
  ready: boolean;
  steps: StepItem[];
  tabs: InputTab[];
  activeTab: number;
  binding: RecipeBinding | null;
  update: RecipeUpdate | null;
  favourites: string[];
  autoBake: boolean;
  outputView: OutputView;
  bake: BakeView;
  link: string | null;
  topAlert: string | null;
  inputAlert: string | null;
  layout: Layout;
  /** The step card that should take focus after the next render. */
  focusStep: { id: string; nonce: number } | null;
  /** The phone panel in front. */
  panel: "Operations" | "Recipe" | "Input" | "Output";
}

export const DEFAULT_FAVOURITES = ["To Base64", "From Base64", "To Hex", "Gunzip", "JSON Beautify"];

let counter = 0;
export const newId = (prefix: string): string => `${prefix}${++counter}`;

export function newStep(op: string): StepItem {
  return { id: newId("s"), op, args: defaultArgs(operationDefinition(op)), disabled: false, breakpoint: false };
}

export function newTab(): InputTab {
  return { id: newId("t"), text: "", encoding: "UTF-8", file: null, selection: { start: 0, end: 0 } };
}

const IDLE_BAKE: BakeView = {
  phase: "idle", busy: false, statusText: "", stepsKey: "", inputLength: 0, current: null, errorStep: null, failureText: null,
  output: new Uint8Array(0), lengths: [], reached: 0,
};

export const workbench = createStore<WorkbenchState>({
  ready: false,
  steps: [],
  tabs: [newTab()],
  activeTab: 0,
  binding: null,
  update: null,
  favourites: DEFAULT_FAVOURITES,
  autoBake: true,
  outputView: "Text",
  bake: IDLE_BAKE,
  link: null,
  topAlert: null,
  inputAlert: null,
  layout: DEFAULT_LAYOUT,
  focusStep: null,
  panel: "Recipe",
});

export const patch = (changes: Partial<WorkbenchState>): void => workbench.set((state) => ({ ...state, ...changes }));

/** Steps in the compact form a link and the saved-copy comparison use: no ids, args in catalogue order, flags only when set. */
export function compactSteps(steps: readonly Step[]): object[] {
  return steps.map((step) => ({
    op: step.op,
    args: Object.fromEntries(operationDefinition(step.op).args.map((arg) => [arg.key, step.args[arg.key]])),
    ...(step.disabled ? { disabled: true } : {}),
    ...(step.breakpoint ? { breakpoint: true } : {}),
  }));
}

export const stepsKey = (steps: readonly Step[]): string => JSON.stringify(compactSteps(steps));

export const activeTab = (state: WorkbenchState): InputTab => state.tabs[state.activeTab] as InputTab;

/** The bytes a tab bakes, or null while its text holds a character the encoding cannot encode. */
export function inputBytes(tab: InputTab): Uint8Array | null {
  if (tab.file) return tab.file.bytes;
  return firstUnencodable(tab.text, tab.encoding) === null ? encodeText(tab.text, tab.encoding) : null;
}
