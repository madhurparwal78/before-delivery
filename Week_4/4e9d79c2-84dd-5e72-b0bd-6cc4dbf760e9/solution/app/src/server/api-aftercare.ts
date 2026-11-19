import { config } from "./config.js";
import { nowSeconds, one, pool, rows, only } from "./db.js";
import { fieldErrors, conflict, newId, notFound, ok, refused, route, type ApiRoute } from "./http.js";
import { bankHolidays, ProviderDown } from "./providers.js";
import { addDays, isRealDate, isTime, oneMonthOn, ukDate, weekdayIndex } from "../shared/time.js";
import type { DeskRow, CustomerRow, ComplaintRow, LostItemRow } from "./records.js";

const WEEKENDS_ONLY = "Bank holidays unavailable. Weekends only.";

/** Holidays per desk, read at most once per cache time; a failed read does not count and the last good list stands. */
const holidaysFor = async (deskId: string): Promise<string[] | null> => {
  const desk = await only<Pick<DeskRow, "holidays" | "holidays_read_at">>(pool, "SELECT holidays,holidays_read_at FROM desks WHERE id=$1", [deskId]);
  const now = nowSeconds();
  if (desk.holidays && (desk.holidays_read_at as number) + config.holidayCache > now) return desk.holidays;
  try {
    const reply = await bankHolidays();
    const list: string[] = reply["england-and-wales"].events.map((e: { date: string }) => e.date);
    await pool.query("UPDATE desks SET holidays=$2,holidays_read_at=$3 WHERE id=$1", [deskId, JSON.stringify(list), now]);
    return list;
  } catch (error) {
    if (error instanceof ProviderDown || error instanceof TypeError) return desk.holidays;
    throw error;
  }
};
const CUT_OFF = "17:00";
const REPLY_DAYS = 3;
const replyDue = (date: string, time: string, holidays: string[]): string => {
  const working = (d: string): boolean => ![0, 6].includes(weekdayIndex(d)) && !holidays.includes(d);
  let day = date;
  if (!working(day) || time >= CUT_OFF) {
    day = addDays(day, 1);
    while (!working(day)) day = addDays(day, 1);
  }
  for (let counted = 0; counted < REPLY_DAYS;) {
    day = addDays(day, 1);
    if (working(day)) counted += 1;
  }
  return day;
};
const complaintJson = (c: ComplaintRow): Record<string, unknown> => ({
  id: c.id, customerId: c.customer_id, summary: c.summary, receivedAt: { date: c.received_date, time: c.received_time }, replyDue: c.reply_due, holidayLine: c.holiday_line,
});
export const complaintsOf = (deskId: string): Promise<ComplaintRow[]> => rows<ComplaintRow>(pool, "SELECT * FROM complaints WHERE desk_id=$1 ORDER BY created_seq", [deskId]);
const itemState = (i: LostItemRow): string => (i.returned_at !== null ? "returned" : ukDate(nowSeconds()) > i.held_to ? "pastHoldingDate" : "held");
const itemJson = (i: LostItemRow): Record<string, unknown> => ({ id: i.id, description: i.description, foundOn: i.found_on, heldTo: i.held_to, state: itemState(i) });
export const itemsOf = (deskId: string): Promise<LostItemRow[]> => rows<LostItemRow>(pool, "SELECT * FROM lost_items WHERE desk_id=$1 ORDER BY created_seq", [deskId]);

export const aftercareRoutes: ApiRoute[] = [
  route({
    method: "POST", path: "/api/complaints", body: "json",
    run: async ({ json, desk }) => {
      const customer = await one<Pick<CustomerRow, "id">>(pool, "SELECT id FROM customers WHERE id=$1 AND desk_id=$2 AND state<>'erased'", [json.customerId, desk!.id]);
      if (typeof json.customerId === "string" && !customer) throw notFound();
      const fields: Record<string, string> = {};
      if (!customer) fields.customerId = "Choose a customer.";
      if (typeof json.summary !== "string" || !json.summary.trim()) fields.summary = "Enter a summary.";
      const at = json.receivedAt;
      if (!at || !isRealDate(at.date ?? "")) fields.receivedDate = "Enter a date as DD/MM/YYYY.";
      else if (!isTime(at.time)) fields.receivedHour = "Choose an hour and minutes.";
      if (Object.keys(fields).length) throw fieldErrors(fields);
      const holidays = await holidaysFor(desk!.id);
      const made = await only<ComplaintRow>(pool, "INSERT INTO complaints (id,desk_id,customer_id,summary,received_date,received_time,reply_due,holiday_line) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [newId("CP"), desk!.id, customer!.id, json.summary.trim(), at.date, at.time, replyDue(at.date, at.time, holidays ?? []), holidays ? null : WEEKENDS_ONLY]);
      return ok(complaintJson(made), 201);
    },
  }),
  route({ method: "GET", path: "/api/complaints", run: async ({ desk }) => ok({ complaints: (await complaintsOf(desk!.id)).map(complaintJson) }) }),
  route({
    method: "POST", path: "/api/lost-property", body: "json",
    run: async ({ json, desk }) => {
      const fields: Record<string, string> = {};
      if (typeof json.description !== "string" || !json.description.trim()) fields.description = "Enter the item.";
      if (typeof json.foundOn !== "string" || !isRealDate(json.foundOn)) fields.foundOn = "Enter a date as DD/MM/YYYY.";
      if (Object.keys(fields).length) throw fieldErrors(fields);
      return ok(itemJson(await only<LostItemRow>(pool, "INSERT INTO lost_items (id,desk_id,description,found_on,held_to) VALUES ($1,$2,$3,$4,$5) RETURNING *", [newId("LP"), desk!.id, json.description.trim(), json.foundOn, oneMonthOn(json.foundOn)])), 201);
    },
  }),
  route({ method: "GET", path: "/api/lost-property", run: async ({ desk }) => ok({ items: (await itemsOf(desk!.id)).map(itemJson) }) }),
  route({
    method: "POST", path: "/api/lost-property/:id/return", body: "json",
    load: async (ctx) => {
      const item = await one<LostItemRow>(pool, "SELECT * FROM lost_items WHERE id=$1 AND desk_id=$2", [ctx.params.id, ctx.desk!.id]);
      if (!item) throw notFound();
      return item;
    },
    run: async ({ json, loaded }) => {
      if (typeof json.ownerDetails !== "string" || !json.ownerDetails.trim()) throw refused("Record the owner's details before returning this.", "ownerDetails");
      const item = await one<LostItemRow>(pool, "UPDATE lost_items SET returned_at=$2,owner_details=$3 WHERE id=$1 AND returned_at IS NULL RETURNING *", [loaded.id, nowSeconds(), json.ownerDetails.trim()]);
      if (!item) throw conflict("alreadyReturned", "This item has already been returned.");
      return ok({ ...itemJson(item), charge: "5.00" });
    },
  }),
];
