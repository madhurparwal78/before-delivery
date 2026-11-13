import { X } from '../ui/icons';
import { figureStrings, mss, outcomeLine } from '../../shared/format';
import { wholeSeconds } from '../../shared/playtest';
import { Dialog } from '../ui/Dialog';
import { closeDebrief } from './play';
import { useEditor } from './state';

const EMAIL_WORD = { sent: 'Sent', queued: 'Queued', failed: 'Failed' } as const;

/** The Debrief dialog: the playtest-ended heading, the outcome, the chain figures and the per-puzzle times. */
export default function DebriefDialog() {
  const open = useEditor((s) => s.dialogs.debrief === true);
  const debrief = useEditor((s) => s.debrief);
  const session = debrief?.session;
  const detail = debrief?.detail ?? null;
  const elapsed = detail?.elapsedSeconds ?? (session?.startedAt && session.endedAt ? wholeSeconds(session.startedAt, session.endedAt) : 0);
  const outcome = detail?.outcome ?? session?.outcome ?? 'stopped';
  const stats = detail?.stats ?? session?.stats;
  return (
    <Dialog name="Debrief" open={open} onClose={closeDebrief} className="centered" returnFocus={() => document.querySelector<HTMLElement>('[data-play]')}>
      <div className="dialog-head">
        <h2>Playtest ended</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={closeDebrief}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="dialog-body">
        <p className="outcome">{outcomeLine(outcome, elapsed)}</p>
        {stats ? (
          <ul className="debrief-figures">
            {figureStrings(stats).map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        ) : null}
        <table aria-label="Puzzle times" className="puzzle-times">
          <thead>
            <tr>
              <th scope="col">Puzzle</th>
              <th scope="col">Solved at</th>
              <th scope="col">Waited</th>
            </tr>
          </thead>
          <tbody>
            {(detail?.puzzles ?? []).map((p) => (
              <tr key={p.title}>
                <td>{p.title}</td>
                <td className="tabular">{p.solvedAtSeconds === null ? 'not solved' : mss(p.solvedAtSeconds)}</td>
                <td className="tabular">{p.waitSeconds === null ? '—' : mss(p.waitSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>Hints used: {detail?.hintsUsed ?? session?.hintsUsed ?? 0}</p>
        <p>{detail?.chokePoint ? `Choke point: ${detail.chokePoint.title} (${mss(detail.chokePoint.waitSeconds)} waiting)` : 'Choke point: none'}</p>
        {detail ? <p>Debrief email: {EMAIL_WORD[detail.emailStatus]}</p> : null}
      </div>
    </Dialog>
  );
}
