import {
  Blob,
  BlockDetail,
  FraudProof,
  get,
  Namespace,
  NmtNode,
  ProofsResponse,
  SharesResponse,
  Transaction,
} from '../api.js';
import { drawStage, registerCanvas } from '../art.js';
import { copyPill, definitionList, el, field, splitHeading, table } from '../dom.js';
import { initSplitHeadings, initSquareWalk, observeEntrances } from '../motion.js';
import { PageContext } from '../router.js';
import { announce, consoleFooter } from '../shell.js';
import { namespaceLegend, noteLiveArrival, renderSquare, takeLiveArrival } from '../square.js';
import { blockAnnouncement, rejectionCopy } from '../../shared/live.js';
import { truncateId } from '../../shared/format.js';
import { proofLine, RowProof, rootFromRowProof } from '../../shared/proofs.js';
import { validateNamespaceFormat } from '../../shared/namespace.js';
import {
  dateTime,
  fern,
  namespaceNames,
  outageBanner,
  rejectionBanner,
  STORAGE_SNAPSHOT_COPY,
} from './common.js';


function statusLabel(status: BlockDetail['status']): string {
  if (status === 'sampling') return 'Sampling';
  return status === 'available' ? 'Available' : 'Rejected';
}

function rootItem(kind: 'Row' | 'Column', index: number, root: NmtNode): HTMLElement {
  return el(
    'li',
    { data: { min: root.min, max: root.max, hash: root.hash } },
    [
      el('span', { class: 'label', text: `${kind} ${index}` }),
      el('span', { class: 'mono', text: `min ${root.min} max ${root.max} ${root.hash}` }),
    ],
  );
}

async function squareOf(
  id: string,
  height: number,
): Promise<{
  detail: BlockDetail;
  shares: SharesResponse;
  names: Map<string, string>;
  mine: Set<string>;
}> {
  const [detail, shares, namespaces, myBlobs] = await Promise.all([
    get<BlockDetail>(`/api/w/${id}/blocks/${height}`),
    get<SharesResponse>(`/api/w/${id}/blocks/${height}/shares`),
    get<Namespace[]>(`/api/w/${id}/namespaces`),
    get<Blob[]>(`/api/w/${id}/blobs?mine=true`),
  ]);
  const mineIds = new Set(myBlobs.map((blob) => blob.id));
  const mine = new Set<string>();
  for (const blob of detail.blobs) {
    if (!mineIds.has(blob.id)) continue;
    for (const [row, col] of blob.positions) mine.add(`${row},${col}`);
  }
  return { detail, shares, names: namespaceNames(namespaces), mine };
}

/** The square walk cards: Lay out, Extend and Commit for this block. */
function squareWalk(detail: BlockDetail, shares: SharesResponse, mine: Set<string>): HTMLElement {
  const k = detail.squareWidth;
  const namespaces: string[][] = [];
  for (let r = 0; r < k; r++) {
    namespaces.push(shares.rows[r].slice(0, k).map((cell) => cell.namespace));
  }
  const stages: {
    kind: 'lay-out' | 'extend' | 'commit';
    title: string;
    copy: string;
    cells?: number;
    ticks?: number;
  }[] = [
    {
      kind: 'lay-out',
      title: 'Lay out',
      copy: `Shares are ordered by namespace, then by submission order, then tail padding, and laid row by row into the ${k} × ${k} original square.`,
      cells: k * k,
    },
    {
      kind: 'extend',
      title: 'Extend',
      copy: `Reed-Solomon over GF(2^8) grows the square to ${2 * k} × ${2 * k}: row parity, column parity, and parity of parity.`,
      cells: 4 * k * k,
    },
    {
      kind: 'commit',
      title: 'Commit',
      copy: `${2 * k} row roots and ${2 * k} column roots are hashed into one data root.`,
      ticks: 4 * k,
    },
  ];

  const list = el(
    'ul',
    { class: 'walk-list', attrs: { 'aria-label': 'Square walk' } },
    stages.map((stage) => {
      const canvas = el('canvas', {
        class: 'stage',
        data: { cells: stage.cells, ticks: stage.ticks },
      });
      registerCanvas(canvas, () =>
        drawStage(canvas, {
          kind: stage.kind,
          k,
          mine,
          dataRoot: detail.dataRoot,
          namespaces,
        }),
      );
      const article = el(
        'article',
        {
          class: 'walk-card',
          attrs: { tabindex: 0, 'aria-label': stage.title },
          data: { state: 'hidden' },
        },
        [
          el('h3', { text: stage.title }),
          el('p', { class: 'walk-copy', text: stage.copy }),
          canvas,
        ],
      );
      if (stage.kind === 'commit') {
        article.appendChild(
          el('p', { class: 'stage-root', text: `Data root ${detail.dataRoot}` }),
        );
      }
      return el('li', {}, article);
    }),
  );

  return el(
    'section',
    { class: 'walk-section' },
    el('div', { class: 'container walk-sticky stack' }, [splitHeading('h2', 'Square walk'), list]),
  );
}

export async function renderBlock(context: PageContext): Promise<void> {
  const id = context.workspace.id;
  const height = Number(context.params.height);
  const { detail, shares, names, mine } = await squareOf(id, height);
  const blobs = await Promise.all(
    detail.blobs.map((blob) => get<Blob>(`/api/w/${id}/blobs/${blob.id}`)),
  );
  const fraud =
    detail.rejection?.reason === 'bad-encoding'
      ? await get<FraudProof>(`/api/w/${id}/blocks/${height}/fraud-proof`)
      : null;

  const arrived = takeLiveArrival(height);
  const square = renderSquare({
    height,
    k: shares.k,
    rows: shares.rows,
    namespaceNames: names,
    mine,
    outline: new Set(),
    revealImmediately: !arrived,
  });

  const facts = definitionList('Block facts', [
    ['Time', dateTime(detail.producedAt)],
    ['Status', statusLabel(detail.status)],
    ['Square width', `${detail.squareWidth} × ${detail.squareWidth}`],
    ['Data root', el('span', { class: 'mono', text: `Data root ${detail.dataRoot}` })],
  ]);

  const rowRoots = el(
    'ul',
    { class: 'list roots-list', attrs: { 'aria-label': 'Row roots' } },
    detail.rowRoots.map((root, index) => rootItem('Row', index, root)),
  );
  const columnRoots = el(
    'ul',
    { class: 'list roots-list', attrs: { 'aria-label': 'Column roots' } },
    detail.columnRoots.map((root, index) => rootItem('Column', index, root)),
  );

  const snapshotStatus = el('p', {
    class: 'status-area',
    attrs: { role: 'status', 'aria-label': 'Snapshot status', 'aria-live': 'polite' },
  });
  const snapshotButton = el(
    'button',
    {
      class: 'pill pill-outline',
      attrs: { type: 'button' },
      on: {
        click: () => {
          snapshotStatus.textContent = 'Downloading snapshot…';
          void fetch(`/api/w/${id}/blocks/${height}/snapshot`, { credentials: 'same-origin' })
            .then(async (response) => {
              if (response.status === 503) {
                snapshotStatus.textContent = STORAGE_SNAPSHOT_COPY;
                outageBanner(context.main, STORAGE_SNAPSHOT_COPY);
                return;
              }
              const bytes = await response.blob();
              const url = URL.createObjectURL(bytes);
              const anchor = el('a', {
                attrs: { href: url, download: `block-${height}-square.bin` },
              });
              document.body.appendChild(anchor);
              anchor.click();
              anchor.remove();
              URL.revokeObjectURL(url);
              snapshotStatus.textContent = 'Snapshot ready.';
            })
            .catch(() => {
              snapshotStatus.textContent = STORAGE_SNAPSHOT_COPY;
              outageBanner(context.main, STORAGE_SNAPSHOT_COPY);
            });
        },
      },
    },
    'Download square snapshot',
  );

  const blobsTable = table(
    'Blobs in this block',
    ['Blob', 'Namespace', 'Size', 'Shares', 'Status'],
    blobs.map((blob) => [
      el('span', {}, [
        el('a', { attrs: { href: `/w/${id}/blobs/${blob.id}` } }, truncateId(blob.id)),
        ' ',
        copyPill(blob.id),
      ]),
      blob.namespaceName,
      `${blob.size} bytes`,
      String(blob.shares),
      blob.statusText,
    ]),
    'No blobs in this block.',
  );

  const proofRegion = el('section', {
    class: 'panel',
    attrs: { 'aria-label': 'Namespace proof' },
  });
  const proveInput = el('input', {
    attrs: {
      id: 'namespace-to-prove',
      name: 'namespace-to-prove',
      type: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: '00000000000000b200',
    },
  }) as HTMLInputElement;
  const proveAlert = el('p', { class: 'alert-area', attrs: { role: 'alert' } });

  const runProof = (): void => {
    proveAlert.textContent = '';
    proofRegion.replaceChildren();
    const namespace = proveInput.value.trim().toLowerCase();
    const refusal = validateNamespaceFormat(namespace);
    if (refusal) {
      proveAlert.textContent = refusal;
      const error = document.getElementById('namespace-to-prove-error');
      if (error) error.textContent = refusal;
      proveInput.focus();
      return;
    }
    void get<ProofsResponse>(`/api/w/${id}/blocks/${height}/proofs?namespace=${namespace}`).then(
      (response) => {
        proofRegion.replaceChildren(el('h3', { text: `Namespace ${namespace}` }));
        for (const proof of response.rows) {
          const nodes = proof.kind === 'outside' ? [] : proof.nodes;
          const line = el('p', { text: proofLine(proof, nodes.length) });
          const verdict = el('span', { class: 'muted' });
          proofRegion.append(line);
          if (proof.kind === 'absence') {
            proofRegion.append(
              el('p', { class: 'mono', text: `Next leaf hash ${proof.nextLeaf.hash}` }),
            );
          }
          if (proof.kind !== 'outside') {
            proofRegion.append(
              el(
                'ul',
                { class: 'list', attrs: { 'aria-label': `Row ${proof.row} proof nodes` } },
                nodes.map((node) =>
                  el(
                    'li',
                    { data: { min: node.min, max: node.max, hash: node.hash } },
                    el('span', { class: 'mono', text: node.hash }),
                  ),
                ),
              ),
              el(
                'div',
                { class: 'row' },
                [
                  el(
                    'button',
                    {
                      class: 'pill pill-outline',
                      attrs: { type: 'button' },
                      on: {
                        click: () => {
                          verdict.textContent = verifyRow(proof, detail.rowRoots, detail.squareWidth);
                        },
                      },
                    },
                    `Verify row ${proof.row}`,
                  ),
                  verdict,
                ],
              ),
            );
          }
        }
      },
    );
  };

  const proveForm = el(
    'form',
    { class: 'form-panel', attrs: { 'aria-label': 'Prove namespace', novalidate: true } },
    [
      proveAlert,
      field('namespace-to-prove', 'Namespace to prove', proveInput),
      el('button', { class: 'pill pill-primary', attrs: { type: 'submit' } }, 'Prove namespace'),
    ],
  ) as HTMLFormElement;
  proveForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runProof();
  });

  const content = el('div', { class: 'container stack' }, [
    el('h1', { class: 'page-title', text: `Block ${height}` }),
    facts,
    detail.rejection ? rejectionBanner(height, detail.rejection) : null,
    el('div', { class: 'block-grid' }, [
      el('div', { class: 'panel' }, square.frame),
      el('div', { class: 'panel' }, [el('h2', { text: 'Row roots' }), rowRoots]),
    ]),
    el('div', { class: 'panel' }, [el('h2', { text: 'Column roots' }), columnRoots]),
    el('div', { class: 'panel' }, [
      el('h2', { text: 'Namespace legend' }),
      namespaceLegend(shares.rows, shares.k, names),
    ]),
    el('div', { class: 'panel' }, [snapshotButton, snapshotStatus]),
    blobsTable,
    proveForm,
    proofRegion,
    fraud ? fraudPanel(fraud, detail.squareWidth) : null,
  ]);

  context.main.append(content, squareWalk(detail, shares, mine), consoleFooter([]));

  if (arrived) square.revealRows();
  observeEntrances(context.main);
  initSplitHeadings(context.main);
  initSquareWalk(context.main.querySelector('.walk-section') as HTMLElement);

  context.subscribe((event) => {
    if (event.kind === 'block') {
      noteLiveArrival(event.height);
      announce(
        context.networkUpdates,
        blockAnnouncement(event.height, event.blobs, event.squareWidth),
      );
    }
    if (event.kind === 'rejected') {
      announce(context.networkUpdates, rejectionCopy(event));
      if (event.height === height) context.refresh();
    }
    if (event.kind === 'fraud-proof' && event.height === height) context.refresh();
    if (event.kind === 'transactions') context.refresh();
  });
}

function verifyRow(proof: RowProof, rowRoots: NmtNode[], k: number): string {
  const recomputed = rootFromRowProof(k, proof);
  const row = proof.row;
  const committed = rowRoots[row];
  return recomputed !== null && recomputed.hash === committed.hash
    ? `Verified against row ${row} root.`
    : `Proof does not match row ${row} root.`;
}

/** The Bad encoding fraud proof panel, in the published order. */
function fraudPanel(proof: FraudProof, k: number): HTMLElement {
  const axisWord = proof.axis === 'row' ? 'Row' : 'Column';
  const crossWord = proof.axis === 'row' ? 'column roots' : 'row roots';
  return el(
    'section',
    { class: 'panel', attrs: { 'aria-label': 'Bad encoding fraud proof' } },
    [
      el('h2', { text: 'Bad encoding fraud proof' }),
      el('p', { text: `${axisWord} ${proof.index} of block ${proof.height}` }),
      el('p', {
        text: `${proof.shares.filter((share) => share.verified).length} of ${k} shares verified against ${crossWord}`,
      }),
      el('p', { class: 'mono', text: `Committed ${proof.axis} root ${proof.committedRoot.hash}` }),
      el('p', { class: 'mono', text: `Recomputed ${proof.axis} root ${proof.recomputedRoot.hash}` }),
      el('p', {
        text: `${axisWord} ${proof.index} is not encoded correctly. Block ${proof.height} rejected.`,
      }),
    ],
  );
}

export async function renderBlob(context: PageContext): Promise<void> {
  const id = context.workspace.id;
  const blob = await get<Blob>(`/api/w/${id}/blobs/${context.params.blobId}`);
  const facts: [string, string | HTMLElement][] = [
    ['Status', blob.statusText],
    ['Namespace', `${blob.namespaceName} ${blob.namespace}`],
    ['Size', `Size ${blob.size} bytes`],
    ['Shares', `Shares ${blob.shares}`],
    ['Fee', `Fee ${fern(blob.feeUfern)} FERN`],
  ];
  if (blob.height !== null) {
    facts.push([
      'Block',
      el('a', { attrs: { href: `/w/${id}/explorer/blocks/${blob.height}` } }, `Block ${blob.height}`),
    ]);
  }

  const positions = el(
    'ul',
    { class: 'list', attrs: { 'aria-label': 'Share positions' } },
    blob.positions.map((position) =>
      el('li', { text: `(${position[0]}, ${position[1]})` }),
    ),
  );

  const left = el('div', { class: 'panel stack' }, [
    el('h1', { class: 'page-title', text: `Blob ${blob.id.slice(0, 8)}` }),
    definitionList('Blob facts', facts),
    el('h2', { text: 'Share positions' }),
    positions,
  ]);

  let squareHost: HTMLElement = el('div');
  if (blob.height !== null) {
    const { shares, names, mine } = await squareOf(id, blob.height);
    const outline = new Set(blob.positions.map(([row, col]) => `${row},${col}`));
    const square = renderSquare({
      height: blob.height,
      k: shares.k,
      rows: shares.rows,
      namespaceNames: names,
      mine,
      outline,
      revealImmediately: true,
    });
    squareHost = el('div', { class: 'panel' }, square.frame);
  }

  context.main.append(
    el('div', { class: 'container stack' }, [
      el('div', { class: 'block-grid' }, [left, squareHost]),
    ]),
    consoleFooter([]),
  );
  observeEntrances(context.main);

  context.subscribe((event) => {
    if (event.kind === 'block') {
      announce(
        context.networkUpdates,
        blockAnnouncement(event.height, event.blobs, event.squareWidth),
      );
      context.refresh();
    }
    if (event.kind === 'rejected') {
      announce(context.networkUpdates, rejectionCopy(event));
      context.refresh();
    }
    if (event.kind === 'transactions') context.refresh();
  });
}

export async function renderTransaction(context: PageContext): Promise<void> {
  const id = context.workspace.id;
  const transaction = await get<Transaction>(
    `/api/w/${id}/transactions/${context.params.txId}`,
  );
  context.main.append(
    el('div', { class: 'container stack' }, [
      el('h1', { class: 'page-title', text: 'Transaction' }),
      el('div', { class: 'panel' }, [
        el('p', {}, [el('span', { class: 'mono', text: truncateId(transaction.id) }), ' ']),
        copyPill(transaction.id),
        definitionList('Transaction facts', [
          ['Kind', transaction.kind],
          ['Sender', transaction.senderName],
          ['Status', transaction.statusText],
          ['Fee', `${fern(transaction.feeUfern)} FERN`],
          ['Gas', String(transaction.gas)],
          ['Height', transaction.height === null ? '—' : String(transaction.height)],
          ['Time', dateTime(transaction.submittedAt)],
        ]),
      ]),
    ]),
    consoleFooter([]),
  );
  context.subscribe((event) => {
    if (event.kind === 'transactions' || event.kind === 'block') context.refresh();
  });
}
