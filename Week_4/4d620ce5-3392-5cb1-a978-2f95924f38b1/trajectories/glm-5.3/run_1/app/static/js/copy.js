/* Domain copy, glyph shapes and formatting helpers shared by the board surfaces. */
"use strict";

const ROLE_LABELS = {
  compliance_planner: "Compliance planner",
  licensed_inspector: "Licensed inspector",
  certifying_engineer: "Certifying engineer",
  records_clerk: "Records clerk",
  regulator_auditor: "Regulator auditor",
};

const GLYPHS = {
  "Open": { path: "M6 1.5A4.5 4.5 0 1 0 6 10.5A4.5 4.5 0 1 0 6 1.5", fill: "none" },
  "Due soon": { path: "M6 1.5A4.8 4.8 0 0 0 1.2 6.3A4.8 4.8 0 0 0 6 11.1A4.8 4.8 0 0 0 10.8 6.3A4.8 4.8 0 0 0 6 1.5M6 3.4V6.3L8.1 7.6", fill: "none" },
  "Overdue": { path: "M6 1.2L11 10.4H1ZM6 4.4V7.2M6 8.8V9.2", fill: "none" },
  "Deferred": { path: "M3.4 1.5V10.5M8.6 1.5V10.5", fill: "none" },
  "Complied": { path: "M1.6 6L4.8 9.2L10.4 2.8", fill: "none" },
  "Superseded": { path: "M1.5 10.5L10.5 1.5M1.5 1.5L10.5 10.5", fill: "none" },
  "Not applicable": { path: "M1.5 6H10.5M3 2L9 10", fill: "none" },
  "Withdrawn": { path: "M1.2 6H10.8", fill: "none" },
};

function glyphSvg(label) {
  const shape = GLYPHS[label] || GLYPHS["Open"];
  const width = label === "Deferred" ? 9 : 12;
  return `<svg class="glyph" width="${width}" height="12" viewBox="0 0 12 12" role="img" aria-label="${label}">` +
    `<path d="${shape.path}" stroke="currentColor" stroke-width="1.2" fill="${shape.fill}"/></svg>`;
}

function directiveLabel(directive) {
  return `${directive.authority} ${directive.number}`;
}

function tagOf(revision) {
  return `R${revision}`;
}

function formatHours(value) {
  const num = Number(value);
  return (Math.round(num * 10) / 10).toFixed(1);
}

function formatDate(value) {
  return String(value || "");
}

function modelLabel(code) {
  return { "ATR72-212A": "ATR 72", "DHC-8-402": "Dash 8-400", "ERJ-170-200": "E175" }[code] || code;
}

function personName(person) {
  if (!person) return "";
  return person.display_name || "";
}

function statusClass(state, stage) {
  if (stage === "withdrawn") return "state-withdrawn";
  if (stage === "not_applicable") return "state-not_applicable";
  if (stage === "certified") return "state-certified";
  if (stage === "superseded_retargeted") return "state-superseded_retargeted";
  if (state === "overdue") return "state-overdue";
  if (state === "due_soon") return "state-due_soon";
  if (stage === "deferred") return "state-deferred";
  if (stage === "inspected") return "state-inspected";
  if (stage === "claimed") return "state-claimed";
  if (stage === "reopened") return "state-reopened";
  return "state-open";
}

const COPY = {
  signingIn: "Signing in…",
  badCredentials: "Username or passcode is wrong.",
  sessionEnded: "Your session has ended. Sign in again.",
  forbidden: "Your role cannot do this.",
  ingesting: tag => `Ingesting ${tag}…`,
  ingested: (directive, tag) => `${directive} ${tag} ingested.`,
  directiveExists: directive => `${directive} is already on the board.`,
  revisionOutOfOrder: current => `This directive is now at ${current}. Reload and try again.`,
  withdrawn: directive => `${directive} is withdrawn.`,
  storageDown: "Document storage is unavailable. Nothing was ingested.",
  revisionBanner: (newTag, oldTag, counts) =>
    `${newTag} supersedes ${oldTag}: ${counts.retargeted} retargeted, ${counts.added} added, ${counts.removed} removed, ${counts.kept} kept under ${oldTag}`,
  addedBanner: (directive, tag, n) => `${directive} ${tag} added: ${n} added`,
  claiming: card => `Claiming ${card}…`,
  cardYours: card => `Work card ${card} is yours.`,
  cardHeld: holder => `Already held by ${holder}.`,
  effectivityUnconfirmed: "Waiting for the planner to confirm effectivity.",
  releasing: card => `Releasing ${card}…`,
  released: card => `Work card ${card} released.`,
  notHolder: "You no longer hold this work card.",
  uploading: "Uploading evidence…",
  evidenceAttached: "Evidence attached.",
  evidenceTooLarge: "That file is larger than 5,000,000 bytes.",
  signing: "Signing inspection…",
  signed: (tag, onTime) => `Inspection signed under ${tag}, ${onTime ? "on time" : "overdue"}.`,
  revisionChanged: current => `This thread moved to ${current}. Review the new limits before signing.`,
  countersigning: "Countersigning…",
  countersigned: tag => `Countersigned under ${tag}. Thread closed.`,
  outOfScope: model => `Your certification scope does not cover ${model}.`,
  deferring: "Deferring…",
  deferred: due => `Deferred. New due ${due}.`,
  pastDue: "Too late to defer: the due instant has passed.",
  alreadyDeferred: current => `Already deferred under ${current}.`,
  confirming: "Saving…",
  effectivityConfirmed: "Effectivity confirmed.",
  markedNotApplicable: "Marked not applicable.",
  loggingHours: "Logging hours…",
  loggedHours: (registration, total) => `${registration} now at ${formatHours(total)} FH.`,
  importing: "Importing…",
  importDone: r => `Import finished: ${r.merged} merged, ${r.duplicates} duplicates, ${r.orphans.length} orphans, ${r.rejected.length} rejected.`,
  importNoChange: "This file was already imported. Nothing changed.",
  reopening: "Reopening…",
  reopened: "Thread reopened. Prior signatures kept as void.",
  onlyClosedReopen: "Only a closed thread can be reopened.",
  savingScope: "Saving scope…",
  scopeSaved: n => `Scope saved. ${n} threads passed on.`,
  erasing: "Erasing…",
  erased: token => `${token} now replaces this contractor everywhere.`,
  notContractor: "Only contractor records can be erased.",
  alreadyErased: "This person was already erased.",
  preparingPack: "Preparing pack…",
  packTransmitted: "Pack transmitted to the authority.",
  packQueued: service => `Pack queued: ${service} is unavailable. It will go out automatically.`,
  packAlreadyQueued: directive => `A pack for ${directive} is already queued.`,
  withdrawing: "Withdrawing…",
  withdrawnOk: directive => `${directive} withdrawn. History kept.`,
  retrying: "Connection lost. Retrying with the same request.",
  stillOffline: "Still offline. Nothing was confirmed. Press again to retry with the same request.",
  livePaused: "Live updates paused. Reconnecting…",
  liveResumed: "Live updates resumed.",
};

const ERROR_COPY = {
  bad_credentials: () => COPY.badCredentials,
  forbidden: () => COPY.forbidden,
  unauthenticated: () => COPY.sessionEnded,
  directive_exists: (body) => COPY.directiveExists(body.directive || ""),
  revision_out_of_order: (body) => COPY.revisionOutOfOrder(body.current || ""),
  directive_withdrawn: (body) => COPY.withdrawn(body.directive || ""),
  storage_unavailable: () => COPY.storageDown,
  card_held: (body) => COPY.cardHeld(body.holder ? body.holder.display_name : ""),
  effectivity_unconfirmed: () => COPY.effectivityUnconfirmed,
  not_holder: () => COPY.notHolder,
  payload_too_large: () => COPY.evidenceTooLarge,
  revision_changed: (body) => COPY.revisionChanged(body.current || ""),
  out_of_scope: (body) => COPY.outOfScope(body.model ? modelLabel(body.model) : ""),
  past_due: () => COPY.pastDue,
  already_deferred: (body) => COPY.alreadyDeferred(body.current || ""),
  invalid_transition: () => "This action cannot happen at the thread's current stage.",
  not_contractor: () => COPY.notContractor,
  already_erased: () => COPY.alreadyErased,
  pack_already_queued: (body) => COPY.packAlreadyQueued(body.directive || ""),
};

function errorCopy(code, body) {
  const maker = ERROR_COPY[code];
  if (maker) return maker(body || {});
  if (body && body.message) return body.message;
  return "Something went wrong.";
}
