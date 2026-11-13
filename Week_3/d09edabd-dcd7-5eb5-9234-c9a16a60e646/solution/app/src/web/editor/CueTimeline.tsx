import { mmss } from '../../shared/format';
import { useEditor } from './state';

/** The Cue timeline strip: the latest session's solve log, else the room's locks and cues in chain order. */
export default function CueTimeline() {
  const latest = useEditor((s) => s.latestSession);
  const session = useEditor((s) => s.session);
  const nodes = useEditor((s) => s.nodes);
  const showLog = (session ?? latest)?.state === 'running' || (session ?? latest)?.state === 'ended';
  const log = [...((session ?? latest)?.solves ?? [])].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
  const cues = nodes.filter((n) => n.kind === 'lock' || n.kind === 'cue');
  return (
    <section className="cue-timeline" role="region" aria-label="Cue timeline">
      <h2>Cue timeline</h2>
      {showLog ? (
        <ol>
          {log.map((solve) => (
            <li key={solve.nodeId}>
              {mmss(solve.elapsedSeconds)} {solve.title}
            </li>
          ))}
        </ol>
      ) : (
        <ol>
          {cues.map((node) => (
            <li key={node.id}>{node.title}</li>
          ))}
        </ol>
      )}
      {(showLog ? log.length : cues.length) === 0 ? <p className="none">Nothing to show yet.</p> : null}
    </section>
  );
}
