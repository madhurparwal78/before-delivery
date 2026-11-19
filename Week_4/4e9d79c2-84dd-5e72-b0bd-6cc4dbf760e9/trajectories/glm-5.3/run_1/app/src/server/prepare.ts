import pg from "pg";
import { applySchema } from "./migrate.js";
import { seedOnce } from "./seed.js";

export async function prepareDatabase(pool: pg.Pool): Promise<void> {
  await applySchema(pool);
  await seedOnce(pool);
}
