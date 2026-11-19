import { now } from "./clock.js";
import type { Tx } from "./db.js";
import { publishTo } from "./live.js";
import { configList } from "./store.js";

export interface InboxRule {
  name?: string;
  event: string;
  roles: string[];
  enabled: boolean;
}

const ALWAYS_IMMEDIATE = ["page", "page_exhausted", "sla_breach"];

async function loadInboxRules(tx: Tx): Promise<InboxRule[]> {
  return (await configList<InboxRule>("inbox_rule", "live", tx)).map((r) => r.content);
}

function enabledFor(rules: InboxRule[], event: string, roles: string[]): boolean {
  return !rules.some((r) => r.event === event && !r.enabled && r.roles.some((role) => roles.includes(role)));
}

/** The stored name of a rule that was given none: event, roles and switch, numbered when an earlier rule already has that name. */
export function inboxRuleName(rule: { event: string; roles: string[]; enabled: boolean }, taken: ReadonlySet<string>): string {
  const base = `${rule.event} (${rule.roles.join(", ")}) ${rule.enabled ? "on" : "off"}`;
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} #${n}`;
  return name;
}

/** Puts an item in each recipient's inbox, following the inbox rules and each person's digest setting. */
export async function deliver(tx: Tx, event: string, recipients: Array<string | null | undefined>, text: string, record: string | null = null): Promise<void> {
  const names = [...new Set(recipients.filter((r): r is string => typeof r === "string" && r !== ""))];
  if (names.length === 0) return;
  const rules = await loadInboxRules(tx);
  const users = await tx.query("SELECT username, roles, digest FROM users WHERE username = ANY($1)", [names]);
  const at = new Date(now()).toISOString();
  for (const user of users) {
    const username = user.username as string;
    if (!enabledFor(rules, event, user.roles as string[])) continue;
    const delivered = ALWAYS_IMMEDIATE.includes(event) || user.digest !== "daily";
    await tx.query("INSERT INTO inbox (username, event, text, record, at, delivered) VALUES ($1, $2, $3, $4, $5, $6)", [username, event, text, record, at, delivered]);
    if (delivered) tx.after.push(() => publishTo(username, "inbox", "item", { event, record }));
  }
}
