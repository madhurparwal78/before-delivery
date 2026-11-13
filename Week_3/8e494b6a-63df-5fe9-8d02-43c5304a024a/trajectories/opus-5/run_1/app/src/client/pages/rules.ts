import { el } from '../dom.js';

type PublishedRule = { index: string; title: string; formula: string[]; example: string[] };

const RULES: PublishedRule[] = [
  {
    index: '01',
    title: 'Streams and mappings',
    formula: [
      'A stream holds at most 100000 events in generations numbered 1 upward. The highest generation is the write generation and it alone takes new events.',
      'A field type is number, date, boolean, text or keyword. A new field takes the type of its first value in that generation, tried in order: number, date, boolean, then text.',
      'Each generation keeps its own mapping. Explicit mappings carry over at rollover; inferred ones are inferred again.',
      'A field with two types across the generations a search covers is a conflict. It cannot be sorted or counted.',
    ],
    example: [
      'Generation 1 stored status 500, so status is number. After a rollover, generation 2 stored status "slow", so status is text there.',
      'A search over both reads: Field status is number in generation 1 and text in generation 2. It cannot be sorted or counted.',
    ],
  },
  {
    index: '02',
    title: 'Bulk upload',
    formula: [
      'The only upload format is newline-delimited JSON: one JSON object per line with a required @timestamp and an optional client _id.',
      'Each line is processed in this order: parse, pipeline, @timestamp check, duplicate check, type check, stream size check, then store.',
      'A blank line is ignored but still counts in the numbering, which starts at 1. Lines succeed independently.',
      'A file is accepted only when its name ends in .ndjson, its bytes are valid UTF-8 with no NUL byte, and its first non-whitespace character is {.',
    ],
    example: [
      'A file of six lines where line 2 is not JSON and line 5 repeats an _id answers: 4 created, 1 duplicate, 1 failed.',
      'Line 2 reads: Line 2: not valid JSON. and lands in the failure store with its raw text and the server time.',
    ],
  },
  {
    index: '03',
    title: 'Pipelines',
    formula: [
      'A pipeline is an ordered list of processors: split, rename, set, parse_date, drop and redact.',
      'Each processor may carry one condition if {field, op, value} with op eq, ne or exists. A false condition skips the processor.',
      'One failure handler: on any failure the event goes to the failure store with Pipeline <name> failed at processor <k>: <reason>. and nothing else from it is stored.',
      'Saving a pipeline raises its version by one. Only events stored afterwards use the new version, and each event records <name>@<version>.',
    ],
    example: [
      'web-clean redacts ipv4 in message and then sets env to prod.',
      'The line {"@timestamp":"2026-03-01T00:00:00.000Z","message":"from 10.0.0.9"} is stored as message "from [hidden]" with env "prod" and _pipeline web-clean@1.',
    ],
  },
  {
    index: '04',
    title: 'Text analysis',
    formula: [
      'standard splits a value into runs of ASCII letters and digits, lower-cases each run, drops stopwords and applies the suffix table.',
      'keyword keeps the whole value as one token. whitespace splits on whitespace and keeps case.',
      'Stopwords: a an and are as at be but by for from in is it of on or that the to was with.',
      'Suffix table, in order: ies becomes y, ing is removed, ed is removed, es is removed, s is removed. The first row that leaves at least 3 characters applies.',
      'Positions are 0-based and every run takes a position, dropped stopwords included. Offsets are 0-based character offsets, start included and end excluded.',
    ],
    example: [
      'The servers failed, retrying 2 connections under standard gives server (1, 4-11), fail (2, 12-18), retry (3, 20-28), 2 (4, 29-30), connection (5, 31-42).',
      'The held position 0 and was dropped as a stopword.',
    ],
  },
  {
    index: '05',
    title: 'Relevance',
    formula: [
      'Each scoring leaf has value = idf x tf_norm x boost.',
      'idf = ln(1 + (N - df + 0.5) / (df + 0.5)).',
      'tf_norm = tf x (k1 + 1) / (tf + k1 x (1 - b + b x dl / avgdl)), with k1 = 1.2 and b = 0.75.',
      'boost is 2.0 for message and 1.0 for every other text field.',
      'Each leaf value is rounded to 4 decimals, half away from zero, and the score is the sum of the rounded values.',
      'Results with a query sort by score descending, then @timestamp descending, then _id ascending.',
    ],
    example: [
      'Four events in message: payment gateway timeout; gateway timeout, timeout again; disk full on node; retry scheduled. Token counts are 3, 4, 3 and 2, so N = 4 and avgdl = 3.',
      'For gateway OR timeout each term has df = 2, so idf = 0.6931.',
      'e1 scores gateway 1.3863 + timeout 1.3863 = 2.7726. e2 scores gateway 1.2199 + timeout 1.7428 = 2.9627, so e2 ranks first.',
    ],
  },
  {
    index: '06',
    title: 'Spoor Query',
    formula: [
      'Forms: field:value, field:"a phrase", a bare word or phrase on message, existence field:*, ranges with > >= < <=, wildcards inside a value, grouped values status:(500 OR 503) and object scopes request{method:GET AND status>=500}.',
      'A backslash before : ( ) { } " * \\ makes that character literal.',
      'NOT binds tightest, then AND, then OR. There are no regular expressions and no scripts.',
      'A range on a multi-value field tests each condition against each value separately.',
      'A malformed query answers 422 with its published sentence and a 1-based position; the caret moves to that position.',
    ],
    example: [
      'latency holding [500, 10] matches latency>300 AND latency<400, because 500 meets the first condition and 10 meets the second.',
      'status:5* answers: Wildcard not allowed on number field status at position 9.',
    ],
  },
  {
    index: '07',
    title: 'Explore',
    formula: [
      'Quick and relative ranges end at server now. The range includes its start and excludes its end.',
      'The histogram interval is the smallest of 1s 5s 10s 30s 1m 5m 10m 30m 1h 3h 12h 1d 1w for which at most 60 buckets touch the range.',
      'For intervals under 1d, boundaries are the local midnight of the day holding the range start plus whole multiples of the interval in elapsed time.',
      'Bucket Brush sets the range from the first selected bucket start to the last selected bucket end.',
      'Field statistics cover the current range, query and filters. Share is a value count divided by the number of events holding the field, as a percentage with 1 decimal.',
    ],
    example: [
      'In America/New_York, 2026-03-08 is a 23-hour day: the interval is 30m, there are 46 buckets, and the bucket after 01:30 -05:00 is 03:00 -04:00.',
      '2026-11-01 is a 25-hour day with 50 buckets: 01:30 -04:00 is followed by 01:00 -05:00, then 01:30 -05:00.',
    ],
  },
  {
    index: '08',
    title: 'Moving data',
    formula: [
      'Running a search in the grid creates a snapshot, and the result count is its total. A snapshot freezes its whole ordered result list when created.',
      'Later uploads, rollovers, archiving and deletion never change a snapshot list, so its pages have no duplicates and no gaps.',
      'A snapshot expires once the server clock reaches its last use plus the published time; a request at exactly that moment is already expired.',
      'The live tail keeps up to the published buffer of the newest arrivals while paused and discards the oldest past it.',
    ],
    example: [
      'With a buffer of 50, 55 arrivals while paused read: Live tail paused: 55 new events and Buffer full: oldest 5 events discarded.',
    ],
  },
  {
    index: '09',
    title: 'Spoor Pipe',
    formula: [
      'Commands separated by |: FROM <stream> first, then WHERE <Spoor Query>, STATS <agg> AS <name> BY <field>, SORT <col> ASC|DESC, LIMIT <n> and KEEP <col>.',
      'Without STATS the columns are _id, @timestamp, then every other field alphabetically. With STATS the BY field comes first, then the aggregates in order.',
      'avg shows at most 4 decimals, half away from zero, with no trailing zeros. SORT puts missing values last and breaks ties on all kept columns ascending, left to right.',
    ],
    example: [
      'FROM web | WHERE level:error | STATS count(*) AS errors, avg(latency) AS mean BY host gives one row per host, errors typed number and mean typed number.',
      'A wrong command answers: Unknown command JOIN at position 12.',
    ],
  },
  {
    index: '10',
    title: 'Lifecycle',
    formula: [
      'A policy carries rollover_max_age_ms, rollover_max_events, warm_after_ms, archive_after_ms and delete_after_ms. The last three are measured from the generation rollover time on the server clock.',
      'One step rolls over the write generation once when its age or event count reaches its limit, then moves each rolled-over generation straight to the furthest phase its age allows. A phase never moves backward, and an empty write generation never rolls over.',
      'A generation becomes archived only after storage confirms its segment object byte for byte. Warm and archived generations are read-only.',
      'While storage is unavailable, searches return the rest of the results with the partial results banner and a skipped count.',
    ],
    example: [
      'With warm_after_ms 60000 and archive_after_ms 120000, a generation rolled over at 10:00:00 turns warm at the first step at or after 10:01:00 and archived at the first step at or after 10:02:00.',
      'Its timeline reads: Generation 3, warm, next: archive at 2026-03-01 10:02:00 +00:00.',
    ],
  },
  {
    index: '11',
    title: 'Alert rules',
    formula: [
      'A rule carries a stream, an optional filter, a measure (count, avg, max, min or sum), an optional group-by field, a window, a comparison and a threshold, and an action frequency.',
      'At check time T a group value covers events with @timestamp in (max(T - window, B), T], where B is when the group last entered active or recovered, so no event counts toward two state changes.',
      'States move inactive, pending, active and recovered by the published transitions. A failed check keeps every state and counter.',
      'Each action writes one inbox item reading <group> is <state> on rule <rule>.',
    ],
    example: [
      'Window 5 minutes, count above 5, and 6 events on host-7 between 09:57 and 09:59 on 2026-03-01 UTC.',
      'The check at 10:00 is pending with value 6; 10:01 is active and B becomes 10:01; 10:02 is recovered with value 0; 10:03 is inactive.',
    ],
  },
  {
    index: '12',
    title: 'Alert handling',
    formula: [
      'A group is flapping while its state changed on at least the published number of its last successful checks, the current one included. While flapping, no action fires.',
      'A snoozed group fires no actions. For 1 hour ends 3600000 ms and For 1 day 86400000 ms after snoozing, on the server clock, and any snooze ends when the group recovers.',
      'A maintenance window carries an IANA time zone, weekly days, a local start and a duration. The start is local wall time, so daylight saving moves its UTC time; a start that does not exist that day begins at the same distance after the gap.',
      'At the first successful check after a window ends, each group still active that had an action held by the window fires exactly one action reading <group> is still active after maintenance window <window> on rule <rule>.',
      'Cases are numbered per space and move one step forward through open, investigating, resolved and closed, or resolved back to investigating.',
    ],
    example: [
      'A window in America/New_York starting 02:30 on a spring-forward Sunday begins at 03:30 local, and a group that was held inside it fires one action on the first check after it ends.',
      'A case that is closed cannot reopen: A case cannot go from closed to open.',
    ],
  },
  {
    index: '13',
    title: 'Traces and objectives',
    formula: [
      'Children are ordered by start_ms, then span_id. Orphans hang under a Missing parent item placed after the real roots.',
      'Working top down, a child that starts D ms before its corrected parent moves with its whole subtree by +D and shows shifted +D ms.',
      'Self time is a span duration minus the length of the union of its children intervals, clipped to the span.',
      'The critical path starts at the real root with the latest end and repeatedly takes the child with the latest end at or before the cursor.',
      'Percentiles use nearest rank: the value at rank ceil(p / 100 x n) of the sorted durations.',
      'error budget = 1 - target / 100. budget remaining = 1 - (bad / total) / budget. burn rate = (bad / total) / budget over a long window of 1 hour and a short window of 5 minutes.',
      'Status is Burning fast when both burn rates are at least 14.40, Burning when both are at least 6.00, otherwise OK.',
    ],
    example: [
      'checkout runs 0 to 240 ms with children auth 20 to 60, pay 50 to 150 and render 150 to 220. The union of the children is 200 ms, so self time is 40 ms and the path is checkout, pay, render.',
      'Target 99.5% gives a budget of 0.005. Over 30 days, 2000 bad of 1000000 leaves 60.00% of the budget; 240 of 12000 in an hour burns 4.00; 30 of 1000 in five minutes burns 6.00; the status is OK.',
    ],
  },
  {
    index: '14',
    title: 'Spaces and keys',
    formula: [
      'A space isolates its streams, events, mappings, pipelines, saved searches, rules, groups, inbox, cases, traces, objectives, keys and live messages, and every surface derived from them.',
      'A key has the format spk_ and 32 lower-case hex characters, is shown once, and is stored only as a SHA-256 hash.',
      'A stream pattern matches whole stream names with * standing for any run of characters. Actions are read, upload and manage.',
      'A key refusal is 401 for expired, revoked or unknown keys, 404 for a stream in another space, and 403 key_scope for a stream outside the pattern or an action not granted.',
      'Copying a saved search into another space checks one reference: its stream must exist there. A missing reference does not block the copy; it lands marked Needs attention.',
    ],
    example: [
      'A key scoped to web* with the upload action alone answers This key cannot read stream web. for a search, and Not found. for any stream in another space.',
      'A saved search on web copied into a space without that stream reads: Copied with 1 missing reference: stream web.',
    ],
  },
];

export function renderRules(main: HTMLElement): void {
  const accordion = el('div', { class: 'accordion' });
  for (const rule of RULES) {
    const panel = el('div', { class: 'accordion-panel', hidden: true }, [
      el('div', {}, rule.formula.map((line) => el('p', { text: line }))),
      el('h3', { text: 'Worked example' }),
      el('div', {}, rule.example.map((line) => el('p', { class: 'mono', text: line }))),
    ]);
    const label = `${rule.index} ${rule.title}`;
    const header = el('button', {
      type: 'button',
      'aria-label': label,
      'aria-expanded': 'false',
      class: 'accordion-header',
    }, [el('span', { class: 'mono accordion-index', text: rule.index }), el('span', { text: rule.title })]);
    header.addEventListener('click', () => {
      const open = header.getAttribute('aria-expanded') === 'true';
      header.setAttribute('aria-expanded', String(!open));
      panel.hidden = open;
    });
    accordion.append(el('div', { class: 'accordion-row' }, [header, panel]));
  }
  main.append(el('h1', { class: 'view-title', text: 'Published rules' }), accordion);
}
