// The outgoing mail queue (Services · Mail). Every message is queued in the transaction of the action
// that causes it; the sender worker delivers it.
import { stationTimeLabel } from "../shared/time.js";
import { type Queryable } from "./db.js";
import { type Role } from "./rules/roles.js";

const ROLE_LABEL: Record<Role, string> = {
  viewer: "Viewer",
  technician: "Technician",
  lead: "Trial lead",
  data_manager: "Data manager",
};

async function queue(t: Queryable, to: string, subject: string, body: string): Promise<number> {
  const r = await t.query<{ id: string }>("INSERT INTO mail_queue (to_address, subject, body) VALUES ($1, $2, $3) RETURNING id", [to, subject, body]);
  return Number(r.rows[0].id);
}

export function queueInvite(
  t: Queryable,
  invite: { to: string; name: string; role: Role; stationName: string; link: string },
): Promise<number> {
  return queue(
    t,
    invite.to,
    `You're invited to ${invite.stationName} on Furrowbook`,
    [
      `Hello ${invite.name},`,
      "",
      `You have been added to ${invite.stationName} on Furrowbook as a ${ROLE_LABEL[invite.role]}.`,
      "",
      "Set your password and sign in here:",
      invite.link,
      "",
      "The link works once.",
    ].join("\n"),
  );
}

export function queueExportReady(t: Queryable, ready: { to: string; workbookName: string; fileName: string; link: string }): Promise<number> {
  return queue(
    t,
    ready.to,
    `Your export of ${ready.workbookName} is ready`,
    [`Your export ${ready.fileName} is ready to download:`, ready.link, "", "The link works for trial leads and data managers of your station."].join("\n"),
  );
}

/** One season-closed message to every lead of the station, for one lock event. */
export async function queueSeasonClosed(
  t: Queryable,
  closed: { stationId: string; workbookName: string; at: Date; zone: string },
): Promise<void> {
  const leads = await t.query<{ email: string }>("SELECT email FROM members WHERE station_id = $1 AND role = 'lead'", [closed.stationId]);
  const body = `${closed.workbookName} closed at ${stationTimeLabel(closed.at.getTime(), closed.zone)}. Edits are no longer accepted. A trial lead can reopen it before it is archived.`;
  for (const lead of leads.rows) await queue(t, lead.email, `Season closed: ${closed.workbookName}`, body);
}
