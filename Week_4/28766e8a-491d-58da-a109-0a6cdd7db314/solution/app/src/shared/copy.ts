// The published copy (brief: Feedback states). Every string here renders character for character.
import type { InviteStatus, Shape } from "./types";

export function shapeLabel(shape: Pick<Shape, "label" | "kind">): string {
  return shape.label || `Untitled ${shape.kind}`;
}

/** `<label>` for one shape, `<k> shapes` for several. */
export function labelFor(labels: string[]): string {
  return labels.length === 1 ? (labels[0] as string) : `${labels.length} shapes`;
}

function changes(n: number): string {
  return n === 1 ? "1 change waiting to save." : `${n} changes waiting to save.`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** `a`, `a and b`, `a, b and c`. */
function listLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export const copy = {
  range: (min: number, max: number) => `Enter a whole number from ${min} to ${max}.`,
  moved: (label: string, n: number) => `Moved ${label}. ${n === 1 ? "1 connector rerouted." : `${n} connectors rerouted.`}`,
  reordered: (name: string, n: number, total: number) => `Moved ${name} to position ${n} of ${total}.`,
  aligned: (n: number, side: string) => `Aligned ${n} shapes ${side}.`,
  distributed: (n: number) => `Distributed ${n} shapes.`,
  grouped: (n: number) => `Grouped ${n} shapes.`,
  ungrouped: (n: number) => `Ungrouped ${n} shapes.`,
  crossLayer: "Shapes on different layers can't be grouped.",
  locked: (layer: string) => `Layer ${layer} is locked.`,
  lockedDescription: (layer: string) => `On locked layer ${layer}`,
  connectorName: (source: string, target: string, blocked: boolean) => `Connector from ${source} to ${target}${blocked ? ", blocked" : ""}`,
  connected: (source: string, target: string) => `Connected ${source} to ${target}.`,
  joined: (name: string) => `${name} joined.`,
  replaced: (name: string, label: string) => `${name} changed ${label} at the same time. Their edit was kept.`,
  deleted: (label: string, name: string) => `${label} was deleted by ${name}. Your change was not saved.`,
  role: "You're now a viewer. Your last change was not saved.",
  cantUndo: (name: string, label: string) => `Can't undo: ${name} changed ${label} after you.`,
  offline: (n: number) => `Offline. ${changes(n)}`,
  sessionEnded: (n: number) => `Your session ended. Sign in to keep your changes.${n ? ` ${changes(n)}` : ""}`,
  saved: "All changes saved.",
  viewOnly: (owner: string) => `View only. Ask ${owner} for edit access.`,
  preview: (version: string) => `Previewing ${version}. Restore it or go back to the latest.`,
  versionSaved: (version: string) => `Saved ${version}.`,
  restoring: (version: string) => `Restoring ${version}...`,
  restored: (name: string, version: string) => `${name} restored ${version}.`,
  exporting: (page: string) => `Exporting ${page}...`,
  exportReady: "Export ready.",
  exportPaused: "Exports are paused: storage is unavailable. Editing still works.",
  invitePending: "Sending invite...",
  inviteEmailed: (email: string) => `Invite emailed to ${email}.`,
  mailOutage: "Email is unavailable. The invite is saved; use Resend when email is back.",
  emptyPage: "This page is empty. Add a shape from the toolbar or press R.",
  emptyList: "No diagrams yet. Create one to start drawing.",
  notFoundHeading: "Diagram not found",
  notFoundText: "This diagram doesn't exist or you don't have access to it.",
  signInError: "Email or password is incorrect.",
  fields: {
    name: "Enter your name.",
    email: "Enter an email address.",
    password: "Use at least 10 characters.",
    emailTaken: "An account with this email already exists.",
    title: "Enter a title.",
    control: "Remove line breaks and control characters.",
    exportPage: "Choose a page with a visible shape.",
  },
  inviteSubject: (inviter: string, title: string, role: "editor" | "viewer") =>
    `${inviter} shared "${title}" with you as ${role === "editor" ? "an editor" : "a viewer"}`,
  mentionSubject: (name: string, title: string) => `${name} mentioned you on "${title}"`,
  versionDisplay: (number: number, name: string | null) => name || `Version ${number}`,
  restoredName: (display: string) => `Restored ${display}`,
  groupName: (n: number) => `Group of ${n} shapes`,
  pageStrip: (name: string, n: number, total: number) => `${name} · ${n} of ${total}`,
  presence: (name: string, editing: boolean) => `${name}, ${editing ? "editing" : "viewing"}`,
  outlinePage: (name: string, shapes: number, connectors: number) => `${name}, ${plural(shapes, "shape")}, ${plural(connectors, "connector")}`,
  outlineLayer: (name: string, locked: boolean, shapes: number) => `${name} layer, ${locked ? "locked, " : ""}${plural(shapes, "shape")}`,
  outlineShape: (label: string, kind: string, targets: string[], sources: string[]) => {
    const parts = [label, kind];
    if (!targets.length && !sources.length) parts.push("not connected");
    if (targets.length) parts.push(`connected to ${listLabels(targets)}`);
    if (sources.length) parts.push(`connected from ${listLabels(sources)}`);
    return parts.join(", ");
  },
  resolvedHeading: (n: number) => `Resolved (${n})`,
  pinName: (author: string, label: string) => `Comment by ${author} on ${label}`,
  inviteStatus: { emailed: "Invited", email_not_sent: "Email not sent", expired: "Expired" } satisfies Record<InviteStatus, string>,
  activeStatus: "Active",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `<display name> · <author name> · <d Mon yyyy, HH:mm> UTC` from the server's createdAt. */
export function historyText(display: string, author: string, createdAt: string): string {
  const d = new Date(createdAt);
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
  return `${display} · ${author} · ${stamp} UTC`;
}
