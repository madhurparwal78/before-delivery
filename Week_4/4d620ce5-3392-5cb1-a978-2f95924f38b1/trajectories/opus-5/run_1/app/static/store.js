// Board state as the server last reported it, and one way to run an action.

import { announceError, announceStatus } from "./a11y.js";
import { errorText } from "./copy.js";

export const state = {
  user: null,
  board: null,
  route: "board",
  openThreadId: null,
  thread: null,
  prior: null, // { directiveId, tag, cells, directive }
  filter: null, // { category, tag, ids }
  banner: null, // { directiveId, splice }
  pickedDirectiveId: null,
  playedSplices: new Set(),
};

export const hooks = {
  refreshBoard: async () => {},
  refreshDrawer: async () => {},
  renderFrame: () => {},
  signOut: () => {},
};

export function directives() {
  return state.board ? state.board.directives : [];
}

export function directiveById(id) {
  return directives().find((directive) => directive.id === id) || null;
}

export function directiveLabel(directive) {
  return `${directive.authority} ${directive.number}`;
}

export function cellFor(registration, directiveId) {
  if (!state.board) return null;
  return (
    state.board.cells.find(
      (cell) => cell.registration === registration && cell.directive_id === directiveId
    ) || null
  );
}

export function cellById(threadId) {
  if (!state.board) return null;
  return state.board.cells.find((cell) => cell.thread_id === threadId) || null;
}

export function isPlanner() {
  return state.user && state.user.role === "compliance_planner";
}

export function isClerk() {
  return state.user && state.user.role === "records_clerk";
}

export function isInspector() {
  return state.user && state.user.role === "licensed_inspector";
}

export function isEngineer() {
  return state.user && state.user.role === "certifying_engineer";
}

export function isAuditor() {
  return state.user && state.user.role === "regulator_auditor";
}

/**
 * Run one server action: pending copy, then success copy or the published error copy.
 * `onFields` takes a 422's field messages so they can be shown under their fields.
 */
export async function runAction({ pending, run, success, context = {}, onFields }) {
  announceError("");
  announceStatus(pending || "");
  let response;
  try {
    response = await run();
  } catch (error) {
    announceStatus("");
    return { ok: false, offline: true };
  }
  if (!response.ok) {
    announceStatus("");
    if (response.error && response.error.code === "validation" && onFields) {
      onFields(response.error.fields || {});
    } else {
      announceError(errorText(response.error, context));
    }
    return response;
  }
  announceStatus(success ? success(response) : "");
  return response;
}
