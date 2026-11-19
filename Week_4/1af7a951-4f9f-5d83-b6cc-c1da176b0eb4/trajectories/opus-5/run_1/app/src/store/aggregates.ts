import { rows, type Queryable } from '../db/pool.js';
import { NIGHTS_PER_COHORT, nightNumber, publishedNightKey } from '../domain/night.js';
import {
  SIGN_CATEGORIES,
  emptyTallies,
  haloPx,
  targetCategory,
  type Constellation,
  type SignCategory,
  type Tallies,
} from '../domain/signs.js';
import type { DateKey } from '../domain/time.js';
import type { EnrollmentStatus } from './enrollments.js';

export interface SharedEntryView {
  readonly entry_id: string;
  readonly night_key: DateKey;
  readonly title: string;
  readonly text: string;
  readonly has_memo: boolean;
}

export interface RosterRow {
  readonly enrollment_id: string;
  readonly display_name: string;
  readonly status: EnrollmentStatus;
  readonly night_number: number;
  readonly nights_logged: number;
  readonly recall_rate: number;
  readonly technique_minutes: number;
  readonly wbtb_nights: number;
  readonly reality_checks: number;
  readonly sign_tallies: Tallies;
  readonly shared_entries: readonly SharedEntryView[];
}

interface MemberRow {
  readonly id: string;
  readonly name: string;
  readonly status: EnrollmentStatus;
  readonly home_tz: string;
  readonly bedtime: string;
  readonly first_night: DateKey | null;
  readonly latest_night_key: DateKey | null;
}

interface AdherenceRow {
  readonly enrollment_id: string;
  readonly nights_logged: number;
  readonly recalled_nights: number;
  readonly technique_minutes: number;
  readonly wbtb_nights: number;
}

interface CountRow {
  readonly enrollment_id: string;
  readonly total: number;
}

interface TallyRow {
  readonly enrollment_id: string;
  readonly category: SignCategory;
  readonly total: number;
}

interface SharedRow {
  readonly enrollment_id: string;
  readonly id: string;
  readonly night_key: DateKey;
  readonly title: string;
  readonly text: string;
  readonly has_memo: boolean;
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function recallRate(recalledNights: number, nightsElapsed: number): number {
  if (nightsElapsed === 0) return 0;
  return roundToCents(recalledNights / nightsElapsed);
}

export async function tallyRowsOf(
  enrollmentId: string,
  client?: Queryable,
): Promise<{ tallies: Tallies; nights: Record<SignCategory, number> }> {
  const found = await rows<{ category: SignCategory; total: number; nights: number }>(
    `select category, count(*)::int as total, count(distinct night_key)::int as nights
       from signs where enrollment_id = $1 group by category`,
    [enrollmentId],
    client,
  );
  const tallies = emptyTallies();
  const nights: Record<SignCategory, number> = { inner_awareness: 0, action: 0, form: 0, context: 0 };
  for (const row of found) {
    tallies[row.category] = row.total;
    nights[row.category] = row.nights;
  }
  return { tallies, nights };
}

export async function constellationsOf(
  enrollmentId: string,
): Promise<{ constellations: Constellation[]; target: SignCategory | null }> {
  const { tallies, nights } = await tallyRowsOf(enrollmentId);
  const constellations = SIGN_CATEGORIES.map((category) => ({
    category,
    stars: tallies[category],
    taggedNights: nights[category],
    halo_px: haloPx(nights[category]),
  }));
  return { constellations, target: targetCategory(constellations) };
}

export async function rosterRowsOf(cohortId: string, now: Date): Promise<RosterRow[]> {
  const members = await rows<MemberRow>(
    `select e.id, e.name, e.status, e.home_tz, e.bedtime, e.first_night,
            (select max(night_key)::text from entries n where n.enrollment_id = e.id) as latest_night_key
       from enrollments e
      where e.cohort_id = $1 and e.status in ('active', 'refunded')
      order by e.name`,
    [cohortId],
  );
  if (members.length === 0) return [];

  const adherence = await rows<AdherenceRow>(
    `select e.enrollment_id,
            count(distinct e.night_key)::int as nights_logged,
            count(distinct e.night_key) filter (where e.dreams_recalled >= 1)::int as recalled_nights,
            coalesce(sum(e.technique_minutes), 0)::int as technique_minutes,
            count(distinct e.night_key) filter (where e.wbtb)::int as wbtb_nights
       from entries e
       join enrollments en on en.id = e.enrollment_id
      where en.cohort_id = $1
        and en.first_night is not null
        and e.night_key >= en.first_night
        and e.night_key <= en.first_night + 27
      group by e.enrollment_id`,
    [cohortId],
  );

  const checks = await rows<CountRow>(
    `select c.enrollment_id, count(*)::int as total
       from reality_checks c
       join enrollments en on en.id = c.enrollment_id
      where en.cohort_id = $1
      group by c.enrollment_id`,
    [cohortId],
  );

  const tallies = await rows<TallyRow>(
    `select s.enrollment_id, s.category, count(*)::int as total
       from signs s
       join enrollments en on en.id = s.enrollment_id
      where en.cohort_id = $1
      group by s.enrollment_id, s.category`,
    [cohortId],
  );

  const shared = await rows<SharedRow>(
    `select n.enrollment_id, n.id, n.night_key, n.title, n.text, (n.memo_state = 'stored') as has_memo
       from entries n
       join enrollments en on en.id = n.enrollment_id
      where en.cohort_id = $1 and en.status = 'active' and n.shared
      order by n.night_key, n.created_at`,
    [cohortId],
  );

  return members.map((member) => {
    const own = adherence.find((row) => row.enrollment_id === member.id);
    const nightKey = publishedNightKey(
      { homeTz: member.home_tz, bedtime: member.bedtime },
      now,
      member.latest_night_key,
    );
    const currentNight = nightNumber(nightKey, member.first_night);
    const nightsElapsed = Math.min(currentNight, NIGHTS_PER_COHORT);
    const memberTallies = emptyTallies();
    for (const row of tallies) {
      if (row.enrollment_id === member.id) memberTallies[row.category] = row.total;
    }
    return {
      enrollment_id: member.id,
      display_name: member.name,
      status: member.status,
      night_number: currentNight,
      nights_logged: own?.nights_logged ?? 0,
      recall_rate: recallRate(own?.recalled_nights ?? 0, nightsElapsed),
      technique_minutes: own?.technique_minutes ?? 0,
      wbtb_nights: own?.wbtb_nights ?? 0,
      reality_checks: checks.find((row) => row.enrollment_id === member.id)?.total ?? 0,
      sign_tallies: memberTallies,
      shared_entries: shared
        .filter((row) => row.enrollment_id === member.id)
        .map((row) => ({
          entry_id: row.id,
          night_key: row.night_key,
          title: row.title,
          text: row.text,
          has_memo: row.has_memo,
        })),
    };
  });
}
