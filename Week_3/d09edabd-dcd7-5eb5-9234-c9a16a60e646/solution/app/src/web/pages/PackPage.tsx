import '../styles/pages.css';
import { utcStamp } from '../../shared/format';
import type { Pack } from '../../shared/types';
import type { Units } from '../../shared/units';
import NotFound from './NotFound';
import { PackTables } from './pack/PackTables';
import { usePack } from './pack/usePack';
import { usePackUnits } from './pack/usePackUnits';

const STATE_WORDS: Record<Pack['version']['state'], string> = { frozen: 'Frozen', superseded: 'Superseded' };

interface BarProps {
  state?: Pack['version']['state'];
  units: Units;
  onUnits: () => void;
}

function PackBar({ state, units, onUnits }: BarProps) {
  return (
    <header className="pack-bar">
      <div className="pack-bar-inner">
        {state ? (
          <span className="state-word" data-state={state}>
            {STATE_WORDS[state]}
          </span>
        ) : null}
        <button className="btn units-button" type="button" aria-pressed={units === 'ft'} onClick={onUnits}>
          <span aria-hidden="true">{units}</span>
          <span className="visually-hidden">Units</span>
        </button>
      </div>
    </header>
  );
}

function PackDocument({ pack, units }: { pack: Pack; units: Units }) {
  const { version, room } = pack;
  return (
    <>
      <h1>
        Build pack — {room.name} v{version.number}
      </h1>
      <dl className="pack-meta">
        <div>
          <dt>Version label</dt>
          <dd>{version.label}</dd>
        </div>
        <div>
          <dt>Frozen at</dt>
          <dd>
            <time dateTime={version.frozenAt}>{utcStamp(version.frozenAt)} UTC</time>
          </dd>
        </div>
      </dl>
      {version.supersededBy !== null ? <p className="pack-notice">This version has been superseded by version {version.supersededBy}.</p> : null}
      <PackTables pack={pack} units={units} />
    </>
  );
}

export default function PackPage({ token }: { token: string }) {
  const { units, toggle } = usePackUnits();
  const load = usePack(token);
  if (load.state === 'missing') return <NotFound />;
  return (
    <div className="pack-page">
      <PackBar state={load.state === 'ready' ? load.pack.version.state : undefined} units={units} onUnits={toggle} />
      <main className="pack-column" aria-busy={load.state === 'loading'}>
        {load.state === 'ready' ? <PackDocument pack={load.pack} units={units} /> : null}
        {load.state === 'loading' ? (
          <>
            <div className="skeleton tall" aria-hidden="true" />
            <div className="skeleton" aria-hidden="true" />
          </>
        ) : null}
        {load.state === 'failed' ? <p className="pack-notice">This build pack could not be loaded.</p> : null}
      </main>
    </div>
  );
}
