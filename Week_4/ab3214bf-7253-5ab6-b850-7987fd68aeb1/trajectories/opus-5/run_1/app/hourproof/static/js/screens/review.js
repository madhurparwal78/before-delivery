// The sampled-hour review: 25 drawn hours, their evidence, and the signature.

import { get, post, put } from '../api.js';
import { PHONE, currentBand, onBandChange } from '../breakpoints.js';
import { Dialog, field } from '../dialog.js';
import { announce, clear, el, liveRegion, problems } from '../dom.js';
import { commas, percent } from '../format.js';
import { navigate, render } from '../router.js';
import { countdown } from '../timers.js';

export async function mount({ container, params, account }) {
  const windowId = params[0];
  const first = await get(`/api/windows/${windowId}`);
  if (first.status !== 200) {
    container.append(
      el('div', { className: 'panel stack' }, [
        el('h1', { text: 'THAT PAGE DOES NOT EXIST.' }),
      ])
    );
    return {};
  }
  let record = first.data;
  let sample = { hours: [], allocation_digest: '' };
  let chosen = null;
  let pendingResult = false;

  const summary = el('div', {
    role: 'region',
    'aria-label': 'Review summary',
    className: 'panel panel--cyan stack',
  });
  const list = el('ul', {
    role: 'list',
    'aria-label': 'Sampled hours',
    className: 'sampled',
  });
  const evidence = el('div', {
    role: 'region',
    'aria-label': 'Hour evidence',
    className: 'panel panel--white stack',
  });
  const reviewTimer = countdown({
    label: 'Review time left',
    seconds: null,
    reask: () => load(),
  });
  const actions = el('div', { className: 'row' });
  container.append(
    el('div', { className: 'panel panel--cyan stack' }, [
      el('h1', { text: `${record.site.name} ${record.month}` }),
      actions,
    ]),
    el('div', { className: 'review-grid' }, [
      el('div', { className: 'panel panel--white stack' }, [list]),
      evidence,
      summary,
    ]),
    liveRegion('Seal status', 'status')
  );

  // ----------------------------------------------------------------- actions

  const complete = el('button', { type: 'button', text: 'Complete review', hidden: true });
  const returnButton = el('button', { type: 'button', text: 'Return window', hidden: true });
  const signButton = el('button', { type: 'button', text: 'Sign attestation', hidden: true });
  actions.append(complete, returnButton, signButton);

  complete.addEventListener('click', async () => {
    const answer = await post(`/api/windows/${windowId}/review/complete`, {});
    if (answer.cancelled) return;
    if (answer.status !== 200) {
      announce('Desk alert', answer.error ? answer.error.message : '');
      await load();
      return;
    }
    record = answer.data;
    await load();
  });

  returnButton.addEventListener('click', () => {
    const dialog = new Dialog({ name: 'Return window' });
    dialog.node.dataset.formRoot = 'true';
    const reason = field({ label: 'Reason', name: 'reason', multiline: true });
    const send = el('button', { type: 'button', text: 'Send back' });
    const cancel = el('button', { type: 'button', text: 'Cancel' });
    cancel.addEventListener('click', () => dialog.close());
    send.addEventListener('click', async () => {
      const answer = await post(`/api/windows/${windowId}/review/return`, {
        reason: reason.input.value,
      });
      if (answer.cancelled) return;
      if (answer.status !== 200) {
        problems(dialog.problemsRegion, answer.error);
        return;
      }
      record = answer.data;
      dialog.close();
      await load();
    });
    dialog.bodyNode.append(reason.wrap);
    dialog.buttonsNode.append(send, cancel);
  });

  signButton.addEventListener('click', () => {
    const dialog = new Dialog({ name: 'Sign attestation' });
    dialog.node.dataset.formRoot = 'true';
    const typed = field({ label: 'Type your full name', name: 'typed_name' });
    const sign = el('button', { type: 'button', text: 'Sign' });
    const cancel = el('button', { type: 'button', text: 'Cancel' });
    cancel.addEventListener('click', () => dialog.close());
    sign.addEventListener('click', async () => {
      sign.setAttribute('aria-disabled', 'true');
      const answer = await post(`/api/windows/${windowId}/sign`, {
        typed_name: typed.input.value,
      });
      sign.removeAttribute('aria-disabled');
      if (answer.cancelled) return;
      if (answer.status === 200) {
        window.sessionStorage.setItem('hourproof-sealed', answer.data.statement_code);
        dialog.close();
        navigate(answer.data.landing_url);
        return;
      }
      if (answer.status === 202) {
        dialog.close();
        announce('Seal status', answer.data.message);
        held = answer.data;
        paintHeld();
        await load();
        return;
      }
      problems(dialog.problemsRegion, answer.error);
    });
    dialog.bodyNode.append(typed.wrap);
    dialog.buttonsNode.append(sign, cancel);
  });

  let held = null;
  const heldBanner = el('div', { className: 'outage', hidden: true });
  container.prepend(heldBanner);

  function paintHeld() {
    if (!held) {
      heldBanner.hidden = true;
      return;
    }
    heldBanner.hidden = false;
    heldBanner.textContent = held.message;
  }

  // ------------------------------------------------------------------ sample

  function resultCount() {
    return sample.hours.filter((hour) => hour.result !== null).length;
  }

  function paintSummary() {
    clear(summary);
    summary.append(
      el('h3', { text: 'REVIEW SUMMARY.' }),
      el('p', { className: 'word', text: record.state }),
      el('p', { text: sample.allocation_digest }),
      el('p', { text: `${resultCount()} of 25 recorded` }),
      el('p', { text: record.opinion }),
      el('p', { text: `Hour score ${percent(record.scores.hour_bp)}%` })
    );
    if (record.state === 'In review') {
      reviewTimer.set(record.review_seconds_left);
      summary.append(reviewTimer.node);
    }
    complete.hidden = record.state !== 'In review';
    returnButton.hidden = record.state !== 'In review';
    signButton.hidden = record.state !== 'Cancelled';
  }

  const rows = new Map();

  function paintList() {
    // The 25 items are built once and updated in place, so focus never moves.
    const keys = sample.hours.map((hour) => hour.hour_utc);
    const sameShape =
      rows.size === keys.length && keys.every((key) => rows.has(key));
    if (!sameShape) {
      clear(list);
      rows.clear();
      sample.hours.forEach((hour) => {
        const agree = el('button', { type: 'button', text: 'Agree' });
        const exception = el('button', { type: 'button', text: 'Exception' });
        const evidenceButton = el('button', { type: 'button', text: 'Evidence' });
        agree.addEventListener('click', () => recordResult(hour.hour_utc, 'agree'));
        exception.addEventListener('click', () => openException(hour.hour_utc));
        evidenceButton.addEventListener('click', () => showEvidence(hour.hour_utc, true));
        const resultText = el('span', {});
        const item = el('li', { dataset: { hour: hour.hour_utc } }, [
          el('div', { className: 'stack' }, [
            el('strong', { text: hour.hour_utc }),
            el('span', { text: `${commas(hour.consumed_wh || 0)} Wh consumed` }),
            el('span', { text: `${commas(hour.matched_wh)} Wh matched` }),
            resultText,
          ]),
          el('div', { className: 'row' }, [agree, exception, evidenceButton]),
        ]);
        item.addEventListener('keydown', (event) =>
          handleKeys(event, sample.hours.find((row) => row.hour_utc === hour.hour_utc))
        );
        rows.set(hour.hour_utc, { item, resultText });
        list.append(item);
      });
    }
    sample.hours.forEach((hour) => {
      const row = rows.get(hour.hour_utc);
      row.resultText.textContent = hour.result ? hour.result : 'no result';
    });
  }

  function handleKeys(event, hour) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const item = event.currentTarget;
    const items = Array.from(list.children);
    const index = items.indexOf(item);
    const name = document.activeElement?.textContent;
    if (event.key === 'y') {
      event.preventDefault();
      recordResult(hour.hour_utc, 'agree', { advance: true });
      return;
    }
    if (event.key === 'x') {
      event.preventDefault();
      openException(hour.hour_utc);
      return;
    }
    if (event.key === 'n' || event.key === 'p') {
      event.preventDefault();
      const target = items[index + (event.key === 'n' ? 1 : -1)];
      if (!target) return;
      const button = Array.from(target.querySelectorAll('button')).find(
        (candidate) => candidate.textContent === name
      );
      if (button) button.focus();
    }
  }

  async function recordResult(hourUtc, result, { advance = false, note = null } = {}) {
    if (pendingResult) return;
    pendingResult = true;
    const answer = await put(`/api/windows/${windowId}/sample/${hourUtc}`, {
      result,
      ...(note === null ? {} : { note }),
    });
    pendingResult = false;
    if (answer.cancelled) return answer;
    if (answer.status !== 200) {
      announce('Desk alert', answer.error ? answer.error.message : '');
      return answer;
    }
    const row = sample.hours.find((hour) => hour.hour_utc === hourUtc);
    row.result = answer.data.result;
    row.note = answer.data.note;
    const count = resultCount();
    paintSummary();
    paintList();
    announce('Desk status', count === 25 ? 'All 25 hours recorded.' : `${count} of 25 recorded.`);
    if (advance) moveToNextWithout(hourUtc);
    return answer;
  }

  function moveToNextWithout(fromHour) {
    const order = sample.hours;
    const start = order.findIndex((hour) => hour.hour_utc === fromHour);
    for (let step = 1; step <= order.length; step += 1) {
      const candidate = order[(start + step) % order.length];
      if (candidate.result === null) {
        const item = list.querySelector(`li[data-hour="${candidate.hour_utc}"]`);
        const button = item?.querySelector('button');
        if (button) button.focus();
        return;
      }
    }
    complete.focus();
  }

  function openException(hourUtc) {
    const dialog = new Dialog({ name: 'Record exception' });
    dialog.node.dataset.formRoot = 'true';
    const note = field({ label: 'Exception note', name: 'note', multiline: true });
    const save = el('button', { type: 'button', text: 'Save exception' });
    const cancel = el('button', { type: 'button', text: 'Cancel' });
    cancel.addEventListener('click', () => dialog.close());
    save.addEventListener('click', async () => {
      const answer = await recordResult(hourUtc, 'exception', { note: note.input.value });
      if (!answer || answer.status !== 200) {
        problems(dialog.problemsRegion, answer ? answer.error : null);
        return;
      }
      dialog.close();
    });
    dialog.bodyNode.append(note.wrap);
    dialog.buttonsNode.append(save, cancel);
  }

  // ---------------------------------------------------------------- evidence

  const hideEvidence = el('button', { type: 'button', text: 'Hide evidence' });
  hideEvidence.addEventListener('click', () => {
    evidence.hidden = true;
    const item = list.querySelector(`li[data-hour="${chosen}"]`);
    const button = item
      ? Array.from(item.querySelectorAll('button')).find(
          (candidate) => candidate.textContent === 'Evidence'
        )
      : null;
    if (button) button.focus();
  });

  function showEvidence(hourUtc, moveFocus = false) {
    chosen = hourUtc;
    const hour = sample.hours.find((row) => row.hour_utc === hourUtc);
    if (!hour) return;
    clear(evidence);
    evidence.append(
      el('h3', { text: 'HOUR EVIDENCE.' }),
      el('p', { text: `${hour.hour_utc} UTC` }),
      el('p', { text: localLabel(hour.hour_utc) }),
      el('p', { text: `Consumed ${commas(hour.consumed_wh || 0)} Wh` }),
      el('p', { text: `Matched ${commas(hour.matched_wh)} Wh` }),
      el('p', { text: hour.quality })
    );
    hour.lines.forEach((line) =>
      evidence.append(
        el('p', {
          text:
            `${line.lot_name} ${commas(line.wh)} Wh, range ${commas(line.range_start_wh)}` +
            ` to ${commas(line.range_end_wh)}, ${line.status}`,
        })
      )
    );
    if (currentBand() === PHONE) {
      evidence.hidden = false;
      evidence.append(hideEvidence);
      if (moveFocus) hideEvidence.focus();
    }
  }

  function localLabel(hourUtc) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: record.site.time_zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(hourUtc)).map((part) => [part.type, part.value])
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:00 local`;
  }

  onBandChange((next) => {
    if (next === PHONE) {
      evidence.hidden = true;
      const item = list.querySelector(`li[data-hour="${chosen}"]`);
      const button = item
        ? Array.from(item.querySelectorAll('button')).find(
            (candidate) => candidate.textContent === 'Evidence'
          )
        : null;
      if (button && document.activeElement === hideEvidence) button.focus();
    } else {
      evidence.hidden = false;
      if (hideEvidence.isConnected) hideEvidence.remove();
      if (chosen) showEvidence(chosen);
    }
  });

  async function load() {
    const [windowAnswer, sampleAnswer] = await Promise.all([
      get(`/api/windows/${windowId}`),
      get(`/api/windows/${windowId}/sample`),
    ]);
    if (windowAnswer.status === 404) {
      render();
      return;
    }
    if (windowAnswer.status === 200) record = windowAnswer.data;
    if (sampleAnswer.status === 200) sample = sampleAnswer.data;
    if (record.seal_status === 'sealed' && record.statement_code && held) {
      window.sessionStorage.setItem('hourproof-sealed', record.statement_code);
      navigate(`/check/${record.statement_code}`);
      return;
    }
    paintSummary();
    paintList();
    if (!chosen && sample.hours.length) chosen = sample.hours[0].hour_utc;
    if (chosen) showEvidence(chosen);
    if (currentBand() === PHONE) evidence.hidden = true;
  }

  await load();
  return { refresh: load };
}
