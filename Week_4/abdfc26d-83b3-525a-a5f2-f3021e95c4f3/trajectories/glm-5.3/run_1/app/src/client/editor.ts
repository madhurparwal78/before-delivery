import { api, freshIdempotencyKey, type PieceJson } from './api.js';
import { startPieceCanvas } from './canvas.js';
import { PixelPanel, announce, focusTrap, observeEntrances, prefersReducedMotion, watchHeaderScroll } from './motion.js';
import { headerRoleLinks, loadMe } from './header.js';

interface RenderJson {
  id: string;
  piece_slug: string;
  state: 'accepted' | 'queued' | 'rendering' | 'stored' | 'ready' | 'failed' | 'timed_out' | 'credits_released';
  failure_reason: string | null;
  cost_credits: number;
  attempts: number;
  format: 'mp4' | 'webm';
  resolution: '720p' | '1080p';
  duration_s: number;
  aspect: '16:9' | '9:16' | '1:1' | '4:5';
  sha256: string | null;
  history: { state: string; at: string }[];
  created_at: string;
}

const EASING_LABELS: Record<string, string> = { 'linear': 'Linear', 'ease-in': 'Ease in', 'ease-out': 'Ease out', 'ease-in-out': 'Ease in-out' };

async function main(): Promise<void> {
  watchHeaderScroll(document.querySelector('header.studio-header'));
  const me = await loadMe();
  headerRoleLinks(me);
  if (!me) {
    window.location.href = `/auth/login?return_to=${encodeURIComponent(window.location.pathname)}`;
    return;
  }

  const slug = window.location.pathname.split('/').pop() ?? '';
  const result = await api<PieceJson>('GET', `/api/pieces/${slug}`);
  if (!result.ok) return;
  const piece = result.body as PieceJson;
  const isDraft = piece.state === 'draft';

  const statusRegion = document.querySelector<HTMLElement>('[data-studio-status]');
  const renderRegion = document.querySelector<HTMLElement>('[data-render-status]');
  const canvasHost = document.querySelector<HTMLElement>('[data-editor-canvas]');
  const handle = canvasHost ? startPieceCanvas(canvasHost, piece, {}) : null;

  const titleEl = document.querySelector<HTMLElement>('[data-piece-title]');
  if (titleEl) titleEl.textContent = piece.title;
  const remixEl = document.querySelector<HTMLElement>('[data-remix-credit]');
  if (remixEl && piece.remix_of) remixEl.textContent = `Remix of ${piece.remix_of.title} by ${piece.remix_of.creator_display_name}`;

  // Validator console: compile the shader in the browser and print the log.
  const validator = document.querySelector<HTMLElement>('[data-validator]');
  if (validator && piece.fragment_source) {
    const compile = document.createElement('canvas');
    const gl = compile.getContext('webgl');
    if (!gl) {
      validator.textContent = `WebGL unavailable. The canvas shows a still frame.`;
    } else {
      const shader = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(shader, piece.fragment_source);
      gl.compileShader(shader);
      const log = gl.getShaderInfoLog(shader);
      validator.textContent = gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? `Shader compiled.` : `Shader log:\n${log ?? 'unknown error'}`;
    }
  }

  // ---------------------------------------------------------------- faders
  const fadersHost = document.querySelector<HTMLElement>('[data-faders]');
  const uniforms: Record<string, number> = {};
  for (const uniform of piece.uniforms) {
    uniforms[uniform.name] = uniform.value;
    const row = document.createElement('div');
    row.className = 'fader';
    const id = `fader-${uniform.name}`;
    row.innerHTML = `
      <label for="${id}">${escapeHtml(uniform.label)}</label>
      <input type="range" id="${id}" role="slider" aria-label="${escapeHtml(uniform.label)}" min="${uniform.min}" max="${uniform.max}" step="${(uniform.max - uniform.min) / 100}" value="${uniform.value}">
      <output class="tnum" for="${id}">${uniform.value}</output>`;
    const input = row.querySelector<HTMLInputElement>('input')!;
    const output = row.querySelector<HTMLElement>('output')!;
    input.addEventListener('input', () => {
      uniforms[uniform.name] = Number(input.value);
      output.textContent = input.value;
      handle?.setUniform(uniform.name, Number(input.value));
      dirty = true;
      updateRenderButton();
    });
    input.addEventListener('keydown', (event) => {
      const step = (uniform.max - uniform.min) / 100;
      if (event.key === 'PageDown' || event.key === 'PageUp') {
        event.preventDefault();
        const next = Number(input.value) + (event.key === 'PageUp' ? step * 10 : -step * 10);
        input.value = String(Math.min(uniform.max, Math.max(uniform.min, next)));
        input.dispatchEvent(new Event('input'));
      }
    });
    fadersHost?.appendChild(row);
  }

  // ---------------------------------------------------------------- timeline
  const timeline = piece.timeline;
  let dirty = false;
  let selectedTrack = timeline.tracks[0]?.uniform ?? piece.uniforms[0]?.name ?? '';
  let playhead = 0;
  let previewPlaying = false;
  let previewTimer = 0;

  const timelineRegion = document.querySelector<HTMLElement>('[data-timeline]');
  const playheadInput = document.querySelector<HTMLInputElement>('[data-playhead]');
  if (playheadInput) {
    playheadInput.min = '0';
    playheadInput.max = String(timeline.duration_s);
    playheadInput.step = '0.1';
    playheadInput.addEventListener('input', () => {
      playhead = Number(playheadInput.value);
      applyTimelineToCanvas();
    });
  }

  const tracksHost = document.querySelector<HTMLElement>('[data-tracks]');

  interface KeyframeRef { time_s: number; value: number; easing: string }

  const paintTracks = (): void => {
    if (!tracksHost) return;
    tracksHost.innerHTML = '';
    for (const track of timeline.tracks) {
      const label = piece.uniforms.find((u) => u.name === track.uniform)?.label ?? track.uniform;
      const row = document.createElement('div');
      row.className = 'track-row track-list-block';
      const lane = document.createElement('div');
      lane.className = 'track-lane';
      const listBlock = document.createElement('div');
      listBlock.className = 'keyframe-list';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `Select ${label} layer`;
      button.setAttribute('aria-pressed', track.uniform === selectedTrack ? 'true' : 'false');
      button.addEventListener('click', () => {
        selectedTrack = track.uniform;
        paintTracks();
      });
      for (const keyframe of track.keyframes) {
        const diamond = document.createElement('button');
        diamond.type = 'button';
        diamond.className = 'keyframe';
        diamond.style.left = `${(keyframe.time_s / timeline.duration_s) * 100}%`;
        diamond.setAttribute('aria-label', `Keyframe ${label} at ${keyframe.time_s.toFixed(1)} s`);
        diamond.dataset.time = String(keyframe.time_s);
        lane.appendChild(diamond);
        const keyframeRow = document.createElement('div');
        keyframeRow.className = 'keyframe-row';
        keyframeRow.innerHTML = `<span>${label}</span><span class="tnum">${keyframe.time_s.toFixed(1)} s · ${EASING_LABELS[keyframe.easing] ?? keyframe.easing}</span>`;
        listBlock.appendChild(keyframeRow);

        diamond.addEventListener('click', () => {
          playhead = keyframe.time_s;
          if (playheadInput) playheadInput.value = String(playhead);
          selectedTrack = track.uniform;
          focusedKeyframe = keyframe as unknown as KeyframeRef;
          paintTracks();
        });
        diamond.addEventListener('keydown', (event) => {
          event.preventDefault();
          const delta = event.shiftKey ? 1 : 0.1;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            const next = Math.round((keyframe.time_s + (event.key === 'ArrowRight' ? delta : -delta)) * 10) / 10;
            const clash = track.keyframes.some((kf) => Math.abs(kf.time_s - next) < 0.05 && kf !== keyframe);
            if (next < 0 || next > timeline.duration_s) return;
            if (clash) {
              announce(statusRegion, `${label} already has a keyframe at ${next.toFixed(1)} s.`);
              return;
            }
            keyframe.time_s = next;
            keyframe.value = valueAtPlayhead(track.uniform, keyframe.time_s);
            dirty = true;
            announce(statusRegion, `${label} keyframe moved to ${next.toFixed(1)} s.`);
            paintTracks();
          } else if (event.key === 'Delete' || event.key === 'Backspace') {
            track.keyframes = track.keyframes.filter((kf) => kf !== keyframe);
            dirty = true;
            announce(statusRegion, `${label} keyframe removed.`);
            paintTracks();
            const nextButton = lane.querySelector<HTMLElement>('.keyframe');
            (nextButton ?? button).focus();
          }
        });
        diamond.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          const move = (moveEvent: PointerEvent): void => {
            const rect = lane.getBoundingClientRect();
            const frac = Math.min(1, Math.max(0, (moveEvent.clientX - rect.left) / rect.width));
            const next = Math.round(frac * timeline.duration_s * 10) / 10;
            const clash = track.keyframes.some((kf) => Math.abs(kf.time_s - next) < 0.05 && kf !== keyframe);
            if (clash) return;
            keyframe.time_s = next;
            paintTracks();
          };
          const up = (): void => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            dirty = true;
            announce(statusRegion, `${label} keyframe moved to ${keyframe.time_s.toFixed(1)} s.`);
          };
          document.addEventListener('pointermove', move);
          document.addEventListener('pointerup', up);
        });
      }
      row.append(button, lane, listBlock);
      tracksHost.appendChild(row);
    }
  };
  let focusedKeyframe: KeyframeRef | null = null;
  paintTracks();

  const valueAtPlayhead = (uniform: string, time: number): number => {
    const track = timeline.tracks.find((t) => t.uniform === uniform);
    if (!track || track.keyframes.length === 0) return uniforms[uniform] ?? 0;
    const sorted = [...track.keyframes].sort((a, b) => a.time_s - b.time_s);
    if (time <= sorted[0].time_s) return sorted[0].value;
    const last = sorted[sorted.length - 1];
    if (time >= last.time_s) return last.value;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (time >= a.time_s && time <= b.time_s) {
        const frac = (time - a.time_s) / (b.time_s - a.time_s);
        return a.value + (b.value - a.value) * ease(a.easing, frac);
      }
    }
    return last.value;
  };

  const ease = (kind: string, t: number): number => {
    if (kind === 'ease-in') return t * t;
    if (kind === 'ease-out') return 1 - (1 - t) * (1 - t);
    if (kind === 'ease-in-out') return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    return t;
  };

  const applyTimelineToCanvas = (): void => {
    for (const uniform of piece.uniforms) {
      const track = timeline.tracks.find((t) => t.uniform === uniform.name);
      const value = track ? valueAtPlayhead(uniform.name, playhead) : uniforms[uniform.name];
      handle?.setUniform(uniform.name, value);
    }
    if (prefersReducedMotion()) handle?.renderStill();
  };
  applyTimelineToCanvas();

  // K adds a keyframe on the selected layer at the playhead.
  timelineRegion?.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 'k') return;
    event.preventDefault();
    const label = piece.uniforms.find((u) => u.name === selectedTrack)?.label ?? selectedTrack;
    let track = timeline.tracks.find((t) => t.uniform === selectedTrack);
    if (!track) {
      track = { uniform: selectedTrack, keyframes: [] };
      timeline.tracks.push(track);
    }
    const time = Math.round(playhead * 10) / 10;
    if (track.keyframes.some((kf) => Math.abs(kf.time_s - time) < 0.05)) {
      announce(statusRegion, `${label} already has a keyframe at ${time.toFixed(1)} s.`);
      return;
    }
    track.keyframes.push({ time_s: time, value: uniforms[selectedTrack] ?? 0, easing: 'ease-in-out' });
    dirty = true;
    announce(statusRegion, `${label} keyframe added at ${time.toFixed(1)} s.`);
    paintTracks();
  });

  // Easing radios apply to the focused or last-selected keyframe.
  const easingGroup = document.querySelector<HTMLElement>('[data-easing]');
  easingGroup?.addEventListener('change', () => {
    const checked = easingGroup.querySelector<HTMLInputElement>('input:checked');
    if (!checked || !focusedKeyframe) return;
    const label = piece.uniforms.find((u) => u.name === selectedTrack)?.label ?? selectedTrack;
    focusedKeyframe.easing = checked.value;
    dirty = true;
    announce(statusRegion, `${label} keyframe easing set to ${EASING_LABELS[checked.value] ?? checked.value}.`);
    paintTracks();
  });

  // Play preview: animated, or 0.1 s per second under reduced motion.
  const playButton = document.querySelector<HTMLButtonElement>('[data-play]');
  playButton?.addEventListener('click', () => {
    previewPlaying = !previewPlaying;
    playButton.textContent = previewPlaying ? 'Pause preview' : 'Play preview';
    if (previewPlaying) {
      previewTimer = window.setInterval(() => {
        playhead = Math.round((playhead + (prefersReducedMotion() ? 0.1 : 0.1)) * 10) / 10;
        if (playhead >= timeline.duration_s) {
          playhead = 0;
          if (prefersReducedMotion()) {
            previewPlaying = false;
            playButton.textContent = 'Play preview';
            window.clearInterval(previewTimer);
          }
        }
        if (playheadInput) playheadInput.value = String(playhead);
        applyTimelineToCanvas();
      }, prefersReducedMotion() ? 1000 : 100);
    } else {
      window.clearInterval(previewTimer);
    }
  });

  // Asset uploads.
  for (const kind of ['audio', 'font', 'model'] as const) {
    const button = document.querySelector<HTMLButtonElement>(`[data-upload-${kind}]`);
    button?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = kind === 'audio' ? '.wav,.mp3' : kind === 'font' ? '.woff2,.ttf' : '.glb';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        const form = new FormData();
        form.set('kind', kind);
        form.set('file', file);
        const res = await fetch(`/api/pieces/${slug}/assets`, { method: 'POST', body: form, credentials: 'same-origin' });
        if (res.status === 413) {
          announce(statusRegion, `That file is over 20,000,000 bytes.`);
          return;
        }
        if (res.ok) {
          announce(statusRegion, `${file.name} uploaded.`);
        }
      });
      input.click();
    });
  }

  // ---------------------------------------------------------------- save
  const saveButton = document.querySelector<HTMLButtonElement>('[data-save]');
  saveButton?.addEventListener('click', async () => {
    if (!isDraft) return;
    const body = {
      title: piece.title,
      uniforms: { ...uniforms },
      timeline
    };
    const result = await api<PieceJson>('PUT', `/api/pieces/${slug}`, body, { ifMatch: piece.version });
    if (result.status === 412) {
      const err = result.body as { error: { current_version?: number } };
      announce(statusRegion, `This piece changed in another tab. Reload to see version ${err.error.current_version}.`);
      return;
    }
    if (!result.ok) return;
    const fresh = result.body as PieceJson;
    piece.version = fresh.version;
    dirty = false;
    announce(statusRegion, `Saved version ${fresh.version}.`);
    updateRenderButton();
  });

  // ---------------------------------------------------------------- render
  const aspectInputs = document.querySelectorAll<HTMLInputElement>('[data-aspect]');
  const resolutionInputs = document.querySelectorAll<HTMLInputElement>('[data-resolution]');
  const formatInputs = document.querySelectorAll<HTMLInputElement>('[data-format]');
  const durationInput = document.querySelector<HTMLInputElement>('[data-duration]');
  const renderButton = document.querySelector<HTMLButtonElement>('[data-render]');
  const cancelButton = document.querySelector<HTMLButtonElement>('[data-cancel-render]');
  const pixelPanelImg = document.querySelector<HTMLImageElement>('[data-editor-pixel]');
  const pixelPanel = pixelPanelImg ? new PixelPanel(pixelPanelImg) : null;

  const renderCost = (): number => {
    const resolution = checked(resolutionInputs, '720p');
    const duration = Math.max(5, Math.min(60, Number(durationInput?.value ?? '10')));
    return duration * (resolution === '1080p' ? 2 : 1);
  };

  const updateRenderButton = (): void => {
    if (!renderButton) return;
    const aspect = checked(aspectInputs, '16:9');
    const cost = renderCost();
    renderButton.textContent = `Render ${aspect} · ${cost} credits`;
    const creditsResult = availableCredits;
    const short = creditsResult !== null && creditsResult < cost;
    renderButton.disabled = !isDraft || short || dirty;
  };
  let availableCredits: number | null = null;
  const creditsResult = await api<{ available: number; held: number }>('GET', '/api/me/credits');
  if (creditsResult.ok) {
    availableCredits = (creditsResult.body as { available: number }).available;
    const availEl = document.querySelector<HTMLElement>('[data-editor-credits]');
    if (availEl) availEl.textContent = `${availableCredits} available`;
  }
  updateRenderButton();

  const announceHistory: Set<string> = new Set();
  const lastRenderId = await latestRender(slug);
  if (lastRenderId) void pollRender(lastRenderId);

  renderButton?.addEventListener('click', async () => {
    if (!isDraft) return;
    const cost = renderCost();
    if (availableCredits !== null && availableCredits < cost) {
      announce(renderRegion, `This render needs ${cost} credits; you have ${availableCredits}.`);
      return;
    }
    const body = {
      format: checked(formatInputs, 'mp4'),
      resolution: checked(resolutionInputs, '720p'),
      duration_s: Number(durationInput?.value ?? '10'),
      aspect: checked(aspectInputs, '16:9')
    };
    const result = await api<{ render: RenderJson }>('POST', `/api/pieces/${slug}/renders`, body, { idempotencyKey: freshIdempotencyKey() });
    if (result.status === 402) {
      const err = result.body as { error: { needed?: number; available?: number } };
      announce(renderRegion, `This render needs ${err.error.needed ?? cost} credits; you have ${err.error.available ?? 0}.`);
      return;
    }
    if (!result.ok) return;
    const render = (result.body as { render: RenderJson }).render;
    announceHistory.clear();
    announce(renderRegion, `Render queued. ${render.cost_credits} credits reserved.`);
    if (cancelButton) cancelButton.hidden = false;
    void pollRender(render.id);
  });

  cancelButton?.addEventListener('click', async () => {
    const id = await latestRender(slug);
    if (!id) return;
    const result = await api<RenderJson>('POST', `/api/renders/${id}/cancel`);
    if (result.ok) {
      const render = result.body as RenderJson;
      for (const event of render.history) {
        if (announceHistory.has(event.state)) continue;
        announceHistory.add(event.state);
        if (event.state === 'credits_released') {
          announce(renderRegion, `Render cancelled.`);
          announce(renderRegion, `${render.cost_credits} credits returned to your balance.`);
        }
      }
      cancelButton.hidden = true;
    }
  });

  async function pollRender(renderId: string): Promise<void> {
    for (;;) {
      const result = await api<RenderJson>('GET', `/api/renders/${renderId}`);
      if (!result.ok) return;
      const render = result.body as RenderJson;
      const state = pixelPanelState(render);
      pixelPanel?.setState(state);
      for (const event of render.history) {
        if (announceHistory.has(event.state)) continue;
        announceHistory.add(event.state);
        const text = renderAnnouncement(render, event.state);
        if (text) announce(renderRegion, text);
      }
      if (render.state === 'ready') {
        if (cancelButton) cancelButton.hidden = true;
        return;
      }
      if (render.state === 'credits_released') {
        if (cancelButton) cancelButton.hidden = true;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  function pixelPanelState(render: RenderJson): 'idle' | 'rendering' | 'error' {
    if (['accepted', 'queued', 'rendering', 'stored'].includes(render.state)) return 'rendering';
    if ((render.failure_reason !== null && render.failure_reason !== 'cancelled') || render.history.some((h) => h.state === 'failed' || h.state === 'timed_out')) return 'error';
    return 'idle';
  }

  function renderAnnouncement(render: RenderJson, state: string): string | null {
    if (state === 'accepted' || state === 'stored') return null;
    if (state === 'queued') return `Render queued. ${render.cost_credits} credits reserved.`;
    if (state === 'rendering') return `Rendering ${render.aspect} ${render.resolution} export.`;
    if (state === 'ready') return `Export ready. ${render.cost_credits} credits used.`;
    if (state === 'failed') return `Render failed. Your credits are being returned.`;
    if (state === 'timed_out') return `Render timed out after 3 attempts.`;
    if (state === 'credits_released') {
      if (render.failure_reason === 'cancelled') return `${render.cost_credits} credits returned to your balance.`;
      return `${render.cost_credits} credits returned to your balance.`;
    }
    return null;
  }

  async function latestRender(pieceSlug: string): Promise<string | null> {
    const result = await api<{ renders: RenderJson[] }>('GET', `/api/pieces/${pieceSlug}/renders`);
    if (!result.ok) return null;
    const renders = (result.body as { renders: RenderJson[] }).renders;
    if (renders.length === 0) return null;
    const latest = renders[0];
    if (['accepted', 'queued', 'rendering', 'stored'].includes(latest.state)) return latest.id;
    return null;
  }

  // ---------------------------------------------------------------- publish
  const publishButton = document.querySelector<HTMLButtonElement>('[data-publish]');
  const publishDialog = document.querySelector<HTMLDialogElement>('dialog[data-publish-dialog]');
  const editionsInput = publishDialog?.querySelector<HTMLInputElement>('[data-editions]');
  const priceInput = publishDialog?.querySelector<HTMLInputElement>('[data-price]');
  const exportSelect = publishDialog?.querySelector<HTMLSelectElement>('[data-export]');
  const submitPublish = publishDialog?.querySelector<HTMLButtonElement>('[data-submit-publish]');

  publishButton?.addEventListener('click', async () => {
    const renders = await api<{ renders: RenderJson[] }>('GET', `/api/pieces/${slug}/renders`);
    if (exportSelect && renders.ok) {
      const ready = (renders.body as { renders: RenderJson[] }).renders.filter((r) => r.state === 'ready');
      exportSelect.innerHTML = ready.map((r) => `<option value="${r.id}">${r.aspect} ${r.resolution} ${r.duration_s}s</option>`).join('');
    }
    if (publishDialog) {
      publishDialog.showModal();
      focusTrap(publishDialog, () => publishDialog.close(), editionsInput ?? null);
    }
  });

  submitPublish?.addEventListener('click', async () => {
    const body = {
      edition_count: Number(editionsInput?.value ?? '30'),
      price_cents: Math.round(Number((priceInput?.value ?? '15').replace('$', '')) * 100),
      export_render_id: exportSelect?.value ?? ''
    };
    const result = await api<PieceJson>('POST', `/api/pieces/${slug}/publish`, body);
    if (result.ok) {
      announce(statusRegion, `Published as ${body.edition_count} numbered editions.`);
      publishDialog?.close();
      return;
    }
    const err = result.body as { error: { code: string; message: string } };
    announce(statusRegion, err.error.message);
  });

  const withdrawButton = document.querySelector<HTMLButtonElement>('[data-withdraw]');
  withdrawButton?.addEventListener('click', async () => {
    const result = await api<PieceJson>('POST', `/api/pieces/${slug}/withdraw`);
    if (result.ok) announce(statusRegion, `Withdrawn. Owners keep their downloads.`);
  });

  if (publishButton) publishButton.hidden = !isDraft;
  if (withdrawButton) withdrawButton.hidden = isDraft;
  if (saveButton) saveButton.hidden = !isDraft;

  observeEntrances();
}

function checked(inputs: NodeListOf<HTMLInputElement>, fallback: string): string {
  for (const input of inputs) if (input.checked) return input.value;
  return fallback;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

void main();
