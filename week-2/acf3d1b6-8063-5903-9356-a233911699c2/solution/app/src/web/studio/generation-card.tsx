import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { RENDER_SECONDS, modelOf } from '../../shared/catalog.js';
import { api } from '../api.js';
import type { Generation } from '../data.js';
import { enter, play } from '../ui/motion.js';
import { useToast } from '../ui/toast.js';
import { useSession } from './layout.js';

/** Rendering takes about this long on the server (Ready 12 s after the start). */
const RENDER_MS = RENDER_SECONDS * 1000;
const POLL_MS = 2000;

const STATUS_WORDS: Record<Generation['status'], string> = {
  queued: 'Queued',
  rendering: 'Rendering',
  ready: 'Ready',
  cancelled: 'Cancelled',
};

const isOpen = (generation: Generation) => generation.status === 'queued' || generation.status === 'rendering';

function progressOf(generation: Generation): number {
  const elapsed = Date.now() - new Date(generation.created_at).getTime();
  return Math.min(0.95, Math.max(0, elapsed / RENDER_MS));
}

/** Keeps a list of generations current: every open one is read again until it is Ready or Cancelled. */
export function useGenerationUpdates(list: Generation[] | null, update: (generation: Generation) => void) {
  const openIds = (list ?? []).filter(isOpen).map((generation) => generation.id).join(',');
  const latest = useRef(update);
  latest.current = update;
  useEffect(() => {
    if (!openIds) return;
    const timer = setTimeout(async () => {
      for (const id of openIds.split(',')) {
        const reply = await api<Generation>('GET', `/generations/${id}`);
        if (reply.ok) latest.current(reply.data);
      }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [openIds, list]);
}

/** The not-yet-Ready preview: it breathes while a soft light sweeps across it. */
function Placeholder({ open }: { open: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const light = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const breathe = play(box.current, [{ opacity: 1 }, { opacity: 0.6 }, { opacity: 1 }], {
      duration: 1600,
      easing: 'ease-in-out',
      iterations: Infinity,
    });
    const sweep = play(light.current, [{ transform: 'translateX(-100%)' }, { transform: 'translateX(100%)' }], {
      duration: 1800,
      iterations: Infinity,
    });
    return () => {
      breathe?.cancel();
      sweep?.cancel();
    };
  }, [open]);
  return (
    <div ref={box} class="placeholder">
      {open && <span ref={light} class="sweep" />}
    </div>
  );
}

function ProgressBar({ generation }: { generation: Generation }) {
  const fill = useRef<HTMLSpanElement>(null);
  const progress = progressOf(generation);
  useLayoutEffect(() => {
    const from = progressOf(generation);
    const animation = play(fill.current, [{ transform: `scaleX(${from})` }, { transform: 'scaleX(1)' }], {
      duration: Math.max(1000, RENDER_MS * (1 - from)),
      easing: 'linear',
      fill: 'forwards',
    });
    return () => animation?.cancel();
  }, [generation.id]);
  return (
    <div
      class="gen-bar"
      role="progressbar"
      aria-label="Rendering progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
    >
      <span ref={fill} class="gen-bar-fill" style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}

export function GenerationCard({
  generation,
  onChange,
  landing = false,
  large = false,
}: {
  generation: Generation;
  onChange: (generation: Generation) => void;
  landing?: boolean;
  large?: boolean;
}) {
  const toast = useToast();
  const { refresh } = useSession();
  const [cancelling, setCancelling] = useState(false);
  const [refusal, setRefusal] = useState('');
  const model = modelOf(generation.model)!;
  const open = isOpen(generation);
  const card = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!landing) return;
    // The one springy confirm: the new card overshoots a touch as it lands.
    play(card.current, [{ opacity: 0, transform: 'translateY(12px) scale(0.96)' }, { opacity: 1, transform: 'none' }], {
      duration: 400,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    });
  }, [landing]);

  const cancel = async () => {
    setCancelling(true);
    const reply = await api<Generation>('POST', `/generations/${generation.id}/cancel`);
    setCancelling(false);
    if (reply.ok) {
      onChange(reply.data);
      toast(`Cancelled. ${generation.cost} credits returned.`);
      void refresh();
    } else {
      setRefusal('This generation can no longer be cancelled.');
      const latest = await api<Generation>('GET', `/generations/${generation.id}`);
      if (latest.ok) onChange(latest.data);
    }
  };

  return (
    <article ref={card} class={`card gen-card${large ? ' is-large' : ''}`}>
      <div class={`gen-preview aspect-${generation.aspect.replace(':', 'x')}`}>
        {generation.status === 'ready' ? (
          <>
            {generation.aspect !== '16:9' && (
              <img class="gen-backdrop" src={`/api/generations/${generation.id}/output`} alt="" aria-hidden="true" />
            )}
            <img
              class="gen-picture"
              src={`/api/generations/${generation.id}/output`}
              alt={generation.prompt}
              onLoad={(event) => enter(event.currentTarget, 300)}
            />
          </>
        ) : (
          <Placeholder open={open} />
        )}
      </div>
      {open && <ProgressBar generation={generation} />}
      <div class="gen-body">
        <p class={`gen-status status-${generation.status}`}>
          <span class="status-dot" aria-hidden="true" />
          <span aria-live="polite">{STATUS_WORDS[generation.status]}</span>
        </p>
        <p class="gen-prompt">{generation.prompt}</p>
        <ul class="gen-meta">
          <li>{model.name}</li>
          <li>{generation.duration ? `${generation.duration} s` : `${generation.image_count} ${generation.image_count === 1 ? 'image' : 'images'}`}</li>
          <li>{generation.aspect}</li>
          <li class="figure">{generation.cost} credits</li>
          <li>{generation.started_by}</li>
        </ul>
      </div>
      {(!large || open) && (
        <div class="gen-actions">
          {!large && (
            <a class="text-link" href={`/studio/generations/${generation.id}`}>
              Details
            </a>
          )}
          {open && (
            <button type="button" class="button button-light button-small" onClick={cancel} disabled={cancelling}>
              Cancel
            </button>
          )}
        </div>
      )}
      {refusal && (
        <p class="field-error gen-refusal" role="alert">
          {refusal}
        </p>
      )}
    </article>
  );
}
