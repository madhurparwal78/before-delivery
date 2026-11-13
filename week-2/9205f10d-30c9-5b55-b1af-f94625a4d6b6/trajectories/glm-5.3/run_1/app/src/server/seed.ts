import { Pool } from "pg";
import { agencyDateKey, cancellationCutoff, defaultTeamSize, instantInAgency, weekMonday, type CredentialCode, type Setting } from "../shared/domain.js";
import { applySchema } from "./schema.js";
import { hashPassword, newId } from "./crypto.js";
import type { DbCredential, DbPerson } from "./db_types.js";

const SEED_PASSWORD = "relay-demo-2026";

export async function seedOnce(pool: Pool): Promise<void> {
  await applySchema(pool);
  const existing = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM agency");
  if (Number(existing.rows[0]?.count ?? "0") > 0) return;

  const today = new Date();
  const day = (offset: number): Date => {
    const key = agencyDateKey(today);
    const parts = key.split("-").map((n) => Number(n));
    return new Date(Date.UTC(parts[0] ?? 2026, (parts[1] ?? 1) - 1, (parts[2] ?? 1) + offset, 12));
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO agency (id, name, time_zone) VALUES ($1, $2, $3)", [
      "agency_crosshand",
      "Crosshand Interpreting Collective",
      "America/New_York",
    ]);

    const orgs = [
      { id: "org_hpmc", name: "Harbor Point Medical Center", code: "HPMC", rate: 9750 },
      { id: "org_lksu", name: "Lakemont State University", code: "LKSU", rate: 8625 },
      { id: "org_eccc", name: "Ellery County Circuit Court", code: "ECCC", rate: 11000 },
    ];
    for (const o of orgs) {
      await client.query("INSERT INTO organisation (id, name, code, hourly_rate_cents) VALUES ($1,$2,$3,$4)", [o.id, o.name, o.code, o.rate]);
    }

    const pwd = hashPassword(SEED_PASSWORD);
    type SeedPerson = {
      id: string; role: DbPerson["role"]; display_name: string; full_name: string; email: string;
      phone: string | null; home_area: string | null; pay_rate_cents: number | null; org: string | null;
    };
    const people: SeedPerson[] = [
      { id: "usr_coord", role: "coordinator", display_name: "Priya Velasco", full_name: "Priya Velasco", email: "coord@crosshand.example", phone: null, home_area: null, pay_rate_cents: null, org: null },
      { id: "usr_billing", role: "billing_admin", display_name: "Morgan Reyes-Hall", full_name: "Morgan Reyes-Hall", email: "billing@crosshand.example", phone: null, home_area: null, pay_rate_cents: null, org: null },
      { id: "usr_sched_hpmc", role: "client_scheduler", display_name: "Jordan Baptiste", full_name: "Jordan Baptiste", email: "sched@harborpoint.example", phone: null, home_area: null, pay_rate_cents: null, org: "org_hpmc" },
      { id: "usr_sched_lksu", role: "client_scheduler", display_name: "Avery Lindqvist", full_name: "Avery Lindqvist", email: "sched@lakemont.example", phone: null, home_area: null, pay_rate_cents: null, org: "org_lksu" },
      { id: "usr_sched_eccc", role: "client_scheduler", display_name: "Sam Whitfield", full_name: "Sam Whitfield", email: "sched@ellerycourt.example", phone: null, home_area: null, pay_rate_cents: null, org: "org_eccc" },
      { id: "usr_rosa", role: "interpreter", display_name: "Rosa D.", full_name: "Rosa Delgado-Finch", email: "rosa@interpreters.example", phone: "(555) 010-0141", home_area: "North Halden", pay_rate_cents: 5800, org: null },
      { id: "usr_theo", role: "interpreter", display_name: "Theo M.", full_name: "Theo Marchetti", email: "theo@interpreters.example", phone: "(555) 010-0142", home_area: "Marrow Bay", pay_rate_cents: 5500, org: null },
      { id: "usr_kemi", role: "interpreter", display_name: "Kemi A.", full_name: "Kemi Adeyemi", email: "kemi@interpreters.example", phone: "(555) 010-0143", home_area: "Ellery", pay_rate_cents: 6400, org: null },
      { id: "usr_wren", role: "interpreter", display_name: "Wren C.", full_name: "Wren Castellanos", email: "wren@interpreters.example", phone: "(555) 010-0144", home_area: "Marrow Bay", pay_rate_cents: 5000, org: null },
      { id: "usr_malik", role: "interpreter", display_name: "Malik O.", full_name: "Malik Osei", email: "malik@interpreters.example", phone: "(555) 010-0145", home_area: "Halden", pay_rate_cents: 6000, org: null },
      { id: "usr_ines", role: "interpreter", display_name: "Ines P.", full_name: "Ines Park", email: "ines@interpreters.example", phone: "(555) 010-0146", home_area: "South Halden", pay_rate_cents: 5600, org: null },
    ];
    for (const p of people) {
      await client.query(
        `INSERT INTO person (id, role, display_name, full_name, email, password_hash, phone, home_area, pay_rate_cents, organisation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [p.id, p.role, p.display_name, p.full_name, p.email, pwd, p.phone, p.home_area, p.pay_rate_cents, p.org],
      );
    }

    const expires = "2030-12-31";
    const expiredDay = (() => {
      const key = agencyDateKey(today);
      const parts = key.split("-").map((n) => Number(n));
      return new Date(Date.UTC(parts[0] ?? 2026, (parts[1] ?? 1) - 1, (parts[2] ?? 1) - 1)).toISOString().slice(0, 10);
    })();
    const credentials: Array<{ id: string; who: string; type: CredentialCode; status: "verified"; expires: string }> = [
      { id: newId("cred"), who: "usr_rosa", type: "NIC", status: "verified", expires },
      { id: newId("cred"), who: "usr_theo", type: "NIC", status: "verified", expires },
      { id: newId("cred"), who: "usr_kemi", type: "NIC", status: "verified", expires },
      { id: newId("cred"), who: "usr_kemi", type: "SC:L", status: "verified", expires },
      { id: newId("cred"), who: "usr_wren", type: "EIPA", status: "verified", expires },
      { id: newId("cred"), who: "usr_malik", type: "CDI", status: "verified", expires },
      { id: newId("cred"), who: "usr_malik", type: "EIPA", status: "verified", expires: expiredDay },
      { id: newId("cred"), who: "usr_ines", type: "NIC", status: "verified", expires },
    ];
    for (const c of credentials) {
      await client.query(
        `INSERT INTO credential (id, interpreter_id, credential_type, status, expires_on, uploaded_at)
         VALUES ($1,$2,$3,$4,$5, now())`,
        [c.id, c.who, c.type, c.status, c.expires],
      );
    }

    type SeedRequest = {
      ref: string; org: string; setting: Setting; cred: CredentialCode;
      dayOffset: number; hour: number; minute: number; minutes: number;
      city: string; address: string; consumer: string; notes: string;
      status: "draft" | "submitted" | "half_staffed" | "staffed" | "completed";
      team: 1 | 2; rotation: number; actual?: number;
      seats: Array<{ label: "A" | "B"; who?: string }>;
    };
    const requests: SeedRequest[] = [
      { ref: "CR-1001", org: "org_hpmc", setting: "medical", cred: "NIC", dayOffset: 3, hour: 9, minute: 0, minutes: 120, city: "Halden", address: "400 Harbor Point Way", consumer: "Elena Brandt", notes: "Cardiology follow-up; patient prefers interpreters to the left of the screen.", status: "half_staffed", team: 2, rotation: 20, seats: [{ label: "A", who: "usr_rosa" }, { label: "B" }] },
      { ref: "CR-1002", org: "org_lksu", setting: "education", cred: "EIPA", dayOffset: 2, hour: 13, minute: 0, minutes: 50, city: "Marrow Bay", address: "12 Quarry Hall", consumer: "Devon Achterberg", notes: "BIOL 210 lab; vocabulary list sent to the coordinator.", status: "submitted", team: 1, rotation: 20, seats: [{ label: "A" }] },
      { ref: "CR-1003", org: "org_eccc", setting: "legal", cred: "SC:L", dayOffset: 4, hour: 8, minute: 30, minutes: 210, city: "Ellery", address: "1 Courthouse Square, Courtroom 4B", consumer: "Marisol Varga", notes: "Arraignment; proceedings team only.", status: "submitted", team: 2, rotation: 30, seats: [{ label: "A" }, { label: "B" }] },
      { ref: "CR-1004", org: "org_hpmc", setting: "medical", cred: "NIC", dayOffset: 1, hour: 14, minute: 0, minutes: 90, city: "Halden", address: "400 Harbor Point Way", consumer: "Graham Oduya", notes: "Pre-surgical consult.", status: "staffed", team: 2, rotation: 20, seats: [{ label: "A", who: "usr_theo" }, { label: "B", who: "usr_rosa" }] },
      { ref: "CR-1005", org: "org_hpmc", setting: "medical", cred: "NIC", dayOffset: 10, hour: 10, minute: 0, minutes: 60, city: "Halden", address: "400 Harbor Point Way", consumer: "Lena Petrakis", notes: "", status: "draft", team: defaultTeamSize(60), rotation: 20, seats: [] },
      { ref: "CR-1006", org: "org_lksu", setting: "education", cred: "NIC", dayOffset: -2, hour: 10, minute: 0, minutes: 120, city: "Marrow Bay", address: "3 Founders Hall", consumer: "Priyanka Moss", notes: "Thesis defence.", status: "completed", team: 2, rotation: 20, actual: 127, seats: [{ label: "A", who: "usr_rosa" }, { label: "B", who: "usr_theo" }] },
      { ref: "CR-1007", org: "org_eccc", setting: "legal", cred: "SC:L", dayOffset: -1, hour: 13, minute: 0, minutes: 45, city: "Ellery", address: "1 Courthouse Square, Courtroom 2A", consumer: "Victor Halloran", notes: "Status hearing.", status: "completed", team: 1, rotation: 20, actual: 40, seats: [{ label: "A", who: "usr_kemi" }] },
    ];

    for (const r of requests) {
      const dateKey = agencyDateKey(day(r.dayOffset));
      const startWall = `${dateKey}T${String(r.hour).padStart(2, "0")}:${String(r.minute).padStart(2, "0")}`;
      const startsAt = wallToInstantOrThrow(startWall);
      const cutoff = cancellationCutoff(startsAt);
      const id = newId("req");
      await client.query(
        `INSERT INTO request (id, reference, organisation_id, setting, required_credential, starts_at, duration_minutes,
           city, consumer_name, location_address, notes, status, team_size, rotation_minutes, actual_minutes,
           free_cancel_until, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [id, r.ref, r.org, r.setting, r.cred, startsAt, r.minutes, r.city, r.consumer, r.address, r.notes,
          r.status, r.team, r.rotation, r.actual ?? null, cutoff, "usr_coord", new Date()],
      );
      for (const s of r.seats) {
        const confirmed = Boolean(s.who);
        await client.query(
          `INSERT INTO seat (id, request_id, label, status, interpreter_id, confirmed_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [newId("seat"), id, s.label, confirmed ? "confirmed" : "open", s.who ?? null, confirmed ? new Date() : null],
        );
      }
      await client.query(
        "INSERT INTO history_entry (request_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,$4,$5)",
        [id, "usr_coord", "Priya Velasco", "created", r.ref],
      );
      if (r.status !== "draft") {
        await client.query(
          "INSERT INTO history_entry (request_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,$4,$5)",
          [id, null, "System", "submitted", "Seats opened"],
        );
      }
      for (const s of r.seats) {
        if (s.who) {
          const who = people.find((p) => p.id === s.who);
          await client.query(
            "INSERT INTO history_entry (request_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,$4,$5)",
            [id, s.who, who?.display_name ?? "Interpreter", "claim_won", `Seat ${s.label} claimed`],
          );
        }
      }
      if (r.status === "completed") {
        await client.query(
          "INSERT INTO history_entry (request_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,$4,$5)",
          [id, "usr_coord", "Priya Velasco", "completed", `${r.actual} minutes`],
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function wallToInstantOrThrow(wall: string): string {
  // seeds always use normal wall times that exist
  const y = Number(wall.slice(0, 4));
  const mo = Number(wall.slice(5, 7));
  const d = Number(wall.slice(8, 10));
  const hh = Number(wall.slice(11, 13));
  const mi = Number(wall.slice(14, 16));
  const approx = Date.UTC(y, mo - 1, d, hh, mi);
  let best: number | null = null;
  for (let delta = -6; delta <= 6; delta++) {
    const t = approx + delta * 3600_000;
    const dt = new Date(t);
    const key = agencyDateKey(dt);
    const hh2 = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" }).format(dt).slice(0, 2));
    const mi2 = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" }).format(dt).slice(3, 5));
    const dayKey = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (key === dayKey && hh2 === hh && mi2 === mi && (best === null || t < best)) best = t;
  }
  if (best === null) throw new Error(`bad seed wall time ${wall}`);
  return instantInAgency(new Date(best));
}
