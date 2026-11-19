import { query, tx } from "../db/pool.ts";
import { SEED_LABEL } from "../db/seed.ts";
import { seedPhotograph } from "../db/seedPictures.ts";
import { labelKey, photographKey } from "../domain/files.ts";
import { createHash } from "node:crypto";
import { ProviderDown } from "../providers/call.ts";
import { putObject } from "../providers/s3.ts";
import { every2s } from "./loop.ts";

async function storePhotographs(): Promise<void> {
  const rows = await query<{ ref: string; side: "before" | "after"; sha256: string; piece_id: string; desk_id: string; title: string }>(
    `SELECT f.ref, ph.side, ph.sha256, ph.piece_id, p.desk_id, p.title FROM seed_files f
     JOIN photographs ph ON ph.id = f.ref JOIN pieces p ON p.id = ph.piece_id WHERE f.kind = 'photograph' AND f.done_at IS NULL`,
  );
  for (const row of rows) {
    await putObject(photographKey(row.desk_id, row.piece_id, row.sha256), seedPhotograph(row.title, row.side), "image/png");
    await tx(async (client) => {
      await client.query("UPDATE photographs SET state = 'stored' WHERE id = $1", [row.ref]);
      await client.query("UPDATE seed_files SET done_at = now() WHERE kind = 'photograph' AND ref = $1", [row.ref]);
    });
  }
}

async function storeLabels(): Promise<void> {
  const rows = await query<{ ref: string; piece_id: string; desk_id: string }>(
    `SELECT f.ref, c.piece_id, p.desk_id FROM seed_files f
     JOIN collections c ON c.id = f.ref JOIN pieces p ON p.id = c.piece_id WHERE f.kind = 'label' AND f.done_at IS NULL`,
  );
  const sha256 = createHash("sha256").update(SEED_LABEL).digest("hex");
  for (const row of rows) {
    await putObject(labelKey(row.desk_id, row.piece_id, row.ref), SEED_LABEL, "application/pdf");
    await tx(async (client) => {
      await client.query("UPDATE collections SET state = 'booked', label_sha256 = $2 WHERE id = $1", [row.ref, sha256]);
      await client.query("UPDATE seed_files SET done_at = now() WHERE kind = 'label' AND ref = $1", [row.ref]);
    });
  }
}

/** Seeded photographs and labels reach the file store as soon as it answers; until then their rows read `waiting`. */
export function startSeedFilesJob(): void {
  every2s("seed files", async () => {
    try {
      await storePhotographs();
      await storeLabels();
    } catch (error) {
      if (!(error instanceof ProviderDown)) throw error;
    }
  });
}
