// The session detail workspace: ribbon, field, stat strip, transcript, inspector.

import { el, getJson, navigate, statusRegion, setStatus, clear, prefersReducedMotion, isWide, uuid } from './lib';
import { renderConsoleShell, fetchAudio, markStorageFailure, markStorageSuccess } from './console';
import { consumeMorphSource } from './console-pages';
import { createSessionField, type FieldHandle, type FieldRow } from './field';
import type { Correction, Quota, Segment, Session, SessionState, User } from '../src-shared/protocol';
import { sessionStatusCopy, quotaHaltCopy, REVIEW_STATUS } from '../src-shared/copy';
import { confidenceBand } from '../src-shared/vtt';
import { formatBillableMinutes } from '../src-shared/billing';

export async function renderSessionDetail(sessionId: string, openSegmentId: string | null): Promise<void> {
  await renderConsoleShell(async (me) => {
    const section = el('section', { class: 'session-detail', 'aria-label': 'Session detail' });

    // ---------- data ----------
    let session: Session;
    try {
      const res = await getJson<{ session: Session }>(`/api/sessions/${sessionId}`);
      session = res.session;
    } catch {
      await navigate('/console/projects', true);
      return section;
    }
    let transcript: { segments: Segment[]; wer: number | null };
    try {
      transcript = await getJson<{ segments: Segment[]; wer: number | null }>(`/api/sessions/${sessionId}/transcript`);
    } catch {
      transcript = { segments: [], wer: null };
    }
    let quota: Quota | null = null;
    try {
      const q = await getJson<{ project: { quota: Quota } }>(`/api/projects/${session.project_id}`);
      quota = q.project.quota;
    } catch { quota = null; }

    // ---------- ribbon ----------
    const ribbon = el('ol', { class: 'ribbon', 'aria-label': 'Confidence ribbon' });
    const renderRibbon = () => {
      ribbon.textContent = '';
      const words: { text: string; confidence: number }[] = [];
      for (const seg of transcript.segments) for (const w of seg.reviewed.words) words.push({ text: w.text, confidence: w.confidence });
      for (const w of words) {
        const band = confidenceBand(w.confidence);
        const li = el('li', { class: `tile ${band}`, 'data-confidence': w.confidence.toFixed(2), 'data-band': band }, w.text);
        if (band === 'low') li.append(el('span', { class: 'tile-band-label' }, 'low'));
        ribbon.append(li);
      }
    };
    renderRibbon();

    // ---------- field ----------
    const fieldWrap = el('div', { class: 'field-wrap' });
    const fieldHeader = el('div', { class: 'field-header', 'data-morph': sessionId });
    const stateChip = el('span', { class: `badge chip ${session.state === 'live' ? 'live' : ''}` }, session.state.replace('_', ' '));
    const headerLabel = el('span', { class: 'field-header-label' }, session.label || 'Untitled session');
    fieldHeader.append(headerLabel, stateChip);
    const handle = createSessionField('Session field');
    fieldWrap.append(fieldHeader, handle.canvas);

    // The list-to-detail morph.
    const doMorph = () => {
      const morphSource = consumeMorphSource();
      if (prefersReducedMotion() || !morphSource || morphSource.dataMorph !== sessionId) return;
      const src = morphSource.rect;
      const target = fieldHeader.getBoundingClientRect();
      const ghost = el('div', { class: 'morph-ghost', 'data-morph': sessionId });
      ghost.style.position = 'fixed';
      ghost.style.left = `${src.left}px`;
      ghost.style.top = `${src.top}px`;
      ghost.style.width = `${src.width}px`;
      ghost.style.height = `${src.height}px`;
      document.body.append(ghost);
      requestAnimationFrame(() => {
        ghost.style.transition = 'left .4s cubic-bezier(.2,.8,.2,1), top .4s cubic-bezier(.2,.8,.2,1), width .4s cubic-bezier(.2,.8,.2,1), height .4s cubic-bezier(.2,.8,.2,1)';
        ghost.style.left = `${target.left}px`;
        ghost.style.top = `${target.top}px`;
        ghost.style.width = `${target.width}px`;
        ghost.style.height = `${target.height}px`;
      });
      setTimeout(() => ghost.remove(), 450);
    };
    doMorph();

    // ---------- stat strip ----------
    const stats = el('div', { class: 'stat-strip', role: 'region', 'aria-label': 'Session stats' });
    const statQuotaUsed = el('span', { class: 'num' }, quota ? `${(quota.used_seconds / 60).toFixed(2)} / ${quota.limit_minutes} min` : '—');
    const statWer = el('span', { class: 'num' }, transcript.wer === null ? 'n/a' : `${(transcript.wer * 100).toFixed(2)}%`);
    const statAudio = el('span', { class: 'num' }, `${(session.audio_ms / 1000).toFixed(3)} s`);
    const statFrame = el('span', { class: 'num' }, String(session.frame));
    const statPeak = el('span', { class: 'num' }, '0');
    const statChannels = el('span', { class: 'num' }, String(session.channels));
    const statBillable = el('span', { class: 'num' }, session.billable_seconds === null ? '—' : formatBillableMinutes(session.billable_seconds));
    const addStat = (label: string, value: HTMLElement) => {
      const wrap = el('span', { class: 'stat' });
      wrap.append(el('span', { class: 'stat-label' }, label), value);
      stats.append(wrap);
    };
    addStat('Audio', statAudio);
    addStat('Frame', statFrame);
    addStat('Peak bin', statPeak);
    addStat('Channels', statChannels);
    addStat('Billable minutes', statBillable);
    addStat('Quota used', statQuotaUsed);
    addStat('Word error rate', statWer);

    // ---------- session status region ----------
    const sessionStatus = statusRegion('Session status');
    sessionStatus.id = 'session-status';
    // The region already holds the current state's copy when the page loads: that counts as the one announcement.
    setStatus(sessionStatus, sessionStatusCopy(session.state, session.close_reason));

    // ---------- transcript ----------
    const transcriptRegion = el('div', { class: 'transcript', role: 'region', 'aria-label': 'Transcript' });
    const reviewStatus = statusRegion('Review status');
    reviewStatus.id = 'review-status';
    transcriptRegion.append(reviewStatus);
    const segmentList = el('div', { class: 'segment-list' });

    // ---------- state ----------
    let selectedSegment: string | null = null;
    const drafts = new Map<string, string>();
    let currentSession = session;

    const fieldStateFor = (s: SessionState): { display: 'idle' | 'connecting' | 'live' | 'closed' | 'quota_halted'; endState: SessionState } => ({
      display: s === 'connecting' ? 'connecting' : s === 'live' ? 'live' : (s === 'quota_halted' || s === 'revoked') ? 'quota_halted' : 'closed',
      endState: s,
    });

    const setState = (s: SessionState, closeReason: string | null) => {
      currentSession = { ...currentSession, state: s, close_reason: (closeReason ?? null) as Session['close_reason'] };
      handle.setState(fieldStateFor(s));
      stateChip.textContent = s.replace('_', ' ');
      stateChip.className = `badge chip ${s === 'live' ? 'live' : ''}`;
      setStatus(sessionStatus, sessionStatusCopy(s, closeReason));
    };

    // ---------- inspector ----------
    const inspectorRegion = el('div', { class: 'inspector', role: 'region', 'aria-label': 'Segment inspector' });
    let inspectorDialog: HTMLDialogElement | null = null;
    const canEdit = me.user.role === 'reviewer' || me.user.role === 'approver';
    const canDecide = me.user.role === 'approver';

    const renderInspector = async (): Promise<void> => {
      const container = isWide(1200) ? inspectorRegion : (inspectorDialog?.querySelector('.dialog-body') as HTMLElement | null ?? inspectorRegion);
      if (!container) return;
      if (!selectedSegment) {
        // The permanent inspector's empty prompt.
        if (isWide(1200)) {
          container.textContent = '';
          container.append(el('p', { class: 'empty-prompt' }, REVIEW_STATUS.inspectorEmpty));
        }
        return;
      }
      const seg = transcript.segments.find((s) => s.id === selectedSegment);
      if (!seg) return;
      container.textContent = '';

      // Approver controls for submitted corrections by other people.
      const open = seg.open_correction;
      const isAuthor = open?.author_id === me.user.id;
      const isSubmitted = open?.state === 'submitted';
      const isReturned = open?.state === 'returned' && isAuthor;

      const play = el('button', { type: 'button' }, 'Play segment audio');
      const playStatus = el('span');
      play.addEventListener('click', async () => {
        play.disabled = true;
        try {
          const res = await fetchAudio(`/api/sessions/${sessionId}/segments/${seg.id}/audio`);
          if (res.ok) {
            const blob = await res.blob();
            const audio = new Audio(URL.createObjectURL(blob));
            void audio.play();
          } else {
            markStorageFailure();
            setStatus(reviewStatus, 'Something went wrong. Try again.');
          }
        } catch {
          setStatus(reviewStatus, 'Something went wrong. Try again.');
        } finally {
          play.disabled = false;
        }
        void playStatus;
      });

      if (isSubmitted && canDecide && !isAuthor) {
        const approve = el('button', { type: 'button', class: 'accent' }, 'Approve correction');
        const note = el('textarea', { id: 'return-note', rows: '2' });
        const noteError = el('p', { class: 'field-error', hidden: 'true' });
        const ret = el('button', { type: 'button' }, 'Return correction');
        approve.addEventListener('click', async () => {
          approve.disabled = true;
          approve.textContent = 'Approving';
          try {
            const res = await fetch(`/api/corrections/${open!.id}/approve`, { method: 'POST', credentials: 'same-origin' });
            if (res.ok) {
              const data = (await res.json()) as { correction: Correction; segment: Segment; wer: number };
              applyCorrection(data.segment, data.wer);
              setStatus(reviewStatus, REVIEW_STATUS.approved);
              closeInspector();
            } else if (res.status === 403) {
              setStatus(reviewStatus, REVIEW_STATUS.ownCorrection);
              approve.disabled = false;
              approve.textContent = 'Approve correction';
            } else if (res.status === 409) {
              setStatus(reviewStatus, REVIEW_STATUS.alreadyDecided);
              approve.disabled = false;
              approve.textContent = 'Approve correction';
            } else {
              setStatus(reviewStatus, REVIEW_STATUS.generic);
              approve.disabled = false;
              approve.textContent = 'Approve correction';
            }
          } catch {
            setStatus(reviewStatus, REVIEW_STATUS.generic);
            approve.disabled = false;
            approve.textContent = 'Approve correction';
          }
        });
        ret.addEventListener('click', async () => {
          if (!note.value.trim()) {
            noteError.textContent = REVIEW_STATUS.returnNoteError;
            noteError.hidden = false;
            note.setAttribute('aria-invalid', 'true');
            return;
          }
          ret.disabled = true;
          ret.textContent = 'Returning';
          try {
            const res = await fetch(`/api/corrections/${open!.id}/return`, {
              method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ note: note.value }),
            });
            if (res.ok) {
              const data = (await res.json()) as { correction: Correction };
              setStatus(reviewStatus, REVIEW_STATUS.returned(data.correction.author.name));
              await reloadTranscript();
            } else if (res.status === 422) {
              const err = (await res.json()) as { fields?: Record<string, string> };
              noteError.textContent = err.fields?.['note'] ?? REVIEW_STATUS.returnNoteError;
              noteError.hidden = false;
              note.setAttribute('aria-invalid', 'true');
              ret.disabled = false;
              ret.textContent = 'Return correction';
            } else if (res.status === 409) {
              setStatus(reviewStatus, REVIEW_STATUS.alreadyDecided);
              ret.disabled = false;
              ret.textContent = 'Return correction';
            } else {
              setStatus(reviewStatus, REVIEW_STATUS.generic);
              ret.disabled = false;
              ret.textContent = 'Return correction';
            }
          } catch {
            setStatus(reviewStatus, REVIEW_STATUS.generic);
            ret.disabled = false;
            ret.textContent = 'Return correction';
          }
        });
        container.append(el('h3', {}, `Segment ${seg.index + 1}`), play, el('hr', { class: 'hairline' }));
        const nf = el('div', { class: 'field' });
        nf.append(el('label', { for: 'return-note' }, 'Return note'), note, noteError);
        container.append(nf, approve, ret);
        return;
      }

      if (isReturned) {
        const reopen = el('button', { type: 'button', class: 'accent' }, 'Reopen as draft');
        reopen.addEventListener('click', async () => {
          reopen.disabled = true;
          try {
            const res = await fetch(`/api/corrections/${open!.id}/reopen`, { method: 'POST', credentials: 'same-origin' });
            if (res.ok) {
              setStatus(reviewStatus, REVIEW_STATUS.reopened);
              await reloadTranscript();
              await renderInspector();
            }
          } finally {
            reopen.disabled = false;
          }
        });
        container.append(el('h3', {}, `Segment ${seg.index + 1}`), play, el('hr', { class: 'hairline' }), reopen);
        return;
      }

      if (!canEdit) {
        container.append(el('h3', {}, `Segment ${seg.index + 1}`), play, el('hr', { class: 'hairline' }), el('p', {}, seg.reviewed.text));
        return;
      }

      // Editor.
      const corrected = el('textarea', { id: 'corrected-text', rows: '3' }) as HTMLTextAreaElement;
      corrected.value = drafts.get(seg.id) ?? seg.reviewed.text;
      const correctedError = el('p', { class: 'field-error', hidden: 'true' });
      const save = el('button', { type: 'button' }, 'Save draft');
      const submit = el('button', { type: 'button', class: 'accent' }, 'Submit for approval');
      let correctionId: string | null = open?.id ?? null;
      const ensureDraft = async (): Promise<string | null> => {
        if (correctionId) return correctionId;
        const res = await fetch(`/api/sessions/${sessionId}/segments/${seg.id}/corrections`, {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: corrected.value }),
        });
        if (res.status === 201) {
          const data = (await res.json()) as { correction: Correction };
          correctionId = data.correction.id;
          await reloadTranscript();
          return correctionId;
        }
        if (res.status === 409 && correctionOpenBySomeoneElse) {
          setStatus(reviewStatus, REVIEW_STATUS.openConflict);
        }
        return null;
      };
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          if (!correctionId) {
            const id = await ensureDraft();
            if (!id) return;
            setStatus(reviewStatus, REVIEW_STATUS.draftSaved);
          } else {
            const res = await fetch(`/api/corrections/${correctionId}`, {
              method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: corrected.value }),
            });
            if (res.ok) {
              drafts.delete(seg.id);
              setStatus(reviewStatus, REVIEW_STATUS.draftSaved);
            } else if (res.status === 422) {
              correctedError.textContent = REVIEW_STATUS.correctedTextError;
              correctedError.hidden = false;
              corrected.setAttribute('aria-invalid', 'true');
            } else {
              setStatus(reviewStatus, REVIEW_STATUS.generic);
            }
          }
        } finally {
          save.disabled = false;
        }
      });
      submit.addEventListener('click', () => void submitCorrection());
      const submitCorrection = async (): Promise<boolean> => {
        submit.disabled = true;
        submit.textContent = 'Submitting';
        try {
          const text = corrected.value;
          if (correctionId) {
            const patch = await fetch(`/api/corrections/${correctionId}`, {
              method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text }),
            });
            if (!patch.ok) {
              if (patch.status === 422) {
                correctedError.textContent = REVIEW_STATUS.correctedTextError;
                correctedError.hidden = false;
                corrected.setAttribute('aria-invalid', 'true');
              } else setStatus(reviewStatus, REVIEW_STATUS.generic);
              return false;
            }
          } else {
            const res = await fetch(`/api/sessions/${sessionId}/segments/${seg.id}/corrections`, {
              method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text }),
            });
            if (res.status === 201) {
              const data = (await res.json()) as { correction: Correction };
              correctionId = data.correction.id;
            } else {
              if (res.status === 409) setStatus(reviewStatus, REVIEW_STATUS.openConflict);
              else setStatus(reviewStatus, REVIEW_STATUS.generic);
              return false;
            }
          }
          const res2 = await fetch(`/api/corrections/${correctionId}/submit`, { method: 'POST', credentials: 'same-origin' });
          if (res2.ok) {
            drafts.delete(seg.id);
            await reloadTranscript();
            setStatus(reviewStatus, REVIEW_STATUS.submitted);
            closeInspector();
            moveFocusToNextFlagged(seg.id);
            return true;
          }
          if (res2.status === 403) setStatus(reviewStatus, REVIEW_STATUS.ownCorrection);
          else setStatus(reviewStatus, REVIEW_STATUS.generic);
          return false;
        } finally {
          submit.disabled = false;
          submit.textContent = 'Submit for approval';
        }
      };
      // Ctrl/Cmd+Enter submits from inside Corrected text.
      corrected.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault();
          void submitCorrection();
        }
      });
      container.append(el('h3', {}, `Segment ${seg.index + 1}`), play, el('hr', { class: 'hairline' }));
      const cf = el('div', { class: 'field' });
      cf.append(el('label', { for: 'corrected-text' }, 'Corrected text'), corrected, correctedError);
      container.append(cf, save, submit);
      // Focus moves to Corrected text when the editor opens by keyboard.
      if (focusEditorOnRender) { corrected.focus(); focusEditorOnRender = false; }
      corrected.addEventListener('input', () => {
        // An unsaved draft for that segment on this page.
        drafts.set(seg.id, corrected.value);
      });
    };

    let focusEditorOnRender = false;
    let correctionOpenBySomeoneElse = false;

    const closeInspector = () => {
      if (inspectorDialog) {
        closeDialogSafe(inspectorDialog);
        inspectorDialog = null;
      }
    };

    function closeDialogSafe(dlg: HTMLDialogElement): void {
      dlg.close();
      dlg.remove();
    }

    const openInspector = async (segmentId: string) => {
      selectedSegment = segmentId;
      if (isWide(1200)) {
        await renderInspector();
      } else {
        // The inspector opens as a dialog sheet below 1200px.
        const old = document.getElementById('inspector-sheet') as HTMLDialogElement | null;
        if (old) closeDialogSafe(old);
        const dlg = el('dialog', { id: 'inspector-sheet', 'aria-label': 'Segment inspector' }) as HTMLDialogElement;
        const body = el('div', { class: 'dialog-body inspector-body' });
        dlg.append(body);
        dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); onEscapeFromInspector(); });
        document.body.append(dlg);
        inspectorDialog = dlg;
        await renderInspector();
        const closeBtn = el('button', { type: 'button', class: 'close-inspector' }, 'Close inspector');
        closeBtn.addEventListener('click', () => onEscapeFromInspector());
        body.append(closeBtn);
        dlg.showModal();
      }
    };

    const onEscapeFromInspector = () => {
      // The typed text is kept as an unsaved draft; focus returns to the segment's button.
      const seg = selectedSegment;
      closeInspector();
      if (seg) {
        const btn = segmentList.querySelector(`button[data-segment="${seg}"]`) as HTMLButtonElement | null;
        btn?.focus();
      }
    };

    const moveFocusToNextFlagged = (fromId: string) => {
      const flagged = transcript.segments.filter((s) => s.flagged);
      const idx = flagged.findIndex((s) => s.id === fromId);
      const next = flagged.slice(idx + 1)[0] ?? flagged[idx];
      const targetId = next?.id;
      if (targetId) {
        const btn = segmentList.querySelector(`button[data-segment="${targetId}"]`) as HTMLButtonElement | null;
        btn?.focus();
      }
      // At 1200px+, the inspector loads the segment that now has focus.
      if (isWide(1200) && targetId) {
        selectedSegment = targetId;
        void renderInspector();
      }
    };

    const applyCorrection = (segment: Segment, wer: number | null) => {
      // Ribbon tiles, segment text and the WER stat change only from the server's word.
      const idx = transcript.segments.findIndex((s) => s.id === segment.id);
      if (idx >= 0) transcript.segments[idx] = segment;
      renderRibbon();
      renderSegments();
      statWer.textContent = wer === null ? 'n/a' : `${(wer * 100).toFixed(2)}%`;
    };

    const reloadTranscript = async () => {
      transcript = await getJson<{ segments: Segment[]; wer: number | null }>(`/api/sessions/${sessionId}/transcript`);
      correctionOpenBySomeoneElse = transcript.segments.some((s) => s.id === selectedSegment && s.open_correction && s.open_correction.author_id !== me.user.id);
      renderRibbon();
      renderSegments();
      statWer.textContent = transcript.wer === null ? 'n/a' : `${(transcript.wer * 100).toFixed(2)}%`;
    };

    // ---------- segments ----------
    const renderSegments = () => {
      segmentList.textContent = '';
      transcript.segments.forEach((seg, i) => {
        const btn = el('button', { type: 'button', class: `segment${seg.flagged ? ' flagged' : ''}`, 'data-segment': seg.id, 'data-flagged': seg.flagged ? 'true' : 'false' });
        if (seg.flagged) btn.append(el('span', { class: 'flag-label' }, 'Flagged'));
        btn.append(el('span', { class: 'segment-text' }, `Segment ${i + 1}: ${seg.reviewed.text}`));
        btn.addEventListener('click', () => {
          focusEditorOnRender = true;
          void openInspector(seg.id);
        });
        segmentList.append(btn);
      });
    };
    renderSegments();

    // ---------- keyboard review ----------
    segmentList.addEventListener('keydown', (ev) => {
      if (ev.key === 'j' || ev.key === 'J') {
        ev.preventDefault();
        moveFocus(1);
      } else if (ev.key === 'k' || ev.key === 'K') {
        ev.preventDefault();
        moveFocus(-1);
      } else if (ev.key === 'p' || ev.key === 'P') {
        ev.preventDefault();
        playFocused();
      } else if (ev.key === 'e' || ev.key === 'E' || (ev.key === 'Enter' && (ev.target as HTMLElement).tagName === 'BUTTON')) {
        ev.preventDefault();
        const btn = (ev.target as HTMLElement).closest('button[data-segment]') as HTMLButtonElement | null;
        if (btn) {
          focusEditorOnRender = true;
          void openInspector(btn.dataset['segment'] ?? '');
        }
      }
    });

    const moveFocus = (dir: number) => {
      const btns = [...segmentList.querySelectorAll<HTMLButtonElement>('button[data-flagged="true"]')];
      if (btns.length === 0) return;
      const focused = document.activeElement as HTMLButtonElement | null;
      const idx = focused ? btns.indexOf(focused) : -1;
      let next: number;
      if (idx === -1) next = dir === 1 ? 0 : btns.length - 1;
      else {
        next = Math.min(btns.length - 1, Math.max(0, idx + dir));
        if ((dir === 1 && next === idx && idx === btns.length - 1)) next = idx; // at the last flagged segment, focus stays put
      }
      btns[next]?.focus();
    };

    const playFocused = async () => {
      const focused = document.activeElement as HTMLElement | null;
      const btn = focused?.closest('button[data-segment]') as HTMLButtonElement | null;
      if (!btn) return;
      const segId = btn.dataset['segment']!;
      try {
        const res = await fetchAudio(`/api/sessions/${sessionId}/segments/${segId}/audio`);
        if (res.ok) {
          const blob = await res.blob();
          void new Audio(URL.createObjectURL(blob)).play();
        }
      } catch {
        setStatus(reviewStatus, REVIEW_STATUS.generic);
      }
    };

    // ---------- layout ----------
    const leftPane = el('div', { class: 'pane-left' });
    leftPane.append(ribbon, fieldWrap, stats);
    const rightPane = el('div', { class: 'pane-right' });
    rightPane.append(transcriptRegion);
    const workspace = el('div', { class: 'workspace' });
    transcriptRegion.append(segmentList);

    const relayout = () => {
      workspace.textContent = '';
      if (isWide(1200)) {
        workspace.append(leftPane, rightPane, inspectorRegion);
        workspace.className = 'workspace cols-3';
        void renderInspector();
      } else if (isWide(768)) {
        workspace.append(leftPane, rightPane);
        workspace.className = 'workspace cols-2';
      } else {
        workspace.append(leftPane, rightPane);
        workspace.className = 'workspace cols-1';
      }
    };
    relayout();
    const bpListener = () => relayout();
    window.matchMedia('(min-width: 1200px)').addEventListener('change', bpListener);
    window.matchMedia('(min-width: 768px)').addEventListener('change', bpListener);

    // ---------- Stop session ----------
    const controls = el('div', { class: 'detail-controls' });
    if ((me.user.role === 'admin' || me.user.role === 'developer') && isSessionOpen(currentSession.state)) {
      const stop = el('button', { type: 'button' }, 'Stop session');
      stop.addEventListener('click', async () => {
        stop.disabled = true;
        try {
          await fetch(`/api/sessions/${sessionId}/close`, { method: 'POST', credentials: 'same-origin' });
        } finally {
          stop.disabled = false;
        }
      });
      controls.append(stop);
    }

    // ---------- field data ----------
    const loadHistoryAndStream = async () => {
      try {
        const spec = await getJson<{ frame: number; peak_bin: number; rows: number[][] }>(`/api/sessions/${sessionId}/spectrum`);
        const rows: FieldRow[] = spec.rows.map((bins, i) => ({ frame: i, peak_bin: i === spec.rows.length - 1 ? spec.peak_bin : 0, bins }));
        if (rows.length > 0) {
          handle.loadHistory(rows);
          statFrame.textContent = String(spec.frame);
          statPeak.textContent = String(spec.peak_bin);
        }
      } catch { /* field stays flat */ }
      setState(currentSession.state, currentSession.close_reason);
      if (isSessionOpen(currentSession.state)) {
        streamEvents();
      }
    };

    const streamEvents = () => {
      const es = new EventSource(`/api/sessions/${sessionId}/events`);
      es.addEventListener('state', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as { state: SessionState; close_reason: string | null };
        setState(data.state, data.close_reason);
        if (!isSessionOpen(data.state)) {
          es.close();
          // A reload still shows the ended state.
          void refreshSessionRow();
        }
      });
      es.addEventListener('frame', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as FieldRow & { audio_ms: number };
        handle.pushRow({ frame: data.frame, peak_bin: data.peak_bin, bins: data.bins });
        statFrame.textContent = String(data.frame);
        statPeak.textContent = String(data.peak_bin);
        statAudio.textContent = `${(data.audio_ms / 1000).toFixed(3)} s`;
      });
      es.addEventListener('segment', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as { segment: Segment };
        if (!transcript.segments.some((s) => s.id === data.segment.id)) {
          transcript.segments.push(data.segment);
          transcript.segments.sort((a, b) => a.index - b.index);
          renderSegments();
          renderRibbon();
        }
      });
      es.addEventListener('correction', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as { segment: Segment; wer: number };
        applyCorrection(data.segment, data.wer);
      });
      es.addEventListener('quota', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as { quota: Quota };
        statQuotaUsed.textContent = `${(data.quota.used_seconds / 60).toFixed(2)} / ${data.quota.limit_minutes} min`;
      });
      es.onerror = () => {
        es.close();
      };
    };

    const refreshSessionRow = async () => {
      try {
        const res = await getJson<{ session: Session }>(`/api/sessions/${sessionId}`);
        currentSession = res.session;
        statBillable.textContent = res.session.billable_seconds === null ? '—' : formatBillableMinutes(res.session.billable_seconds);
        statAudio.textContent = `${(res.session.audio_ms / 1000).toFixed(3)} s`;
      } catch { /* keep the last known figures */ }
    };

    void loadHistoryAndStream();

    // Deep link ?segment= opens the inspector.
    if (openSegmentId && transcript.segments.some((s) => s.id === openSegmentId)) {
      void openInspector(openSegmentId);
    }

    // ---------- assemble ----------
    const quotaBanner = el('div');
    if (quota?.exhausted) {
      quotaBanner.append(el('div', { class: 'banner', role: 'alert' }, quotaHaltCopy(quota)));
    }
    section.append(quotaBanner, controls, sessionStatus, workspace);
    // Still-fallback confidence table sits beside the field when WebGL is missing.
    if (!hasWebGL()) {
      const tbl = el('table', { class: 'confidence-table', 'aria-label': 'Segment confidence' });
      const thead = el('thead');
      const hr = el('tr');
      for (const h of ['Word', 'Start', 'Confidence']) hr.append(el('th', {}, h));
      thead.append(hr);
      const tbody = el('tbody');
      const refreshTable = () => {
        tbody.textContent = '';
        for (const seg of transcript.segments) {
          for (const w of seg.reviewed.words) {
            const tr = el('tr');
            tr.append(el('td', {}, w.text), el('td', { class: 'num' }, `${w.start_ms}`), el('td', { class: 'num' }, w.confidence.toFixed(2)));
            tbody.append(tr);
          }
        }
      };
      refreshTable();
      tbl.append(thead, tbody);
      const origRibbon = ribbon;
      const syncTable = () => refreshTable();
      void syncTable; void origRibbon;
      section.append(tbl);
    }

    return section;
  }, { navRoute: 'projects' });
}

function isSessionOpen(state: SessionState): boolean {
  return state === 'connecting' || state === 'live';
}

let webglOk: boolean | null = null;
function hasWebGL(): boolean {
  if (webglOk === null) {
    try {
      const c = document.createElement('canvas');
      webglOk = !!c.getContext('webgl');
    } catch {
      webglOk = false;
    }
  }
  return webglOk;
}
