import { api, el, isApiError, trapDialog, escapeHtml } from '../shell';

interface ReviewStill {
  id: string;
  shot_code: string;
  title: string;
  url: string;
}

interface Review {
  reference: string;
  brand_name: string;
  milestone: 'look_dev' | 'final_delivery';
  state: string;
  revision_rounds_used: number;
  revision_rounds_included: number;
  actions_open: boolean;
  stills: ReviewStill[];
}

export function mountReview(path: string): void {
  const token = path.split('/')[2] ?? '';
  const main = document.querySelector('main') as HTMLElement;
  main.innerHTML = '';
  main.id = 'main';
  const section = el('section', 'page-section');
  const heading = el('h1', 'display-2');
  const sub = el('p', 'section-label');
  const rounds = el('p', 'lede');
  const stillsHeading = el('h2', 'display-4');
  stillsHeading.textContent = 'Stills';
  const stills = el('ul', 'review-stills');
  stills.setAttribute('aria-label', 'Stills');
  const actions = el('div', 'review-actions');
  const acceptButton = el('button', 'button');
  const revisionButton = el('button', 'button secondary');
  revisionButton.textContent = 'Request a revision';
  actions.append(acceptButton, revisionButton);
  section.append(heading, sub, rounds, stillsHeading, stills, actions);
  main.appendChild(section);

  const load = async (): Promise<void> => {
    const { status, json } = await api<Review>('GET', `/api/review/${encodeURIComponent(token)}`);
    if (status !== 200 || isApiError(json)) {
      void import('./notfound').then(m => {
        main.innerHTML = '';
        m.mountNotFound();
      });
      return;
    }
    const review = json as Review;
    const label = review.milestone === 'look_dev' ? 'Look-dev' : 'Final delivery';
    document.title = `${label} review — ${review.reference} — Gloamwork`;
    heading.textContent = `${review.reference} — ${label}`;
    sub.textContent = review.brand_name;
    rounds.textContent = `Revision rounds used: ${review.revision_rounds_used} of ${review.revision_rounds_included}`;
    stills.innerHTML = '';
    for (const still of review.stills) {
      const item = el('li');
      const image = el('img');
      image.src = still.url;
      image.alt = `${still.title} still`;
      item.appendChild(image);
      stills.appendChild(item);
    }
    acceptButton.textContent = review.milestone === 'look_dev' ? 'Accept look-dev' : 'Accept final delivery';
    acceptButton.hidden = !review.actions_open;
    revisionButton.hidden = !review.actions_open;
  };

  acceptButton.addEventListener('click', async () => {
    acceptButton.setAttribute('aria-busy', 'true');
    const { status, json } = await api<Review>('POST', `/api/review/${encodeURIComponent(token)}/accept`, {});
    acceptButton.removeAttribute('aria-busy');
    if (status === 200 && !isApiError(json)) {
      const success = el('section', 'rig-quote');
      const successHeading = el('h2', 'display-4');
      successHeading.textContent = 'Milestone accepted';
      const successNote = el('p');
      successNote.textContent = 'Thank you. The studio will be in touch about the next step.';
      success.setAttribute('role', 'status');
      success.append(successHeading, successNote);
      section.innerHTML = '';
      section.appendChild(success);
      return;
    }
    if (isApiError(json)) {
      await load();
      const note = el('p');
      note.setAttribute('role', 'alert');
      note.textContent = json.message;
      section.prepend(note);
    }
  });

  revisionButton.addEventListener('click', () => {
    // One request key per opening of the dialog.
    const requestKey = `revision-${token}-${Date.now()}`;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Request a revision');
    const body = el('div', 'dialog-body');
    const title = el('h2');
    title.textContent = 'Request a revision';
    const field = el('div', 'field');
    const label = el('label');
    label.htmlFor = 'revision-note';
    label.textContent = 'What should change?';
    const textarea = el('textarea');
    textarea.id = 'revision-note';
    textarea.rows = 5;
    textarea.setAttribute('data-field', 'note');
    field.append(label, textarea);
    const errorLine = el('p', 'dialog-error');
    errorLine.hidden = true;
    const actionsRow = el('div', 'dialog-actions');
    const cancelButton = el('button', 'button secondary');
    cancelButton.textContent = 'Cancel';
    const sendButton = el('button', 'button');
    sendButton.textContent = 'Send request';
    sendButton.dataset.pendingLabel = 'Sending';
    actionsRow.append(cancelButton, sendButton);
    body.append(title, field, errorLine, actionsRow);
    dialog.appendChild(body);
    document.body.appendChild(dialog);
    trapDialog(dialog, () => {
      dialog.remove();
      revisionButton.focus();
    });
    cancelButton.addEventListener('click', () => {
      dialog.close();
      dialog.remove();
      revisionButton.focus();
    });
    sendButton.addEventListener('click', async () => {
      errorLine.hidden = true;
      sendButton.setAttribute('aria-busy', 'true');
      sendButton.textContent = sendButton.dataset.pendingLabel ?? 'Sending';
      const { status, json } = await api<{ review: Review; round: number; change_order: boolean }>('POST', `/api/review/${encodeURIComponent(token)}/revisions`, {
        note: textarea.value,
      }, { 'Idempotency-Key': requestKey });
      sendButton.removeAttribute('aria-busy');
      sendButton.textContent = 'Send request';
      if (status === 201 && !isApiError(json)) {
        const result = json as { round: number; change_order: boolean };
        dialog.close();
        dialog.remove();
        const success = el('section', 'rig-quote');
        const successHeading = el('h2', 'display-4');
        successHeading.textContent = 'Revision requested';
        const noteLine = el('p');
        noteLine.textContent = result.round <= 2
          ? `Round ${result.round} of 2 included.`
          : `Round ${result.round}. This round adds a change order to this milestone's invoice.`;
        success.setAttribute('role', 'status');
        success.append(successHeading, noteLine);
        section.innerHTML = '';
        section.appendChild(success);
        return;
      }
      if (isApiError(json)) {
        const fieldsErrors = json.fields ?? {};
        if (Object.keys(fieldsErrors).length > 0) {
          errorLine.textContent = Object.values(fieldsErrors)[0] ?? json.message;
        } else {
          errorLine.textContent = json.message;
        }
        errorLine.hidden = false;
        sendButton.focus();
      }
    });
  });

  // Clicking a still opens it larger in the page; Escape returns to the grid.
  stills.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLImageElement) {
      const overlay = el('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(4,4,6,0.9);z-index:200;display:flex;align-items:center;justify-content:center;';
      const large = el('img');
      large.src = target.src;
      large.style.cssText = 'max-width:90vw;max-height:90vh;';
      overlay.appendChild(large);
      document.body.appendChild(overlay);
      overlay.setAttribute('tabindex', '-1');
      overlay.focus();
      const keydown = (keydownEvent: KeyboardEvent): void => {
        if (keydownEvent.key === 'Escape') {
          keydownEvent.preventDefault();
          overlay.remove();
          document.removeEventListener('keydown', keydown);
          target.focus();
        }
      };
      document.addEventListener('keydown', keydown);
      overlay.addEventListener('click', () => {
        overlay.remove();
        document.removeEventListener('keydown', keydown);
      });
    }
  });

  void load();
  void escapeHtml;
}
