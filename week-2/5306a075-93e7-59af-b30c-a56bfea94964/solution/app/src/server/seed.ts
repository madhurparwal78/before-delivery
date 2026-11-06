// The brief's seed data (brief: Seed data), inserted once when the database holds no workspace.
// Bodies go through the allowlist and offsets through the plain-text rule like every other save.
import type { Importance, NoteSource, Role } from "../shared/api.js";
import type { FeatureStatus } from "../shared/lifecycles.js";
import type { Queryable } from "./db.js";
import { loadFeatures } from "./domain/features.js";
import { cleanBody } from "./domain/noteBody.js";
import { hashPassword } from "./http/auth.js";

const SEED_PASSWORD = "evidence-desk-2026";

interface FeatureSeed { name: string; description: string; status: FeatureStatus; effort: number; confidence: number; fits: number[]; parent?: string }
interface NoteSeed { key: string; title: string; source: NoteSource; contact: string; createdAt: string | null; body: string }
interface InsightSeed { note: string; quote: string; feature: string; importance: Importance }

interface WorkspaceSeed {
  name: string;
  timeZone: string;
  members: { name: string; email: string; role: Role }[];
  companies: { name: string; domain: string; contacts: { name: string; email: string }[] }[];
  objectives: { name: string; weight: number }[];
  product: string;
  components: { name: string; features: FeatureSeed[] }[];
  releases: { name: string; targetDate: string; isPublic: boolean; features: string[] }[];
  notes: NoteSeed[];
  insights: InsightSeed[];
}

const TALLYRUN: WorkspaceSeed = {
  name: "Tallyrun",
  timeZone: "America/New_York",
  members: [
    { name: "Rhea Okafor", email: "hop@tallyrun.example", role: "head_of_product" },
    { name: "Dev Malik", email: "pm@tallyrun.example", role: "product_manager" },
    { name: "Sasha Lind", email: "pm2@tallyrun.example", role: "product_manager" },
    { name: "Imani Brooks", email: "csm@tallyrun.example", role: "customer_success" },
  ],
  companies: [
    { name: "Northwind Freight", domain: "northwindfreight.example", contacts: [{ name: "Ana Ruiz", email: "ana@northwindfreight.example" }] },
    { name: "Northwind Freight Ltd", domain: "nwfreight.example", contacts: [{ name: "Lee Chen", email: "lee@nwfreight.example" }] },
    { name: "Orchard Lane Bank", domain: "orchardlanebank.example", contacts: [{ name: "Priya Nair", email: "priya@orchardlanebank.example" }] },
    { name: "Bluefin Clinics", domain: "bluefinclinics.example", contacts: [{ name: "Tom Becker", email: "tom@bluefinclinics.example" }] },
  ],
  objectives: [
    { name: "Win mid-market deals", weight: 50 },
    { name: "Reduce churn", weight: 30 },
    { name: "Cut support load", weight: 20 },
  ],
  product: "Tallyrun Platform",
  components: [
    {
      name: "Reporting",
      features: [
        { name: "Scheduled report emails", description: "Send any saved report to a list of recipients on a schedule.", status: "planned", effort: 5, confidence: 80, fits: [2, 3, 1] },
        { name: "CSV export presets", description: "Save column choices for repeat CSV exports.", status: "candidate", effort: 3, confidence: 60, fits: [1, 1, 2] },
      ],
    },
    {
      name: "Access",
      features: [
        { name: "SAML single sign-on", description: "Sign in with your identity provider over SAML.", status: "planned", effort: 8, confidence: 90, fits: [3, 1, 0] },
        { name: "Okta setup guide", description: "", status: "candidate", effort: 5, confidence: 50, fits: [0, 0, 0], parent: "SAML single sign-on" },
        { name: "Audit trail viewer", description: "See who changed what, filterable by user and date.", status: "planned", effort: 5, confidence: 50, fits: [2, 0, 1] },
        { name: "Bulk user import", description: "Add many users at once from a spreadsheet.", status: "planned", effort: 3, confidence: 70, fits: [1, 0, 2] },
      ],
    },
  ],
  releases: [
    { name: "March Drop", targetDate: "2027-03-15", isPublic: true, features: ["SAML single sign-on", "Scheduled report emails", "Bulk user import"] },
    { name: "Internal Tooling", targetDate: "2027-04-05", isPublic: false, features: [] },
    { name: "April Drop", targetDate: "2027-04-20", isPublic: true, features: ["Audit trail viewer"] },
  ],
  notes: [
    { key: "N1", title: "Weekly KPI pack", source: "support_ticket", contact: "ana@northwindfreight.example", createdAt: "2026-10-20T14:00:00Z",
      body: "<p>We export the KPI pack every Monday by hand. <strong>If reports could email themselves to the ops team</strong> we would stop asking for screenshots.</p>" },
    { key: "N2", title: "Renewal blocker: SSO", source: "sales_call", contact: "priya@orchardlanebank.example", createdAt: "2026-10-21T15:30:00Z",
      body: "<p>Security review blocks us until we have SAML single sign-on with Okta. This is a hard requirement for renewal.</p>" },
    { key: "N3", title: "Audit questions from clinic auditors", source: "email", contact: "tom@bluefinclinics.example", createdAt: "2026-10-22T13:00:00Z",
      body: "<p>Auditors keep asking who changed a patient-facing setting. We need an audit trail we can filter by user. We cut 100% of manual audit pulls last quarter.</p>" },
    { key: "N4", title: "Monday report for finance", source: "support_ticket", contact: "lee@nwfreight.example", createdAt: "2026-10-23T16:45:00Z",
      body: "<p>Our finance team wants the Monday report in their inbox automatically.</p>" },
    { key: "N5", title: "Forwarded renewal thread", source: "email", contact: "priya@orchardlanebank.example", createdAt: "2026-10-24T12:10:00Z",
      body: "<p>Forwarded from the renewal thread:</p><ul><li>Okta groups should map to roles</li><li>Export audit events weekly</li></ul>" },
    { key: "N6", title: "Clinic rota export", source: "support_ticket", contact: "tom@bluefinclinics.example", createdAt: "2026-10-25T09:00:00Z",
      body: "<p>Clinic managers rebuild the staff rota by hand each week. A rota download would save them an afternoon.</p>" },
    { key: "N7", title: "Dock scheduling feedback", source: "email", contact: "ana@northwindfreight.example", createdAt: "2026-10-25T09:00:00Z",
      body: "<p>Our dock team wants to book loading slots from the shipment list.</p>" },
  ],
  insights: [
    { note: "N2", quote: "SAML single sign-on with Okta", feature: "SAML single sign-on", importance: "critical" },
    { note: "N2", quote: "single sign-on with Okta. This is a hard requirement", feature: "Audit trail viewer", importance: "nice_to_have" },
    { note: "N4", quote: "wants the Monday report in their inbox automatically", feature: "Scheduled report emails", importance: "important" },
  ],
};

const QUARRY_LABS: WorkspaceSeed = {
  name: "Quarry Labs",
  timeZone: "Europe/Berlin",
  members: [
    { name: "Mara Voss", email: "hop@quarrylabs.example", role: "head_of_product" },
    { name: "Ollie Grant", email: "pm@quarrylabs.example", role: "product_manager" },
  ],
  companies: [{ name: "Saltmarsh Media", domain: "saltmarsh.example", contacts: [{ name: "Jo Park", email: "jo@saltmarsh.example" }] }],
  objectives: [{ name: "Grow enterprise", weight: 100 }],
  product: "Quarry Studio",
  components: [
    { name: "Exports", features: [{ name: "Audit log export", description: "Weekly audit log files", status: "planned", effort: 4, confidence: 70, fits: [3] }] },
  ],
  releases: [{ name: "Q2 Exports", targetDate: "2027-05-10", isPublic: true, features: ["Audit log export"] }],
  notes: [
    { key: "Q1", title: "Weekly audit files", source: "email", contact: "jo@saltmarsh.example", createdAt: null,
      body: "<p>We need the audit log export as CSV every week.</p>" },
  ],
  insights: [{ note: "Q1", quote: "audit log export as CSV every week", feature: "Audit log export", importance: "critical" }],
};

async function seedWorkspace(tx: Queryable, seed: WorkspaceSeed): Promise<void> {
  const one = async (sql: string, values: (string | number | boolean | null)[]): Promise<string> =>
    (await tx.query<{ id: string }>(sql, values))[0]?.id ?? "";
  const ws = await one("INSERT INTO workspaces (id, name, time_zone) VALUES (gen_id('w'), $1, $2) RETURNING id", [seed.name, seed.timeZone]);
  for (const m of seed.members) {
    await tx.query("INSERT INTO members (workspace_id, name, email, role, password_hash) VALUES ($1, $2, $3, $4, $5)", [ws, m.name, m.email, m.role, await hashPassword(SEED_PASSWORD)]);
  }
  const contacts = new Map<string, string>();
  for (const c of seed.companies) {
    const company = await one("INSERT INTO companies (workspace_id, name) VALUES ($1, $2) RETURNING id", [ws, c.name]);
    await tx.query("INSERT INTO company_domains (workspace_id, domain, company_id) VALUES ($1, $2, $3)", [ws, c.domain, company]);
    for (const person of c.contacts) {
      contacts.set(person.email, await one("INSERT INTO contacts (workspace_id, company_id, name, email) VALUES ($1, $2, $3, $4) RETURNING id", [ws, company, person.name, person.email]));
    }
  }
  const objectives: string[] = [];
  for (const o of seed.objectives) objectives.push(await one("INSERT INTO objectives (workspace_id, name, weight) VALUES ($1, $2, $3) RETURNING id", [ws, o.name, o.weight]));
  const product = await one("INSERT INTO products (workspace_id, name) VALUES ($1, $2) RETURNING id", [ws, seed.product]);
  const features = new Map<string, string>();
  for (const c of seed.components) {
    const component = await one("INSERT INTO components (workspace_id, product_id, name) VALUES ($1, $2, $3) RETURNING id", [ws, product, c.name]);
    for (const f of c.features) {
      const id = await one(
        `INSERT INTO features (workspace_id, component_id, parent_feature_id, name, public_description, status, effort, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [ws, component, f.parent ? features.get(f.parent) ?? null : null, f.name, f.description, f.status, f.effort, f.confidence],
      );
      features.set(f.name, id);
      for (const [i, level] of f.fits.entries()) {
        if (level > 0) await tx.query("INSERT INTO feature_fits (feature_id, objective_id, level) VALUES ($1, $2, $3)", [id, objectives[i] ?? "", level]);
      }
    }
  }
  for (const r of seed.releases) {
    const release = await one("INSERT INTO releases (workspace_id, name, target_date, is_public, status) VALUES ($1, $2, $3, $4, 'open') RETURNING id", [ws, r.name, r.targetDate, r.isPublic]);
    for (const [position, name] of r.features.entries()) {
      await tx.query("UPDATE features SET release_id = $2, position = $3 WHERE id = $1", [features.get(name) ?? "", release, position]);
    }
  }
  const notes = new Map<string, { id: string; text: string }>();
  for (const n of seed.notes) {
    const { body, text } = cleanBody(n.body);
    const id = await one(
      `INSERT INTO notes (workspace_id, title, body, text, source, status, contact_id, created_at)
       VALUES ($1, $2, $3, $4, $5, 'unprocessed', $6, coalesce($7::timestamptz, now_s())) RETURNING id`,
      [ws, n.title, body, text, n.source, contacts.get(n.contact) ?? null, n.createdAt],
    );
    notes.set(n.key, { id, text });
  }
  for (const i of seed.insights) {
    const note = notes.get(i.note) ?? { id: "", text: "" };
    const start = note.text.indexOf(i.quote);
    await tx.query(
      "INSERT INTO insights (workspace_id, note_id, feature_id, start_offset, end_offset, quote, importance) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [ws, note.id, features.get(i.feature) ?? "", start, start + i.quote.length, i.quote, i.importance],
    );
  }
  for (const summary of (await loadFeatures(tx, ws)).summaries.values()) {
    await tx.query(
      "INSERT INTO score_versions (feature_id, version, effort, confidence, fits, priority_cents, saved_by) VALUES ($1, 1, $2, $3, $4, $5, NULL)",
      [summary.id, summary.effort, summary.confidence, JSON.stringify(summary.fits), summary.priorityCents],
    );
  }
}

export async function seedIfEmpty(tx: Queryable): Promise<void> {
  if ((await tx.query("SELECT 1 FROM workspaces LIMIT 1")).length > 0) return;
  await seedWorkspace(tx, TALLYRUN);
  await seedWorkspace(tx, QUARRY_LABS);
  console.log("seeded Tallyrun and Quarry Labs");
}
