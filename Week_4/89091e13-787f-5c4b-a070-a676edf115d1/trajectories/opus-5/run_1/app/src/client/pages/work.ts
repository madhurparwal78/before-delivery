import {
  Blob,
  BlockSummary,
  FeeEstimate,
  get,
  LightNode,
  Namespace,
  request,
  SamplesResponse,
  StakingMe,
} from '../api.js';
import { drawRing, registerCanvas } from '../art.js';
import { copyPill, el, emptyState, field, table } from '../dom.js';
import { observeEntrances } from '../motion.js';
import { PageContext } from '../router.js';
import { announce, consoleFooter } from '../shell.js';
import { blockAnnouncement, rejectionCopy } from '../../shared/live.js';
import { gasForShares } from '../../shared/fees.js';
import { truncateId } from '../../shared/format.js';
import { shareCount } from '../../shared/shares.js';
import {
  buildForm,
  fern,
  outageBanner,
  roleRefusal,
  selectBox,
  submitJson,
  textArea,
  textbox,
} from './common.js';

const BLOB_SUBMITTED = 'Blob submitted. It is pending until a block includes it.';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function renderSubmit(context: PageContext): Promise<void> {
  const id = context.workspace.id;
  const [namespaces, blobs, staking] = await Promise.all([
    get<Namespace[]>(`/api/w/${id}/namespaces`),
    get<Blob[]>(`/api/w/${id}/blobs?mine=true`),
    get<StakingMe>(`/api/w/${id}/staking/me`),
  ]);

  const nameInput = textbox('register-name', 'name', { placeholder: 'Beacon' });
  const hexInput = textbox('register-hex', 'hex', { placeholder: '00000000000000e500' });
  const registerForm = buildForm({
    name: 'Register namespace',
    heading: 'Register namespace',
    statusName: 'Register namespace status',
    submitLabel: 'Register namespace',
    role: context.workspace.role,
    scope: 'transaction',
    fields: [
      field('register-name', 'Namespace name', nameInput),
      field('register-hex', 'Namespace hex', hexInput, '9 bytes as 18 lowercase hex characters.'),
    ],
    onSubmit: async () => {
      const name = nameInput.value.trim();
      await submitJson(`/api/w/${id}/namespaces`, { name, hex: hexInput.value.trim() });
      context.refresh();
      return `Namespace ${name} registered.`;
    },
  });

  const namespaceSelect = selectBox(
    'blob-namespace',
    'namespace',
    'Namespace',
    namespaces.map((namespace) => ({ value: namespace.hex, label: namespace.name })),
  );
  const dataInput = textArea('blob-data', 'data');
  const fileInput = el('input', {
    attrs: { id: 'blob-file', name: 'blob-file', type: 'file' },
  }) as HTMLInputElement;
  const feeInput = textbox('blob-fee', 'fee');
  const estimate = el('section', {
    class: 'panel',
    attrs: { 'aria-label': 'Blob estimate' },
  });
  const sizeLine = el('p');
  const sharesLine = el('p');
  const gasLine = el('p');
  const feeLine = el('p');
  estimate.append(sizeLine, sharesLine, gasLine, feeLine);

  let feeEdited = false;
  let uploaded: Uint8Array | null = null;
  let estimateSequence = 0;
  feeInput.addEventListener('input', () => {
    feeEdited = true;
  });

  const bytesOf = (): Uint8Array =>
    uploaded ?? new TextEncoder().encode(dataInput.value);

  const updateEstimate = (): void => {
    const size = bytesOf().length;
    const shares = shareCount(size);
    const gas = gasForShares(shares);
    sizeLine.textContent = `Size ${size} bytes`;
    sharesLine.textContent = `Shares ${shares}`;
    gasLine.textContent = `Gas ${gas}`;
    const sequence = ++estimateSequence;
    void request<FeeEstimate>(`/api/w/${id}/fee-estimate?bytes=${size}`).then((result) => {
      if (sequence !== estimateSequence || result.status !== 200) return;
      const minimum = fern(result.body.feeUfern);
      feeLine.textContent = `Fee ${minimum} FERN`;
      if (!feeEdited) feeInput.value = minimum;
    });
  };
  dataInput.addEventListener('input', updateEstimate);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) {
      uploaded = null;
      updateEstimate();
      return;
    }
    void file.arrayBuffer().then((buffer) => {
      uploaded = new Uint8Array(buffer);
      updateEstimate();
    });
  });

  const blobForm = buildForm({
    name: 'Submit blob',
    heading: 'Submit blob',
    statusName: 'Submit blob status',
    submitLabel: 'Submit blob',
    role: context.workspace.role,
    scope: 'transaction',
    fields: [
      field('blob-namespace', 'Namespace', namespaceSelect),
      field('blob-data', 'Data', dataInput),
      field('blob-file', 'Upload file', fileInput),
      estimate,
      field('blob-fee', 'Fee (FERN)', feeInput),
    ],
    onSubmit: async () => {
      await submitJson(`/api/w/${id}/blobs`, {
        namespace: namespaceSelect.value,
        dataBase64: toBase64(bytesOf()),
        fee: feeInput.value.trim(),
      });
      dataInput.value = '';
      uploaded = null;
      feeEdited = false;
      updateEstimate();
      context.refresh();
      return BLOB_SUBMITTED;
    },
    onFailure: (status, copy) => {
      if (status === 503) outageBanner(context.main, copy);
    },
  });

  const yourBlobs = el('div', {}, [
    table(
      'Your blobs',
      ['Blob', 'Namespace', 'Size', 'Fee', 'Status'],
      blobs.map((blob) => [
        el('span', {}, [
          el('a', { attrs: { href: `/w/${id}/blobs/${blob.id}` } }, truncateId(blob.id)),
          ' ',
          copyPill(blob.id),
        ]),
        blob.namespaceName,
        `${blob.size} bytes`,
        `${fern(blob.feeUfern)} FERN`,
        blob.statusText,
      ]),
      'No blobs yet.',
    ),
    blobs.length === 0 ? emptyState('No blobs yet.', 'Submit a blob', `/w/${id}/submit`) : null,
  ]);

  context.main.append(
    el('div', { class: 'container stack' }, [
      el('h1', { class: 'page-title', text: 'Submit' }),
      el('p', { text: `Available ${fern(staking.availableUfern)} FERN` }),
      registerForm.form,
      blobForm.form,
      yourBlobs,
    ]),
    consoleFooter([]),
  );
  updateEstimate();
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

export async function renderNodeList(context: PageContext): Promise<void> {
  const id = context.workspace.id;
  const nodes = await get<LightNode[]>(`/api/w/${id}/light-nodes`);
  context.main.append(
    el('div', { class: 'container stack-lg' }, [
      el('h1', { class: 'page-title', text: 'Light nodes' }),
      ...nodes.map((node, index) => {
        const canvas = el('canvas', { class: 'ring' });
        registerCanvas(canvas, () => drawRing(canvas, 0));
        return el(
          'article',
          { class: `spotlight${index % 2 === 1 ? ' flip' : ''}`, attrs: { 'aria-label': node.name } },
          [
            el('div', {}, [
              el('h3', { text: node.name }),
              el('p', { class: 'muted', text: `Node number ${node.number}` }),
              el(
                'a',
                { class: 'pill pill-primary', attrs: { href: `/w/${id}/nodes/${node.id}` } },
                `Open ${node.name}`,
              ),
            ]),
            canvas,
          ],
        );
      }),
    ]),
    consoleFooter([]),
  );
  observeEntrances(context.main);
  context.subscribe((event) => {
    if (event.kind === 'light-node') context.refresh();
  });
}

export async function renderNode(context: PageContext): Promise<void> {
  const id = context.workspace.id;
  const nodeId = context.params.nodeId;
  const [nodes, blocks] = await Promise.all([
    get<LightNode[]>(`/api/w/${id}/light-nodes`),
    get<BlockSummary[]>(`/api/w/${id}/blocks`),
  ]);
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error('unknown light node');

  let picked = false;
  let selected = blocks[0].height;

  const blockSelect = selectBox(
    'node-block',
    'height',
    'Block',
    blocks.map((block) => ({ value: String(block.height), label: `Block ${block.height}` })),
  );
  blockSelect.value = String(selected);
  blockSelect.addEventListener('change', () => {
    picked = true;
    selected = Number(blockSelect.value);
    void refreshSamples();
  });

  const confidenceText = el('p', { text: 'Confidence 0.0000%' });
  const samplesHost = el('div');
  const samplingUpdates = el('p', {
    class: 'status-area',
    attrs: { role: 'status', 'aria-label': 'Sampling updates', 'aria-live': 'polite' },
  });
  const announced = new Set<string>();
  const ring = el('canvas', { class: 'ring' });

  const takeButton = el(
    'button',
    {
      class: 'pill pill-primary',
      attrs: { type: 'button' },
      on: {
        click: () => {
          takeButton.setAttribute('disabled', '');
          takeButton.setAttribute('aria-busy', 'true');
          void submitJson(`/api/w/${id}/light-nodes/${nodeId}/samples`, { height: selected })
            .catch(() => undefined)
            .then(() => refreshSamples())
            .finally(() => {
              takeButton.removeAttribute('disabled');
              takeButton.removeAttribute('aria-busy');
            });
        },
      },
    },
    'Take sample',
  );

  const autoSwitch = el(
    'button',
    {
      class: 'switch',
      attrs: { type: 'button', role: 'switch', 'aria-checked': node.autoSample ? 'true' : 'false' },
      on: {
        click: () => {
          const next = autoSwitch.getAttribute('aria-checked') !== 'true';
          void submitJson(
            `/api/w/${id}/light-nodes/${nodeId}`,
            { autoSample: next },
            'PATCH',
          ).then(() => {
            autoSwitch.setAttribute('aria-checked', next ? 'true' : 'false');
          });
        },
      },
    },
    [el('span', { class: 'track', attrs: { 'aria-hidden': 'true' } }), 'Auto-sample'],
  );

  const controls = el('div', { class: 'row' }, [takeButton, autoSwitch]);
  const refusal = roleRefusal(context.workspace.role, 'transaction');
  if (refusal) {
    controls.appendChild(el('p', { class: 'field-note', attrs: { id: 'node-role' }, text: refusal }));
    for (const control of [takeButton, autoSwitch]) {
      control.setAttribute('disabled', '');
      control.setAttribute('aria-describedby', 'node-role');
    }
  }

  async function refreshSamples(): Promise<void> {
    const response = await get<SamplesResponse>(
      `/api/w/${id}/light-nodes/${nodeId}/samples?height=${selected}`,
    );
    confidenceText.textContent = `Confidence ${response.confidence}%`;
    samplesHost.replaceChildren(
      table(
        'Samples',
        ['Sample', 'Share', 'Served', 'Confidence'],
        response.samples.map((sample) => [
          String(sample.index),
          `(${sample.row}, ${sample.col})`,
          sample.served ? 'Yes' : 'Withheld',
          `${sample.confidence}%`,
        ]),
        'No samples yet.',
      ),
    );
    drawRing(ring, Number(response.confidence));
    for (const sample of response.samples) {
      const key = `${selected}:${sample.index}`;
      if (announced.has(key)) continue;
      announced.add(key);
      samplingUpdates.appendChild(
        el('span', {
          text: sample.served
            ? `Sample ${sample.index}: share (${sample.row}, ${sample.col}) available. Confidence ${sample.confidence}%. `
            : `Sample ${sample.index}: share (${sample.row}, ${sample.col}) withheld. Block ${selected} is unavailable. `,
        }),
      );
    }
  }

  const panel = el('article', { class: 'spotlight', attrs: { 'aria-label': node.name } }, [
    el('div', { class: 'stack' }, [
      el('h1', { class: 'page-title', text: node.name }),
      field('node-block', 'Block', blockSelect),
      controls,
      confidenceText,
      samplingUpdates,
      samplesHost,
    ]),
    ring,
  ]);
  registerCanvas(ring, () => drawRing(ring, 0));

  context.main.append(el('div', { class: 'container stack' }, panel), consoleFooter([]));
  await refreshSamples();
  observeEntrances(context.main);

  context.subscribe((event) => {
    if (event.kind === 'block') {
      announce(
        context.networkUpdates,
        blockAnnouncement(event.height, event.blobs, event.squareWidth),
      );
      blockSelect.appendChild(
        el('option', { attrs: { value: String(event.height) } }, `Block ${event.height}`),
      );
      if (!picked) {
        selected = event.height;
        blockSelect.value = String(event.height);
      }
      void refreshSamples();
    }
    if (event.kind === 'rejected') announce(context.networkUpdates, rejectionCopy(event));
    if (event.kind === 'sample' && event.nodeId === nodeId && event.height === selected) {
      void refreshSamples();
    }
  });
}
