import { config } from '../config.js';
import {
  contentReadTime,
  searchableBody,
  upsertSearchEntry,
  type ContentKind,
  type ContentRow,
  type NewsSubject,
} from '../domain/content.js';
import type { Claim } from '../domain/claims.js';
import type { ContentStatus } from '../domain/lifecycle.js';
import { londonLocalToInstant } from '../domain/london.js';
import type { StaffRole } from '../domain/roles.js';
import { sampleFiles, sampleKey } from '../media/samples.js';
import { hashPassword } from '../http/session.js';
import { queueJob } from '../services/jobs.js';
import { storageIsUp } from '../services/probes.js';
import { objectExists } from '../services/storage.js';
import { pool, query, withTransaction, type Queryable } from './pool.js';

const SEED_NAME = 'open-record-seed-v1';
const SEED_LOCK_KEY = '8514321907002';
const SEED_PASSWORD = 'open-record-seed-2026';
const GRANT_EXPIRY = '2027-12-31T23:59:59Z';
const GRANTOR = 'ada.penrose@aldermoor.example';

type SeedStaff = { email: string; name: string; roles: readonly StaffRole[] };

const STAFF: readonly SeedStaff[] = [
  { email: 'ines.halloran@aldermoor.example', name: 'Ines Halloran', roles: ['editor'] },
  { email: 'tomas.reyes@aldermoor.example', name: 'Tomas Reyes', roles: ['editor', 'approver'] },
  { email: 'eleni.marsh@aldermoor.example', name: 'Eleni Marsh', roles: ['approver'] },
  { email: 'kofi.brennan@aldermoor.example', name: 'Kofi Brennan', roles: ['approver'] },
  { email: 'sana.qadir@aldermoor.example', name: 'Sana Qadir', roles: ['recruiter'] },
  { email: 'jules.okonkwo@aldermoor.example', name: 'Jules Okonkwo', roles: ['recruiter'] },
  { email: 'ada.penrose@aldermoor.example', name: 'Ada Penrose', roles: ['administrator'] },
  { email: 'noor.vance@aldermoor.example', name: 'Noor Vance', roles: [] },
];

const INES = 'ines.halloran@aldermoor.example';
const TOMAS = 'tomas.reyes@aldermoor.example';
const ELENI = 'eleni.marsh@aldermoor.example';
const KOFI = 'kofi.brennan@aldermoor.example';
const SANA = 'sana.qadir@aldermoor.example';
const JULES = 'jules.okonkwo@aldermoor.example';

type SeedRow = {
  subject: string;
  benchmark: string;
  eval_date: string;
  score: string;
};

const BENCHMARK_ROWS: readonly SeedRow[] = [
  { subject: 'kestrel-2', benchmark: 'ReasonBench-Hard', eval_date: '2026-09-14', score: '71.4' },
  { subject: 'halvard-3', benchmark: 'ReasonBench-Hard', eval_date: '2026-09-14', score: '68.2' },
  { subject: 'morrow-l', benchmark: 'ReasonBench-Hard', eval_date: '2026-09-14', score: '70.9' },
  { subject: 'kestrel-2', benchmark: 'LongDoc-QA', eval_date: '2026-09-14', score: '84.9' },
  { subject: 'halvard-3', benchmark: 'LongDoc-QA', eval_date: '2026-09-14', score: '80.6' },
  { subject: 'morrow-l', benchmark: 'LongDoc-QA', eval_date: '2026-09-14', score: '85.3' },
  { subject: 'kestrel-2', benchmark: 'CodeTrace', eval_date: '2026-09-14', score: '58.0' },
  { subject: 'morrow-l', benchmark: 'CodeTrace', eval_date: '2026-09-14', score: '61.5' },
  { subject: 'kestrel-1', benchmark: 'ReasonBench-Hard', eval_date: '2026-03-01', score: '62.7' },
  { subject: 'kestrel-3', benchmark: 'ReasonBench-Hard', eval_date: '2026-10-20', score: '76.0' },
  { subject: 'halvard-3', benchmark: 'ReasonBench-Hard', eval_date: '2026-10-20', score: '69.1' },
];

const KESTREL_2_BODY = `## What Kestrel 2 is
Kestrel 2 is our second general research model, trained for long, careful reading and multi-step reasoning. [claim:c1]

## How we evaluated it
Every score on this page comes from a recorded evaluation row with its date. We ran each comparator ourselves on the same harness on the same day. [claim:c2]

## Where it falls short
On CodeTrace, Kestrel 2 trails Morrow L. We publish that row beside the others.`;

const KESTREL_1_BODY = `## What Kestrel 1 was
Kestrel 1 was the first model we put on the open record, and it remains the baseline against which every later route is read. Its single recorded row is still here, with the date it was measured and the note that goes with it.`;

const WREN_1_BODY = `## What Wren 1 is
Wren 1 is a small, careful reader built for archives: long documents, uneven scans and footnotes that matter. It is held under embargo until its release instant, and no surface of this site mentions it before then.

## How we built it
We trained Wren 1 on licensed archive collections and on our own corpus of recorded notes, with a review step for every collection we added.`;

const KESTREL_3_BODY = `## What Kestrel 3 is
[claim:c1]`;

const KESTREL_2_CLAIMS: readonly Claim[] = [
  {
    id: 'c1',
    text: 'On ReasonBench-Hard, Kestrel 2 scores 71.4, 3.2 points above Halvard 3.',
    benchmark: 'ReasonBench-Hard',
    eval_date: '2026-09-14',
    comparator: 'halvard-3',
    stated_delta: '3.2',
  },
  {
    id: 'c2',
    text: 'On LongDoc-QA, Kestrel 2 scores 84.9, 4.3 points above Halvard 3.',
    benchmark: 'LongDoc-QA',
    eval_date: '2026-09-14',
    comparator: 'halvard-3',
    stated_delta: '4.3',
  },
];

const KESTREL_3_CLAIMS: readonly Claim[] = [
  {
    id: 'c1',
    text: 'On ReasonBench-Hard, Kestrel 3 scores 76.0, 6.9 points above Halvard 3.',
    benchmark: 'ReasonBench-Hard',
    eval_date: '2026-10-20',
    comparator: 'halvard-3',
    stated_delta: '6.9',
  },
];

type SeedContent = {
  id: string;
  kind: ContentKind;
  slug: string;
  title: string;
  summary: string;
  body: string;
  subject?: NewsSubject;
  tags?: readonly string[];
  claims?: readonly Claim[];
  linked_news_slug?: string;
  status: ContentStatus;
  author: string;
  publishedLocal?: string;
  releaseLocal?: string;
  scheduledBy?: string;
  release?: { safety: string; legal: string; clearedBy: string };
};

const CONTENT: readonly SeedContent[] = [
  {
    id: 'content-model-kestrel-2',
    kind: 'model',
    slug: 'kestrel-2',
    title: 'Kestrel 2',
    summary: 'Our second general research model, built for long, careful reading.',
    body: KESTREL_2_BODY,
    claims: KESTREL_2_CLAIMS,
    linked_news_slug: 'introducing-kestrel-2',
    status: 'published',
    author: TOMAS,
    publishedLocal: '2026-09-30T09:00',
    release: { safety: ELENI, legal: KOFI, clearedBy: ELENI },
  },
  {
    id: 'content-model-kestrel-1',
    kind: 'model',
    slug: 'kestrel-1',
    title: 'Kestrel 1',
    summary: 'Our first research model and the baseline for everything since.',
    body: KESTREL_1_BODY,
    claims: [],
    status: 'published',
    author: TOMAS,
    publishedLocal: '2026-03-12T10:00',
    release: { safety: ELENI, legal: KOFI, clearedBy: KOFI },
  },
  {
    id: 'content-model-wren-1',
    kind: 'model',
    slug: 'wren-1',
    title: 'Wren 1',
    summary: 'A small archive reader, held under embargo until its release instant.',
    body: WREN_1_BODY,
    claims: [],
    linked_news_slug: 'introducing-wren-1',
    status: 'scheduled',
    author: INES,
    releaseLocal: '2030-01-15T09:00',
    scheduledBy: ELENI,
    release: { safety: ELENI, legal: KOFI, clearedBy: KOFI },
  },
  {
    id: 'content-model-kestrel-3',
    kind: 'model',
    slug: 'kestrel-3',
    title: 'Kestrel 3',
    summary: 'A draft route for our third general research model.',
    body: KESTREL_3_BODY,
    claims: KESTREL_3_CLAIMS,
    status: 'draft',
    author: INES,
  },
  {
    id: 'content-news-introducing-kestrel-2',
    kind: 'news',
    slug: 'introducing-kestrel-2',
    title: 'Introducing Kestrel 2',
    summary: 'Kestrel 2 is on the open record, with every score tied to the row it came from.',
    body: `## What we are publishing today
Kestrel 2 is live on the open record. Its route carries the model's summary, the prose our editors wrote, the chart, and the table of rows that the chart is drawn from.

## Where the numbers come from
Each figure in the route is an evaluation row with a subject, a benchmark, a date and a score. We ran the comparators ourselves on the same harness on the same day, and we publish the row where Kestrel 2 trails as plainly as the two where it leads.

## What comes next
We will keep adding rows as the harness grows, and every new row will arrive with its date and its note attached.`,
    subject: 'research',
    tags: ['evaluations', 'release-notes'],
    status: 'published',
    author: TOMAS,
    publishedLocal: '2026-09-30T09:00',
  },
  {
    id: 'content-news-how-we-sign-off-a-release',
    kind: 'news',
    slug: 'how-we-sign-off-a-release',
    title: 'How we sign off a release',
    summary: 'Two approvers, one safety sign-off, one legal sign-off, and a record that keeps the names.',
    body: `## Two signatures, two people
A model route cannot be scheduled until its release record carries a safety sign-off and a legal sign-off from two different approvers, neither of whom wrote the route. The console refuses the second signature from the first signer, and it refuses any signature from the author.

## The claims are checked against the rows
Once both signatures are recorded, the claim validator reads every claim in the body and compares it with the recorded evaluation row it cites. A stated difference that does not match the recorded difference stops the release there.

## Authority can lapse
A signature is only as good as the authority behind it. If an approver's grant is revoked or expires before the record is cleared, their sign-off is voided and the record falls back to the signature that remains.`,
    subject: 'safety',
    tags: ['evaluations', 'governance'],
    status: 'published',
    author: INES,
    publishedLocal: '2026-08-20T11:00',
  },
  {
    id: 'content-news-interpretability-notes-autumn',
    kind: 'news',
    slug: 'interpretability-notes-autumn',
    title: 'Interpretability notes, autumn',
    summary: 'What our interpretability team learned this season about long-context attention.',
    body: `## Reading the middle of a document
Our interpretability team spent the season on the middle of long documents, where attention thins out and summaries go vague. We traced the heads that carry footnote references and found that two of them do most of the work.

## Probes we trust and probes we do not
Linear probes told us less than we hoped about planning. Causal patching told us more. We are writing up both, including the probes that failed, because a negative result still narrows the search.

## What we are publishing next
The next notes will cover retrieval heads in archive text, with the measurements written down as rows before any prose is drafted.`,
    subject: 'research',
    tags: ['interpretability'],
    status: 'published',
    author: TOMAS,
    publishedLocal: '2026-10-08T14:00',
  },
  {
    id: 'content-news-why-every-score-links-to-a-row',
    kind: 'news',
    slug: 'why-every-score-links-to-a-row',
    title: 'Why every score links to a row',
    summary: 'Our policy on published numbers: no figure without a row, and no row without a date.',
    body: `## The rule
No number appears on this site unless it is already written down as a row. Each row names its subject, its benchmark, its evaluation date and its score, and rows are never edited or removed once recorded.

## Why we bother
Retractions in this field are usually arithmetic, not malice: a figure copied from a slide, a comparator run on a different harness, a date quietly dropped. Linking each number to its row makes that kind of mistake visible before publication rather than after.

## What a reader can do
Every figure on a model route is a link to the row beneath it, so you can read the chart, follow the number into the table, and see the date it was measured on.`,
    subject: 'policy',
    tags: ['evaluations', 'governance'],
    status: 'published',
    author: INES,
    publishedLocal: '2026-07-02T10:00',
  },
  {
    id: 'content-news-an-update-on-corvane-group',
    kind: 'news',
    slug: 'an-update-on-corvane-group',
    title: 'An update on our work with Corvane Group',
    summary: 'How the lab sits inside the wider group, and what stays independent.',
    body: `## Where we sit
Aldermoor Labs is the frontier research arm of Corvane Group. The group funds the lab and holds its commercial agreements; the lab holds its own release process.

## What stays with the lab
Sign-off stays with the lab's approvers. No commercial deadline can schedule a route, and no partner can see a route before its embargo lifts.

## What changes for readers
Nothing on this site changes. Partner work appears here under the same rules as our own, with the same record behind it.`,
    subject: 'company',
    tags: ['partnerships'],
    status: 'published',
    author: TOMAS,
    publishedLocal: '2026-06-15T09:30',
  },
  {
    id: 'content-news-we-are-hiring-research-engineers',
    kind: 'news',
    slug: 'we-are-hiring-research-engineers',
    title: 'We are hiring research engineers',
    summary: 'Open roles across our London, Edinburgh, Zurich and Toronto offices.',
    body: `## Who we are looking for
We are hiring research engineers and scientists who like writing things down. If you have ever refused to ship a number because the row behind it was missing, you will fit here.

## How applying works
Every role on our careers page takes a name, an email and a PDF, and sends back a private link. That link always shows the stage your application has reached, and a recruiter records a reason for every move.

## Where the roles are
Our offices are in London, Edinburgh, Zurich and Toronto, and each region has its own benefits entry published on the careers page.`,
    subject: 'company',
    tags: ['hiring'],
    status: 'published',
    author: INES,
    publishedLocal: '2026-10-14T09:00',
  },
  {
    id: 'content-news-introducing-kestrel-1',
    kind: 'news',
    slug: 'introducing-kestrel-1',
    title: 'Introducing Kestrel 1',
    summary: 'The first model we put on the open record, and the baseline for everything since.',
    body: `## Our first route
Kestrel 1 is the first model we published with its rows attached. It is a modest model by the standards of its successors, and we keep its route up because a baseline nobody can read is not a baseline.

## What we learned from publishing it
Writing the route taught us that the hard part is not the prose but the bookkeeping: one subject, one benchmark, one date, one score, recorded before anybody drafts a sentence.`,
    subject: 'research',
    tags: ['release-notes'],
    status: 'published',
    author: TOMAS,
    publishedLocal: '2026-03-12T10:00',
  },
  {
    id: 'content-news-introducing-wren-1',
    kind: 'news',
    slug: 'introducing-wren-1',
    title: 'Introducing Wren 1',
    summary: 'A small archive reader, announced with its model route under one embargo.',
    body: `## A reader for archives
Wren 1 is built for long documents and uneven scans. It releases together with its model route, at the same instant, on every surface of this site.

## Why it is embargoed
Our partners in the archive sector asked for a shared date. The announcement and the route carry one release instant, so neither can appear without the other.`,
    subject: 'research',
    tags: ['release-notes'],
    status: 'scheduled',
    author: INES,
    releaseLocal: '2030-01-15T09:00',
    scheduledBy: ELENI,
  },
  {
    id: 'content-news-red-team-findings-q3',
    kind: 'news',
    slug: 'red-team-findings-q3',
    title: 'Red-team findings, third quarter',
    summary: 'A draft write-up of our third-quarter red-team work, still in the editor.',
    body: `## What we asked the red team to do
We asked our red team to break the refusal behaviour of Kestrel 2 in long conversations, and to write down every success as an evaluation row before describing it in prose.

## What they found
The draft findings are with the safety reviewers. We will publish the write-up once the rows behind it are recorded and the review is finished.`,
    subject: 'safety',
    tags: ['evaluations'],
    status: 'draft',
    author: INES,
  },
];

type SeedSample = {
  id: string;
  kind: 'audio' | 'image_sequence';
  title: string;
  frames: number;
};

const KESTREL_2_SAMPLES: readonly SeedSample[] = [
  { id: 'pitch-contour', kind: 'audio', title: 'Pitch contour study', frames: 0 },
  { id: 'rhythm-continuation', kind: 'audio', title: 'Rhythm continuation study', frames: 0 },
  { id: 'denoise-sequence', kind: 'image_sequence', title: 'Denoising sequence', frames: 12 },
];

type SeedRequisition = {
  id: string;
  slug: string;
  title: string;
  discipline: string;
  office: string;
  description: string;
  status: 'draft' | 'open' | 'closed';
  openedLocal: string | null;
  closedLocal: string | null;
  recruiters: readonly string[];
};

const REQUISITIONS: readonly SeedRequisition[] = [
  {
    id: 'req-research-engineer-evaluations',
    slug: 'research-engineer-evaluations',
    title: 'Research Engineer, Evaluations',
    discipline: 'research',
    office: 'london',
    description:
      'You will build and maintain the harness behind our recorded rows: new benchmarks, reproducible runs, and the evaluation tooling that turns a run into a row with a date on it. You will work beside the editors who write model routes, and you will be the person who says no when a number has no row behind it.',
    status: 'open',
    openedLocal: '2026-10-01T09:00',
    closedLocal: null,
    recruiters: [SANA],
  },
  {
    id: 'req-research-scientist-interpretability',
    slug: 'research-scientist-interpretability',
    title: 'Research Scientist, Interpretability',
    discipline: 'research',
    office: 'edinburgh',
    description:
      'You will study what our models are doing inside long contexts, with causal patching, probes and whatever else earns its keep. You will write up negative results as carefully as positive ones, and your measurements will be recorded as rows before any prose is drafted.',
    status: 'open',
    openedLocal: '2026-09-20T09:00',
    closedLocal: null,
    recruiters: [SANA],
  },
  {
    id: 'req-policy-lead-europe',
    slug: 'policy-lead-europe',
    title: 'Policy Lead, Europe',
    discipline: 'policy',
    office: 'zurich',
    description:
      'You will lead our engagement with European regulators and standards bodies from Zurich, translating what the lab records into language a supervisor can act on. You will also help keep our public record honest about what we do not yet know.',
    status: 'open',
    openedLocal: '2026-10-10T09:00',
    closedLocal: null,
    recruiters: [JULES],
  },
  {
    id: 'req-infrastructure-engineer-toronto',
    slug: 'infrastructure-engineer-toronto',
    title: 'Infrastructure Engineer',
    discipline: 'engineering',
    office: 'toronto',
    description:
      'You will run the clusters and the storage behind our training and our public site, from Toronto. Expect database leases, embargo timers that must fire exactly once, and a strong preference for boring, inspectable systems.',
    status: 'open',
    openedLocal: '2026-08-30T09:00',
    closedLocal: null,
    recruiters: [JULES],
  },
  {
    id: 'req-operations-coordinator-london',
    slug: 'operations-coordinator-london',
    title: 'Operations Coordinator',
    discipline: 'operations',
    office: 'london',
    description:
      'You kept the London office running: travel, suppliers, onboarding and the small logistics that make research possible. This requisition is closed and is kept here as part of the record.',
    status: 'closed',
    openedLocal: '2026-06-01T09:00',
    closedLocal: '2026-09-01T17:00',
    recruiters: [JULES],
  },
  {
    id: 'req-research-scientist-alignment',
    slug: 'research-scientist-alignment',
    title: 'Research Scientist, Alignment',
    discipline: 'research',
    office: 'london',
    description:
      'A draft requisition for a scientist to work on how our models behave when instructions conflict. It is not open yet, so it does not appear on the public careers page.',
    status: 'draft',
    openedLocal: null,
    closedLocal: null,
    recruiters: [SANA],
  },
];

const BENEFITS: readonly { id: string; region: string; from: string; summary: string }[] = [
  {
    id: 'benefits-uk-2026',
    region: 'uk',
    from: '2026-01-01',
    summary: "Private medical cover, 30 days' leave plus bank holidays, 10% pension contribution.",
  },
  {
    id: 'benefits-uk-2027',
    region: 'uk',
    from: '2027-01-01',
    summary: "Private medical cover, 30 days' leave plus bank holidays, 12% pension contribution.",
  },
  {
    id: 'benefits-europe-2026',
    region: 'europe',
    from: '2026-04-01',
    summary: "Supplementary health insurance, 28 days' leave, pension under the local plan.",
  },
  {
    id: 'benefits-north-america-2026',
    region: 'north-america',
    from: '2026-07-01',
    summary: "Health, dental and vision cover, 25 days' leave, retirement matching to 6%.",
  },
];

function instantOf(local: string): Date {
  const parsed = londonLocalToInstant(local);
  if (parsed.kind !== 'ok') throw new Error(`Seed time ${local} is not a London wall clock`);
  return parsed.instant;
}

async function seedStaff(tx: Queryable): Promise<void> {
  const passwordHash = hashPassword(SEED_PASSWORD);
  for (const person of STAFF) {
    await tx.query(
      `INSERT INTO staff (email, name, password_hash) VALUES ($1,$2,$3)
       ON CONFLICT (email) DO NOTHING`,
      [person.email, person.name, passwordHash],
    );
  }
  for (const person of STAFF) {
    for (const role of person.roles) {
      await tx.query(
        `INSERT INTO role_grants (id, staff_email, role, granted_by, granted_at, expires_at, version)
         VALUES ($1,$2,$3,$4,$5,$6,1)
         ON CONFLICT (id) DO NOTHING`,
        [
          `grant-${person.email.split('@')[0]}-${role}`,
          person.email,
          role,
          GRANTOR,
          instantOf('2026-01-02T09:00'),
          GRANT_EXPIRY,
        ],
      );
    }
  }
}

async function seedBenchmarkRows(tx: Queryable): Promise<void> {
  for (const row of BENCHMARK_ROWS) {
    await tx.query(
      `INSERT INTO benchmark_rows (id, subject, benchmark, eval_date, score_text, score, source_note, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (subject, benchmark, eval_date) DO NOTHING`,
      [
        `row-${row.subject}-${row.benchmark.toLowerCase()}-${row.eval_date}`,
        row.subject,
        row.benchmark,
        row.eval_date,
        row.score,
        row.score,
        'Run on the Aldermoor harness; comparators run by us on the same day.',
        instantOf('2026-09-15T09:00'),
      ],
    );
  }
}

async function seedContent(tx: Queryable): Promise<void> {
  for (const item of CONTENT) {
    const published = item.publishedLocal === undefined ? null : instantOf(item.publishedLocal);
    const releaseAt = item.releaseLocal === undefined ? null : instantOf(item.releaseLocal);
    const row: ContentRow = {
      id: item.id,
      kind: item.kind,
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      body: item.body,
      subject: item.subject ?? null,
      tags: item.tags === undefined ? null : [...item.tags],
      claims: item.claims === undefined ? null : [...item.claims],
      linked_news_slug: item.linked_news_slug ?? null,
      status: item.status,
      author: item.author,
      release_at: releaseAt,
      release_at_local: item.releaseLocal ?? null,
      scheduled_by: item.scheduledBy ?? null,
      published_at: published,
      read_time_minutes: null,
      version: 1,
    };
    const readTime = published === null ? null : contentReadTime(row);
    await tx.query(
      `INSERT INTO content_items (id, kind, slug, title, summary, body, subject, tags, claims,
         linked_news_slug, status, author, release_at, release_at_local, scheduled_by,
         published_at, read_time_minutes, version, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,1,$18)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.kind,
        row.slug,
        row.title,
        row.summary,
        row.body,
        row.subject,
        row.tags,
        row.claims === null ? null : JSON.stringify(row.claims),
        row.linked_news_slug,
        row.status,
        row.author,
        row.release_at,
        row.release_at_local,
        row.scheduled_by,
        row.published_at,
        readTime,
        published ?? instantOf('2026-01-02T09:00'),
      ],
    );

    if (item.kind === 'model') {
      const record = item.release;
      const cleared = record !== undefined && item.status !== 'draft';
      await tx.query(
        `INSERT INTO release_records (content_id, status, safety_by, safety_at, safety_note,
           legal_by, legal_at, legal_note, claims_validated_at, last_validation, cleared_by, cleared_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (content_id) DO NOTHING`,
        cleared && record !== undefined
          ? [
              item.id,
              'cleared',
              record.safety,
              instantOf('2026-09-20T10:00'),
              'Safety review complete.',
              record.legal,
              instantOf('2026-09-21T10:00'),
              'Legal review complete.',
              instantOf('2026-09-22T10:00'),
              JSON.stringify(
                (item.claims ?? []).map((claim) => ({ claim: claim.id, ok: true, reason: null })),
              ),
              record.clearedBy,
              instantOf('2026-09-22T11:00'),
            ]
          : [item.id, 'open', null, null, null, null, null, null, null, null, null, null],
      );
    }

    if (published !== null) {
      await tx.query(
        `INSERT INTO publication_events (content_id, published_at) VALUES ($1,$2)
         ON CONFLICT (content_id) DO NOTHING`,
        [item.id, published],
      );
      await upsertSearchEntry(tx, {
        kind: item.kind,
        slug: item.slug,
        refId: item.id,
        title: item.title,
        summary: item.summary,
        body: searchableBody(row),
        publishedAt: published,
      });
    }
  }

  for (const [index, sample] of KESTREL_2_SAMPLES.entries()) {
    await tx.query(
      `INSERT INTO model_samples (id, model_slug, kind, title, frames, position)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (model_slug, id) DO NOTHING`,
      [sample.id, 'kestrel-2', sample.kind, sample.title, sample.frames, index],
    );
  }
}

async function seedCareers(tx: Queryable): Promise<void> {
  for (const requisition of REQUISITIONS) {
    const closedAt =
      requisition.closedLocal === null ? null : instantOf(requisition.closedLocal);
    await tx.query(
      `INSERT INTO requisitions (id, slug, title, discipline, office, description, status,
         recruiters, opened_at, closed_at, close_reason, retention_deadline, version, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13)
       ON CONFLICT (id) DO NOTHING`,
      [
        requisition.id,
        requisition.slug,
        requisition.title,
        requisition.discipline,
        requisition.office,
        requisition.description,
        requisition.status,
        requisition.recruiters,
        requisition.openedLocal === null ? null : instantOf(requisition.openedLocal),
        closedAt,
        closedAt === null ? null : 'The role was filled internally.',
        closedAt === null
          ? null
          : new Date(closedAt.getTime() + config.applicationRetentionSeconds * 1000),
        instantOf('2026-05-01T09:00'),
      ],
    );
    if (requisition.status === 'open' && requisition.openedLocal !== null) {
      await upsertSearchEntry(tx, {
        kind: 'role',
        slug: requisition.slug,
        refId: requisition.id,
        title: requisition.title,
        summary: '',
        body: requisition.description,
        publishedAt: instantOf(requisition.openedLocal),
      });
    }
  }

  for (const entry of BENEFITS) {
    await tx.query(
      `INSERT INTO benefits_entries (id, region, effective_from, summary, created_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (region, effective_from) DO NOTHING`,
      [entry.id, entry.region, entry.from, entry.summary, instantOf('2026-01-02T09:00')],
    );
  }
}

export async function applySeed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SEED_LOCK_KEY]);
    const existing = await client.query('SELECT 1 FROM seed_state WHERE name = $1', [SEED_NAME]);
    if ((existing.rowCount ?? 0) === 0) {
      await withTransaction(async (tx) => {
        await seedStaff(tx);
        await seedBenchmarkRows(tx);
        await seedContent(tx);
        await seedCareers(tx);
        await tx.query('INSERT INTO seed_state (name, applied_at) VALUES ($1, now())', [SEED_NAME]);
      });
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

/** Queues an upload for every sample object that storage is missing. */
export async function ensureSampleObjects(): Promise<void> {
  const samples = await query<{
    id: string;
    model_slug: string;
    kind: 'audio' | 'image_sequence';
    frames: number;
  }>('SELECT id, model_slug, kind, frames FROM model_samples');
  for (const sample of samples.rows) {
    for (const file of sampleFiles(sample.kind, sample.frames)) {
      const key = sampleKey(sample.model_slug, sample.id, file);
      let present = false;
      if (storageIsUp()) {
        present = await objectExists(key).catch(() => false);
      }
      if (present) continue;
      await queueJob(
        pool,
        'sample_upload',
        {
          model_slug: sample.model_slug,
          sample_id: sample.id,
          file,
          frames: sample.frames,
        },
        `sample:${key}`,
      );
    }
  }
}
