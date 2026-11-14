import type { AccessReason, ShareAccess } from "../shared/access.js";
import type { Cardinality } from "../shared/model.js";
import { CARDINALITY_WORDS } from "../shared/model.js";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const copy = {
  strip(storageUp: boolean, mailUp: boolean): string {
    if (storageUp && mailUp) return "All studio services are running.";
    if (!storageUp && mailUp) return "Storage is down: exports and imports are paused. Editing still saves.";
    if (storageUp && !mailUp) return "Mail is down: sign-in codes and invitations are paused. Links still work.";
    return "Storage and mail are down: exports, imports, codes and invitations are paused. Editing still saves.";
  },
  editorStatus(count: number, first?: { line: number; column: number }): string {
    if (count === 0 || !first) return "No errors.";
    return `${count === 1 ? "1 error" : `${count} errors`}. First error at line ${first.line}, column ${first.column}.`;
  },
  outOfDate: "Showing the last diagram without errors. Fix the text to update it.",
  moreErrors: (n: number) => (n === 1 ? "1 more error" : `${n} more errors`),
  gutter: (line: number, message: string) => `Error on line ${line}: ${message}`,
  saving: "Saving...",
  saved: "All changes saved",
  retrying: "Changes not saved yet. Retrying...",
  conflict: (by: string, unit: string) => `${by} changed ${unit} first. Your edit was not saved and the text now shows the latest version.`,
  templateApplied: (name: string) => `Started from ${name}.`,
  noTemplate: (query: string) => `No template matches "${query}".`,

  entityName(entity: string, columns: number, links: number): string {
    return `Entity ${entity}, ${plural(columns, "column", "columns")}, ${plural(links, "link", "links")}`;
  },
  moved: (entity: string, x: number, y: number) => `Moved ${entity} to ${x}, ${y}.`,
  selected: (entity: string, n: number) => `Selected ${entity}. ${n} selected.`,
  deselected: (entity: string, n: number) => `Deselected ${entity}. ${n} selected.`,
  selectionCleared: "Selection cleared.",
  linkStarted: (ref: string) => `Linking from ${ref}. Choose a target column.`,
  linkTarget: (ref: string) => `Target ${ref}.`,
  linked: (from: string, to: string) => `Linked ${from} to ${to}, many to one.`,
  linkCancelled: "Link cancelled.",
  sameColumn: "Choose a different column.",
  grouped: (entities: string[], group: string) => `Grouped ${entities.join(", ")} as "${group}".`,
  ungrouped: (group: string) => `Removed group "${group}".`,
  coloured: (entity: string, colour: string) => `${entity} is now ${colour}.`,
  renamed: (from: string, to: string) => `Renamed ${from} to ${to}.`,
  arranged: (n: number) => `Arranged ${n} entities.`,
  linkOutline: (from: string, to: string, cardinality: Cardinality) => `Link ${from} to ${to}, ${CARDINALITY_WORDS[cardinality]}`,

  versionSaved: (n: number) => `Version ${n} saved.`,
  restoring: (n: number) => `Restoring version ${n}...`,
  restored: (n: number, m: number) => `Restored version ${n} as version ${m}.`,
  savingExport: "Saving export...",
  exportSaved: (dialect: string) => `${dialect} export saved. Download is ready.`,
  exportStorageDown: "Export storage is unavailable. Your diagram is safe and still saving; try the export again shortly.",
  downloadExpired: "This download has expired. Save the export again.",
  importing: "Importing...",
  imported: (added: number, merged: number, skipped: number, ambiguous: number) =>
    `Imported ${added} new and ${merged} merged entities. ${skipped} statements skipped, ${ambiguous} ambiguous.`,
  importUnchanged: "Nothing changed: the text already matches this DDL.",
  importRejected: "The import was not applied. Fix the lines below and try again.",
  importStorageDown: "Import storage is unavailable, so nothing was imported. Your diagram is safe; try again shortly.",
  noVersions: "No versions yet. Save one to keep this moment.",

  creatingLink: "Creating link...",
  linkCreated: (access: ShareAccess) => `${access === "view" ? "View" : "Edit"} link created.`,
  sendingInvitation: "Sending invitation...",
  invitationSent: (email: string) => `Invitation sent to ${email}.`,
  invitationFailed: (email: string) =>
    `The invitation to ${email} could not be sent because mail is down. The link works; send it again later.`,
  rotated: "Link rotated. The old address no longer works.",
  turnedOff: "Link turned off.",
  canOnlyView: (name: string) => `${name} can now only view.`,
  canEdit: (name: string) => `${name} can now edit.`,
  noLongerHasAccess: (name: string) => `${name} no longer has access.`,

  accessNotice(access: "editor" | "viewer" | "none", reason: AccessReason): string {
    if (access === "editor") return "You can edit this project again.";
    if (access === "viewer") return "Your access changed to view only.";
    switch (reason) {
      case "revoked":
        return "The owner turned off this link.";
      case "rotated":
        return "The owner replaced this link with a new one.";
      case "expired":
        return "This link has expired.";
      default:
        return "You no longer have access to this project.";
    }
  },

  projectCreated: (name: string) => `Project ${name} created.`,
  projectRenamed: (name: string) => `Project renamed to ${name}.`,
  sendingCode: "Sending code...",
  codeSent: (email: string) => `We sent a code to ${email}.`,
  codeMailDown: "We couldn't send a code because mail is down. Try again in a minute.",
};
