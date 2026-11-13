/** The queue consumers: manual acknowledgement after the work commits. */

import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { DependencyDown } from "./errors.js";
import {
  deadLetterParseJob,
  ensureBroker,
  PARSE_DELIVERY_LIMIT,
  PARSE_FAILED_QUEUE,
  PARSE_QUEUE,
  registerConsumer,
  WEBHOOK_QUEUE,
} from "./services/broker.js";
import { sendMessage, type WebhookEventType } from "./services/webhooks.js";
import { runParseJob } from "./domain/parseJob.js";
import { markParserFailed, recordParserFailure } from "./domain/passes.js";
import { ParserFailure } from "./domain/captureFormat.js";
import { resetOutboxRow } from "./domain/outbox.js";
import { findMissionRow, findPassRow } from "./domain/missionRead.js";
import { sendParseAlert } from "./domain/alerts.js";

type ParseMessage = { pass_id?: string; sha256?: string };
type WebhookMessageBody = { event_id?: string };

const REDELIVERY_PAUSE_MS = 400;

export function startConsumers(): void {
  registerConsumer(PARSE_QUEUE, async (message, channel) => {
    const body = JSON.parse(message.content.toString("utf8")) as ParseMessage;
    if (!body.pass_id) {
      channel.ack(message);
      return;
    }
    try {
      const result = await runParseJob(body.pass_id);
      if (result === "storage_down") {
        await resetOutboxRow({ passId: body.pass_id });
      }
      channel.ack(message);
    } catch (error) {
      if (!(error instanceof ParserFailure)) {
        process.stderr.write(`parse job failed: ${String(error)}\n`);
      }
      const attempts = await recordParserFailure(body.pass_id);
      if (attempts >= PARSE_DELIVERY_LIMIT) {
        await deadLetterParseJob(body.pass_id, body.sha256 ?? "");
        channel.ack(message);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, REDELIVERY_PAUSE_MS));
      channel.nack(message, false, true);
    }
  });

  registerConsumer(PARSE_FAILED_QUEUE, async (message, channel) => {
    const body = JSON.parse(message.content.toString("utf8")) as ParseMessage;
    if (!body.pass_id) {
      channel.ack(message);
      return;
    }
    const pass = await findPassRow(pool, body.pass_id);
    const settled = await markParserFailed(body.pass_id);
    if (settled && pass && !pass.is_seed) {
      const mission = await findMissionRow(pool, pass.mission_id);
      if (mission) {
        await sendParseAlert(mission, pass, {
          kind: "rejected",
          line: null,
          reason: "parser_failed",
        });
      }
    }
    channel.ack(message);
  });

  registerConsumer(WEBHOOK_QUEUE, async (message, channel) => {
    const body = JSON.parse(message.content.toString("utf8")) as WebhookMessageBody;
    if (!body.event_id) {
      channel.ack(message);
      return;
    }
    const row = await pool.query<{
      id: string;
      delivered_at: Date | null;
      payload: { type: WebhookEventType; mission_id: string } & Record<string, unknown>;
    }>("select id, delivered_at, payload from outbox where kind = 'webhook.send' and event_id = $1", [
      body.event_id,
    ]);
    const outbox = row.rows[0];
    if (!outbox || outbox.delivered_at !== null) {
      channel.ack(message);
      return;
    }
    const mission = await findMissionRow(pool, outbox.payload.mission_id);
    if (!mission) {
      channel.ack(message);
      return;
    }
    try {
      await sendMessage(mission.id, mission.name, {
        eventType: outbox.payload.type,
        eventId: body.event_id,
        payload: outbox.payload,
      });
      await pool.query("update outbox set delivered_at = now() where id = $1", [outbox.id]);
      channel.ack(message);
    } catch (error) {
      if (error instanceof DependencyDown) {
        await resetOutboxRow({ eventId: body.event_id });
        channel.ack(message);
        return;
      }
      channel.nack(message, false, true);
    }
  });

  const retry = (): void => {
    void ensureBroker().catch(() => undefined);
  };
  setInterval(retry, config.dependencyRetrySeconds * 1000).unref();
  retry();
}
