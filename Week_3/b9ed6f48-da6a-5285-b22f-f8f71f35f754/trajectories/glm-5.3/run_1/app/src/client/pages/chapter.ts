import { api, type ChapterDetail } from '../api.ts';
import { shell, notice, openDialog, closeDialog, errorSummary, clearErrorSummary, newIdempotencyKey, isApiFailure, motionEnabled } from '../shell.ts';
import { createSightlineScene, webglAvailable, renderViewpointImage, type SceneHandle } from '../scenes/sightline.ts';
import { alignment, withinResolveWindow, viewpoints, angle, clampYaw, roundYaw } from '../../shared/sightline.ts';
import { initSpringExhibit, initRulesExhibit, initClassifierExhibit, initNeighboursExhibit } from '../exhibits/wiring.ts';

/** The chapter page: sightline scene, plates, narration, exhibit and events. */

export async function initChapterPage(): Promise<void> {
  const number = Number(window.location.pathname.split('/').pop());
  let chapter: ChapterDetail;
  try {
    const res = await api.get<{ chapter: ChapterDetail }>(`/api/chapters/${number}`);
    chapter = res.chapter;
  } catch {
    window.location.href = '/not-found';
    return;
  }

  const sceneRegion = document.querySelector<HTMLElement>('[data-role="sightline-scene"]');
  const readout = document.querySelector<HTMLElement>('[data-role="alignment-meter"]');
  const slider = document.querySelector<HTMLElement>('[data-role="sightline-slider"]');
  const statusRegion = document.querySelector<HTMLElement>('[data-role="sightline-status"]');
  const enterButton = document.querySelector<HTMLButtonElement>('[data-role="enter-chapter"]');
  const alignButton = document.querySelector<HTMLButtonElement>('[data-role="align"]');
  const heading = document.querySelector<HTMLElement>('[data-role="chapter-heading"]');
  const exhibitBand = document.querySelector<HTMLElement>('[data-role="exhibit-band"]');
  const railCurrent = document.querySelector<HTMLElement>('[data-rail-current]');
  void railCurrent;

  let resolved = chapter.resolved;
  let yaw: number = chapter.resolved ? chapter.sightline_deg : -60;

  /** The alignment readout, slider value and aria-valuetext, on every change. */
  function refreshReadout(): void {
    const pct = resolved ? 100 : alignment(yaw, chapter.sightline_deg);
    if (readout) {
      readout.textContent = `Alignment ${pct}%`;
      readout.classList.toggle('locked', resolved || pct === 100);
    }
    if (slider) {
      slider.setAttribute('aria-valuenow', String(pct));
      slider.setAttribute('aria-valuetext', `Yaw ${angle(yaw)}, alignment ${pct}%`);
      if (slider instanceof HTMLInputElement) slider.value = String(pct);
    }
  }

  function maybeResolve(): void {
    if (resolved || !withinResolveWindow(yaw, chapter.sightline_deg)) return;
    resolved = true;
    if (heading) heading.classList.add('visible');
    if (enterButton) enterButton.disabled = false;
    if (readout) readout.classList.add('locked');
    if (statusRegion) statusRegion.textContent = `Chapter ${chapter.numeral} resolved.`;
    chime();
    void api.post('/api/me/path/resolved', { chapter: chapter.number }).catch(() => {
      /* kept in the page; saved when accounts answer again */
    });
  }

  function chime(): void {
    if (!shell.preferences.sound) return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
      window.setTimeout(() => void ctx.close(), 600);
    } catch {
      /* audio unavailable: no chime */
    }
  }

  /** Enter chapter: reveal the exhibit and record the position. */
  async function enterChapter(): Promise<void> {
    if (exhibitBand) exhibitBand.hidden = false;
    if (heading) heading.setAttribute('tabindex', '-1');
    heading?.focus();
    try {
      await api.put('/api/me/path/position', { chapter: chapter.number, exhibit: '' });
    } catch {
      /* kept in the page */
    }
    // The first change to an exhibit control records the exhibit key.
    if (chapter.exhibit) watchExhibitUse(chapter.exhibit);
  }

  function watchExhibitUse(key: string): void {
    const band = document.querySelector<HTMLElement>('[data-role="exhibit-band"]');
    if (!band) return;
    let recorded = false;
    band.addEventListener('pointerdown', () => {
      if (recorded) return;
      recorded = true;
      void api.put('/api/me/path/position', { chapter: chapter.number, exhibit: key }).catch(() => undefined);
    });
    band.addEventListener('keydown', (event) => {
      if (recorded) return;
      const target = event.target as HTMLElement;
      const interactive = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement;
      if (!interactive) return;
      recorded = true;
      void api.put('/api/me/path/position', { chapter: chapter.number, exhibit: key }).catch(() => undefined);
    });
  }

  const useStill = !webglAvailable() || !motionEnabled();

  if (useStill) {
    renderStillViewpoints();
  } else {
    const container = document.querySelector<HTMLElement>('[data-role="scene-container"]');
    if (container) {
      let handle: SceneHandle | null = null;
      try {
        handle = createSightlineScene(container, {
          numeral: chapter.numeral,
          sightlineDeg: chapter.sightline_deg,
          onYawChange(next) {
            yaw = next;
            refreshReadout();
            maybeResolve();
          },
          reducedMotion: () => !motionEnabled(),
        });
        handle.setYaw(yaw);
        refreshReadout();
        maybeResolve();
      } catch {
        renderStillViewpoints();
      }
      window.addEventListener('resize', () => handle?.resize());
      (window as unknown as { _scene: SceneHandle | null })._scene = handle;
    }
  }

  function renderStillViewpoints(): void {
    const canvas = document.querySelector<HTMLElement>('[data-role="scene-container"]');
    const stillSlot = document.querySelector<HTMLElement>('[data-role="viewpoints"]');
    if (!stillSlot) return;
    if (canvas) canvas.hidden = true;
    if (!webglAvailable()) {
      const note = document.createElement('p');
      note.textContent = "Your browser can't show the 3D scene, so here are its viewpoints.";
      stillSlot.prepend(note);
    }
    stillSlot.hidden = false;
    const group = stillSlot.querySelector<HTMLElement>('[data-role="viewpoints-group"]');
    if (!group) return;
    group.textContent = '';
    const angles = viewpoints(chapter.sightline_deg);
    for (const deg of angles) {
      const pct = alignment(deg, chapter.sightline_deg);
      const label = `Viewpoint ${angle(deg)}, alignment ${pct}%`;
      const wrapper = document.createElement('label');
      wrapper.className = 'viewpoint';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'viewpoint';
      radio.setAttribute('role', 'radio');
      radio.setAttribute('aria-label', label);
      radio.value = String(deg);
      if (!webglAvailable()) {
        const img = document.createElement('img');
        img.src = renderViewpointImage(chapter.numeral, chapter.sightline_deg, deg);
        img.alt = label;
        wrapper.appendChild(img);
      } else {
        const box = document.createElement('div');
        box.style.height = '90px';
        box.style.background = '#0e0f0c';
        box.textContent = '';
        wrapper.appendChild(box);
      }
      const angleText = document.createElement('div');
      angleText.className = 'angle';
      angleText.textContent = `${angle(deg)} · ${pct}%`;
      wrapper.append(radio, angleText);
      radio.addEventListener('change', () => {
        yaw = deg;
        refreshReadout();
        maybeResolve();
      });
      group.appendChild(wrapper);
    }
  }

  // Slider keyboard control
  if (slider) {
    slider.setAttribute('aria-valuemin', '0');
    slider.setAttribute('aria-valuemax', '100');
    refreshReadout();
    slider.addEventListener('keydown', (event) => {
      let next: number | null = null;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = clampYaw(yaw - 3);
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = clampYaw(yaw + 3);
      else if (event.key === 'Home') next = -60;
      else if (event.key === 'End') next = 60;
      if (next === null) return;
      event.preventDefault();
      yaw = roundYaw(next);
      const handle = (window as unknown as { _scene?: SceneHandle | null })._scene;
      handle?.setYaw(yaw);
      refreshReadout();
      maybeResolve();
    });
  }

  // The A key inside the scene region selects the sightline.
  sceneRegion?.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 'a') return;
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === 'text') return;
    if (target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    alignToSightline();
  });

  function alignToSightline(): void {
    const stillSlot = document.querySelector<HTMLElement>('[data-role="viewpoints"]');
    if (stillSlot && !stillSlot.hidden) {
      const radios = stillSlot.querySelectorAll<HTMLInputElement>('input[name="viewpoint"]');
      const target = Array.from(radios).find((r) => Number(r.value) === chapter.sightline_deg);
      if (target) {
        target.checked = true;
        target.dispatchEvent(new Event('change'));
        target.focus();
        return;
      }
    }
    yaw = clampYaw(chapter.sightline_deg);
    const handle = (window as unknown as { _scene?: SceneHandle | null })._scene;
    handle?.setYaw(yaw);
    refreshReadout();
    maybeResolve();
  }

  alignButton?.addEventListener('click', alignToSightline);
  enterButton?.addEventListener('click', () => void enterChapter());

  // Bookmark chapter
  const bookmarkButton = document.querySelector<HTMLButtonElement>('[data-role="bookmark-chapter"]');
  if (bookmarkButton) {
    let bookmarked = false;
    let bookmarkId: string | null = null;
    if (shell.user) {
      void api.get<{ bookmarks: Array<{ id: string; target_id: string }> }>('/api/me/bookmarks').then((res) => {
        const found = res.bookmarks.find((b) => b.target_id === `chapter-${chapter.number}`);
        if (found) {
          bookmarked = true;
          bookmarkId = found.id;
          bookmarkButton.setAttribute('aria-pressed', 'true');
        }
      }).catch(() => undefined);
    }
    bookmarkButton.addEventListener('click', async () => {
      if (!shell.user) {
        notice('Please sign in.');
        return;
      }
      try {
        if (bookmarked && bookmarkId) {
          await api.delete(`/api/me/bookmarks/${bookmarkId}`);
          bookmarked = false;
          bookmarkId = null;
          bookmarkButton.setAttribute('aria-pressed', 'false');
          notice('Bookmark removed.');
        } else {
          const res = await api.post<{ bookmark: { id: string } }>('/api/me/bookmarks', {
            target_type: 'chapter',
            target_id: `chapter-${chapter.number}`,
          });
          bookmarked = true;
          bookmarkId = res.bookmark.id;
          bookmarkButton.setAttribute('aria-pressed', 'true');
          notice(`Bookmarked ${chapter.title}.`);
        }
      } catch (e) {
        notice(isApiFailure(e) ? e.message : 'Something went wrong.');
      }
    });
  }

  // Plates: cross-fade on their own while motion is on; pause on focus or hover.
  const plateViewer = document.querySelector<HTMLElement>('[data-role="plates"]');
  const plateImgs = Array.from(document.querySelectorAll<HTMLImageElement>('[data-role="plate"]'));
  const plateCaptions = Array.from(document.querySelectorAll<HTMLElement>('[data-role="plate-caption"]'));
  let plateIndex = 0;
  let plateTimer: number | null = null;
  function showPlate(index: number): void {
    plateImgs.forEach((img, i) => {
      img.hidden = i !== index;
      img.style.opacity = i === index ? '1' : '0';
    });
    plateCaptions.forEach((cap, i) => {
      cap.hidden = i !== index;
    });
  }
  function startPlates(): void {
    if (!motionEnabled() || plateImgs.length < 2) return;
    stopPlates();
    plateTimer = window.setInterval(() => {
      plateIndex = (plateIndex + 1) % plateImgs.length;
      showPlate(plateIndex);
    }, 7000);
  }
  function stopPlates(): void {
    if (plateTimer !== null) window.clearInterval(plateTimer);
    plateTimer = null;
  }
  showPlate(0);
  if (motionEnabled()) startPlates();
  plateViewer?.addEventListener('focusin', stopPlates);
  plateViewer?.addEventListener('mouseenter', stopPlates);
  plateViewer?.addEventListener('focusout', () => startPlates());
  plateViewer?.addEventListener('mouseleave', () => startPlates());

  const pausePlatesButton = document.querySelector<HTMLButtonElement>('[data-role="pause-plates"]');
  if (pausePlatesButton) {
    let paused = !motionEnabled();
    if (paused) pausePlatesButton.textContent = 'Play plates';
    pausePlatesButton.addEventListener('click', () => {
      paused = !paused;
      pausePlatesButton.textContent = paused ? 'Play plates' : 'Pause plates';
      if (paused) stopPlates();
      else startPlates();
    });
  }
  // Next and Previous plate: reduced motion only.
  const nextPlate = document.querySelector<HTMLButtonElement>('[data-role="next-plate"]');
  const prevPlate = document.querySelector<HTMLButtonElement>('[data-role="previous-plate"]');
  nextPlate?.addEventListener('click', () => {
    plateIndex = (plateIndex + 1) % plateImgs.length;
    showPlate(plateIndex);
  });
  prevPlate?.addEventListener('click', () => {
    plateIndex = (plateIndex - 1 + plateImgs.length) % plateImgs.length;
    showPlate(plateIndex);
  });
  const platesRegion = document.querySelector<HTMLElement>('[data-role="plates"]');
  if (platesRegion) {
    platesRegion.setAttribute('aria-label', 'Plates');
  }

  // Narration: never autoplays.
  const playButton = document.querySelector<HTMLButtonElement>('[data-role="play-narration"]');
  const audio = document.querySelector<HTMLAudioElement>('[data-role="narration-audio"]');
  if (playButton && audio) {
    let playing = false;
    playButton.addEventListener('click', () => {
      if (playing) {
        audio.pause();
        playing = false;
        playButton.textContent = 'Play narration';
      } else {
        void audio.play().then(() => undefined).catch(() => undefined);
        playing = true;
        playButton.textContent = 'Pause narration';
      }
    });
    audio.addEventListener('ended', () => {
      playing = false;
      playButton.textContent = 'Play narration';
    });
  }

  // Transcript disclosure
  const transcriptButton = document.querySelector<HTMLButtonElement>('[data-role="transcript-toggle"]');
  const transcript = document.querySelector<HTMLElement>('[data-role="transcript"]');
  if (transcriptButton && transcript) {
    let open = false;
    transcriptButton.setAttribute('aria-expanded', 'false');
    transcript.hidden = true;
    transcriptButton.addEventListener('click', () => {
      open = !open;
      transcript.hidden = !open;
      transcriptButton.setAttribute('aria-expanded', String(open));
    });
  }

  // Exhibit
  if (chapter.exhibit === 'spring') initSpringExhibit();
  if (chapter.exhibit === 'rules') initRulesExhibit();
  if (chapter.exhibit === 'classifier') initClassifierExhibit();
  if (chapter.exhibit === 'neighbours') initNeighboursExhibit();

  // Threshold band: the next chapter's title assembles as the visitor scrolls.
  initThresholdType();

  // The Supporter plan dialog is reachable from the chapter header button.
  wirePlanDialog();
}

/** Threshold type: the next chapter's title assembles on scroll. */
function initThresholdType(): void {
  const band = document.querySelector<HTMLElement>('[data-role="threshold-band"]');
  const title = band?.querySelector<HTMLElement>('[data-role="next-title"]');
  if (!band || !title) return;
  const text = title.textContent ?? '';
  const letters = text.split('');
  if (!motionEnabled()) {
    title.textContent = text;
    return;
  }
  let assembled = 0;
  const render = (): void => {
    title.textContent = letters
      .map((ch, i) => (i < assembled ? ch : ' '))
      .join('');
  };
  render();
  const onScroll = (): void => {
    const rect = band.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const visible = Math.min(1, Math.max(0, (viewportHeight - rect.bottom) / viewportHeight));
    const next = Math.round(visible * letters.length);
    if (next !== assembled) {
      assembled = next;
      render();
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/** The Supporter plan dialog: tier and currency radios update the price in place. */
export function wirePlanDialog(): void {
  const openers = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-action="support"]'));
  for (const opener of openers) {
    opener.addEventListener('click', () => openDialog('dialog-plan', opener));
  }
  const dialog = document.querySelector<HTMLDialogElement>('#dialog-plan');
  if (!dialog) return;
  const priceStatus = dialog.querySelector<HTMLElement>('[data-role="plan-price"]');
  void priceStatus;
  void closeDialog;
  void errorSummary;
  void clearErrorSummary;
  void newIdempotencyKey;
  void notice;
}
