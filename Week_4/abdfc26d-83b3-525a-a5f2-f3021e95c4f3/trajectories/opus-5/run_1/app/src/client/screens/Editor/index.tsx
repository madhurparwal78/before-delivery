import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AspectRatio,
  CreditsResponse,
  ExportFormat,
  Piece,
  PieceTimeline,
  Render,
  Resolution,
} from '../../../shared/api.js';
import { renderStatus, studioStatus } from '../../../shared/copy.js';
import { api, ApiFailure, createKeyHolder, uploadAsset } from '../../lib/api.js';
import { useInterval, useLoader, useReducedMotion } from '../../lib/hooks.js';
import { useAnnouncer } from '../../lib/useAnnouncer.js';
import { useRouter } from '../../lib/router.js';
import { LiveCanvas } from '../../components/LiveCanvas.js';
import type { AssistantState } from '../../components/PixelPanel.js';
import { StatusRegion } from '../../components/StatusRegion.js';
import type { CompileReport } from '../../lib/shaderCanvas.js';
import { PublishDialog } from './PublishDialog.js';
import { RenderFooter } from './RenderFooter.js';
import { Timeline } from './Timeline.js';

/** Credit cost: duration x 1 at 720p, or x 2 at 1080p. */
function costOf(durationSeconds: number, resolution: Resolution): number {
  return durationSeconds * (resolution === '1080p' ? 2 : 1);
}

function unsettled(render: Render | null): boolean {
  return render !== null && ['accepted', 'queued', 'rendering', 'stored'].includes(render.state);
}

export function Editor({ slug }: { slug: string }): JSX.Element {
  const { navigate } = useRouter();
  const reducedMotion = useReducedMotion();

  const loaded = useLoader(() => api.get<Piece>(`/api/pieces/${slug}`), [slug]);
  const credits = useLoader(() => api.get<CreditsResponse>('/api/me/credits'), [slug]);

  const [piece, setPiece] = useState<Piece | null>(null);
  const [uniformValues, setUniformValues] = useState<Record<string, number>>({});
  const [timeline, setTimeline] = useState<PieceTimeline | null>(null);
  const [title, setTitle] = useState('');
  const [dirty, setDirty] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [selectedUniform, setSelectedUniform] = useState('');

  const [studioMessage, setStudioMessage] = useState<string | null>(null);
  const renderAnnouncer = useAnnouncer();
  const [validatorLog, setValidatorLog] = useState('Compiling shader...');

  const [render, setRender] = useState<Render | null>(null);
  const [renders, setRenders] = useState<Render[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);
  const publishButtonRef = useRef<HTMLButtonElement | null>(null);

  const [format, setFormat] = useState<ExportFormat>('mp4');
  const [resolution, setResolution] = useState<Resolution>('720p');
  const [aspect, setAspect] = useState<AspectRatio>('16:9');
  const [durationSeconds, setDurationSeconds] = useState(10);

  const renderKey = useRef(createKeyHolder());
  const announcedStates = useRef(new Set<string>());

  useEffect(() => {
    const data = loaded.data;
    if (!data) return;
    setPiece(data);
    setTitle(data.title);
    setTimeline(data.timeline);
    setUniformValues(Object.fromEntries(data.uniforms.map((uniform) => [uniform.name, uniform.value])));
    setSelectedUniform((current) => current || (data.uniforms[0]?.name ?? ''));
    setDirty(false);
  }, [loaded.data]);

  const loadRenders = useCallback(async () => {
    try {
      const response = await api.get<{ renders: Render[] }>(`/api/pieces/${slug}/renders`);
      setRenders(response.renders);
      setRender(response.renders[0] ?? null);
    } catch {
      // The editor keeps its last known renders.
    }
  }, [slug]);

  useEffect(() => {
    void loadRenders();
  }, [loadRenders]);

  /**
   * While a render is unsettled the editor re-reads it every 2 seconds and
   * announces each state in its history it has not yet announced, in order.
   */
  useInterval(
    () => {
      if (!render) return;
      void api
        .get<Render>(`/api/renders/${render.id}`)
        .then((fresh) => {
          setRender(fresh);
          setRenders((current) => current.map((entry) => (entry.id === fresh.id ? fresh : entry)));
          announceHistory(fresh);
          if (!unsettled(fresh)) credits.refresh();
        })
        .catch(() => undefined);
    },
    unsettled(render) ? 2000 : null,
  );

  const announceHistory = useCallback((fresh: Render): void => {
    const messages: string[] = [];
    for (const entry of fresh.history) {
      const marker = `${fresh.id}:${entry.state}:${entry.at}`;
      if (announcedStates.current.has(marker)) continue;
      announcedStates.current.add(marker);

      switch (entry.state) {
        case 'accepted':
        case 'stored':
          break;
        case 'queued':
          messages.push(renderStatus.queued(fresh.cost_credits));
          break;
        case 'rendering':
          messages.push(renderStatus.rendering(fresh.aspect, fresh.resolution));
          break;
        case 'ready':
          messages.push(renderStatus.ready(fresh.cost_credits));
          break;
        case 'failed':
          messages.push(renderStatus.failed);
          break;
        case 'timed_out':
          messages.push(renderStatus.timedOut);
          break;
        case 'credits_released':
          if (fresh.failure_reason === 'cancelled') {
            messages.push(renderStatus.cancelled);
          }
          messages.push(renderStatus.creditsReturned(fresh.cost_credits));
          break;
        default:
          break;
      }
    }
    renderAnnouncer.announce(...messages);
  }, [renderAnnouncer]);

  const uniforms = useMemo(
    () =>
      (piece?.uniforms ?? []).map((uniform) => ({
        ...uniform,
        value: uniformValues[uniform.name] ?? uniform.value,
      })),
    [piece?.uniforms, uniformValues],
  );

  const canvasUniforms = useMemo(
    () => uniforms.map((uniform) => ({ name: uniform.name, value: uniform.value })),
    [uniforms],
  );

  const onCompile = useCallback((report: CompileReport) => {
    setValidatorLog(report.log === '' ? 'Shader compiled. 0 errors.' : report.log);
  }, []);

  const save = (): void => {
    if (!piece || !timeline) return;
    void (async () => {
      try {
        const updated = await api.put<Piece>(`/api/pieces/${slug}`, {
          ifMatch: piece.version,
          body: { title, uniforms: uniformValues, timeline },
        });
        setPiece(updated);
        setTimeline(updated.timeline);
        setDirty(false);
        setStudioMessage(studioStatus.saved(updated.version));
      } catch (error) {
        if (error instanceof ApiFailure) {
          if (error.code === 'version_conflict') {
            setStudioMessage(studioStatus.saveConflict(Number(error.detail.current_version ?? 0)));
          } else {
            setStudioMessage(error.message);
          }
        }
      }
    })();
  };

  const startRender = (): void => {
    if (!piece) return;
    void (async () => {
      let status: number | null = null;
      try {
        const response = await api.post<{ render: Render }>(`/api/pieces/${slug}/renders`, {
          idempotencyKey: renderKey.current.next(),
          body: { format, resolution, duration_s: durationSeconds, aspect },
        });
        setRender(response.render);
        setRenders((current) => [response.render, ...current]);
        announceHistory(response.render);
        credits.refresh();
      } catch (error) {
        if (error instanceof ApiFailure) {
          status = error.status;
          if (error.code === 'insufficient_credits') {
            renderAnnouncer.replace(
              renderStatus.insufficientCredits(
                Number(error.detail.needed ?? 0),
                Number(error.detail.available ?? 0),
              ),
            );
          } else {
            renderAnnouncer.replace(error.message);
          }
        }
      } finally {
        renderKey.current.reuseAfterFailure(status);
      }
    })();
  };

  const cancelRender = (): void => {
    if (!render) return;
    void api
      .post<Render>(`/api/renders/${render.id}/cancel`)
      .then((fresh) => {
        setRender(fresh);
        announceHistory(fresh);
        credits.refresh();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) renderAnnouncer.replace(error.message);
      });
  };

  const upload = (kind: 'font' | 'model' | 'audio') => (): void => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept =
      kind === 'audio' ? '.wav,.mp3' : kind === 'font' ? '.woff2,.ttf' : '.glb';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void uploadAsset(slug, kind, file)
        .then(() => {
          setStudioMessage(studioStatus.assetUploaded(file.name));
          loaded.refresh();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) {
            setStudioMessage(
              error.status === 413 ? studioStatus.assetTooLarge : Object.values(error.fields)[0] ?? error.message,
            );
          }
        });
    };
    input.click();
  };

  const withdraw = (): void => {
    void api
      .post<Piece>(`/api/pieces/${slug}/withdraw`)
      .then((updated) => {
        setPiece(updated);
        setStudioMessage(studioStatus.withdrawn);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) setStudioMessage(error.message);
      });
  };

  if (loaded.error) {
    return (
      <div className="shell editor">
        <h1 className="display">This piece is not in your studio.</h1>
      </div>
    );
  }
  if (!piece || !timeline) return <div className="shell editor" />;

  const available = credits.data?.available ?? 0;
  const cost = costOf(durationSeconds, resolution);
  const readyRenders = renders.filter((entry) => entry.state === 'ready');

  /**
   * The editor panel shows `rendering` while the newest render is unsettled,
   * `error` when it ended in error, and `idle` otherwise.
   */
  const assistantState: AssistantState = unsettled(render)
    ? 'rendering'
    : render && render.failure_reason !== null && render.failure_reason !== 'cancelled'
      ? 'error'
      : 'idle';

  return (
    <div className="shell editor">
      <div className="editor__head">
        <label className="field editor__title-field" htmlFor="piece-title">
          <span className="field__label">Title</span>
          <input
            id="piece-title"
            type="text"
            value={title}
            disabled={piece.state !== 'draft'}
            onChange={(event) => {
              setTitle(event.target.value);
              setDirty(true);
            }}
          />
        </label>

        <div className="editor__head-actions">
          <button type="button" className="next-action" onClick={save} disabled={piece.state !== 'draft'}>
            Save
          </button>
          {piece.state === 'draft' ? (
            <button
              type="button"
              className="ghost-button"
              ref={publishButtonRef}
              onClick={() => setPublishOpen(true)}
            >
              Publish
            </button>
          ) : (
            piece.state === 'published' && (
              <button type="button" className="ghost-button" onClick={withdraw}>
                Withdraw
              </button>
            )
          )}
        </div>
      </div>

      <div className="editor__zones">
        <div className="editor__canvas-zone">
          <LiveCanvas
            className="editor__canvas"
            fragmentSource={piece.fragment_source ?? ''}
            uniforms={canvasUniforms}
            seed={0}
            stillAt={reducedMotion ? playhead : null}
            onCompile={onCompile}
          />
          <section className="validator" aria-label="Validator">
            <pre className="validator__log mono">{validatorLog}</pre>
          </section>
        </div>

        <div className="editor__instrument">
          <h2 className="editor__panel-title display">Instrument panel</h2>
          {uniforms.map((uniform) => (
            <label className="fader" key={uniform.name} htmlFor={`fader-${uniform.name}`}>
              <span className="fader__label">{uniform.label}</span>
              <input
                id={`fader-${uniform.name}`}
                type="range"
                aria-label={uniform.label}
                min={uniform.min}
                max={uniform.max}
                step={(uniform.max - uniform.min) / 100}
                value={uniform.value}
                disabled={piece.state !== 'draft'}
                onChange={(event) => {
                  setUniformValues((current) => ({
                    ...current,
                    [uniform.name]: Number(event.target.value),
                  }));
                  setDirty(true);
                }}
              />
              <span className="fader__value tabular">{uniform.value.toFixed(2)}</span>
            </label>
          ))}
        </div>

        <Timeline
          timeline={timeline}
          uniforms={uniforms}
          playhead={playhead}
          selectedUniform={selectedUniform}
          audioFilename={
            piece.assets?.find((asset) => asset.id === timeline.audio_asset_id)?.filename ?? null
          }
          onPlayheadChange={setPlayhead}
          onSelectUniform={setSelectedUniform}
          onTimelineChange={(next, announcement) => {
            setTimeline(next);
            setDirty(true);
            if (announcement) setStudioMessage(announcement);
          }}
          footer={
            <RenderFooter
              assistantState={assistantState}
              format={format}
              resolution={resolution}
              aspect={aspect}
              durationSeconds={durationSeconds}
              cost={cost}
              available={available}
              dirty={dirty}
              isDraft={piece.state === 'draft'}
              queued={render?.state === 'queued'}
              onFormat={setFormat}
              onResolution={setResolution}
              onAspect={setAspect}
              onDuration={setDurationSeconds}
              onRender={startRender}
              onCancel={cancelRender}
              onUploadAudio={upload('audio')}
              onUploadFont={upload('font')}
              onUploadModel={upload('model')}
            />
          }
        />
      </div>

      <div className="editor__status">
        <StatusRegion label="Studio status" message={studioMessage} />
        <StatusRegion label="Render status" message={renderAnnouncer.message} />
      </div>

      <PublishDialog
        open={publishOpen}
        slug={slug}
        readyRenders={readyRenders}
        returnFocusTo={publishButtonRef}
        onClose={() => setPublishOpen(false)}
        onPublished={(updated) => {
          setPiece(updated);
          setPublishOpen(false);
          setStudioMessage(studioStatus.published(updated.edition_count ?? 0));
          navigate(`/gallery`);
        }}
      />
    </div>
  );
}
