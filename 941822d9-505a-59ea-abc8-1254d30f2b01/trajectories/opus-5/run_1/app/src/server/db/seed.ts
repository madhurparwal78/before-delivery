import type { PoolClient } from 'pg';
import { SCHEMA_SQL } from './schema.js';
import { one, query, withClient } from './pool.js';
import { seedId } from '../util/ids.js';
import { hashPassword } from '../util/password.js';
import { setProviderTimeZone } from '../domain/providerTime.js';

const SEED_PASSWORD = 'credwell-demo-1';

const PROVIDER = {
  id: seedId('org:sorrel-pike'),
  name: 'Sorrel & Pike Learning',
  slug: 'sorrel-pike',
  kind: 'provider',
  timeZone: 'America/Chicago',
  accreditationStatement:
    'Sorrel & Pike Learning is approved as a provider of nursing continuing professional development by the Meridian Council for Nursing Education.',
};

const HOSPITALS = [
  { id: seedId('org:harbourview'), name: 'Harbourview Regional Hospital', slug: 'harbourview', coverage: 5000 },
  { id: seedId('org:linden-valley'), name: 'Linden Valley Medical Center', slug: 'linden-valley', coverage: 3333 },
];

interface SeedUser {
  readonly email: string;
  readonly displayName: string;
  readonly role: string;
  readonly organisationSlug: string | null;
  readonly licenceNumber: string | null;
  readonly dateOfBirth: string | null;
}

const USERS: readonly SeedUser[] = [
  { email: 'planner@sorrelpike.test', displayName: 'Odette Marsh', role: 'planner', organisationSlug: 'sorrel-pike', licenceNumber: null, dateOfBirth: null },
  { email: 'author@sorrelpike.test', displayName: 'Felix Amari', role: 'author', organisationSlug: 'sorrel-pike', licenceNumber: null, dateOfBirth: null },
  { email: 'author2@sorrelpike.test', displayName: 'Priya Holloway', role: 'author', organisationSlug: 'sorrel-pike', licenceNumber: null, dateOfBirth: null },
  { email: 'coord@harbourview.test', displayName: 'Grace Tamura', role: 'coordinator', organisationSlug: 'harbourview', licenceNumber: null, dateOfBirth: null },
  { email: 'coord@lindenvalley.test', displayName: 'Marcus Eide', role: 'coordinator', organisationSlug: 'linden-valley', licenceNumber: null, dateOfBirth: null },
  { email: 'ana.ruiz@harbourview.test', displayName: 'Ana Ruiz', role: 'learner', organisationSlug: 'harbourview', licenceNumber: 'RN-4410293', dateOfBirth: '1988-03-14' },
  { email: 'ben.osei@harbourview.test', displayName: 'Ben Osei', role: 'learner', organisationSlug: 'harbourview', licenceNumber: 'RN-5520874', dateOfBirth: '1991-07-02' },
  { email: 'cara.lind@lindenvalley.test', displayName: 'Cara Lindqvist', role: 'learner', organisationSlug: 'linden-valley', licenceNumber: 'RN-6631055', dateOfBirth: '1985-11-23' },
  { email: 'eli.brandt@lindenvalley.test', displayName: 'Eli Brandt', role: 'learner', organisationSlug: 'linden-valley', licenceNumber: 'RN-8853277', dateOfBirth: '1979-05-09' },
  { email: 'dev.patel@mail.test', displayName: 'Dev Patel', role: 'learner', organisationSlug: null, licenceNumber: 'RN-7742166', dateOfBirth: '1993-01-30' },
];

interface SeedModule {
  readonly title: string;
  readonly minutes: number;
  readonly kind: 'lesson' | 'evaluation';
  readonly body?: string;
  readonly prompt?: string;
  readonly options?: readonly string[];
  readonly answerIndex?: number;
}

interface SeedCohort {
  readonly name: string;
  readonly seatCap: number;
  readonly startsOn: string;
  readonly closeDate: string;
}

interface SeedCourse {
  readonly key: string;
  readonly title: string;
  readonly summary: string;
  readonly format: 'self_paced' | 'cohort';
  readonly state: 'draft' | 'in_review' | 'published' | 'withdrawn';
  readonly authorEmail: string;
  readonly listPriceCents: number;
  readonly modules: readonly SeedModule[];
  readonly cohorts?: readonly SeedCohort[];
}

const COURSES: readonly SeedCourse[] = [
  {
    key: 'sepsis',
    title: 'Sepsis Recognition in the First Hour',
    summary:
      'Spot the early signals of sepsis at the bedside and start the hour-one bundle without waiting for a confirmed diagnosis.',
    format: 'self_paced',
    state: 'published',
    authorEmail: 'author@sorrelpike.test',
    listPriceCents: 9000,
    modules: [
      {
        title: 'Early warning signs',
        minutes: 20,
        kind: 'lesson',
        body:
          'Sepsis rarely announces itself. It shows up as a cluster of small changes in a patient you already suspect of having an infection: a heart rate that has crept up, a respiratory rate that no longer settles, a blood pressure drifting below the patient\u2019s own baseline, or a sudden vagueness in someone who was oriented an hour ago. Screening is therefore a habit rather than an event. Whenever infection is suspected, read the vital signs as a set and compare them with the patient\u2019s own earlier numbers rather than with a textbook range. A single abnormal value in a patient with suspected infection is enough to prompt a screen, and screening early costs far less than a missed hour.',
        prompt: 'Which finding should prompt a sepsis screen?',
        options: [
          'Suspected infection with a new heart rate above 90',
          'A blood pressure at the patient\u2019s usual baseline',
          'A request for an extra blanket',
        ],
        answerIndex: 0,
      },
      {
        title: 'Lactate and cultures',
        minutes: 25,
        kind: 'lesson',
        body:
          'An initial lactate tells you how much the tissues are struggling, and a repeat lactate tells you whether your treatment is working. Blood cultures answer a different question: which organism, and which antibiotic. Because antibiotics sterilise the blood within minutes, cultures are drawn before the first dose \u2014 but drawing them must never delay that dose. In practice this means preparing culture bottles and antibiotics together, so the sequence is cultures then antibiotics within the same few minutes. If access is difficult and the antibiotic is ready, give the antibiotic and document why cultures followed.',
        prompt: 'When are blood cultures drawn relative to antibiotics?',
        options: [
          'After the first antibiotic dose',
          'Before the first antibiotic dose, without delaying it',
          'Only if the lactate is normal',
        ],
        answerIndex: 1,
      },
      {
        title: 'Hour-one bundle',
        minutes: 15,
        kind: 'lesson',
        body:
          'The hour-one bundle is a short list of things that should be under way within sixty minutes of recognition: measure lactate, draw cultures, give broad-spectrum antibiotics, begin fluid resuscitation where there is hypotension or a raised lactate, and add vasopressors if the pressure stays low during or after fluids. Nothing on the list is exotic. The difficulty is always sequencing under interruption, which is why the bundle is written down, assigned out loud, and timed from the moment of recognition rather than from the moment of the order.',
        prompt: 'What does the hour-one bundle aim to start within the first hour?',
        options: [
          'A routine chest X-ray only',
          'Discharge planning',
          'Antibiotics and fluid resuscitation where indicated',
        ],
        answerIndex: 2,
      },
      { title: 'Post-evaluation', minutes: 15, kind: 'evaluation' },
    ],
  },
  {
    key: 'opioid',
    title: 'Safe Opioid Stewardship',
    summary:
      'Assess pain, dose opioids with the right monitoring, and hand over safely so the next nurse knows the sedation picture.',
    format: 'cohort',
    state: 'published',
    authorEmail: 'author2@sorrelpike.test',
    listPriceCents: 14000,
    modules: [
      {
        title: 'Pain assessment',
        minutes: 30,
        kind: 'lesson',
        body:
          'A pain score is only as good as the tool that produced it. A patient who can speak and understand the question is best served by a simple numeric scale, used the same way each shift so the trend means something. A patient who cannot self-report \u2014 intubated, delirious, deeply sedated, or living with advanced dementia \u2014 needs an observational tool that scores facial expression, body movement, muscle tension and ventilator or vocal response. Choosing the wrong tool produces a number that reads as reassurance while the patient is still in pain.',
        prompt: 'Which tool fits a patient who cannot self-report pain?',
        options: ['A behavioural pain scale', 'A 0 to 10 numeric scale', 'A sleep diary'],
        answerIndex: 0,
      },
      {
        title: 'Dosing and monitoring',
        minutes: 40,
        kind: 'lesson',
        body:
          'Opioid-induced respiratory depression is preceded by sedation far more reliably than by any change in respiratory rate. A patient who is increasingly difficult to rouse between doses is telling you that the next dose is unsafe, even if their rate is still twelve. Pair every dose with a sedation score, watch for the patient who is sleeping through conversation, and treat snoring or paradoxical breathing as a warning. Itching and constipation are common and uncomfortable, but they are not the signals that should stop a dose.',
        prompt: 'Which sign is the most important warning of opioid-induced respiratory depression?',
        options: ['Itching', 'Increasing sedation', 'Constipation'],
        answerIndex: 1,
      },
      {
        title: 'Naloxone and handoffs',
        minutes: 30,
        kind: 'lesson',
        body:
          'Naloxone reverses the opioid but not the pain, so a plan for after the reversal belongs in the same conversation as the dose itself. The handoff is where that plan survives a shift change. Say the last dose and the time it was given, the current sedation level and its trend, and what the naloxone plan is \u2014 where the vial is, what dose, and who to call. A handoff that lists only the next dose time hands over the schedule and keeps the risk.',
        prompt: 'What should a handoff include for a patient on opioids?',
        options: [
          'Only the next dose time',
          'The diet order',
          'Last dose, sedation level and naloxone plan',
        ],
        answerIndex: 2,
      },
      { title: 'Post-evaluation', minutes: 20, kind: 'evaluation' },
    ],
    cohorts: [
      { name: 'Spring evening cohort', seatCap: 1, startsOn: '2030-04-06', closeDate: '2030-04-03' },
      { name: 'Winter archive cohort', seatCap: 20, startsOn: '2026-01-20', closeDate: '2026-01-15' },
    ],
  },
  {
    key: 'delirium',
    title: 'Delirium Screening at the Bedside',
    summary: 'Run a short delirium screen on every shift and act on a positive result the same hour.',
    format: 'self_paced',
    state: 'published',
    authorEmail: 'author@sorrelpike.test',
    listPriceCents: 4550,
    modules: [
      {
        title: 'Screening tools',
        minutes: 25,
        kind: 'lesson',
        body:
          'Delirium is defined by change. A screening tool therefore starts by asking whether this patient\u2019s mental status is acutely different from their baseline, or fluctuating through the day, before it looks at attention, thinking or level of consciousness. A long-standing memory complaint or a family history of dementia is context, not a positive screen. The screen takes two minutes, it is repeated each shift, and its value comes from the comparison with yesterday rather than from any single answer.',
        prompt: 'What does a delirium screen look for first?',
        options: [
          'An acute change or fluctuation in mental status',
          'A long-standing memory complaint',
          'A family history of dementia',
        ],
        answerIndex: 0,
      },
      {
        title: 'Acting on a positive screen',
        minutes: 20,
        kind: 'lesson',
        body:
          'A positive screen is a prompt to look for a cause, not a diagnosis to be managed with restraint. Notify the provider, then work through the reversible causes you can check yourself: pain, a full bladder, new medicines, infection, dehydration, hypoxia, missing glasses or hearing aids, and a day without daylight or sleep. Restraints and waiting for the next shift\u2019s screen both delay the only thing that helps, which is finding and removing the cause.',
        prompt: 'After a positive delirium screen, what comes first?',
        options: [
          'Restrain the patient',
          'Notify the provider and look for causes',
          'Wait for the next shift\u2019s screen',
        ],
        answerIndex: 1,
      },
      { title: 'Post-evaluation', minutes: 10, kind: 'evaluation' },
    ],
  },
  {
    key: 'wound',
    title: 'Wound Care Documentation Essentials',
    summary: 'Describe, measure and photograph a wound so the next clinician can see what you saw.',
    format: 'self_paced',
    state: 'draft',
    authorEmail: 'author@sorrelpike.test',
    listPriceCents: 7500,
    modules: [
      {
        title: 'Describing the wound bed',
        minutes: 30,
        kind: 'lesson',
        body:
          'Wound notes are read by people who cannot see the wound, so the vocabulary has to be exact. Granulation tissue is red, moist and granular, and it means the wound is building. Slough is soft, stringy and yellow or tan. Eschar is dry, leathery and dark. Record the proportion of each across the wound bed, then the edges, the surrounding skin and the exudate by amount, colour and odour. "Looks better" tells the next clinician nothing they can act on.',
        prompt: 'Which term describes red, granular, healthy tissue?',
        options: ['Slough', 'Eschar', 'Granulation tissue'],
        answerIndex: 2,
      },
      {
        title: 'Measuring and photographing',
        minutes: 30,
        kind: 'lesson',
        body:
          'Measurements are only comparable if everyone takes them the same way. Length runs head to toe, width runs side to side at the widest point perpendicular to that, and depth is measured at the deepest point with a moistened swab held against a ruler. Photographs need a disposable scale in frame, consistent lighting, the patient identifier per local policy, and the same angle each time. Undermining and tunnelling are recorded by depth and clock position.',
        prompt: 'How is wound length measured?',
        options: [
          'In the head-to-toe direction',
          'At the widest point side to side',
          'At the deepest point',
        ],
        answerIndex: 0,
      },
      { title: 'Post-evaluation', minutes: 10, kind: 'evaluation' },
    ],
  },
  {
    key: 'pediatric',
    title: 'Pediatric Fever Triage',
    summary: 'Sort febrile children by age and red flags so the ones who need an urgent look get it first.',
    format: 'self_paced',
    state: 'in_review',
    authorEmail: 'author2@sorrelpike.test',
    listPriceCents: 6000,
    modules: [
      {
        title: 'Fever thresholds by age',
        minutes: 25,
        kind: 'lesson',
        body:
          'Age drives the urgency of a febrile child far more than the height of the temperature. Any infant under 28 days old with a fever needs urgent evaluation, because the immune response at that age gives little warning before serious illness. Between one and three months the threshold is still low. By the time a child is drinking, playing and interacting normally at four years old, a fever alone is a symptom to be followed rather than an emergency, and a temperature after exertion in an older child may not be a fever at all.',
        prompt: 'Which infant with fever needs urgent evaluation?',
        options: [
          'Any infant under 28 days old',
          'A 4-year-old who is drinking well',
          'A 10-year-old after exercise',
        ],
        answerIndex: 0,
      },
      {
        title: 'Red flags',
        minutes: 20,
        kind: 'lesson',
        body:
          'Red flags in a febrile child are the findings that move a patient to the front of the queue whatever the temperature reads: a non-blanching rash, a bulging fontanelle, neck stiffness, inconsolable or high-pitched crying, mottled or ashen skin, a seizure, reduced urine output, or a parent telling you this illness is unlike any other. A runny nose and a child who plays between doses of antipyretic are reassuring, and should be recorded as such.',
        prompt: 'Which is a red flag in a febrile child?',
        options: ['Playing between doses', 'A non-blanching rash', 'A runny nose'],
        answerIndex: 1,
      },
      { title: 'Post-evaluation', minutes: 5, kind: 'evaluation' },
    ],
  },
];

async function seedOrganisations(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO organisations (id, name, slug, kind, time_zone, accreditation_statement)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
    [PROVIDER.id, PROVIDER.name, PROVIDER.slug, PROVIDER.kind, PROVIDER.timeZone, PROVIDER.accreditationStatement],
  );
  for (const hospital of HOSPITALS) {
    await client.query(
      `INSERT INTO organisations (id, name, slug, kind, time_zone, accreditation_statement)
       VALUES ($1, $2, $3, 'hospital', NULL, NULL) ON CONFLICT (id) DO NOTHING`,
      [hospital.id, hospital.name, hospital.slug],
    );
    const existing = await one<{ id: string }>(
      client,
      'SELECT id FROM coverage_policies WHERE organisation_id = $1 LIMIT 1',
      [hospital.id],
    );
    if (existing === null) {
      await client.query(
        `INSERT INTO coverage_policies (id, organisation_id, coverage_percent_hundredths, effective_on)
         VALUES ($1, $2, $3, '2000-01-01')`,
        [seedId(`coverage:${hospital.slug}`), hospital.id, hospital.coverage],
      );
    }
  }
}

async function seedUsers(client: PoolClient): Promise<void> {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  for (const user of USERS) {
    await client.query(
      `INSERT INTO users (id, email, display_name, role, organisation_id, licence_number, date_of_birth, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [
        seedId(`user:${user.email}`),
        user.email,
        user.displayName,
        user.role,
        user.organisationSlug === null ? null : seedId(`org:${user.organisationSlug}`),
        user.licenceNumber,
        user.dateOfBirth,
        passwordHash,
      ],
    );
  }
}

async function seedCourses(client: PoolClient): Promise<void> {
  for (const course of COURSES) {
    const courseId = seedId(`course:${course.key}`);
    const existing = await one<{ id: string }>(client, 'SELECT id FROM courses WHERE id = $1', [courseId]);
    if (existing !== null) continue;
    await client.query(
      `INSERT INTO courses (id, title, summary, format, state, list_price_cents, version, author_id)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7)`,
      [
        courseId,
        course.title,
        course.summary,
        course.format,
        course.state,
        course.listPriceCents,
        seedId(`user:${course.authorEmail}`),
      ],
    );
    for (const [index, module] of course.modules.entries()) {
      await client.query(
        `INSERT INTO course_modules
           (id, course_id, position, title, minutes, kind, body, question_prompt, question_options, answer_index)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          seedId(`module:${course.key}:${index}`),
          courseId,
          index,
          module.title,
          module.minutes,
          module.kind,
          module.body ?? null,
          module.prompt ?? null,
          module.options === undefined ? null : JSON.stringify(module.options),
          module.answerIndex ?? null,
        ],
      );
    }
    for (const cohort of course.cohorts ?? []) {
      await client.query(
        `INSERT INTO cohorts (id, course_id, name, seat_cap, starts_on, close_date)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [seedId(`cohort:${course.key}:${cohort.name}`), courseId, cohort.name, cohort.seatCap, cohort.startsOn, cohort.closeDate],
      );
    }
  }
}

export interface ProviderRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly timeZone: string;
  readonly accreditationStatement: string;
}

let providerRecord: ProviderRecord | null = null;

export function provider(): ProviderRecord {
  if (providerRecord === null) throw new Error('The provider record is read at startup');
  return providerRecord;
}

export async function applySchemaAndSeed(): Promise<void> {
  await withClient(async (client) => {
    await client.query(SCHEMA_SQL);
    await seedOrganisations(client);
    await seedUsers(client);
    await seedCourses(client);
    const rows = await query<{
      id: string;
      name: string;
      slug: string;
      time_zone: string;
      accreditation_statement: string;
    }>(client, `SELECT id, name, slug, time_zone, accreditation_statement FROM organisations WHERE kind = 'provider' LIMIT 1`);
    const row = rows[0];
    if (row === undefined) throw new Error('The provider organisation is missing after seeding');
    providerRecord = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      timeZone: row.time_zone,
      accreditationStatement: row.accreditation_statement,
    };
    setProviderTimeZone(row.time_zone);
  });
}
