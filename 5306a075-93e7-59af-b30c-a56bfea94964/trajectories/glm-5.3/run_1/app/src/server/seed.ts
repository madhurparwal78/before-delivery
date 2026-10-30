import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { allowlistBody, bodyToText, plainTextToBody } from "./body.js";
import { computeObjectiveFit, computePriority, round2 } from "../shared/ranking.js";

const SEED_PASSWORD = "evidence-desk-2026";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

type ImportanceSeed = "nice_to_have" | "important" | "critical";

const IMPORTANCE_POINTS: Record<ImportanceSeed, number> = {
  nice_to_have: 1,
  important: 3,
  critical: 5,
};

/** Insert the seed when the database has no workspaces. */
export async function seedIfEmpty(pool: Pool): Promise<void> {
  const check = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM workspaces");
  if ((check.rows[0]?.count ?? "0") !== "0") return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ---------- Tallyrun ----------
    const tallyrunId = randomUUID();
    await client.query(
      "INSERT INTO workspaces (id, name, time_zone) VALUES ($1, $2, $3)",
      [tallyrunId, "Tallyrun", "America/New_York"],
    );

    const passwordHash = hashPassword(SEED_PASSWORD);
    for (const [name, email, role] of [
      ["Rhea Okafor", "hop@tallyrun.example", "head_of_product"],
      ["Dev Malik", "pm@tallyrun.example", "product_manager"],
      ["Sasha Lind", "pm2@tallyrun.example", "product_manager"],
      ["Imani Brooks", "csm@tallyrun.example", "customer_success"],
    ] as const) {
      await client.query(
        "INSERT INTO members (id, workspace_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5,$6)",
        [randomUUID(), tallyrunId, name, email, passwordHash, role],
      );
    }

    const companyIds: Record<string, string> = {};
    for (const [key, name, domain] of [
      ["northwind", "Northwind Freight", "northwindfreight.example"],
      ["nwfreight", "Northwind Freight Ltd", "nwfreight.example"],
      ["orchard", "Orchard Lane Bank", "orchardlanebank.example"],
      ["bluefin", "Bluefin Clinics", "bluefinclinics.example"],
    ] as const) {
      const id = randomUUID();
      companyIds[key] = id;
      await client.query(
        "INSERT INTO companies (id, workspace_id, name) VALUES ($1,$2,$3)",
        [id, tallyrunId, name],
      );
      await client.query(
        "INSERT INTO company_domains (company_id, workspace_id, domain) VALUES ($1,$2,$3)",
        [id, tallyrunId, domain],
      );
    }

    const contactIds: Record<string, string> = {};
    for (const [email, companyKey, name] of [
      ["ana@northwindfreight.example", "northwind", "Ana Ruiz"],
      ["lee@nwfreight.example", "nwfreight", "Lee Chen"],
      ["priya@orchardlanebank.example", "orchard", "Priya Nair"],
      ["tom@bluefinclinics.example", "bluefin", "Tom Becker"],
    ] as const) {
      const id = randomUUID();
      contactIds[email] = id;
      await client.query(
        "INSERT INTO contacts (id, workspace_id, company_id, name, email) VALUES ($1,$2,$3,$4,$5)",
        [id, tallyrunId, companyIds[companyKey]!, name, email],
      );
    }

    const objectiveRows: Array<[string, number, string]> = [
      ["Win mid-market deals", 50, randomUUID()],
      ["Reduce churn", 30, randomUUID()],
      ["Cut support load", 20, randomUUID()],
    ];
    const objectiveIdByName: Record<string, string> = {};
    for (let i = 0; i < objectiveRows.length; i++) {
      const [name, weight, id] = objectiveRows[i]!;
      objectiveIdByName[name] = id;
      await client.query(
        "INSERT INTO objectives (id, workspace_id, name, weight, position) VALUES ($1,$2,$3,$4,$5)",
        [id, tallyrunId, name, weight, i],
      );
    }
    const objectiveWeights = objectiveRows.map(([name, weight]) => ({
      id: objectiveIdByName[name]!,
      weight,
    }));

    const productId = randomUUID();
    await client.query(
      "INSERT INTO products (id, workspace_id, name, position) VALUES ($1,$2,$3,0)",
      [productId, tallyrunId, "Tallyrun Platform"],
    );

    const componentIds: Record<string, string> = {};
    for (const [name, position] of [["Reporting", 0], ["Access", 1]] as const) {
      const id = randomUUID();
      componentIds[name] = id;
      await client.query(
        "INSERT INTO components (id, workspace_id, product_id, name, position) VALUES ($1,$2,$3,$4,$5)",
        [id, tallyrunId, productId, name, position],
      );
    }

    // Reporting: Scheduled report emails, CSV export presets.
    // Access: SAML single sign-on, Audit trail viewer, Bulk user import.
    const featureSeeds = [
      {
        key: "scheduled",
        name: "Scheduled report emails",
        description: "Send any saved report to a list of recipients on a schedule.",
        component: "Reporting",
        status: "planned" as const,
        effort: 5,
        confidence: 80,
        fits: { "Win mid-market deals": 2, "Reduce churn": 3, "Cut support load": 1 },
      },
      {
        key: "csvpresets",
        name: "CSV export presets",
        description: "Save column choices for repeat CSV exports.",
        component: "Reporting",
        status: "candidate" as const,
        effort: 3,
        confidence: 60,
        fits: { "Win mid-market deals": 1, "Reduce churn": 1, "Cut support load": 2 },
      },
      {
        key: "saml",
        name: "SAML single sign-on",
        description: "Sign in with your identity provider over SAML.",
        component: "Access",
        status: "planned" as const,
        effort: 8,
        confidence: 90,
        fits: { "Win mid-market deals": 3, "Reduce churn": 1, "Cut support load": 0 },
      },
      {
        key: "audit",
        name: "Audit trail viewer",
        description: "See who changed what, filterable by user and date.",
        component: "Access",
        status: "planned" as const,
        effort: 5,
        confidence: 50,
        fits: { "Win mid-market deals": 2, "Reduce churn": 0, "Cut support load": 1 },
      },
      {
        key: "bulk",
        name: "Bulk user import",
        description: "Add many users at once from a spreadsheet.",
        component: "Access",
        status: "planned" as const,
        effort: 3,
        confidence: 70,
        fits: { "Win mid-market deals": 1, "Reduce churn": 0, "Cut support load": 2 },
      },
    ];

    const featureIds: Record<string, string> = {};
    const fitsByFeature: Record<string, Record<string, number>> = {};
    for (const f of featureSeeds) {
      const id = randomUUID();
      featureIds[f.key] = id;
      // Fits are keyed by objective id throughout the app.
      const fits: Record<string, number> = {};
      for (const [objectiveName, level] of Object.entries(f.fits)) {
        fits[objectiveIdByName[objectiveName]!] = level;
      }
      fitsByFeature[f.key] = fits;
      await client.query(
        `INSERT INTO features (id, workspace_id, component_id, name, public_description,
           status, effort, confidence, fits, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)`,
        [
          id,
          tallyrunId,
          componentIds[f.component]!,
          f.name,
          f.description,
          f.status,
          f.effort,
          f.confidence,
          JSON.stringify(fits),
        ],
      );
    }

    await client.query(
      `INSERT INTO features (id, workspace_id, component_id, parent_feature_id, name,
         public_description, status, effort, confidence, fits, version)
       VALUES ($1,$2,$3,$4,'Okta setup guide','','candidate',5,50,'{}',1)`,
      [randomUUID(), tallyrunId, componentIds["Access"]!, featureIds["saml"]!],
    );

    const releaseIds: Record<string, string> = {};
    const releaseSeeds: Array<{
      key: string;
      name: string;
      target: string;
      isPublic: boolean;
      featureKeys: string[];
    }> = [
      { key: "march", name: "March Drop", target: "2027-03-15", isPublic: true, featureKeys: ["saml", "scheduled", "bulk"] },
      { key: "tooling", name: "Internal Tooling", target: "2027-04-05", isPublic: false, featureKeys: [] },
      { key: "april", name: "April Drop", target: "2027-04-20", isPublic: true, featureKeys: ["audit"] },
    ];
    for (const r of releaseSeeds) {
      const id = randomUUID();
      releaseIds[r.key] = id;
      await client.query(
        `INSERT INTO releases (id, workspace_id, name, target_date, status, is_public, order_version)
         VALUES ($1,$2,$3,$4,'open',$5,1)`,
        [id, tallyrunId, r.name, r.target, r.isPublic],
      );
      for (const [i, key] of r.featureKeys.entries()) {
        await client.query(
          "UPDATE features SET release_id = $1, release_position = $2 WHERE id = $3",
          [id, i, featureIds[key]!],
        );
      }
    }

    // Notes. N5 is a paragraph followed by a two-item list.
    const noteSeeds: Array<{
      key: string;
      title: string;
      source: "support_ticket" | "sales_call" | "email";
      contactEmail: string | null;
      createdAt: string;
      body: string;
    }> = [
      {
        key: "n1",
        title: "Weekly KPI pack",
        source: "support_ticket",
        contactEmail: "ana@northwindfreight.example",
        createdAt: "2026-10-20T14:00:00Z",
        body: `<p>We export the KPI pack every Monday by hand. <strong>If reports could email themselves to the ops team</strong> we would stop asking for screenshots.</p>`,
      },
      {
        key: "n2",
        title: "Renewal blocker: SSO",
        source: "sales_call",
        contactEmail: "priya@orchardlanebank.example",
        createdAt: "2026-10-21T15:30:00Z",
        body: `<p>Security review blocks us until we have SAML single sign-on with Okta. This is a hard requirement for renewal.</p>`,
      },
      {
        key: "n3",
        title: "Audit questions from clinic auditors",
        source: "email",
        contactEmail: "tom@bluefinclinics.example",
        createdAt: "2026-10-22T13:00:00Z",
        body: `<p>Auditors keep asking who changed a patient-facing setting. We need an audit trail we can filter by user. We cut 100% of manual audit pulls last quarter.</p>`,
      },
      {
        key: "n4",
        title: "Monday report for finance",
        source: "support_ticket",
        contactEmail: "lee@nwfreight.example",
        createdAt: "2026-10-23T16:45:00Z",
        body: `<p>Our finance team wants the Monday report in their inbox automatically.</p>`,
      },
      {
        key: "n5",
        title: "Forwarded renewal thread",
        source: "email",
        contactEmail: "priya@orchardlanebank.example",
        createdAt: "2026-10-24T12:10:00Z",
        body: `<p>Forwarded from the renewal thread:</p><ul><li>Okta groups should map to roles</li><li>Export audit events weekly</li></ul>`,
      },
      {
        key: "n6",
        title: "Clinic rota export",
        source: "support_ticket",
        contactEmail: "tom@bluefinclinics.example",
        createdAt: "2026-10-25T09:00:00Z",
        body: `<p>Clinic managers rebuild the staff rota by hand each week. A rota download would save them an afternoon.</p>`,
      },
      {
        key: "n7",
        title: "Dock scheduling feedback",
        source: "email",
        contactEmail: "ana@northwindfreight.example",
        createdAt: "2026-10-25T09:00:00Z",
        body: `<p>Our dock team wants to book loading slots from the shipment list.</p>`,
      },
    ];

    const noteIds: Record<string, string> = {};
    const noteTexts: Record<string, string> = {};
    for (const n of noteSeeds) {
      const id = randomUUID();
      noteIds[n.key] = id;
      const body = allowlistBody(n.body);
      const text = bodyToText(body);
      noteTexts[n.key] = text;
      await client.query(
        `INSERT INTO notes (id, workspace_id, title, body, text, source, status,
           contact_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'unprocessed',$7,$8)`,
        [
          id,
          tallyrunId,
          n.title,
          body,
          text,
          n.source,
          n.contactEmail ? contactIds[n.contactEmail]! : null,
          n.createdAt,
        ],
      );
    }

    // Insights: the exact quotes from the brief, with offsets computed from
    // the note's plain text.
    interface InsightSeed {
      noteKey: string;
      quote: string;
      featureKey: string;
      importance: ImportanceSeed;
    }
    const insightSeeds: InsightSeed[] = [
      { noteKey: "n2", quote: "SAML single sign-on with Okta", featureKey: "saml", importance: "critical" },
      {
        noteKey: "n2",
        quote: "single sign-on with Okta. This is a hard requirement",
        featureKey: "audit",
        importance: "nice_to_have",
      },
      {
        noteKey: "n4",
        quote: "wants the Monday report in their inbox automatically",
        featureKey: "scheduled",
        importance: "important",
      },
    ];
    const impactByFeature: Record<string, number> = {};
    for (const i of insightSeeds) {
      const text = noteTexts[i.noteKey]!;
      const start = text.indexOf(i.quote);
      if (start < 0) throw new Error(`Seed quote not found in note ${i.noteKey}: ${i.quote}`);
      const end = start + i.quote.length;
      await client.query(
        `INSERT INTO insights (id, workspace_id, note_id, feature_id, start_offset, end_offset,
           quote, importance)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          tallyrunId,
          noteIds[i.noteKey]!,
          featureIds[i.featureKey]!,
          start,
          end,
          i.quote,
          i.importance,
        ],
      );
      impactByFeature[i.featureKey] = (impactByFeature[i.featureKey] ?? 0) + IMPORTANCE_POINTS[i.importance];
    }

    // Score version 1 for every feature, with the priority at seed time.
    for (const f of featureSeeds) {
      const fits = fitsByFeature[f.key]!;
      const fit = computeObjectiveFit(fits, objectiveWeights);
      const impact = impactByFeature[f.key] ?? 0;
      const priority = round2(computePriority(fit, impact, f.confidence, f.effort));
      await client.query(
        `INSERT INTO score_versions (feature_id, version, effort, confidence, fits, priority, saved_by)
         VALUES ($1, 1, $2, $3, $4, $5, NULL)`,
        [featureIds[f.key]!, f.effort, f.confidence, JSON.stringify(fits), priority.toFixed(2)],
      );
    }

    // ---------- Quarry Labs ----------
    const quarryId = randomUUID();
    await client.query(
      "INSERT INTO workspaces (id, name, time_zone) VALUES ($1, $2, $3)",
      [quarryId, "Quarry Labs", "Europe/Berlin"],
    );
    for (const [name, email, role] of [
      ["Mara Voss", "hop@quarrylabs.example", "head_of_product"],
      ["Ollie Grant", "pm@quarrylabs.example", "product_manager"],
    ] as const) {
      await client.query(
        "INSERT INTO members (id, workspace_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5,$6)",
        [randomUUID(), quarryId, name, email, passwordHash, role],
      );
    }
    const saltmarshId = randomUUID();
    await client.query(
      "INSERT INTO companies (id, workspace_id, name) VALUES ($1,$2,$3)",
      [saltmarshId, quarryId, "Saltmarsh Media"],
    );
    await client.query(
      "INSERT INTO company_domains (company_id, workspace_id, domain) VALUES ($1,$2,$3)",
      [saltmarshId, quarryId, "saltmarsh.example"],
    );
    const joId = randomUUID();
    await client.query(
      "INSERT INTO contacts (id, workspace_id, company_id, name, email) VALUES ($1,$2,$3,$4,$5)",
      [joId, quarryId, saltmarshId, "Jo Park", "jo@saltmarsh.example"],
    );
    const growObjectiveId = randomUUID();
    await client.query(
      "INSERT INTO objectives (id, workspace_id, name, weight, position) VALUES ($1,$2,$3,$4,0)",
      [growObjectiveId, quarryId, "Grow enterprise", 100],
    );
    const quarryProductId = randomUUID();
    await client.query(
      "INSERT INTO products (id, workspace_id, name, position) VALUES ($1,$2,$3,0)",
      [quarryProductId, quarryId, "Quarry Studio"],
    );
    const exportsComponentId = randomUUID();
    await client.query(
      "INSERT INTO components (id, workspace_id, product_id, name, position) VALUES ($1,$2,$3,$4,0)",
      [exportsComponentId, quarryId, quarryProductId, "Exports"],
    );
    const auditExportId = randomUUID();
    await client.query(
      `INSERT INTO features (id, workspace_id, component_id, name, public_description, status,
         effort, confidence, fits, version)
       VALUES ($1,$2,$3,$4,$5,'planned',4,70,$6,1)`,
      [
        auditExportId,
        quarryId,
        exportsComponentId,
        "Audit log export",
        "Weekly audit log files",
        JSON.stringify({ [growObjectiveId]: 3 }),
      ],
    );
    const quarryReleaseId = randomUUID();
    await client.query(
      `INSERT INTO releases (id, workspace_id, name, target_date, status, is_public, order_version)
       VALUES ($1,$2,$3,$4,'open',TRUE,1)`,
      [quarryReleaseId, quarryId, "Q2 Exports", "2027-05-10"],
    );
    await client.query(
      "UPDATE features SET release_id = $1, release_position = 0 WHERE id = $2",
      [quarryReleaseId, auditExportId],
    );
    const quarryNoteId = randomUUID();
    const quarryNoteBody = plainTextToBody("We need the audit log export as CSV every week.");
    const quarryNoteText = bodyToText(quarryNoteBody);
    await client.query(
      `INSERT INTO notes (id, workspace_id, title, body, text, source, status, contact_id, created_at)
       VALUES ($1,$2,$3,$4,$5,'email','unprocessed',$6,$7)`,
      [quarryNoteId, quarryId, "Weekly audit files", quarryNoteBody, quarryNoteText, joId, "2026-10-26T10:00:00Z"],
    );
    const quarryQuote = "audit log export as CSV every week";
    const quarryStart = quarryNoteText.indexOf(quarryQuote);
    if (quarryStart < 0) throw new Error("Quarry seed quote not found");
    await client.query(
      `INSERT INTO insights (id, workspace_id, note_id, feature_id, start_offset, end_offset, quote, importance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'critical')`,
      [
        randomUUID(),
        quarryId,
        quarryNoteId,
        auditExportId,
        quarryStart,
        quarryStart + quarryQuote.length,
        quarryQuote,
      ],
    );
    const quarryFit = computeObjectiveFit({ [growObjectiveId]: 3 }, [
      { id: growObjectiveId, weight: 100 },
    ]);
    const quarryPriority = round2(computePriority(quarryFit, 5, 70, 4));
    await client.query(
      `INSERT INTO score_versions (feature_id, version, effort, confidence, fits, priority, saved_by)
       VALUES ($1, 1, 4, 70, $2, $3, NULL)`,
      [auditExportId, JSON.stringify({ [growObjectiveId]: 3 }), quarryPriority.toFixed(2)],
    );

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is already unusable.
    }
    throw err;
  } finally {
    client.release();
  }
}
