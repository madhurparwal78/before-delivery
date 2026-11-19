import type { IncomingMessage } from "node:http";
import type { GuestPage } from "../shared/api";
import { notices } from "../shared/notices";
import { hotelNow } from "./clock";
import { config } from "./config";
import { database, one, run, atomic, type Row } from "./db";
import { findStay } from "./stayView";
import { fail, jsonBody, ok, readBody, stringField, type Reply } from "./http";
import { emit } from "./live";
import { multipartPhoto, photoContentType, sniffPhoto, stripMetadata } from "./photo";
import { StoreUnavailable, getObject, putObject } from "./providers/s3";

const DEAD_LINK = "This check-in link is no longer valid.";
const FORM_OVERHEAD_BYTES = 65_536;

interface LinkStay extends Row {
  id: string; hotel_id: string; hotel_name: string; arrival: string; departure: string; room_type: string; room_number: string; id_photo: boolean;
  clock_now: Date | null; link_expires_at: Date;
}

/** The booked stay a live link opens: lifetime counted on the hotel's clock, dead once completed or no longer booked. */
export async function findLinkStay(token: string): Promise<LinkStay | undefined> {
  const found = await one<LinkStay>(
    database(),
    `SELECT s.id, s.hotel_id, h.name AS hotel_name, s.arrival, s.departure, s.id_photo, r.type AS room_type, r.number AS room_number,
            h.clock_now, s.link_expires_at
     FROM stays s JOIN hotels h ON h.id = s.hotel_id
     JOIN LATERAL (SELECT room_id FROM stay_nights WHERE stay_id = s.id ORDER BY night LIMIT 1) first ON true
     JOIN rooms r ON r.id = first.room_id
     WHERE s.link_token = $1 AND s.link_state = 'sent' AND s.status = 'booked' AND NOT s.checked_in_online`,
    [token],
  );
  return found && hotelNow(found.clock_now) < found.link_expires_at ? found : undefined;
}

async function openLink(token: string): Promise<LinkStay> {
  const stay = await findLinkStay(token);
  if (!stay) throw fail.other(404, DEAD_LINK);
  return stay;
}

export async function guestPage(token: string): Promise<Reply> {
  const stay = await openLink(token);
  const page: GuestPage = {
    hotelName: stay.hotel_name, arrival: stay.arrival, departure: stay.departure, roomType: stay.room_type,
    photo: stay.id_photo ? "received" : "none",
  };
  return ok(page);
}

export async function uploadPhoto(token: string, req: IncomingMessage): Promise<Reply> {
  const stay = await openLink(token);
  const limit = config.photoMaxBytes;
  const body = await readBody(req, limit + FORM_OVERHEAD_BYTES);
  if (body === "too-large") throw fail.tooLarge("That photo is too large.");
  const photo = multipartPhoto(body, req.headers["content-type"] ?? "");
  if (photo && photo.length > limit) throw fail.tooLarge("That photo is too large.");
  const kind = photo ? sniffPhoto(photo) : null;
  if (!photo || !kind) throw fail.other(415, "Please upload a JPEG or PNG photo.");
  try {
    await putObject(`id-photos/${stay.hotel_id}/${stay.id}`, stripMetadata(photo, kind), photoContentType(kind));
  } catch (failure) {
    if (failure instanceof StoreUnavailable) throw fail.unavailable("Your photo could not be saved. Please try again.");
    throw failure;
  }
  await run(database(), "UPDATE stays SET id_photo = true WHERE id = $1", [stay.id]);
  return ok({ photo: "received" });
}

export async function completeCheckIn(token: string, req: IncomingMessage): Promise<Reply> {
  const stay = await openLink(token);
  const body = await jsonBody(req);
  if (!stay.id_photo) throw fail.conflict("Please upload your ID photo first.");
  const fullName = stringField(body, "fullName");
  if (!fullName) throw fail.invalid({ fullName: "Enter your full name." });
  await atomic(async (client) => {
    // The update itself is the gate: a second completion finds the link ended and the link is dead for it.
    const completed = await run(
      client,
      `UPDATE stays SET checked_in_online = true, online_full_name = $2, online_phone = $3, link_state = 'ended', version = version + 1
       WHERE id = $1 AND link_state = 'sent' AND status = 'booked' AND NOT checked_in_online`,
      [stay.id, fullName, stringField(body, "phone")],
    );
    if (completed === 0) throw fail.other(404, DEAD_LINK);
    await emit(client, stay.hotel_id, { type: "checkin", stayId: stay.id, notice: notices.onlineCheckIn(stay.room_number) });
  });
  return ok({ completed: true });
}

/** The stored ID photo of a stay in the caller's hotel, passed through the app. */
export async function idPhoto(hotelId: string, stayId: string): Promise<Reply> {
  const stay = await findStay(database(), hotelId, stayId);
  if (!stay || !stay.id_photo) throw fail.notFound();
  try {
    const bytes = await getObject(`id-photos/${hotelId}/${stay.id}`);
    const kind = bytes ? sniffPhoto(bytes) : null;
    if (!bytes || !kind) throw fail.notFound();
    return { status: 200, bytes, contentType: photoContentType(kind) };
  } catch (failure) {
    if (failure instanceof StoreUnavailable) throw fail.unavailable("The file store is unavailable.");
    throw failure;
  }
}
