import { config } from "./config.js";
import { Database } from "./postgres.js";

export const db = new Database(config.databaseUrl, 16);
