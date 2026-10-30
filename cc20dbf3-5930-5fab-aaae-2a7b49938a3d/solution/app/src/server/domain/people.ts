// Members as staff see them when lending: id and name only.

import type { Ref } from "../../shared/api.js";
import { pool } from "../db.js";

export async function listMembers(): Promise<Ref[]> {
  const found = await pool.query<Ref>("SELECT id, name FROM person WHERE role = 'member' ORDER BY name, id");
  return found.rows;
}
