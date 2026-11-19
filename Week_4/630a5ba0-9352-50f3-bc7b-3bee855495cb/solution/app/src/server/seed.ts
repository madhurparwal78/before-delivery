import { addDays, localToInstant, todayIn } from "../shared/time.js";
import { hashPassword, newToken } from "./auth.js";
import { config } from "./config.js";
import type { Tx } from "./db.js";
import { enqueue } from "./outbox.js";
import { settleState } from "./subscription.js";

// Seed data (brief: Seed data). Every person and business is invented. Created only when missing.

const SEED_PASSWORD = "daybook-demo-2026";

type SeedTask = { title: string; estimate: number | null; source?: string; externalId?: string; day?: "today" | "tomorrow" };
type SeedMember = { name: string; email: string; role: "owner" | "member"; zone: string; threshold: number; tasks: SeedTask[] };

async function addMember(tx: Tx, workspaceId: string, person: SeedMember, passwordHash: string, now: number): Promise<string> {
  const [member] = await tx<{ id: string }[]>`
    INSERT INTO members (workspace_id, role, status, name, email, password_hash, time_zone, threshold_minutes, feed_token)
    VALUES (${workspaceId}, ${person.role}, 'active', ${person.name}, ${person.email}, ${passwordHash}, ${person.zone},
            ${person.threshold}, ${newToken()})
    RETURNING id`;
  const today = todayIn(person.zone, now);
  const positions = new Map<string | null, number>();
  for (const task of person.tasks) {
    const day = task.day === "today" ? today : task.day === "tomorrow" ? addDays(today, 1) : null;
    const position = positions.get(day) ?? 0;
    positions.set(day, position + 1);
    await tx`
      INSERT INTO tasks (member_id, title, estimate_minutes, day_date, position, source, external_id)
      VALUES (${member.id}, ${task.title}, ${task.estimate}, ${day}::date, ${position}, ${task.source ?? null}, ${task.externalId ?? null})`;
  }
  await tx`
    INSERT INTO routines (member_id, name, start_time, duration_minutes, repeats)
    VALUES (${member.id}, 'Inbox zero', '08:30', 30, 'daily')`;
  return member.id;
}

async function addWorkspace(tx: Tx, key: string, name: string, createdAt: number): Promise<string> {
  const [workspace] = await tx<{ id: string }[]>`
    INSERT INTO workspaces (name, created_at, trial_ends_at, seed_key)
    VALUES (${name}, ${new Date(createdAt)}, ${new Date(createdAt + config.trialLengthSeconds * 1000)}, ${key})
    RETURNING id`;
  return workspace.id;
}

export async function seed(tx: Tx): Promise<void> {
  const now = Date.now();
  const [harbour] = await tx`SELECT 1 FROM workspaces WHERE seed_key = 'harbour-lane'`;
  const [saltmarsh] = await tx`SELECT 1 FROM workspaces WHERE seed_key = 'saltmarsh'`;
  const [juno] = await tx`SELECT 1 FROM members WHERE lower(email) = 'operator@tidemark.test' AND removed_at IS NULL`;
  if (harbour && saltmarsh && juno) return;
  const passwordHash = await hashPassword(SEED_PASSWORD);

  if (!harbour) {
    const id = await addWorkspace(tx, "harbour-lane", "Harbour Lane Studio", now);
    const wren = await addMember(
      tx,
      id,
      {
        name: "Wren Castell",
        email: "wren@harbourlane.test",
        role: "owner",
        zone: "Europe/London",
        threshold: 360,
        tasks: [
          { title: "Draft Q4 proposal", estimate: 45, source: "tracker", externalId: "TRK-101" },
          { title: "Review pull request queue", estimate: 30, source: "tracker", externalId: "TRK-102" },
          { title: "Invoice October", estimate: 15 },
          { title: "Sketch onboarding flow", estimate: null },
          { title: "Client call prep", estimate: 60, day: "today" },
          { title: "Write case study", estimate: 300, day: "tomorrow" },
        ],
      },
      passwordHash,
      now,
    );
    const today = todayIn("Europe/London", now);
    for (const [uid, summary, start, end] of [
      ["seed-studio-stand-up@harbourlane.test", "Studio stand-up", "09:30", "10:00"],
      ["seed-client-review@harbourlane.test", "Client review", "14:00", "15:30"],
    ]) {
      await tx`
        INSERT INTO meetings (member_id, uid, summary, starts_at, ends_at)
        VALUES (${wren}, ${uid}, ${summary}, ${new Date(localToInstant(today, start, "Europe/London"))},
                ${new Date(localToInstant(today, end, "Europe/London"))})`;
    }
    await addMember(
      tx,
      id,
      { name: "Tama Rewiti", email: "tama@harbourlane.test", role: "member", zone: "Pacific/Auckland", threshold: 300, tasks: [{ title: "Prepare workshop slides", estimate: 90 }] },
      passwordHash,
      now,
    );
    await addMember(
      tx,
      id,
      { name: "Leilani Kahale", email: "leilani@harbourlane.test", role: "member", zone: "Pacific/Honolulu", threshold: 420, tasks: [{ title: "Audit design tokens", estimate: 60 }] },
      passwordHash,
      now,
    );
    await enqueue(tx, id, "killbill.register_workspace", { workspaceId: id });
  }

  if (!saltmarsh) {
    const createdAt = now - 2_592_000 * 1000;
    const id = await addWorkspace(tx, "saltmarsh", "Saltmarsh Consulting", createdAt);
    await addMember(
      tx,
      id,
      {
        name: "Ossian Pell",
        email: "ossian@saltmarsh.test",
        role: "owner",
        zone: "America/New_York",
        threshold: 360,
        tasks: [
          { title: "Saltmarsh retainer report", estimate: 120 },
          { title: "Estuary survey notes", estimate: 30 },
        ],
      },
      passwordHash,
      now,
    );
    await tx`
      INSERT INTO billing_events (event_id, workspace_id, type, occurred_at)
      VALUES ('seed-saltmarsh-trial-converted', ${id}, 'subscription.trial_converted', ${new Date(createdAt + 1000)})`;
    await settleState(tx, id, now);
    await enqueue(tx, id, "killbill.register_workspace", { workspaceId: id });
  }

  if (!juno) {
    await tx`
      INSERT INTO members (workspace_id, role, status, name, email, password_hash, time_zone, feed_token)
      VALUES (NULL, 'operator', 'active', 'Juno Ferreira', 'operator@tidemark.test', ${passwordHash}, 'UTC', ${newToken()})`;
  }
}
