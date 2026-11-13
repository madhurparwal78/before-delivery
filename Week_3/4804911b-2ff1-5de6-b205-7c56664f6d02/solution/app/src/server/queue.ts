import amqplib, { type Channel, type ConfirmChannel, type Connection, type ConsumeMessage } from "amqplib";
import { config } from "./config.js";
import { db } from "./db.js";
import { runSend } from "./deliveries.js";
import { copyId } from "./meta.js";
import { syncIndex } from "./meili.js";
import { runRender } from "./render.js";
import { providers } from "./status.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
  });
  return Promise.race([work, clock]).finally(() => clearTimeout(timer));
}

function connectOptions(): amqplib.Options.Connect {
  const url = new URL(config.amqpUrl);
  if (url.protocol !== "amqp:" && url.protocol !== "amqps:") throw new Error("AMQP_URL is not an amqp address");
  const [host, port] = config.amqpConnectAddress ? config.amqpConnectAddress.split(":") : [url.hostname, url.port];
  return {
    protocol: url.protocol.slice(0, -1), hostname: host!, port: Number(port) || 5672, username: decodeURIComponent(url.username || "guest"),
    password: decodeURIComponent(url.password || "guest"), vhost: decodeURIComponent(url.pathname.slice(1)) || "/", heartbeat: 4, frameMax: 131072,
  };
}

async function connect(): Promise<Connection> {
  const attempt = amqplib.connect(connectOptions());
  try {
    return await within(attempt, 5000, "broker connection");
  } catch (error) {
    void attempt.then((late) => late.close()).catch(() => undefined);
    throw error;
  }
}

type Parsed =
  | { kind: "render"; number: string; version: number }
  | { kind: "index"; skuCode: string }
  | { kind: "send"; eventId: string };

function parse(content: Buffer): Parsed | null {
  let job: Record<string, unknown>;
  try {
    job = JSON.parse(content.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!job || typeof job !== "object") return null;
  if (job.kind === "render" && typeof job.number === "string" && Number.isInteger(job.version)) return { kind: "render", number: job.number, version: job.version as number };
  if (job.kind === "index" && typeof job.skuCode === "string") return { kind: "index", skuCode: job.skuCode };
  if (job.kind === "send" && typeof job.eventId === "string") return { kind: "send", eventId: job.eventId };
  return null;
}

async function isBroken(job: Parsed): Promise<boolean> {
  if (job.kind === "render") return (await runRender(job.number, job.version)) === "missing";
  if (job.kind === "send") return (await runSend(job.eventId)) === "missing";
  if ((await db.query("SELECT 1 FROM skus WHERE code = $1", [job.skuCode])).rows.length === 0) return true;
  await syncIndex().catch(() => undefined);
  return false;
}

function publishConfirmed(channel: ConfirmChannel, queue: string, content: Buffer): Promise<void> {
  return within(
    new Promise<void>((resolve, reject) => {
      channel.sendToQueue(queue, content, { persistent: true, contentType: "application/json" }, (err) => (err ? reject(err) : resolve()));
    }),
    5000,
    "publish confirm",
  );
}

async function session(connection: Connection): Promise<void> {
  const copy = await copyId();
  const work = `interval.${copy}.work`;
  const dead = `interval.${copy}.dead`;
  const closed = new Promise<void>((resolve) => {
    connection.on("close", () => resolve());
    connection.on("error", () => resolve());
  });
  const relay = await within(connection.createConfirmChannel(), 5000, "relay channel");
  const consumer = await within(connection.createConfirmChannel(), 5000, "consumer channel");
  for (const ch of [relay, consumer]) ch.on("error", () => undefined);
  for (const q of [work, dead]) await within(relay.assertQueue(q, { durable: true }), 5000, "queue declare");
  await consumer.prefetch(6);

  const setAside = async (msg: ConsumeMessage): Promise<void> => {
    await publishConfirmed(consumer, dead, msg.content);
    await db.query("UPDATE meta SET value = (value::bigint + 1)::text WHERE key = 'held_work'");
    consumer.ack(msg);
  };
  await consumer.consume(work, (msg) => {
    if (!msg) return;
    void (async () => {
      try {
        const job = parse(msg.content);
        if (!job || (await isBroken(job))) await setAside(msg);
        else consumer.ack(msg);
      } catch {
        // a failure here is ours (database, broker), never the job's: put it back for later
        await sleep(2000);
        try {
          consumer.nack(msg, false, true);
        } catch {
          // the channel is gone; the broker redelivers on its own
        }
      }
    })();
  });
  providers.broker = true;

  const ticker = (async () => {
    while (!(await Promise.race([closed.then(() => true), sleep(250).then(() => false)]))) {
      const batch = (await db.query("SELECT id, job FROM outbox WHERE NOT published ORDER BY id LIMIT 100")).rows;
      if (batch.length === 0) continue;
      for (const row of batch) await publishConfirmed(relay, work, Buffer.from(JSON.stringify(row.job)));
      await db.query("UPDATE outbox SET published = true WHERE id = ANY($1)", [batch.map((r) => r.id)]);
      providers.broker = true;
    }
  })();
  await Promise.race([closed, ticker.catch(() => undefined)]);
  for (const ch of [relay, consumer] as Channel[]) ch.removeAllListeners();
}

/** Keeps one connection to the broker alive: relay from the outbox, consume the work queue, reconnect with no restart. */
export async function runBroker(): Promise<void> {
  for (;;) {
    let connection: Connection | null = null;
    try {
      connection = await connect();
      await session(connection);
    } catch {
      // unreachable, hanging or refused: the next loop tries again
    }
    providers.broker = false;
    await connection?.close().catch(() => undefined);
    await sleep(1500);
  }
}
