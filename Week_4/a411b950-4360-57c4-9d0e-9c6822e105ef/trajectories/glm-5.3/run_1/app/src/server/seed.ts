import { AppConfig } from "./config.js";
import { Database } from "./database.js";
import { hashPassword } from "./crypto.js";
import { Storage, stemKey } from "./storage.js";
import { synthesizeStem, stemDurationMs } from "./seed-stems.js";
import { LAYERS, Layer } from "../shared/domain.js";
import { addMonths, currentMonth } from "../shared/dates.js";

/**
 * Seed data (DP: Seed data). Records are created only when absent; the app
 * never recreates records the operator has changed or withdrawn.
 */

const SEED_OPERATOR_EMAIL = "operator@kettlehole.example";
const SEED_OPERATOR_PASSWORD = "ladder-console-2026";
const SEED_TIME_ZONE = "America/Toronto";

interface SeedProject {
  slug: string;
  title: string;
  credit_type: "shipped" | "jam" | "redesign";
  credit_line: string;
  role: string;
  blurb: string;
  tags: string[];
  visibility: "public" | "nda";
  position: number;
  thresholds: { bed: number; pulse: number; lead: number; stinger: number };
  status: "published" | "draft";
}

const SEED_PROJECTS: SeedProject[] = [
  {
    slug: "salt-flats-chase",
    title: "Salt Flats Chase",
    credit_type: "shipped",
    credit_line: "Ferrous Run, Brackwater Games, 2025",
    role: "Composer and audio implementer",
    blurb:
      "A chase score that layers a rumbling bed, a ticking pulse and a screaming lead as pursuit intensity climbs. Shipped with four adaptive tiers wired to the game's heat system.",
    tags: ["chase", "synth", "adaptive"],
    visibility: "public",
    position: 1,
    thresholds: { bed: 0, pulse: 25, lead: 50, stinger: 75 },
    status: "published",
  },
  {
    slug: "lantern-moth",
    title: "Lantern Moth",
    credit_type: "jam",
    credit_line: "48-hour jam build, 2026",
    role: "Solo audio",
    blurb:
      "One night, one theme, one moth. Ambient strings fade in over a lantern pulse while a lead answers every wingbeat.",
    tags: ["ambient", "jam"],
    visibility: "public",
    position: 2,
    thresholds: { bed: 0, pulse: 20, lead: 45, stinger: 80 },
    status: "published",
  },
  {
    slug: "dredge-yard",
    title: "Dredge Yard",
    credit_type: "redesign",
    credit_line: "Audio redesign of a public gameplay capture",
    role: "Sound designer",
    blurb:
      "A full sound replacement pass over a public capture of a harbour level. Clanging metal and distant sirens stack as the yard wakes up.",
    tags: ["industrial", "redesign"],
    visibility: "public",
    position: 3,
    thresholds: { bed: 0, pulse: 25, lead: 50, stinger: 75 },
    status: "published",
  },
  {
    slug: "glasshouse",
    title: "Glasshouse",
    credit_type: "shipped",
    credit_line: "Adaptive score for an unannounced title",
    role: "Composer",
    blurb:
      "Orchestral layers for an unannounced title, shared privately under NDA. Strings and mallets grow with the tension of the scene.",
    tags: ["orchestral"],
    visibility: "nda",
    position: 4,
    thresholds: { bed: 0, pulse: 30, lead: 55, stinger: 85 },
    status: "published",
  },
  {
    slug: "kiln-interior",
    title: "Kiln Interior",
    credit_type: "redesign",
    credit_line: "Work in progress",
    role: "Sound designer",
    blurb:
      "A work in progress: heat shimmer, brick dust and a slow-breathing kiln. Stems are still being cut, so nothing is published yet.",
    tags: [],
    visibility: "public",
    position: 5,
    thresholds: { bed: 0, pulse: 25, lead: 50, stinger: 75 },
    status: "draft",
  },
];

export class Seeder {
  private seedingStems = false;
  private stemsTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Database,
    private readonly storage: Storage,
    private readonly config: AppConfig,
  ) {}

  async seed(): Promise<void> {
    await this.seedOperator();
    await this.seedSettings();
    await this.seedProjects();
    await this.seedMonths();
    await this.seedEnquiry();
    await this.seedListeningLink();
    await this.seedStems();
  }

  private async seedOperator(): Promise<void> {
    const rows = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM operators WHERE email = $1`,
      [SEED_OPERATOR_EMAIL],
    );
    if (Number(rows[0].count) === 0) {
      await this.db.query(
        `INSERT INTO operators (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
        [SEED_OPERATOR_EMAIL, await hashPassword(SEED_OPERATOR_PASSWORD)],
      );
    }
  }

  private async seedSettings(): Promise<void> {
    await this.db.query(
      `INSERT INTO settings (singleton, time_zone, operator_email) VALUES (true, $1, $2)
       ON CONFLICT (singleton) DO NOTHING`,
      [SEED_TIME_ZONE, SEED_OPERATOR_EMAIL],
    );
  }

  private async seedProjects(): Promise<void> {
    for (const project of SEED_PROJECTS) {
      const rows = await this.db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM projects WHERE slug = $1`,
        [project.slug],
      );
      if (Number(rows[0].count) > 0) continue;
      await this.db.query(
        `INSERT INTO projects
           (slug, title, credit_type, credit_line, role, blurb, tags, visibility, position,
            bed_threshold, pulse_threshold, lead_threshold, stinger_threshold, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          project.slug,
          project.title,
          project.credit_type,
          project.credit_line,
          project.role,
          project.blurb,
          project.tags,
          project.visibility,
          project.position,
          project.thresholds.bed,
          project.thresholds.pulse,
          project.thresholds.lead,
          project.thresholds.stinger,
          project.status,
        ],
      );
    }
  }

  private async seedMonths(): Promise<void> {
    const rows = await this.db.query<{ time_zone: string }>(`SELECT time_zone FROM settings WHERE singleton = true`);
    const timeZone = rows[0]?.time_zone || "UTC";
    const now = new Date();
    const start = currentMonth(now, timeZone);
    for (let index = 1; index <= 6; index += 1) {
      const month = addMonths(start, index);
      await this.db.query(
        `INSERT INTO production_months (month, capacity) VALUES ($1, 2) ON CONFLICT (month) DO NOTHING`,
        [month],
      );
    }
  }

  private async seedEnquiry(): Promise<void> {
    const rows = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM enquiries WHERE reference = 'ENQ-000001'`,
    );
    if (Number(rows[0].count) > 0) return;
    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO enquiry_sequence (singleton, last_number) VALUES (true, 1)
         ON CONFLICT (singleton) DO UPDATE SET last_number = GREATEST(enquiry_sequence.last_number, 1)`,
      );
      await client.query(
        `INSERT INTO enquiries
           (reference, version, status, name, email, studio, brief, triage_notes, fit_score, rate_floor_cents)
         VALUES ('ENQ-000001', 1, 'new', $1, $2, $3, $4, $5, 3, 800000)`,
        [
          "Imogen Hale",
          "imogen.hale@brackwater.example",
          "Brackwater Games",
          "Looking for an adaptive combat score for a roguelite with four intensity tiers.",
          "SEED-PRIVATE-NOTE budget looks thin",
        ],
      );
      const enquiry = await client.query<{ id: string }>(
        `SELECT id FROM enquiries WHERE reference = 'ENQ-000001'`,
      );
      const enquiryId = enquiry.rows[0].id;
      const receipt = renderSeedReceipt();
      await client.query(
        `INSERT INTO mail_queue (enquiry_id, kind, state, message, recipient, sent_at)
         VALUES ($1, 'receipt', 'sent', $2, $3, now()) ON CONFLICT (enquiry_id, kind) DO NOTHING`,
        [enquiryId, receipt.message, receipt.recipient],
      );
    });
  }

  private async seedListeningLink(): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM projects WHERE slug = 'glasshouse'`,
    );
    if (rows.length === 0) return;
    const existing = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM listening_links WHERE token = 'glasshouse-seed-preview'`,
    );
    if (Number(existing[0].count) > 0) return;
    await this.db.query(
      `INSERT INTO listening_links (project_id, label, token, expires_at)
       VALUES ($1, 'Seed preview', 'glasshouse-seed-preview', $2)
       ON CONFLICT (token) DO NOTHING`,
      [rows[0].id, new Date("2030-01-01T00:00:00.000Z")],
    );
  }

  /** Stores the four stems of each published seed project, retrying until storage returns. */
  private async seedStems(): Promise<void> {
    if (this.seedingStems) return;
    this.seedingStems = true;
    try {
      await this.seedStemsOnce();
    } catch {
      this.scheduleStemRetry();
    } finally {
      this.seedingStems = false;
    }
  }

  private scheduleStemRetry(): void {
    if (this.stemsTimer) return;
    this.stemsTimer = setInterval(() => {
      void this.seedStems().catch(() => undefined);
    }, 10000);
    this.stemsTimer.unref();
  }

  private async seedStemsOnce(): Promise<void> {
    const projects = await this.db.query<{ id: string; slug: string; status: string }>(
      `SELECT id, slug, status FROM projects
        WHERE status = 'published' AND slug IN ('salt-flats-chase', 'lantern-moth', 'dredge-yard', 'glasshouse')`,
    );
    for (const project of projects) {
      for (const layer of LAYERS) {
        const existing = await this.db.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM stems WHERE project_id = $1 AND layer = $2`,
          [project.id, layer],
        );
        if (Number(existing[0].count) > 0) continue;
        await this.storeSeedStem(project.id, project.slug, layer);
      }
    }
    const allStored = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM stems s JOIN projects p ON p.id = s.project_id
        WHERE p.slug IN ('salt-flats-chase', 'lantern-moth', 'dredge-yard', 'glasshouse')`,
    );
    if (Number(allStored[0].count) === 16) {
      if (this.stemsTimer) {
        clearInterval(this.stemsTimer);
        this.stemsTimer = null;
      }
    }
  }

  private async storeSeedStem(projectId: string, slug: string, layer: Layer): Promise<void> {
    const seed = Array.from(slug).reduce((acc, char) => acc + char.charCodeAt(0), 0) + LAYERS.indexOf(layer) * 7;
    const bytes = synthesizeStem(layer, seed);
    const durationMs = stemDurationMs();
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO stems (project_id, layer, format, bytes, duration_ms)
       VALUES ($1, $2, 'wav', $3, $4)
       ON CONFLICT (project_id, layer) DO NOTHING
       RETURNING id`,
      [projectId, layer, bytes.length, durationMs],
    );
    if (result.length === 0) return;
    const stemId = result[0].id;
    await this.storage.put(stemKey(projectId, stemId, "wav"), bytes, "audio/wav");
    this.storage.clearPlayability();
  }

  stop(): void {
    if (this.stemsTimer) {
      clearInterval(this.stemsTimer);
      this.stemsTimer = null;
    }
  }
}

function renderSeedReceipt(): { message: string; recipient: string } {
  // The seed enquiry's receipt is already sent; the row keeps a rendered
  // message so queue reads stay honest.
  const name = "Imogen Hale";
  const address = "imogen.hale@brackwater.example";
  const reference = "ENQ-000001";
  const brief = "Looking for an adaptive combat score for a roguelite with four intensity tiers.";
  const body = [
    `Thank you for your brief, ${name}.`,
    ``,
    `Your reference is ${reference}.`,
    ``,
    `You wrote:`,
    brief,
    ``,
    `Kettlehole Audio`,
  ].join("\r\n");
  const headers = [
    `From: Kettlehole Audio <studio@kettlehole.example>`,
    `To: ${displayQuoted(name, address)}`,
    `Subject: Your brief reached Kettlehole Audio (${reference})`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="utf-8"`,
  ];
  return { message: `${headers.join("\r\n")}\r\n\r\n${body}`, recipient: address };
}

function displayQuoted(name: string, address: string): string {
  return `"${name.replace(/(["\\])/g, "\\$1")}" <${address}>`;
}
