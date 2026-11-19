/**
 * The router and the screens outside the ticket workspace.
 */

import { api, ApiFailure, live, type LiveMessage } from './lib/api';
import { copy, countdownText, percentText, type SlaView } from './lib/copy';
import { animate, button, el, focus, link, section, selectBox, timings } from './lib/dom';
import { chartFor, heroPortraits, portraitFor } from './lib/portraits';
import {
  announce,
  bodyHostOf,
  dropScreenListeners,
  drawerLinks,
  hasRole,
  homeScreen,
  installRegionKeys,
  loadChrome,
  loadSession,
  mount,
  navigate,
  notFoundScreen,
  onLive,
  openDialog,
  openDrawer,
  pin,
  restSection,
  screenOutcome,
  signedIn,
  state,
  stateScreen,
} from './lib/shell';
import {
  loadReferenceOptions,
  renderWorkspace,
  slaRegion,
  startTicking,
  type RecordSummary,
  type RecordView,
} from './screens/desk';

let refreshChrome: () => void = () => undefined;

/** The hero poster: the giant name on the orange field over six portraits. */
function renderLanding(host: HTMLElement): void {
  const hero = el('div', { class: 'hero' }, [
    el('h1', { class: 'display hero-name' }, ['SWITCHYARD']),
    el(
      'div',
      { class: 'portraits' },
      heroPortraits.map((portrait) =>
        el('img', { src: portraitFor(portrait.name), alt: portrait.alt, width: '160', height: '240' }),
      ),
    ),
    el('div', { class: 'hero-foot' }, [
      el('p', {}, [copy.tagline]),
      link(copy.openDesk, signedIn() ? homeScreen() : '/login', { class: 'block' }),
    ]),
  ]);
  host.replaceChildren(hero);
}

function renderSignIn(host: HTMLElement): void {
  const username = el('input', { type: 'text', 'aria-label': 'Username' }) as HTMLInputElement;
  const password = el('input', { type: 'password', id: 'password-field' }) as HTMLInputElement;
  const errorHost = section();
  const submit = button('Sign in', { class: 'block' });

  const signIn = (): void => {
    submit.textContent = copy.signingIn;
    void api
      .post('/api/session', { username: username.value, password: password.value })
      .then(async () => {
        await loadSession();
        await loadChrome();
        refreshChrome();
        navigate(homeScreen());
      })
      .catch(() => {
        errorHost.replaceChildren(el('p', {}, [copy.signInFailed]));
        announce(copy.signInFailed);
      })
      .finally(() => {
        submit.textContent = 'Sign in';
      });
  };
  submit.addEventListener('click', signIn);
  for (const field of [username, password]) {
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        signIn();
      }
    });
  }

  host.replaceChildren(
    pin('Sign in'),
    restSection([
      el('div', { class: 'narrow' }, [
        el('div', { class: 'field' }, [el('label', { for: 'username-field' }, ['Username']), username]),
        el('div', { class: 'field' }, [el('label', { for: 'password-field' }, ['Password']), password]),
        errorHost,
        submit,
      ]),
    ]),
  );
  username.id = 'username-field';
  focus(username);
}

interface MapNode {
  name: string;
  class: string;
  status: string;
  status_label: string;
  layer: number;
  x: number;
  y: number;
}

/** The service map with its published layered coordinates and node keyboard. */
async function renderMap(host: HTMLElement): Promise<void> {
  const response = await api.get<{ nodes: MapNode[]; edges: { source: string; type: string; target: string }[] }>(
    '/api/service-map',
  );
  const canvas = el('div', { class: 'map-canvas' });
  const inner = el('div', { class: 'map-inner', role: 'group', 'aria-label': 'Service map' });
  const width = Math.max(...response.nodes.map((n) => n.x + 200), 400);
  const height = Math.max(...response.nodes.map((n) => n.y + 160), 400);
  inner.style.width = `${width}px`;
  inner.style.height = `${height}px`;

  const details = el('div', { class: 'details' });
  let expanded: string | null = null;

  const showDetails = async (name: string): Promise<void> => {
    const ci = await api.get<{ ci: { name: string; class: string; effective_status: string } }>(
      `/api/cis/${encodeURIComponent(name)}`,
    );
    const region = el('div', { role: 'region', 'aria-label': `${name} details` }, [
      el('h3', {}, [name]),
      el('p', { class: 'status' }, [ci.ci.effective_status]),
    ]);
    if (hasRole('operator', 'technician')) {
      for (const [label, status] of [
        ['Mark down', 'down'],
        ['Mark degraded', 'degraded'],
        ['Mark healthy', 'healthy'],
      ] as const) {
        const mark = button(label);
        mark.addEventListener('click', () => {
          void api
            .post(`/api/cis/${encodeURIComponent(name)}/status`, { status })
            .then(() => renderMap(host))
            .catch(() => undefined);
        });
        region.append(mark);
      }
    }
    if (hasRole('operator')) {
      const addItem = button('Add item');
      addItem.addEventListener('click', () => openAddItemDialog(() => void renderMap(host)));
      const addRelationship = button('Add relationship');
      addRelationship.addEventListener('click', () =>
        openAddRelationshipDialog(response.nodes.map((n) => n.name), () => void renderMap(host)),
      );
      const maintenance = button('Schedule maintenance');
      maintenance.addEventListener('click', () => openMaintenanceDialog(name, () => void renderMap(host)));
      region.append(addItem, addRelationship, maintenance);
    }
    details.replaceChildren(region);
    // The details region grows from the node's height to its full height.
    animate(region, [{ height: '64px', overflow: 'hidden' }, { height: `${region.scrollHeight}px` }], timings.settle);
  };

  const rows = new Map<number, MapNode[]>();
  for (const node of response.nodes) {
    const list = rows.get(node.y) ?? [];
    list.push(node);
    rows.set(node.y, list);
  }
  const rowKeys = [...rows.keys()].sort((a, b) => a - b);

  for (const node of response.nodes) {
    const nodeButton = button(`${node.name}, ${node.class}, ${node.status_label}`, {
      class: 'map-node',
      dataX: String(node.x),
      dataY: String(node.y),
      dataName: node.name,
    });
    nodeButton.style.left = `${node.x}px`;
    nodeButton.style.top = `${node.y}px`;
    nodeButton.addEventListener('click', () => {
      expanded = expanded === node.name ? null : node.name;
      if (expanded) void showDetails(node.name);
      else details.replaceChildren();
    });
    nodeButton.addEventListener('keydown', (event) => {
      const row = rows.get(node.y) ?? [];
      const sorted = [...row].sort((a, b) => a.x - b.x);
      const index = sorted.findIndex((n) => n.name === node.name);
      const go = (target: MapNode | undefined): void => {
        if (!target) return;
        event.preventDefault();
        focus(inner.querySelector<HTMLElement>(`[data-name="${CSS.escape(target.name)}"]`));
      };
      switch (event.key) {
        case 'ArrowLeft':
          go(sorted[index - 1]);
          return;
        case 'ArrowRight':
          go(sorted[index + 1]);
          return;
        case 'Home':
          go(sorted[0]);
          return;
        case 'End':
          go(sorted[sorted.length - 1]);
          return;
        case 'ArrowUp':
        case 'ArrowDown': {
          const rowIndex = rowKeys.indexOf(node.y);
          const nextY = rowKeys[rowIndex + (event.key === 'ArrowDown' ? 1 : -1)];
          if (nextY === undefined) return;
          const candidates = [...(rows.get(nextY) ?? [])].sort((a, b) => a.x - b.x);
          // Ties go to the node further left.
          let best = candidates[0];
          let bestGap = Number.POSITIVE_INFINITY;
          for (const candidate of candidates) {
            const gap = Math.abs(candidate.x - node.x);
            if (gap < bestGap) {
              bestGap = gap;
              best = candidate;
            }
          }
          go(best);
          return;
        }
        case 'Enter':
          event.preventDefault();
          expanded = expanded === node.name ? null : node.name;
          if (expanded) void showDetails(node.name);
          else details.replaceChildren();
          return;
        default:
          return;
      }
    });
    inner.append(nodeButton);
  }
  canvas.append(inner);

  host.replaceChildren(
    pin('Service map'),
    restSection([el('div', { class: 'map-layout' }, [canvas, details])]),
  );
}

function openAddItemDialog(onDone: () => void): void {
  openDialog({ label: 'Add item' }, (dialog) => {
    const name = el('input', { type: 'text', 'aria-label': 'Name' }) as HTMLInputElement;
    const className = selectBox(
      'Class',
      [
        'Configuration item',
        'Business service',
        'Application',
        'Server',
        'Virtual server',
        'Cluster',
        'Network device',
        'Storage',
      ].map((value) => ({ value, label: value })),
      'Application',
    );
    const add = button('Add', { class: 'block' });
    add.addEventListener('click', () => {
      void api
        .post('/api/cis', { name: name.value, class: className.value, criticality: 2 })
        .then(() => {
          dialog.close();
          onDone();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) announce(error.message);
        });
    });
    dialog.body.append(
      el('div', { class: 'field' }, [el('label', {}, ['Name']), name]),
      el('div', { class: 'field' }, [el('label', {}, ['Class']), className]),
      add,
    );
  });
}

function openAddRelationshipDialog(names: readonly string[], onDone: () => void): void {
  openDialog({ label: 'Add relationship' }, (dialog) => {
    const options = names.map((value) => ({ value, label: value }));
    const from = selectBox('From', options, options[0]?.value ?? null);
    const type = selectBox(
      'Type',
      ['depends on', 'runs on', 'hosted by', 'member of', 'connects to', 'backs up'].map((value) => ({
        value,
        label: value,
      })),
      'depends on',
    );
    const to = selectBox('To', options, options[1]?.value ?? null);
    const errorHost = section();
    const add = button('Add', { class: 'block' });
    add.addEventListener('click', () => {
      void api
        .post('/api/relationships', { source: from.value, type: type.value, target: to.value })
        .then(() => {
          dialog.close();
          onDone();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) {
            errorHost.replaceChildren(el('p', {}, [error.message]));
            announce(error.message);
          }
        });
    });
    dialog.body.append(
      el('div', { class: 'field' }, [el('label', {}, ['From']), from]),
      el('div', { class: 'field' }, [el('label', {}, ['Type']), type]),
      el('div', { class: 'field' }, [el('label', {}, ['To']), to]),
      errorHost,
      add,
    );
  });
}

function openMaintenanceDialog(name: string, onDone: () => void): void {
  openDialog({ label: 'Schedule maintenance' }, (dialog) => {
    const start = el('input', { type: 'text', 'aria-label': 'Start' }) as HTMLInputElement;
    const end = el('input', { type: 'text', 'aria-label': 'End' }) as HTMLInputElement;
    const schedule = button('Schedule', { class: 'block' });
    schedule.addEventListener('click', () => {
      void api
        .post(`/api/cis/${encodeURIComponent(name)}/maintenance`, { start: start.value, end: end.value })
        .then(() => {
          dialog.close();
          onDone();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) announce(error.message);
        });
    });
    dialog.body.append(
      el('div', { class: 'field' }, [el('label', {}, ['Start']), start]),
      el('div', { class: 'field' }, [el('label', {}, ['End']), end]),
      schedule,
    );
  });
}

interface RelayPanel {
  kind: 'item' | 'more';
  name: string;
  path: string[];
  tier: 1 | 2 | 3;
  people_added: number;
  running_people: number;
  rest: string[];
}

interface MajorResponse {
  record: RecordView;
  impact: { ci: string; base_people: number; people_total: number } | null;
  panels: RelayPanel[];
  children: RecordSummary[];
  timeline: { at: string; kind: string; text: string }[];
}

/**
 * The outage relay: the failed item's name pinned, one full-height panel per
 * affected item, and a counter that rises and falls with scroll.
 */
async function renderMajor(host: HTMLElement, number: string): Promise<void> {
  const response = await api.get<MajorResponse>(`/api/major/${encodeURIComponent(number)}`);
  const itemName = response.impact?.ci ?? number;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const counterDigits = el('span', {}, [String(response.impact?.base_people ?? 0)]);
  const counter = el('div', { class: 'relay-counter', role: 'group', 'aria-label': 'Affected people' }, [
    counterDigits,
    ' people',
  ]);

  const panelsHost = section();
  for (const panel of response.panels) {
    const article = el('article', { class: `relay-panel tier-${panel.tier}`, 'aria-label': panel.name }, [
      el('img', { src: portraitFor(panel.name), alt: `${panel.name} portrait`, width: '160', height: '240' }),
      el('h2', { class: 'display' }, [panel.name]),
      el('p', {}, [panel.path.join(' -> ')]),
      el('p', {}, [`Tier ${panel.tier}`]),
      el('p', {}, [`+${panel.people_added} people`]),
    ]);
    if (panel.kind === 'more') {
      article.append(el('p', {}, [panel.rest.join(', ')]));
    }
    panelsHost.append(article);
  }

  const childList = el(
    'ul',
    { class: 'list-plain', 'aria-label': 'Child incidents' },
    response.children.map((child) =>
      el('li', {}, [link(`${child.number}: ${child.state_label}`, `/desk/records/${child.number}`)]),
    ),
  );

  const resolveTogether = button('Resolve together', { class: 'block' });
  resolveTogether.addEventListener('click', () => {
    openDialog({ label: 'Resolve together' }, (dialog) => {
      const code = selectBox(
        'Resolution code',
        [
          { value: 'fixed', label: 'Fixed' },
          { value: 'workaround_given', label: 'Workaround given' },
          { value: 'no_fault_found', label: 'No fault found' },
          { value: 'duplicate', label: 'Duplicate' },
        ],
        'fixed',
      );
      const note = el('textarea', { 'aria-label': 'Resolution note' }) as HTMLTextAreaElement;
      const resolve = button('Resolve', { class: 'block' });
      resolve.addEventListener('click', () => {
        void api
          .post(`/api/records/${number}/transition`, {
            to: 'resolved',
            fields: {
              resolution_code: { value: code.value, version: response.record.fields.resolution_code?.version ?? 1 },
              resolution_note: { value: note.value, version: response.record.fields.resolution_note?.version ?? 1 },
            },
          })
          .then(() => {
            dialog.close();
            void renderMajor(host, number);
          })
          .catch((error: unknown) => {
            if (error instanceof ApiFailure) announce(error.message);
          });
      });
      dialog.body.append(
        el('div', { class: 'field' }, [el('label', {}, ['Resolution code']), code]),
        el('div', { class: 'field' }, [el('label', {}, ['Resolution note']), note]),
        resolve,
      );
    });
  });

  const timeline = el(
    'div',
    { role: 'feed', 'aria-label': 'Timeline' },
    response.timeline.map((entry) => el('p', {}, [`${entry.kind}: ${entry.text}`])),
  );

  const proposals = await api
    .get<{ proposals: { id: number; ci: string; status: string }[] }>('/api/major-proposals')
    .catch(() => ({ proposals: [] }));
  const openProposal = proposals.proposals.find((p) => p.status === 'open' && p.ci === itemName);
  const proposalRow = section({ class: 'row' });
  if (openProposal && hasRole('operator')) {
    const promote = button('Promote to major incident', { class: 'block' });
    promote.addEventListener('click', () => {
      void api.post(`/api/major-proposals/${openProposal.id}/promote`).then(() => void renderMajor(host, number));
    });
    const reject = button('Reject proposal');
    reject.addEventListener('click', () => {
      void api
        .post(`/api/major-proposals/${openProposal.id}/reject`, { reason: 'Not a major incident' })
        .then(() => void renderMajor(host, number));
    });
    proposalRow.append(promote, reject);
  }

  if (reduced) {
    // The relay becomes an ordinary list, and the final total is announced once.
    counterDigits.textContent = String(response.impact?.people_total ?? 0);
    host.replaceChildren(
      el('div', { class: 'pin' }, [el('h1', { class: 'display subject' }, [itemName])]),
      restSection([
        el('h2', {}, ['Affected items']),
        el(
          'ul',
          { class: 'list-plain' },
          response.panels.map((panel) =>
            el('li', {}, [`${panel.name} - ${panel.path.join(' -> ')} - Tier ${panel.tier}`]),
          ),
        ),
        counter,
        proposalRow,
        childList,
        resolveTogether,
        timeline,
      ]),
    );
    announce(copy.relayReduced(response.impact?.people_total ?? 0, itemName));
    return;
  }

  const pinHost = el('div', { class: 'relay-pin' }, [el('h1', { class: 'display' }, [itemName])]);
  host.replaceChildren(
    pinHost,
    panelsHost,
    counter,
    restSection([
      proposalRow,
      el('div', { class: 'portal-columns' }, [
        section({ class: 'region' }, [el('h2', {}, ['Child incidents']), childList, resolveTogether]),
        section({ class: 'region' }, [el('h2', {}, ['Timeline']), timeline]),
      ]),
    ]),
  );

  // A panel counts as passed when its top edge crosses the middle of the viewport.
  let shownTotal = response.impact?.base_people ?? 0;
  const onScroll = (): void => {
    const middle = window.innerHeight / 2;
    let passed = -1;
    const articles = [...panelsHost.querySelectorAll('article')];
    articles.forEach((article, index) => {
      if (article.getBoundingClientRect().top < middle) passed = index;
    });
    const target =
      passed < 0
        ? (response.impact?.base_people ?? 0)
        : (response.panels[passed]?.running_people ?? 0);
    if (target === shownTotal) return;
    const from = shownTotal;
    shownTotal = target;
    const steps = 20;
    let step = 0;
    const timer = window.setInterval(() => {
      step += 1;
      counterDigits.textContent = String(Math.round(from + ((target - from) * step) / steps));
      if (step >= steps) window.clearInterval(timer);
    }, timings.settle / steps);
    animate(counter, [{ opacity: '0.85' }, { opacity: '1' }], timings.settle);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

interface ApprovalCard {
  kind: 'change_step' | 'request_item';
  id: string;
  record: string;
  title: string;
  closes_at: string | null;
  step: { step: number; tally: Record<string, number>; rule: string; status: string } | null;
}

/** Vote cards, with the published phone gestures and the 5-second Undo. */
async function renderApprovals(host: HTMLElement): Promise<void> {
  const response = await api.get<{ approvals: ApprovalCard[] }>('/api/approvals');
  if (response.approvals.length === 0) {
    host.replaceChildren(
      pin('Your votes'),
      stateScreen(copy.noVotes, copy.noVotesButton, () => navigate('/desk/lists/change')),
    );
    return;
  }

  const stack = section({ class: 'stack' });
  for (const card of response.approvals) {
    const label =
      card.kind === 'change_step'
        ? `${card.record}: ${card.title}`
        : `${card.record}: ${card.title}`;
    const article = el('article', { class: 'vote-card', 'aria-label': label, tabindex: '0' }, [
      el('h3', {}, [label]),
    ]);
    if (card.step) {
      article.append(
        el('div', { role: 'region', 'aria-label': 'Tally' }, [
          el('p', {}, [tallyText(card.step)]),
        ]),
      );
    }

    const undoHost = section();
    let undoTimer: number | null = null;

    const sendVote = (decision: 'approve' | 'reject'): void => {
      const path =
        card.kind === 'change_step'
          ? `/api/records/${card.record}/steps/${card.step?.step ?? 1}/votes`
          : `/api/approvals/${card.id}/decision`;
      void api
        .post(path, { decision })
        .then(async () => {
          announce(copy.voteRecorded(decision, card.record));
          await renderApprovals(host);
          focus(document.querySelector<HTMLElement>('.vote-card, .state button'));
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) announce(error.message);
        });
    };

    /** After a swipe past the distance the card leaves and Undo shows for 5 s. */
    const startUndo = (decision: 'approve' | 'reject'): void => {
      announce(decision === 'approve' ? copy.approvingSwipe(card.record) : copy.rejectingSwipe(card.record));
      article.style.display = 'none';
      const undo = button('Undo', { class: 'block' });
      undo.addEventListener('click', () => {
        if (undoTimer !== null) window.clearTimeout(undoTimer);
        undoTimer = null;
        undoHost.replaceChildren();
        article.style.display = '';
        article.style.transform = '';
        announce(copy.voteUndone);
      });
      undoHost.replaceChildren(undo);
      undoTimer = window.setTimeout(() => {
        undoHost.replaceChildren();
        sendVote(decision);
      }, 5000);
    };

    const approve = button('Approve', { class: 'block' });
    approve.addEventListener('click', () => sendVote('approve'));
    const reject = button('Reject');
    reject.addEventListener('click', () => sendVote('reject'));
    article.append(el('div', { class: 'row' }, [approve, reject]));

    installCardGestures(article, {
      onSwipeRight: () => startUndo('approve'),
      onSwipeLeft: () => startUndo('reject'),
      onLongPress: () =>
        openDialog({ label: 'Vote actions', sheet: true }, (dialog) => {
          const a = button('Approve', { class: 'block' });
          a.addEventListener('click', () => {
            dialog.close();
            sendVote('approve');
          });
          const r = button('Reject');
          r.addEventListener('click', () => {
            dialog.close();
            sendVote('reject');
          });
          const open = button('Open record');
          open.addEventListener('click', () => {
            dialog.close();
            navigate(`/desk/records/${card.record}`);
          });
          const cancel = button('Cancel');
          cancel.addEventListener('click', () => dialog.close());
          dialog.body.append(a, r, open, cancel);
        }),
    });

    stack.append(article, undoHost);
  }

  host.replaceChildren(pin('Your votes'), restSection([stack]));

  onLive(['approvals'], (message: LiveMessage) => {
    if (message.topic === 'approvals') {
      if (message.event === 'reset') {
        announce(copy.approvalReset(String(message.data.number ?? '')));
      }
      void renderApprovals(host);
    }
  });
}

function tallyText(step: { rule: string; status: string; tally: Record<string, number> }): string {
  const t = step.tally;
  const base =
    step.rule === 'weighted'
      ? copy.weightedRule(
          t.approve_weight ?? 0,
          t.reject_weight ?? 0,
          t.waiting_weight ?? 0,
          t.needed ?? 0,
          t.total_weight ?? 0,
        )
      : copy.countRule(t.approve ?? 0, t.reject ?? 0, t.waiting ?? 0, t.needed ?? 0, t.of ?? 0);
  if (step.status === 'approved') return `${base} ${copy.closedApproved}`;
  if (step.status === 'rejected') return `${base} ${copy.closedRejected}`;
  return base;
}

interface CardGestures {
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  onLongPress: () => void;
}

/** The published phone gestures: 96 px past centre, and a 600 ms long press. */
function installCardGestures(card: HTMLElement, handlers: CardGestures): void {
  let startX = 0;
  let startY = 0;
  let pressTimer: number | null = null;
  let moved = 0;

  card.addEventListener('pointerdown', (event) => {
    startX = event.clientX;
    startY = event.clientY;
    moved = 0;
    card.setPointerCapture(event.pointerId);
    pressTimer = window.setTimeout(() => {
      if (Math.abs(moved) <= 10) handlers.onLongPress();
    }, 600);
  });

  card.addEventListener('pointermove', (event) => {
    if (!card.hasPointerCapture(event.pointerId)) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    moved = Math.max(Math.abs(dx), Math.abs(dy));
    card.style.transform = `translateX(${dx}px)`;
  });

  const finish = (event: PointerEvent): void => {
    if (pressTimer !== null) window.clearTimeout(pressTimer);
    pressTimer = null;
    if (!card.hasPointerCapture(event.pointerId)) return;
    card.releasePointerCapture(event.pointerId);
    const dx = event.clientX - startX;
    if (dx > 96) {
      card.style.transform = '';
      handlers.onSwipeRight();
      return;
    }
    if (dx < -96) {
      card.style.transform = '';
      handlers.onSwipeLeft();
      return;
    }
    // A shorter swipe snaps the card back.
    animate(card, [{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }], timings.quick);
    card.style.transform = '';
  };
  card.addEventListener('pointerup', finish);
  card.addEventListener('pointercancel', finish);
}

/** On call now, the next eight weeks of shifts, overrides and open pages. */
async function renderOnCall(host: HTMLElement): Promise<void> {
  const rotations = await api.get<{ rotations: { name: string }[] }>('/api/rotations');
  const name = rotations.rotations[0]?.name ?? 'Weekly on-call';
  const [current, shifts, pages] = await Promise.all([
    api.get<{ username: string; display_name: string; shift_start: string; shift_end: string }>(
      `/api/rotations/${encodeURIComponent(name)}/oncall`,
    ),
    api.get<{ shifts: { display_name: string; start: string; end: string; override: boolean }[] }>(
      `/api/rotations/${encodeURIComponent(name)}/shifts`,
    ),
    api.get<{
      pages: {
        id: string;
        record: string;
        status: string;
        level: number;
        late: boolean;
        acknowledged_by: string | null;
      }[];
    }>('/api/pages'),
  ]);

  const pageCards = section();
  for (const page of pages.pages) {
    const article = el('article', { class: 'vote-card', 'aria-label': `Page for ${page.record}`, tabindex: '0' }, [
      el('h3', {}, [`Page for ${page.record}`]),
      el('p', { class: 'status' }, [page.status]),
      el('p', {}, [`Level ${page.level}`]),
      page.late ? el('p', {}, [`Late acknowledge recorded`]) : null,
    ]);
    const acknowledge = (): void => {
      void api
        .post(`/api/pages/${page.id}/acknowledge`, {})
        .then(() => {
          announce(copy.pageAcknowledged);
          void renderOnCall(host);
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) announce(error.message);
        });
    };
    const ack = button('Acknowledge', { class: 'block' });
    ack.addEventListener('click', acknowledge);
    article.append(ack);
    installCardGestures(article, {
      onSwipeRight: () => {
        announce(copy.approvingSwipe(page.record));
        window.setTimeout(acknowledge, 5000);
      },
      onSwipeLeft: () => undefined,
      onLongPress: () =>
        openDialog({ label: 'Page actions', sheet: true }, (dialog) => {
          const a = button('Acknowledge', { class: 'block' });
          a.addEventListener('click', () => {
            dialog.close();
            acknowledge();
          });
          const open = button('Open incident');
          open.addEventListener('click', () => {
            dialog.close();
            navigate(`/desk/records/${page.record}`);
          });
          const cancel = button('Cancel');
          cancel.addEventListener('click', () => dialog.close());
          dialog.body.append(a, open, cancel);
        }),
    });
    pageCards.append(article);
  }

  const addOverride = button('Add override');
  addOverride.addEventListener('click', () => {
    openDialog({ label: 'Add override' }, (dialog) => {
      const rotation = selectBox(
        'Rotation',
        rotations.rotations.map((r) => ({ value: r.name, label: r.name })),
        name,
      );
      const person = el('input', { type: 'text', 'aria-label': 'Person' }) as HTMLInputElement;
      const start = el('input', { type: 'text', 'aria-label': 'Start' }) as HTMLInputElement;
      const end = el('input', { type: 'text', 'aria-label': 'End' }) as HTMLInputElement;
      const save = button('Save override', { class: 'block' });
      save.addEventListener('click', () => {
        void api
          .post(`/api/rotations/${encodeURIComponent(rotation.value)}/overrides`, {
            username: person.value,
            start: start.value,
            end: end.value,
          })
          .then(() => {
            dialog.close();
            void renderOnCall(host);
          })
          .catch((error: unknown) => {
            if (error instanceof ApiFailure) announce(error.message);
          });
      });
      dialog.body.append(
        el('div', { class: 'field' }, [el('label', {}, ['Rotation']), rotation]),
        el('div', { class: 'field' }, [el('label', {}, ['Person']), person]),
        el('div', { class: 'field' }, [el('label', {}, ['Start']), start]),
        el('div', { class: 'field' }, [el('label', {}, ['End']), end]),
        save,
      );
    });
  });

  host.replaceChildren(
    pin('On call'),
    restSection([
      el('div', { class: 'region', role: 'region', 'aria-label': 'On call now' }, [
        el('h2', {}, ['On call now']),
        el('p', {}, [current.display_name]),
        el('p', {}, [`${current.shift_start} to ${current.shift_end}`]),
      ]),
      el('h2', {}, ['Shifts']),
      el(
        'ul',
        { class: 'list-plain' },
        shifts.shifts
          .slice(0, 8)
          .map((shift) =>
            el('li', {}, [`${shift.display_name}: ${shift.start} to ${shift.end}${shift.override ? ' (override)' : ''}`]),
          ),
      ),
      addOverride,
      el('h2', {}, ['Open pages']),
      pageCards,
    ]),
  );

  onLive(['pages'], (message) => {
    if (message.topic === 'pages') {
      if (message.event === 'acknowledged' && message.data.late === true) {
        announce(String(message.data.text ?? ''));
      }
      void renderOnCall(host);
    }
  });
}

interface CalendarDay {
  date: string;
  weekday: string;
  month_name: string;
  changes: { number: string; title: string }[];
  freezes: string[];
}

/** The change calendar, moved by day, week and month from the keyboard. */
async function renderCalendar(host: HTMLElement, month: string): Promise<void> {
  const response = await api.get<{ month: string; days: CalendarDay[] }>(
    `/api/changes/calendar?month=${encodeURIComponent(month)}`,
  );
  const [year, monthNumber] = response.month.split('-').map(Number);
  const first = response.days[0];
  const grid = el('div', { class: 'calendar', role: 'grid', 'aria-label': 'Change calendar' });

  const cells: HTMLElement[] = [];
  for (const day of response.days) {
    const count = day.changes.length;
    const dayNumber = Number(day.date.slice(8));
    const name = `${day.weekday}, ${dayNumber} ${day.month_name} ${year}, ${count} ${count === 1 ? 'change' : 'changes'}`;
    const cell = el(
      'div',
      { role: 'gridcell', 'aria-label': name, tabindex: '-1', dataDate: day.date },
      [el('span', {}, [String(dayNumber)]), el('span', {}, [` ${count}`])],
    );
    if (day.freezes.length > 0) cell.append(el('span', {}, [' Freeze']));
    cells.push(cell);
    grid.append(cell);
  }
  if (cells[0]) cells[0].tabIndex = 0;

  const openDay = (cell: HTMLElement): void => {
    const date = cell.getAttribute('data-date') ?? '';
    const day = response.days.find((d) => d.date === date);
    if (!day) return;
    const dayNumber = Number(date.slice(8));
    openDialog(
      { label: `Changes on ${dayNumber} ${day.month_name} ${year}`, onClose: () => focus(cell) },
      (dialog) => {
        dialog.body.append(
          el(
            'ul',
            { class: 'list-plain' },
            day.changes.map((change) =>
              el('li', {}, [link(`${change.number}: ${change.title}`, `/desk/records/${change.number}`)]),
            ),
          ),
        );
      },
    );
  };

  grid.addEventListener('keydown', (event) => {
    const cell = (event.target as HTMLElement).closest('[role="gridcell"]') as HTMLElement | null;
    if (!cell) return;
    const index = cells.indexOf(cell);
    const go = (to: number): void => {
      const target = cells[to];
      if (!target) return;
      event.preventDefault();
      for (const other of cells) other.tabIndex = -1;
      target.tabIndex = 0;
      focus(target);
    };
    switch (event.key) {
      case 'ArrowLeft':
        go(index - 1);
        return;
      case 'ArrowRight':
        go(index + 1);
        return;
      case 'ArrowUp':
        go(index - 7);
        return;
      case 'ArrowDown':
        go(index + 7);
        return;
      case 'Home': {
        const date = cell.getAttribute('data-date') ?? '';
        const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
        go(index - (dow === 0 ? 6 : dow - 1));
        return;
      }
      case 'End': {
        const date = cell.getAttribute('data-date') ?? '';
        const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
        go(index + (dow === 0 ? 0 : 7 - dow));
        return;
      }
      case 'PageUp':
        event.preventDefault();
        void renderCalendar(host, shiftMonth(response.month, -1));
        return;
      case 'PageDown':
        event.preventDefault();
        void renderCalendar(host, shiftMonth(response.month, 1));
        return;
      case 'Enter':
        event.preventDefault();
        openDay(cell);
        return;
      default:
        return;
    }
  });
  for (const cell of cells) {
    cell.addEventListener('click', () => openDay(cell));
  }

  const previous = button('Previous month');
  previous.addEventListener('click', () => void renderCalendar(host, shiftMonth(response.month, -1)));
  const next = button('Next month');
  next.addEventListener('click', () => void renderCalendar(host, shiftMonth(response.month, 1)));

  host.replaceChildren(
    pin(`${first?.month_name ?? ''} ${year}`),
    restSection([el('div', { class: 'row' }, [previous, next]), grid]),
  );
  void monthNumber;
}

function shiftMonth(month: string, step: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const total = year * 12 + (monthNumber - 1) + step;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

async function renderBoard(host: HTMLElement, name: string): Promise<void> {
  const response = await api.get<{
    items: { number: string; title: string; planned_start: string | null; step: { rule: string; status: string; tally: Record<string, number> } }[];
  }>(`/api/boards/${encodeURIComponent(name)}/agenda`);
  host.replaceChildren(
    pin(name),
    restSection([
      el(
        'ol',
        { class: 'list-plain' },
        response.items.map((item) =>
          el('li', {}, [
            link(`${item.number}: ${item.title}`, `/desk/records/${item.number}`),
            el('div', { role: 'region', 'aria-label': 'Tally' }, [el('p', {}, [tallyText(item.step)])]),
          ]),
        ),
      ),
    ]),
  );
  onLive(['approvals', ...response.items.map((item) => `votes:${item.number}`)], (message) => {
    if (message.topic.startsWith('votes:') || message.topic === 'approvals') void renderBoard(host, name);
  });
}

interface Widget {
  id: string;
  title: string;
  kind: string;
  table: string;
  data: { key: unknown; label: string; count: number; filter: string }[];
  total: number;
}

async function renderDashboard(host: HTMLElement, id: string): Promise<void> {
  const response = await api.get<{
    dashboard: { id: string; name: string; time_zone: string; widgets: Widget[] };
  }>(`/api/dashboards/${encodeURIComponent(id)}`);
  const widgets = el('div', { class: 'widgets' });
  for (const widget of response.dashboard.widgets) {
    const node = el('div', { class: 'widget', role: 'region', 'aria-label': widget.title }, [
      el('h3', {}, [widget.title]),
      el('img', { src: chartFor(widget.data), alt: `${widget.title} chart` }),
    ]);
    if (widget.kind === 'count') node.append(el('p', {}, [String(widget.total)]));
    for (const bucket of widget.data) {
      node.append(
        el('p', {}, [
          link(
            `${bucket.label}: ${bucket.count}`,
            `/desk/lists/${widget.table}?filter=${encodeURIComponent(bucket.filter)}`,
          ),
        ]),
      );
    }
    const table = el('table', { 'aria-label': `${widget.title} data` }, [
      el('thead', {}, [el('tr', {}, [el('th', {}, ['Group']), el('th', {}, ['Count'])])]),
      el(
        'tbody',
        {},
        widget.data.map((bucket) => el('tr', {}, [el('td', {}, [bucket.label]), el('td', {}, [String(bucket.count)])])),
      ),
    ]);
    table.hidden = true;
    const show = button('Show data table');
    show.addEventListener('click', () => {
      table.hidden = !table.hidden;
    });
    node.append(show, table);
    widgets.append(node);
  }
  host.replaceChildren(pin(response.dashboard.name), restSection([widgets]));
  onLive([`dashboard:${id}`, 'list:incident', 'list:change', 'list:request_item'], (message) => {
    if (message.topic.startsWith('list:') || message.topic.startsWith('record:')) {
      void renderDashboard(host, id);
    }
  });
}

async function renderInbox(host: HTMLElement): Promise<void> {
  const response = await api.get<{
    items: { id: number; event: string; text: string; record: string | null; read: boolean }[];
    unread: number;
  }>('/api/inbox');
  state.unread = response.unread;
  refreshChrome();
  if (response.items.length === 0) {
    host.replaceChildren(
      pin('Inbox'),
      stateScreen(copy.emptyInbox, copy.emptyInboxButton, () => navigate(homeScreen())),
    );
    return;
  }
  const markAll = button('Mark all read');
  markAll.addEventListener('click', () => {
    void api.post('/api/inbox/read-all').then(() => void renderInbox(host));
  });
  const digest = el('div', { role: 'radiogroup', 'aria-label': 'Digest' });
  for (const [label, value] of [
    ['Immediately', 'immediate'],
    ['Daily digest', 'daily'],
  ] as const) {
    const input = el('input', { type: 'radio', name: 'digest', 'aria-label': label }) as HTMLInputElement;
    input.addEventListener('change', () => {
      void api.put('/api/inbox/settings', { digest: value });
    });
    const id = `d-${value}`;
    input.id = id;
    digest.append(el('div', {}, [input, el('label', { for: id }, [label])]));
  }
  host.replaceChildren(
    pin('Inbox'),
    restSection([
      el('div', { class: 'row' }, [markAll, digest]),
      el(
        'ul',
        { class: 'list-plain', 'aria-label': 'Inbox' },
        response.items.map((item) =>
          el('li', {}, [
            item.record ? link(item.text, `/desk/records/${item.record}`) : document.createTextNode(item.text),
          ]),
        ),
      ),
    ]),
  );
  onLive(['inbox'], (message) => {
    if (message.topic === 'inbox') void renderInbox(host);
  });
}

/** The requester portal: Search knowledge, Catalog and My requests. */
async function renderPortal(host: HTMLElement): Promise<void> {
  const [items, incidents, requests] = await Promise.all([
    api.get<{ items: { id: string; name: string }[] }>('/api/catalog/items'),
    api
      .get<{ records: RecordSummary[] }>('/api/tables/incident/records?sort=number&dir=desc')
      .catch(() => ({ records: [] as RecordSummary[] })),
    api
      .get<{ records: RecordSummary[] }>('/api/tables/request_item/records?sort=number&dir=desc')
      .catch(() => ({ records: [] as RecordSummary[] })),
  ]);
  const cart = await api.get<{ lines: { id: string }[] }>('/api/cart').catch(() => ({ lines: [] }));
  state.cartCount = cart.lines.length;

  const searchBox = el('input', { type: 'search', 'aria-label': 'Search knowledge' }) as HTMLInputElement;
  const results = el('ul', { class: 'list-plain', 'aria-label': 'Knowledge results' });
  const resultsHost = section();
  let searchTimer: number | null = null;
  const runSearch = (): void => {
    const query = searchBox.value;
    void api
      .get<{ articles: { number: string; title: string }[] }>(
        `/api/knowledge/articles?q=${encodeURIComponent(query)}`,
      )
      .then((response) => {
        if (response.articles.length === 0 && query.trim() !== '') {
          resultsHost.replaceChildren(
            stateScreen(copy.noArticles(query), copy.noArticlesButton, () => navigate('/portal/fault')),
          );
          return;
        }
        results.replaceChildren(
          ...response.articles.map((article) =>
            el('li', {}, [link(article.title, `/portal/knowledge/${article.number}`)]),
          ),
        );
        resultsHost.replaceChildren(results);
      })
      .catch(() => undefined);
  };
  searchBox.addEventListener('input', () => {
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(runSearch, 300);
  });

  const myRequests = el('div', { class: 'region', role: 'region', 'aria-label': 'My requests' }, [
    el('h2', {}, ['My requests']),
    el(
      'ul',
      { class: 'list-plain' },
      [
        ...incidents.records.map((record) =>
          el('li', {}, [
            link(
              `${record.number} ${record.short_description ?? ''}: ${record.state_label}`,
              `/portal/incidents/${record.number}`,
            ),
          ]),
        ),
        ...requests.records.map((record) =>
          el('li', {}, [link(`${record.number}: ${record.state_label}`, `/portal/requests/${record.number}`)]),
        ),
      ],
    ),
  ]);

  host.replaceChildren(
    pin('Ask the desk'),
    restSection([
      el('div', { class: 'portal-columns' }, [
        el('div', { class: 'region span-all', role: 'region', 'aria-label': 'Search knowledge' }, [
          el('h2', {}, ['Search knowledge']),
          searchBox,
          resultsHost,
        ]),
        el('div', { class: 'region', role: 'region', 'aria-label': 'Catalog' }, [
          el('h2', {}, ['Catalog']),
          el(
            'ul',
            { class: 'list-plain' },
            items.items.map((item) => el('li', {}, [link(item.name, `/portal/items/${item.id}`)])),
          ),
          el('p', {}, [link('New starter', '/portal/guides/new-starter')]),
          el('p', {}, [link('Report a fault', '/portal/fault')]),
          el('p', {}, [link(`Cart, ${state.cartCount} items`, '/portal/cart')]),
        ]),
        myRequests,
      ]),
    ]),
  );
  resultsHost.replaceChildren(results);
}

interface CatalogVariable {
  name: string;
  label: string;
  type: string;
  required: boolean;
  default: unknown;
  choices: { value: string; label: string; when: { variable: string; equals: unknown } | null }[];
}

/** One control per variable, with dependent choices refreshed as values change. */
function variableControls(
  variables: readonly CatalogVariable[],
  defaults: Record<string, unknown>,
): { host: HTMLElement; read: () => Record<string, unknown>; refresh: () => void } {
  const host = section();
  const controls = new Map<string, HTMLElement>();
  const values: Record<string, unknown> = { ...defaults };

  const read = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [name, control] of controls) {
      if (control instanceof HTMLInputElement) {
        out[name] = control.type === 'checkbox' ? control.checked : control.value;
      } else if (control instanceof HTMLSelectElement) out[name] = control.value;
      else if (control instanceof HTMLTextAreaElement) out[name] = control.value;
    }
    return out;
  };

  const render = (): void => {
    const current = controls.size > 0 ? { ...values, ...read() } : values;
    host.replaceChildren();
    controls.clear();
    for (const variable of variables) {
      let control: HTMLElement;
      if (variable.type === 'select') {
        const offered = variable.choices.filter(
          (choice) => !choice.when || String(current[choice.when.variable] ?? '') === String(choice.when.equals),
        );
        control = selectBox(
          variable.label,
          [{ value: '', label: '' }, ...offered.map((c) => ({ value: c.value, label: c.label }))],
          String(current[variable.name] ?? ''),
        );
      } else if (variable.type === 'checkbox') {
        const box = el('input', { type: 'checkbox', 'aria-label': variable.label }) as HTMLInputElement;
        box.checked = current[variable.name] === true;
        control = box;
      } else if (variable.type === 'number') {
        control = el('input', {
          type: 'number',
          'aria-label': variable.label,
          value: String(current[variable.name] ?? ''),
        });
      } else if (variable.type === 'multiline') {
        const box = el('textarea', { 'aria-label': variable.label }) as HTMLTextAreaElement;
        box.value = String(current[variable.name] ?? '');
        control = box;
      } else {
        control = el('input', {
          type: 'text',
          'aria-label': variable.label,
          value: String(current[variable.name] ?? ''),
        });
      }
      const id = `v-${variable.name}`;
      control.id = id;
      controls.set(variable.name, control);
      control.addEventListener('change', () => {
        Object.assign(values, read());
        render();
      });
      host.append(el('div', { class: 'field' }, [el('label', { for: id }, [variable.label]), control]));
    }
  };
  render();
  return { host, read, refresh: render };
}

async function renderCatalogItem(host: HTMLElement, id: string): Promise<void> {
  const response = await api.get<{
    item: { id: string; name: string; variables: CatalogVariable[]; defaults: Record<string, unknown> };
  }>(`/api/catalog/items/${encodeURIComponent(id)}`);
  const controls = variableControls(response.item.variables, response.item.defaults);
  const quantity = el('input', { type: 'number', 'aria-label': 'Quantity', value: '1', min: '1', max: '10' }) as HTMLInputElement;
  const errorHost = section();
  const add = button('Add to cart', { class: 'block' });
  add.addEventListener('click', () => {
    void api
      .post('/api/cart/lines', {
        item: response.item.id,
        quantity: Number(quantity.value),
        variables: controls.read(),
      })
      .then(() => navigate('/portal/cart'))
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) return;
        errorHost.replaceChildren(
          el(
            'div',
            { role: 'group', 'aria-label': 'Problems to fix' },
            Object.values(error.fields).map((message) => el('p', {}, [message])),
          ),
        );
        announce(copy.problems(Object.keys(error.fields).length));
      });
  });
  host.replaceChildren(
    pin(response.item.name),
    restSection([
      el('div', { class: 'narrow' }, [
        controls.host,
        el('div', { class: 'field' }, [el('label', {}, ['Quantity']), quantity]),
        errorHost,
        add,
      ]),
    ]),
  );
}

async function renderGuide(host: HTMLElement, id: string): Promise<void> {
  const response = await api.get<{
    guide: { id: string; name: string; questions: CatalogVariable[]; rules: { item: string }[] };
  }>(`/api/catalog/guides/${encodeURIComponent(id)}`);
  const answers = variableControls(response.guide.questions, {});
  const itemsHost = section();
  const errorHost = section();
  const resolved: { id: string; controls: ReturnType<typeof variableControls> }[] = [];

  const resolve = (): void => {
    void api
      .post<{ items: string[] }>(`/api/catalog/guides/${encodeURIComponent(id)}/resolve`, {
        answers: answers.read(),
      })
      .then(async (result) => {
        itemsHost.replaceChildren();
        resolved.length = 0;
        for (const itemId of result.items) {
          const item = await api.get<{
            item: { id: string; name: string; variables: CatalogVariable[]; defaults: Record<string, unknown> };
          }>(`/api/catalog/items/${encodeURIComponent(itemId)}`);
          const controls = variableControls(item.item.variables, item.item.defaults);
          resolved.push({ id: itemId, controls });
          itemsHost.append(
            el('div', { role: 'group', 'aria-label': item.item.name }, [
              el('h3', {}, [item.item.name]),
              controls.host,
            ]),
          );
        }
      })
      .catch(() => undefined);
  };
  answers.host.addEventListener('change', () => window.setTimeout(resolve, 100));

  const addAll = button('Add all to cart', { class: 'block' });
  addAll.addEventListener('click', () => {
    void (async () => {
      errorHost.replaceChildren();
      // Every group's variables are checked first, and nothing is sent while a
      // problem remains.
      for (const entry of resolved) {
        try {
          await api.post('/api/cart/lines', {
            item: entry.id,
            quantity: 1,
            variables: entry.controls.read(),
          });
        } catch (error) {
          if (error instanceof ApiFailure) {
            errorHost.replaceChildren(
              el(
                'div',
                { role: 'group', 'aria-label': 'Problems to fix' },
                Object.values(error.fields).map((message) => el('p', {}, [message])),
              ),
            );
            announce(copy.problems(Object.keys(error.fields).length));
            return;
          }
        }
      }
      navigate('/portal/cart');
    })();
  });

  host.replaceChildren(
    pin(response.guide.name),
    restSection([el('div', { class: 'narrow' }, [answers.host, itemsHost, errorHost, addAll])]),
  );
  resolve();
}

async function renderCart(host: HTMLElement): Promise<void> {
  const response = await api.get<{
    lines: { id: string; item: string; item_name: string; quantity: number }[];
  }>('/api/cart');
  const lines = section();
  for (const line of response.lines) {
    const remove = button(`Remove ${line.item_name}`);
    remove.addEventListener('click', () => {
      void api.delete(`/api/cart/lines/${line.id}`).then(() => void renderCart(host));
    });
    lines.append(el('div', { class: 'row' }, [el('p', {}, [`${line.item_name} x${line.quantity}`]), remove]));
  }
  const submit = button('Submit request', { class: 'block' });
  const errorHost = section();
  submit.addEventListener('click', () => {
    submit.textContent = copy.submitting;
    void api
      .post<{ request: { number: string; items: unknown[] } }>(
        '/api/cart/checkout',
        { requested_for: null },
        { 'Idempotency-Key': `cart-${Date.now()}` },
      )
      .then((result) => {
        announce(copy.requestSubmitted(result.request.number, result.request.items.length));
        navigate(`/portal/requests/${result.request.number}`);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) {
          errorHost.replaceChildren(el('p', {}, [error.message]));
          announce(error.message);
        }
      })
      .finally(() => {
        submit.textContent = 'Submit request';
      });
  });
  host.replaceChildren(
    pin('Cart'),
    restSection([el('div', { class: 'narrow' }, [lines, errorHost, submit])]),
  );
}

async function renderRequest(host: HTMLElement, number: string): Promise<void> {
  const response = await api.get<{
    request: {
      number: string;
      state_label: string;
      items: {
        number: string;
        item_name: string;
        state_label: string;
        tasks: { number: string; state_label: string }[];
        slas: SlaView[];
      }[];
    };
  }>(`/api/requests/${encodeURIComponent(number)}`);
  const region = el('div', { class: 'region', role: 'region', 'aria-label': 'Request status' });
  const list = el('ul', { class: 'list-plain' });
  for (const item of response.request.items) {
    list.append(el('li', {}, [`${item.number} ${item.item_name}: ${item.state_label}`]));
    for (const task of item.tasks) {
      list.append(el('li', {}, [`${task.number}: ${task.state_label}`]));
    }
  }
  region.append(list);
  host.replaceChildren(
    pin(response.request.number),
    restSection([el('div', { class: 'narrow' }, [region])]),
  );
  onLive(['list:request_item', 'list:task', ...response.request.items.flatMap((item) => [`record:${item.number}`, `sla:${item.number}`, ...item.tasks.map((task) => `record:${task.number}`)])], (message) => {
    if (message.topic.startsWith('record:') || message.topic.startsWith('list:')) {
      void renderRequest(host, number);
    }
  });
}

async function renderPortalIncident(host: HTMLElement, number: string): Promise<void> {
  const response = await api.get<{ record: RecordView }>(`/api/records/${encodeURIComponent(number)}`);
  const record = response.record;
  const comments = await api.get<{
    entries: { kind: string; text: string; actor: string | null }[];
  }>(`/api/records/${encodeURIComponent(number)}/activity`);

  const commentBox = el('textarea', { 'aria-label': 'Comment' }) as HTMLTextAreaElement;
  const addComment = button('Add comment');
  addComment.addEventListener('click', () => {
    void api
      .post(`/api/records/${number}/comments`, { text: commentBox.value })
      .then(() => {
        announce(copy.noteAdded);
        void renderPortalIncident(host, number);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) announce(error.message);
      });
  });

  const actions = section({ class: 'row' });
  if (record.state === 'resolved') {
    const reopen = button('Reopen');
    reopen.addEventListener('click', () => {
      openDialog({ label: 'Reopen' }, (dialog) => {
        const reason = el('input', { type: 'text', 'aria-label': 'Reopen reason' }) as HTMLInputElement;
        const confirm = button('Reopen incident', { class: 'block' });
        confirm.addEventListener('click', () => {
          void api
            .post(`/api/records/${number}/transition`, {
              to: 'in_progress',
              fields: {
                reopen_reason: { value: reason.value, version: record.fields.reopen_reason?.version ?? 1 },
              },
            })
            .then(async () => {
              dialog.close();
              await renderPortalIncident(host, number);
              focus(document.querySelector<HTMLElement>('h1'));
            })
            .catch((error: unknown) => {
              if (error instanceof ApiFailure) announce(error.message);
            });
        });
        dialog.body.append(el('div', { class: 'field' }, [el('label', {}, ['Reopen reason']), reason]), confirm);
      });
    });
    actions.append(reopen);
  }

  host.replaceChildren(
    el('div', { class: 'pin' }, [el('h1', { class: 'display subject', tabindex: '-1' }, [record.number])]),
    restSection([
      el('div', { class: 'narrow' }, [
        el('div', { class: 'region', role: 'region', 'aria-label': 'Incident status' }, [
          el('p', { class: 'status' }, [`${record.number}: ${record.state_label}`]),
        ]),
        slaRegion(record.slas),
        el(
          'ul',
          { class: 'list-plain', 'aria-label': 'Comments' },
          comments.entries
            .filter((entry) => entry.kind === 'comment')
            .reverse()
            .map((entry) => el('li', {}, [`${entry.actor ?? ''}: ${entry.text}`])),
        ),
        el('div', { class: 'field' }, [el('label', {}, ['Comment']), commentBox]),
        addComment,
        actions,
      ]),
    ]),
  );
  startTicking(() => record.slas);

  onLive([`record:${number}`, `sla:${number}`], (message) => {
    if (message.topic !== `record:${number}` && message.topic !== `sla:${number}`) return;
    if (message.event === 'state') {
      announce(copy.requesterStateChange(number, String(message.data.state_label ?? '')));
    }
    void renderPortalIncident(host, number);
  });
}

async function renderFault(host: HTMLElement): Promise<void> {
  const shortDescription = el('input', { type: 'text', 'aria-label': 'Short description' }) as HTMLInputElement;
  const description = el('textarea', { 'aria-label': 'Description' }) as HTMLTextAreaElement;
  const cis = await api.get<{ cis: { name: string }[] }>('/api/cis').catch(() => ({ cis: [] }));
  const item = selectBox(
    'Service or item',
    [{ value: '', label: '' }, ...cis.cis.map((c) => ({ value: c.name, label: c.name }))],
    '',
  );
  const suggestions = el('ul', { class: 'list-plain', 'aria-label': 'Suggested articles' });
  let timer: number | null = null;
  shortDescription.addEventListener('input', () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void api
        .get<{ articles: { number: string; title: string }[] }>(
          `/api/knowledge/suggest?text=${encodeURIComponent(shortDescription.value)}`,
        )
        .then((response) => {
          suggestions.replaceChildren(
            ...response.articles.map((article) =>
              el('li', {}, [link(article.title, `/portal/knowledge/${article.number}`)]),
            ),
          );
        })
        .catch(() => undefined);
    }, 300);
  });

  const report = button('Report fault', { class: 'block' });
  const errorHost = section();
  report.addEventListener('click', () => {
    void api
      .post<{ record: RecordView }>('/api/tables/incident/records', {
        fields: {
          short_description: shortDescription.value,
          description: description.value,
          configuration_item: item.value === '' ? null : item.value,
          caller: state.session.user?.username ?? null,
        },
      })
      .then((response) => {
        announce(copy.saved(response.record.number));
        navigate(`/portal/incidents/${response.record.number}`);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) {
          errorHost.replaceChildren(el('p', {}, [error.message]));
          announce(error.message);
        }
      });
  });

  const form = el('form', { 'aria-label': 'Report a fault' }, [
    el('div', { class: 'field' }, [el('label', {}, ['Short description']), shortDescription]),
    el('div', { class: 'field' }, [el('label', {}, ['Description']), description]),
    el('div', { class: 'field' }, [el('label', {}, ['Service or item']), item]),
    suggestions,
    errorHost,
    report,
  ]);
  form.addEventListener('submit', (event) => event.preventDefault());
  host.replaceChildren(pin('Report a fault'), restSection([el('div', { class: 'narrow' }, [form])]));
}

async function renderArticle(host: HTMLElement, number: string): Promise<void> {
  const response = await api.get<{
    article: { number: string; title: string; body: string; helpful_yes: number; helpful_no: number };
  }>(`/api/knowledge/articles/${encodeURIComponent(number)}`);
  const vote = (helpful: boolean): void => {
    void api
      .put(`/api/knowledge/articles/${encodeURIComponent(number)}/vote`, { helpful })
      .then(() => void renderArticle(host, number));
  };
  const yes = button('Helpful');
  yes.addEventListener('click', () => vote(true));
  const no = button('Not helpful');
  no.addEventListener('click', () => vote(false));
  host.replaceChildren(
    pin(response.article.title),
    restSection([
      el('div', { class: 'narrow' }, [
        el('p', {}, [response.article.body]),
        el('div', { class: 'row' }, [yes, no]),
      ]),
    ]),
  );
}

interface AdminKind {
  readonly slug: string;
  readonly plural: string;
  readonly singular: string;
  readonly path: string;
  readonly collection: string;
  readonly key: string;
}

const adminKinds: readonly AdminKind[] = [
  { slug: 'business-rules', plural: 'Business rules', singular: 'business rule', path: '/api/business-rules', collection: 'business_rules', key: 'name' },
  { slug: 'access-rules', plural: 'Access rules', singular: 'access rule', path: '/api/access-rules', collection: 'access_rules', key: 'name' },
  { slug: 'assignment-rules', plural: 'Assignment rules', singular: 'assignment rule', path: '/api/assignment-rules', collection: 'assignment_rules', key: 'name' },
  { slug: 'form-policies', plural: 'Form policies', singular: 'form policy', path: '/api/form-policies', collection: 'form_policies', key: 'name' },
  { slug: 'sla-definitions', plural: 'SLA definitions', singular: 'SLA definition', path: '/api/sla-definitions', collection: 'sla_definitions', key: 'name' },
  { slug: 'schedules', plural: 'Business schedules', singular: 'business schedule', path: '/api/schedules', collection: 'schedules', key: 'name' },
  { slug: 'escalation-policies', plural: 'Escalation policies', singular: 'escalation policy', path: '/api/escalation-policies', collection: 'escalation_policies', key: 'name' },
  { slug: 'boards', plural: 'Change boards', singular: 'change board', path: '/api/boards', collection: 'boards', key: 'name' },
  { slug: 'freeze-windows', plural: 'Freeze windows', singular: 'freeze window', path: '/api/freeze-windows', collection: 'freeze_windows', key: 'name' },
  { slug: 'catalog-items', plural: 'Catalog items', singular: 'catalog item', path: '/api/catalog/items', collection: 'items', key: 'id' },
  { slug: 'inbox-rules', plural: 'Inbox rules', singular: 'inbox rule', path: '/api/inbox-rules', collection: 'rules', key: 'event' },
  { slug: 'users', plural: 'Users', singular: 'user', path: '/api/users', collection: 'users', key: 'username' },
  { slug: 'audit-log', plural: 'Audit log', singular: 'audit entry', path: '/api/audit-log', collection: 'entries', key: 'at' },
];

function sentenceCase(name: string): string {
  const words = name.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Each rules and settings screen: one list and one form per kind. */
async function renderAdmin(host: HTMLElement, slug: string): Promise<void> {
  const kind = adminKinds.find((k) => k.slug === slug);
  if (!kind) {
    host.replaceChildren(notFoundScreen());
    return;
  }
  const response = await api
    .get<Record<string, Record<string, unknown>[]>>(kind.path)
    .catch(() => ({}) as Record<string, Record<string, unknown>[]>);
  const rows = response[kind.collection] ?? [];

  const formHost = section();
  const renderForm = (record: Record<string, unknown> | null): void => {
    const form = el('form', { 'aria-label': kind.singular });
    form.addEventListener('submit', (event) => event.preventDefault());
    const members = record ? Object.keys(record) : ['name', 'table', 'condition', 'actions', 'active'];
    const controls = new Map<string, HTMLElement>();
    for (const member of members) {
      const value = record ? record[member] : null;
      const label = member === 'condition' ? 'Condition' : sentenceCase(member);
      let control: HTMLElement;
      if (typeof value === 'boolean') {
        const box = el('input', { type: 'checkbox', 'aria-label': label }) as HTMLInputElement;
        box.checked = value;
        control = box;
      } else if (value !== null && typeof value === 'object') {
        // Every array or object member is a textbox holding its JSON value.
        const box = el('textarea', { 'aria-label': label }) as HTMLTextAreaElement;
        box.value = JSON.stringify(value);
        control = box;
      } else {
        control = el('input', {
          type: 'text',
          'aria-label': label,
          value: value === null || value === undefined ? '' : String(value),
        });
      }
      const id = `a-${member}`;
      control.id = id;
      controls.set(member, control);
      form.append(el('div', { class: 'field' }, [el('label', { for: id }, [label]), control]));
    }

    if (kind.slug === 'users' && record) {
      const roles = el('div', { role: 'group', 'aria-label': 'Roles' });
      const mine = (record.roles as string[] | undefined) ?? [];
      for (const role of ['operator', 'technician', 'requester', 'approver', 'manager']) {
        const box = el('input', { type: 'checkbox', 'aria-label': role }) as HTMLInputElement;
        box.checked = mine.includes(role);
        const id = `role-${role}`;
        box.id = id;
        roles.append(el('div', {}, [box, el('label', { for: id }, [role])]));
      }
      form.append(roles);
    }

    const errorHost = section();
    const save = button(`Save ${kind.singular}`, { class: 'block' });
    save.addEventListener('click', () => {
      const body: Record<string, unknown> = {};
      for (const [member, control] of controls) {
        if (control instanceof HTMLInputElement) {
          body[member] = control.type === 'checkbox' ? control.checked : control.value;
        } else if (control instanceof HTMLTextAreaElement) {
          try {
            body[member] = JSON.parse(control.value) as unknown;
          } catch {
            body[member] = control.value;
          }
        }
      }
      const key = String(body[kind.key] ?? '');
      const request = record
        ? api.put(`${kind.path}/${encodeURIComponent(key)}`, body)
        : api.post(kind.path, body);
      void request
        .then(() => void renderAdmin(host, slug))
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) {
            errorHost.replaceChildren(el('p', {}, [error.message]));
            announce(error.message);
          }
        });
    });
    formHost.replaceChildren(form, errorHost, save);
  };

  const list = el(
    'ul',
    { class: 'list-plain', 'aria-label': kind.plural },
    rows.map((row) => {
      const name = String(row[kind.key] ?? '');
      const anchor = el('a', { href: '#' }, [name]);
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        renderForm(row);
      });
      const item = el('li', {}, [anchor]);
      if (kind.slug === 'users') {
        const impersonate = button(`Impersonate ${String(row.display_name ?? name)}`);
        impersonate.addEventListener('click', () => {
          void api.post('/api/impersonate', { username: name }).then(async () => {
            await loadSession();
            refreshChrome();
            navigate(homeScreen());
          });
        });
        item.append(impersonate);
      }
      return item;
    }),
  );

  const create = button(`New ${kind.singular}`);
  create.addEventListener('click', () => renderForm(null));

  host.replaceChildren(
    pin(kind.plural),
    restSection([el('div', { class: 'row' }, [create]), list, formHost]),
  );
}

interface FlowStep {
  id: string;
  type: string;
  name: string;
  then?: FlowStep[];
  else?: FlowStep[];
  body?: FlowStep[];
  on_error?: FlowStep[];
}

const stepTypeLabels: Record<string, string> = {
  trigger: 'Trigger',
  if: 'If',
  loop: 'Loop',
  approval: 'Approval',
  create_task: 'Create task',
  set_fields: 'Set fields',
  wait: 'Wait',
  subflow: 'Subflow',
  notify: 'Notify',
  end: 'End',
};

/** The workflow designer: a step tree driven entirely from the keyboard. */
async function renderDesigner(host: HTMLElement, id: string): Promise<void> {
  const response = await api.get<{
    workflows: { id: string; name: string; draft: FlowStep[]; versions: number[] }[];
  }>('/api/workflows');
  const flow = response.workflows.find((f) => f.id === id);
  if (!flow) {
    host.replaceChildren(notFoundScreen());
    return;
  }
  let steps: FlowStep[] = JSON.parse(JSON.stringify(flow.draft)) as FlowStep[];

  const tree = el('ul', { class: 'tree', role: 'tree', 'aria-label': 'Flow steps' });
  const items: { node: HTMLElement; step: FlowStep; parent: FlowStep[] }[] = [];

  const saveDraft = async (): Promise<void> => {
    await api.put(`/api/workflows/${encodeURIComponent(id)}/draft`, { steps });
  };

  const build = (list: FlowStep[], into: HTMLElement): void => {
    for (const step of list) {
      const item = el(
        'li',
        { role: 'treeitem', tabindex: '-1', 'aria-label': `${step.name}, ${stepTypeLabels[step.type] ?? step.type}` },
        [`${step.name}, ${stepTypeLabels[step.type] ?? step.type}`],
      );
      items.push({ node: item, step, parent: list });
      into.append(item);
      const lanes: [string, FlowStep[] | undefined][] = [
        ['Yes', step.then],
        ['No', step.else],
        ['Loop body', step.body],
        ['On error', step.on_error],
      ];
      for (const [laneName, laneSteps] of lanes) {
        if (!laneSteps) continue;
        const lane = el('li', { role: 'treeitem', tabindex: '-1', 'aria-label': laneName }, [laneName]);
        into.append(lane);
        const sub = el('ul', { role: 'group' });
        into.append(sub);
        build(laneSteps, sub);
      }
    }
  };

  const render = (focusId?: string): void => {
    tree.replaceChildren();
    items.length = 0;
    build(steps, tree);
    const first = items[0];
    if (first) first.node.tabIndex = 0;
    if (focusId) {
      const target = items.find((entry) => entry.step.id === focusId);
      if (target) {
        for (const entry of items) entry.node.tabIndex = -1;
        target.node.tabIndex = 0;
        focus(target.node);
      }
    }
  };

  tree.addEventListener('keydown', (event) => {
    const node = (event.target as HTMLElement).closest('[role="treeitem"]') as HTMLElement | null;
    if (!node) return;
    const visible = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const index = visible.indexOf(node);
    const entry = items.find((candidate) => candidate.node === node);

    const moveFocus = (to: number): void => {
      const target = visible[to];
      if (!target) return;
      event.preventDefault();
      for (const other of visible) other.tabIndex = -1;
      target.tabIndex = 0;
      focus(target);
    };

    switch (event.key) {
      case 'ArrowUp':
        moveFocus(index - 1);
        return;
      case 'ArrowDown':
        moveFocus(index + 1);
        return;
      case 'ArrowRight':
        moveFocus(index + 1);
        return;
      case 'ArrowLeft':
        moveFocus(Math.max(0, index - 1));
        return;
      case 'Insert': {
        event.preventDefault();
        openDialog({ label: 'Add step' }, (dialog) => {
          const type = selectBox(
            'Step type',
            Object.entries(stepTypeLabels).map(([value, label]) => ({ value, label })),
            'create_task',
          );
          const name = el('input', { type: 'text', 'aria-label': 'Step name' }) as HTMLInputElement;
          const add = button('Add step', { class: 'block' });
          add.addEventListener('click', () => {
            const step: FlowStep = {
              id: `s-${Math.random().toString(36).slice(2, 9)}`,
              type: type.value,
              name: name.value || type.value,
            };
            if (entry) {
              const at = entry.parent.indexOf(entry.step);
              entry.parent.splice(at + 1, 0, step);
            } else {
              steps.push(step);
            }
            dialog.close();
            void saveDraft().then(() => render(step.id));
          });
          dialog.body.append(
            el('div', { class: 'field' }, [el('label', {}, ['Step type']), type]),
            el('div', { class: 'field' }, [el('label', {}, ['Step name']), name]),
            add,
          );
        });
        return;
      }
      case 'Delete': {
        if (!entry) return;
        event.preventDefault();
        if (entry.step.type === 'trigger') {
          announce(copy.triggerStaysFirst);
          return;
        }
        openDialog({ label: 'Delete step' }, (dialog) => {
          const remove = button('Delete', { class: 'block' });
          remove.addEventListener('click', () => {
            const at = entry.parent.indexOf(entry.step);
            entry.parent.splice(at, 1);
            dialog.close();
            void saveDraft().then(() => {
              const neighbour = entry.parent[Math.max(0, at - 1)] ?? entry.parent[0];
              render(neighbour?.id);
            });
          });
          const keep = button('Keep');
          keep.addEventListener('click', () => dialog.close());
          dialog.body.append(remove, keep);
        });
        return;
      }
      case 'Enter': {
        if (!entry) return;
        event.preventDefault();
        openDialog({ label: `Edit step ${entry.step.name}` }, (dialog) => {
          const name = el('input', { type: 'text', 'aria-label': 'Step name', value: entry.step.name }) as HTMLInputElement;
          const apply = button('Save step', { class: 'block' });
          apply.addEventListener('click', () => {
            entry.step.name = name.value;
            dialog.close();
            void saveDraft().then(() => render(entry.step.id));
          });
          dialog.body.append(el('div', { class: 'field' }, [el('label', {}, ['Step name']), name]), apply);
        });
        return;
      }
      default:
        if (!event.altKey || !entry) return;
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        if (entry.step.type === 'trigger') {
          announce(copy.triggerStaysFirst);
          return;
        }
        {
          const at = entry.parent.indexOf(entry.step);
          const to = at + (event.key === 'ArrowUp' ? -1 : 1);
          if (to < 0 || to >= entry.parent.length) return;
          if (entry.parent[to].type === 'trigger') {
            announce(copy.triggerStaysFirst);
            return;
          }
          // The step slides from its old position to its new one over 180 ms.
          const before = entry.node.getBoundingClientRect().top;
          entry.parent.splice(at, 1);
          entry.parent.splice(to, 0, entry.step);
          void saveDraft().then(() => {
            render(entry.step.id);
            const moved = items.find((candidate) => candidate.step.id === entry.step.id);
            if (!moved) return;
            const after = moved.node.getBoundingClientRect().top;
            animate(
              moved.node,
              [{ transform: `translateY(${before - after}px)` }, { transform: 'translateY(0)' }],
              timings.quick,
            );
          });
        }
    }
  });

  const publish = button('Publish', { class: 'block' });
  publish.addEventListener('click', () => {
    publish.textContent = copy.publishing;
    void api
      .post<{ version: number }>(`/api/workflows/${encodeURIComponent(id)}/publish`)
      .then((result) => {
        announce(copy.versionPublished(result.version));
        void renderDesigner(host, id);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) announce(error.message);
      })
      .finally(() => {
        publish.textContent = 'Publish';
      });
  });

  const testRun = button('Test run');
  testRun.addEventListener('click', () => {
    void api
      .post<{ run: { id: string } }>(`/api/workflows/${encodeURIComponent(id)}/test-run`, {
        record: 'BRK-000001',
      })
      .then((result) => navigate(`/desk/runs/${result.run.id}`))
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) announce(error.message);
      });
  });

  host.replaceChildren(
    pin(flow.name),
    restSection([
      el('div', { class: 'row' }, [publish, testRun]),
      el('p', {}, [`Versions: ${flow.versions.join(', ') || 'none'}`]),
      tree,
    ]),
  );
  render();
}

async function renderRun(host: HTMLElement, id: string): Promise<void> {
  const response = await api.get<{
    run: {
      id: string;
      workflow: string;
      version: number;
      status: string;
      steps: { id: string; name: string; status_label: string }[];
    };
  }>(`/api/runs/${encodeURIComponent(id)}`);
  const run = response.run;
  const list = el(
    'ul',
    { class: 'list-plain', 'aria-label': 'Run steps' },
    run.steps.map((step) => {
      const item = el('li', {}, [`${step.name}: ${step.status_label}`]);
      if (step.status_label === 'Failed') {
        const retry = button(`Retry ${step.name}`);
        retry.addEventListener('click', () => {
          void api.post(`/api/runs/${encodeURIComponent(id)}/retry`).then(() => void renderRun(host, id));
        });
        item.append(retry);
      }
      return item;
    }),
  );
  host.replaceChildren(
    pin(`${run.workflow} v${run.version}`),
    restSection([el('p', { class: 'status' }, [run.status]), list]),
  );
  onLive([`run:${id}`], (message) => {
    if (message.topic === `run:${id}`) void renderRun(host, id);
  });
}

async function renderConfigSets(host: HTMLElement): Promise<void> {
  const response = await api.get<{
    sets: { id: string; number: string; name: string; state: string }[];
  }>('/api/config-sets');
  const body = section();
  const previewHost = section();

  const rows = response.sets.map((set) => {
    const actions = section({ class: 'row' });
    const exportSet = button('Export set');
    exportSet.addEventListener('click', () => {
      announce(copy.setExporting);
      void api
        .post(`/api/config-sets/${set.id}/export`)
        .then(() => {
          announce(copy.setExported(set.number));
          void renderConfigSets(host);
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) announce(error.message);
        });
    });
    const preview = button('Preview against live');
    const choices = new Map<string, string>();
    preview.addEventListener('click', () => {
      void api
        .post<{ items: { kind: string; name: string; action: string }[] }>(
          `/api/config-sets/${set.id}/preview`,
        )
        .then((result) => {
          const table = el('table', { 'aria-label': 'Set preview' }, [
            el('thead', {}, [el('tr', {}, [el('th', {}, ['Item']), el('th', {}, ['Action'])])]),
            el(
              'tbody',
              {},
              result.items.map((item) =>
                el('tr', {}, [el('td', {}, [item.name]), el('td', {}, [item.action])]),
              ),
            ),
          ]);
          const collisionHost = section();
          for (const item of result.items.filter((i) => i.action === 'collision')) {
            const key = `${item.kind}:${item.name}`;
            choices.set(key, 'take_set');
            collisionHost.append(
              el('div', { role: 'radiogroup', 'aria-label': item.name }, [
                radioInput('Take set', true, () => choices.set(key, 'take_set')),
                radioInput('Keep live', false, () => choices.set(key, 'keep_live')),
              ]),
            );
          }
          previewHost.replaceChildren(table, collisionHost);
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) announce(error.message);
        });
    });
    const commit = button('Commit set', { class: 'block' });
    commit.addEventListener('click', () => {
      announce(copy.setCommitting);
      void api
        .post<{ applied: number }>(`/api/config-sets/${set.id}/commit`, {
          choices: Object.fromEntries(choices),
        })
        .then((result) => {
          announce(copy.setCommitted(set.number, result.applied));
          void renderConfigSets(host);
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) announce(error.message);
        });
    });
    const backOut = button('Back out set');
    backOut.addEventListener('click', () => {
      announce(copy.setBackingOut);
      void api
        .post(`/api/config-sets/${set.id}/backout`)
        .then(() => {
          announce(copy.setBackedOut(set.number));
          void renderConfigSets(host);
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) announce(error.message);
        });
    });
    actions.append(exportSet, preview, commit, backOut);
    return el('tr', {}, [
      el('td', {}, [set.number]),
      el('td', {}, [set.name]),
      el('td', {}, [set.state]),
      el('td', {}, [actions]),
    ]);
  });

  const create = button('New set');
  create.addEventListener('click', () => {
    void api
      .post('/api/config-sets', { name: 'Promotion set' })
      .then(() => void renderConfigSets(host))
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) announce(error.message);
      });
  });

  body.append(
    el('div', { class: 'row' }, [create]),
    el('table', { 'aria-label': 'Configuration sets' }, [
      el('thead', {}, [
        el('tr', {}, [el('th', {}, ['Set']), el('th', {}, ['Name']), el('th', {}, ['State']), el('th', {}, ['Actions'])]),
      ]),
      el('tbody', {}, rows),
    ]),
    previewHost,
  );
  host.replaceChildren(pin('Configuration sets'), restSection([body]));
}

function radioInput(label: string, checked: boolean, onPick: () => void): HTMLElement {
  const input = el('input', { type: 'radio', 'aria-label': label, name: `c-${label}` }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', onPick);
  const id = `ci-${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return el('div', {}, [input, el('label', { for: id }, [label])]);
}

async function renderImports(host: HTMLElement): Promise<void> {
  const previewHost = section();
  const picker = el('input', { type: 'file' }) as HTMLInputElement;
  picker.style.display = 'none';
  const upload = button('Upload import file', { class: 'block' });
  upload.addEventListener('click', () => picker.click());

  const tableBox = selectBox(
    'Table',
    [
      { value: 'people', label: 'People' },
      { value: 'configuration_items', label: 'Configuration items' },
    ],
    'people',
  );

  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    if (!file) return;
    announce(copy.importChecking);
    void api
      .upload<{
        import: {
          id: string;
          rows: { line: number; action: string; errors: string[] }[];
          counts: Record<string, number>;
        };
      }>('/api/imports', file, { table: tableBox.value })
      .then((result) => {
        const counts = result.import.counts;
        announce(
          copy.importChecked(counts.create ?? 0, counts.update ?? 0, counts.unchanged ?? 0, counts.error ?? 0),
        );
        const table = el('table', { 'aria-label': 'Import preview' }, [
          el('thead', {}, [
            el('tr', {}, [el('th', {}, ['Line']), el('th', {}, ['Action']), el('th', {}, ['Errors'])]),
          ]),
          el(
            'tbody',
            {},
            result.import.rows.map((row) =>
              el('tr', {}, [
                el('td', {}, [String(row.line)]),
                el('td', {}, [row.action]),
                el('td', {}, [row.errors.join(' ')]),
              ]),
            ),
          ),
        ]);
        const commit = button('Commit import', { class: 'block' });
        commit.addEventListener('click', () => {
          announce(copy.importing);
          void api
            .post<{ import: { results: { outcome: string }[] } }>(`/api/imports/${result.import.id}/commit`)
            .then((committed) => {
              const outcomes = committed.import.results;
              announce(
                copy.importFinished(
                  outcomes.filter((r) => r.outcome === 'created').length,
                  outcomes.filter((r) => r.outcome === 'updated').length,
                  outcomes.filter((r) => r.outcome === 'unchanged').length,
                  outcomes.filter((r) => r.outcome === 'failed').length,
                ),
              );
            })
            .catch((error: unknown) => {
              if (error instanceof ApiFailure) announce(error.message);
            });
        });
        previewHost.replaceChildren(table, commit);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) announce(error.message);
      });
  });

  host.replaceChildren(
    pin('Imports'),
    restSection([el('div', { class: 'row' }, [tableBox, upload, picker]), previewHost]),
  );
}

async function renderExports(host: HTMLElement): Promise<void> {
  const response = await api.get<{
    exports: { id: string; status: string; rows_total: number; rows_done: number; error: string | null }[];
  }>('/api/exports');
  const rows = response.exports.map((job) => {
    const fill = el('div', { class: 'bar-fill' });
    fill.style.width = `${job.rows_total === 0 ? 0 : Math.round((job.rows_done / job.rows_total) * 100)}%`;
    const bar = el(
      'div',
      {
        class: 'bar',
        role: 'progressbar',
        'aria-label': 'Export progress',
        'aria-valuenow': String(job.rows_done),
        'aria-valuemax': String(job.rows_total),
      },
      [fill],
    );
    const actions = section({ class: 'row' });
    if (job.status === 'failed') {
      const retry = button('Retry export');
      retry.addEventListener('click', () => {
        void api
          .post(`/api/exports/${job.id}/retry`)
          .then(() => void renderExports(host))
          .catch((error: unknown) => {
            if (error instanceof ApiFailure) announce(error.message);
          });
      });
      actions.append(retry);
    }
    if (job.status === 'complete') {
      actions.append(link('Download export', `/api/exports/${job.id}/file`));
    }
    return el('tr', {}, [
      el('td', {}, [job.id.slice(0, 8)]),
      el('td', {}, [job.status]),
      el('td', {}, [bar, el('p', {}, [copy.exportProgress(job.rows_done, job.rows_total)])]),
      el('td', {}, [actions]),
    ]);
  });
  host.replaceChildren(
    pin('Exports'),
    restSection([
      el('table', { 'aria-label': 'Exports' }, [
        el('thead', {}, [
          el('tr', {}, [el('th', {}, ['Export']), el('th', {}, ['State']), el('th', {}, ['Progress']), el('th', {}, ['Actions'])]),
        ]),
        el('tbody', {}, rows),
      ]),
    ]),
  );
  onLive(response.exports.map((job) => `export:${job.id}`), (message) => {
    if (message.topic.startsWith('export:')) {
      if (message.event === 'complete') announce(copy.exportComplete(Number(message.data.rows ?? 0)));
      if (message.event === 'failed') announce(copy.exportFailed);
      void renderExports(host);
    }
  });
}

/** Routes a path to its screen, matching the published role-to-screen table. */
async function route(): Promise<void> {
  const host = bodyHostOf();
  const url = new URL(location.href);
  const path = url.pathname;
  dropScreenListeners();
  host.replaceChildren();

  if (path === '/') {
    renderLanding(host);
    return;
  }
  if (path === '/login') {
    if (signedIn()) {
      navigate(homeScreen(), true);
      return;
    }
    renderSignIn(host);
    return;
  }

  // An unknown path is the not-found state for every visitor; only a known
  // screen sends a visitor who is not signed in to the sign-in screen.
  const outcome = screenOutcome(path);
  if (outcome === 'not_found') {
    host.replaceChildren(notFoundScreen());
    return;
  }
  if (outcome === 'redirect') {
    location.replace('/login');
    return;
  }

  try {
    if (/^\/desk(\/lists\/[^/]+|\/records\/.*)?$/.test(path)) {
      await loadReferenceOptions().catch(() => undefined);
      await renderWorkspace(host, path, url.searchParams);
      return;
    }
    if (path === '/desk/map') {
      await renderMap(host);
      return;
    }
    const major = /^\/desk\/major\/([^/]+)$/.exec(path);
    if (major) {
      await renderMajor(host, major[1]);
      return;
    }
    if (path === '/desk/changes/calendar') {
      const now = new Date();
      await renderCalendar(host, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
      return;
    }
    const board = /^\/desk\/boards\/([^/]+)$/.exec(path);
    if (board) {
      await renderBoard(host, decodeURIComponent(board[1]));
      return;
    }
    if (path === '/approve') {
      await renderApprovals(host);
      return;
    }
    if (path === '/desk/oncall' || path === '/pages') {
      await renderOnCall(host);
      return;
    }
    const run = /^\/desk\/runs\/([^/]+)$/.exec(path);
    if (run) {
      await renderRun(host, run[1]);
      return;
    }
    const dashboard = /^\/(?:desk\/)?dashboards\/([^/]+)$/.exec(path);
    if (dashboard) {
      await renderDashboard(host, dashboard[1]);
      return;
    }
    if (path === '/desk/exports') {
      await renderExports(host);
      return;
    }
    const designer = /^\/desk\/workflows\/([^/]+)$/.exec(path);
    if (designer) {
      await renderDesigner(host, decodeURIComponent(designer[1]));
      return;
    }
    const admin = /^\/desk\/admin\/([^/]+)$/.exec(path);
    if (admin) {
      await renderAdmin(host, admin[1]);
      return;
    }
    if (path === '/desk/config-sets') {
      await renderConfigSets(host);
      return;
    }
    if (path === '/desk/imports') {
      await renderImports(host);
      return;
    }
    if (path === '/inbox') {
      await renderInbox(host);
      return;
    }
    if (path === '/portal') {
      await renderPortal(host);
      return;
    }
    const catalogItem = /^\/portal\/items\/([^/]+)$/.exec(path);
    if (catalogItem) {
      await renderCatalogItem(host, catalogItem[1]);
      return;
    }
    const guide = /^\/portal\/guides\/([^/]+)$/.exec(path);
    if (guide) {
      await renderGuide(host, guide[1]);
      return;
    }
    if (path === '/portal/cart') {
      await renderCart(host);
      return;
    }
    const request = /^\/portal\/requests\/([^/]+)$/.exec(path);
    if (request) {
      await renderRequest(host, request[1]);
      return;
    }
    if (path === '/portal/fault') {
      await renderFault(host);
      return;
    }
    const article = /^\/portal\/knowledge\/([^/]+)$/.exec(path);
    if (article) {
      await renderArticle(host, article[1]);
      return;
    }
    const incident = /^\/portal\/incidents\/([^/]+)$/.exec(path);
    if (incident) {
      await renderPortalIncident(host, incident[1]);
      return;
    }
    host.replaceChildren(notFoundScreen());
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) {
      host.replaceChildren(notFoundScreen());
      return;
    }
    host.replaceChildren(stateScreen(copy.loadError, copy.loadErrorButton, () => void route()));
  }
}

async function startApp(): Promise<void> {
  await loadSession();
  await loadChrome();
  const mounted = mount();
  refreshChrome = mounted.refreshChrome;
  refreshChrome();
  installRegionKeys(document.body);

  // Links inside the app navigate without a reload.
  document.body.addEventListener('click', (event) => {
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('/api/') || href === '#') return;
    event.preventDefault();
    navigate(href);
  });

  window.addEventListener('popstate', () => void route());

  live.connect();
  live.on((message) => {
    if (message.topic === 'inbox' && message.event === 'unread') {
      if (message.data.username === state.session.user?.username) {
        state.unread = Number(message.data.unread ?? 0);
        refreshChrome();
      }
    }
    if (message.topic === 'storage') {
      state.storage = message.event === 'available' ? 'available' : 'unavailable';
      refreshChrome();
    }
    if (message.topic === 'session' && message.event === 'access') {
      announce(copy.accessChanged);
      void loadSession().then(() => {
        refreshChrome();
        void route();
      });
    }
  });

  await route();
  void drawerLinks();
}

void startApp();
