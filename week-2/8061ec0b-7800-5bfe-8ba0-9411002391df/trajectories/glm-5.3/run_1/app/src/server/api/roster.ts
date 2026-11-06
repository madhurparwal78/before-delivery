// Roster endpoints: the director's own school roster, the CSV export and
// the delivery-day notice.
import type { ApiRequest, FileResponse, JsonResponseBody } from "../http/server.js";
import type { RouteRegistrar } from "./routes.js";
import { ApiError } from "../errors.js";
import { rosterForSchool } from "../domain/roster.js";
import { nextDeliveryDay, schoolById, upcomingDeliveryDays } from "../domain/delivery.js";
import { instrumentLabel, DELIVERY_STATUS_WORDS } from "../../shared/domain.js";
import { requireUser, withSweep } from "./helpers.js";

export function registerRosterRoutes(reg: RouteRegistrar): void {
  reg.add("GET", "/api/schools/{id}/roster", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["director", "owner"]);
    const result = await withSweep(reg.db, reg.clock, async (client) => {
      const school = await schoolById(client, req.params.id);
      if (!school) return null;
      if (user.role === "director" && school.id !== user.school_id) return null;
      const next = nextDeliveryDay(school, reg.clock.now());
      const roster = await rosterForSchool(client, school, next.date);
      return roster;
    });
    if (!result) throw ApiError.notFound("That roster does not exist.");
    return { status: 200, body: result } as JsonResponseBody;
  });

  reg.add("GET", "/api/schools/{id}/roster.csv", async (req: ApiRequest): Promise<FileResponse> => {
    const user = await requireUser(reg.db, req.sessionToken, ["director", "owner"]);
    const result = await withSweep(reg.db, reg.clock, async (client) => {
      const school = await schoolById(client, req.params.id);
      if (!school) return null;
      if (user.role === "director" && school.id !== user.school_id) return null;
      const next = nextDeliveryDay(school, reg.clock.now());
      return rosterForSchool(client, school, next.date);
    });
    if (!result) throw ApiError.notFound("That roster does not exist.");
    const rows: string[][] = [
      ["Student", "Grade", "Instrument", "Size", "Serial", "Delivery date", "Delivery status"],
    ];
    for (const student of result.students) {
      rows.push([
        student.student_name,
        String(student.grade),
        student.instrument_type ? instrumentLabel(student.instrument_type as never, student.size as never) : "",
        student.size ?? "",
        student.serial ?? "",
        student.delivery_date ?? "",
        DELIVERY_STATUS_WORDS[student.delivery_status],
      ]);
    }
    const csv = rows
      .map((cells) => cells.map(csvCell).join(","))
      .join("\r\n") + "\r\n";
    return {
      data: Buffer.from(csv, "utf-8"),
      contentType: "text/csv; charset=utf-8",
      disposition: `attachment; filename="roster-${req.params.id}.csv"`,
    };
  });

  reg.add("POST", "/api/schools/{id}/delivery-notice", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner"]);
    void user;
    const deliveryDate = ((req.body ?? {}) as { delivery_date?: unknown }).delivery_date;
    const result = await withSweep(reg.db, reg.clock, async (client) => {
      const school = await schoolById(client, req.params.id);
      if (!school) return null;
      if (typeof deliveryDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
        throw ApiError.validation({ delivery_date: "Pick one of this school's delivery days." });
      }
      const upcoming = upcomingDeliveryDays(school, reg.clock.now());
      if (!upcoming.some((d) => d.date === deliveryDate)) {
        throw ApiError.validation({ delivery_date: "Pick one of this school's delivery days." });
      }
      // The manifest: every open contract of the school on that day.
      const manifest = await client.query<Record<string, unknown>>(
        `SELECT s.name AS student_name, i.instrument_type, i.size, i.serial
           FROM contracts c
           JOIN students s ON s.id = c.student_id
           JOIN instruments i ON i.id = c.instrument_id
          WHERE c.school_id = $1 AND c.delivery_date = $2
            AND c.status IN ('reserved','agreement_sent','signed','active')
          ORDER BY s.name ASC`,
        [school.id, deliveryDate]
      );
      const director = await client.query<{ email: string; name: string }>(
        "SELECT email, name FROM users WHERE school_id = $1 AND role = 'director'",
        [school.id]
      );
      return {
        school,
        manifest: manifest.rows.map((r) => ({
          student_name: r.student_name as string,
          instrument_label: instrumentLabel(r.instrument_type as never, r.size as never),
          serial: r.serial as string,
        })),
        recipient: director.rows[0]?.email ?? "",
      };
    });
    if (!result) throw ApiError.notFound("That school does not exist.");
    const lines = result.manifest.map(
      (m) => `${m.student_name} — ${m.instrument_label} — ${m.serial}`
    );
    reg.mailer.queueEmail(`delivery-notice-${req.params.id}-${deliveryDate as string}-${reg.clock.nowMs()}`, {
      to: result.recipient,
      subject: `Delivery day ${deliveryDate} — ${result.school.name}`,
      text:
        `Instruments arriving on ${deliveryDate}:\n\n` +
        (lines.length > 0 ? lines.join("\n") : "No instruments scheduled.") +
        `\n\nKeel & Bell Music`,
    });
    return {
      status: 202,
      body: {
        recipient: result.recipient,
        delivery_date: deliveryDate,
        student_count: result.manifest.length,
      },
    } as JsonResponseBody;
  });
}

// Any cell beginning with a formula character gets a single apostrophe in
// front, then standard comma-separated quoting.
function csvCell(value: string): string {
  let cell = value;
  if (/^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }
  const needsQuote = /[",\r\n]/.test(cell);
  const escaped = cell.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}
