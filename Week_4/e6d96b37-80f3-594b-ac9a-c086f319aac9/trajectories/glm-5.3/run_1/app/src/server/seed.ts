import type { FlanEnv } from "../shared/env.js";
import type { SeedVariant, StorageState, WorkflowKey } from "../shared/seed.js";
import { TRAY_CELLS } from "../shared/util.js";
import { pool } from "./db.js";
import { DEFAULT_NAMESPACE, advance, clockIso, offsetSeconds } from "./clock.js";
import { fixturePhoto } from "./fixture_media.js";
import { Keycloak } from "./keycloak.js";
import { KeycloakAdmin, totpCode } from "./kcadmin.js";
import { provisionTotp } from "./totp.js";
import { Register } from "./register.js";
import { Storage } from "./storage.js";
import { createSession } from "./session.js";
import { sha256Hex } from "./util.js";
import { driveLogin } from "./login_flow.js";

const WORKFLOWS: WorkflowKey[] = [
  "intake",
  "attribution",
  "catalog_reconciliation",
  "tray_placement",
  "set_tracking",
  "condition_comparison",
  "duplicate_selection",
  "offer_assembly",
  "counteroffers",
  "dispatch",
  "receipt",
  "disputes",
  "stock_audit",
  "cross_cutting",
];

const ENTRY_PATHS: Record<WorkflowKey, string> = {
  intake: "intake",
  attribution: "attribution",
  catalog_reconciliation: "catalog-reconciliation",
  tray_placement: "tray-placement",
  set_tracking: "album",
  condition_comparison: "condition",
  duplicate_selection: "keepers",
  offer_assembly: "offers",
  counteroffers: "counteroffers",
  dispatch: "dispatch",
  receipt: "receipt",
  disputes: "disputes",
  stock_audit: "audit",
  cross_cutting: "counteroffers",
};

export interface SeedOutcome {
  namespace: string;
  entries: Record<string, string>;
  sessions: Record<string, StorageState>;
  state_url: string;
  media: { obverse: string; reverse: string };
  clock: string;
}

interface SeededIdentity {
  role: "dealer" | "counterpart" | "outsider";
  username: string;
  password: string;
  userId: string | null;
  totpSecret: string | null;
}

export class Seeder {
  private identities: SeededIdentity[] = [];

  constructor(
    private env: FlanEnv,
    private storage: Storage,
    private register: Register,
    private kc: Keycloak,
    private kcAdmin: KeycloakAdmin,
  ) {}

  async seed(namespace: string, workflow: WorkflowKey, variant: SeedVariant): Promise<SeedOutcome> {
    const keycloakUp = await this.kcAdmin.available();
    const registerUp = await this.registerReachable();
    const storageUp = await this.storageReachable();

    // A brand-new namespace: reset its clock to the grading start.
    await pool.query("INSERT INTO namespaces (namespace) VALUES ($1) ON CONFLICT DO NOTHING", [namespace]);
    if (namespace !== DEFAULT_NAMESPACE) {
      const existing = await pool.query<{ offset_seconds: number }>("SELECT offset_seconds FROM namespace_clocks WHERE namespace = $1", [namespace]);
      if (existing.rows.length === 0) {
        await pool.query("INSERT INTO namespace_clocks (namespace, offset_seconds) VALUES ($1, 0)", [namespace]);
        // Position the grading clock at FLAN_GRADE_CLOCK_ISO relative to real time.
        const nowReal = Date.now();
        const target = Date.parse(this.env.FLAN_GRADE_CLOCK_ISO);
        const base = await offsetSeconds(namespace);
        await pool.query("UPDATE namespace_clocks SET offset_seconds = $1 WHERE namespace = $2", [
          base + Math.round((target - nowReal) / 1000),
          namespace,
        ]);
      }
    }

    await this.resetNamespace(namespace);
    await this.seedFixture(namespace, registerUp, storageUp);
    await this.applyWorkflow(namespace, workflow, variant, registerUp, storageUp);

    if (keycloakUp) {
      await this.provisionIdentities(namespace);
    }

    const base = this.env.APP_PUBLIC_URL;
    const entries: Record<string, string> = {
      dealer: keycloakUp ? `${base}/desk/${namespace}/${ENTRY_PATHS[workflow]}` : `${base}/desk/${namespace}`,
      dealer_peer: keycloakUp ? `${base}/desk/${namespace}/${ENTRY_PATHS[workflow]}` : `${base}/desk/${namespace}`,
      counterpart: keycloakUp ? this.counterpartEntry(namespace, workflow) : `${base}/desk/${namespace}`,
      outsider: `${base}/desk/${namespace}`,
    };
    const sessions: Record<string, StorageState> = await this.buildSessions(namespace, keycloakUp);
    const media = await this.stageMedia(namespace, storageUp);

    return {
      namespace,
      entries,
      sessions,
      state_url: `${base}/api/desks/${namespace}/state`,
      media,
      clock: await clockIso(namespace),
    };
  }

  private counterpartEntry(namespace: string, workflow: WorkflowKey): string {
    const counterpartWorkflows = new Set<WorkflowKey>(["offer_assembly", "counteroffers", "dispatch", "receipt", "disputes", "cross_cutting"]);
    if (counterpartWorkflows.has(workflow)) {
      return `${this.env.APP_PUBLIC_URL}/desk/${namespace}/${ENTRY_PATHS[workflow]}`;
    }
    return `${this.env.APP_PUBLIC_URL}/desk/${namespace}`;
  }

  private async registerReachable(): Promise<boolean> {
    try {
      await this.register.album("ALD-CROWN");
      return true;
    } catch {
      return false;
    }
  }

  private async storageReachable(): Promise<boolean> {
    try {
      await this.storage.put(`probe/${Date.now()}.txt`, new Uint8Array([1]), "text/plain");
      return true;
    } catch {
      return false;
    }
  }

  private async resetNamespace(namespace: string): Promise<void> {
    const tables = [
      "photos",
      "annotations",
      "audit_marks",
      "dispute_markers",
      "dispute_approvals",
      "evidence_links",
      "disputes",
      "receipts",
      "manifests",
      "holds",
      "offers",
      "album_holes",
      "albums",
      "tray_cells",
      "tray_meta",
      "keeper_orders",
      "specimens",
      "register_records",
      "commands",
      "events",
      "seeded_workflows",
    ];
    for (const table of tables) {
      await pool.query(`DELETE FROM ${table} WHERE ns = $1`, [namespace]);
    }
  }

  private async seedFixture(ns: string, registerUp: boolean, storageUp: boolean): Promise<void> {
    await pool.query("INSERT INTO tray_meta (ns, version) VALUES ($1, 1) ON CONFLICT DO NOTHING", [ns]);
    for (const cell of TRAY_CELLS) {
      await pool.query("INSERT INTO tray_cells (ns, cell, audit_version) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING", [ns, cell]);
    }

    const fixtures: {
      key: string;
      owner: "dealer" | "counterpart" | "outsider";
      reference: string;
      mintmark: string;
      certainty: "certain" | "uncertain";
      quarantined: boolean;
      status: string;
      holder: ["flip" | "slab" | "capsule", number, number];
      wear: "fresh" | "worn";
    }[] = [
      { key: "A", owner: "dealer", reference: "ALD-A", mintmark: "A", certainty: "certain", quarantined: false, status: "attributed", holder: ["flip", 50, 50], wear: "fresh" },
      { key: "B", owner: "dealer", reference: "ALD-A", mintmark: "A", certainty: "certain", quarantined: false, status: "attributed", holder: ["flip", 50, 50], wear: "worn" },
      { key: "C", owner: "dealer", reference: "ALD-A", mintmark: "A", certainty: "certain", quarantined: false, status: "attributed", holder: ["slab", 70, 90], wear: "fresh" },
      { key: "U", owner: "dealer", reference: "ALD-K", mintmark: "K", certainty: "uncertain", quarantined: true, status: "quarantined", holder: ["flip", 50, 50], wear: "fresh" },
      { key: "O", owner: "dealer", reference: "ALD-O", mintmark: "O", certainty: "certain", quarantined: false, status: "outbound", holder: ["capsule", 46, 46], wear: "fresh" },
      { key: "X", owner: "counterpart", reference: "ALD-K", mintmark: "K", certainty: "certain", quarantined: false, status: "attributed", holder: ["flip", 50, 50], wear: "fresh" },
      { key: "Y", owner: "outsider", reference: "ALD-A", mintmark: "A", certainty: "certain", quarantined: false, status: "attributed", holder: ["flip", 50, 50], wear: "fresh" },
    ];

    let sequence = 0;
    for (const fixture of fixtures) {
      sequence += 1;
      const registerState = registerUp ? "stored" : "pending";
      await pool.query(
        `INSERT INTO specimens (ns, key, display_label, owner, status, version, holder_kind, holder_width_mm, holder_height_mm,
         attribution_reference, attribution_mintmark, attribution_revision, certainty, register_state, quarantined, creation_sequence)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10, 1, $11, $12, $13, $14)`,
        [
          ns,
          fixture.key,
          `Specimen ${fixture.key}`,
          fixture.owner,
          fixture.status,
          fixture.holder[0],
          fixture.holder[1],
          fixture.holder[2],
          fixture.reference,
          fixture.mintmark,
          fixture.certainty,
          registerState,
          fixture.quarantined,
          sequence,
        ],
      );
      if (!storageUp || !registerUp) continue;
      for (const face of ["obverse", "reverse"] as const) {
        const photo = fixturePhoto(face, fixture.mintmark, fixture.wear, "none");
        const objectKey = `specimens/${ns}/${fixture.key}/${face}-${photo.sha256}.png`;
        await this.storage.put(objectKey, photo.bytes, photo.contentType);
        await pool.query(
          "INSERT INTO photos (id, ns, specimen, label, object_key, sha256, width, height, content_type, byte_size) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            `ph_${fixture.key}_${face}`,
            ns,
            fixture.key,
            face,
            objectKey,
            photo.sha256,
            photo.width,
            photo.height,
            photo.contentType,
            photo.bytes.byteLength,
          ],
        );
      }
    }

    // Register records for stored attributions.
    if (registerUp) {
      for (const reference of ["ALD-A", "ALD-K", "ALD-O"]) {
        try {
          const variety = await this.register.variety(reference);
          let imageObjectKey: string | null = null;
          if (storageUp) {
            try {
              const image = await this.register.image(variety.image_path);
              imageObjectKey = `catalog/${ns}/${reference}/r1.svg`;
              await this.storage.put(imageObjectKey, Buffer.from(image.body, "utf8"), "image/svg+xml");
            } catch {
              imageObjectKey = null;
            }
          }
          await pool.query(
            `INSERT INTO register_records (ns, reference, issue, mintmark, revision, image_object_key)
             VALUES ($1, $2, $3, $4, 1, $5) ON CONFLICT (ns, reference) DO UPDATE SET image_object_key = $5`,
            [ns, reference, variety.issue, variety.mintmark, imageObjectKey],
          );
        } catch {
          // Register unreachable: attribution stays pending.
        }
      }
      // Album from the register.
      try {
        const album = await this.register.album("ALD-CROWN");
        await pool.query(
          "INSERT INTO albums (ns, set, revision, version) VALUES ($1, $2, $3, 1) ON CONFLICT (ns) DO UPDATE SET set = $2, revision = $3",
          [ns, album.set, album.revision],
        );
        for (const hole of album.holes) {
          await pool.query(
            "INSERT INTO album_holes (ns, hole, reference, mintmark, specimen) VALUES ($1, $2, $3, $4, NULL) ON CONFLICT (ns, hole) DO NOTHING",
            [ns, hole.label, hole.reference, hole.mintmark],
          );
        }
      } catch {
        // Album stays empty when the register is unreachable.
      }
    }

    // Tray baseline: A2 holds B.
    await pool.query("UPDATE tray_cells SET specimen = 'B' WHERE ns = $1 AND cell = 'A2'", [ns]);
    // Keeper order A, B, C.
    await pool.query(
      "INSERT INTO keeper_orders (ns, version, order_keys, previous_order_keys) VALUES ($1, 1, $2, '{}') ON CONFLICT (ns) DO UPDATE SET order_keys = $2",
      [ns, ["A", "B", "C"]],
    );
    // offer-0: accepted at version 1, dealer item O, no counterpart items.
    await pool.query(
      `INSERT INTO offers (ns, key, version, status, dealer_items, counterpart_items, dealer_acceptance_version, counterpart_acceptance_version, expires_at)
       VALUES ($1, 'offer-0', 1, 'accepted', ARRAY['O'], ARRAY[]::text[], 1, 1, NULL)`,
      [ns],
    );
    await pool.query(
      "INSERT INTO manifests (ns, offer, party, version, order_keys, frozen) VALUES ($1, 'offer-0', 'dealer', 1, ARRAY['O'], FALSE)",
      [ns],
    );
    await pool.query(
      "INSERT INTO events (ns, command_id, actor, type, at, payload) VALUES ($1, 'seed-offer-0', 'dealer', 'offer.accepted', $2, '{}')",
      [ns, new Date()],
    );
  }

  private async applyWorkflow(ns: string, workflow: WorkflowKey, variant: SeedVariant, registerUp: boolean, storageUp: boolean): Promise<void> {
    await pool.query(
      "INSERT INTO seeded_workflows (ns, workflow, variant) VALUES ($1, $2, $3) ON CONFLICT (ns, workflow) DO UPDATE SET variant = $3",
      [ns, workflow, variant],
    );
    switch (workflow) {
      case "intake":
        break;
      case "attribution":
        await pool.query(
          "UPDATE specimens SET status = 'pending_catalogue', certainty = 'uncertain', register_state = 'pending', attribution_reference = 'ALD-A', attribution_mintmark = 'A' WHERE ns = $1 AND key = 'A'",
          [ns],
        );
        break;
      case "catalog_reconciliation":
        await pool.query(
          "UPDATE specimens SET status = 'pending_catalogue', register_state = 'pending' WHERE ns = $1 AND key = 'A'",
          [ns],
        );
        break;
      case "tray_placement":
      case "set_tracking":
      case "duplicate_selection":
        break;
      case "condition_comparison":
        if (storageUp) {
          const arrival = fixturePhoto("arrival", "A", "fresh", "scratch");
          const key = `arrivals/${ns}/seed-condition/A-${arrival.sha256}.png`;
          await this.storage.put(key, arrival.bytes, arrival.contentType);
          await pool.query(
            "INSERT INTO photos (id, ns, specimen, label, object_key, sha256, width, height, content_type, byte_size, offer) VALUES ($1,$2,'A','arrival',$3,$4,$5,$6,$7,$8,'seed-condition')",
            ["ph_A_arrival_cond", ns, key, arrival.sha256, arrival.width, arrival.height, arrival.contentType, arrival.bytes.byteLength],
          );
        }
        break;
      case "offer_assembly":
        await pool.query(
          `INSERT INTO offers (ns, key, version, status, dealer_items, counterpart_items) VALUES ($1, 'offer-1', 1, 'draft', ARRAY[]::text[], ARRAY[]::text[])
           ON CONFLICT (ns, key) DO NOTHING`,
          [ns],
        );
        await pool.query(
          `INSERT INTO offers (ns, key, version, status, dealer_items, counterpart_items) VALUES ($1, 'offer-2', 1, 'draft', ARRAY[]::text[], ARRAY[]::text[])
           ON CONFLICT (ns, key) DO NOTHING`,
          [ns],
        );
        break;
      case "counteroffers":
        await pool.query(
          `INSERT INTO offers (ns, key, version, status, dealer_items, counterpart_items, dealer_acceptance_version, counterpart_acceptance_version, expires_at)
           VALUES ($1, 'offer-1', 1, 'accepted', ARRAY['A'], ARRAY['X'], 1, 1, NULL)`,
          [ns],
        );
        await pool.query(
          "UPDATE specimens SET status = 'reserved' WHERE ns = $1 AND key IN ('A')",
          [ns],
        );
        await pool.query(
          "UPDATE specimens SET status = 'reserved' WHERE ns = $1 AND key IN ('X')",
          [ns],
        );
        break;
      case "dispatch": {
        await pool.query(
          `INSERT INTO offers (ns, key, version, status, dealer_items, counterpart_items, dealer_acceptance_version, counterpart_acceptance_version, expires_at)
           VALUES ($1, 'offer-1', 1, 'accepted', ARRAY['A','B','C'], ARRAY['X'], 1, 1, NULL)`,
          [ns],
        );
        for (const key of ["A", "B", "C", "X"]) {
          await pool.query("UPDATE specimens SET status = 'outbound' WHERE ns = $1 AND key = $2", [ns, key]);
        }
        await pool.query(
          "INSERT INTO manifests (ns, offer, party, version, order_keys, frozen) VALUES ($1, 'offer-1', 'dealer', 1, ARRAY['A','B','C'], FALSE)",
          [ns],
        );
        await pool.query(
          "INSERT INTO manifests (ns, offer, party, version, order_keys, frozen) VALUES ($1, 'offer-1', 'counterpart', 1, ARRAY['X'], FALSE)",
          [ns],
        );
        break;
      }
      case "receipt": {
        await pool.query(
          `INSERT INTO offers (ns, key, version, status, dealer_items, counterpart_items, dealer_acceptance_version, counterpart_acceptance_version, expires_at)
           VALUES ($1, 'offer-1', 1, 'accepted', ARRAY['A'], ARRAY['X'], 1, 1, NULL)`,
          [ns],
        );
        for (const key of ["A", "X"]) {
          await pool.query("UPDATE specimens SET status = 'outbound' WHERE ns = $1 AND key = $2", [ns, key]);
        }
        await pool.query("UPDATE offers SET status = 'dispatched' WHERE ns = $1 AND key = 'offer-1'", [ns]);
        await pool.query(
          "INSERT INTO manifests (ns, offer, party, version, order_keys, frozen) VALUES ($1, 'offer-1', 'dealer', 1, ARRAY['A'], TRUE)",
          [ns],
        );
        await pool.query(
          "INSERT INTO manifests (ns, offer, party, version, order_keys, frozen) VALUES ($1, 'offer-1', 'counterpart', 1, ARRAY['X'], TRUE)",
          [ns],
        );
        if (storageUp) {
          const arrivalA = fixturePhoto("arrival", "A", "fresh", "none");
          const keyA = `arrivals/${ns}/offer-1/A-${arrivalA.sha256}.png`;
          await this.storage.put(keyA, arrivalA.bytes, arrivalA.contentType);
          await pool.query(
            "INSERT INTO photos (id, ns, specimen, label, object_key, sha256, width, height, content_type, byte_size, offer) VALUES ($1,$2,'A','arrival',$3,$4,$5,$6,$7,$8,'offer-1')",
            ["ph_arrival_A", ns, keyA, arrivalA.sha256, arrivalA.width, arrivalA.height, arrivalA.contentType, arrivalA.bytes.byteLength],
          );
          const arrivalX = fixturePhoto("arrival", "K", "fresh", "none");
          const keyX = `arrivals/${ns}/offer-1/X-${arrivalX.sha256}.png`;
          await this.storage.put(keyX, arrivalX.bytes, arrivalX.contentType);
          await pool.query(
            "INSERT INTO photos (id, ns, specimen, label, object_key, sha256, width, height, content_type, byte_size, offer) VALUES ($1,$2,'X','arrival',$3,$4,$5,$6,$7,$8,'offer-1')",
            ["ph_arrival_X", ns, keyX, arrivalX.sha256, arrivalX.width, arrivalX.height, arrivalX.contentType, arrivalX.bytes.byteLength],
          );
          const dispatchA = fixturePhoto("dispatch", "A", "fresh", "none");
          const dispatchKeyA = `manifests/${ns}/offer-1/dealer/A-dispatch-${dispatchA.sha256}.png`;
          await this.storage.put(dispatchKeyA, dispatchA.bytes, dispatchA.contentType);
          await pool.query(
            "INSERT INTO photos (id, ns, specimen, label, object_key, sha256, width, height, content_type, byte_size, offer) VALUES ($1,$2,'A','dispatch',$3,$4,$5,$6,$7,$8,'offer-1')",
            ["ph_dispatch_A", ns, dispatchKeyA, dispatchA.sha256, dispatchA.width, dispatchA.height, dispatchA.contentType, dispatchA.bytes.byteLength],
          );
          const dispatchX = fixturePhoto("dispatch", "K", "fresh", "none");
          const dispatchKeyX = `manifests/${ns}/offer-1/counterpart/X-dispatch-${dispatchX.sha256}.png`;
          await this.storage.put(dispatchKeyX, dispatchX.bytes, dispatchX.contentType);
          await pool.query(
            "INSERT INTO photos (id, ns, specimen, label, object_key, sha256, width, height, content_type, byte_size, offer) VALUES ($1,$2,'X','dispatch',$3,$4,$5,$6,$7,$8,'offer-1')",
            ["ph_dispatch_X", ns, dispatchKeyX, dispatchX.sha256, dispatchX.width, dispatchX.height, dispatchX.contentType, dispatchX.bytes.byteLength],
          );
        }
        break;
      }
      case "disputes": {
        await this.applyWorkflow(ns, "receipt", variant, registerUp, storageUp);
        if (storageUp) {
          // A's arrival shows the fresh gouge.
          const gouged = fixturePhoto("arrival", "A", "fresh", "gouge");
          const key = `arrivals/${ns}/offer-1/A-${gouged.sha256}.png`;
          await this.storage.put(key, gouged.bytes, gouged.contentType);
          await pool.query("DELETE FROM photos WHERE ns = $1 AND specimen = 'A' AND label = 'arrival'", [ns]);
          await pool.query(
            "INSERT INTO photos (id, ns, specimen, label, object_key, sha256, width, height, content_type, byte_size, offer) VALUES ($1,$2,'A','arrival',$3,$4,$5,$6,$7,$8,'offer-1')",
            ["ph_arrival_A", ns, key, gouged.sha256, gouged.width, gouged.height, gouged.contentType, gouged.bytes.byteLength],
          );
        }
        await pool.query(
          "INSERT INTO receipts (ns, offer, party, confirmed, matches) VALUES ($1, 'offer-1', 'dealer', TRUE, TRUE) ON CONFLICT (ns, offer, party) DO NOTHING",
          [ns],
        );
        break;
      }
      case "stock_audit":
        await pool.query("UPDATE tray_cells SET specimen = 'A' WHERE ns = $1 AND cell = 'A1'", [ns]);
        await pool.query("UPDATE tray_cells SET specimen = 'B' WHERE ns = $1 AND cell = 'A2'", [ns]);
        await pool.query("UPDATE tray_cells SET specimen = 'U' WHERE ns = $1 AND cell = 'B1'", [ns]);
        await pool.query("UPDATE tray_cells SET specimen = NULL WHERE ns = $1 AND cell = 'B2'", [ns]);
        break;
      case "cross_cutting":
        await pool.query(
          `INSERT INTO offers (ns, key, version, status, dealer_items, counterpart_items, expires_at)
           VALUES ($1, 'offer-1', 1, 'sent', ARRAY['A'], ARRAY['X'], now() + interval '48 hours')`,
          [ns],
        );
        await pool.query("UPDATE specimens SET status = 'reserved' WHERE ns = $1 AND key IN ('A','X')", [ns]);
        break;
    }
  }

  async provisionIdentities(ns: string): Promise<void> {
    const roles: ("dealer" | "counterpart" | "outsider")[] = ["dealer", "counterpart", "outsider"];
    for (const role of roles) {
      const username = `${ns}-${role}`;
      const password = `Flan-${ns}-${role}`;
      let user = await this.kcAdmin.getUserByUsername(username);
      if (!user) {
        user = await this.kcAdmin.ensureUser(username, password, role === "dealer" ? "flan-dealer" : role === "counterpart" ? "flan-counterpart" : null, ns);
      } else {
        await this.kcAdmin.setPassword(user.id, password);
        await this.kcAdmin.setRequiredActions(user.id, []);
        user = (await this.kcAdmin.getUserByUsername(username)) ?? user;
      }
      let totpSecret: string | null = null;
      if (role !== "outsider") {
        const hasOtp = await this.kcAdmin.hasOtpCredential(user.id);
        if (!hasOtp) {
          await this.kcAdmin.setRequiredActions(user.id, ["CONFIGURE_TOTP"]);
          try {
            totpSecret = await provisionTotp(this.env, username, password);
          } catch {
            totpSecret = null;
          }
          await this.kcAdmin.setRequiredActions(user.id, []);
        }
      }
      await pool.query(
        `INSERT INTO seeded_identities (ns, role, username, totp_secret) VALUES ($1, $2, $3, $4)
         ON CONFLICT (ns, role) DO UPDATE SET username = $3, totp_secret = COALESCE($4, seeded_identities.totp_secret)`,
        [ns, role, username, totpSecret],
      );
      this.identities.push({ role, username, password, userId: user.id, totpSecret });
    }
  }

  private async buildSessions(ns: string, keycloakUp: boolean): Promise<Record<string, StorageState>> {
    const out: Record<string, StorageState> = {
      dealer: { cookies: [], origins: [] },
      dealer_peer: { cookies: [], origins: [] },
      counterpart: { cookies: [], origins: [] },
      outsider: { cookies: [], origins: [] },
    };
    if (!keycloakUp) {
      // Keycloak down: each session carries only the application cookie; writes then fail.
      for (const role of ["dealer", "dealer_peer", "counterpart", "outsider"]) {
        const identityRole = role === "dealer_peer" ? "dealer" : (role as "dealer" | "counterpart" | "outsider");
        const session = await createSession(this.env, `seed-${role}`, `${ns}-${identityRole}`, identityRole, ns, false, null);
        out[role] = {
          cookies: [
            {
              name: "flan_session",
              value: session.sid,
              domain: new URL(this.env.APP_PUBLIC_URL).host,
              path: "/",
              httpOnly: true,
            },
          ],
          origins: [],
        };
      }
      return out;
    }
    // Genuine sign-in through Keycloak's own pages for each seeded identity.
    for (const slot of ["dealer", "counterpart", "dealer_peer", "outsider"] as const) {
      const role = slot === "dealer_peer" ? "dealer" : slot;
      const username = `${ns}-${role}`;
      const password = `Flan-${ns}-${role}`;
      try {
        const jar = await driveLogin(this.env, username, password);
        out[slot] = jar;
      } catch {
        out[slot] = { cookies: [], origins: [] };
      }
    }
    return out;
  }

  private async stageMedia(ns: string, storageUp: boolean): Promise<{ obverse: string; reverse: string }> {
    void storageUp;
    void ns;
    // Staged photographs are always available: they are served by the grading route itself.
    this.mediaObverse = fixturePhoto("obverse", "A", "fresh", "none");
    this.mediaReverse = fixturePhoto("reverse", "A", "fresh", "none");
    return {
      obverse: `${this.env.APP_PUBLIC_URL}/__grade/${ns}/media/obverse.png`,
      reverse: `${this.env.APP_PUBLIC_URL}/__grade/${ns}/media/reverse.png`,
    };
  }

  mediaObverse: ReturnType<typeof fixturePhoto> | null = null;
  mediaReverse: ReturnType<typeof fixturePhoto> | null = null;

  otpFor(role: "dealer" | "counterpart"): string {
    const identity = this.identities.find((i) => i.role === role);
    if (!identity || !identity.totpSecret) return "";
    return totpCode(identity.totpSecret, this.env.FLAN_TOTP_PERIOD_S);
  }

  async advanceClock(ns: string, seconds: number): Promise<string> {
    return advance(ns, seconds);
  }

  /** Idempotent identity provisioning for the default namespace at serve time. */
  async provisionDefaultIdentities(ns: string = DEFAULT_NAMESPACE): Promise<void> {
    await this.provisionIdentities(ns);
  }

  async endCounterpartAccess(ns: string, action: "revoke" | "password_change"): Promise<void> {
    const user = await this.kcAdmin.getUserByUsername(`${ns}-counterpart`);
    if (!user) return;
    if (action === "revoke") {
      await this.kcAdmin.disableUser(user.id);
    } else {
      await this.kcAdmin.setPassword(user.id, `Flan-${ns}-counterpart-new`);
    }
    await pool.query("DELETE FROM sessions WHERE namespace = $1 AND username = $2", [ns, `${ns}-counterpart`]);
  }
}

export function workflowKeys(): WorkflowKey[] {
  return WORKFLOWS;
}

export function shaOf(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}
