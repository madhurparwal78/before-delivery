import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Pool, PoolClient } from "pg";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS organisations (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('provider','hospital')),
  timezone text NOT NULL DEFAULT 'America/Chicago',
  accreditation_statement text
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('learner','coordinator','planner','author')),
  organisation_id uuid REFERENCES organisations(id),
  licence_number text,
  date_of_birth date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coverage_policies (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES organisations(id),
  coverage_percent numeric(5,2) NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_on date NOT NULL,
  UNIQUE (hospital_id, effective_from)
);

CREATE TABLE IF NOT EXISTS coverage_scheduled (
  hospital_id uuid PRIMARY KEY REFERENCES organisations(id),
  coverage_percent numeric(5,2) NOT NULL,
  effective_on date NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  summary text NOT NULL,
  format text NOT NULL CHECK (format IN ('self_paced','cohort')),
  state text NOT NULL CHECK (state IN ('draft','in_review','published','withdrawn')),
  list_price_cents integer NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id),
  version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_history (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  from_state text NOT NULL,
  to_state text NOT NULL,
  by_user_id uuid NOT NULL REFERENCES users(id),
  note text,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS modules (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position integer NOT NULL,
  title text NOT NULL,
  minutes integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('lesson','evaluation')),
  body text,
  question_prompt text,
  question_options jsonb,
  answer_index integer,
  UNIQUE (course_id, position)
);

CREATE TABLE IF NOT EXISTS cohorts (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name text NOT NULL,
  starts_on date NOT NULL,
  close_date date NOT NULL,
  seat_cap integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id uuid PRIMARY KEY,
  cohort_id uuid NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  nurse_id uuid NOT NULL REFERENCES users(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  UNIQUE (cohort_id, nurse_id)
);

CREATE TABLE IF NOT EXISTS enrolments (
  id uuid PRIMARY KEY,
  nurse_id uuid NOT NULL REFERENCES users(id),
  course_id uuid NOT NULL REFERENCES courses(id),
  cohort_id uuid REFERENCES cohorts(id),
  state text NOT NULL CHECK (state IN ('held','confirmed','completed','certified','refunded','withdrawn')),
  funding text NOT NULL CHECK (funding IN ('card','co_pay','seat')),
  assignment_id uuid,
  hospital_id uuid REFERENCES organisations(id),
  list_price_cents integer NOT NULL,
  employer_share_cents integer NOT NULL,
  learner_share_cents integer NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrolments_active_per_course
  ON enrolments (nurse_id, course_id)
  WHERE state IN ('held','confirmed','completed','certified');

CREATE TABLE IF NOT EXISTS module_verifications (
  enrolment_id uuid NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enrolment_id, module_id)
);

CREATE TABLE IF NOT EXISTS evaluations (
  enrolment_id uuid PRIMARY KEY REFERENCES enrolments(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  met_outcomes boolean NOT NULL,
  comment text,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS certificate_sequence (
  id integer PRIMARY KEY,
  seq bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS certificates (
  id uuid PRIMARY KEY,
  enrolment_id uuid NOT NULL UNIQUE REFERENCES enrolments(id) ON DELETE CASCADE,
  nurse_id uuid NOT NULL REFERENCES users(id),
  serial text NOT NULL UNIQUE,
  contact_hours_h integer NOT NULL,
  current_version integer NOT NULL,
  state text NOT NULL CHECK (state IN ('sealing','sealed','revoked')),
  reissue_pending boolean NOT NULL DEFAULT false,
  issued_on date,
  origin text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS certificate_versions (
  certificate_id uuid NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  version integer NOT NULL,
  state text NOT NULL CHECK (state IN ('sealing','sealed','reissued','revoked')),
  nurse_name text NOT NULL,
  sealed_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (certificate_id, version)
);

CREATE TABLE IF NOT EXISTS share_links (
  id uuid PRIMARY KEY,
  certificate_id uuid NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('active','revoked','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS download_tokens (
  token text PRIMARY KEY,
  certificate_id uuid NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  version integer NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS packs (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES organisations(id),
  course_id uuid NOT NULL REFERENCES courses(id),
  seats integer NOT NULL,
  price_cents integer NOT NULL,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  expired boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS ledger_movements (
  id uuid PRIMARY KEY,
  pack_id uuid NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('purchase','assignment','return','expiry')),
  assignment_id uuid,
  posted_at timestamptz NOT NULL DEFAULT now(),
  seq bigint GENERATED ALWAYS AS IDENTITY
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  movement_id uuid NOT NULL REFERENCES ledger_movements(id) ON DELETE CASCADE,
  pack_id uuid NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  account text NOT NULL,
  seats integer NOT NULL,
  PRIMARY KEY (movement_id, account)
);

CREATE TABLE IF NOT EXISTS seat_assignments (
  id uuid PRIMARY KEY,
  pack_id uuid NOT NULL REFERENCES packs(id),
  nurse_id uuid NOT NULL REFERENCES users(id),
  enrolment_id uuid UNIQUE REFERENCES enrolments(id),
  state text NOT NULL CHECK (state IN ('assigned','returned'))
);

CREATE TABLE IF NOT EXISTS refund_requests (
  id uuid PRIMARY KEY,
  enrolment_id uuid NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('pending','approved','declined')),
  reason text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  refund_total_cents integer,
  employer_refund_cents integer,
  learner_refund_cents integer,
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_note text
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_pending_per_enrolment
  ON refund_requests (enrolment_id) WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  key text NOT NULL,
  scope text NOT NULL,
  body_hash text NOT NULL,
  status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key, scope)
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS export_records (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES organisations(id),
  row_count integer NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id uuid PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);
`;

export const SEED_PASSWORD = "credwell-demo-1";

const COURSE_SEEDS: Array<{
  key: string;
  title: string;
  summary: string;
  format: "self_paced" | "cohort";
  state: "draft" | "in_review" | "published" | "withdrawn";
  priceCents: number;
  authorKey: string;
  modules: Array<{
    title: string;
    minutes: number;
    body: string;
    prompt: string;
    options: string[];
    answerIndex: number;
  }>;
  evaluationMinutes: number;
  cohorts?: Array<{ name: string; cap: number; startsOn: string; closeDate: string }>;
}> = [
  {
    key: "sepsis",
    title: "Sepsis Recognition in the First Hour",
    summary: "Recognise sepsis early, interpret lactate and cultures, and start the hour-one bundle without delay.",
    format: "self_paced",
    state: "published",
    priceCents: 9000,
    authorKey: "author",
    modules: [
      {
        title: "Early warning signs",
        minutes: 20,
        body: "Sepsis is a life-threatening response to infection. At the bedside, the earliest reliable signals are a new heart rate above 90, a rising respiratory rate, altered mentation, and a temperature drift in either direction. Screen any patient with a suspected infection whose vital signs have changed from their own baseline, and treat a rising heart rate in a normally bradycardic patient as a serious sign.",
        prompt: "Which finding should prompt a sepsis screen?",
        options: [
          "Suspected infection with a new heart rate above 90",
          "A blood pressure at the patient's usual baseline",
          "A request for an extra blanket",
        ],
        answerIndex: 0,
      },
      {
        title: "Lactate and cultures",
        minutes: 25,
        body: "Blood cultures guide de-escalation days later, so draw them before the first antibiotic dose whenever it does not delay treatment. A lactate above 2 mmol/L signals tissue hypoperfusion and should be rechecked after resuscitation to confirm clearance. Neither test should postpone the hour-one bundle.",
        prompt: "When are blood cultures drawn relative to antibiotics?",
        options: [
          "After the first antibiotic dose",
          "Before the first antibiotic dose, without delaying it",
          "Only if the lactate is normal",
        ],
        answerIndex: 1,
      },
      {
        title: "Hour-one bundle",
        minutes: 15,
        body: "The hour-one bundle aims to deliver broad-spectrum antibiotics and begin fluid resuscitation within sixty minutes of recognising sepsis. Vasopressors follow if fluids fail to restore perfusion. Document the times: recognition, antibiotic administration, and fluid start all anchor the record.",
        prompt: "What does the hour-one bundle aim to start within the first hour?",
        options: [
          "A routine chest X-ray only",
          "Discharge planning",
          "Antibiotics and fluid resuscitation where indicated",
        ],
        answerIndex: 2,
      },
    ],
    evaluationMinutes: 15,
  },
  {
    key: "opioid",
    title: "Safe Opioid Stewardship",
    summary: "Assess pain safely in every patient, dose and monitor opioids, and hand off naloxone plans with confidence.",
    format: "cohort",
    state: "published",
    priceCents: 14000,
    authorKey: "author2",
    modules: [
      {
        title: "Pain assessment",
        minutes: 30,
        body: "Not every patient can point to a number. When self-report is impossible, use a validated behavioural scale such as the PAINAD, watching for grimacing, restlessness, and changes in vocalisation. Reassess after every intervention and document both the score and the behaviour behind it.",
        prompt: "Which tool fits a patient who cannot self-report pain?",
        options: ["A behavioural pain scale", "A 0 to 10 numeric scale", "A sleep diary"],
        answerIndex: 0,
      },
      {
        title: "Dosing and monitoring",
        minutes: 40,
        body: "Opioid-induced respiratory depression announces itself as rising sedation well before breathing slows. Sedation scales predict risk better than pain scores alone, so check sedation with every dose and hold the opioid when the patient becomes difficult to rouse. Constipation and itching are common but rarely emergencies.",
        prompt: "Which sign is the most important warning of opioid-induced respiratory depression?",
        options: ["Itching", "Increasing sedation", "Constipation"],
        answerIndex: 1,
      },
      {
        title: "Naloxone and handoffs",
        minutes: 30,
        body: "A safe handoff on opioids names the last dose time, the current sedation level, and the naloxone plan in one line. Naloxone reverses respiratory depression fast and wears off faster, so a reversed patient needs continued observation. Never let the plan live only in the chart.",
        prompt: "What should a handoff include for a patient on opioids?",
        options: ["Only the next dose time", "The diet order", "Last dose, sedation level and naloxone plan"],
        answerIndex: 2,
      },
    ],
    evaluationMinutes: 20,
    cohorts: [
      { name: "Spring evening cohort", cap: 1, startsOn: "2030-04-06", closeDate: "2030-04-03" },
      { name: "Winter archive cohort", cap: 20, startsOn: "2026-01-20", closeDate: "2026-01-15" },
    ],
  },
  {
    key: "delirium",
    title: "Delirium Screening at the Bedside",
    summary: "Screen for delirium with the right tool, and act on a positive result before the shift ends.",
    format: "self_paced",
    state: "published",
    priceCents: 4550,
    authorKey: "author",
    modules: [
      {
        title: "Screening tools",
        minutes: 25,
        body: "Delirium is an acute change or fluctuation in mental status, and every validated screen hunts for exactly that. Ask about the patient's baseline first, then compare. A long-standing memory complaint points elsewhere, and family history of dementia is not a screen finding at all.",
        prompt: "What does a delirium screen look for first?",
        options: [
          "An acute change or fluctuation in mental status",
          "A long-standing memory complaint",
          "A family history of dementia",
        ],
        answerIndex: 0,
      },
      {
        title: "Acting on a positive screen",
        minutes: 20,
        body: "A positive screen is a trigger, not a diagnosis. Notify the provider, then look for reversible causes: infection, retention, electrolytes, new medications, and uncontrolled pain. Restraint and sedation both deepen delirium and wait for no one.",
        prompt: "After a positive delirium screen, what comes first?",
        options: ["Restrain the patient", "Notify the provider and look for causes", "Wait for the next shift's screen"],
        answerIndex: 1,
      },
    ],
    evaluationMinutes: 10,
  },
  {
    key: "wound",
    title: "Wound Care Documentation Essentials",
    summary: "Describe wound beds accurately, measure and photograph wounds so the next nurse can compare like with like.",
    format: "self_paced",
    state: "draft",
    priceCents: 7500,
    authorKey: "author",
    modules: [
      {
        title: "Describing the wound bed",
        minutes: 30,
        body: "Granulation tissue is red, granular and a sign of healing. Slough is yellow or stringy devitalised tissue; eschar is hard, dry and dark. Record what you see in words the next nurse will recognise, and never let colour stand alone.",
        prompt: "Which term describes red, granular, healthy tissue?",
        options: ["Slough", "Eschar", "Granulation tissue"],
        answerIndex: 2,
      },
      {
        title: "Measuring and photographing",
        minutes: 30,
        body: "Length runs head to toe, width runs side to side, and depth is measured at the deepest point, always in centimetres. Photograph from the same angle and distance each time, with a measuring guide in frame, so the series can be compared honestly.",
        prompt: "How is wound length measured?",
        options: ["In the head-to-toe direction", "At the widest point side to side", "At the deepest point"],
        answerIndex: 0,
      },
    ],
    evaluationMinutes: 10,
  },
  {
    key: "peds_fever",
    title: "Pediatric Fever Triage",
    summary: "Triage febrile children by age and red flags, and know which infants need urgent evaluation.",
    format: "self_paced",
    state: "in_review",
    priceCents: 6000,
    authorKey: "author2",
    modules: [
      {
        title: "Fever thresholds by age",
        minutes: 25,
        body: "Any infant under 28 days with a fever needs urgent evaluation, whatever the examination looks like. Between one and three months the threshold stays low and the workup stays cautious. Older children are triaged by behaviour and red flags, not by the number alone.",
        prompt: "Which infant with fever needs urgent evaluation?",
        options: ["Any infant under 28 days old", "A 4-year-old who is drinking well", "A 10-year-old after exercise"],
        answerIndex: 0,
      },
      {
        title: "Red flags",
        minutes: 20,
        body: "In a febrile child, a non-blanching rash, listlessness, grunting respirations and a stiff neck all demand immediate escalation. A child who plays between doses and drinks well is reassuring but still needs a follow-up plan and clear safety-netting advice for the family.",
        prompt: "Which is a red flag in a febrile child?",
        options: ["Playing between doses", "A non-blanching rash", "A runny nose"],
        answerIndex: 1,
      },
    ],
    evaluationMinutes: 5,
  },
];

export async function applySchemaAndSeed(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(SCHEMA_SQL);

    const providerId = "e0000000-0000-4000-8000-000000000001";
    const harbourviewId = "e0000000-0000-4000-8000-000000000002";
    const lindenId = "e0000000-0000-4000-8000-000000000003";

    await client.query(
      `INSERT INTO organisations (id, name, slug, kind, timezone, accreditation_statement) VALUES
        ($1,'Sorrel & Pike Learning','sorrel-pike','provider','America/Chicago',
         'Sorrel & Pike Learning is approved as a provider of nursing continuing professional development by the Meridian Council for Nursing Education.'),
        ($2,'Harbourview Regional Hospital','harbourview','hospital','America/Chicago',NULL),
        ($3,'Linden Valley Medical Center','linden-valley','hospital','America/Chicago',NULL)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind,
         timezone = EXCLUDED.timezone, accreditation_statement = EXCLUDED.accreditation_statement`,
      [providerId, harbourviewId, lindenId],
    );

    const users: Array<[string, string, "learner" | "coordinator" | "planner" | "author", string | null, string | null, string | null]> = [
      ["planner@sorrelpike.test", "Odette Marsh", "planner", providerId, null, null],
      ["author@sorrelpike.test", "Felix Amari", "author", providerId, null, null],
      ["author2@sorrelpike.test", "Priya Holloway", "author", providerId, null, null],
      ["coord@harbourview.test", "Grace Tamura", "coordinator", harbourviewId, null, null],
      ["coord@lindenvalley.test", "Marcus Eide", "coordinator", lindenId, null, null],
      ["ana.ruiz@harbourview.test", "Ana Ruiz", "learner", harbourviewId, "RN-4410293", "1988-03-14"],
      ["ben.osei@harbourview.test", "Ben Osei", "learner", harbourviewId, "RN-5520874", "1991-07-02"],
      ["cara.lind@lindenvalley.test", "Cara Lindqvist", "learner", lindenId, "RN-6631055", "1985-11-23"],
      ["eli.brandt@lindenvalley.test", "Eli Brandt", "learner", lindenId, "RN-8853277", "1979-05-09"],
      ["dev.patel@mail.test", "Dev Patel", "learner", null, "RN-7742166", "1993-01-30"],
    ];

    const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
    for (const [email, name, role, orgId, licence, dob] of users) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, display_name, role, organisation_id, licence_number, date_of_birth)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (email) DO NOTHING`,
        [randomUUID(), email, passwordHash, name, role, orgId, licence, dob],
      );
    }

    const authorIds: Record<string, string> = {};
    for (const row of await client.query<{ id: string; email: string }>("SELECT id, email FROM users").then((r) => r.rows)) {
      authorIds[row.email] = row.id;
    }

    const courseIds: Record<string, string> = {
      sepsis: "c0000000-0000-4000-8000-000000000001",
      opioid: "c0000000-0000-4000-8000-000000000002",
      delirium: "c0000000-0000-4000-8000-000000000003",
      wound: "c0000000-0000-4000-8000-000000000004",
      peds_fever: "c0000000-0000-4000-8000-000000000005",
    };

    for (const seed of COURSE_SEEDS) {
      const authorEmail = seed.authorKey === "author" ? "author@sorrelpike.test" : "author2@sorrelpike.test";
      const authorId = authorIds[authorEmail];
      const existing = await client.query<{ version: number }>("SELECT version FROM courses WHERE id = $1", [courseIds[seed.key]]);
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO courses (id, title, summary, format, state, list_price_cents, author_id, version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,1)`,
          [courseIds[seed.key], seed.title, seed.summary, seed.format, seed.state, seed.priceCents, authorId],
        );
        let position = 1;
        for (const m of seed.modules) {
          await client.query(
            `INSERT INTO modules (id, course_id, position, title, minutes, kind, body, question_prompt, question_options, answer_index)
             VALUES ($1,$2,$3,$4,$5,'lesson',$6,$7,$8,$9)`,
            [randomUUID(), courseIds[seed.key], position++, m.title, m.minutes, m.body, m.prompt, JSON.stringify(m.options), m.answerIndex],
          );
        }
        await client.query(
          `INSERT INTO modules (id, course_id, position, title, minutes, kind)
           VALUES ($1,$2,$3,$4,$5,'evaluation')`,
          [randomUUID(), courseIds[seed.key], position++, "Post-evaluation", seed.evaluationMinutes],
        );
        for (const c of seed.cohorts ?? []) {
          await client.query(
            `INSERT INTO cohorts (id, course_id, name, starts_on, close_date, seat_cap)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT DO NOTHING`,
            [randomUUID(), courseIds[seed.key], c.name, c.startsOn, c.closeDate, c.cap],
          );
        }
      }
    }

    const coverage: Array<[string, number]> = [
      ["harbourview", 50.0],
      ["linden-valley", 33.33],
    ];
    for (const [slug, percent] of coverage) {
      await client.query(
        `INSERT INTO coverage_policies (id, hospital_id, coverage_percent, effective_from, effective_on)
         SELECT $1, o.id, $2, $3, $4 FROM organisations o
           LEFT JOIN coverage_policies p ON p.hospital_id = o.id
         WHERE o.slug = $5 AND p.id IS NULL`,
        [randomUUID(), percent, new Date(0), "1970-01-01", slug],
      );
    }

    await client.query(
      `INSERT INTO certificate_sequence (id, seq) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`,
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
