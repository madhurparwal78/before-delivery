// Every published sentence the board shows. One place, one wording.

export const ROLE_LABELS = {
  compliance_planner: "Compliance planner",
  licensed_inspector: "Licensed inspector",
  certifying_engineer: "Certifying engineer",
  records_clerk: "Records clerk",
  regulator_auditor: "Regulator auditor",
};

export const MODEL_LABELS = {
  "ATR72-212A": "ATR 72",
  "DHC-8-402": "Dash 8-400",
  "ERJ-170-200": "E175",
};

export const AUTHORITIES = ["EASA", "UK CAA", "ATR", "De Havilland", "Embraer"];

export const COUNT_LABELS = {
  open: "Open",
  due_soon: "Due soon",
  overdue: "Overdue",
  deferred: "Deferred",
  complied: "Complied",
};

export const SESSION_ENDED = "Your session has ended. Sign in again.";
export const BAD_CREDENTIALS = "Username or passcode is wrong.";
export const FORBIDDEN = "Your role cannot do this.";
export const NOT_HOLDER = "You no longer hold this work card.";
export const RETRYING = "Connection lost. Retrying with the same request.";
export const STILL_OFFLINE =
  "Still offline. Nothing was confirmed. Press again to retry with the same request.";
export const LIVE_DROPPED = "Live updates paused. Reconnecting…";
export const LIVE_RESUMED = "Live updates resumed.";

export const PENDING = {
  signin: "Signing in…",
  ingest: (tag) => `Ingesting ${tag}…`,
  claim: (card) => `Claiming ${card}…`,
  release: (card) => `Releasing ${card}…`,
  evidence: "Uploading evidence…",
  inspection: "Signing inspection…",
  countersign: "Countersigning…",
  defer: "Deferring…",
  effectivity: "Saving…",
  hours: "Logging hours…",
  import: "Importing…",
  reopen: "Reopening…",
  scope: "Saving scope…",
  erase: "Erasing…",
  pack: "Preparing pack…",
  withdraw: "Withdrawing…",
};

export const SUCCESS = {
  ingest: (directive, tag) => `${directive} ${tag} ingested.`,
  claim: (card) => `Work card ${card} is yours.`,
  release: (card) => `Work card ${card} released.`,
  evidence: "Evidence attached.",
  inspection: (tag, timeliness) =>
    `Inspection signed under ${tag}, ${timeliness === "overdue" ? "overdue" : "on time"}.`,
  countersign: (tag) => `Countersigned under ${tag}. Thread closed.`,
  defer: (due) => `Deferred. New due ${due}.`,
  effectivity: (decision) =>
    decision === "confirmed" ? "Effectivity confirmed." : "Marked not applicable.",
  hours: (registration, total) => `${registration} now at ${total.toFixed(1)} FH.`,
  import: (result) =>
    `Import finished: ${result.merged} merged, ${result.duplicates} duplicates, ` +
    `${result.orphans.length} orphans, ${result.rejected.length} rejected.`,
  importReplayed: "This file was already imported. Nothing changed.",
  reopen: "Thread reopened. Prior signatures kept as void.",
  scope: (count) => `Scope saved. ${count} threads passed on.`,
  erase: (token) => `${token} now replaces this contractor everywhere.`,
  packTransmitted: "Pack transmitted to the authority.",
  packQueued: (service) =>
    `Pack queued: ${service} is unavailable. It will go out automatically.`,
  withdraw: (directive) => `${directive} withdrawn. History kept.`,
};

const SERVICE_LABELS = { object_storage: "object storage", mail: "mail" };

export function serviceLabel(waitingFor) {
  return SERVICE_LABELS[waitingFor] || "mail";
}

// Error copy, by code. `context` carries the directive label, card, tags and so on.
export function errorText(error, context = {}) {
  const code = error && error.code;
  switch (code) {
    case "unauthenticated":
      return SESSION_ENDED;
    case "forbidden":
      return FORBIDDEN;
    case "not_holder":
      return NOT_HOLDER;
    case "directive_withdrawn":
      return `${context.directive || "This directive"} is withdrawn.`;
    case "directive_exists":
      return `${context.directive || "That directive"} is already on the board.`;
    case "revision_out_of_order":
      return `This directive is now at ${error.current}. Reload and try again.`;
    case "storage_unavailable":
      return context.evidence
        ? "Evidence storage is unavailable. Nothing was attached."
        : "Document storage is unavailable. Nothing was ingested.";
    case "payload_too_large":
      return "That file is larger than 5,000,000 bytes.";
    case "card_held":
      return `Already held by ${error.holder ? error.holder.display_name : "another inspector"}.`;
    case "effectivity_unconfirmed":
      return "Waiting for the planner to confirm effectivity.";
    case "revision_changed":
      return `This thread moved to ${error.current}. Review the new limits before signing.`;
    case "out_of_scope":
      return `Your certification scope does not cover ${MODEL_LABELS[error.model] || error.model}.`;
    case "past_due":
      return "Too late to defer: the due instant has passed.";
    case "already_deferred":
      return `Already deferred under ${context.current || "this revision"}.`;
    case "invalid_transition":
      return invalidTransitionText(context.action);
    case "not_contractor":
      return "Only contractor records can be erased.";
    case "already_erased":
      return "This person was already erased.";
    case "pack_already_queued":
      return `A pack for ${context.directive || "that directive"} is already queued.`;
    case "bad_credentials":
      return BAD_CREDENTIALS;
    case "validation":
      return "Some fields need attention.";
    default:
      return (error && error.message) || "That request could not be completed.";
  }
}

function invalidTransitionText(action) {
  if (action === "release") return "This card can no longer be released.";
  if (action === "effectivity") return "This thread no longer needs confirmation.";
  if (action === "reopen") return "Only a closed thread can be reopened.";
  return "That action is not possible at this stage.";
}

export function spliceBannerText(splice, directive) {
  if (!splice.from) {
    return {
      prefix: `${directive} ${splice.to} added: `,
      links: [["added", splice.added.length]],
      suffix: "",
    };
  }
  return {
    prefix: `${splice.to} supersedes ${splice.from}: `,
    links: [
      ["retargeted", splice.retargeted.length],
      ["added", splice.added.length],
      ["removed", splice.removed.length],
      ["kept", splice.kept.length],
    ],
    suffix: ` under ${splice.from}`,
  };
}

export function filterText(count, category, tag) {
  return `Showing ${count} ${category} cells from ${tag}`;
}

export function priorViewText(directive, tag) {
  return `Viewing ${directive} as it stood under ${tag}. Read-only.`;
}
