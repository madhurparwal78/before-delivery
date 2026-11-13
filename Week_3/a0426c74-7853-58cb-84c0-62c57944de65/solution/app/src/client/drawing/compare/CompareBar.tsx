import { NO_COMPARE, NO_HISTORY, compareCounts } from '../../../shared/copy.ts';
import { Button, Chip } from '../../ui/index.ts';
import { Switch } from '../controls/Switch.tsx';
import { SwipeSlider } from './SwipeSlider.tsx';
import type { Compare } from './useCompare.ts';

/** Delta swipe controls: the two versions, the slider, the overlay switch, the counts and the entity history. */
export function CompareBar({ compare }: { compare: Compare }) {
  const { versions, earlier, later, result } = compare;
  if (versions.length < 2) {
    return (
      <Chip>
        <span className="chip-text">{NO_COMPARE}</span>
        <Button onClick={() => compare.setOpen(false)}>Done</Button>
      </Chip>
    );
  }
  return (
    <Chip className="compare">
      <label className="compare__field">
        <span className="label">Earlier version</span>
        <select className="field" value={earlier?.id ?? ''} onChange={(event) => compare.setEarlier(event.target.value)}>
          {versions.map((version) => <option key={version.id} value={version.id}>{`v${version.number}`}</option>)}
        </select>
      </label>
      <label className="compare__field">
        <span className="label">Later version</span>
        <select className="field" value={later?.id ?? ''} onChange={(event) => compare.setLater(event.target.value)}>
          {versions.map((version) => <option key={version.id} value={version.id}>{`v${version.number}`}</option>)}
        </select>
      </label>
      <SwipeSlider value={compare.swipe} onChange={compare.setSwipe} />
      <Switch checked={compare.overlay} onChange={compare.setOverlay}>Overlay</Switch>
      <span className="compare__counts" role="status" aria-label="Compare counts">
        {result ? compareCounts(result.added, result.removed, result.changed) : ''}
      </span>
      <Button onClick={() => compare.setOpen(false)}>Done</Button>
      <section className="history" aria-label="Entity history">
        {compare.history.length === 0 ? <span className="muted">{NO_HISTORY}</span> : compare.history.map((line) => <span key={line} className="history__line">{line}</span>)}
      </section>
    </Chip>
  );
}
