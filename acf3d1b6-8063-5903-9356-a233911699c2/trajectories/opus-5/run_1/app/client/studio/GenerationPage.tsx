import { useEffect, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { StudioLayout } from './StudioLayout';
import { GenerationCard } from './GenerationCard';
import { Generation, useRendering } from './data';
import { api } from '../api';
import { useAuth } from '../store';
import { creditWords, signedCredits, stampUtc } from '../format';
import { modelById } from '../../shared/catalog';

export function GenerationPage() {
  const { params } = useRoute();
  const auth = useAuth();
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [missing, setMissing] = useState(false);

  const reload = async () => {
    try {
      setGeneration(await api<Generation>(`/api/generations/${params.id}`));
    } catch {
      setMissing(true);
    }
  };

  useEffect(() => {
    if (auth.state === 'signed-in') void reload();
  }, [auth.state, params.id]);

  useRendering(generation ? [generation] : [], () => void reload());

  if (missing) {
    return (
      <StudioLayout current="projects">
        <h1 style="font-size:clamp(1.8rem,3vw,2.3rem)">That generation does not exist.</h1>
        <a class="btn btn-light" href="/studio/projects">
          Back to projects
        </a>
      </StudioLayout>
    );
  }

  if (!generation) {
    return (
      <StudioLayout current="projects">
        <p class="muted">Loading the generation…</p>
      </StudioLayout>
    );
  }

  const model = modelById(generation.model);

  return (
    <StudioLayout current="projects">
      <h1 style="font-size:clamp(1.6rem,2.6vw,2.1rem)">Generation</h1>
      <div style="max-width:720px">
        <GenerationCard generation={generation} onChanged={() => {
          void auth.refresh();
          void reload();
        }} />
      </div>

      <div class="panel-soft" style="margin-top:20px;max-width:720px">
        <h2 style="font-size:1.1rem">Details</h2>
        <table class="table">
          <tbody>
            <tr>
              <th scope="row">Model</th>
              <td>{model?.name ?? generation.model}</td>
            </tr>
            <tr>
              <th scope="row">{generation.duration ? 'Length' : 'Images'}</th>
              <td>{generation.duration ? `${generation.duration} s` : `${generation.image_count} images`}</td>
            </tr>
            <tr>
              <th scope="row">Aspect</th>
              <td>{generation.aspect}</td>
            </tr>
            <tr>
              <th scope="row">Started by</th>
              <td>{generation.started_by}</td>
            </tr>
            <tr>
              <th scope="row">Started</th>
              <td>{stampUtc(generation.created_at)}</td>
            </tr>
            <tr>
              <th scope="row">Finished</th>
              <td>{generation.finished_at ? stampUtc(generation.finished_at) : 'Still rendering'}</td>
            </tr>
            <tr>
              <th scope="row">Cost</th>
              <td class="mono">{creditWords(generation.cost)}</td>
            </tr>
            <tr>
              <th scope="row">Charge</th>
              <td class="mono">{signedCredits(generation.charge ?? -generation.cost)}</td>
            </tr>
            {generation.refund ? (
              <tr>
                <th scope="row">Refund</th>
                <td class="mono">{signedCredits(generation.refund)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </StudioLayout>
  );
}
