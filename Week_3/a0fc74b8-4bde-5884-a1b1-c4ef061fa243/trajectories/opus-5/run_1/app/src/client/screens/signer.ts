import { api, ApiCallError } from '../api.ts';
import { announce, clear, h, prefersReducedMotion, statusRegion } from '../dom.ts';
import { subscribe, type LiveSubscription } from '../live.ts';
import { buildPageGroups, paintPages } from '../ui/pages.ts';
import { animate, easeOut } from '../ui/motion.ts';
import { openAdoptDialog, type Adoption } from '../ui/adopt.ts';
import { DECLINE_DIALOG, openReasonDialog } from '../ui/sendDialog.ts';
import {
  ANNOUNCE,
  COUNTER,
  GENERIC_ERROR,
  INCOMPLETE_FIELDS,
  PAGES_UNAVAILABLE_BODY,
  PAGES_UNAVAILABLE_HEADING,
  PENDING,
  SIGN_PAGE,
  type LinkPageCopy,
} from '../../shared/copy.ts';
import { isFieldComplete, readingOrder, walksTo } from '../../shared/fields.ts';
import type { SignFieldJson, SignViewJson } from '../../shared/types.ts';
import type { Screen } from './documents.ts';

const TRAVEL_MS = 360;
const DIM_MS = 330;
const ROLL_MS = 200;
const TARGET_TOP = 0.35;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const linkCopy = (view: SignViewJson): LinkPageCopy | null => {
  switch (view.state) {
    case 'signed_waiting':
      return SIGN_PAGE.signedWaiting(
        view.title,
        view.current?.name ?? '',
        view.current?.order ?? 0,
        view.signerCount,
      );
    case 'sealing':
      return SIGN_PAGE.sealing(view.title);
    case 'completed':
      return SIGN_PAGE.completed(view.title);
    case 'declined':
      return SIGN_PAGE.declined(view.declinedBy ?? '', view.recipient.status === 'declined');
    case 'voided':
      return SIGN_PAGE.voided(view.senderName, view.voidReason ?? '');
    case 'expired':
      return SIGN_PAGE.expired(view.senderName);
    case 'your_turn':
      return null;
  }
};

export const signerScreen = (token: string): Screen => {
  let view: SignViewJson | null = null;
  let live: LiveSubscription | null = null;
  let renderedState: string | null = null;
  let currentFieldId: string | null = null;
  let pagesReady = false;
  let signing = false;
  let shownCount = -1;
  const inputs = new Map<string, HTMLElement>();

  const root = h('div', { class: 'signer-screen' });
  const progress = statusRegion('Signing progress');
  const documentStatus = statusRegion('Document status');
  const notice = h('div', { class: 'link-notice' });

  // --- signing view parts ---
  const heading = h('h1', { class: 'page-heading' });
  const countText = h('span', { class: 'count-left' });
  const previousButton = h('button', { type: 'button', class: 'button' }, 'Previous');
  const nextButton = h('button', { type: 'button', class: 'button' }, 'Next');
  const finishButton = h('button', { type: 'button', class: 'button seal' }, 'Finish and sign');
  const declineButton = h('button', { type: 'button', class: 'button' }, 'Decline');
  const header = h(
    'header',
    { class: 'signer-header' },
    heading,
    countText,
    h('div', { class: 'signer-controls' }, previousButton, nextButton, finishButton, declineButton),
  );
  const alertBox = h('p', { class: 'field-error', role: 'alert' });
  const pagesHost = h('div', { class: 'pages-host' });
  const aperture = h('div', { id: 'aperture', 'aria-hidden': 'true' });
  const dimming = h('div', { class: 'dimming' });
  const fallback = h(
    'div',
    { class: 'pages-fallback', hidden: true },
    h('h2', {}, PAGES_UNAVAILABLE_HEADING),
    h('p', {}, PAGES_UNAVAILABLE_BODY),
  );
  const signingView = h(
    'div',
    { class: 'signing-view' },
    header,
    alertBox,
    h('div', { class: 'signer-pages' }, pagesHost, dimming, aperture),
    fallback,
    progress,
    documentStatus,
  );

  const myFields = (): SignFieldJson[] => (view === null ? [] : readingOrder(view.fields));

  const walkFields = (): SignFieldJson[] => myFields().filter((field) => walksTo(field));

  const incompleteWalk = (): SignFieldJson[] =>
    walkFields().filter((field) => !isFieldComplete(field));

  const setCount = (): void => {
    const left = incompleteWalk().length;
    const text = `${left} left`;
    if (shownCount === left) {
      countText.textContent = text;
      return;
    }
    const dropped = shownCount > left && shownCount >= 0;
    shownCount = left;
    if (!dropped || prefersReducedMotion()) {
      countText.textContent = text;
      return;
    }
    const old = h('span', { class: 'roll-out' }, countText.textContent ?? '');
    const fresh = h('span', { class: 'roll-in' }, text);
    clear(countText);
    countText.append(old, fresh);
    animate(
      ROLL_MS,
      (t) => {
        const eased = easeOut(t);
        old.style.transform = `translateY(${eased * 100}%)`;
        old.style.opacity = String(1 - eased);
        fresh.style.transform = `translateY(${(1 - eased) * -100}%)`;
        fresh.style.opacity = String(eased);
      },
      () => {
        countText.textContent = text;
      },
    );
  };

  const boxOf = (fieldId: string): Box | null => {
    const node = inputs.get(fieldId);
    const host = pagesHost;
    if (!node) return null;
    const nodeRect = node.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    return {
      left: nodeRect.left - hostRect.left,
      top: nodeRect.top - hostRect.top,
      width: nodeRect.width,
      height: nodeRect.height,
    };
  };

  const applyApertureBox = (box: Box): void => {
    aperture.style.left = `${box.left}px`;
    aperture.style.top = `${box.top}px`;
    aperture.style.width = `${box.width}px`;
    aperture.style.height = `${box.height}px`;
  };

  const scrollTargetFor = (fieldId: string): number => {
    const node = inputs.get(fieldId);
    if (!node) return window.scrollY;
    const rect = node.getBoundingClientRect();
    const absoluteTop = rect.top + window.scrollY;
    const wanted = absoluteTop - window.innerHeight * TARGET_TOP;
    const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return Math.min(Math.max(0, wanted), maximum);
  };

  const announceField = (field: SignFieldJson): void => {
    if (!walksTo(field)) {
      announce(progress, ANNOUNCE.optionalField(field.label, field.page));
      return;
    }
    const list = walkFields();
    const index = list.findIndex((item) => item.id === field.id) + 1;
    announce(progress, ANNOUNCE.requiredField(index, list.length, field.label, field.page));
  };

  const markCurrent = (fieldId: string | null): void => {
    for (const [id, node] of inputs) node.classList.toggle('current', id === fieldId);
  };

  const moveTo = (fieldId: string, focusField: boolean): void => {
    const from = currentFieldId === null ? null : boxOf(currentFieldId);
    currentFieldId = fieldId;
    markCurrent(fieldId);
    const to = boxOf(fieldId);
    if (to === null) return;
    const startScroll = window.scrollY;
    const endScroll = scrollTargetFor(fieldId);
    const start = from ?? to;
    animate(TRAVEL_MS, (t) => {
      const eased = easeOut(t);
      applyApertureBox({
        left: start.left + (to.left - start.left) * eased,
        top: start.top + (to.top - start.top) * eased,
        width: start.width + (to.width - start.width) * eased,
        height: start.height + (to.height - start.height) * eased,
      });
      window.scrollTo({ top: startScroll + (endScroll - startScroll) * eased, behavior: 'auto' });
    });
    const field = myFields().find((item) => item.id === fieldId);
    if (field) announceField(field);
    if (focusField) inputs.get(fieldId)?.focus();
  };

  const moveToFinish = (): void => {
    const from = currentFieldId === null ? null : boxOf(currentFieldId);
    currentFieldId = null;
    markCurrent(null);
    const hostRect = pagesHost.getBoundingClientRect();
    const buttonRect = finishButton.getBoundingClientRect();
    const to: Box = {
      left: buttonRect.left - hostRect.left,
      top: buttonRect.top - hostRect.top,
      width: buttonRect.width,
      height: buttonRect.height,
    };
    const start = from ?? to;
    animate(TRAVEL_MS, (t) => {
      const eased = easeOut(t);
      applyApertureBox({
        left: start.left + (to.left - start.left) * eased,
        top: start.top + (to.top - start.top) * eased,
        width: start.width + (to.width - start.width) * eased,
        height: start.height + (to.height - start.height) * eased,
      });
    });
    finishButton.focus();
  };

  const step = (direction: 1 | -1): void => {
    const remaining = incompleteWalk();
    if (remaining.length === 0) {
      moveToFinish();
      return;
    }
    const order = myFields();
    const at = currentFieldId === null ? -1 : order.findIndex((item) => item.id === currentFieldId);
    const sequence =
      direction === 1
        ? [...order.slice(at + 1), ...order.slice(0, Math.max(0, at + 1))]
        : [...order.slice(0, Math.max(0, at)).reverse(), ...order.slice(at + 1).reverse()];
    const target = sequence.find((item) => walksTo(item) && !isFieldComplete(item));
    if (target) moveTo(target.id, true);
  };

  const saveValue = async (
    field: SignFieldJson,
    body: Record<string, unknown>,
  ): Promise<void> => {
    try {
      const saved = await api.putSignField(token, field.id, body);
      if (view === null) return;
      view = {
        ...view,
        fields: view.fields.map((item) =>
          item.id === field.id ? { ...item, value: saved.value } : item,
        ),
      };
      paintFieldValue(field.id);
      setCount();
    } catch {
      announce(progress, GENERIC_ERROR);
    }
  };

  const adopted = { signature: null as Adoption | null, initials: null as Adoption | null };

  const adoptionBody = (adoption: Adoption): Record<string, unknown> =>
    'typed' in adoption ? { typed: adoption.typed } : { strokes: adoption.strokes };

  const paintFieldValue = (fieldId: string): void => {
    const field = view?.fields.find((item) => item.id === fieldId);
    const node = inputs.get(fieldId);
    if (!field || !node) return;
    if (field.kind === 'signature' || field.kind === 'initials') {
      const shown = field.value === null ? '' : field.value.startsWith('typed:') ? field.value.slice(6) : 'Signed';
      node.classList.toggle('filled', field.value !== null);
      const slot = node.querySelector('.field-value');
      if (slot) slot.textContent = shown;
    }
  };

  const openAdoption = (field: SignFieldJson, node: HTMLElement): void => {
    if (view === null) return;
    const kind = field.kind === 'initials' ? 'initials' : 'signature';
    openAdoptDialog(kind, view.recipient.name, node, (adoption) => {
      adopted[kind] = adoption;
      void saveValue(field, adoptionBody(adoption));
    });
  };

  const activateSignatureField = (field: SignFieldJson, node: HTMLElement): void => {
    const kind = field.kind === 'initials' ? 'initials' : 'signature';
    const existing = adopted[kind];
    if (field.value === null && existing !== null) {
      void saveValue(field, adoptionBody(existing));
      return;
    }
    openAdoption(field, node);
  };

  const buildField = (field: SignFieldJson): HTMLElement => {
    const group = pagesHost.querySelector<HTMLElement>(`#page-${field.page}`);
    const place = (node: HTMLElement): void => {
      node.style.left = `${field.x * 100}%`;
      node.style.top = `${field.y * 100}%`;
      node.style.width = `${field.w * 100}%`;
      node.style.height = `${field.h * 100}%`;
      group?.appendChild(node);
    };

    if (field.kind === 'text') {
      const input = h('input', {
        type: 'text',
        id: `field-${field.id}`,
        class: 'signer-field text',
        'aria-label': field.label,
      });
      input.value = field.value ?? '';
      const counter = h('span', { class: 'counter field-counter' }, COUNTER.text([...input.value].length));
      input.addEventListener('input', () => {
        const points = [...input.value];
        if (points.length > 200) input.value = points.slice(0, 200).join('');
        counter.textContent = COUNTER.text([...input.value].length);
      });
      input.addEventListener('blur', () => {
        counter.classList.remove('shown');
        void saveValue(field, { value: input.value });
      });
      input.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void saveValue(field, { value: input.value }).then(() => step(1));
          return;
        }
        if (event.key === 'Tab' && !event.shiftKey) {
          const complete = input.value.trim() !== '';
          if (complete && incompleteWalk().some((item) => item.id !== field.id)) {
            event.preventDefault();
            void saveValue(field, { value: input.value }).then(() => step(1));
          }
        }
      });
      input.addEventListener('focus', () => {
        counter.classList.add('shown');
        if (currentFieldId !== field.id) moveTo(field.id, false);
      });
      place(input);
      const wrapper = h('span', { class: 'counter-host' }, counter);
      wrapper.style.left = `${field.x * 100}%`;
      wrapper.style.top = `${(field.y + field.h) * 100}%`;
      group?.appendChild(wrapper);
      return input;
    }

    if (field.kind === 'date') {
      const box = h(
        'input',
        {
          type: 'text',
          id: `field-${field.id}`,
          class: 'signer-field date',
          'aria-label': field.label,
          'aria-readonly': 'true',
          readonly: true,
          value: field.value ?? 'Filled when you sign',
        },
      );
      box.addEventListener('focus', () => {
        if (currentFieldId !== field.id) moveTo(field.id, false);
      });
      place(box);
      return box;
    }

    const button = h(
      'button',
      { type: 'button', id: `field-${field.id}`, class: 'signer-field sign', 'aria-label': field.label },
      h('span', { class: 'field-value' }),
    );
    button.addEventListener('click', () => activateSignatureField(field, button));
    button.addEventListener('keydown', (event: KeyboardEvent) => {
      const value = view?.fields.find((item) => item.id === field.id)?.value ?? null;
      if (event.key === ' ') {
        event.preventDefault();
        openAdoption(field, button);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (value === null) {
          activateSignatureField(field, button);
          return;
        }
        step(1);
        return;
      }
      if (event.key === 'Tab' && !event.shiftKey && value !== null) {
        if (incompleteWalk().some((item) => item.id !== field.id)) {
          event.preventDefault();
          step(1);
        }
      }
    });
    button.addEventListener('focus', () => {
      if (currentFieldId !== field.id) moveTo(field.id, false);
    });
    place(button);
    return button;
  };

  previousButton.addEventListener('click', () => step(-1));
  nextButton.addEventListener('click', () => step(1));

  finishButton.addEventListener('click', () => {
    if (signing) return;
    const remaining = incompleteWalk();
    if (remaining.length > 0) {
      alertBox.textContent = INCOMPLETE_FIELDS(remaining.length);
      const first = remaining[0];
      if (first) moveTo(first.id, true);
      return;
    }
    alertBox.textContent = '';
    signing = true;
    finishButton.disabled = true;
    finishButton.setAttribute('aria-busy', 'true');
    announce(progress, PENDING.finish);
    void (async () => {
      try {
        await api.finish(token);
        await reload();
      } catch (failure) {
        signing = false;
        finishButton.disabled = false;
        finishButton.removeAttribute('aria-busy');
        if (failure instanceof ApiCallError && failure.failure.error === 'incomplete_fields') {
          const left = failure.failure.extra['remaining'];
          alertBox.textContent = INCOMPLETE_FIELDS(typeof left === 'number' ? left : 1);
          return;
        }
        alertBox.textContent = GENERIC_ERROR;
      }
    })();
  });

  declineButton.addEventListener('click', () => {
    openReasonDialog(
      DECLINE_DIALOG,
      declineButton,
      async (reason) => {
        await api.decline(token, reason);
        await reload();
      },
      () => announce(progress, PENDING.decline),
    );
  });

  const renderSigningView = (current: SignViewJson): void => {
    clear(root);
    root.appendChild(signingView);
    heading.textContent = current.title;
    clear(pagesHost);
    inputs.clear();
    const built = buildPageGroups(current.pageCount);
    pagesHost.appendChild(built.container);
    void paintPages(`/api/sign/${token}/original.pdf`, built.groups, () => undefined)
      .then(() => {
        pagesReady = true;
        placeFields(current);
        openAperture(current);
      })
      .catch(() => {
        pagesReady = false;
        pagesHost.hidden = true;
        dimming.hidden = true;
        fallback.hidden = false;
      });
  };

  const placeFields = (current: SignViewJson): void => {
    for (const other of current.otherFields) {
      const group = pagesHost.querySelector<HTMLElement>(`#page-${other.page}`);
      if (!group) continue;
      const outline = h('div', { class: 'other-field' });
      outline.style.left = `${other.x * 100}%`;
      outline.style.top = `${other.y * 100}%`;
      outline.style.width = `${other.w * 100}%`;
      outline.style.height = `${other.h * 100}%`;
      group.appendChild(outline);
    }
    for (const field of readingOrder(current.fields)) {
      inputs.set(field.id, buildField(field));
      paintFieldValue(field.id);
    }
  };

  const openAperture = (current: SignViewJson): void => {
    setCount();
    const first = incompleteWalk()[0] ?? walkFields()[0] ?? myFields()[0];
    dimming.classList.add('on');
    animate(DIM_MS, (t) => {
      dimming.style.opacity = String(easeOut(t));
    });
    if (!first) {
      moveToFinish();
      return;
    }
    const box = boxOf(first.id);
    if (box) applyApertureBox(box);
    currentFieldId = first.id;
    markCurrent(first.id);
    const target = scrollTargetFor(first.id);
    window.scrollTo({ top: target, behavior: 'auto' });
    window.setTimeout(() => {
      const settled = boxOf(first.id);
      if (settled) applyApertureBox(settled);
      inputs.get(first.id)?.focus();
      announceField(first);
    }, 0);
    void current;
  };

  const renderNotice = (current: SignViewJson, copy: LinkPageCopy): void => {
    clear(root);
    clear(notice);
    notice.append(
      h('h1', { class: 'page-heading' }, copy.heading),
      ...copy.body.map((line) => h('p', {}, line)),
    );
    if (current.state === 'completed') {
      notice.appendChild(
        h(
          'a',
          { href: `/sign/${token}/completed.pdf`, download: 'completed.pdf' },
          'Download completed PDF',
        ),
      );
    }
    notice.append(documentStatus);
    root.appendChild(notice);
  };

  const apply = (next: SignViewJson): void => {
    const previousState = renderedState;
    view = next;
    if (previousState === next.state) {
      if (next.state === 'your_turn') return;
      const copy = linkCopy(next);
      if (copy) renderNotice(next, copy);
      return;
    }
    renderedState = next.state;
    if (next.state === 'your_turn') {
      signing = false;
      finishButton.disabled = false;
      finishButton.removeAttribute('aria-busy');
      renderSigningView(next);
      return;
    }
    const copy = linkCopy(next);
    if (copy === null) return;
    renderNotice(next, copy);
    if (previousState !== null) announce(documentStatus, copy.heading);
  };

  const renderUnknown = (): void => {
    const copy = SIGN_PAGE.unknown();
    clear(root);
    root.append(
      h('h1', { class: 'page-heading' }, copy.heading),
      ...copy.body.map((line) => h('p', {}, line)),
    );
  };

  const reload = async (): Promise<void> => {
    try {
      apply(await api.signView(token));
    } catch (failure) {
      if (failure instanceof ApiCallError && failure.failure.status === 404) renderUnknown();
    }
  };

  void reload();
  live = subscribe({ scope: 'sign', token }, (payload) => {
    if (payload.view === undefined) return;
    if (payload.view === null) {
      renderUnknown();
      return;
    }
    apply(payload.view);
  });

  return {
    root,
    destroy: () => {
      live?.close();
      void pagesReady;
    },
  };
};
