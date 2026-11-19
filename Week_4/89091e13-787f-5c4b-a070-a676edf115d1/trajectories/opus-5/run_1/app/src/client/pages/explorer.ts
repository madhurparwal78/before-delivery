import {
  Blob,
  BlockDetail,
  BlockSummary,
  get,
  LightNode,
  MempoolResponse,
  Namespace,
  SharesResponse,
  Stats,
  Validator,
} from '../api.js';
import { drawRing, drawShowcase, registerCanvas } from '../art.js';
import { el, splitHeading, table } from '../dom.js';
import { initMarquee, initSplitHeadings, observeEntrances } from '../motion.js';
import { PageContext } from '../router.js';
import { announce, consoleFooter } from '../shell.js';
import { renderSquare } from '../square.js';
import { blockAnnouncement, rejectionCopy } from '../../shared/live.js';
import {
  fern,
  namespaceNames,
  rejectionBanner,
  roleRefusal,
  submitJson,
  time,
} from './common.js';

const BEHAVIOURS: { value: string; label: string }[] = [
  { value: 'honest', label: 'Honest' },
  { value: 'withhold', label: 'Withhold shares' },
  { value: 'bad-encoding', label: 'Bad encoding' },
];

function statusLabel(status: BlockSummary['status']): string {
  if (status === 'sampling') return 'Sampling';
  return status === 'available' ? 'Available' : 'Rejected';
}

export async function renderExplorer(context: PageContext): Promise<void> {
  const id = context.workspace.id;
  const [stats, blocks, namespaces, mempool, nodes, validators, myBlobs] = await Promise.all([
    get<Stats>(`/api/w/${id}/stats`),
    get<BlockSummary[]>(`/api/w/${id}/blocks`),
    get<Namespace[]>(`/api/w/${id}/namespaces`),
    get<MempoolResponse>(`/api/w/${id}/mempool`),
    get<LightNode[]>(`/api/w/${id}/light-nodes`),
    get<Validator[]>(`/api/w/${id}/validators`),
    get<Blob[]>(`/api/w/${id}/blobs?mine=true`),
  ]);
  const latest = blocks[0];
  const [detail, shares] = await Promise.all([
    get<BlockDetail>(`/api/w/${id}/blocks/${latest.height}`),
    get<SharesResponse>(`/api/w/${id}/blocks/${latest.height}/shares`),
  ]);
  const names = namespaceNames(namespaces);
  const mineIds = new Set(myBlobs.map((blob) => blob.id));
  const mine = new Set<string>();
  for (const blob of detail.blobs) {
    if (!mineIds.has(blob.id)) continue;
    for (const [row, col] of blob.positions) mine.add(`${row},${col}`);
  }

  const square = renderSquare({
    height: latest.height,
    k: shares.k,
    rows: shares.rows,
    namespaceNames: names,
    mine,
    outline: new Set(),
    revealImmediately: true,
  });

  const hero = el('section', { class: 'container hero' }, [
    el('h1', { class: 'entrance', data: { entranceIndex: 0 } }, [
      el('span', {}, 'Run your own data'),
      el('br'),
      el('span', {}, 'availability network.'),
    ]),
    el('p', {
      class: 'lede entrance',
      data: { entranceIndex: 1 },
      text: 'Blobs become shares, shares fill a square, the square is extended with parity, and light nodes sample it until they trust the block. Every number on screen follows its published formula.',
    }),
    el('div', { class: 'hero-stage' }, square.frame),
  ]);

  const statTrio = el(
    'section',
    { class: 'container section-tight', attrs: { 'aria-label': 'Network stats' } },
    el('div', { class: 'stat-trio' }, [
      el('div', { class: 'stat' }, [
        el('p', { class: 'value', text: `${stats.height} blocks` }),
        el('p', { class: 'caption', text: 'Current height' }),
      ]),
      el('div', { class: 'stat' }, [
        el('p', { class: 'value', text: `${stats.squareWidth} × ${stats.squareWidth} shares` }),
        el('p', { class: 'caption', text: 'Latest square' }),
      ]),
      el('div', { class: 'stat' }, [
        el('p', {
          class: 'value',
          text: `${stats.includedToday} ${stats.includedToday === 1 ? 'blob' : 'blobs'}`,
        }),
        el('p', { class: 'caption', text: 'Included today' }),
      ]),
    ]),
  );

  const banners = el('div', { class: 'container' });
  const recent = blocks.slice(0, 5);
  for (const summary of recent) {
    if (summary.status !== 'rejected') continue;
    const block =
      summary.height === latest.height
        ? detail
        : await get<BlockDetail>(`/api/w/${id}/blocks/${summary.height}`);
    if (block.rejection) banners.appendChild(rejectionBanner(block.height, block.rejection));
  }

  const producerStatus = el('p', {
    class: 'status-area',
    attrs: { role: 'status', 'aria-label': 'Producer status', 'aria-live': 'polite' },
  });
  const producerGroup = el('div', {
    class: 'radio-row',
    attrs: { role: 'radiogroup', 'aria-label': 'Next block' },
  });
  for (const behaviour of BEHAVIOURS) {
    const input = el('input', {
      attrs: {
        type: 'radio',
        name: 'next-block',
        value: behaviour.value,
        checked: context.workspace.nextBlock === behaviour.value,
      },
      on: {
        change: () => {
          producerStatus.textContent = 'Working…';
          void submitJson(`/api/w/${id}/producer`, { nextBlock: behaviour.value }, 'PUT')
            .then(() => {
              producerStatus.textContent = `Next block: ${behaviour.label}.`;
            })
            .catch(() => {
              producerStatus.textContent = '';
            });
        },
      },
    });
    producerGroup.appendChild(el('label', {}, [input, behaviour.label]));
  }
  const producerPanel = el('div', { class: 'panel' }, [
    el('h2', { text: 'Next block' }),
    producerGroup,
    producerStatus,
  ]);
  const refusal = roleRefusal(context.workspace.role, 'producer');
  if (refusal) {
    producerPanel.appendChild(el('p', { class: 'field-note', attrs: { id: 'producer-role' }, text: refusal }));
    for (const input of producerGroup.querySelectorAll<HTMLElement>('input')) {
      input.setAttribute('disabled', '');
      input.setAttribute('aria-describedby', 'producer-role');
    }
  }

  const mempoolText = el('p', {
    text: `Mempool ${mempool.count} ${mempool.count === 1 ? 'blob' : 'blobs'}`,
  });

  const blocksTable = table(
    'Blocks',
    ['Height', 'Time', 'Blobs', 'Square', 'Status'],
    blocks.map((block) => [
      el('a', { attrs: { href: `/w/${id}/explorer/blocks/${block.height}` } }, String(block.height)),
      time(block.producedAt),
      String(block.blobs),
      `${block.squareWidth} × ${block.squareWidth}`,
      statusLabel(block.status),
    ]),
  );

  const namespacesTable = table(
    'Namespaces',
    ['Name', 'Hex', 'Blobs'],
    namespaces.map((namespace) => [
      namespace.name,
      el('span', { class: 'mono', text: namespace.hex }),
      String(namespace.blobCount),
    ]),
    'No namespaces yet.',
  );

  const sharesByNamespace = new Map<string, string[]>();
  for (const row of shares.rows) {
    for (const cell of row) {
      if (cell.quadrant !== 'Q0' || !cell.share) continue;
      const list = sharesByNamespace.get(cell.namespace) ?? [];
      list.push(cell.share);
      sharesByNamespace.set(cell.namespace, list);
    }
  }

  const showcase = el(
    'ul',
    { class: 'card-grid', attrs: { 'aria-label': 'Namespace showcase' } },
    namespaces.map((namespace) => {
      const canvas = el('canvas', { class: 'art' });
      registerCanvas(canvas, () =>
        drawShowcase(canvas, namespace.hex, sharesByNamespace.get(namespace.hex) ?? []),
      );
      return el('li', { class: 'showcase-card' }, [
        canvas,
        el('h3', { text: namespace.name }),
        el('p', { class: 'hex', text: namespace.hex }),
        el('p', {
          class: 'muted',
          text: `${namespace.blobCount} ${namespace.blobCount === 1 ? 'blob' : 'blobs'}`,
        }),
      ]);
    }),
  );

  const marqueeTrack = el('div', { class: 'marquee-track' });
  for (const pass of [0, 1]) {
    for (const validator of validators) {
      marqueeTrack.appendChild(
        el('span', {
          class: 'monogram',
          attrs: { 'aria-hidden': pass === 1 ? 'true' : null },
          text: validator.name.slice(0, 2).toUpperCase(),
        }),
      );
    }
  }
  const marquee = el(
    'section',
    { class: 'marquee', attrs: { 'aria-label': 'Validators' } },
    marqueeTrack,
  );

  const band = el(
    'section',
    { class: 'band' },
    el('div', { class: 'container stack-lg' }, [
      el('div', {}, [
        splitHeading('h2', 'Namespaces'),
        el('p', {
          class: 'muted entrance',
          data: { entranceIndex: 1 },
          text: 'Every namespace draws its own strand pattern from the shares it owns.',
        }),
      ]),
      showcase,
      marquee,
      el(
        'a',
        { class: 'pill pill-outline entrance', data: { entranceIndex: 2 }, attrs: { href: `/w/${id}/submit` } },
        'Register a namespace',
      ),
    ]),
  );

  const confidenceOf = (nodeId: string): string =>
    stats.nodes.find((node) => node.id === nodeId)?.confidence ?? '0.0000';

  const spotlights = el(
    'section',
    { class: 'container section stack-lg', attrs: { 'aria-label': 'Light nodes' } },
    [
      splitHeading('h2', 'Light nodes'),
      ...nodes.map((node, index) => {
        const canvas = el('canvas', { class: 'ring' });
        registerCanvas(canvas, () => drawRing(canvas, Number(confidenceOf(node.id))));
        return el('article', { class: `spotlight${index % 2 === 1 ? ' flip' : ''}` }, [
          el('div', {}, [
            el('h3', { text: node.name }),
            el('p', { text: `Confidence ${confidenceOf(node.id)}%` }),
            el('p', {
              class: 'muted',
              text: node.autoSample ? 'Auto-sampling every new block.' : 'Sampling on request.',
            }),
            el(
              'a',
              {
                class: 'pill pill-primary',
                attrs: { href: `/w/${id}/nodes/${node.id}`, 'aria-label': `Open ${node.name}` },
              },
              [`Open ${node.name}`, el('span', { class: 'arrow', attrs: { 'aria-hidden': 'true' } }, '\u2192')],
            ),
          ]),
          canvas,
        ]);
      }),
    ],
  );

  const waveShares = [...sharesByNamespace.values()].flat().slice(0, 4);

  context.main.append(
    hero,
    statTrio,
    el('div', { class: 'container section-tight stack' }, [banners, producerPanel, mempoolText]),
    el('div', { class: 'container stack' }, [blocksTable, namespacesTable]),
    band,
    spotlights,
    consoleFooter(waveShares),
  );

  observeEntrances(context.main);
  initSplitHeadings(context.main);
  initMarquee(marquee);

  context.subscribe((event) => {
    if (event.kind === 'block') {
      announce(
        context.networkUpdates,
        blockAnnouncement(event.height, event.blobs, event.squareWidth),
      );
    }
    if (event.kind === 'rejected') announce(context.networkUpdates, rejectionCopy(event));
    if (event.kind === 'block' || event.kind === 'rejected' || event.kind === 'transactions') {
      context.refresh();
    }
  });
}
