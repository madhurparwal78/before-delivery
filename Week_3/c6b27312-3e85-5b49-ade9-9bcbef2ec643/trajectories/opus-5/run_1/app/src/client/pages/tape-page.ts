import { ApiCallError, RevisionResponse, Solid, TapeResponse, KeyedAction, NoAnswerError, me, send } from '../api';
import { all, clear, el, find, on } from '../dom';
import { BuildTape } from '../tape';
import { Viewport } from '../viewport';
import { Dialog, markStorageDependent, showStorageBanner } from '../ui';
import { bboxText, volumeMm3 } from '../../shared/numbers';
import { boxOfBbox } from '../../shared/pose';
import { bodyHeight, opMesh, stepDifference } from '../mesh';

export async function mountTapePage(host: HTMLElement): Promise<void> {
  const revisionId = host.dataset.revision ?? '';
  const slug = host.dataset.slug ?? '';
  const label = host.dataset.label ?? '';
  const viewer = await me();
  const tapeAnswer = await send<TapeResponse>(`/api/revisions/${revisionId}/tape`);
  const partAnswer = await send<{
    slug: string;
    title: string;
    source: string;
    owner: { id: string };
  }>(`/api/parts/${slug}?revision=${revisionId}`);
  const part = partAnswer.data;
  const owner = viewer !== null && viewer.id === part.owner.id;

  const viewport = new Viewport({
    epochKey: `tinework:epoch:tape:${revisionId}`,
    fallbackAlt: `${part.title}, ${label}`,
  });
  const readouts = el('div', { class: 'readouts' });
  const sourceLines = el('ol', { class: 'source-lines' });
  const sourcePane = el('section', { class: 'source-pane', 'aria-label': 'Tine source' }, [
    el('h2', { class: 'section-title' }, ['Source']),
    sourceLines,
  ]);

  const tape = new BuildTape({
    owner,
    onMove: (index) => void show(index),
    onFork: (index) => openFork(index),
  });

  host.append(el('div', { class: 'tape-main' }, []), tape.root, readouts, sourcePane);
  const main = find<HTMLElement>('.tape-main', host)!;
  viewport.mount(main);

  for (const [index, line] of part.source.split('\n').entries()) {
    sourceLines.append(el('li', { 'data-line': index + 1, class: 'source-line' }, [line]));
  }

  const cache = new Map<string, Solid>();
  async function storedSolid(digest: string): Promise<Solid> {
    const cached = cache.get(digest);
    if (cached) return cached;
    const answer = await send<Solid>(`/api/solids/${digest}`);
    cache.set(digest, answer.data);
    return answer.data;
  }

  function facesOf(solid: Solid): number {
    let faces = 0;
    for (const op of solid.ops) {
      if (op.op === 'box') faces += 6;
      else if (op.op === 'cylinder') faces += 3;
      else if (op.op === 'boss') faces += 2;
      else if (op.op === 'hole') faces += 1;
      else faces += 4;
    }
    return faces;
  }

  let posed = false;

  /** The viewport replays each stored snapshot, never a recomputed one. */
  async function show(index: number): Promise<void> {
    const operation = tapeAnswer.data.operations[index];
    if (!operation) return;
    try {
      const solid = await storedSolid(operation.digest);
      const previous = index > 0 ? await storedSolid(tapeAnswer.data.operations[index - 1].digest) : null;
      const difference = stepDifference(previous, solid);
      const height = bodyHeight(solid);
      viewport.setOutage(false, '');
      viewport.setSolid(solid, {
        crossfade: posed,
        extraLayers: [
          ...difference.added.map((op) => viewport.accentLayer(opMesh(op, height))),
          ...difference.removed.map((op) => viewport.ghostLayer(opMesh(op, height))),
        ],
      });
      if (!posed) {
        viewport.setDefaultPose(viewport.poseForBox(boxOfBbox(operation.bbox)), true);
        posed = true;
      }
      viewport.setReadouts({
        digest: operation.digest,
        volume: operation.volume,
        bbox: operation.bbox,
        faces: facesOf(solid),
        tapeOperation: index,
      });
      viewport.paint();
      clear(readouts);
      readouts.append(
        el('span', {}, [`Volume ${volumeMm3(operation.volume)}`]),
        el('span', {}, [`Bounding box ${bboxText(operation.bbox)}`]),
        el('span', {}, [`Faces ${facesOf(solid)}`]),
        el('span', {}, [`Digest ${operation.digest}`]),
      );
      for (const node of all('.source-line', sourceLines)) {
        if (operation.line !== null && node.getAttribute('data-line') === String(operation.line)) {
          node.setAttribute('aria-current', 'true');
        } else {
          node.removeAttribute('aria-current');
        }
      }
      const pins = (tapeAnswer.data.preflight?.findings ?? [])
        .filter((finding) => finding.severity !== 'Pass' && finding.operation <= index)
        .map((finding) => ({ point: finding.pose.target, kind: 'finding-pin', label: finding.message }));
      viewport.setPins(pins);
    } catch (error) {
      if (error instanceof ApiCallError && error.failure.code === 'storage_unavailable') {
        showStorageBanner();
        viewport.setOutage(true, 'Last good solid: none yet');
      }
    }
  }

  const forkAction = new KeyedAction();

  function openFork(index: number): void {
    const bodyIndex = tapeAnswer.data.operations.findIndex((operation) => operation.kind === 'body');
    const fork = el('button', { type: 'button', class: 'button-primary' }, ['Fork']);
    const cancel = el('button', { type: 'button' }, ['Cancel']);
    const dialog = new Dialog(
      `Fork from operation ${index}?`,
      [el('p', {}, [`The new revision keeps operations 0 to ${index} and drops the rest.`])],
      [fork, cancel],
    );
    markStorageDependent(fork);
    if (index < bodyIndex) fork.setAttribute('aria-disabled', 'true');
    on(cancel, 'click', () => dialog.close());
    on(fork, 'click', async () => {
      if (fork.getAttribute('aria-disabled') === 'true') return;
      const body = { operation: index };
      try {
        const head = await send<{ revisions: RevisionResponse[] }>(`/api/parts/${slug}/revisions`);
        const result = await send<RevisionResponse>(`/api/revisions/${revisionId}/fork`, {
          method: 'POST',
          body,
          headers: {
            'If-Match': `"${head.data.revisions[0].id}"`,
            'Idempotency-Key': forkAction.keyFor(body),
          },
        });
        forkAction.settled();
        window.location.assign(`/parts/${slug}?revision=${result.data.id}&operation=${index}`);
      } catch (error) {
        if (error instanceof NoAnswerError) return;
        forkAction.settled();
        if (error instanceof ApiCallError) dialog.message(error.failure.message, 'alert');
      }
    });
  }

  tape.setOperations(tapeAnswer.data.operations, tapeAnswer.data.operations.length - 1);
  await show(tapeAnswer.data.operations.length - 1);
}
