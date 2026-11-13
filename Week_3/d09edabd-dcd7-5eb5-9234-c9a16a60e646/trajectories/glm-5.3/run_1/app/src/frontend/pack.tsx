import { useEffect, useState } from 'react';
import type { PackPage } from '../shared/types.js';
import { COPY } from '../shared/copy.js';
import { fetchPack } from './api.js';
import type { Unit } from '../shared/units.js';

/** The fabricator's build-pack page at /pack/<token>?units=m|ft (DP-45, DP-47). */
export function PackPage(props: { token: string }): JSX.Element {
  const [pack, setPack] = useState<PackPage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [units, setUnits] = useState<Unit>(() => {
    const q = new URLSearchParams(window.location.search).get('units');
    return q === 'ft' ? 'ft' : 'm';
  });

  // units from the address; unknown or missing normalises to metres (rewritten in place)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('units');
    if (q !== 'm' && q !== 'ft') {
      const url = new URL(window.location.href);
      url.searchParams.set('units', 'm');
      window.history.replaceState(null, '', url);
      setUnits('m');
    }
  }, []);

  const switchUnits = (next: Unit): void => {
    setUnits(next);
    const url = new URL(window.location.href);
    url.searchParams.set('units', next);
    window.history.replaceState(null, '', url);
  };

  useEffect(() => {
    void (async (): Promise<void> => {
      const r = await fetchPack(props.token);
      if (r.status === 404) { setErr(COPY.linkInvalid); return; }
      if (r.status === 200) setPack(r.body as PackPage);
    })();
  }, [props.token]);

  if (err) {
    return (
      <div className="pack-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="sheet small"><h1 style={{ fontSize: 16 }}>{err}</h1></div>
      </div>
    );
  }
  if (!pack) {
    return <div className="pack-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p className="muted">Loading…</p></div>;
  }

  const L = (v: { m: string; ft: string }): string => (units === 'm' ? v.m : v.ft);
  const unitLabel = units === 'm' ? '(m)' : '(ft)';

  return (
    <div className="pack-page">
      <div className="pack-topbar">
        <span className="muted">{pack.version.state === 'frozen' ? 'Frozen' : 'Superseded'}</span>
        <button
          className="cluster-btn"
          aria-label="Units"
          aria-pressed={units === 'ft'}
          onClick={() => switchUnits(units === 'm' ? 'ft' : 'm')}
        >
          {units === 'm' ? 'm' : 'ft'}
        </button>
      </div>

      <div className="pack-column">
        <h1>Build pack — {pack.room.name} v{pack.version.number}</h1>
        <p className="meta muted">
          {pack.version.label} · frozen {new Date(pack.version.frozenAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
        </p>
        {pack.version.state === 'superseded' && pack.version.supersededBy !== null && (
          <p className="notice">{COPY.supersededBy(pack.version.supersededBy)}</p>
        )}

        <div className="pack-section" role="region" aria-label="Room table">
          <h2>Room</h2>
          <div className="table-region">
            <table aria-label="Room">
              <thead><tr><th>Width {unitLabel}</th><th>Depth {unitLabel}</th><th>Height {unitLabel}</th></tr></thead>
              <tbody>
                <tr>
                  <td className="tnum">{L(pack.room.width)}</td>
                  <td className="tnum">{L(pack.room.depth)}</td>
                  <td className="tnum">{L(pack.room.height)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="pack-section" role="region" aria-label="Placements table">
          <h2>Placements</h2>
          <div className="table-region">
            <table aria-label="Placements">
              <thead>
                <tr>
                  <th>Label</th><th>Kind</th>
                  <th>X {unitLabel}</th><th>Y {unitLabel}</th><th>Z {unitLabel}</th>
                  <th>Width {unitLabel}</th><th>Depth {unitLabel}</th><th>Height {unitLabel}</th>
                  <th>Rotation</th>
                </tr>
              </thead>
              <tbody>
                {pack.placements.map((p) => (
                  <tr key={p.id}>
                    <td>{p.label}</td>
                    <td>{p.kind}</td>
                    <td className="tnum">{L(p.x)}</td>
                    <td className="tnum">{L(p.y)}</td>
                    <td className="tnum">{L(p.z)}</td>
                    <td className="tnum">{L(p.width)}</td>
                    <td className="tnum">{L(p.depth)}</td>
                    <td className="tnum">{L(p.height)}</td>
                    <td className="tnum">{p.rotationDeg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="pack-section" role="region" aria-label="Trigger wiring table">
          <h2>Trigger wiring</h2>
          <div className="table-region">
            <table aria-label="Trigger wiring">
              <thead><tr><th>Title</th><th>Kind</th><th>Needs</th><th>Linked placement</th><th>Answer</th></tr></thead>
              <tbody>
                {pack.nodes.map((n) => (
                  <tr key={n.title}>
                    <td>{n.title}</td>
                    <td>{n.kind}</td>
                    <td>{n.needs.length ? n.needs.join(', ') : '—'}</td>
                    <td>{n.linkedPlacement ?? '—'}</td>
                    <td>{n.answer ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="pack-section" role="region" aria-label="Files table">
          <h2>Files</h2>
          <div className="table-region">
            <table aria-label="Files">
              <thead><tr><th>Prop name</th><th>Bytes</th><th>SHA-256</th><th>Download</th></tr></thead>
              <tbody>
                {pack.props.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="tnum">{p.bytes}</td>
                    <td className="mono" style={{ wordBreak: 'break-all' }}>{p.sha256}</td>
                    <td>
                      <a className="down-link" href={p.downloadPath} download>Download {p.name}</a>
                    </td>
                  </tr>
                ))}
                {!pack.props.length && (
                  <tr><td colSpan={4} className="muted">No prop files.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
