import { useCallback, useEffect, useState } from 'react';
import { NoReply, send } from '../api.ts';
import {
  CHARGES_TEXT,
  LADDER_REFUSED_HEADING,
  LATE_AMENDMENT,
  LATE_CANCELLATION,
  NOTICE_LATE,
  NOTICE_ON_TIME,
  NO_REPLY,
  cutoffText,
  marginFromMm,
  money,
} from '../format.ts';
import { useInterval, useKeyedControl } from '../hooks.ts';
import { useNavigation } from '../main.tsx';
import { Panel } from '../parts/Panel.tsx';
import { WaypointTable } from '../parts/WaypointTable.tsx';
import type { Move, Plan, SessionUser, Vessel } from '../types.ts';
import { NotFound } from './NotFound.tsx';

type Dialog = 'none' | 'amend' | 'cancel' | 'reorder';

export function MoveScreen({ user, ref_ }: { user: SessionUser; ref_: string }): JSX.Element {
  const navigation = useNavigation();
  const [move, setMove] = useState<Move | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [vessel, setVessel] = useState<Vessel | null>(null);
  const [missing, setMissing] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<Dialog>('none');
  const [amendTime, setAmendTime] = useState('');
  const [amendDate, setAmendDate] = useState('');
  const [amendDraught, setAmendDraught] = useState('');
  const [correction, setCorrection] = useState('');
  const [reorderDate, setReorderDate] = useState('');
  const [reorderTime, setReorderTime] = useState('');
  const control = useKeyedControl();

  const load = useCallback(async (): Promise<void> => {
    const reply = await send<Move>('GET', `/api/moves/${encodeURIComponent(ref_)}`).catch(
      () => null,
    );
    if (reply === null) return;
    if (!reply.ok) {
      if (reply.status === 404) setMissing(true);
      return;
    }
    setMove(reply.data);
    setAmendDate(reply.data.boarding_at.slice(0, 10));
    setAmendTime(reply.data.boarding_at.slice(11, 16));
    setAmendDraught(reply.data.draught.metres);
    setReorderDate(reply.data.boarding_at.slice(0, 10));
    setReorderTime(reply.data.boarding_at.slice(11, 16));
    if (user.role !== 'clerk') {
      const planReply = await send<Plan>(
        'GET',
        `/api/moves/${encodeURIComponent(ref_)}/plan`,
      ).catch(() => null);
      if (planReply !== null && planReply.ok) setPlan(planReply.data);
      const vessels = await send<{ vessels: Vessel[] }>('GET', '/api/vessels').catch(() => null);
      if (vessels !== null && vessels.ok) {
        setVessel(vessels.data.vessels.find((entry) => entry.id === reply.data.vessel.id) ?? null);
      }
    }
  }, [ref_, user.role]);

  useEffect(() => {
    void load();
  }, [load]);

  useInterval(() => {
    void load();
  }, 30_000);

  if (missing) return <NotFound />;
  if (move === null) return <p>Loading...</p>;

  const mayAct =
    user.role === 'dispatcher' || (user.role === 'pilot' && move.pilot?.name === user.name);
  const statusAction = (to: 'Pilot away' | 'On board' | 'Completed'): void => {
    if (control.pending) return;
    const key = control.keyFor(JSON.stringify([move.ref, to]));
    control.setPending(true);
    setAnnouncement('Saving...');
    void (async () => {
      try {
        const reply = await send<Move>(
          'POST',
          `/api/moves/${encodeURIComponent(move.ref)}/transitions`,
          { body: { to }, key },
        );
        control.replyReceived();
        if (reply.ok) {
          setMove(reply.data);
          setAnnouncement(
            to === 'Completed'
              ? 'Move completed. Charges post when the billing provider confirms.'
              : `Status now ${reply.data.status}`,
          );
          await load();
          return;
        }
        setAnnouncement("This action is not available for the move's current status.");
      } catch (cause) {
        if (cause instanceof NoReply) setAnnouncement(NO_REPLY);
      } finally {
        control.setPending(false);
      }
    })();
  };

  const detention = (action: 'start' | 'stop'): void => {
    if (control.pending) return;
    const key = control.keyFor(JSON.stringify([move.ref, action]));
    control.setPending(true);
    setAnnouncement('Saving...');
    void (async () => {
      try {
        const reply = await send<Move>(
          'POST',
          `/api/moves/${encodeURIComponent(move.ref)}/detention`,
          { body: { action }, key },
        );
        control.replyReceived();
        if (reply.ok) {
          setMove(reply.data);
          setAnnouncement(`Status now ${reply.data.detained ? 'On board - detained' : reply.data.status}`);
          await load();
          return;
        }
        setAnnouncement("This action is not available for the move's current status.");
      } catch (cause) {
        if (cause instanceof NoReply) setAnnouncement(NO_REPLY);
      } finally {
        control.setPending(false);
      }
    })();
  };

  const saveAmendment = (): void => {
    setAnnouncement('Saving amendment...');
    void (async () => {
      try {
        const reply = await send<Move>('PATCH', `/api/moves/${encodeURIComponent(move.ref)}`, {
          body: {
            boarding_at: `${amendDate}T${amendTime}`,
            draught_m: Number(amendDraught),
          },
          ifMatch: move.version,
        });
        if (reply.ok) {
          setMove(reply.data);
          setAnnouncement(
            reply.data.window_returned === true
              ? 'Amendment saved. Window no longer clears - move returned to Ordered.'
              : 'Amendment saved',
          );
          setNotice(reply.data.late_notice === true ? LATE_AMENDMENT : '');
          setDialog('none');
          await load();
          return;
        }
        setAnnouncement(
          reply.error.error === 'not_amendable'
            ? 'This move can no longer be amended.'
            : 'This move changed. Fresh data shown.',
        );
        if (reply.error.current !== undefined) setMove(reply.error.current);
      } catch (cause) {
        if (cause instanceof NoReply) setAnnouncement(NO_REPLY);
      }
    })();
  };

  const confirmCancellation = (): void => {
    if (control.pending) return;
    const key = control.keyFor(JSON.stringify([move.ref, 'cancel']));
    control.setPending(true);
    setAnnouncement('Cancelling move...');
    void (async () => {
      try {
        const reply = await send<Move>(
          'POST',
          `/api/moves/${encodeURIComponent(move.ref)}/cancel`,
          { body: {}, key },
        );
        control.replyReceived();
        if (reply.ok) {
          setMove(reply.data);
          setAnnouncement(
            reply.data.status === 'Cancelled late' ? LATE_CANCELLATION : 'Move cancelled',
          );
          setNotice(reply.data.status === 'Cancelled late' ? LATE_CANCELLATION : '');
          setDialog('none');
          await load();
          return;
        }
        setAnnouncement('This move can no longer be cancelled.');
      } catch (cause) {
        if (cause instanceof NoReply) setAnnouncement(NO_REPLY);
      } finally {
        control.setPending(false);
      }
    })();
  };

  const placeReorder = (): void => {
    setAnnouncement('Saving...');
    void (async () => {
      try {
        const reply = await send<Move>(
          'POST',
          `/api/moves/${encodeURIComponent(move.ref)}/reorder`,
          { body: { boarding_at: `${reorderDate}T${reorderTime}`, correction } },
        );
        if (reply.ok) {
          setMove(reply.data);
          setAnnouncement(`Status now ${reply.data.status}`);
          setDialog('none');
          await load();
          return;
        }
        setAnnouncement(reply.error.message);
      } catch (cause) {
        if (cause instanceof NoReply) setAnnouncement(NO_REPLY);
      }
    })();
  };

  const verdict = move.notice.state === 'late' ? NOTICE_LATE : NOTICE_ON_TIME;
  const cutoff = cutoffText(move.notice.cutoff_at, move.notice.cutoff_utc_offset);

  return (
    <section className="pane" aria-label={`Move ${move.ref}`}>
      <h1>{`${move.ref} ${move.vessel.name}`}</h1>
      {move.status === 'Refused at ladder' && <h2>{LADDER_REFUSED_HEADING}</h2>}
      <div className="rows">
        <div className="row">
          <span>{move.detained ? 'On board - detained' : move.status}</span>
          <span className="mono">{`Boarding ${move.boarding_at.replace('T', ' ')} port time`}</span>
          <span className="mono">{`Draught ${move.draught.metres} m / ${move.draught.feet}`}</span>
          <span className="mono">{`Speed ${move.speed_kn} kn`}</span>
        </div>
        <div className="row">
          <span aria-label="Notice cutoff" className="mono">{`Notice cutoff ${cutoff}`}</span>
          <span aria-label="Notice verdict">{verdict}</span>
          <span aria-label="Charges">{CHARGES_TEXT[move.billing.state] as string}</span>
        </div>
        {move.committed !== null && (
          <div className="row">
            <span className="mono">{`Committed ${move.committed.boarding_at.replace('T', ' ')} port time`}</span>
            <span className="mono">{`Pinch ${move.committed.pinch_waypoint} ${marginFromMm(move.committed.margin_mm)} m`}</span>
          </div>
        )}
        {move.pilot !== null && <div className="row">{`Pilot ${move.pilot.name}`}</div>}
      </div>

      <div className="keel-controls">
        {(user.role === 'agent' || user.role === 'dispatcher') && (
          <button type="button" onClick={() => setDialog('amend')}>
            Amend move
          </button>
        )}
        {(user.role === 'agent' || user.role === 'dispatcher') && (
          <button type="button" onClick={() => setDialog('cancel')}>
            Cancel move
          </button>
        )}
        {user.role === 'agent' && move.status === 'Refused at ladder' && (
          <button type="button" onClick={() => setDialog('reorder')}>
            Corrected re-order
          </button>
        )}
        {mayAct && move.status === 'Pilot assigned' && (
          <button type="button" onClick={() => statusAction('Pilot away')}>
            Confirm pilot away
          </button>
        )}
        {mayAct && move.status === 'Pilot away' && (
          <button type="button" onClick={() => statusAction('On board')}>
            Confirm boarding
          </button>
        )}
        {mayAct && move.status === 'On board' && (
          <button type="button" onClick={() => statusAction('Completed')}>
            Complete move
          </button>
        )}
        {mayAct && move.status === 'On board' && !move.detained && (
          <button type="button" onClick={() => detention('start')}>
            Start detention
          </button>
        )}
        {mayAct && move.status === 'On board' && move.detained && (
          <button type="button" onClick={() => detention('stop')}>
            Stop detention
          </button>
        )}
        {vessel?.pilot_card_id !== undefined && vessel?.pilot_card_id !== null && (
          <a href={`/api/vessels/${move.vessel.id}/pilot-cards/${vessel.pilot_card_id}/content`}>
            Pilot card
          </a>
        )}
      </div>
      <div role="status" aria-label="Move announcements" className="announce">
        {announcement}
      </div>
      {notice !== '' && <p className="alert">{notice}</p>}

      {plan !== null && (
        <>
          <h3>Plan</h3>
          <WaypointTable plan={plan} />
        </>
      )}

      <h3>Notices</h3>
      <ul aria-label="Notices">
        {move.notices.map((entry, index) => (
          <li key={`${entry.kind}-${index}`}>{`${entry.kind}: ${entry.state}`}</li>
        ))}
        {move.notices.length === 0 && <li className="dim">No notices</li>}
      </ul>

      <h3>Ladder reports</h3>
      <ul>
        {move.ladder_reports.map((id) => (
          <li key={id}>
            <a href={`/reports/${id}`}>{`Open report ${id}`}</a>
          </li>
        ))}
        {move.ladder_reports.length === 0 && <li className="dim">No ladder reports</li>}
      </ul>

      <h3>Charge lines</h3>
      <div className="scroll-x">
        <table aria-label="Charge lines">
        <thead>
          <tr>
            <th scope="col">Label</th>
            <th scope="col">Quantity</th>
            <th scope="col">Unit</th>
            <th scope="col">Amount</th>
            <th scope="col">Revision</th>
          </tr>
        </thead>
        <tbody>
          {move.lines.map((line, index) => (
            <tr key={`${line.label}-${index}`}>
              <th scope="row">{line.label}</th>
              <td>{line.quantity}</td>
              <td>{money(line.unit_cents)}</td>
              <td>{money(line.amount_cents)}</td>
              <td>{line.tariff_revision}</td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
      {move.billing.invoice_ids.length > 0 && (
        <ul>
          {move.billing.invoice_ids.map((id) => (
            <li key={id}>
              <a href={`/invoices/${id}`}>{`Open invoice ${id}`}</a>
            </li>
          ))}
        </ul>
      )}

      {move.corrections.length > 0 && (
        <>
          <h3>Corrections</h3>
          <ul>
            {move.corrections.map((entry, index) => (
              <li key={index}>{`${entry.at.replace('T', ' ')} ${entry.by}: ${entry.text}`}</li>
            ))}
          </ul>
        </>
      )}

      {move.dispatcher_notes !== undefined && move.dispatcher_notes.length > 0 && (
        <>
          <h3>Dispatcher notes</h3>
          <ul>
            {move.dispatcher_notes.map((entry, index) => (
              <li key={index}>{`${entry.at.replace('T', ' ')} ${entry.by}: ${entry.note}`}</li>
            ))}
          </ul>
        </>
      )}

      {move.rest_override !== undefined && move.rest_override !== null && (
        <>
          <h3>Rest override</h3>
          <p>{`${move.rest_override.by} at ${move.rest_override.at.replace('T', ' ')}: ${move.rest_override.reason}`}</p>
        </>
      )}

      <h3>History</h3>
      <ul aria-label="History">
        {move.history.map((entry, index) => (
          <li key={index} className="mono">{`${entry.at.replace('T', ' ')} ${entry.status} ${entry.by}`}</li>
        ))}
      </ul>

      <Panel open={dialog === 'amend'} label="Amend move" kind="dialog" onClose={() => setDialog('none')}>
        <h3>{`Amend ${move.ref}`}</h3>
        <p aria-label="Notice cutoff" className="mono">{`Notice cutoff ${cutoff}`}</p>
        <p aria-label="Notice verdict">{verdict}</p>
        <label>
          Boarding date
          <input
            aria-label="Boarding date"
            value={amendDate}
            onChange={(event) => setAmendDate(event.target.value)}
          />
        </label>
        <label>
          Boarding time
          <input
            aria-label="Boarding time"
            value={amendTime}
            onChange={(event) => setAmendTime(event.target.value)}
          />
        </label>
        <label>
          Draught in metres
          <input
            type="number"
            step="0.001"
            aria-label="Draught in metres"
            value={amendDraught}
            onChange={(event) => setAmendDraught(event.target.value)}
          />
        </label>
        <div className="keel-controls">
          <button type="button" className="primary" onClick={saveAmendment}>
            Save amendment
          </button>
          <button type="button" onClick={() => setDialog('none')}>
            Close amendment
          </button>
        </div>
      </Panel>

      <Panel open={dialog === 'cancel'} label="Cancel move" kind="dialog" onClose={() => setDialog('none')}>
        <h3>{`Cancel ${move.ref}`}</h3>
        <p aria-label="Notice cutoff" className="mono">{`Notice cutoff ${cutoff}`}</p>
        <p aria-label="Notice verdict">{verdict}</p>
        <div className="keel-controls">
          <button type="button" className="primary" onClick={confirmCancellation}>
            Confirm cancellation
          </button>
          <button type="button" onClick={() => setDialog('none')}>
            Keep move
          </button>
        </div>
      </Panel>

      <Panel
        open={dialog === 'reorder'}
        label="Corrected re-order"
        kind="dialog"
        onClose={() => setDialog('none')}
      >
        <h3>{`Corrected re-order for ${move.ref}`}</h3>
        <label>
          Correction
          <textarea
            aria-label="Correction"
            value={correction}
            rows={3}
            onChange={(event) => setCorrection(event.target.value)}
          />
        </label>
        <label>
          Boarding date
          <input
            aria-label="Boarding date"
            value={reorderDate}
            onChange={(event) => setReorderDate(event.target.value)}
          />
        </label>
        <label>
          Boarding time
          <input
            aria-label="Boarding time"
            value={reorderTime}
            onChange={(event) => setReorderTime(event.target.value)}
          />
        </label>
        <div className="keel-controls">
          <button type="button" className="primary" onClick={placeReorder}>
            Place re-order
          </button>
          <button type="button" onClick={() => setDialog('none')}>
            Close re-order
          </button>
        </div>
      </Panel>
      <p>
        <button type="button" onClick={() => navigation.navigate('/')}>
          Back to my screen
        </button>
      </p>
    </section>
  );
}
