-- Seed data for Open Record. Applied idempotently on every start.
INSERT INTO regions (slug, label) VALUES
  ('uk', 'United Kingdom'),
  ('europe', 'Europe'),
  ('north-america', 'North America')
ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label;

INSERT INTO offices (slug, label, region) VALUES
  ('london', 'London', 'uk'),
  ('edinburgh', 'Edinburgh', 'uk'),
  ('zurich', 'Zurich', 'europe'),
  ('toronto', 'Toronto', 'north-america')
ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label, region = EXCLUDED.region;

INSERT INTO comparators (slug, name, organisation) VALUES
  ('halvard-3', 'Halvard 3', 'Brightline AI'),
  ('morrow-l', 'Morrow L', 'Teague Systems')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, organisation = EXCLUDED.organisation;

INSERT INTO theses (number, heading, body) VALUES
  (1, 'A claim is only as good as the row beneath it.',
   'Every number we publish points at a recorded row: who ran it, on which benchmark, on which date. When a claim cannot be traced to that row, it does not go out. This is the whole discipline of the lab in one habit, and the rest of the record is built to keep it honest.'),
  (2, 'Release is a decision with names on it.',
   'A model route leaves this building only when named people have signed for it. Safety signs first, then legal, and then a third approver clears the record. If a signer loses the authority to sign, the signature falls away and the record says so.'),
  (3, 'Every surface tells the same story at the same moment.',
   'An embargo is a promise made to partners and kept by machinery. When the clock reaches the instant, the catalogue, the newsroom, the menus, the feed, search and the sitemap change together, in one committed instant, whichever instance serves the reader.'),
  (4, 'Withdrawal should be as thorough as publication.',
   'Work is sometimes retracted. When it is, the withdrawal travels everywhere the publication went: every list, every count, every feed, every search result. The address answers plainly that the item has been withdrawn, and the earlier record stays readable as it was.'),
  (5, 'Candidates deserve to know where they stand.',
   'Nobody applies into a black box. Every application carries a private tracking link, every stage has a plain name, and every decision is recorded against a person and a reason. When we close a requisition, the people still waiting hear it from us first.')
ON CONFLICT (number) DO UPDATE SET heading = EXCLUDED.heading, body = EXCLUDED.body;

-- Staff accounts (passwords set from code; hashes are placeholders replaced at start).
INSERT INTO staff (email, name, password_hash, is_admin) VALUES
  ('ines.halloran@aldermoor.example', 'Ines Halloran', 'seed', false),
  ('tomas.reyes@aldermoor.example', 'Tomas Reyes', 'seed', false),
  ('eleni.marsh@aldermoor.example', 'Eleni Marsh', 'seed', false),
  ('kofi.brennan@aldermoor.example', 'Kofi Brennan', 'seed', false),
  ('sana.qadir@aldermoor.example', 'Sana Qadir', 'seed', false),
  ('jules.okonkwo@aldermoor.example', 'Jules Okonkwo', 'seed', false),
  ('ada.penrose@aldermoor.example', 'Ada Penrose', 'seed', true),
  ('noor.vance@aldermoor.example', 'Noor Vance', 'seed', false)
ON CONFLICT (email) DO NOTHING;

-- Content items -------------------------------------------------------------
INSERT INTO content_items (id, kind, slug, title, summary, body, subject, tags, claims, linked_news_slug, status, author_email, release_at, published_at, read_time_minutes, version)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'model', 'kestrel-2', 'Kestrel 2',
   'Our second general research model, built for long, careful reading.',
   E'## What Kestrel 2 is\nKestrel 2 is our second general research model, trained for long, careful reading and multi-step reasoning. [claim:c1]\n\n## How we evaluated it\nEvery score on this page comes from a recorded evaluation row with its date. We ran each comparator ourselves on the same harness on the same day. [claim:c2]\n\n## Where it falls short\nOn CodeTrace, Kestrel 2 trails Morrow L. We publish that row beside the others.',
   NULL, NULL,
   '[{"id":"c1","text":"On ReasonBench-Hard, Kestrel 2 scores 71.4, 3.2 points above Halvard 3.","benchmark":"ReasonBench-Hard","eval_date":"2026-09-14","comparator":"halvard-3","stated_delta":"3.2"},{"id":"c2","text":"On LongDoc-QA, Kestrel 2 scores 84.9, 4.3 points above Halvard 3.","benchmark":"LongDoc-QA","eval_date":"2026-09-14","comparator":"halvard-3","stated_delta":"4.3"}]'::jsonb,
   'introducing-kestrel-2', 'published', 'tomas.reyes@aldermoor.example', NULL,
   '2026-09-30T08:00:00Z', 1, 1),

  ('22222222-2222-4222-8222-222222222222', 'model', 'kestrel-1', 'Kestrel 1',
   'Our first research model and the baseline for everything since.',
   E'## What Kestrel 1 was\nKestrel 1 was the lab''s first research model. It was retired when Kestrel 2 took over the harness, and every number recorded against it stays in the record as the baseline for the work that followed.',
   NULL, NULL, NULL, NULL, 'published', 'tomas.reyes@aldermoor.example', NULL,
   '2026-03-12T10:00:00Z', 1, 1),

  ('33333333-3333-4333-8333-333333333333', 'model', 'wren-1', 'Wren 1',
   'A small, careful model for constrained settings, scheduled for release.',
   E'## What Wren 1 is\nWren 1 is a compact model for settings with tight memory budgets. It keeps the same harness, the same rows and the same sign-off as the larger routes.\n\n## How we evaluated it\nWren 1 runs the recorded benchmarks only. Its numbers arrive with the route at the embargo instant.',
   NULL, NULL, NULL, 'introducing-wren-1', 'scheduled', 'ines.halloran@aldermoor.example',
   '2030-01-15T09:00:00Z', NULL, NULL, 1),

  ('44444444-4444-4444-8444-444444444444', 'model', 'kestrel-3', 'Kestrel 3',
   'Our third general research model, still in draft.',
   E'## What Kestrel 3 is\nKestrel 3 continues the line of general research models. It is in draft and has not been submitted for review. [claim:c1]',
   NULL, NULL,
   '[{"id":"c1","text":"On ReasonBench-Hard, Kestrel 3 scores 76.0, 6.9 points above Halvard 3.","benchmark":"ReasonBench-Hard","eval_date":"2026-10-20","comparator":"halvard-3","stated_delta":"6.9"}]'::jsonb,
   NULL, 'draft', 'ines.halloran@aldermoor.example', NULL, NULL, NULL, 1),

  ('55555555-5555-4555-8555-555555555555', 'news', 'introducing-kestrel-2', 'Introducing Kestrel 2',
   'Kestrel 2 is our second general research model. This note sets out what it is for and how its evaluation was recorded.',
   E'## Kestrel 2 is here\nKestrel 2 is our second general research model, built for long, careful reading. The full route carries every recorded evaluation row behind each number on this page.\n\n## What the evaluation covers\nWe ran the model and its comparators on the same harness on the same day. Every evaluation on the route links to its recorded row, and the claims are tethered to the chart so you can check the difference for yourself.\n\n## Where to read more\nThe model route holds the chart, the rows and the samples. The safety and legal sign-offs are recorded on the release record.',
   'research', '["evaluations","release-notes"]'::jsonb, NULL, NULL, 'published',
   'tomas.reyes@aldermoor.example', NULL, '2026-09-30T08:00:00Z', 1, 1),

  ('66666666-6666-4666-8666-666666666666', 'news', 'how-we-sign-off-a-release', 'How we sign off a release',
   'Before any model route goes public, safety and legal each record a sign-off, and a third approver clears the record.',
   E'## The release record\nEvery model route carries a release record. Safety signs first, legal signs second, and a different approver clears the record once the claims have been validated against the recorded rows.\n\n## Why the names matter\nA signature is only worth the authority behind it. If a signer''s approver grant ends, the signature lapses and the record falls back until it is signed again.\n\n## The claim validator\nThe validator checks that each claim is marked in the body, that its rows exist, and that its stated difference equals the recorded one.',
   'safety', '["evaluations","governance"]'::jsonb, NULL, NULL, 'published',
   'eleni.marsh@aldermoor.example', NULL, '2026-08-20T10:00:00Z', 1, 1),

  ('77777777-7777-4777-8777-777777777777', 'news', 'interpretability-notes-autumn', 'Interpretability notes, autumn',
   'Notes from the interpretability group on attention paths in long-context models.',
   E'## Long attention paths\nWe spent the autumn tracing attention paths through the long-context layers of Kestrel 2. The paths are long but sparse, which is what the reading benchmark rewards.\n\n## What the probes show\nProbes fired most often on the reasoning blocks of the harness, and rarely on the passages themselves. The full write-up follows when the next route clears sign-off.',
   'research', '["interpretability"]'::jsonb, NULL, NULL, 'published',
   'ines.halloran@aldermoor.example', NULL, '2026-10-08T13:00:00Z', 1, 1),

  ('88888888-8888-4888-8888-888888888888', 'news', 'why-every-score-links-to-a-row', 'Why every score links to a row',
   'A short policy note on why each published number points at the evaluation row that produced it.',
   E'## One row per number\nAny score we publish can be traced to a recorded row: the subject, the benchmark, the date and the score exactly as it was recorded. Nothing is rounded twice or quoted from memory.\n\n## What we ask of partners\nWhen we share results with partners, we share rows. A number without a row is a marketing figure, and the record does not carry those.\n\n## The tether\nOn each model route the claims are tethered to the chart. Activating one fades every row it does not cite, so you can see exactly what the claim rests on.',
   'policy', '["evaluations","governance"]'::jsonb, NULL, NULL, 'published',
   'kofi.brennan@aldermoor.example', NULL, '2026-07-02T09:00:00Z', 1, 1),

  ('99999999-9999-4999-8999-999999999999', 'news', 'an-update-on-corvane-group', 'An update on our work with Corvane Group',
   'A note on the collaboration between Aldermoor Labs and the wider Corvane Group.',
   E'## The collaboration\nAldermoor Labs is the frontier research arm of Corvane Group. The group holds the compute estate; the lab holds the research agenda and the record.\n\n## What changes for readers\nNothing on the public side. The record stays open, the sign-off rules stay the same, and every number keeps pointing at its recorded row.',
   'company', '["partnerships"]'::jsonb, NULL, NULL, 'published',
   'ada.penrose@aldermoor.example', NULL, '2026-06-15T08:30:00Z', 1, 1),

  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'news', 'we-are-hiring-research-engineers', 'We are hiring research engineers',
   'The evaluations group is hiring research engineers in London and Edinburgh.',
   E'## The roles\nThe evaluations group is hiring research engineers to build the harnesses behind the recorded rows. The roles are open in London and Edinburgh, and the careers page carries the full descriptions.\n\n## What the work looks like\nYou would own a benchmark end to end: the harness, the comparator runs and the rows that end up on the record. Careful reading of the rules matters more than speed.',
   'company', '["hiring"]'::jsonb, NULL, NULL, 'published',
   'sana.qadir@aldermoor.example', NULL, '2026-10-14T08:00:00Z', 1, 1),

  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'news', 'introducing-kestrel-1', 'Introducing Kestrel 1',
   'Our first research model, and the baseline for everything since.',
   E'## Kestrel 1\nKestrel 1 was the lab''s first research model. It set the pattern the later routes follow: recorded rows, tethered claims and a signed release record.\n\n## What it left behind\nThe model is retired but its rows stay on the record as the baseline for the work that followed.',
   'research', '["release-notes"]'::jsonb, NULL, NULL, 'published',
   'tomas.reyes@aldermoor.example', NULL, '2026-03-12T10:00:00Z', 1, 1),

  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'news', 'introducing-wren-1', 'Introducing Wren 1',
   'A compact model for constrained settings. Scheduled to appear with the Wren 1 route.',
   E'## Wren 1\nWren 1 is a compact model for settings with tight memory budgets. It shares the harness and the sign-off rules of the larger routes.\n\n## When it appears\nThe route and this note appear together at the embargo instant. Until then neither is on the record.',
   'research', '["release-notes"]'::jsonb, NULL, NULL, 'scheduled',
   'ines.halloran@aldermoor.example', '2030-01-15T09:00:00Z', NULL, NULL, 1),

  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'news', 'red-team-findings-q3', 'Red-team findings, third quarter',
   'The third-quarter red-team report, still in draft.',
   E'## The quarter\nThe red-team ran the third-quarter exercises against the current routes. The findings are being written up and have not been submitted for review.\n\n## Next steps\nThe draft goes to the approvers once the findings are complete.',
   'safety', '["evaluations"]'::jsonb, NULL, NULL, 'draft',
   'ines.halloran@aldermoor.example', NULL, NULL, NULL, 1)
ON CONFLICT (slug) DO NOTHING;

-- Read times for seeded published items, computed by the server's own rule.
UPDATE content_items SET read_time_minutes = 1
WHERE slug IN ('kestrel-2','kestrel-1','introducing-kestrel-2','how-we-sign-off-a-release','interpretability-notes-autumn','why-every-score-links-to-a-row','an-update-on-corvane-group','we-are-hiring-research-engineers','introducing-kestrel-1')
AND read_time_minutes IS NULL;

-- Publication history for published items.
INSERT INTO publication_history (content_id, published_at)
SELECT id, published_at FROM content_items WHERE status = 'published'
ON CONFLICT (content_id) DO NOTHING;

-- Release records.
INSERT INTO release_records (content_id, status, safety_by, safety_at, legal_by, legal_at, claims_validated_at, cleared_by, cleared_at, last_validation)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'cleared',
   'eleni.marsh@aldermoor.example', '2026-09-28T09:00:00Z',
   'kofi.brennan@aldermoor.example', '2026-09-28T10:00:00Z',
   '2026-09-28T11:00:00Z',
   'tomas.reyes@aldermoor.example', '2026-09-28T12:00:00Z',
   '[{"claim":"c1","ok":true,"reason":"ok"},{"claim":"c2","ok":true,"reason":"ok"}]'::jsonb),
  ('33333333-3333-4333-8333-333333333333', 'cleared',
   'eleni.marsh@aldermoor.example', '2026-12-01T09:00:00Z',
   'kofi.brennan@aldermoor.example', '2026-12-01T10:00:00Z',
   '2026-12-01T11:00:00Z',
   'tomas.reyes@aldermoor.example', '2026-12-01T12:00:00Z',
   '[]'::jsonb)
ON CONFLICT (content_id) DO NOTHING;

INSERT INTO release_records (content_id)
VALUES ('44444444-4444-4444-8444-444444444444')
ON CONFLICT (content_id) DO NOTHING;

-- Benchmark rows.
INSERT INTO benchmark_rows (subject, subject_name, organisation, benchmark, eval_date, score, source_note, created_by) VALUES
  ('kestrel-2', 'Kestrel 2', 'Aldermoor Labs', 'ReasonBench-Hard', '2026-09-14', '71.4', 'Internal harness run, single repetition.', 'tomas.reyes@aldermoor.example'),
  ('halvard-3', 'Halvard 3', 'Brightline AI', 'ReasonBench-Hard', '2026-09-14', '68.2', 'Comparator run on our harness.', 'tomas.reyes@aldermoor.example'),
  ('morrow-l', 'Morrow L', 'Teague Systems', 'ReasonBench-Hard', '2026-09-14', '70.9', 'Comparator run on our harness.', 'tomas.reyes@aldermoor.example'),
  ('kestrel-2', 'Kestrel 2', 'Aldermoor Labs', 'LongDoc-QA', '2026-09-14', '84.9', 'Internal harness run, single repetition.', 'tomas.reyes@aldermoor.example'),
  ('halvard-3', 'Halvard 3', 'Brightline AI', 'LongDoc-QA', '2026-09-14', '80.6', 'Comparator run on our harness.', 'tomas.reyes@aldermoor.example'),
  ('morrow-l', 'Morrow L', 'Teague Systems', 'LongDoc-QA', '2026-09-14', '85.3', 'Comparator run on our harness.', 'tomas.reyes@aldermoor.example'),
  ('kestrel-2', 'Kestrel 2', 'Aldermoor Labs', 'CodeTrace', '2026-09-14', '58.0', 'Internal harness run, single repetition.', 'tomas.reyes@aldermoor.example'),
  ('morrow-l', 'Morrow L', 'Teague Systems', 'CodeTrace', '2026-09-14', '61.5', 'Comparator run on our harness.', 'tomas.reyes@aldermoor.example'),
  ('kestrel-1', 'Kestrel 1', 'Aldermoor Labs', 'ReasonBench-Hard', '2026-03-01', '62.7', 'Internal harness run, single repetition.', 'tomas.reyes@aldermoor.example'),
  ('kestrel-3', 'Kestrel 3', 'Aldermoor Labs', 'ReasonBench-Hard', '2026-10-20', '76.0', 'Internal harness run, single repetition.', 'ines.halloran@aldermoor.example'),
  ('halvard-3', 'Halvard 3', 'Brightline AI', 'ReasonBench-Hard', '2026-10-20', '69.1', 'Comparator run on our harness.', 'ines.halloran@aldermoor.example')
ON CONFLICT (subject, benchmark, eval_date) DO NOTHING;

-- Samples.
INSERT INTO samples (model_slug, sample_id, kind, title, files) VALUES
  ('kestrel-2', 'pitch-contour', 'audio', 'Pitch contour study', '["clip.wav"]'::jsonb),
  ('kestrel-2', 'rhythm-continuation', 'audio', 'Rhythm continuation study', '["clip.wav"]'::jsonb),
  ('kestrel-2', 'denoise-sequence', 'image_sequence', 'Denoising sequence', '["frame-01.png","frame-02.png","frame-03.png","frame-04.png","frame-05.png","frame-06.png","frame-07.png","frame-08.png","frame-09.png","frame-10.png","frame-11.png","frame-12.png"]'::jsonb)
ON CONFLICT (model_slug, sample_id) DO NOTHING;

-- Requisitions.
INSERT INTO requisitions (id, slug, title, status, discipline, office, description, opened_at, closed_at, close_reason, version) VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01', 'research-engineer-evaluations', 'Research Engineer, Evaluations', 'open', 'research', 'london',
   E'The evaluations group owns the harnesses behind the recorded rows. You will build benchmark harnesses, run comparator models on our own infrastructure, and record every score with its date and source. The work is published on the open record, so care with numbers matters more than speed. Experience with long-context models is welcome but not required.',
   '2026-10-01T00:00:00Z', NULL, NULL, 1),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02', 'research-scientist-interpretability', 'Research Scientist, Interpretability', 'open', 'research', 'edinburgh',
   E'The interpretability group traces attention paths through our long-context models. You will design probes, run them against the current routes, and write up what they show for the open record. The group is small and works closely with the results team, so clear writing and careful reading of numbers are the core skills.',
   '2026-09-20T00:00:00Z', NULL, NULL, 1),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03', 'policy-lead-europe', 'Policy Lead, Europe', 'open', 'policy', 'zurich',
   E'The policy team works with European institutions on the disclosure rules that apply to frontier models. You will lead that work from Zurich, keep the lab''s public record aligned with the rules as they change, and brief colleagues on what publication requires. The role suits someone who can read a regulation and a benchmark row with equal care.',
   '2026-10-10T00:00:00Z', NULL, NULL, 1),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04', 'infrastructure-engineer-toronto', 'Infrastructure Engineer', 'open', 'engineering', 'toronto',
   E'The platform group keeps the record itself running: one database, one object store, several instances and no caches. You will work on the job queue, the storage layer and the deployment story, and you will own the parts of the record that candidates and recruiters rely on every day.',
   '2026-08-30T00:00:00Z', NULL, NULL, 1),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05', 'operations-coordinator-london', 'Operations Coordinator', 'closed', 'operations', 'london',
   E'The operations team keeps the lab itself running: travel, visitors, finance and the office. This role coordinated the London office and worked with the recruiters on the hiring calendar. The requisition closed in September and is kept on the record as closed.',
   '2026-06-01T00:00:00Z', '2026-09-01T00:00:00Z', 'The role has been filled.', 1),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee06', 'research-scientist-alignment', 'Research Scientist, Alignment', 'draft', 'research', 'london',
   E'The alignment group studies how our models behave under adversarial pressure. This requisition is still in draft and has not been opened.',
   NULL, NULL, NULL, 1)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO requisition_recruiters (requisition_id, email)
SELECT id, 'sana.qadir@aldermoor.example' FROM requisitions WHERE slug IN ('research-engineer-evaluations','research-scientist-interpretability','research-scientist-alignment')
ON CONFLICT DO NOTHING;
INSERT INTO requisition_recruiters (requisition_id, email)
SELECT id, 'jules.okonkwo@aldermoor.example' FROM requisitions WHERE slug IN ('policy-lead-europe','infrastructure-engineer-toronto','operations-coordinator-london')
ON CONFLICT DO NOTHING;

-- Benefits register.
INSERT INTO benefits_entries (region, effective_from, summary, created_by) VALUES
  ('uk', '2026-01-01', 'Private medical cover, 30 days'' leave plus bank holidays, 10% pension contribution.', 'ada.penrose@aldermoor.example'),
  ('uk', '2027-01-01', 'Private medical cover, 30 days'' leave plus bank holidays, 12% pension contribution.', 'ada.penrose@aldermoor.example'),
  ('europe', '2026-04-01', 'Supplementary health insurance, 28 days'' leave, pension under the local plan.', 'ada.penrose@aldermoor.example'),
  ('north-america', '2026-07-01', 'Health, dental and vision cover, 25 days'' leave, retirement matching to 6%.', 'ada.penrose@aldermoor.example')
ON CONFLICT (region, effective_from) DO NOTHING;

-- Embargo for the scheduled Wren 1 route.
INSERT INTO embargo_releases (content_id, release_at)
SELECT id, release_at FROM content_items WHERE status = 'scheduled'
ON CONFLICT (content_id) DO NOTHING;
