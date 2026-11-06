// The one-time seed, written under the boot lock when the database is empty (brief: Seed data). Every person,
// horse, barn and business here is invented; Juniper's photos are drawings made for this app.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hashPassword } from "./auth.js";
import { alignment, angleTenths } from "./domain/hoofMarks.js";
import { enqueueJob } from "./jobs.js";
import { photoKey } from "./photos.js";
import { addDays, businessDate, clockPlus } from "./practiceTime.js";
import { putObject } from "./storage.js";
const ZONE = "America/Denver";
const PASSWORD = "hoofcare-2026";
const SEED_IMAGES = new URL("../../seed/", import.meta.url);
const USERS = [
    { key: "farrier", name: "Marlow Tesk", email: "farrier@clinchline.test", role: "farrier" },
    { key: "apprentice", name: "Ike Ferreira", email: "apprentice@clinchline.test", role: "apprentice" },
    { key: "rosa", name: "Rosa Vint", email: "manager.cedar@clinchline.test", role: "barn_manager", barn: "cedar" },
    { key: "hollis", name: "Hollis Breen", email: "manager.larkspur@clinchline.test", role: "barn_manager", barn: "larkspur" },
    { key: "ada", name: "Ada Quill", email: "owner.ada@clinchline.test", role: "owner", phone: "+1 303 555 0141" },
    { key: "bram", name: "Bram Lowe", email: "owner.bram@clinchline.test", role: "owner", phone: "+1 303 555 0142" },
    { key: "cleo", name: "Cleo Marsh", email: "owner.cleo@clinchline.test", role: "owner", phone: "+1 303 555 0143" },
    { key: "dev", name: "Dev Ansel", email: "owner.dev@clinchline.test", role: "owner", phone: "+1 303 555 0144" },
];
const HORSES = [
    { name: "Juniper", owner: "ada", barn: "cedar", stall: "4", cycle: 6 },
    { name: "Pilot", owner: "ada", barn: "cedar", stall: "7", cycle: 8 },
    { name: "Saffron", owner: "bram", barn: "cedar", stall: "5", cycle: 5 },
    { name: "Quarry", owner: "bram", barn: "cedar", stall: "9", cycle: 6 },
    { name: "Tamarack", owner: "cleo", barn: "cedar", stall: "12", cycle: 7 },
    { name: "Wicket", owner: "cleo", barn: "cedar", stall: "11", cycle: 8 },
    { name: "Fern", owner: "dev", barn: "cedar", stall: "14", cycle: 6 },
    { name: "Maple", owner: "dev", barn: "larkspur", stall: "2", cycle: 6 },
];
const line = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
/** Juniper's fore after photos and marks at seed date − 84 and − 42 days. */
const JUNIPER_MARKS = [
    { daysAgo: 84, hoof: "LF", image: "juniper-lf-early.jpg", wall: line(300, 800, 700, 297), pastern: line(700, 700, 1100, 107) },
    { daysAgo: 84, hoof: "RF", image: "juniper-rf-early.jpg", wall: line(300, 800, 700, 330), pastern: line(700, 700, 1100, 170) },
    { daysAgo: 42, hoof: "LF", image: "juniper-lf-late.jpg", wall: line(300, 820, 700, 269), pastern: line(700, 700, 1100, 129) },
    { daysAgo: 42, hoof: "RF", image: "juniper-rf-late.jpg", wall: line(300, 800, 700, 310), pastern: line(700, 700, 1100, 210) },
];
const HISTORY = [
    { horse: "Juniper", daysAgo: 84 },
    { horse: "Juniper", daysAgo: 42 },
    { horse: "Pilot", daysAgo: 63 },
    { horse: "Saffron", daysAgo: 10 },
    { horse: "Maple", daysAgo: 30 },
];
export async function seed(client, now) {
    const seedDate = businessDate(now, ZONE);
    await client.query(`INSERT INTO practice (id, name, time_zone, seed_date) VALUES (1, 'Rasp & Rein', $1, $2)`, [ZONE, seedDate]);
    const at = new Date(now);
    const barns = { cedar: randomUUID(), larkspur: randomUUID() };
    await client.query(`INSERT INTO barns (id, name, trip_fee_cents) VALUES ($1, 'Cedar Hollow Stables', 4500), ($2, 'Larkspur Farm', 6000)`, [
        barns.cedar,
        barns.larkspur,
    ]);
    const users = new Map();
    for (const user of USERS) {
        const id = randomUUID();
        users.set(user.key, id);
        await client.query(`INSERT INTO users (id, name, email, role, password_hash, phone, barn_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
            id,
            user.name,
            user.email,
            user.role,
            await hashPassword(PASSWORD),
            "phone" in user ? user.phone : null,
            "barn" in user ? barns[user.barn] : null,
            at,
        ]);
    }
    const horses = new Map();
    for (const horse of HORSES) {
        const id = randomUUID();
        horses.set(horse.name, id);
        await client.query(`INSERT INTO horses (id, name, owner_id, barn_id, stall, cycle_weeks, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
            id,
            horse.name,
            users.get(horse.owner),
            barns[horse.barn],
            horse.stall,
            horse.cycle,
            at,
        ]);
    }
    await client.query(`INSERT INTO price_lists (id, effective_from, deposit_cents, prices, created_at) VALUES ($1, '2026-01-01', 2500, $2, $3)`, [
        randomUUID(),
        JSON.stringify({ trim: 5500, front_reset: 12000, full_reset: 19000, front_new: 15000, full_new: 24000 }),
        at,
    ]);
    const visits = new Map();
    for (const [index, history] of HISTORY.entries()) {
        const id = randomUUID();
        visits.set(`${history.horse}:${history.daysAgo}`, id);
        await client.query(`INSERT INTO visits (id, horse_id, business_date, status, created_at) VALUES ($1, $2, $3, 'invoiced', $4)`, [id, horses.get(history.horse), addDays(seedDate, -history.daysAgo), new Date(now + index)]);
    }
    for (const mark of JUNIPER_MARKS) {
        const visitId = visits.get(`Juniper:${mark.daysAgo}`) ?? "";
        const photoId = randomUUID();
        const key = photoKey(visitId, mark.hoof, "after", photoId, "jpg");
        const image = await readFile(new URL(mark.image, SEED_IMAGES));
        await putObject(key, image, "image/jpeg");
        await client.query(`INSERT INTO photos (id, visit_id, hoof, phase, content_type, width, height, size_bytes, object_key, thumbnail_status, created_at)
       VALUES ($1, $2, $3, 'after', 'image/jpeg', 1200, 900, $4, $5, 'pending', $6)`, [photoId, visitId, mark.hoof, image.length, key, at]);
        await enqueueJob(client, { kind: "thumbnail", payload: { photo_id: photoId } });
        const wall = angleTenths(mark.wall);
        const pastern = angleTenths(mark.pastern);
        await client.query(`INSERT INTO hoof_marks (visit_id, hoof, version, hoof_wall, pastern, wall_tenths, pastern_tenths, alignment, saved_by, saved_at)
       VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9)`, [visitId, mark.hoof, JSON.stringify(mark.wall), JSON.stringify(mark.pastern), wall, pastern, alignment(wall, pastern), users.get("farrier"), at]);
    }
    const days = [
        { barn: barns.cedar, date: addDays(seedDate, 14), start: "07:30", slots: 4, minutes: 45, fee: 4500, status: "published" },
        { barn: barns.larkspur, date: addDays(seedDate, 21), start: "08:00", slots: 2, minutes: 60, fee: 6000, status: "draft" },
    ];
    for (const day of days) {
        const id = randomUUID();
        await client.query(`INSERT INTO barn_days (id, barn_id, business_date, start_time, slot_count, slot_minutes, trip_fee_cents, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [id, day.barn, day.date, day.start, day.slots, day.minutes, day.fee, day.status, at]);
        for (let position = 0; position < day.slots; position += 1) {
            await client.query(`INSERT INTO slots (id, barn_day_id, position, time) VALUES ($1, $2, $3, $4)`, [
                randomUUID(),
                id,
                position,
                clockPlus(day.start, position * day.minutes),
            ]);
        }
    }
}
