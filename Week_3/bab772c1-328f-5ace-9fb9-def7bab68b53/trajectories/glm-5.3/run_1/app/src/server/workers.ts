// The outbox relay and the parse and webhook consumers. Every instance runs
// them; parse jobs and webhook sends reach the broker only through the outbox.

import * as amqp from "amqplib";
import type { Channel } from "./broker.js";

import {
  declareTopology,
  publishOutboxMessage,
  connectBroker,
  PARSE_FAILED,
  PARSE_QUEUE,
  WEBHOOKS_QUEUE,
} from "./broker.js";
import { db, withTransaction } from "./db.js";
import { epochMsToIso } from "../shared/format.js";
import { getCapture } from "./storage.js";
import { parseCapture } from "./parse.js";
import {
  sha256Hex,
  rejectionReasonText,
  transitionParserFailed,
  transitionSettled,
} from "./passLifecycle.js";
import { catchUpPendingWrites, recordPendingWrite } from "./searchWriter.js";
import { publishAlert } from "./push.js";
import { ensureApplication, createMessage } from "./webhooks.js";
import { upsertDocuments } from "./search.js";
import { retrySeconds } from "./deps.js";

class ParserFailureSignal extends Error {}

let connection: amqp.ChannelModel | null = null;
let channel: Channel | null = null;
let relayTimer: NodeJS.Timeout | null = null;
let catchUpTimer: NodeJS.Timeout | null = null;

export async function startWorkers(): Promise<void> {
  connectLoop();
  scheduleRelay();
  scheduleCatchUp();
}

export async function reconnectBroker(): Promise<void> {
  connection = null;
  channel = null;
  connectLoop();
}

function scheduleRelay(): void {
  if (relayTimer) return;
  const run = () => {
    connectLoop();
    void relayOutbox().catch((err) => {
      console.error("relay error", err);
    });
  };
  relayTimer = setInterval(run, retrySeconds() * 1000);
  relayTimer.unref?.();
  run();
}

function scheduleCatchUp(): void {
  if (catchUpTimer) return;
  const run = async () => {
    const client = await db().connect();
    try {
      const result = await catchUpPendingWrites(client);
      void result;
    } catch (err) {
      console.error("catch-up error", err);
    } finally {
      client.release();
    }
  };
  catchUpTimer = setInterval(() => {
    void run();
  }, retrySeconds() * 1000);
  catchUpTimer.unref?.();
  void run();
}

function connectLoop(): void {
  void (async () => {
    if (connection && channel) return;
    try {
      const connected = await connectBroker();
      const ch = await connected.createChannel();
      await declareTopology(ch);
      connection = connected;
      channel = ch;
      await startConsumers(ch);
      connected.on("close", () => {
        connection = null;
        channel = null;
      });
      connected.on("error", () => {
        // handled by close
      });
    } catch (err) {
      console.error("broker connect error", err);
      connection = null;
      channel = null;
    }
  })();
}

async function startConsumers(ch: Channel): Promise<void> {
  await ch.prefetch(1);
  await ch.consume(PARSE_QUEUE, (msg) => {
    if (msg === null) return;
    void handleParseMessage(ch, msg);
  }, { noAck: false });
  await ch.consume(PARSE_FAILED, (msg) => {
    if (msg === null) return;
    void handleFailedMessage(ch, msg);
  }, { noAck: false });
  await ch.consume(WEBHOOKS_QUEUE, (msg) => {
    if (msg === null) return;
    void handleWebhookMessage(ch, msg);
  }, { noAck: false });
}

interface OutboxRow {
  id: string;
  kind: string;
  pass_id: string | null;
  event_id: string | null;
  payload: unknown;
  delivered_at: string | null;
}

// Publish outbox rows with null sent_at, oldest first.
export async function relayOutbox(): Promise<void> {
  if (!channel) return;
  const rows = await db().query<OutboxRow>(
    `SELECT id, kind, pass_id, event_id, payload, delivered_at FROM outbox
     WHERE sent_at IS NULL ORDER BY created_at LIMIT 200`,
  );
  for (const row of rows.rows) {
    if (row.kind === "webhook.send" && row.delivered_at !== null) {
      await db().query("UPDATE outbox SET sent_at = $2 WHERE id = $1", [
        row.id,
        epochMsToIso(Date.now()),
      ]);
      continue;
    }
    const published = publishOutboxMessage(channel, {
      id: row.id,
      kind: row.kind,
      pass_id: row.pass_id,
      event_id: row.event_id,
      payload: row.payload,
    });
    if (published) {
      // Confirm handled per message; a publish confirm wait is approximated by
      // the durable publish returning.
      await db().query("UPDATE outbox SET sent_at = $2 WHERE id = $1", [
        row.id,
        epochMsToIso(Date.now()),
      ]);
      void row.payload;
    }
  }
}

async function handleParseMessage(ch: Channel, msg: amqp.Message): Promise<void> {
  let body: { pass_id?: string };
  try {
    body = JSON.parse(msg.content.toString("utf8")) as { pass_id?: string };
  } catch {
    ch.ack(msg);
    return;
  }
  const passId = body.pass_id;
  if (!passId) {
    ch.ack(msg);
    return;
  }
  let result: "ack" | "requeue" | "ackWithReset" | null = null;
  try {
    result = await processParse(passId);
  } catch (err) {
    console.error("parse handler error", err);
    if (err instanceof ParserFailureSignal) {
      ch.reject(msg, true);
      return;
    }
    result = null;
  }
  if (result === "ack") {
    ch.ack(msg);
    return;
  }
  if (result === "ackWithReset") {
    // Storage was unreachable: acknowledge and clear sent_at so the relay
    // publishes the job again with a fresh delivery count.
    ch.ack(msg);
    await db()
      .query("UPDATE outbox SET sent_at = NULL WHERE kind = 'pass.parse' AND pass_id = $1", [passId])
      .catch(() => undefined);
    return;
  }
  ch.reject(msg, true);
}

async function processParse(passId: string): Promise<"ack" | "requeue" | "ackWithReset"> {
  const pool = db();
  const passRow = await pool.query(
    `SELECT id, mission_id, filename, state, size_bytes, sha256 FROM passes WHERE id = $1 AND deleted = FALSE`,
    [passId],
  );
  if (passRow.rows.length === 0 || passRow.rows[0].state !== "stored") {
    return "ack";
  }
  const pass = passRow.rows[0];
  let bytes: Buffer;
  try {
    bytes = await getCapture(pass.mission_id, passId);
  } catch {
    // Storage unreachable: neither a parser failure nor a line rejection.
    return "ackWithReset";
  }
  if (sha256Hex(bytes) !== pass.sha256) {
    // Object corrupted; treat as storage unreachable for retry purposes.
    return "ackWithReset";
  }
  let parsed;
  try {
    parsed = parseCapture(bytes);
  } catch {
    // Unexpected parser error: redeliver until the delivery limit dead-letters.
    throw new ParserFailureSignal();
  }
  if (parsed.outcome === "parsed") {
    const passInfo = {
      id: passId as string,
      missionId: pass.mission_id as string,
      filename: pass.filename as string,
      sha256: pass.sha256 as string,
      sizeBytes: Number(pass.size_bytes),
    };
    const settle = await withTransaction(async (client) => {
      return transitionSettled(client, passInfo, parsed.samples, parsed.lines, null, false);
    });
    // Index the lines after commit.
    try {
      const documents = await buildLineDocuments(passId, pass.mission_id);
      const outcome = await upsertDocuments(documents);
      if (!outcome.confirmed) {
        await recordPendingForLines(passId);
      }
    } catch {
      await recordPendingForLines(passId);
    }
    void settle;
    await publishAlert({
      missionId: pass.mission_id,
      missionName: await missionNameOf(pass.mission_id),
      filename: pass.filename,
      outcome: "parsed",
      samples: settle.sampleCount,
      lines: settle.lineCount,
      rejectedLine: null,
      reasonText: "",
      firstSampleMet: await firstSampleMet(passId),
    });
    return "ack";
  }
  const rejection = parsed;
  const passInfo = {
    id: passId as string,
    missionId: pass.mission_id as string,
    filename: pass.filename as string,
    sha256: pass.sha256 as string,
    sizeBytes: Number(pass.size_bytes),
  };
  const settle = await withTransaction(async (client) => {
    return transitionSettled(client, passInfo, [], [], { line: rejection.line, reason: rejection.reason }, true);
  });
  await publishAlert({
    missionId: pass.mission_id,
    missionName: await missionNameOf(pass.mission_id),
    filename: pass.filename,
    outcome: "rejected",
    samples: 0,
    lines: 0,
    rejectedLine: rejection.line,
    reasonText: rejectionReasonText(rejection.reason),
    firstSampleMet: null,
  });
  void settle;
  return "ack";
}

async function missionNameOf(missionId: string): Promise<string> {
  const result = await db().query<{ name: string }>("SELECT name FROM missions WHERE id = $1", [
    missionId,
  ]);
  return result.rows.length > 0 ? result.rows[0].name : "";
}

async function firstSampleMet(passId: string): Promise<number | null> {
  const result = await db().query<{ met: string }>(
    "SELECT met FROM samples WHERE pass_id = $1 ORDER BY met ASC LIMIT 1",
    [passId],
  );
  return result.rows.length > 0 ? Number(result.rows[0].met) : null;
}

async function recordPendingForLines(passId: string): Promise<void> {
  await withTransaction(async (txClient) => {
    const rows = await txClient.query(
      "SELECT id, mission_id, met, speaker, text FROM transcript_lines WHERE pass_id = $1",
      [passId],
    );
    for (const row of rows.rows) {
      await recordPendingWrite(txClient, row.mission_id, "line", row.id, {
        pass_id: passId,
        met: Number(row.met),
        speaker: row.speaker,
        text: row.text,
      });
    }
  });
}

async function buildLineDocuments(
  passId: string,
  missionId: string,
): Promise<import("./search.js").SearchDocument[]> {
  const rows = await db().query(
    "SELECT id, met, speaker, text FROM transcript_lines WHERE pass_id = $1",
    [passId],
  );
  return rows.rows.map((row) => ({
    id: `line-${row.id}`,
    mission_id: missionId,
    pass_id: passId,
    kind: "line" as const,
    met: Number(row.met),
    speaker: row.speaker,
    text: row.text,
  }));
}

async function handleFailedMessage(ch: Channel, msg: amqp.Message): Promise<void> {
  try {
    const body = JSON.parse(msg.content.toString("utf8")) as { pass_id?: string };
    const passId = body.pass_id;
    if (passId) {
      const passRow = await db().query(
        "SELECT id, mission_id, filename, sha256, size_bytes, state FROM passes WHERE id = $1 AND deleted = FALSE",
        [passId],
      );
      if (passRow.rows.length > 0 && passRow.rows[0].state === "stored") {
        const pass = passRow.rows[0];
        await withTransaction(async (client) => {
          await transitionParserFailed(client, {
            id: passId,
            missionId: pass.mission_id,
            filename: pass.filename,
            sha256: pass.sha256,
            sizeBytes: Number(pass.size_bytes),
          });
        });
        await publishAlert({
          missionId: pass.mission_id,
          missionName: await missionNameOf(pass.mission_id),
          filename: pass.filename,
          outcome: "rejected",
          samples: 0,
          lines: 0,
          rejectedLine: null,
          reasonText: rejectionReasonText("parser_failed"),
          firstSampleMet: null,
        });
      }
    }
    ch.ack(msg);
  } catch {
    ch.ack(msg);
  }
}

async function handleWebhookMessage(ch: Channel, msg: amqp.Message): Promise<void> {
  let body: { event_id?: string };
  try {
    body = JSON.parse(msg.content.toString("utf8")) as { event_id?: string };
  } catch {
    ch.ack(msg);
    return;
  }
  const eventId = body.event_id;
  if (!eventId) {
    ch.ack(msg);
    return;
  }
  const rows = await db().query<OutboxRow>(
    "SELECT id, payload, delivered_at FROM outbox WHERE event_id = $1 AND kind = 'webhook.send'",
    [eventId],
  );
  if (rows.rows.length === 0) {
    ch.ack(msg);
    return;
  }
  const row = rows.rows[0];
  if (row.delivered_at !== null) {
    ch.ack(msg);
    return;
  }
  const payload = row.payload as { type: string; mission_id: string };
  try {
    // The application is fetched or created before every message call.
    const missionName = await missionNameOf(payload.mission_id);
    await ensureApplication(payload.mission_id, missionName);
    const outcome = await createMessage(
      payload.mission_id,
      payload.type as never,
      eventId,
      payload,
    );
    if (outcome === "sent" || outcome === "duplicate") {
      await db().query("UPDATE outbox SET delivered_at = $2 WHERE id = $1", [
        row.id,
        epochMsToIso(Date.now()),
      ]);
      ch.ack(msg);
      return;
    }
    ch.ack(msg);
    await db().query("UPDATE outbox SET sent_at = NULL WHERE id = $1", [row.id]);
  } catch (err) {
    console.error("webhook send error", err instanceof Error ? err.message : err);
    ch.ack(msg);
    await db().query("UPDATE outbox SET sent_at = NULL WHERE id = $1", [row.id]);
  }
}

export function signalRelay(): void {
  void relayOutbox();
}
