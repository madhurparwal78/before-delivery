import { one, query } from "./db.ts";
import { hashPassword } from "./identity.ts";
import { syncSearch } from "./store.ts";
import { pushWorkingCopy } from "./store.ts";
import { logger } from "./logger.ts";

/** The invented seed records, created on start when absent. */
export async function seedIfAbsent(): Promise<void> {
  const existing = await one<{ id: string }>("SELECT id FROM notebooks WHERE title = 'Tide gauge warm-up' LIMIT 1");
  if (existing !== null) return;
  try {
    const people: { key: string; email: string; name: string; password: string }[] = [
      { key: "ada", email: "ada@wrenmoor.test", name: "Ada Thornquist", password: "tidewater-2026" },
      { key: "bram", email: "bram@wrenmoor.test", name: "Bram Okonkwo-Lisle", password: "saltmarsh-2026" },
      { key: "cleo", email: "cleo@wrenmoor.test", name: "Cleo Varga", password: "larchgate-2026" },
    ];
    const ids = new Map<string, string>();
    for (const person of people) {
      const found = await one<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [person.email]);
      if (found !== null) {
        ids.set(person.key, found.id);
        continue;
      }
      const id = `seed_${person.key}`;
      await query(
        "INSERT INTO users (id, email, display_name, password_hash, verified) VALUES ($1, $2, $3, $4, true)",
        [id, person.email, person.name, hashPassword(person.password)],
      );
      ids.set(person.key, id);
    }
    const notebookId = "seed_tide_gauge";
    await query("INSERT INTO notebooks (id, title, owner_id, execution_counter) VALUES ($1, $2, $3, 0)", [
      notebookId,
      "Tide gauge warm-up",
      ids.get("ada") as string,
    ]);
    const cells = [
      { id: "seed_cell_intro", type: "markdown", source: "# Tide gauge warm-up\n\nHourly heights from an invented gauge." },
      { id: "seed_cell_heights", type: "code", source: "const heights = [1.2, 1.9, 2.6, 2.1, 1.4, 0.8];\nheights.length" },
      { id: "seed_cell_range_heading", type: "markdown", source: "## Range" },
      { id: "seed_cell_range", type: "code", source: "Math.max(...heights) - Math.min(...heights)" },
    ];
    for (let i = 0; i < cells.length; i++) {
      await query(
        "INSERT INTO cells (notebook_id, id, position, cell_type, source) VALUES ($1, $2, $3, $4, $5)",
        [notebookId, cells[i].id, i, cells[i].type, cells[i].source],
      );
    }
    await query(
      "INSERT INTO shares (id, notebook_id, user_id, role, status) VALUES ($1, $2, $3, 'editor', 'active')",
      ["seed_share_bram", notebookId, ids.get("bram") as string],
    );
    await query(
      "INSERT INTO shares (id, notebook_id, user_id, role, status) VALUES ($1, $2, $3, 'viewer', 'active')",
      ["seed_share_cleo", notebookId, ids.get("cleo") as string],
    );
    await pushWorkingCopy(notebookId);
    await syncSearch(notebookId);
    logger.info("seeded the tide gauge notebook");
  } catch (err) {
    logger.warn(`seed: ${(err as Error).message}`);
  }
}
