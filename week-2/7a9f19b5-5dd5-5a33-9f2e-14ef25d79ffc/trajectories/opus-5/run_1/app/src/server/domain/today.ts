import { loadConfig } from "../config.js";
import { todayInTimeZone, type IsoDate } from "../../shared/dates.js";

const config = loadConfig();

/** The server's date for every date rule: Pacific/Auckland, or `LIGHTFALL_TODAY`. */
export function serverToday(): IsoDate {
  return config.today ?? todayInTimeZone();
}
