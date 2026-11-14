import { useLayoutEffect, useState } from 'preact/hooks';
import type { Layout } from '../../shared/types.js';
import { api, apiRaw, saveFile } from '../api.js';
import { useApp } from '../app-context.js';
import { AirfieldMap } from '../components/airfield-map.js';
import { ErrorCell, FormStatus } from '../components/forms.js';
import { Loading, NotFound } from '../components/shell.js';

interface AerodromeSummary {
  id: string;
  name: string;
  code: string;
  imported: boolean;
}

export function AerodromesPage() {
  const { navigate } = useApp();
  const [list, setList] = useState<AerodromeSummary[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [failure, setFailure] = useState('');

  useLayoutEffect(() => {
    api<AerodromeSummary[]>('GET', '/api/aerodromes')
      .then(setList)
      .catch(() => setMissing(true));
  }, []);

  if (missing) return <NotFound />;
  if (!list) return <Loading />;
  return (
    <div class="grid-page">
      <section class="cell">
        <h1>Aerodromes</h1>
        <ul aria-label="Aerodromes" class="link-list">
          {list.map((item) => (
            <li key={item.id}>
              <a href={`/aerodromes/${item.id}`}>{item.name}</a> <span class="muted">{item.code}</span>
            </li>
          ))}
        </ul>
      </section>
      <section class="cell">
        <h2>Import a layout</h2>
        <form
          aria-label="Import layout"
          class="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setLines([]);
            setFailure('');
            if (!file) {
              setFailure('Choose a layout file first.');
              return;
            }
            setStatus('Checking layout...');
            try {
              const response = await apiRaw('POST', '/api/aerodromes/import', await file.arrayBuffer());
              const body = (await response.json().catch(() => ({}))) as { id?: string; lines?: string[]; message?: string };
              if (response.ok && body.id) {
                navigate(`/aerodromes/${body.id}`);
                return;
              }
              setStatus('');
              if (body.lines) setLines(body.lines);
              else setFailure(body.message ?? 'The layout could not be imported.');
            } catch {
              setStatus('');
              setFailure('Runup Bay cannot be reached. Try again shortly.');
            }
          }}
        >
          <div class="field">
            <label for="layout-file">Layout file</label>
            <input id="layout-file" type="file" onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} />
          </div>
          <button type="submit" class="primary">
            Import layout
          </button>
          <FormStatus text={status} />
          <ul aria-label="Import errors" class={lines.length > 0 ? 'hatched-cell' : 'live-empty'}>
            {lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          <ErrorCell label="Import error" text={failure} />
        </form>
      </section>
    </div>
  );
}

export function AerodromePage({ id }: { id: string }) {
  const [aerodrome, setAerodrome] = useState<(AerodromeSummary & { layout: Layout }) | null>(null);
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState('');
  useLayoutEffect(() => {
    api<AerodromeSummary & { layout: Layout }>('GET', `/api/aerodromes/${encodeURIComponent(id)}`)
      .then(setAerodrome)
      .catch(() => setMissing(true));
  }, [id]);
  if (missing) return <NotFound />;
  if (!aerodrome) return <Loading />;
  return (
    <div class="grid-page">
      <section class="cell span-all">
        <h1>
          {aerodrome.name} <span class="muted">{aerodrome.code}</span>
        </h1>
        {aerodrome.imported ? (
          <p>
            <button
              type="button"
              onClick={async () => {
                setFailure('');
                try {
                  const response = await apiRaw('GET', `/api/aerodromes/${encodeURIComponent(id)}/original`);
                  if (!response.ok) {
                    const body = (await response.json().catch(() => ({}))) as { message?: string };
                    setFailure(body.message ?? 'The layout file could not be read.');
                    return;
                  }
                  saveFile(await response.blob(), 'original.json');
                } catch {
                  setFailure('Runup Bay cannot be reached. Try again shortly.');
                }
              }}
            >
              Download original
            </button>
          </p>
        ) : null}
        <ErrorCell label="Import error" text={failure} />
      </section>
      <div class="cell span-all">
        <AirfieldMap layout={aerodrome.layout} aircraft={[]} />
      </div>
    </div>
  );
}
