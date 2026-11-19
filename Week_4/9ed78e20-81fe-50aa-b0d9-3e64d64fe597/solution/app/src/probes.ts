import { createConnection } from "node:net";
import { config } from "./config.js";
import { pool } from "./db.js";
import { storage } from "./media.js";
// This instance's own most recent view of storage and mail.
const state = { storage: false, mail: false };
export const serviceState = (): { storage: boolean; mail: boolean } => ({
  ...state,
});
async function probeStorage(): Promise<boolean> {
  try {
    await storage("HEAD", "");
    return true;
  } catch {
    return false;
  }
}
function probeMail(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({
      host: config.smtpHost,
      port: config.smtpPort,
    });
    socket.setTimeout(3000);
    const settle = (up: boolean): void => {
      socket.destroy();
      resolve(up);
    };
    socket.once("data", (greeting: Buffer) => {
      socket.write("QUIT\r\n");
      settle(greeting.toString().startsWith("220"));
    });
    socket.once("error", () => settle(false));
    socket.once("timeout", () => settle(false));
  });
}
export async function probe(): Promise<void> {
  const [storageUp, mailUp] = await Promise.all([probeStorage(), probeMail()]);
  state.storage = storageUp;
  state.mail = mailUp;
}
export async function readiness(): Promise<{
  status: number;
  body: {
    status: "ready" | "degraded" | "unavailable";
    dependencies: {
      database: "up" | "down";
      storage: "up" | "down";
      mail: "up" | "down";
    };
    degraded_features: string[];
  };
}> {
  const storage = state.storage ? "up" : "down",
    mail = state.mail ? "up" : "down";
  try {
    await pool.query("SELECT 1");
  } catch {
    return {
      status: 503,
      body: {
        status: "unavailable",
        dependencies: { database: "down", storage, mail },
        degraded_features: ["everything"],
      },
    };
  }
  const degraded = [
    ...(state.storage ? [] : ["applications", "resume_downloads", "samples"]),
    ...(state.mail ? [] : ["mail_delivery"]),
  ].sort();
  return {
    status: 200,
    body: {
      status: degraded.length ? "degraded" : "ready",
      dependencies: { database: "up", storage, mail },
      degraded_features: degraded,
    },
  };
}
