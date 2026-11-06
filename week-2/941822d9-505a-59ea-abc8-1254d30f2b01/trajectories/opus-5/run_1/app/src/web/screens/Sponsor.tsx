import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { fieldErrorOf, newIdempotencyKey, request } from '../lib/api.js';
import { useFeedback } from '../lib/feedback.js';
import {
  ENROLMENT_STATE_LABELS,
  formatInstantDate,
  formatProviderDate,
  monthLabel,
  providerToday,
} from '../lib/format.js';
import { Dialog } from '../components/Dialog.js';
import type {
  Certificate,
  Course,
  Enrolment,
  LearnerSummary,
  LedgerEntry,
  Pack,
  SponsorDashboard,
} from '../lib/types.js';

const SEARCH_DEBOUNCE_MS = 250;

function packCopy(code: string): string | null {
  switch (code) {
    case 'course_not_open':
      return 'This course is no longer open for enrolment.';
    case 'payments_unavailable':
      return 'Payments are unavailable right now. Your hospital has not been charged. Try again in a few minutes.';
    case 'pack_expired':
      return 'This pack has expired.';
    case 'already_enrolled':
      return 'This nurse is already enrolled in this course.';
    case 'pack_empty':
      return 'No seats left in this pack.';
    case 'seat_in_use':
      return 'This nurse has started the course, so the seat can\u2019t be returned.';
    case 'already_returned':
      return 'This seat has already been returned.';
    case 'storage_unavailable':
      return 'File storage is unavailable right now. Try the export again in a few minutes.';
    default:
      return null;
  }
}

interface NurseDetail {
  readonly learner: { id: string; display_name: string; email: string };
  readonly enrolments: Enrolment[];
  readonly certificates: Certificate[];
}

export function Sponsor(): ReactNode {
  const feedback = useFeedback();
  const [dashboard, setDashboard] = useState<SponsorDashboard | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [openLedger, setOpenLedger] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [buyOpen, setBuyOpen] = useState(false);
  const [buyCourseId, setBuyCourseId] = useState('');
  const [buySeats, setBuySeats] = useState(1);
  const [assignPack, setAssignPack] = useState<Pack | null>(null);
  const [assignNurseId, setAssignNurseId] = useState('');
  const [pending, setPending] = useState(false);

  const [percent, setPercent] = useState('');
  const [effectiveOn, setEffectiveOn] = useState(providerToday());
  const [percentError, setPercentError] = useState<string | null>(null);
  const [effectiveError, setEffectiveError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [learners, setLearners] = useState<LearnerSummary[]>([]);
  const [openNurse, setOpenNurse] = useState<string | null>(null);
  const [nurseDetail, setNurseDetail] = useState<NurseDetail | null>(null);

  const [year, setYear] = useState(new Date().getFullYear());
  const [months, setMonths] = useState<{ month: string; completions: number; hours: string }[]>([]);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fromError, setFromError] = useState<string | null>(null);
  const [toError, setToError] = useState<string | null>(null);
  const [exportLink, setExportLink] = useState<{ url: string; rows: number } | null>(null);
  const debounce = useRef<number | null>(null);

  const loadLearners = useCallback(async (text: string): Promise<void> => {
    try {
      const result = await request<{ learners: LearnerSummary[] }>(
        `/api/sponsor/learners?q=${encodeURIComponent(text)}`,
      );
      setLearners(result.learners);
      setSearchError(null);
    } catch (error) {
      const message = fieldErrorOf(error, 'q');
      if (message !== null) setSearchError(message);
      else feedback.report(error, packCopy);
    }
  }, [feedback]);

  const loadMonths = useCallback(async (chosen: number): Promise<void> => {
    const result = await request<{ months: { month: string; completions: number; hours: string }[] }>(
      `/api/sponsor/reports/monthly?year=${chosen}`,
    );
    setMonths(result.months);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    const summary = await request<SponsorDashboard>('/api/sponsor/dashboard');
    setDashboard(summary);
    setPercent(summary.coverage.coverage_percent);
    const packResult = await request<{ packs: Pack[] }>('/api/sponsor/packs');
    setPacks(packResult.packs);
    const courseResult = await request<{ courses: Course[] }>('/api/courses');
    setCourses(courseResult.courses.filter((course) => course.format === 'self_paced' && course.state === 'published'));
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
    void loadLearners('').catch(() => undefined);
  }, [load, loadLearners]);

  useEffect(() => {
    void loadMonths(year).catch(() => undefined);
  }, [loadMonths, year]);

  useEffect(() => {
    if (openLedger === null) return;
    void request<{ entries: LedgerEntry[] }>(`/api/sponsor/packs/${openLedger}/ledger`).then(
      (result) => setLedger(result.entries),
      () => setLedger([]),
    );
  }, [openLedger, packs]);

  const reloadNurse = useCallback(async (nurseId: string): Promise<void> => {
    try {
      const detail = await request<NurseDetail>(`/api/sponsor/learners/${nurseId}`);
      setNurseDetail(detail);
    } catch {
      setNurseDetail(null);
    }
  }, []);

  async function buy(): Promise<void> {
    if (pending) return;
    setPending(true);
    feedback.announce('Recording the purchase…');
    try {
      await request('/api/sponsor/packs', {
        method: 'POST',
        body: { course_id: buyCourseId, seats: buySeats },
        idempotencyKey: newIdempotencyKey(),
      });
      setBuyOpen(false);
      await load();
      feedback.announce(`${buySeats} seats added to your hospital\u2019s packs.`);
    } catch (error) {
      feedback.report(error, packCopy);
    } finally {
      setPending(false);
    }
  }

  async function assign(): Promise<void> {
    if (assignPack === null || pending) return;
    setPending(true);
    feedback.announce('Assigning…');
    const nurse = learners.find((entry) => entry.id === assignNurseId);
    try {
      await request(`/api/sponsor/packs/${assignPack.id}/assignments`, {
        method: 'POST',
        body: { nurse_id: assignNurseId },
      });
      setAssignPack(null);
      await load();
      await loadLearners(searchText);
      feedback.announce(
        `Seat assigned to ${nurse?.display_name ?? 'the nurse'}. We\u2019ve emailed them an invitation.`,
      );
    } catch (error) {
      feedback.report(error, packCopy);
    } finally {
      setPending(false);
    }
  }

  async function returnSeat(enrolment: Enrolment): Promise<void> {
    if (enrolment.assignment_id === null) return;
    feedback.announce('Returning…');
    try {
      await request(`/api/sponsor/assignments/${enrolment.assignment_id}`, { method: 'DELETE' });
      await load();
      await loadLearners(searchText);
      if (openNurse !== null) await reloadNurse(openNurse);
      feedback.announce('Seat returned to the pack.');
    } catch (error) {
      feedback.report(error, packCopy);
    }
  }

  async function saveCoverage(): Promise<void> {
    setPercentError(null);
    setEffectiveError(null);
    feedback.announce('Saving…');
    try {
      await request('/api/sponsor/coverage', {
        method: 'PATCH',
        body: { coverage_percent: percent, effective_on: effectiveOn },
      });
      await load();
      if (effectiveOn === providerToday()) feedback.announce('Tuition coverage saved.');
      else
        feedback.announce(
          `Tuition coverage of ${percent}% scheduled from ${formatProviderDate(effectiveOn)}.`,
        );
    } catch (error) {
      const percentMessage = fieldErrorOf(error, 'coverage_percent');
      const effectiveMessage = fieldErrorOf(error, 'effective_on');
      if (percentMessage !== null || effectiveMessage !== null) {
        setPercentError(percentMessage);
        setEffectiveError(effectiveMessage);
        feedback.clear();
      } else {
        feedback.report(error, packCopy);
      }
    }
  }

  async function runExport(): Promise<void> {
    setFromError(null);
    setToError(null);
    feedback.announce('Preparing your CSV…');
    try {
      const result = await request<{ export: { id: string; rows: number; download_url: string } }>(
        '/api/sponsor/exports',
        { method: 'POST', body: { from, to } },
      );
      setExportLink({ url: result.export.download_url, rows: result.export.rows });
      feedback.announce(`Export ready: ${result.export.rows} rows.`);
    } catch (error) {
      const fromMessage = fieldErrorOf(error, 'from');
      const toMessage = fieldErrorOf(error, 'to');
      if (fromMessage !== null || toMessage !== null) {
        setFromError(fromMessage);
        setToError(toMessage);
        feedback.clear();
      } else {
        feedback.report(error, packCopy);
      }
    }
  }

  const buyCourse = courses.find((course) => course.id === buyCourseId) ?? null;
  const buyTotalCents =
    buyCourse === null ? 0 : Math.round(Number.parseFloat(buyCourse.list_price) * 100) * buySeats;
  const buyTotal = `${Math.trunc(buyTotalCents / 100)}.${String(buyTotalCents % 100).padStart(2, '0')}`;

  return (
    <>
      <h1>Hospital seats</h1>

      <section className="region" aria-label="Totals">
        <div className="totals">
          {[
            ['Seats purchased', dashboard?.seats_purchased ?? 0],
            ['Assigned', dashboard?.seats_assigned ?? 0],
            ['Available', dashboard?.seats_available ?? 0],
            ['Expired', dashboard?.seats_expired ?? 0],
            ['Completions', dashboard?.completions ?? 0],
            ['Hours awarded', dashboard?.hours_awarded ?? '0.00'],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <div className="total-label">{label}</div>
              <div className="total-figure">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="region">
        <h2>Seat packs</h2>
        <button type="button" onClick={() => setBuyOpen(true)}>
          Buy seats
        </button>
        <div className="table-wrap">
          <table className="stacked">
            <caption className="sr-only">Seat packs</caption>
            <thead>
              <tr>
                <th scope="col">Course</th>
                <th scope="col" className="num">
                  Seats
                </th>
                <th scope="col" className="num">
                  Balance
                </th>
                <th scope="col" className="num">
                  Paid
                </th>
                <th scope="col">Expires</th>
                <th scope="col">State</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {packs.map((pack) => (
                <tr key={pack.id}>
                  <td data-label="Course">{pack.course_title}</td>
                  <td data-label="Seats" className="num">
                    {pack.seats_purchased}
                  </td>
                  <td data-label="Balance" className="num">
                    {pack.balance}
                  </td>
                  <td data-label="Paid" className="num">
                    ${pack.price_total}
                  </td>
                  <td data-label="Expires">{formatInstantDate(pack.expires_at)}</td>
                  <td data-label="State">{pack.state === 'active' ? 'Active' : 'Expired'}</td>
                  <td data-label="Actions">
                    <span className="inline-actions">
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => {
                          setAssignNurseId(learners[0]?.id ?? '');
                          setAssignPack(pack);
                        }}
                      >
                        Assign seat
                      </button>
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => setOpenLedger((value) => (value === pack.id ? null : pack.id))}
                      >
                        {openLedger === pack.id ? 'Hide ledger' : 'Show ledger'}
                      </button>
                    </span>
                    {openLedger === pack.id ? (
                      <div className="table-wrap">
                        <table className="stacked">
                          <caption className="sr-only">Ledger</caption>
                          <thead>
                            <tr>
                              <th scope="col">Movement</th>
                              <th scope="col">Account</th>
                              <th scope="col" className="num">
                                Seats
                              </th>
                              <th scope="col">Posted</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ledger.map((entry, position) => (
                              <tr key={`${entry.movement_id}-${entry.account}-${position}`}>
                                <td data-label="Movement">{entry.kind}</td>
                                <td data-label="Account">{entry.account}</td>
                                <td data-label="Seats" className="num">
                                  {entry.seats}
                                </td>
                                <td data-label="Posted">{formatInstantDate(entry.posted_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="region">
        <h2>Tuition coverage</h2>
        <div className="field">
          <label htmlFor="coverage-percent">Tuition covered (%)</label>
          <input
            id="coverage-percent"
            type="text"
            inputMode="decimal"
            value={percent}
            aria-describedby={percentError === null ? undefined : 'coverage-percent-error'}
            onChange={(event) => setPercent(event.target.value)}
          />
          {percentError === null ? null : (
            <p className="field__error" id="coverage-percent-error">
              {percentError}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="coverage-effective">Effective from</label>
          <input
            id="coverage-effective"
            type="text"
            value={effectiveOn}
            aria-describedby={effectiveError === null ? undefined : 'coverage-effective-error'}
            onChange={(event) => setEffectiveOn(event.target.value)}
          />
          {effectiveError === null ? null : (
            <p className="field__error" id="coverage-effective-error">
              {effectiveError}
            </p>
          )}
        </div>
        <button type="button" onClick={() => void saveCoverage()}>
          Save coverage
        </button>
        {dashboard?.coverage.scheduled === null || dashboard?.coverage.scheduled === undefined ? null : (
          <p className="hint">
            Scheduled: {dashboard.coverage.scheduled.coverage_percent}% from{' '}
            {formatProviderDate(dashboard.coverage.scheduled.effective_on)}
          </p>
        )}
      </section>

      <section className="region">
        <h2>Nurses</h2>
        <div className="field">
          <label htmlFor="nurse-search">Search nurses</label>
          <input
            id="nurse-search"
            type="search"
            value={searchText}
            aria-describedby={searchError === null ? undefined : 'nurse-search-error'}
            onChange={(event) => {
              const value = event.target.value;
              setSearchText(value);
              if (debounce.current !== null) window.clearTimeout(debounce.current);
              debounce.current = window.setTimeout(() => void loadLearners(value), SEARCH_DEBOUNCE_MS);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (debounce.current !== null) window.clearTimeout(debounce.current);
              void loadLearners(searchText);
            }}
          />
          {searchError === null ? null : (
            <p className="field__error" id="nurse-search-error">
              {searchError}
            </p>
          )}
        </div>
        <div className="table-wrap">
          <table className="stacked">
            <caption className="sr-only">Nurses</caption>
            <thead>
              <tr>
                <th scope="col">Nurse</th>
                <th scope="col">Email</th>
                <th scope="col" className="num">
                  Seats held
                </th>
                <th scope="col" className="num">
                  Hours
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {learners.map((learner) => (
                <tr key={learner.id}>
                  <td data-label="Nurse">{learner.display_name}</td>
                  <td data-label="Email">{learner.email}</td>
                  <td data-label="Seats held" className="num">
                    {learner.seats_held}
                  </td>
                  <td data-label="Hours" className="num">
                    {learner.hours_completed}
                  </td>
                  <td data-label="Actions">
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => {
                        if (openNurse === learner.id) {
                          setOpenNurse(null);
                          setNurseDetail(null);
                          return;
                        }
                        setOpenNurse(learner.id);
                        void reloadNurse(learner.id);
                      }}
                    >
                      {openNurse === learner.id ? 'Hide enrolments' : 'Show enrolments'}
                    </button>
                    {openNurse === learner.id ? (
                      <div className="table-wrap">
                        <table className="stacked">
                          <caption className="sr-only">Nurse enrolments</caption>
                          <thead>
                            <tr>
                              <th scope="col">Course</th>
                              <th scope="col">State</th>
                              <th scope="col">Funding</th>
                              <th scope="col" className="num">
                                Progress
                              </th>
                              <th scope="col">
                                <span className="sr-only">Actions</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {(nurseDetail?.enrolments ?? []).map((enrolment) => (
                              <tr key={enrolment.id}>
                                <td data-label="Course">{enrolment.course_title}</td>
                                <td data-label="State">
                                  {ENROLMENT_STATE_LABELS[enrolment.state] ?? enrolment.state}
                                </td>
                                <td data-label="Funding">{enrolment.funding}</td>
                                <td data-label="Progress" className="num">
                                  {enrolment.progress_percent}%
                                </td>
                                <td data-label="Actions">
                                  {enrolment.funding === 'seat' && enrolment.state === 'confirmed' ? (
                                    <button
                                      type="button"
                                      className="quiet"
                                      onClick={() => void returnSeat(enrolment)}
                                    >
                                      Return seat
                                    </button>
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="region">
        <h2>Monthly hours</h2>
        <div className="field">
          <label htmlFor="report-year">Report year</label>
          <select
            id="report-year"
            value={year}
            onChange={(event) => setYear(Number.parseInt(event.target.value, 10))}
          >
            {[0, 1, 2, 3, 4].map((offset) => {
              const value = new Date().getFullYear() - offset;
              return (
                <option key={value} value={value}>
                  {value}
                </option>
              );
            })}
          </select>
        </div>
        <div className="table-wrap">
          <table className="stacked">
            <caption className="sr-only">Monthly hours</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="num">
                  Completions
                </th>
                <th scope="col" className="num">
                  Hours
                </th>
              </tr>
            </thead>
            <tbody>
              {months.map((row) => (
                <tr key={row.month}>
                  <td data-label="Month">{monthLabel(row.month)}</td>
                  <td data-label="Completions" className="num">
                    {row.completions}
                  </td>
                  <td data-label="Hours" className="num">
                    {row.hours}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="region">
        <h2>Completions export</h2>
        <div className="field">
          <label htmlFor="export-from">From</label>
          <input
            id="export-from"
            type="text"
            value={from}
            aria-describedby={fromError === null ? undefined : 'export-from-error'}
            onChange={(event) => setFrom(event.target.value)}
          />
          {fromError === null ? null : (
            <p className="field__error" id="export-from-error">
              {fromError}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="export-to">To</label>
          <input
            id="export-to"
            type="text"
            value={to}
            aria-describedby={toError === null ? undefined : 'export-to-error'}
            onChange={(event) => setTo(event.target.value)}
          />
          {toError === null ? null : (
            <p className="field__error" id="export-to-error">
              {toError}
            </p>
          )}
        </div>
        <div className="inline-actions">
          <button type="button" onClick={() => void runExport()}>
            Export completions CSV
          </button>
          {exportLink === null ? null : (
            <a className="button button--quiet" href={exportLink.url} download>
              Download CSV
            </a>
          )}
        </div>
      </section>

      {buyOpen ? (
        <Dialog title="Buy seats" onClose={() => setBuyOpen(false)}>
          <div className="field">
            <label htmlFor="buy-course">Course</label>
            <select
              id="buy-course"
              value={buyCourseId}
              onChange={(event) => setBuyCourseId(event.target.value)}
            >
              <option value="">Choose a course</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title} — ${course.list_price}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="buy-seats">Seats</label>
            <input
              id="buy-seats"
              type="number"
              min={1}
              max={500}
              value={buySeats}
              onChange={(event) => setBuySeats(Number.parseInt(event.target.value, 10) || 1)}
            />
          </div>
          <div className="dialog__actions">
            <button type="button" disabled={pending || buyCourseId === ''} onClick={() => void buy()}>
              {pending ? 'Recording the purchase…' : `Buy ${buySeats} seats for $${buyTotal}`}
            </button>
            <button type="button" className="quiet" onClick={() => setBuyOpen(false)}>
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}

      {assignPack === null ? null : (
        <Dialog title="Assign seat" onClose={() => setAssignPack(null)}>
          <div className="field">
            <label htmlFor="assign-nurse">Nurse</label>
            <select
              id="assign-nurse"
              value={assignNurseId}
              onChange={(event) => setAssignNurseId(event.target.value)}
            >
              <option value="">Choose a nurse</option>
              {learners.map((learner) => (
                <option key={learner.id} value={learner.id}>
                  {learner.display_name}
                </option>
              ))}
            </select>
          </div>
          <div className="dialog__actions">
            <button type="button" disabled={pending || assignNurseId === ''} onClick={() => void assign()}>
              {pending ? 'Assigning…' : 'Assign'}
            </button>
            <button type="button" className="quiet" onClick={() => setAssignPack(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
