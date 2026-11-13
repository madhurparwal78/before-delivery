import { db } from "../db.js";
import { mailState } from "./mail.js";

export { valkeyState } from "./valkey.js";
export { minioState } from "./minio.js";
export { mailState } from "./mail.js";

let lastProbe = 0;

/** Mail availability, probed without sending: connect and read the greeting. */
export async function probeMail(): Promise<boolean> {
  if (Date.now() - lastProbe < 5000) return mailState.available;
  lastProbe = Date.now();
  const available = await connectProbe();
  mailState.available = available;
  return available;
}

async function connectProbe(): Promise<boolean> {
  const { config } = await import("../config.js");
  const net = await import("node:net");
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: config.smtpHost, port: config.smtpPort });
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(3000);
    socket.on("data", () => done(true));
    socket.on("error", () => done(false));
    socket.on("timeout", () => done(false));
    socket.on("close", () => resolve(mailState.available));
  });
}

export async function postgresAvailable(): Promise<boolean> {
  try {
    await db.all(`select 1`);
    return true;
  } catch {
    return false;
  }
}
