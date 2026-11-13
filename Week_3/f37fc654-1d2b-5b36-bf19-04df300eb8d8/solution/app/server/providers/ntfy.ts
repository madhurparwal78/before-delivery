// Crew alerts on the ntfy topic `spindrift-crew`.
import { config } from "../config.js";
import { expectOk, reach } from "./reach.js";

const CREW_TOPIC = "spindrift-crew";

export async function postAlert(title: string, message: string): Promise<void> {
  const auth = Buffer.from(`${config.ntfy.username}:${config.ntfy.password}`).toString("base64");
  const response = await reach("ntfy", `${config.ntfy.url}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({ topic: CREW_TOPIC, title, message, tags: ["spindrift"] }),
  });
  await expectOk("ntfy", response, 200);
}
