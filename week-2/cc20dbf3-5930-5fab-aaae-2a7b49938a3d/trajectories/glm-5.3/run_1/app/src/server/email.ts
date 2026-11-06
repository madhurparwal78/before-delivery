import { PoolClient } from "pg";
import { randomUuid } from "./config";

export type EmailTemplate =
  | { kind: "hold_ready"; itemName: string; unitLabel: string; pickupDeadline: string }
  | { kind: "hold_lapsed"; itemName: string; unitLabel: string; pickupDeadline: string }
  | { kind: "due_reminder"; itemName: string; unitLabel: string; dueAt: string }
  | { kind: "settlement_receipt"; itemName: string; unitLabel: string; lines: string[] };

export function emailFor(template: EmailTemplate): { subject: string; body: string } {
  switch (template.kind) {
    case "hold_ready":
      return {
        subject: `Ready for pickup: ${template.itemName}, unit ${template.unitLabel}`,
        body: `Pick up by ${template.pickupDeadline}.\n`,
      };
    case "hold_lapsed":
      return {
        subject: `Hold lapsed: ${template.itemName}, unit ${template.unitLabel}`,
        body: `Your pickup window closed at ${template.pickupDeadline}. The unit is back on the shelf for other members.\n`,
      };
    case "due_reminder":
      return {
        subject: `Due back ${template.dueAt}: ${template.itemName}, unit ${template.unitLabel}`,
        body: `Please return it by ${template.dueAt}, washed out and with batteries charged.\n`,
      };
    case "settlement_receipt":
      return {
        subject: `Settlement receipt: ${template.itemName}, unit ${template.unitLabel}`,
        body: `${template.lines.join("\n")}\n`,
      };
  }
}

export function queueEmail(
  client: PoolClient,
  toAddress: string,
  template: EmailTemplate,
): void {
  const { subject, body } = emailFor(template);
  client.query(
    "INSERT INTO email_outbox (id, to_address, subject, body) VALUES ($1, $2, $3, $4)",
    [randomUuid(), toAddress, subject, body],
  );
}

export async function queueEmailAwait(
  client: PoolClient,
  toAddress: string,
  template: EmailTemplate,
): Promise<void> {
  const { subject, body } = emailFor(template);
  await client.query(
    "INSERT INTO email_outbox (id, to_address, subject, body) VALUES ($1, $2, $3, $4)",
    [randomUuid(), toAddress, subject, body],
  );
}
