// Seed data, created idempotently at start when absent. Every person and
// business here is invented.

import type { Db } from "./db.js";
import { users, stepsRepo, edgesRepo, countersRepo, versionsRepo } from "./repo.js";
import { hashPassword } from "./auth.js";
import { workspaceNow } from "./clock.js";

export async function seed(db: Db): Promise<void> {
  const mark = "seed:v1";
  const existing = await db.query("SELECT value FROM clock_state WHERE key=$1", [mark]);
  if (existing.rows.length > 0) return;
  await db.query("INSERT INTO clock_state (key,value) VALUES ($1,'1') ON CONFLICT (key) DO NOTHING", [mark]);
  const again = await db.query("SELECT value FROM clock_state WHERE key=$1", [mark]);
  if (again.rows.length === 0) return;

  const pw = hashPassword("switchyard-demo-1");
  const mkUser = async (id: string, name: string, email: string): Promise<string> => {
    const exists = await users.byEmail(db, email);
    if (exists) return exists.id;
    await db.query("INSERT INTO users (id,email,name,password_hash,confirmed) VALUES ($1,$2,$3,$4,true)", [id, email, name, pw]);
    return id;
  };
  const imara = await mkUser("user-imara", "Imara Teague", "imara@fulfilment.example");
  const dov = await mkUser("user-dov", "Dov Marchetti", "dov@fulfilment.example");
  const wren = await mkUser("user-wren", "Wren Adeyemi", "wren@fulfilment.example");
  const soren = await mkUser("user-soren", "Soren Hale", "soren@harbor.example");

  const mkWs = async (id: string, name: string, slug: string): Promise<void> => {
    await db.query("INSERT INTO workspaces (id,name,slug) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING", [id, name, slug]);
  };
  await mkWs("ws-fulfilment", "Fulfilment Ops", "fulfilment-ops");
  await mkWs("ws-harbor", "Harbor Desk", "harbor-desk");

  const mkMember = async (uid: string, ws: string, role: string): Promise<void> => {
    await db.query("INSERT INTO members (user_id,workspace_id,role,joined_at) VALUES ($1,$2,$3,now()) ON CONFLICT (workspace_id,user_id) DO NOTHING", [uid, ws, role]);
  };
  await mkMember(imara, "ws-fulfilment", "owner");
  await mkMember(dov, "ws-fulfilment", "editor");
  await mkMember(wren, "ws-fulfilment", "viewer");
  await mkMember(soren, "ws-harbor", "owner");

  const mkTable = async (id: string, name: string, cols: { name: string; type: string }[], seq: number): Promise<void> => {
    await db.query("INSERT INTO tables_ (id,workspace_id,name,columns,seq) VALUES ($1,'ws-fulfilment',$2,$3::jsonb,$4) ON CONFLICT (id) DO NOTHING", [id, name, JSON.stringify(cols), seq]);
  };
  await mkTable("tb-orders", "Orders", [{ name: "customer", type: "text" }, { name: "item", type: "text" }, { name: "quantity", type: "number" }], 1);
  await mkTable("tb-followups", "Followups", [{ name: "customer", type: "text" }, { name: "position", type: "number" }], 2);
  const orders: [string, Record<string, unknown>][] = [
    ["r1", { customer: "Cobalt Studio", item: "Ribbon", quantity: 12 }],
    ["r2", { customer: "Harbor Bakery", item: "Tape", quantity: 40 }],
    ["r3", { customer: "Lumen Print", item: "Labels", quantity: 7 }],
  ];
  for (const [rid, values] of orders) {
    await db.query("INSERT INTO table_rows (table_id,row_id,seq,values) VALUES ('tb-orders',$1,$2,$3::jsonb) ON CONFLICT (table_id,row_id) DO NOTHING", [rid, Number(rid.slice(1)), JSON.stringify(values)]);
  }

  // Automation "Order intake" with version 1 live
  const aid = "au-order-intake";
  await db.query("INSERT INTO automations (id,workspace_id,name,trigger_kind,live_version,draft_revision) VALUES ($1,'ws-fulfilment',$2,'form',1,1) ON CONFLICT (id) DO NOTHING", [aid, "Order intake"]);
  const content = {
    trigger: {
      id: "trigger" as const, kind: "form", name: "Form trigger", col: 1, row: 2,
      fields: {
        path: "order-intake",
        form_fields: [
          { name: "customer", label: "Customer", type: "text" },
          { name: "item", label: "Item", type: "text" },
          { name: "quantity", label: "Quantity", type: "number" },
        ],
      },
      sample: { customer: "Cobalt Studio", item: "Ribbon", quantity: 12 },
    },
    steps: [
      { id: "s1", kind: "add_row", name: "Add row 1", col: 2, row: 2, fields: { table: "tb-orders", values: { customer: "{{trigger.customer}}", item: "{{trigger.item}}", quantity: "{{trigger.quantity}}" } } },
      { id: "s2", kind: "send_email", name: "Send email 1", col: 3, row: 2, fields: { to: "imara@fulfilment.example", subject: "New order from {{trigger.customer}}", body: "{{trigger.quantity}} x {{trigger.item}}" } },
    ],
    edges: [
      { id: "e1", from: "trigger", port: "out", to: "s1", order: 1 },
      { id: "e2", from: "s1", port: "out", to: "s2", order: 1 },
    ],
  };
  const now = await workspaceNow(db, "ws-fulfilment");
  await versionsRepo.put(db, aid, 1, 1, now, content);
  await stepsRepo.insert(db, aid, null, { ...content.trigger, seq: 1 } as never, content.trigger.sample);
  await stepsRepo.insert(db, aid, null, { ...content.steps[0], seq: 2 } as never);
  await stepsRepo.insert(db, aid, null, { ...content.steps[1], seq: 3 } as never);
  await stepsRepo.insert(db, aid, 1, { ...content.trigger, seq: 1 } as never, content.trigger.sample);
  await stepsRepo.insert(db, aid, 1, { ...content.steps[0], seq: 2 } as never);
  await stepsRepo.insert(db, aid, 1, { ...content.steps[1], seq: 3 } as never);
  await edgesRepo.insert(db, aid, null, content.edges[0]);
  await edgesRepo.insert(db, aid, null, content.edges[1]);
  await edgesRepo.insert(db, aid, 1, content.edges[0]);
  await edgesRepo.insert(db, aid, 1, content.edges[1]);
  await countersRepo.bumpStep(db, aid, "add_row");
  await countersRepo.bumpStep(db, aid, "send_email");

  // Automation "Harbor digest" (draft only)
  const aid2 = "au-harbor-digest";
  await db.query("INSERT INTO automations (id,workspace_id,name,trigger_kind,live_version,draft_revision) VALUES ($1,'ws-harbor',$2,'manual',NULL,1) ON CONFLICT (id) DO NOTHING", [aid2, "Harbor digest"]);
  await stepsRepo.insert(db, aid2, null, { id: "trigger", kind: "manual", name: "Manual trigger", col: 1, row: 2, fields: {}, seq: 1 } as never, {});
}
