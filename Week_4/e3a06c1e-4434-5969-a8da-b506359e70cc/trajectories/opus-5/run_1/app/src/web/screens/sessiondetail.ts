import { ApiFailure, request } from '../api.js';
import { clear, el, field, setText, showFieldError } from '../dom.js';
import { SessionField } from '../field/field.js';
import { runMorph } from '../field/morph.js';
import { navigate, type Screen } from '../router.js';
import { may, serviceStatus, type Identity } from '../state.js';
import { openDialog, type DialogHandle } from '../ui/dialog.js';
import { StatusRegion } from '../ui/status.js';
import { billableMinutesText, quotaMeterText, werText } from '../../shared/billing.js';
import { confidenceBand } from '../../shared/confidence.js';
import { fieldCopy, genericFailure, reviewCopy, sessionStatusCopy, serviceCopy } from '../../shared/copy.js';
import type {
  CorrectionView,
  Quota,
  SegmentView,
  SessionState,
  SessionView,
  SpectrumView,
} from '../../shared/types.js';

const WIDE = '(min-width: 1200px)';

interface TranscriptReply {
  segments: SegmentView[];
  wer: number | null;
}

const isOpenState = (state: SessionState): boolean => state === 'connecting' || state === 'live';

const statLine = (name: string): { row: HTMLElement; value: HTMLElement } => {
  const value = el('span', { class: 'stat-value numeric' });
  return {
    row: el('div', { class: 'stat' }, [el('span', { class: 'stat-name', text: name }), value]),
    value,
  };
};

export const sessionDetailScreen = (identity: Identity, sessionId: string, segmentParam: string | null): Screen => {
  const role = identity.user.role;
  const reviewStatus = new StatusRegion('Review status');
  const sessionStatus = new StatusRegion('Session status');

  const ribbon = el('ul', { 'aria-label': 'Confidence ribbon', class: 'ribbon' });
  const headerLabel = el('span', { class: 'field-header-label' });
  const headerChip = el('span', { class: 'chip' });
  const fieldHeader = el('div', { class: 'field-header', 'data-morph': sessionId }, [headerLabel, headerChip]);
  const fieldComponent = new SessionField({
    surfaceClass: 'field-detail',
    spectrum: () => request<SpectrumView>(`/api/sessions/${sessionId}/spectrum`),
  });
  const fieldWrap = el('div', { class: 'field-wrap' }, [fieldHeader, fieldComponent.node]);

  const stats = {
    audio: statLine('Audio'),
    frame: statLine('Frame'),
    peak: statLine('Peak bin'),
    channels: statLine('Channels'),
    billable: statLine('Billable minutes'),
    quota: statLine('Quota used'),
    wer: statLine('Word error rate'),
  };
  const statStrip = el(
    'section',
    { 'aria-label': 'Session stats', class: 'stat-strip' },
    Object.values(stats).map((entry) => entry.row),
  );

  const stopButton = el('button', { type: 'button', class: 'button', text: 'Stop session' });
  stopButton.hidden = true;
  stopButton.addEventListener('click', () => {
    stopButton.disabled = true;
    void request(`/api/sessions/${sessionId}/close`, { method: 'POST' }).catch(() => undefined);
  });

  const segmentList = el('div', { class: 'segment-list' });
  const transcript = el('section', { 'aria-label': 'Transcript', class: 'transcript' }, [
    reviewStatus.node,
    segmentList,
  ]);

  const inspectorRegion = el('section', { 'aria-label': 'Segment inspector', class: 'inspector-region' });
  const confidenceTable = el('table', { 'aria-label': 'Segment confidence', class: 'table' });

  const paneOne = el('div', { class: 'pane pane-field' }, [
    ribbon,
    fieldWrap,
    statStrip,
    el('div', { class: 'field-actions' }, [stopButton, sessionStatus.node]),
  ]);
  if (fieldComponent.usesFallback) paneOne.append(confidenceTable);
  const node = el('section', { class: 'screen session-detail' }, [paneOne, transcript, inspectorRegion]);

  let session: SessionView | null = null;
  let quota: Quota | null = null;
  let segments: SegmentView[] = [];
  let wer: number | null = null;
  let selected: string | null = segmentParam;
  let sheet: DialogHandle | null = null;
  const drafts = new Map<string, string>();
  const buttons = new Map<string, { button: HTMLButtonElement; label: HTMLElement }>();
  let wide = window.matchMedia(WIDE).matches;
  let stream: EventSource | null = null;
  let announcedState: string | null = null;

  const flaggedIds = (): string[] => segments.filter((segment) => segment.flagged).map((segment) => segment.id);

  const segmentName = (segment: SegmentView): string =>
    `Segment ${segment.index + 1}: ${segment.reviewed.text}`;

  const renderRibbon = (): void => {
    clear(ribbon);
    for (const segment of segments)
      for (const word of segment.reviewed.words) {
        const band = confidenceBand(word.confidence);
        const tile = el('li', {
          class: `tile tile-${band}`,
          'data-confidence': word.confidence.toFixed(2),
          'data-band': band,
          'data-segment': segment.id,
        }, [el('span', { class: 'tile-word', text: word.text })]);
        if (band === 'low') tile.append(el('span', { class: 'tile-flag', text: 'low' }));
        ribbon.append(tile);
      }
  };

  const renderConfidenceTable = (): void => {
    if (!fieldComponent.usesFallback) return;
    clear(confidenceTable);
    const body = el('tbody');
    const current = segments.find((segment) => segment.id === selected) ?? segments[0];
    for (const word of current?.reviewed.words ?? [])
      body.append(
        el('tr', {}, [
          el('th', { scope: 'row', text: word.text }),
          el('td', { class: 'numeric', text: `${(word.start_ms / 1000).toFixed(3)} s` }),
          el('td', { class: 'numeric', text: word.confidence.toFixed(2) }),
        ]),
      );
    confidenceTable.append(
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Word' }),
          el('th', { scope: 'col', text: 'Start' }),
          el('th', { scope: 'col', text: 'Confidence' }),
        ]),
      ]),
      body,
    );
  };

  const renderSegments = (): void => {
    for (const segment of segments) {
      const existing = buttons.get(segment.id);
      if (existing !== undefined) {
        setText(existing.label, segmentName(segment));
        existing.button.setAttribute('aria-label', segmentName(segment));
        existing.button.setAttribute('data-flagged', String(segment.flagged));
        continue;
      }
      const label = el('span', { class: 'segment-text', text: segmentName(segment) });
      const button = el('button', { type: 'button', class: 'segment-button', 'data-flagged': String(segment.flagged) }, [
        label,
      ]);
      button.setAttribute('aria-label', segmentName(segment));
      button.dataset.segmentId = segment.id;
      if (segment.flagged) button.append(el('span', { class: 'segment-flag', text: 'Flagged' }));
      button.addEventListener('click', () => openInspector(segment.id, true));
      buttons.set(segment.id, { button, label });
      segmentList.append(button);
    }
  };

  const applyStats = (): void => {
    if (session === null) return;
    setText(stats.audio.value, `${(session.audio_ms / 1000).toFixed(3)} s`);
    setText(stats.frame.value, String(session.frame));
    setText(stats.channels.value, String(session.channels));
    setText(
      stats.billable.value,
      session.billable_seconds === null ? '—' : billableMinutesText(session.billable_seconds),
    );
    setText(stats.quota.value, quota === null ? '—' : quotaMeterText(quota.used_seconds, quota.limit_minutes));
    setText(stats.wer.value, werText(wer));
    setText(stats.peak.value, fieldComponent.canvas.getAttribute('data-peak-bin') ?? '0');
  };

  const applySessionState = (state: SessionState, reason: SessionView['close_reason']): void => {
    if (session !== null) {
      session = { ...session, state, close_reason: reason };
      setText(headerChip, state);
      headerChip.className = `chip chip-${state}`;
    }
    fieldComponent.setSessionState(state);
    stopButton.hidden = !(isOpenState(state) && may(role, 'stop'));
    const signature = `${state}:${reason ?? ''}`;
    if (announcedState !== signature) {
      announcedState = signature;
      sessionStatus.set(sessionStatusCopy(state, reason));
    }
    if (!isOpenState(state)) void loadStoredSpectrum();
  };

  const loadStoredSpectrum = async (): Promise<void> => {
    const spectrum = await request<SpectrumView>(`/api/sessions/${sessionId}/spectrum`).catch(() => null);
    if (spectrum === null) return;
    fieldComponent.setStoredSpectrum(spectrum);
    applyStats();
  };

  const upsertSegment = (segment: SegmentView): void => {
    const index = segments.findIndex((entry) => entry.id === segment.id);
    if (index >= 0) segments[index] = segment;
    else segments = [...segments, segment].sort((a, b) => a.index - b.index);
  };

  /** The reviewed text, the ribbon tiles and the rate change only from the server's word. */
  const applyCorrection = (segment: SegmentView, nextWer: number | null): void => {
    upsertSegment(segment);
    wer = nextWer;
    renderSegments();
    renderRibbon();
    renderConfidenceTable();
    applyStats();
  };

  const focusSegment = (segmentId: string): void => {
    buttons.get(segmentId)?.button.focus();
  };

  const moveFlagged = (direction: 1 | -1): void => {
    const flagged = flaggedIds();
    if (flagged.length === 0) return;
    const activeId =
      document.activeElement instanceof HTMLElement ? document.activeElement.dataset.segmentId : undefined;
    const current = activeId ?? selected;
    const position = current === undefined || current === null ? -1 : flagged.indexOf(current);
    const next =
      position < 0 ? (direction === 1 ? 0 : flagged.length - 1) : Math.min(flagged.length - 1, Math.max(0, position + direction));
    const target = flagged[next];
    if (target === undefined) return;
    selected = target;
    focusSegment(target);
    if (wide) openInspector(target, false);
  };

  const buildInspector = (container: HTMLElement, segment: SegmentView, focusText: boolean): void => {
    clear(container);
    const own = segment.open_correction;
    const isAuthor = own !== null && own.author_id === identity.user.id;
    const play = el('button', { type: 'button', class: 'button', text: 'Play segment audio' });
    play.addEventListener('click', () => void playSegment(segment.id));
    container.append(
      el('h2', { class: 'inspector-title', text: `Segment ${segment.index + 1}` }),
      el('p', { class: 'inspector-machine', text: segment.machine.text }),
      play,
    );

    if (own !== null && own.state === 'returned' && isAuthor) {
      const reopen = el('button', { type: 'button', class: 'button button-primary', text: 'Reopen as draft' });
      reopen.addEventListener('click', () => {
        reopen.disabled = true;
        void request<{ correction: CorrectionView }>(`/api/corrections/${own.id}/reopen`, { method: 'POST' })
          .then(() => {
            reviewStatus.set(reviewCopy.reopened);
            void refreshTranscript().then(() => openInspector(segment.id, false));
          })
          .catch(() => {
            reopen.disabled = false;
            reviewStatus.set(reviewCopy.alreadyDecided);
          });
      });
      container.append(reopen);
    } else if (may(role, 'write_corrections')) {
      const text = el('textarea', {
        id: 'corrected-text',
        'aria-label': 'Corrected text',
        class: 'input textarea',
      });
      text.value = drafts.get(segment.id) ?? segment.reviewed.text;
      const textField = field('Corrected text', text, 'corrected-text-error');
      const save = el('button', { type: 'button', class: 'button', text: 'Save draft' });
      const submit = el('button', { type: 'button', class: 'button button-primary', text: 'Submit for approval' });
      text.addEventListener('input', () => drafts.set(segment.id, text.value));
      save.addEventListener('click', () => void persistDraft(segment, text, textField.error, false));
      submit.addEventListener('click', () => void persistDraft(segment, text, textField.error, true, submit));
      text.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void persistDraft(segment, text, textField.error, true, submit);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          drafts.set(segment.id, text.value);
          closeInspector();
          focusSegment(segment.id);
        }
      });
      container.append(textField.row, el('div', { class: 'dialog-actions' }, [save, submit]));
      if (focusText) {
        text.focus();
        text.setSelectionRange(text.value.length, text.value.length);
      }
    }

    if (own !== null && own.state === 'submitted' && may(role, 'decide') && !isAuthor) {
      const approve = el('button', { type: 'button', class: 'button button-primary', text: 'Approve correction' });
      const note = el('input', { type: 'text', id: 'return-note', 'aria-label': 'Return note', class: 'input' });
      const noteField = field('Return note', note, 'return-note-error');
      const returnButton = el('button', { type: 'button', class: 'button', text: 'Return correction' });
      approve.addEventListener('click', () => void decide('approve', own.id, approve, note, noteField.error));
      returnButton.addEventListener('click', () =>
        void decide('return', own.id, returnButton, note, noteField.error),
      );
      container.append(approve, noteField.row, returnButton);
    }

    if (!wide) {
      const close = el('button', { type: 'button', class: 'button', text: 'Close inspector' });
      close.addEventListener('click', () => {
        closeInspector();
        focusSegment(segment.id);
      });
      container.append(close);
    }
  };

  const persistDraft = async (
    segment: SegmentView,
    text: HTMLTextAreaElement,
    error: HTMLElement,
    thenSubmit: boolean,
    submitButton?: HTMLButtonElement,
  ): Promise<void> => {
    showFieldError(text, error, null);
    if (submitButton !== undefined) {
      submitButton.disabled = true;
      submitButton.textContent = 'Submitting';
    }
    const open = segment.open_correction;
    try {
      let correctionId: string;
      if (open !== null && open.author_id === identity.user.id && open.state === 'draft') {
        await request(`/api/corrections/${open.id}`, { method: 'PATCH', json: { text: text.value } });
        correctionId = open.id;
      } else if (open !== null && open.author_id !== identity.user.id) {
        reviewStatus.set(reviewCopy.correctionOpen);
        return;
      } else {
        const created = await request<{ correction: CorrectionView }>(
          `/api/sessions/${sessionId}/segments/${segment.id}/corrections`,
          { method: 'POST', json: { text: text.value } },
        );
        correctionId = created.correction.id;
      }
      if (!thenSubmit) {
        reviewStatus.set(reviewCopy.draftSaved);
        await refreshTranscript();
        return;
      }
      await request(`/api/corrections/${correctionId}/submit`, { method: 'POST' });
      drafts.delete(segment.id);
      reviewStatus.set(reviewCopy.submitted);
      await refreshTranscript();
      afterSubmit(segment.id);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.fields.text !== undefined) {
        showFieldError(text, error, failure.fields.text);
        reviewStatus.set(fieldCopy.correctionText);
      } else if (failure instanceof ApiFailure && failure.code === 'correction_open')
        reviewStatus.set(reviewCopy.correctionOpen);
      else reviewStatus.set(genericFailure);
    } finally {
      if (submitButton !== undefined) {
        submitButton.disabled = false;
        submitButton.textContent = 'Submit for approval';
      }
    }
  };

  const afterSubmit = (segmentId: string): void => {
    if (!wide) closeInspector();
    const flagged = flaggedIds();
    const position = flagged.indexOf(segmentId);
    const next = position >= 0 && position + 1 < flagged.length ? flagged[position + 1] : segmentId;
    if (next === undefined) return;
    selected = next;
    focusSegment(next);
    if (wide) openInspector(next, false);
  };

  const decide = async (
    action: 'approve' | 'return',
    correctionId: string,
    button: HTMLButtonElement,
    note: HTMLInputElement,
    noteError: HTMLElement,
  ): Promise<void> => {
    const original = button.textContent ?? '';
    button.disabled = true;
    button.textContent = action === 'approve' ? 'Approving' : 'Returning';
    showFieldError(note, noteError, null);
    try {
      if (action === 'approve') {
        const reply = await request<{ segment: SegmentView; wer: number | null }>(
          `/api/corrections/${correctionId}/approve`,
          { method: 'POST' },
        );
        reviewStatus.set(reviewCopy.approved);
        applyCorrection(reply.segment, reply.wer);
        await refreshTranscript();
      } else {
        const reply = await request<{ correction: CorrectionView }>(`/api/corrections/${correctionId}/return`, {
          method: 'POST',
          json: { note: note.value },
        });
        reviewStatus.set(reviewCopy.returned(reply.correction.author.name));
        await refreshTranscript();
      }
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'own_correction')
        reviewStatus.set(reviewCopy.ownCorrection);
      else if (failure instanceof ApiFailure && failure.code === 'invalid_transition')
        reviewStatus.set(reviewCopy.alreadyDecided);
      else if (failure instanceof ApiFailure && failure.fields.note !== undefined)
        showFieldError(note, noteError, failure.fields.note);
      else reviewStatus.set(genericFailure);
    } finally {
      button.disabled = false;
      button.textContent = original;
      button.focus();
    }
  };

  const playSegment = async (segmentId: string): Promise<void> => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/segments/${segmentId}/audio`, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        if (response.status === 503) {
          serviceStatus.noteStorageFailure();
          reviewStatus.set(serviceCopy.storageOutage);
        } else reviewStatus.set(genericFailure);
        return;
      }
      serviceStatus.noteStorageSuccess();
      const audio = new Audio(URL.createObjectURL(await response.blob()));
      await audio.play().catch(() => undefined);
    } catch {
      serviceStatus.noteStorageFailure();
      reviewStatus.set(serviceCopy.storageOutage);
    }
  };

  const closeInspector = (): void => {
    if (sheet !== null) {
      const handle = sheet;
      sheet = null;
      handle.close();
      return;
    }
    if (wide) renderEmptyInspector();
  };

  const renderEmptyInspector = (): void => {
    clear(inspectorRegion);
    inspectorRegion.hidden = false;
    inspectorRegion.append(el('p', { class: 'inspector-empty', text: reviewCopy.emptyPrompt }));
  };

  /** Below 1200 px the permanent region is gone; the inspector is a dialog sheet instead. */
  const hidePermanentInspector = (): void => {
    clear(inspectorRegion);
    inspectorRegion.hidden = true;
  };

  const openInspector = (segmentId: string, focusText: boolean): void => {
    const segment = segments.find((entry) => entry.id === segmentId);
    if (segment === undefined) return;
    selected = segmentId;
    renderConfidenceTable();
    if (wide) {
      if (sheet !== null) {
        const handle = sheet;
        sheet = null;
        handle.close();
      }
      inspectorRegion.hidden = false;
      buildInspector(inspectorRegion, segment, focusText);
      return;
    }
    if (sheet !== null) {
      buildInspector(sheet.body, segment, focusText);
      return;
    }
    sheet = openDialog(
      'Segment inspector',
      (handle) => buildInspector(handle.body, segment, focusText),
      { sheet: true, onClose: () => (sheet = null) },
    );
  };

  const refreshTranscript = async (): Promise<void> => {
    const reply = await request<TranscriptReply>(`/api/sessions/${sessionId}/transcript`);
    segments = reply.segments;
    wer = reply.wer;
    renderSegments();
    renderRibbon();
    renderConfidenceTable();
    applyStats();
    if (selected !== null && (wide || sheet !== null)) {
      const segment = segments.find((entry) => entry.id === selected);
      if (segment !== undefined && document.activeElement?.id !== 'corrected-text')
        buildInspector(wide ? inspectorRegion : (sheet as DialogHandle).body, segment, false);
    }
  };

  const onKeydown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.id === 'corrected-text' || target.id === 'return-note')) return;
    const insideTranscript = target instanceof Node && (transcript.contains(target) || inspectorRegion.contains(target));
    const insideSheet = target instanceof Node && sheet !== null && sheet.node.contains(target);
    if (!insideTranscript && !insideSheet) return;
    if (!wide && sheet !== null && (event.key === 'j' || event.key === 'J' || event.key === 'k' || event.key === 'K'))
      return;
    const key = event.key.toLowerCase();
    if (key === 'j') {
      event.preventDefault();
      moveFlagged(1);
    } else if (key === 'k') {
      event.preventDefault();
      moveFlagged(-1);
    } else if (key === 'e' || (event.key === 'Enter' && target instanceof HTMLElement && target.dataset.segmentId !== undefined)) {
      const segmentId = target instanceof HTMLElement ? target.dataset.segmentId ?? selected : selected;
      if (segmentId === null || segmentId === undefined) return;
      event.preventDefault();
      openInspector(segmentId, true);
    } else if (key === 'p') {
      const segmentId = target instanceof HTMLElement ? target.dataset.segmentId ?? selected : selected;
      if (segmentId === null || segmentId === undefined) return;
      event.preventDefault();
      void playSegment(segmentId);
    }
  };
  document.addEventListener('keydown', onKeydown);
  requestAnimationFrame(() => runMorph(sessionId, fieldHeader));

  const applyBreakpoint = (): void => {
    const next = window.matchMedia(WIDE).matches;
    if (next === wide) return;
    wide = next;
    if (sheet !== null) {
      const handle = sheet;
      sheet = null;
      handle.close();
    }
    if (wide) {
      if (selected !== null) openInspector(selected, false);
      else renderEmptyInspector();
    } else hidePermanentInspector();
  };
  const breakpoint = window.matchMedia(WIDE);
  breakpoint.addEventListener('change', applyBreakpoint);

  const connect = (): void => {
    stream = new EventSource(`/api/sessions/${sessionId}/events`);
    stream.addEventListener('state', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        state: SessionState;
        close_reason: SessionView['close_reason'];
      };
      applySessionState(payload.state, payload.close_reason);
    });
    stream.addEventListener('frame', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        frame: number;
        audio_ms: number;
        peak_bin: number;
        bins: number[];
      };
      fieldComponent.setFrame(payload.frame, payload.peak_bin, payload.bins);
      if (session !== null) session = { ...session, audio_ms: payload.audio_ms, frame: payload.frame };
      applyStats();
    });
    stream.addEventListener('segment', (event) => {
      upsertSegment(JSON.parse((event as MessageEvent<string>).data) as SegmentView);
      renderSegments();
      renderRibbon();
      applyStats();
    });
    stream.addEventListener('correction', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        segment: SegmentView;
        wer: number | null;
      };
      applyCorrection(payload.segment, payload.wer);
    });
    stream.addEventListener('quota', (event) => {
      quota = JSON.parse((event as MessageEvent<string>).data) as Quota;
      applyStats();
    });
  };

  const boot = async (): Promise<void> => {
    try {
      const reply = await request<{ session: SessionView }>(`/api/sessions/${sessionId}`);
      session = reply.session;
    } catch {
      navigate('/console/projects', { replace: true });
      return;
    }
    setText(headerLabel, session.label || 'Untitled session');
    applySessionState(session.state, session.close_reason);
    await refreshTranscript().catch(() => undefined);
    if (wide && selected === null) renderEmptyInspector();
    else if (selected !== null) openInspector(selected, false);
    else if (!wide) hidePermanentInspector();
    void request<{ project: { quota: Quota } }>(`/api/projects/${session.project_id}`)
      .then((project) => {
        quota = project.project.quota;
        applyStats();
      })
      .catch(() => undefined);
    applyStats();
    connect();
  };
  void boot();

  return {
    node,
    destroy: () => {
      document.removeEventListener('keydown', onKeydown);
      breakpoint.removeEventListener('change', applyBreakpoint);
      stream?.close();
      fieldComponent.destroy();
      if (sheet !== null) sheet.close();
    },
  };
};
