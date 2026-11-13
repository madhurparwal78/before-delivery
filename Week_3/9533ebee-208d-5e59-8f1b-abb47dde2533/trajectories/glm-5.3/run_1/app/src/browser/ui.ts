export function createEl(tag: string, label: string, className: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (className !== '') el.className = className;
  if (text !== undefined) el.textContent = text;
  if (label !== '') {
    if (tag === 'button' || tag === 'a' || tag === 'label') {
      el.textContent = label;
    }
    el.setAttribute('aria-label', label);
  }
  return el;
}

export interface FeedbackContext {
  announcements: HTMLElement;
  problems: HTMLElement;
}

/** Announce success or pending copy without moving focus. */
export function announce(text: string, link?: { label: string; href: string }): void {
  const region = document.querySelector<HTMLElement>('[role="status"][aria-label="Announcements"]');
  if (region === null) return;
  region.replaceChildren();
  const span = document.createElement('span');
  span.textContent = text;
  region.append(span);
  if (link !== undefined) {
    region.append(document.createTextNode(' '));
    const anchor = document.createElement('a');
    anchor.href = link.href;
    anchor.textContent = link.label;
    region.append(anchor);
  }
}

/** Show a problem message in the Problems alert. */
export function showProblem(text: string, fieldLinks?: Array<{ field: string; message: string }>): void {
  const region = document.querySelector<HTMLElement>('[role="alert"][aria-label="Problems"]');
  if (region === null) return;
  region.replaceChildren();
  region.classList.add('problem');
  const span = document.createElement('span');
  span.textContent = text;
  region.append(span);
  if (fieldLinks !== undefined && fieldLinks.length > 0) {
    region.append(document.createTextNode(' '));
    for (const item of fieldLinks) {
      const anchor = document.createElement('a');
      anchor.href = `#${item.field}`;
      anchor.textContent = item.field;
      anchor.addEventListener('click', (event): void => {
        event.preventDefault();
        const target = document.getElementById(item.field);
        if (target !== null) target.focus();
      });
      region.append(anchor, document.createTextNode(' '));
    }
  }
}

export function clearProblem(): void {
  const region = document.querySelector<HTMLElement>('[role="alert"][aria-label="Problems"]');
  if (region === null) return;
  region.replaceChildren();
  region.classList.remove('problem');
}

/** Mark a field invalid and show its description message. */
export function setFieldError(input: HTMLInputElement, message: string): void {
  input.setAttribute('aria-invalid', 'true');
  let descriptionId = input.getAttribute('aria-describedby');
  if (descriptionId === null) {
    descriptionId = `${input.id}-error`;
    input.setAttribute('aria-describedby', descriptionId);
  }
  let description = document.getElementById(descriptionId);
  if (description === null) {
    description = document.createElement('span');
    description.id = descriptionId;
    description.className = 'error';
    input.insertAdjacentElement('afterend', description);
  }
  description.textContent = message;
}

export function clearFieldError(input: HTMLInputElement): void {
  input.removeAttribute('aria-invalid');
  const descriptionId = input.getAttribute('aria-describedby');
  if (descriptionId !== null) {
    document.getElementById(descriptionId)?.remove();
    input.removeAttribute('aria-describedby');
  }
}

export function refetchEvery(seconds: number, fn: () => void): ReturnType<typeof setInterval> {
  return setInterval(fn, seconds * 1000);
}
