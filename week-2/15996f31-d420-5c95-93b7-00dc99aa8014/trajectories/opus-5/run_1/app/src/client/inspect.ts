import type {
  InspectionBlock,
  InspectionSheet,
  SampleCreated,
  SampleRemoved,
  SignedReport,
} from '../shared/api-types';
import { formatMoney } from '../shared/format';
import { tierLabel } from '../shared/labels';
import { formatPacificDateTime } from '../shared/pacific';
import { ApiFailure, announceUpdate, clear, el, reducedMotion, request, runAction } from './core';
import { Dialog } from './dialog';
import { ErrorSummary, FormField, applyFieldMessages } from './forms';
import { Odometer } from './odometer';
import { PlatMap } from './platmap';
import { tierLegend } from './patterns';
import { StrengthPresenter, type BlockStrengthValues } from './strength';
import { ledgerTable } from './table';

const REFRESH_MS = 3_000;

const ASK_FOR_A_NEW_LINK = 'Ask the broker for a new link.';

function renderDeadLink(root: HTMLElement, body: string): void {
  root.append(
    el('main', { class: 'dead' }, [
      el('h1', { class: 'dead__title', text: 'This inspection link no longer works' }),
      el('p', { class: 'dead__body', text: body }),
    ]),
  );
}

interface SampleDraft {
  blockId: string;
  dropId: string;
  colonyLabel: string;
  frames: number;
}

export async function renderInspection(root: HTMLElement, token: string): Promise<void> {
  let sheet: InspectionSheet;
  try {
    sheet = await request<InspectionSheet>('GET', `/api/inspect/${token}`);
  } catch (error) {
    const failure = error instanceof ApiFailure ? error : null;
    renderDeadLink(
      root,
      failure !== null && failure.code === 'link_signed' ? failure.message : ASK_FOR_A_NEW_LINK,
    );
    return;
  }

  const payableOdometer = new Odometer('ledger__figure', formatMoney(sheet.payable_cents));
  const presenter = new StrengthPresenter(payableOdometer);
  const platmap = new PlatMap(sheet.orchard.name, () => undefined);
  const sectionsHost = el('div', { class: 'sheet__blocks' });
  const summary = new ErrorSummary();

  const blockField = new FormField({
    name: 'block_id',
    label: 'Block',
    kind: 'select',
    options: sheet.blocks.map((block) => ({ value: block.id, label: block.name })),
  });
  const yardField = new FormField({ name: 'drop_id', label: 'Yard', kind: 'select' });
  const colonyField = new FormField({ name: 'colony_label', label: 'Colony', kind: 'text' });
  const framesField = new FormField({
    name: 'frames',
    label: 'Frames of bees',
    kind: 'number',
    min: 0,
    max: 20,
    step: '0.1',
  });
  const photoField = new FormField({
    name: 'photo',
    label: 'Frame photo',
    kind: 'file',
    accept: 'image/jpeg,image/png,image/webp',
  });
  const addButton = el('button', {
    type: 'submit',
    class: 'button button--primary',
    text: 'Add sample',
  });
  addButton.dataset.label = 'Add sample';

  const signButton = el('button', {
    type: 'button',
    class: 'button button--primary',
    text: 'Sign report',
  });
  signButton.dataset.label = 'Sign report';

  function blockById(blockId: string): InspectionBlock | undefined {
    return sheet.blocks.find((block) => block.id === blockId);
  }

  function refreshYards(): void {
    const block = blockById(blockField.value);
    yardField.setOptions(
      (block?.yards ?? []).map((yard) => ({
        value: yard.drop_id,
        label: `${yard.yard_name} · ${yard.hives} hives`,
      })),
    );
  }
  blockField.control.addEventListener('change', refreshYards);

  const addForm = el('form', { class: 'add-sample', 'aria-label': 'Add sample', novalidate: true }, [
    el('h2', { class: 'section__title', text: 'Add sample' }),
    summary.element,
    blockField.wrapper,
    yardField.wrapper,
    colonyField.wrapper,
    framesField.wrapper,
    photoField.wrapper,
    addButton,
  ]);

  function paintSections(): void {
    clear(sectionsHost);
    for (const block of sheet.blocks) {
      const still = Math.max(block.samples_required - block.sample_count, 0);
      const section = el('section', { class: 'sheet__block', 'aria-label': block.name }, [
        el('h2', { class: 'sheet__block-title', text: block.name }),
        el('p', { class: 'sheet__block-facts' }, [
          el('span', {
            class: 'figure',
            text:
              block.average_frames === null
                ? 'Not inspected'
                : `${block.average_frames.toFixed(1)} frames`,
          }),
          el('span', { class: 'chip', 'data-tier': block.tier ?? 'none-yet', text: tierLabel(block.tier) }),
          el('span', {
            class: 'sheet__needed',
            text: `${block.sample_count} of ${block.samples_required} samples · ${still} still needed`,
          }),
          el('span', {
            class: 'sheet__yards',
            text: `Yards: ${block.yards.map((yard) => yard.yard_name).join(', ') || 'none'}`,
          }),
        ]),
      ]);
      const list = el('ul', { class: 'sheet__samples', 'aria-label': `Samples, ${block.name}` });
      for (const sample of block.samples) {
        const photoInput = el('input', {
          type: 'file',
          class: 'visually-hidden',
          accept: 'image/jpeg,image/png,image/webp',
          id: `photo-${sample.id}`,
        });
        const addPhoto = el('button', {
          type: 'button',
          class: 'button button--quiet',
          text: `Add photo to ${sample.colony_label}`,
        });
        addPhoto.dataset.label = `Add photo to ${sample.colony_label}`;
        addPhoto.addEventListener('click', () => photoInput.click());
        photoInput.addEventListener('change', () => {
          const file = photoInput.files?.[0];
          if (file === undefined) return;
          void uploadPhoto(sample.id, sample.colony_label, file, addPhoto);
        });
        const remove = el('button', {
          type: 'button',
          class: 'button button--quiet',
          text: `Remove sample ${sample.colony_label}`,
        });
        remove.dataset.label = `Remove sample ${sample.colony_label}`;
        remove.addEventListener('click', () => {
          void removeSample(block.id, sample.id, sample.colony_label, remove);
        });
        list.append(
          el('li', { class: 'sheet__sample' }, [
            el('span', { class: 'figure', text: `${sample.colony_label}: ${sample.frames.toFixed(1)} frames` }),
            el(
              'span',
              { class: 'sheet__sample-photos' },
              sample.photos.map((photo) =>
                el('img', {
                  class: 'photos__thumb',
                  src: photo.url,
                  alt: `Frame photo of colony ${sample.colony_label}`,
                  loading: 'lazy',
                }),
              ),
            ),
            addPhoto,
            photoInput,
            remove,
          ]),
        );
      }
      section.append(list);
      sectionsHost.append(section);
    }
  }

  function paintMap(): void {
    platmap.setBlocks(
      sheet.blocks.map((block) => ({
        id: block.id,
        name: block.name,
        acres: Math.max(block.hives_delivered, 1),
        averageFrames: block.average_frames,
        tier: block.tier,
      })),
    );
  }

  function applyBlockFigures(blockId: string, previous: BlockStrengthValues): void {
    const block = blockById(blockId);
    const cell = platmap.cell(blockId);
    if (block === undefined || cell === undefined) return;
    presenter.apply(
      cell,
      previous,
      { averageFrames: block.average_frames, tier: block.tier },
      sheet.payable_cents,
    );
  }

  async function reloadSheet(animateBlockId: string | null): Promise<void> {
    const fresh = await request<InspectionSheet>('GET', `/api/inspect/${token}`);
    const previous = new Map(sheet.blocks.map((block) => [block.id, block] as const));
    sheet = fresh;
    paintMap();
    paintSections();
    refreshYards();
    for (const block of sheet.blocks) {
      const before = previous.get(block.id);
      if (before === undefined) continue;
      const was = { averageFrames: before.average_frames, tier: before.tier };
      const changed =
        before.average_frames !== block.average_frames || before.tier !== block.tier;
      if (block.id === animateBlockId || changed) applyBlockFigures(block.id, was);
    }
    presenter.rollPayable(sheet.payable_cents, 0);
  }

  async function uploadPhoto(
    sampleId: string,
    colonyLabel: string,
    file: File,
    button: HTMLButtonElement,
  ): Promise<void> {
    const form = new FormData();
    form.append('photo', file);
    const result = await runAction({
      button,
      pending: 'Uploading photo…',
      run: () =>
        request<unknown>('POST', `/api/inspect/${token}/samples/${sampleId}/photos`, { form }),
      success: () => `Photo added to sample ${colonyLabel}.`,
      refusal: (failure) => {
        if (failure.status === 413) return 'Photos must be 8,000,000 bytes or smaller.';
        if (failure.status === 415) return 'Photos must be JPEG, PNG or WebP images.';
        if (failure.code === 'storage_unavailable') {
          return 'Photo storage is unreachable. The sample is saved without this photo; try again in a minute.';
        }
        return null;
      },
    });
    if (result !== null) await reloadSheet(null);
  }

  async function removeSample(
    blockId: string,
    sampleId: string,
    colonyLabel: string,
    button: HTMLButtonElement,
  ): Promise<void> {
    const result = await runAction({
      button,
      pending: `Removing sample ${colonyLabel}…`,
      run: () =>
        request<SampleRemoved>('DELETE', `/api/inspect/${token}/samples/${sampleId}`),
      success: () => `Sample ${colonyLabel} removed.`,
    });
    if (result === null) return;
    await reloadSheet(blockId);
  }

  function provisionalAverage(draft: SampleDraft): number {
    const block = blockById(draft.blockId);
    const frames = [...(block?.samples ?? []).map((sample) => sample.frames), draft.frames];
    const total = frames.reduce((sum, value) => sum + value, 0);
    return Math.round((total / frames.length) * 10) / 10;
  }

  addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const draft: SampleDraft = {
      blockId: blockField.value,
      dropId: yardField.value,
      colonyLabel: colonyField.value,
      frames: Number(framesField.value),
    };
    const cell = platmap.cell(draft.blockId);
    const before = blockById(draft.blockId);
    const previous = {
      averageFrames: before?.average_frames ?? null,
      tier: before?.tier ?? null,
    };
    if (cell !== undefined && Number.isFinite(draft.frames) && !reducedMotion()) {
      presenter.provisional(cell, provisionalAverage(draft));
    }
    const chosenPhoto = photoField.files?.[0];
    void runAction({
      button: addButton,
      pending: `Saving sample ${draft.colonyLabel}…`,
      run: () =>
        request<SampleCreated>('POST', `/api/inspect/${token}/samples`, {
          body: {
            block_id: draft.blockId,
            drop_id: draft.dropId,
            colony_label: draft.colonyLabel,
            frames: draft.frames,
          },
        }),
      success: () => `Sample ${draft.colonyLabel} saved.`,
      onFailure: (failure) => {
        if (cell !== undefined) presenter.rollBack(cell, previous, sheet.payable_cents);
        if (failure.status === 422 && failure.fields !== null) {
          applyFieldMessages(
            [blockField, yardField, colonyField, framesField, photoField],
            summary,
            failure.fields,
          );
        }
      },
    }).then(async (created) => {
      if (created === null) return;
      summary.hide();
      for (const field of [blockField, yardField, colonyField, framesField, photoField]) {
        field.setError(null);
      }
      colonyField.setValue('');
      framesField.setValue('');
      if (chosenPhoto !== undefined) {
        const form = new FormData();
        form.append('photo', chosenPhoto);
        await runAction({
          button: addButton,
          pending: 'Uploading photo…',
          run: () =>
            request<unknown>(
              'POST',
              `/api/inspect/${token}/samples/${created.sample.id}/photos`,
              { form },
            ),
          success: () => `Photo added to sample ${draft.colonyLabel}.`,
          refusal: (failure) => {
            if (failure.status === 413) return 'Photos must be 8,000,000 bytes or smaller.';
            if (failure.status === 415) return 'Photos must be JPEG, PNG or WebP images.';
            if (failure.code === 'storage_unavailable') {
              return 'Photo storage is unreachable. The sample is saved without this photo; try again in a minute.';
            }
            return null;
          },
        });
        photoField.clearFile();
      }
      await reloadSheet(draft.blockId);
    });
  });

  function signDialog(): Dialog {
    const name = new FormField({ name: 'inspector_name', label: 'Full name', kind: 'text' });
    const attest = new FormField({
      name: 'attest',
      label: 'I counted these colonies and these figures are true',
      kind: 'checkbox',
    });
    return new Dialog({
      name: 'Sign report',
      opener: signButton,
      fields: [name, attest],
      submitLabel: 'Sign and send',
      submit: async (self) => {
        self.clearErrors();
        const result = await runAction({
          button: self.submitButton,
          pending: 'Signing report…',
          run: () =>
            request<SignedReport>('POST', `/api/inspect/${token}/sign`, {
              body: { inspector_name: name.value, attest: attest.checked },
              idempotencyKey: `sign-${token.slice(0, 12)}`,
            }),
          success: () => "Report signed. The grower's notice is on its way.",
          refusal: (failure) => {
            if (failure.code === 'billing_unavailable') {
              return 'Billing is unreachable, so nothing was signed. Your samples are saved; try again in a minute.';
            }
            if (failure.code === 'storage_unavailable') {
              return 'Report storage is unreachable, so nothing was signed. Your samples are saved; try again in a minute.';
            }
            return null;
          },
          onFailure: (failure) => self.showFailure(failure),
        });
        if (result !== null) {
          self.close();
          markSigned();
        }
      },
    });
  }
  signButton.addEventListener('click', () => signDialog().open());

  const signedNote = el('p', { class: 'sheet__signed', hidden: true, text: 'Signed' });
  function markSigned(): void {
    signedNote.hidden = false;
    signButton.disabled = true;
    announceUpdate("Report signed. The grower's notice is on its way.");
  }

  const payableRow = ledgerTable([{ label: 'Payable', value: payableOdometer.element }]);
  const dock = el('div', { class: 'sheet__dock' }, [payableRow, signButton, signedNote]);

  root.append(
    el('main', { class: 'sheet' }, [
      el('header', { class: 'sheet__header' }, [
        el('p', { class: 'wordmark wordmark--small', text: 'Swarmline Bloom Desk' }),
        el('h1', { class: 'sheet__title', text: sheet.orchard.name }),
        el('p', {
          class: 'sheet__meta',
          text: `${sheet.orchard.county} County · ${sheet.order.ref}`,
        }),
        el('p', {
          class: 'sheet__expiry',
          text: `Link expires ${formatPacificDateTime(new Date(sheet.link.expires_at))}`,
        }),
      ]),
      el('div', { class: 'sheet__body' }, [
        el('div', { class: 'sheet__map' }, [platmap.element, tierLegend()]),
        el('div', { class: 'sheet__main' }, [sectionsHost, addForm]),
      ]),
      dock,
    ]),
  );

  paintMap();
  paintSections();
  refreshYards();
  presenter.rollPayable(sheet.payable_cents, 0);
  payableOdometer.set(formatMoney(sheet.payable_cents));

  const poll = window.setInterval(() => {
    void reloadSheet(null).catch((error: unknown) => {
      const failure = error instanceof ApiFailure ? error : null;
      if (failure === null || failure.status !== 410) return;
      window.clearInterval(poll);
      markSigned();
    });
  }, REFRESH_MS);
}
