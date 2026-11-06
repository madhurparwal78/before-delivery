import type { Tx } from "./db.js";
import { one, rows } from "./db.js";
import { createUser, hashPassword } from "./users.js";
import { addDays, kitchenToday } from "./kitchenTime.js";
import { recordMovement } from "./ledger.js";
import { putObject } from "./storage.js";

// Seed data loads once, when the app finds an empty database at serve time.
const SEED_PASSWORD = "Railside-demo-26";


const samplePdf = (title: string): Buffer => {
  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 60 >> stream
BT /F1 18 Tf 72 720 Td (${title}) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF`;
  return Buffer.from(content, "latin1");
};

type SeedRenter = {
  name: string;
  email: string;
  business: string;
  status: string;
  openingMinutes: number;
  coi: string;
  card: string;
  licence: string;
  documentStatus: "approved" | "pending_review";
};

const seedRenters: SeedRenter[] = [
  { name: "Wren Abernathy", email: "wren@hearthhustle.example", business: "Hearth & Hustle Bakery", status: "active", openingMinutes: 1200, coi: "+200", card: "+300", licence: "+365", documentStatus: "approved" },
  { name: "Paz Ochoa", email: "paz@lomaverde.example", business: "Loma Verde Tamales", status: "active", openingMinutes: 480, coi: "+10", card: "+300", licence: "+365", documentStatus: "approved" },
  { name: "Jory Kessler", email: "jory@smokesignal.example", business: "Smoke Signal BBQ", status: "active", openingMinutes: 360, coi: "+0", card: "+300", licence: "+365", documentStatus: "approved" },
  { name: "Ines Marchetti", email: "ines@fennelstreet.example", business: "Fennel Street Catering", status: "active", openingMinutes: 240, coi: "-1", card: "+300", licence: "+365", documentStatus: "approved" },
  { name: "Theo Banerjee", email: "theo@littlecrumb.example", business: "Little Crumb Granola", status: "documents_review", openingMinutes: 0, coi: "+180", card: "+180", licence: "+365", documentStatus: "pending_review" },
];

const stations = [
  { id: "convection-1", name: "Convection oven 1", hour_weight: 1, off_peak_percent: 50, overage: "48.00", buffer: 30 },
  { id: "convection-2", name: "Convection oven 2", hour_weight: 1, off_peak_percent: 50, overage: "48.00", buffer: 30 },
  { id: "deck-oven", name: "Deck oven", hour_weight: 2, off_peak_percent: 50, overage: "72.00", buffer: 45 },
  { id: "mixer-60", name: "60-quart mixer", hour_weight: 1, off_peak_percent: 100, overage: "30.00", buffer: 15 },
  { id: "prep-3", name: "Prep table 3", hour_weight: 1, off_peak_percent: 100, overage: "24.00", buffer: 15 },
];

const packs = [
  { id: "pack-10", name: "10-hour pack", hours: 10, amount: "290.00" },
  { id: "pack-20", name: "20-hour pack", hours: 20, amount: "540.00" },
  { id: "pack-40", name: "40-hour pack", hours: 40, amount: "1000.00" },
];

export const runSeed = async (tx: Tx): Promise<void> => {
  const seeded = await one<{ value: string }>(tx, "select value from meta where key = 'seeded'");
  if (seeded) return;

  const claim = await rows<{ key: string }>(
    tx,
    "insert into meta (key, value) values ('seeded', now()::text) on conflict (key) do nothing returning key",
  );
  if (claim.length === 0) return;

  const passwordHash = await hashPassword(SEED_PASSWORD);
  const today = kitchenToday(new Date());
  const dateFor = (offset: string): string => addDays(today, Number(offset));

  await rows<{ id: string }>(
    tx,
    "insert into users (email, password_hash, name, role) values ($1, $2, $3, 'operator') returning id",
    ["marisol@brigadebench.example", passwordHash, "Marisol Teague"],
  );
  await rows<{ id: string }>(
    tx,
    "insert into users (email, password_hash, name, role) values ($1, $2, $3, 'shift_lead') returning id",
    ["dev@brigadebench.example", passwordHash, "Dev Okafor"],
  );

  for (const station of stations) {
    await tx.query("insert into stations (id, name, position) values ($1, $2, $3)", [
      station.id,
      station.name,
      stations.indexOf(station),
    ]);
    await tx.query(
      `insert into station_settings (station_id, effective_from, hour_weight, off_peak_percent, overage_usd_per_hour, buffer_minutes)
       values ($1, '2026-01-01', $2, $3, $4, $5)`,
      [station.id, station.hour_weight, station.off_peak_percent, station.overage, station.buffer],
    );
  }

  for (const pack of packs) {
    await tx.query("insert into packs (id, name, hours, amount_usd) values ($1, $2, $3, $4)", [
      pack.id,
      pack.name,
      pack.hours,
      pack.amount,
    ]);
  }

  for (const renter of seedRenters) {
    const renterRows = await rows<{ id: string }>(
      tx,
      "insert into renters (business_name, contact_name, email, phone, status) values ($1, $2, $3, $4, $5) returning id",
      [renter.business, renter.name, renter.email, "555-0100", renter.status],
    );
    const renterId = renterRows[0]!.id;
    await createUser(tx, renter.email, SEED_PASSWORD, renter.name, "renter", renterId);
    if (renter.openingMinutes > 0) {
      await recordMovement(tx, renterId, "opening_balance", renter.openingMinutes, {
        note: "Opening balance",
      });
    }
    for (const kind of ["coi", "food_handler_card", "business_licence"] as const) {
      const expiresOn =
        kind === "coi" ? dateFor(renter.coi) : kind === "food_handler_card" ? dateFor(renter.card) : dateFor(renter.licence);
      const documentRows = await rows<{ id: string }>(
        tx,
        `insert into documents (renter_id, kind, expires_on, status, object_key, original_name, size_bytes, content_type)
         values ($1, $2, $3, $4, '', $5, $6, 'application/pdf') returning id`,
        [renterId, kind, expiresOn, renter.documentStatus, `${renter.business} ${kind}.pdf`, 1024],
      );
      const documentId = documentRows[0]!.id;
      const objectKey = `renters/${renterId}/documents/${documentId}.pdf`;
      await tx.query("update documents set object_key = $1 where id = $2", [objectKey, documentId]);
      const pdf = samplePdf(`${renter.business} ${kind}`);
      await putObject(objectKey, pdf, "application/pdf");
    }
  }
};

