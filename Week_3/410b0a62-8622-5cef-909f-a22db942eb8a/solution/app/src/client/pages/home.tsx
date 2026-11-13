import { useEffect, useMemo, useState } from 'react';
import { addDays, isoWeekOf, isValidWeek, mondayOfWeek } from '../../shared/dates.js';
import type { AthleteDetail, AthleteRow, LibraryItem, SeriesDay, Workout, WeekSummary, WeeksResponse } from '../../shared/types.js';
import { get, isNotFound } from '../api.js';
import { useAnnouncer, useLoaded } from '../hooks.js';
import { navigate } from '../router.js';
import { useMe } from '../session.js';
import { NotFound } from '../shell.js';
import { Pill, Skeleton } from '../ui.js';
import { useCalendar, weekDates } from '../home/calendar.js';
import { FitnessChart } from '../home/chart.js';
import { CopyWeekDialog, LogSessionDialog } from '../home/dialogs.js';
import { Rail, weekAnnouncement } from '../home/rail.js';
import { ComplianceRings, CountdownBand, LibraryPanel, SportTiles, ThresholdsPanel, TodayBanner, UploadsWall } from '../home/sections.js';

const CHUNK = 13;
const AROUND = 4;
const RECENT_TILES = 10;
const RECENT_LOOKBACK_WINDOWS = 8;

const shiftWeek = (week: string, count: number): string => isoWeekOf(addDays(mondayOfWeek(week), count * 7));

async function fetchRange(athleteId: string, first: string, count: number): Promise<WeekSummary[]> {
  const chunks = Array.from({ length: Math.ceil(count / CHUNK) }, (_, index) => {
    const size = Math.min(CHUNK, count - index * CHUNK);
    return get<WeeksResponse>(`/api/athletes/${athleteId}/weeks?week=${shiftWeek(first, index * CHUNK)}&before=0&after=${size - 1}`);
  });
  return (await Promise.all(chunks)).flatMap((response) => response.weeks);
}

/** The newest completed workouts, reading back from this week in windows until there are enough or history ends. */
async function fetchRecent(athleteId: string, todayWeek: string, seriesStart: string): Promise<{ title: string; date: string; tss: number }[]> {
  const found: { title: string; date: string; tss: number }[] = [];
  let last = todayWeek;
  for (let window = 0; window < RECENT_LOOKBACK_WINDOWS && found.length < RECENT_TILES; window++) {
    const weeks = await fetchRange(athleteId, shiftWeek(last, -(CHUNK - 1)), CHUNK);
    for (const week of [...weeks].reverse()) {
      for (const day of [...week.days].reverse()) {
        for (const item of [...day.items].reverse()) {
          if (item.completed) found.push({ title: item.completed.title, date: item.completed.date, tss: item.completed.tss ?? 0 });
        }
      }
    }
    last = shiftWeek(last, -CHUNK);
    if (addDays(mondayOfWeek(last), 6) < seriesStart) break;
  }
  return found.slice(0, RECENT_TILES);
}

export function Home({ athleteId, params }: { athleteId: string; params: URLSearchParams }) {
  const me = useMe();
  const today = me.today;
  const todayWeek = isoWeekOf(today);
  const requested = params.get('week');
  const [centre, setCentre] = useState(isValidWeek(requested) ? requested : todayWeek);
  const [range, setRange] = useState({ first: shiftWeek(centre, -AROUND), count: 2 * AROUND + 1 });
  const [logging, setLogging] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const session = useAnnouncer();
  const weekStatus = useAnnouncer();

  const detail = useLoaded(() => get<AthleteDetail>(`/api/athletes/${athleteId}`), [athleteId], [athleteId]);
  const weeks = useLoaded(() => fetchRange(athleteId, range.first, range.count), [athleteId, range.first, range.count], [athleteId]);
  const series = useLoaded(() => get<{ days: SeriesDay[] }>(`/api/athletes/${athleteId}/series`).then((body) => body.days), [athleteId], [athleteId]);
  const rings = useLoaded(() => get<WeeksResponse>(`/api/athletes/${athleteId}/weeks?week=${centre}&before=11&after=0`).then((body) => body.weeks), [athleteId, centre], [athleteId]);
  const recent = useLoaded(() => fetchRecent(athleteId, todayWeek, detail.data?.series_start ?? today), [athleteId, detail.data?.series_start], [athleteId]);
  const library = useLoaded(() => get<{ library: LibraryItem[] }>('/api/library').then((body) => body.library), [], []);
  const athletes = useLoaded(
    () => (me.role === 'coach' ? get<{ athletes: AthleteRow[] }>('/api/athletes').then((body) => body.athletes) : Promise.resolve([])),
    [me.role]
  );

  useEffect(() => {
    if (isValidWeek(requested) && requested !== centre) setCentre(requested);
  }, [requested]);

  useEffect(() => {
    const last = shiftWeek(range.first, range.count - 1);
    if (centre < range.first || centre > last) setRange({ first: shiftWeek(centre, -AROUND), count: 2 * AROUND + 1 });
  }, [centre, range]);

  const centred = weeks.data?.find((week) => week.week === centre) ?? null;
  const centreMonday = mondayOfWeek(centre);

  const calendar = useCalendar({
    athleteId,
    weekDays: weekDates(centreMonday),
    today,
    layoutKey: useMemo(() => JSON.stringify((weeks.data ?? []).map((week) => week.days.map((day) => day.items.map((item) => `${item.planned?.id}@${day.date}`)))), [weeks.data]),
    onChanged: weeks.reload
  });

  if ([detail.error, weeks.error, series.error].some((error) => error && isNotFound(error))) return <NotFound />;

  const choose = (week: string): void => {
    if (week === centre) return;
    setCentre(week);
    navigate(`/athletes/${athleteId}?week=${week}`, true);
    const target = weeks.data?.find((candidate) => candidate.week === week);
    if (target) weekStatus.say(weekAnnouncement(target));
  };

  const reloadAll = (): void => {
    weeks.reload();
    series.reload();
    rings.reload();
    recent.reload();
    detail.reload();
  };

  const planned: Workout[] = (centred?.days ?? []).flatMap((day) => day.items.flatMap((item) => (item.planned ? [item.planned] : [])));
  const ready = detail.data && weeks.data && series.data && centred;

  if (!ready || !series.data || !detail.data || !weeks.data || !centred) {
    return (
      <>
        {/* Keyed apart from the loaded layout: the skeleton is replaced, never moved, when the data lands. */}
        <section key="skeleton-band" aria-label="Today" className="today-band today-skeleton">
          <div className="wrap band-content">
            <Skeleton lines={3} className="skeleton-light" />
          </div>
        </section>
        <div key="skeleton-card" className="wrap">
          <Skeleton lines={5} className="skeleton-card" />
        </div>
      </>
    );
  }

  return (
    <>
      <TodayBanner
        name={athleteId === me.id ? null : detail.data.name}
        series={series.data}
        onPlan={() => navigate(`/athletes/${athleteId}/builder?date=${today}`)}
        onLog={() => setLogging(today)}
      />
      <div className="wrap chart-wrap">
        <FitnessChart days={series.data} centreMonday={centreMonday} centreWeek={centre} />
      </div>
      <Rail
        weeks={weeks.data}
        centre={centre}
        today={today}
        calendar={calendar}
        weekStatus={weekStatus}
        onCentre={choose}
        onLoadEarlier={() => setRange((current) => ({ first: shiftWeek(current.first, -4), count: current.count + 4 }))}
        onLoadLater={() => setRange((current) => ({ ...current, count: current.count + 4 }))}
        onLog={setLogging}
        onPlan={(date) => navigate(`/athletes/${athleteId}/builder?date=${date}`)}
        actions={
          me.role === 'coach' && (
            <Pill tone="ghost" className="pill-compact" onClick={() => setCopying(true)}>
              Copy week
            </Pill>
          )
        }
        aside={<LibraryPanel items={library.data ?? []} calendar={calendar} />}
      />
      <SportTiles week={centred} />
      <ThresholdsPanel athleteId={athleteId} today={today} history={detail.data.thresholds} onSaved={reloadAll} />
      <ComplianceRings weeks={rings.data ?? [centred]} />
      <UploadsWall recent={recent.data ?? []} />
      <CountdownBand today={today} events={detail.data.events} />
      <div role="status" aria-label="Session status" className="session-status">
        {session.text && <span key={session.seq}>{session.text}</span>}
      </div>
      {logging && <LogSessionDialog athleteId={athleteId} date={logging} session={session} onClose={() => setLogging(null)} onSaved={reloadAll} />}
      {copying && athletes.data && <CopyWeekDialog athleteId={athleteId} week={centre} planned={planned} athletes={athletes.data} onClose={() => setCopying(false)} />}
    </>
  );
}
