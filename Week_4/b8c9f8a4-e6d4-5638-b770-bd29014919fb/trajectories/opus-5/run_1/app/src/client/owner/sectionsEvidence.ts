import { ERRORS, OUTAGE, PENDING, SUCCESS } from '../../shared/copy';
import type { UploadDto } from '../../shared/types';
import { ApiRefusal, ApiUnreachable, requestForm } from '../shared/api';
import { el, focusTarget, onPress, setPending } from '../shared/dom';
import { announce } from '../shared/live';
import { showNotice } from '../shared/chrome';
import { sectionShell, showFieldError, type SectionContext, type SectionView } from './sectionKit';
import { ownerAction, sessionEnded } from './session';
import type { CarFileState } from './state';

interface MaskFields {
  left: HTMLInputElement;
  top: HTMLInputElement;
  width: HTMLInputElement;
  height: HTMLInputElement;
}

const maskInput = (name: string): HTMLInputElement => {
  const input = el('input', {
    type: 'number',
    class: 'spin-input figures',
    min: '0',
    max: '100',
    step: '0.1',
  }) as HTMLInputElement;
  input.setAttribute('aria-label', name);
  return input;
};

/** Evidence: photo stores with the plate mask drawn on the upright preview, and invoices. */
export const evidenceSection = (context: SectionContext): SectionView => {
  const { section, heading } = sectionShell('evidence', 'Evidence');

  const filePicker = el('input', { type: 'file', class: 'visually-hidden', accept: 'image/jpeg,image/png' }) as HTMLInputElement;
  filePicker.setAttribute('aria-hidden', 'true');
  filePicker.tabIndex = -1;
  const addPhoto = el('button', { type: 'button', class: 'pill-outline', text: 'Add photo' });
  const preview = el('img', { class: 'photo-preview', alt: 'Photo preview' }) as HTMLImageElement;
  preview.setAttribute('role', 'img');
  const previewHolder = el('div', { class: 'photo-preview-holder' }, [preview]);
  const storePhoto = el('button', { type: 'button', class: 'pill-solid', text: 'Store photo' });
  const fileError = el('p', { class: 'field-error' });
  fileError.hidden = true;

  const mask: MaskFields = {
    left: maskInput('Mask left'),
    top: maskInput('Mask top'),
    width: maskInput('Mask width'),
    height: maskInput('Mask height'),
  };
  const noPlate = el('input', { type: 'checkbox', class: 'checkbox-input' }) as HTMLInputElement;
  noPlate.setAttribute('aria-label', 'No plate in this photo');
  const maskRectangle = el('div', { class: 'mask-rectangle' });
  maskRectangle.hidden = true;
  previewHolder.append(maskRectangle);

  const maskGroup = el('div', { class: 'mask-group', role: 'group', 'aria-label': 'Plate mask' }, [
    el('label', { class: 'field-label', text: 'Mask left' }, [mask.left]),
    el('label', { class: 'field-label', text: 'Mask top' }, [mask.top]),
    el('label', { class: 'field-label', text: 'Mask width' }, [mask.width]),
    el('label', { class: 'field-label', text: 'Mask height' }, [mask.height]),
    el('label', { class: 'field-label check-label', text: 'No plate in this photo' }, [noPlate]),
  ]);

  const invoiceLabel = el('input', { type: 'text', class: 'text-input', id: 'invoice-label' }) as HTMLInputElement;
  invoiceLabel.setAttribute('aria-label', 'Invoice label');
  const invoicePicker = el('input', {
    type: 'file',
    class: 'visually-hidden',
    accept: 'image/jpeg,image/png,application/pdf',
  }) as HTMLInputElement;
  invoicePicker.setAttribute('aria-hidden', 'true');
  invoicePicker.tabIndex = -1;
  const addInvoice = el('button', { type: 'button', class: 'pill-outline', text: 'Add invoice' });
  const invoiceError = el('p', { class: 'field-error' });
  invoiceError.hidden = true;

  const list = el('ul', { class: 'evidence-list', role: 'list', 'aria-label': 'Evidence' });

  /** The last file chosen owns the preview, the mask fields and the upload. */
  let chosenFile: File | null = null;
  let chosenToken = 0;

  const clearMask = (): void => {
    for (const input of Object.values(mask)) input.value = '';
    noPlate.checked = false;
    maskRectangle.hidden = true;
  };

  const paintRectangle = (): void => {
    const left = Number(mask.left.value);
    const top = Number(mask.top.value);
    const width = Number(mask.width.value);
    const height = Number(mask.height.value);
    if ([left, top, width, height].some((value) => Number.isNaN(value)) || width <= 0 || height <= 0) {
      maskRectangle.hidden = true;
      return;
    }
    maskRectangle.hidden = false;
    maskRectangle.style.left = `${left}%`;
    maskRectangle.style.top = `${top}%`;
    maskRectangle.style.width = `${width}%`;
    maskRectangle.style.height = `${height}%`;
  };

  for (const input of Object.values(mask)) input.addEventListener('input', paintRectangle);

  const readFile = (file: File): void => {
    chosenToken += 1;
    const token = chosenToken;
    chosenFile = file;
    clearMask();
    showFieldError(fileError, undefined);
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (token !== chosenToken) return;
      preview.src = String(reader.result);
    });
    reader.readAsDataURL(file);
  };

  onPress(addPhoto, () => filePicker.click());
  filePicker.addEventListener('change', () => {
    const file = filePicker.files?.[0];
    if (file === undefined) return;
    readFile(file);
  });

  let dragFrom: { x: number; y: number } | null = null;
  const pointerFraction = (event: PointerEvent): { x: number; y: number } => {
    const box = previewHolder.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  };

  previewHolder.addEventListener('pointerdown', (event) => {
    if (preview.src === '') return;
    event.preventDefault();
    previewHolder.setPointerCapture(event.pointerId);
    dragFrom = pointerFraction(event);
  });
  previewHolder.addEventListener('pointermove', (event) => {
    if (dragFrom === null) return;
    event.preventDefault();
    const to = pointerFraction(event);
    const left = Math.min(dragFrom.x, to.x);
    const top = Math.min(dragFrom.y, to.y);
    mask.left.value = (left * 100).toFixed(1);
    mask.top.value = (top * 100).toFixed(1);
    mask.width.value = (Math.abs(to.x - dragFrom.x) * 100).toFixed(1);
    mask.height.value = (Math.abs(to.y - dragFrom.y) * 100).toFixed(1);
    noPlate.checked = false;
    paintRectangle();
  });
  previewHolder.addEventListener('pointerup', (event) => {
    if (dragFrom === null) return;
    event.preventDefault();
    previewHolder.releasePointerCapture(event.pointerId);
    dragFrom = null;
  });

  const plateMaskValue = (): string | null => {
    if (noPlate.checked) return 'null';
    const width = Number(mask.width.value);
    const height = Number(mask.height.value);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return JSON.stringify({
      x: Number((Number(mask.left.value) / 100).toFixed(4)),
      y: Number((Number(mask.top.value) / 100).toFixed(4)),
      w: Number((width / 100).toFixed(4)),
      h: Number((height / 100).toFixed(4)),
    });
  };

  const sendUpload = async (form: FormData, control: HTMLElement, error: HTMLElement): Promise<void> => {
    setPending(control, true);
    announce(context.status, PENDING.upload);
    try {
      const upload = await requestForm<UploadDto>(`/api/owner/cars/${context.carId}/uploads`, form);
      await context.refresh(['evidence']);
      announce(context.status, SUCCESS.upload);
      if (upload.locationRemoved) announce(context.status, SUCCESS.locationRemoved);
    } catch (failure) {
      // An ended session is the sign-in dialog’s business, not this handler’s.
      if (sessionEnded(failure)) throw failure;
      if (failure instanceof ApiRefusal) {
        if (failure.code === 'storage_unavailable') {
          showNotice(context.notice, OUTAGE.storage);
          return;
        }
        if (failure.code === 'unsupported_file') {
          showFieldError(error, ERRORS.unsupportedFile);
          announce(context.status, ERRORS.unsupportedFile);
          return;
        }
        if (failure.code === 'file_too_large') {
          showFieldError(error, ERRORS.fileTooLarge);
          announce(context.status, ERRORS.fileTooLarge);
          return;
        }
        if (failure.body.errors?.file !== undefined) {
          showFieldError(error, failure.body.errors.file);
          announce(context.status, failure.body.errors.file);
          return;
        }
        const message = failure.body.errors?.plateMask ?? failure.body.errors?.label ?? failure.body.message;
        showFieldError(error, message);
        announce(context.status, message);
        return;
      }
      if (failure instanceof ApiUnreachable) {
        showNotice(context.notice, OUTAGE.storage);
        return;
      }
      throw failure;
    } finally {
      if (control.isConnected) setPending(control, false);
    }
  };

  onPress(storePhoto, () => {
    const file = chosenFile;
    if (file === null) {
      showFieldError(fileError, 'Choose a file');
      return;
    }
    const plateMask = plateMaskValue();
    if (plateMask === null) {
      showFieldError(fileError, ERRORS.maskMissing);
      announce(context.status, ERRORS.maskMissing);
      return;
    }
    const form = new FormData();
    form.set('kind', 'photo');
    form.set('plateMask', plateMask);
    form.set('file', file, file.name);
    void ownerAction(async () => {
      await sendUpload(form, storePhoto, fileError);
      if (fileError.hidden) {
        chosenFile = null;
        preview.removeAttribute('src');
        clearMask();
        focusTarget(addPhoto);
      }
    }, storePhoto);
  });

  onPress(addInvoice, () => {
    if (invoiceLabel.value.length === 0) {
      showFieldError(invoiceError, 'Enter between 1 and 80 characters');
      return;
    }
    invoicePicker.click();
  });
  invoicePicker.addEventListener('change', () => {
    const file = invoicePicker.files?.[0];
    if (file === undefined) return;
    const form = new FormData();
    form.set('kind', 'invoice');
    form.set('label', invoiceLabel.value);
    form.set('file', file, file.name);
    void ownerAction(async () => {
      await sendUpload(form, addInvoice, invoiceError);
      if (invoiceError.hidden) invoiceLabel.value = '';
    }, addInvoice);
  });

  const paintList = (state: CarFileState): void => {
    if (state.uploads.length === 0) {
      list.replaceChildren(el('li', { class: 'empty-line', text: 'No files yet' }));
      return;
    }
    list.replaceChildren(
      ...state.uploads.map((upload) =>
        el('li', { class: 'evidence-item' }, [
          el('span', { class: 'evidence-name', text: upload.fileName }),
          el('span', { class: 'evidence-kind', text: upload.kind === 'photo' ? 'Photo' : (upload.label ?? 'Invoice') }),
          el('a', {
            class: 'underline-link',
            href: `/api/owner/uploads/${upload.id}/original`,
            text: 'Download original',
          }),
        ]),
      ),
    );
  };

  section.append(
    el('div', { class: 'evidence-layout' }, [
      el('div', { class: 'card' }, [
        addPhoto,
        filePicker,
        previewHolder,
        maskGroup,
        fileError,
        storePhoto,
      ]),
      el('div', { class: 'card' }, [
        el('label', { class: 'field-label', for: 'invoice-label', text: 'Invoice label' }),
        invoiceLabel,
        invoiceError,
        addInvoice,
        invoicePicker,
      ]),
    ]),
    list,
  );

  return { id: 'evidence', heading, node: section, paint: paintList };
};
