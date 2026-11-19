import type { JSX } from 'preact';
import { notify } from '../ui';
import type { Model } from './model';
import { paintPixels } from './paint';
import { PreviewPanel as Preview } from './Preview';

/** The workspace's preview: frames drawn from the model's composites. */
export function PreviewPanel({ m }: { m: Model }): JSX.Element {
  return (
    <Preview
      frameCount={m.frames.length}
      durations={m.frames.map((f) => f.duration_ms)}
      tags={m.tags}
      size={{ width: m.width, height: m.height }}
      version={m.seq + m.pending.length}
      drawFrame={(canvas, frame) => {
        const id = m.frames[frame - 1]?.id;
        if (id !== undefined) paintPixels(canvas, m.frameRgba(id, 'final'), m.width, m.height, 1);
      }}
      finished={(passes) => notify(`Finished after ${m.plural(passes, 'pass', 'passes')}`)}
    />
  );
}
