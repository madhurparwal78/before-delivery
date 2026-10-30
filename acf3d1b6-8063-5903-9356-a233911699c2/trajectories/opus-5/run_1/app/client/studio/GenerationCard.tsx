import { useState } from 'preact/hooks';
import { api, ApiError } from '../api';
import { useToast } from '../components/ui';
import { creditWords, STATUS_WORDS } from '../format';
import { modelById } from '../../shared/catalog';
import { Generation, isActive } from './data';

const RATIOS: Record<string, string> = { '16:9': '16 / 9', '9:16': '9 / 16', '1:1': '1 / 1' };

export function GenerationCard({
  generation,
  landed,
  onChanged
}: {
  generation: Generation;
  landed?: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);
  const model = modelById(generation.model);
  const measure = generation.duration ? `${generation.duration} s` : `${generation.image_count} images`;

  const cancel = async () => {
    setCancelling(true);
    try {
      await api(`/api/generations/${generation.id}/cancel`, { method: 'POST' });
      toast(`Cancelled. ${generation.cost} credits returned.`);
      onChanged();
    } catch (error) {
      if (error instanceof ApiError) toast('That generation can no longer be cancelled.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <article class={`gen-card${landed ? ' landed' : ''}`}>
      <div class="gen-media" style={`aspect-ratio:${RATIOS[generation.aspect]}`}>
        {generation.status === 'ready' ? (
          <img src={`/api/generations/${generation.id}/output`} alt={generation.prompt} />
        ) : (
          <div class={`gen-placeholder${isActive(generation) ? '' : ' still'}`} />
        )}
      </div>
      {isActive(generation) ? (
        <div class="gen-progress">
          <span />
        </div>
      ) : null}

      <div class="gen-body">
        <span class={`status status-${generation.status}`} aria-live="polite">
          <span class="status-dot" aria-hidden="true" />
          {STATUS_WORDS[generation.status]}
        </span>
        <p style="margin:0;color:var(--ink)">{generation.prompt}</p>
        <div class="gen-meta">
          <span>{model?.name ?? generation.model}</span>
          <span>{measure}</span>
          <span>{generation.aspect}</span>
          <span class="mono">{creditWords(generation.cost)}</span>
          <span>{generation.started_by}</span>
        </div>
        {isActive(generation) ? (
          <div>
            <button type="button" class="btn btn-light" onClick={cancel} disabled={cancelling}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
