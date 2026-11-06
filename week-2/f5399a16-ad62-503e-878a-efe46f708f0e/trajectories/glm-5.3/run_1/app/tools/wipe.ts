// Wipes every table so a test run starts from the published seed data.
import { readConfig } from "../src/server/config";
import { Db } from "../src/server/db";

const cfg = readConfig();
const db = new Db(cfg);
const tables = [
  "job_history", "package_files", "packages", "letters", "notes", "attachments",
  "review_sends", "review_names", "reviews", "sign_offs", "renders", "cues",
  "lines", "removals", "cut_frames", "cuts", "frames", "board_stamps", "jobs",
  "producers", "clients", "sessions", "ended_sessions", "enquiries",
  "enquiry_rates", "link_rates", "file_rates", "cue_cache", "pending_mail",
  "desks",
];
for (const table of tables) {
  await db.query("delete from " + table, []);
}
console.log("wiped");
process.exit(0);
