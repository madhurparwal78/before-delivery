// This server process's identity among the processes that share the database.
import { randomUUID } from "node:crypto";

export const instanceId = randomUUID();
