import type { PoolClient } from "pg";
import { addDays, type IsoDate } from "../shared/dates";
import { nightOf } from "./clock";
import { config } from "./config";
import { one } from "./db";
import { closeNight } from "./close";
import { provisionHotel } from "./provision";

const HOTEL = "The Larkspur Inn";

const ROOMS: [string, string, string?][] = [
  ["101", "Queen"], ["102", "Queen"], ["103", "King"], ["104", "King", "dirty"], ["105", "Twin"], ["201", "Queen"], ["202", "Queen"],
  ["203", "King"], ["204", "Twin"], ["205", "Suite", "out_of_order"], ["301", "Queen", "inspected"], ["302", "King"], ["303", "King"], ["304", "Suite"],
];

const GUESTS: [string, string, string][] = [
  ["mara", "Mara Okafor", "mara@guests.example"], ["tomas", "Tomas Lindqvist", "tomas@guests.example"], ["ines", "Ines Duarte", "ines@guests.example"],
  ["priya", "Priya Raman", "priya@guests.example"], ["callum", "Callum Reyes", "callum@guests.example"], ["hana", "Hana Sato", "hana@guests.example"],
  ["sam", "Sam Whitlock", "sam@guests.example"], ["samuel", "Samuel Whitlock", "samuel@guests.example"],
];

/** [guest, room, arrival offset, departure offset, plan, guests, status] */
const STAYS: [string, string, number, number, string, number, string][] = [
  ["mara", "101", -1, 2, "Flexible", 2, "in_house"], ["tomas", "103", -1, 1, "Corporate", 1, "in_house"],
  ["ines", "202", 0, 2, "Flexible", 1, "booked"], ["priya", "302", 0, 1, "Flexible", 2, "booked"],
  ["callum", "105", 1, 4, "Flexible", 3, "booked"], ["hana", "304", 2, 9, "Corporate", 2, "booked"],
  ["sam", "201", 3, 5, "Flexible", 1, "booked"], ["samuel", "204", -3, -1, "Flexible", 1, "checked_out"],
];

/** Seeds The Larkspur Inn and Quarry Lane Rooms once; later starts leave existing records alone. */
export async function seedLarkspur(client: PoolClient): Promise<void> {
  if (await one(client, "SELECT 1 FROM hotels WHERE name = $1", [HOTEL])) return;
  const origin = config.publicUrl;
  const today = nightOf(new Date(), config.defaultTimeZone);
  const at = (offset: number): IsoDate => addDays(today, offset);
  const ids = await provisionHotel(client, {
    hotel: { name: HOTEL, businessDate: today },
    users: [
      { key: "owner", email: "owner@larkspur.example", password: "night-owner-2027", name: "Wren Abara", role: "owner" },
      { key: "desk", email: "desk@larkspur.example", password: "night-desk-2027", name: "Theo Marsh", role: "front_desk" },
      { key: "desk2", email: "desk2@larkspur.example", password: "night-desk2-2027", name: "Lena Fisk", role: "front_desk" },
      { key: "rooms", email: "rooms@larkspur.example", password: "night-rooms-2027", name: "Ivo Pell", role: "housekeeper" },
    ],
    rooms: ROOMS.map(([number, type, status]) => ({ key: number, number, type, status: status ?? "clean" })),
    guests: GUESTS.map(([key, name, email]) => ({ key, name, email, phone: "", company: "", address: "" })),
    stays: STAYS.map(([guest, room, arrival, departure, plan, guests, status]) => ({
      key: guest, room, guest, ratePlan: plan, arrival: at(arrival), departure: at(departure), guests, status,
    })),
    folios: [
      ...STAYS.filter(([guest]) => guest !== "tomas").map(([guest]) => ({
        key: `${guest}-a`, stay: guest, name: "Folio A", payerName: GUESTS.find(([key]) => key === guest)?.[1] ?? "",
        payerEmail: GUESTS.find(([key]) => key === guest)?.[2] ?? "", entries: [],
      })),
      { key: "tomas-a", stay: "tomas", name: "Folio A", payerName: "Tomas Lindqvist", payerEmail: "tomas@guests.example", entries: [] },
      { key: "tomas-b", stay: "tomas", name: "Folio B", payerName: "Brightwell Surveying Ltd", payerEmail: "accounts@brightwell.example", entries: [] },
    ],
  }, origin);
  await postClosedNight(client, ids.hotelId, at(-1));
  await provisionHotel(client, {
    hotel: { name: "Quarry Lane Rooms" },
    users: [{ key: "owner", email: "owner@quarrylane.example", password: "quarry-owner-2027", name: "Quarry Owner", role: "owner" }],
    rooms: [{ key: "1", number: "1", type: "Queen" }, { key: "2", number: "2", type: "Queen" }],
  }, origin);
}

/** Night D-1 of the two in-house stays is posted to Folio A and closed with its figures, exactly as the close does it. */
async function postClosedNight(client: PoolClient, hotelId: string, night: IsoDate): Promise<void> {
  await closeNight(client, hotelId, night, 0);
}
