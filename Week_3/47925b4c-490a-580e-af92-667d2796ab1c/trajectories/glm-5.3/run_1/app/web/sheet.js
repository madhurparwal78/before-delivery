// The artist's sheet page: circuits, link and masks (DP-38 to DP-49).

import { h, clear, announce, showProblem, hideProblem, statusRegion, COPY } from './ui.js';
import { api, idempotencyKey, subscribe } from './app.js';
import { route } from './main.js';

export async function renderSheet(shell, band, sheetId) {
  const sheet = await api.get(`/api/sheets/${sheetId}`);
  shell.append(nav('/sites'));

  const heading = h('h1', { class: 'sentence' });
  const slot = h('span', { class: 'slot', 'aria-hidden': 'true' }, 'issued');
  heading.append(`THIS SHEET IS ${sheet.status.toUpperCase()}`, slot);
  shell.append(heading);

  const evidence = h('div', { class: 'two-col' });
  const left = h('div');
  const right = h('div');

  const circuits = h('ul', { 'aria-label': 'Circuits', role: 'list' });
  for (const circuit of sheet.circuits) {
    circuits.append(h('li', { role: 'listitem' },
      `${circuit.name} ${circuit.kind} ${circuit.loadWatts} W of ${circuit.capacityWatts} W`,
      circuit.live ? ' live' : ''));
  }
  left.append(circuits);

  const pdf = h('a', { href: `/api/sheets/${sheetId}/pdf`, target: '_blank' }, 'Open the PDF');
  const linkField = h('input', { type: 'text', 'readonly': 'readonly', 'aria-label': 'Technician link', value: sheet.techUrl ? window.location.origin + sheet.techUrl : '' });
  const newLink = h('button', {
    onclick: async () => {
      hideProblem(band);
      try {
        const fresh = await api.post(`/api/sheets/${sheetId}/link`);
        linkField.value = window.location.origin + fresh.techUrl;
        route(window.location.pathname);
      } catch (err) {
        showProblem(band, err.problem ?? err);
      }
    },
  }, 'New link');
  const endLink = h('button', {
    onclick: async () => {
      await api.delete(`/api/sheets/${sheetId}/link`);
      linkField.value = '';
      route(window.location.pathname);
    },
  }, 'End link');
  const withdraw = h('button', {
    onclick: async () => {
      hideProblem(band);
      try {
        await api.post(`/api/sheets/${sheetId}/withdraw`);
        route(window.location.pathname);
      } catch (err) {
        showProblem(band, err.problem ?? err);
      }
    },
  }, 'Withdraw sheet');
  right.append(pdf, h('div', {}, h('label', {}, 'Technician link'), linkField), h('div', { class: 'row' }, newLink, endLink, withdraw));

  // masks
  const masksStatus = statusRegion('Masks');
  const bar = h('div', { class: 'progressbar', role: 'progressbar', 'aria-label': 'Mask bundle' }, h('div', { style: 'width:0%' }));
  const build = h('button', {
    onclick: async () => {
      hideProblem(band);
      try {
        const job = await api.post(`/api/layouts/${sheet.layoutId}/mask-jobs`, {}, { headers: { 'Idempotency-Key': idempotencyKey('mask', sheet.layoutId + sheet.layoutHash) } });
        currentJob = job;
        cancel.hidden = false;
      } catch (err) {
        showProblem(band, err.problem ?? err);
      }
    },
  }, 'Build masks');
  const cancel = h('button', { hidden: true, onclick: async () => {
    if (currentJob === null) return;
    try {
      await api.delete(`/api/mask-jobs/${currentJob.id}`);
    } catch (err) {
      showProblem(band, err.problem ?? err);
    }
  } }, 'Cancel masks');
  let currentJob = null;
  const download = h('a', { href: '', hidden: true }, 'Download masks');
  right.append(h('div', {}, h('div', { class: 'row' }, build, cancel), bar, masksStatus, download));

  const pollMasks = setInterval(async () => {
    if (currentJob === null) return;
    try {
      const job = await api.get(`/api/mask-jobs/${currentJob.id}`);
      if (job.phase === 'done') {
        announce(masksStatus, COPY.masksProgress('done', job.stepsDone, job.stepsTotal));
        bar.firstChild.style.width = '100%';
        download.href = `/api/mask-jobs/${currentJob.id}/bundle`;
        download.hidden = false;
        cancel.hidden = true;
        clearInterval(pollMasks);
      } else if (job.phase === 'waiting_for_store') {
        announce(masksStatus, COPY.masksStoreDown);
      } else {
        announce(masksStatus, COPY.masksProgress(job.phase, job.stepsDone, job.stepsTotal));
        bar.firstChild.style.width = `${(100 * job.stepsDone) / job.stepsTotal}%`;
      }
    } catch {
      clearInterval(pollMasks);
    }
  }, 1500);

  evidence.append(left, right);
  shell.append(evidence);

  subscribe((event) => {
    if (event.type === 'sheet.changed' && event.aggregateId === sheetId) {
      route(window.location.pathname);
    }
    if (event.type === 'circuit.confirmed' && event.aggregateId === sheetId) {
      route(window.location.pathname);
    }
    if (event.type === 'mask_job.changed' && currentJob && event.aggregateId === currentJob.id) {
      // the poll loop also picks this up
    }
  });
}

function nav(current) {
  const links = [
    { href: '/sites', label: 'Walls' },
    { href: '/kit', label: 'Shelf' },
    { href: '/hire', label: 'Hire' },
  ];
  return h('nav', { class: 'landmark', 'aria-label': 'Workspace' },
    links.map((link) => h('a', { href: link.href, 'data-link': '', 'aria-current': link.href === current ? 'page' : null }, link.label)));
}
