import { useEffect, useRef, useState } from 'react';
import { WEEKDAYS, type Weekday } from '../../shared/time';
import { capitaliseWeekday, formatDollars } from '../../shared/format';
import { feeStatusWord, shapeClassFor } from '../../shared/status-words';
import type { CalendarRead, Fee, Settings } from '../../shared/types';
import { AddToolDialog } from '../components/AddToolDialog';
import {
  FieldMessage,
  FormProblems,
  messageFor,
  problemsFrom,
  type Problems,
} from '../components/FormProblems';
import { Announcements, SIGN_IN_AGAIN_ID } from '../components/Shell';
import { api, ApiFailed } from '../lib/api';
import { useApp } from '../lib/app-context';
import { usePoll } from '../lib/hooks';

interface HourRow {
  open: boolean;
  opens: string;
  closes: string;
}

type HourRows = Record<Weekday, HourRow>;

const EMPTY_ROW: HourRow = { open: false, opens: '', closes: '' };

function rowsFromCalendar(calendar: CalendarRead | null): HourRows {
  const rows = {} as HourRows;
  for (const weekday of WEEKDAYS) {
    const found = calendar?.hours.find((entry) => entry.weekday === weekday);
    rows[weekday] = found
      ? { open: true, opens: found.opens, closes: found.closes }
      : { ...EMPTY_ROW };
  }
  return rows;
}

export function Office(): JSX.Element {
  const app = useApp();
  const { calendar, announce, navigate, restoredDraft, consumeDraft } = app;

  const settings = usePoll<Settings>('/api/settings', 10000);
  const fees = usePoll<{ fees: Fee[] }>('/api/fees', 10000);

  const [rows, setRows] = useState<HourRows>(() => rowsFromCalendar(calendar));
  const [editedRows, setEditedRows] = useState<Set<Weekday>>(new Set());
  const [feeFields, setFeeFields] = useState({ late: '', damage: '', period: '', zone: '' });
  const [editedFeeFields, setEditedFeeFields] = useState(false);
  const [closureDate, setClosureDate] = useState('');
  const [closureReason, setClosureReason] = useState('');
  const [editedClosure, setEditedClosure] = useState(false);
  const [hoursProblems, setHoursProblems] = useState<Problems | null>(null);
  const [feeProblems, setFeeProblems] = useState<Problems | null>(null);
  const [pendingLabel, setPendingLabel] = useState<Record<string, string | null>>({});
  const [addToolOpen, setAddToolOpen] = useState(false);

  const summary = useRef<HTMLDivElement>(null);
  const hourFields = useRef<Record<string, HTMLInputElement | null>>({});
  const addToolOpener = useRef<HTMLButtonElement>(null);
  const restored = useRef(false);

  // Rows and fields the coordinator has not touched follow the server.
  useEffect(() => {
    setRows((current) => {
      const fresh = rowsFromCalendar(calendar);
      const merged = {} as HourRows;
      for (const weekday of WEEKDAYS) {
        merged[weekday] = editedRows.has(weekday)
          ? (current[weekday] as HourRow)
          : (fresh[weekday] as HourRow);
      }
      return merged;
    });
  }, [calendar, editedRows]);

  useEffect(() => {
    if (editedFeeFields || !settings.data) return;
    setFeeFields({
      late: formatDollars(settings.data.late_fee_cents),
      damage: formatDollars(settings.data.damage_fee_cents),
      period: String(settings.data.loan_period_days),
      zone: settings.data.time_zone,
    });
  }, [settings.data, editedFeeFields]);

  useEffect(() => {
    if (!restoredDraft || restored.current) return;
    restored.current = true;
    const fields = restoredDraft.fields;
    if (fields.closureDate !== undefined || fields.closureReason !== undefined) {
      setClosureDate(fields.closureDate ?? '');
      setClosureReason(fields.closureReason ?? '');
      setEditedClosure(true);
    }
    if (fields.late !== undefined) {
      setFeeFields({
        late: fields.late ?? '',
        damage: fields.damage ?? '',
        period: fields.period ?? '',
        zone: fields.zone ?? '',
      });
      setEditedFeeFields(true);
    }
    const keptRows = Object.keys(restoredDraft.hourRows) as Weekday[];
    if (keptRows.length > 0) {
      setRows((current) => {
        const merged = { ...current };
        for (const weekday of keptRows) {
          merged[weekday] = restoredDraft.hourRows[weekday] as HourRow;
        }
        return merged;
      });
      setEditedRows(new Set(keptRows));
    }
    consumeDraft();
  }, [restoredDraft, consumeDraft]);

  function draftFields(): Record<string, string> {
    return {
      late: feeFields.late,
      damage: feeFields.damage,
      period: feeFields.period,
      zone: feeFields.zone,
      closureDate,
      closureReason,
    };
  }

  function handleSessionEnded(error: ApiFailed): boolean {
    if (!(error.status === 401 && error.error.includes('session'))) return false;
    const kept: Record<string, HourRow> = {};
    for (const weekday of editedRows) kept[weekday] = rows[weekday] as HourRow;
    app.noteSessionEnded(error.error, {
      fields: draftFields(),
      hourRows: kept,
      waiverReason: null,
      selectedLoanId: null,
      selectedItemId: null,
    });
    window.setTimeout(() => document.getElementById(SIGN_IN_AGAIN_ID)?.focus(), 0);
    return true;
  }

  function editRow(weekday: Weekday, change: Partial<HourRow>): void {
    setRows({ ...rows, [weekday]: { ...(rows[weekday] as HourRow), ...change } });
    setEditedRows(new Set([...editedRows, weekday]));
  }

  async function saveHours(): Promise<void> {
    setPendingLabel({ ...pendingLabel, hours: 'Saving...' });
    try {
      const hours = WEEKDAYS.filter((weekday) => (rows[weekday] as HourRow).open).map(
        (weekday) => ({
          weekday,
          opens: (rows[weekday] as HourRow).opens,
          closes: (rows[weekday] as HourRow).closes,
        }),
      );
      const result = await api.put<{ moved_loans: number }>('/api/calendar/hours', { hours });
      setHoursProblems(null);
      setEditedRows(new Set());
      announce(`Opening hours saved. ${result.moved_loans} loans moved to the next open day.`);
      await app.reloadBoard();
    } catch (error) {
      if (!(error instanceof ApiFailed)) return;
      if (handleSessionEnded(error)) return;
      if (error.status === 422) {
        setHoursProblems(problemsFrom(error.fields));
        window.setTimeout(() => summary.current?.focus(), 0);
      } else {
        announce(error.error);
      }
    } finally {
      setPendingLabel({ ...pendingLabel, hours: null });
    }
  }

  async function saveFeeRules(): Promise<void> {
    setPendingLabel({ ...pendingLabel, fees: 'Saving...' });
    try {
      await api.put('/api/settings', {
        time_zone: feeFields.zone,
        late_fee_cents: Math.round(Number(feeFields.late) * 100),
        damage_fee_cents: Math.round(Number(feeFields.damage) * 100),
        loan_period_days: Number(feeFields.period),
      });
      setFeeProblems(null);
      setEditedFeeFields(false);
      announce('Fee rules saved. They apply to loans checked out from now on.');
      await settings.reload();
    } catch (error) {
      if (!(error instanceof ApiFailed)) return;
      if (handleSessionEnded(error)) return;
      if (error.status === 422) {
        setFeeProblems(problemsFrom(error.fields));
        window.setTimeout(() => summary.current?.focus(), 0);
      } else {
        announce(error.error);
      }
    } finally {
      setPendingLabel({ ...pendingLabel, fees: null });
    }
  }

  async function declareClosure(): Promise<void> {
    setPendingLabel({ ...pendingLabel, closure: 'Saving...' });
    try {
      const result = await api.post<{ moved_loans: number; new_due_date: string }>(
        '/api/closures',
        { date: closureDate, reason: closureReason },
      );
      announce(`Closure saved. ${result.moved_loans} loans now due ${result.new_due_date}.`);
      setClosureDate('');
      setClosureReason('');
      setEditedClosure(false);
      await app.reloadBoard();
    } catch (error) {
      if (!(error instanceof ApiFailed)) return;
      if (handleSessionEnded(error)) return;
      if (error.status === 422) {
        setFeeProblems(problemsFrom(error.fields));
        window.setTimeout(() => summary.current?.focus(), 0);
      } else {
        announce(error.error);
      }
    } finally {
      setPendingLabel({ ...pendingLabel, closure: null });
    }
  }

  void editedClosure;

  const waiverRequests = (fees.data?.fees ?? []).filter(
    (fee) => fee.waiver?.status === 'requested' && fee.status === 'raised',
  );

  return (
    <>
      <Announcements kind="desk" />
      {addToolOpen ? null : (
        <FormProblems
          problems={hoursProblems ?? feeProblems}
          ref={summary}
          onJump={(field) => hourFields.current[field]?.focus()}
        />
      )}

      <section className="panel" aria-label="Fee rules">
        <h2>Fee rules</h2>
        <label>
          Late fee per open day
          <input
            aria-label="Late fee per open day"
            className="numerals"
            value={feeFields.late}
            onChange={(event) => {
              setFeeFields({ ...feeFields, late: event.target.value });
              setEditedFeeFields(true);
            }}
          />
        </label>
        <FieldMessage message={messageFor(feeProblems, 'late_fee_cents')} />
        <label>
          Damage fee
          <input
            aria-label="Damage fee"
            className="numerals"
            value={feeFields.damage}
            onChange={(event) => {
              setFeeFields({ ...feeFields, damage: event.target.value });
              setEditedFeeFields(true);
            }}
          />
        </label>
        <FieldMessage message={messageFor(feeProblems, 'damage_fee_cents')} />
        <label>
          Loan period in days
          <input
            aria-label="Loan period in days"
            className="numerals"
            value={feeFields.period}
            onChange={(event) => {
              setFeeFields({ ...feeFields, period: event.target.value });
              setEditedFeeFields(true);
            }}
          />
        </label>
        <FieldMessage message={messageFor(feeProblems, 'loan_period_days')} />
        <label>
          Time zone
          <select
            aria-label="Time zone"
            value={feeFields.zone}
            onChange={(event) => {
              setFeeFields({ ...feeFields, zone: event.target.value });
              setEditedFeeFields(true);
            }}
          >
            {[feeFields.zone, 'America/Chicago', 'America/New_York', 'America/Denver',
              'America/Los_Angeles', 'Europe/London', 'UTC']
              .filter((zone, index, all) => zone !== '' && all.indexOf(zone) === index)
              .map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
          </select>
        </label>
        <FieldMessage message={messageFor(feeProblems, 'time_zone')} />
        <button
          type="button"
          aria-busy={pendingLabel.fees != null}
          onClick={() => void saveFeeRules()}
        >
          {pendingLabel.fees ?? 'Save fee rules'}
        </button>
      </section>

      <section className="panel" aria-label="Opening calendar">
        <h2>Opening calendar</h2>
        <table aria-label="Opening hours" className="ledger hours-table">
          <tbody>
            {WEEKDAYS.map((weekday) => {
              const row = rows[weekday] as HourRow;
              const name = capitaliseWeekday(weekday);
              return (
                <tr key={weekday} className="hours-row">
                  <td className="hours-cell hours-cell-day">
                    <label className="hours-toggle">
                      <input
                        type="checkbox"
                        aria-label={`Open on ${name}`}
                        checked={row.open}
                        onChange={(event) => editRow(weekday, { open: event.target.checked })}
                      />
                      <span>{name}</span>
                    </label>
                  </td>
                  <td className="hours-cell hours-cell-opens">
                    <input
                      aria-label={`${name} opens`}
                      className="numerals"
                      disabled={!row.open}
                      tabIndex={row.open ? 0 : -1}
                      value={row.opens}
                      onChange={(event) => editRow(weekday, { opens: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void saveHours();
                        }
                      }}
                      ref={(element) => {
                        hourFields.current[`hours.${weekday}.opens`] = element;
                      }}
                    />
                    <FieldMessage message={messageFor(hoursProblems, `hours.${weekday}.opens`)} />
                  </td>
                  <td className="hours-cell hours-cell-closes">
                    <input
                      aria-label={`${name} closes`}
                      className="numerals"
                      disabled={!row.open}
                      tabIndex={row.open ? 0 : -1}
                      value={row.closes}
                      onChange={(event) => editRow(weekday, { closes: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void saveHours();
                        }
                      }}
                      ref={(element) => {
                        hourFields.current[`hours.${weekday}.closes`] = element;
                      }}
                    />
                    <FieldMessage message={messageFor(hoursProblems, `hours.${weekday}.closes`)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button
          type="button"
          aria-busy={pendingLabel.hours != null}
          onClick={() => void saveHours()}
        >
          {pendingLabel.hours ?? 'Save hours'}
        </button>
        <FieldMessage message={messageFor(hoursProblems, 'hours')} />

        <label>
          Closure date
          <input
            aria-label="Closure date"
            className="numerals"
            value={closureDate}
            onChange={(event) => {
              setClosureDate(event.target.value);
              setEditedClosure(true);
            }}
          />
        </label>
        <FieldMessage message={messageFor(feeProblems, 'date')} />
        <label>
          Closure reason
          <input
            aria-label="Closure reason"
            value={closureReason}
            onChange={(event) => {
              setClosureReason(event.target.value);
              setEditedClosure(true);
            }}
          />
        </label>
        <FieldMessage message={messageFor(feeProblems, 'reason')} />
        <button
          type="button"
          aria-busy={pendingLabel.closure != null}
          onClick={() => void declareClosure()}
        >
          {pendingLabel.closure ?? 'Declare closure'}
        </button>

        <table aria-label="Closures" className="ledger">
          <thead>
            <tr>
              <th>Date</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {(calendar?.closures ?? []).map((closure) => (
              <tr key={closure.date}>
                <td className="numerals">{closure.date}</td>
                <td>{closure.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel" aria-label="Inventory">
        <h2>Inventory</h2>
        <button type="button" ref={addToolOpener} onClick={() => setAddToolOpen(true)}>
          Add tool
        </button>
      </section>

      {addToolOpen ? (
        <AddToolDialog
          onClose={() => {
            setAddToolOpen(false);
            window.setTimeout(() => addToolOpener.current?.focus(), 0);
          }}
          onAdded={(tag) => {
            setAddToolOpen(false);
            announce(`${tag} added to the board.`);
            void app.reloadBoard();
            window.setTimeout(() => addToolOpener.current?.focus(), 0);
          }}
        />
      ) : null}

      <section className="panel">
        <h2>Waiver requests</h2>
        <table aria-label="Waiver requests" className="ledger">
          <thead>
            <tr>
              <th>Fee</th>
              <th>Loan</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {waiverRequests.map((fee) => (
              <tr key={fee.id}>
                <td>
                  <a
                    className="numerals"
                    href={`/fees/${fee.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(`/fees/${fee.id}`);
                    }}
                  >
                    Fee {fee.id}
                  </a>
                </td>
                <td className="numerals">{fee.loan_ref}</td>
                <td>{fee.waiver?.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Fees</h2>
        <table aria-label="Fees" className="ledger">
          <thead>
            <tr>
              <th>Fee</th>
              <th>Loan</th>
              <th>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(fees.data?.fees ?? []).map((fee) => (
              <tr key={fee.id}>
                <td>
                  <a
                    className="numerals"
                    href={`/fees/${fee.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(`/fees/${fee.id}`);
                    }}
                  >
                    Fee {fee.id}
                  </a>
                </td>
                <td className="numerals">{fee.loan_ref}</td>
                <td className="numerals">${formatDollars(fee.total_cents)}</td>
                <td>
                  <span className={shapeClassFor(feeStatusWord(fee.status))}>
                    {feeStatusWord(fee.status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
