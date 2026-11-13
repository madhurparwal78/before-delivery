// The seed data present at every boot, applied idempotently.
import { hashPassword } from "./auth";
import { seedWorld, type SeedSpec } from "./seed";

const DEMO_PASSWORD = "spoorline-demo-1";
const SEED_KEY = "spk_5eedc0de5eedc0de5eedc0de5eedc0de";

const WEB_EVENTS: Array<[string, string, string, string, number, number, string]> = [
  ["e-001", "2026-02-28T23:46:10.000Z", "host-3", "info", 200, 41, "GET /cart served"],
  ["e-002", "2026-02-28T23:48:30.000Z", "host-7", "error", 500, 912, "payment gateway timeout"],
  ["e-003", "2026-02-28T23:50:05.000Z", "host-7", "error", 503, 1204, "gateway timeout, timeout again"],
  ["e-004", "2026-02-28T23:51:40.000Z", "host-2", "warn", 200, 388, "retry scheduled"],
  ["e-005", "2026-02-28T23:53:15.000Z", "host-7", "error", 500, 77, "disk full on node-7"],
  ["e-006", "2026-02-28T23:55:00.000Z", "host-3", "info", 200, 35, "GET /search served"],
  ["e-007", "2026-02-28T23:57:20.000Z", "host-2", "info", 200, 52, "GET /cart served"],
  ["e-008", "2026-02-28T23:59:45.000Z", "host-7", "error", 502, 640, "upstream reset by peer"],
];

const PAY_EVENTS: Array<[string, string, string, string, string]> = [
  ["h-001", "2026-02-28T23:40:00.000Z", "dock-1", "info", "refund queued"],
  ["h-002", "2026-02-28T23:50:00.000Z", "dock-1", "error", "ledger write failed"],
  ["h-003", "2026-02-28T23:58:00.000Z", "dock-2", "info", "refund sent"],
];

const hot = (events: Array<Record<string, unknown>>) => [{ number: 1, phase: "hot", created_at: "2026-02-28T00:00:00.000Z", rolled_over_at: null, events }];

export async function applyStartSeed(): Promise<void> {
  const spec: SeedSpec = {
    users: [
      { username: "ines", password: DEMO_PASSWORD, time_zone: "UTC" },
      { username: "tomas", password: DEMO_PASSWORD, time_zone: "America/New_York" },
      { username: "ruth", password: DEMO_PASSWORD, time_zone: "UTC" },
      { username: "wren", password: DEMO_PASSWORD, time_zone: "UTC" },
    ],
    spaces: [
      { slug: "ops", name: "Ops", members: [{ username: "ines", role: "admin" }, { username: "tomas", role: "editor" }, { username: "ruth", role: "viewer" }] },
      { slug: "harbor", name: "Harbor", members: [{ username: "wren", role: "admin" }] },
    ],
    keys: [{ space: "ops", name: "edge-shipper", stream_pattern: "web*", actions: ["upload"], expires_in_days: null, key: SEED_KEY }],
    pipelines: [{
      space: "ops", name: "web-clean",
      processors: [{ type: "redact", field: "message", pattern: "ipv4" }, { type: "set", field: "env", value: "prod" }],
    }],
    streams: [
      {
        space: "ops", name: "web", mappings: { host: "keyword", level: "keyword", service: "keyword" },
        generations: hot(WEB_EVENTS.map(([id, at, host, level, status, latency, message]) => ({ _id: id, "@timestamp": at, host, level, service: "web", status, latency, message }))),
      },
      {
        space: "harbor", name: "pay", mappings: {},
        generations: hot(PAY_EVENTS.map(([id, at, host, level, message]) => ({ _id: id, "@timestamp": at, host, level, message }))),
      },
    ],
  };
  const hash = await hashPassword(DEMO_PASSWORD);
  await seedWorld(spec, "ensure", [hash, hash, hash, hash]);
}
