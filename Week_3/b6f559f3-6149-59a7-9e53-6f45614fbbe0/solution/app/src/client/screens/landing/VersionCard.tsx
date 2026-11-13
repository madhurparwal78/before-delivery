import { SceneCanvas } from '../../stage/SceneCanvas';
import { numeralScene } from './demoScenes';
import { Reveal } from './Reveal';

const NUMERAL = numeralScene(7);
const VERSIONS = [
  { number: 7, state: 'Live' },
  { number: 6, state: 'Superseded' },
  { number: 5, state: 'Superseded' },
];

export function VersionCard() {
  const embed = `<iframe src="${window.location.origin}/embed/your-project-id" title="Hero scene" width="100%" height="640" style="border:0"></iframe>`;
  return (
    <Reveal className="demo-panel version-card" id="version-export" aria-label="Every publish gets a number">
      <div className="section-head">
        <h2>Every publish gets a number</h2>
        <p className="muted">Versions never change. A half-finished edit stays out of the site, and any version can be shipped again as the next one.</p>
      </div>
      <div className="version-body panel">
        <figure className="numeral-frame">
          <SceneCanvas document={NUMERAL} breakpoint="desktop" frame={0} aria-label="Version 7" className="numeral-canvas" />
        </figure>
        <div className="version-side">
          <ul className="version-list">
            {VERSIONS.map((version) => (
              <li key={version.number}>
                <span className="num">Version {version.number}</span>
                <span className={version.state === 'Live' ? 'live-state' : 'muted'}>{version.state}</span>
              </li>
            ))}
          </ul>
          <pre className="embed-sample">
            <code>{embed}</code>
          </pre>
        </div>
      </div>
    </Reveal>
  );
}
