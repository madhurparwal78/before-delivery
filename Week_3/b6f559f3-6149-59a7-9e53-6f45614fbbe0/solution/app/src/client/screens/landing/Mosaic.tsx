import { SceneCanvas } from '../../stage/SceneCanvas';
import { MOSAIC_SCENES } from './demoScenes';
import { Reveal } from './Reveal';

export function ThumbnailMosaic() {
  return (
    <Reveal className="demo-panel" aria-label="Project thumbnails">
      <div className="section-head">
        <h2>
          Covers that run the <span className="serif-word">real</span> scene
        </h2>
        <p className="muted">Each project card plays its latest published version.</p>
      </div>
      <div className="mosaic-demo">
        {MOSAIC_SCENES.map((entry) => (
          <figure key={entry.name} className="cover-frame">
            <SceneCanvas document={entry.document} playOnce aria-label={`${entry.name} cover`} className="cover-canvas" />
            <figcaption className="muted">{entry.name}</figcaption>
          </figure>
        ))}
      </div>
    </Reveal>
  );
}
