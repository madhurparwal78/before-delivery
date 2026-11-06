import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { SVGRenderer } from 'three/examples/jsm/renderers/SVGRenderer.js';
import { storyOffsetsAtStageEnd } from '../../shared/parts.js';
import { COLOURS } from './build.js';
import { SceneModel, type SceneSnapshot } from './model.js';
import { Overlay } from './SceneView.js';

export const STORY_CAPTIONS = ['Body panels off', 'Footboard out', 'Petrol out', 'Hub on its axle line', 'Pack on its rail', 'Controller and harness'] as const;
const STILL_ASPECT = { narrow: 1.05, wide: 0.72 };
const NARROW_STILL_PX = 520;

/** Reduced motion: the six story stages as stacked stills in normal flow, each drawn from the same parts table. */
export function StillStack(): ReactNode {
  return (
    <div className="story-stills">
      {STORY_CAPTIONS.map((caption, index) => {
        const stage = index + 1;
        return (
          <figure
            key={stage}
            className="story-still"
            data-story-stage={stage}
            data-story-offsets={JSON.stringify(storyOffsetsAtStageEnd(stage))}
          >
            <StillDrawing stage={stage} label={`Moped drawing, stage ${stage}: ${caption}`} />
            <figcaption className="story-caption"><span className="num">{stage}</span> {caption}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function StillDrawing({ stage, label }: { stage: number; label: string }): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<SceneSnapshot | null>(null);
  useEffect(() => {
    const node = host.current;
    if (!node) return undefined;
    const model = new SceneModel({ reducedMotion: true, units: 'metric' });
    const drawing = node.firstElementChild;
    const renderer = new SVGRenderer();
    renderer.setClearColor(new THREE.Color(COLOURS.ground), 1);
    const svg = renderer.domElement;
    svg.setAttribute('class', 'story-still-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    drawing?.replaceChildren(svg);
    const draw = (): void => {
      const { width } = node.getBoundingClientRect();
      const height = Math.round(width * (width < NARROW_STILL_PX ? STILL_ASPECT.narrow : STILL_ASPECT.wide));
      model.setMode('story');
      model.setSize(width, height);
      model.setStoryProgress(stage / 6);
      renderer.setSize(width, height);
      model.orderForStill();
      renderer.render(model.moped.scene, model.camera);
      setSnap(model.getSnapshot());
    };
    const observer = new ResizeObserver(draw);
    observer.observe(node);
    return () => {
      observer.disconnect();
      drawing?.replaceChildren();
    };
  }, [stage, label]);
  return (
    <div ref={host} className="story-still-host">
      <div />
      {snap ? <Overlay snap={snap} /> : null}
    </div>
  );
}
