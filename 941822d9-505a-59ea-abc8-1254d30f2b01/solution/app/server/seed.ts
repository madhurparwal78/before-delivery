import { randomBytes, randomUUID } from "node:crypto";
import { one, tx } from "./db.js";
import { SCHEMA } from "./schema.js";
import { hashPassword, type Role } from "./domain/users.js";
import { cohortClosesAt } from "./domain/time.js";

// Seed data from the brief. Every person and organisation is invented.
const SEED_PASSWORD = "credwell-demo-1";
const PROVIDER_ZONE = "America/Chicago";

const ORGANISATIONS = [
  {
    slug: "sorrel-pike",
    name: "Sorrel & Pike Learning",
    kind: "provider",
    zone: PROVIDER_ZONE,
    statement:
      "Sorrel & Pike Learning is approved as a provider of nursing continuing professional development by the Meridian Council for Nursing Education.",
  },
  { slug: "harbourview", name: "Harbourview Regional Hospital", kind: "hospital", coverage: 5000 },
  { slug: "linden-valley", name: "Linden Valley Medical Center", kind: "hospital", coverage: 3333 },
] as const;

const USERS: { email: string; name: string; role: Role; org: string | null; licence?: string; dob?: string }[] = [
  { email: "planner@sorrelpike.test", name: "Odette Marsh", role: "planner", org: "sorrel-pike" },
  { email: "author@sorrelpike.test", name: "Felix Amari", role: "author", org: "sorrel-pike" },
  { email: "author2@sorrelpike.test", name: "Priya Holloway", role: "author", org: "sorrel-pike" },
  { email: "coord@harbourview.test", name: "Grace Tamura", role: "coordinator", org: "harbourview" },
  { email: "coord@lindenvalley.test", name: "Marcus Eide", role: "coordinator", org: "linden-valley" },
  { email: "ana.ruiz@harbourview.test", name: "Ana Ruiz", role: "learner", org: "harbourview", licence: "RN-4410293", dob: "1988-03-14" },
  { email: "ben.osei@harbourview.test", name: "Ben Osei", role: "learner", org: "harbourview", licence: "RN-5520874", dob: "1991-07-02" },
  { email: "cara.lind@lindenvalley.test", name: "Cara Lindqvist", role: "learner", org: "linden-valley", licence: "RN-6631055", dob: "1985-11-23" },
  { email: "eli.brandt@lindenvalley.test", name: "Eli Brandt", role: "learner", org: "linden-valley", licence: "RN-8853277", dob: "1979-05-09" },
  { email: "dev.patel@mail.test", name: "Dev Patel", role: "learner", org: null, licence: "RN-7742166", dob: "1993-01-30" },
];

type SeedModule = { title: string; minutes: number; body?: string; prompt?: string; options?: string[]; answer?: number };

const COURSES: {
  key: string;
  title: string;
  summary: string;
  format: "self_paced" | "cohort";
  state: "draft" | "in_review" | "published";
  author: string;
  price: number;
  modules: SeedModule[];
  cohorts?: { key: string; name: string; cap: number; startsOn: string; closeDate: string }[];
}[] = [
  {
    key: "sepsis",
    title: "Sepsis Recognition in the First Hour",
    summary: "Spot sepsis early at the bedside, screen with confidence and start the hour-one bundle without delay.",
    format: "self_paced",
    state: "published",
    author: "author@sorrelpike.test",
    price: 9000,
    modules: [
      {
        title: "Early warning signs",
        minutes: 20,
        body: "Sepsis often announces itself quietly: a new fever or a low temperature, a heart rate creeping past 90, a breathing rate that will not settle, or a patient who is suddenly less themselves. Any suspected infection paired with a new change in vital signs is a reason to screen, not to wait for the next round.",
        prompt: "Which finding should prompt a sepsis screen?",
        options: ["Suspected infection with a new heart rate above 90", "A blood pressure at the patient's usual baseline", "A request for an extra blanket"],
        answer: 0,
      },
      {
        title: "Lactate and cultures",
        minutes: 25,
        body: "A lactate level helps you gauge how hard the body is working to stay perfused, and a repeat value tells you whether resuscitation is helping. Blood cultures guide later treatment, so draw them before the first antibiotic dose whenever that does not delay it.",
        prompt: "When are blood cultures drawn relative to antibiotics?",
        options: ["After the first antibiotic dose", "Before the first antibiotic dose, without delaying it", "Only if the lactate is normal"],
        answer: 1,
      },
      {
        title: "Hour-one bundle",
        minutes: 15,
        body: "The hour-one bundle gathers the first actions that change outcomes: measure lactate, draw cultures, give broad-spectrum antibiotics, start fluids for low blood pressure or high lactate, and add vasopressors when pressure stays low. The clock starts when sepsis is first recognised.",
        prompt: "What does the hour-one bundle aim to start within the first hour?",
        options: ["A routine chest X-ray only", "Discharge planning", "Antibiotics and fluid resuscitation where indicated"],
        answer: 2,
      },
      { title: "Post-evaluation", minutes: 15 },
    ],
  },
  {
    key: "opioid",
    title: "Safe Opioid Stewardship",
    summary: "Assess pain well, dose and monitor opioids safely, and hand off every patient with a clear naloxone plan.",
    format: "cohort",
    state: "published",
    author: "author2@sorrelpike.test",
    price: 14000,
    modules: [
      {
        title: "Pain assessment",
        minutes: 30,
        body: "Good stewardship starts with a good assessment. Ask about location, quality and impact on function, and choose a tool that fits the patient in front of you. When a patient cannot tell you about their pain, watch for it in their face, body and behaviour instead.",
        prompt: "Which tool fits a patient who cannot self-report pain?",
        options: ["A behavioural pain scale", "A 0 to 10 numeric scale", "A sleep diary"],
        answer: 0,
      },
      {
        title: "Dosing and monitoring",
        minutes: 40,
        body: "Start low, go slow and reassess often. Sedation usually deepens before breathing slows, so a rising sedation score is your early warning. Pair every dose with a planned reassessment and know your unit's monitoring standard for patients at higher risk.",
        prompt: "Which sign is the most important warning of opioid-induced respiratory depression?",
        options: ["Itching", "Increasing sedation", "Constipation"],
        answer: 1,
      },
      {
        title: "Naloxone and handoffs",
        minutes: 30,
        body: "Naloxone should be close at hand and its use rehearsed. At every handoff, share the last dose and when it was given, the current sedation level and the naloxone plan, so the next nurse can act before a problem becomes an emergency.",
        prompt: "What should a handoff include for a patient on opioids?",
        options: ["Only the next dose time", "The diet order", "Last dose, sedation level and naloxone plan"],
        answer: 2,
      },
      { title: "Post-evaluation", minutes: 20 },
    ],
    cohorts: [
      { key: "opioid-spring", name: "Spring evening cohort", cap: 1, startsOn: "2030-04-06", closeDate: "2030-04-03" },
      { key: "opioid-winter", name: "Winter archive cohort", cap: 20, startsOn: "2026-01-20", closeDate: "2026-01-15" },
    ],
  },
  {
    key: "delirium",
    title: "Delirium Screening at the Bedside",
    summary: "Screen for delirium every shift, recognise an acute change and act on a positive screen.",
    format: "self_paced",
    state: "published",
    author: "author@sorrelpike.test",
    price: 4550,
    modules: [
      {
        title: "Screening tools",
        minutes: 25,
        body: "Delirium is an acute disturbance of attention and awareness that comes on over hours or days and tends to fluctuate. A good screen looks first for that acute change or fluctuation, then for inattention, disorganised thinking or an altered level of consciousness.",
        prompt: "What does a delirium screen look for first?",
        options: ["An acute change or fluctuation in mental status", "A long-standing memory complaint", "A family history of dementia"],
        answer: 0,
      },
      {
        title: "Acting on a positive screen",
        minutes: 20,
        body: "A positive screen is a finding to act on, not a label. Tell the provider, look for reversible causes such as infection, medications, pain, retention or dehydration, and use calm, orienting care. Physical restraint tends to make delirium worse.",
        prompt: "After a positive delirium screen, what comes first?",
        options: ["Restrain the patient", "Notify the provider and look for causes", "Wait for the next shift's screen"],
        answer: 1,
      },
      { title: "Post-evaluation", minutes: 10 },
    ],
  },
  {
    key: "wound",
    title: "Wound Care Documentation Essentials",
    summary: "Describe, measure and photograph wounds so every colleague can see the same wound in your notes.",
    format: "self_paced",
    state: "draft",
    author: "author@sorrelpike.test",
    price: 7500,
    modules: [
      {
        title: "Describing the wound bed",
        minutes: 30,
        body: "Name the tissue you see. Healthy healing tissue is red and granular, slough is soft and yellow or grey, and eschar is dry, dark and leathery. Estimate each as a share of the wound bed so change over time is easy to follow.",
        prompt: "Which term describes red, granular, healthy tissue?",
        options: ["Slough", "Eschar", "Granulation tissue"],
        answer: 2,
      },
      {
        title: "Measuring and photographing",
        minutes: 30,
        body: "Measure length head to toe, width side to side at right angles to the length, and depth at the deepest point. Photograph with a ruler and label in the frame, from the same angle and distance each time.",
        prompt: "How is wound length measured?",
        options: ["In the head-to-toe direction", "At the widest point side to side", "At the deepest point"],
        answer: 0,
      },
      { title: "Post-evaluation", minutes: 10 },
    ],
  },
  {
    key: "fever",
    title: "Pediatric Fever Triage",
    summary: "Triage febrile children safely by age and spot the red flags that need urgent evaluation.",
    format: "self_paced",
    state: "in_review",
    author: "author2@sorrelpike.test",
    price: 6000,
    modules: [
      {
        title: "Fever thresholds by age",
        minutes: 25,
        body: "Age changes everything in fever triage. Very young infants have immature immune responses and few reliable signs, so any fever in an infant under 28 days old needs urgent evaluation, whatever else you see.",
        prompt: "Which infant with fever needs urgent evaluation?",
        options: ["Any infant under 28 days old", "A 4-year-old who is drinking well", "A 10-year-old after exercise"],
        answer: 0,
      },
      {
        title: "Red flags",
        minutes: 20,
        body: "Look beyond the number on the thermometer. A non-blanching rash, a child who is hard to wake, a weak or high-pitched cry, or signs of poor perfusion are red flags that call for immediate escalation.",
        prompt: "Which is a red flag in a febrile child?",
        options: ["Playing between doses", "A non-blanching rash", "A runny nose"],
        answer: 1,
      },
      { title: "Post-evaluation", minutes: 5 },
    ],
  },
];

/** Applies the schema and the seed. Safe to run on every start: existing rows are left as they are. */
export async function migrateAndSeed(): Promise<void> {
  await tx(async (t) => {
    await t.q("SELECT pg_advisory_xact_lock(7342001)");
    await t.q(SCHEMA);
    await t.q("INSERT INTO signing_keys (name, secret) VALUES ('download', $1) ON CONFLICT (name) DO NOTHING", [randomBytes(32).toString("base64url")]);
    const startedAt = new Date();

    for (const org of ORGANISATIONS) {
      await t.q(
        `INSERT INTO organisations (slug, name, kind, time_zone, accreditation_statement)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (slug) DO NOTHING`,
        [org.slug, org.name, org.kind, "zone" in org ? org.zone : null, "statement" in org ? org.statement : null],
      );
      if ("coverage" in org) {
        await t.q(
          `INSERT INTO coverage_policies (hospital_id, percent_bp, effective_on, effective_at, recorded_at, seeded)
           SELECT id, $2, '2000-01-01', '-infinity', $3, true FROM organisations WHERE slug = $1
           ON CONFLICT (hospital_id) WHERE seeded DO NOTHING`,
          [org.slug, org.coverage, startedAt],
        );
      }
    }

    for (const user of USERS) {
      const exists = await one(t, "SELECT 1 FROM users WHERE email = $1", [user.email]);
      if (exists) continue;
      await t.q(
        `INSERT INTO users (email, display_name, role, organisation_id, licence_number, date_of_birth, password_hash)
         VALUES ($1, $2, $3, (SELECT id FROM organisations WHERE slug = $4), $5, $6, $7)`,
        [user.email, user.name, user.role, user.org, user.licence ?? null, user.dob ?? null, hashPassword(SEED_PASSWORD)],
      );
    }

    for (const course of COURSES) {
      const exists = await one(t, "SELECT 1 FROM courses WHERE seed_key = $1", [course.key]);
      if (exists) continue;
      const courseId = randomUUID();
      await t.q(
        `INSERT INTO courses (id, seed_key, title, summary, format, state, list_price_cents, version, author_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1, (SELECT id FROM users WHERE email = $8), $9)`,
        [courseId, course.key, course.title, course.summary, course.format, course.state, course.price, course.author, startedAt],
      );
      for (const [index, module] of course.modules.entries()) {
        const lesson = module.prompt !== undefined;
        await t.q(
          `INSERT INTO course_modules (course_id, position, title, minutes, kind, body, prompt, options, answer_index)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            courseId,
            index + 1,
            module.title,
            module.minutes,
            lesson ? "lesson" : "evaluation",
            module.body ?? null,
            module.prompt ?? null,
            module.options ? JSON.stringify(module.options) : null,
            module.answer ?? null,
          ],
        );
      }
      for (const cohort of course.cohorts ?? []) {
        await t.q(
          `INSERT INTO cohorts (seed_key, course_id, name, seat_cap, starts_on, close_date, closes_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [cohort.key, courseId, cohort.name, cohort.cap, cohort.startsOn, cohort.closeDate, cohortClosesAt(PROVIDER_ZONE, cohort.closeDate), startedAt],
        );
      }
    }
  });
}
