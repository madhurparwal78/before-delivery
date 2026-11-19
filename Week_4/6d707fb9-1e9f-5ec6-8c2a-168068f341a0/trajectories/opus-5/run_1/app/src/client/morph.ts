import { reducedMotion } from './dom';

const FORM_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'OPTION']);
const ROLL_MS = 320;

/** The old figure moves one line up and out while the new one moves up into place. */
export function rollTo(holder: Element, text: string): void {
  const current = holder.querySelector('.roll-value');
  if (current && current.textContent === text) return;
  if (!current) {
    const made = document.createElement('span');
    made.className = 'roll-value';
    made.textContent = text;
    holder.append(made);
    return;
  }
  if (reducedMotion()) {
    current.textContent = text;
    return;
  }
  const next = document.createElement('span');
  next.className = 'roll-value';
  next.textContent = text;
  holder.append(next);
  current.animate(
    [
      { transform: 'translateY(0)', opacity: 1 },
      { transform: 'translateY(-100%)', opacity: 0 },
    ],
    { duration: ROLL_MS, easing: 'ease-out', fill: 'forwards' },
  );
  next.animate(
    [
      { transform: 'translateY(100%)', opacity: 0 },
      { transform: 'translateY(0)', opacity: 1 },
    ],
    { duration: ROLL_MS, easing: 'ease-out', fill: 'forwards' },
  ).finished.then(
    () => {
      current.remove();
      next.style.removeProperty('transform');
    },
    () => undefined,
  );
}

function syncAttributes(target: Element, source: Element): void {
  const skipValue = FORM_TAGS.has(target.tagName);
  for (const attribute of [...source.attributes]) {
    if (skipValue && (attribute.name === 'value' || attribute.name === 'checked' || attribute.name === 'selected')) {
      continue;
    }
    if (target.getAttribute(attribute.name) !== attribute.value) {
      target.setAttribute(attribute.name, attribute.value);
    }
  }
  for (const attribute of [...target.attributes]) {
    if (attribute.name.startsWith('data-open')) continue;
    if (skipValue && (attribute.name === 'value' || attribute.name === 'checked' || attribute.name === 'selected')) {
      continue;
    }
    if (!source.hasAttribute(attribute.name)) target.removeAttribute(attribute.name);
  }
}

function keep(node: Node): boolean {
  if (node.nodeType === Node.ELEMENT_NODE) return true;
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').trim() !== '';
  return false;
}

/** A refresh changes only what changed, in place, so an element is never replaced. */
export function morph(target: Element, source: Element): void {
  if (target.hasAttribute('data-keep')) return;
  syncAttributes(target, source);
  if (target.getAttribute('data-roll') === '1') {
    rollTo(target, (source.textContent ?? '').trim());
    return;
  }

  const sourceKids = [...source.childNodes].filter(keep);
  const targetKids = [...target.childNodes].filter(keep);
  const keyed = new Map<string, Element>();
  for (const node of targetKids) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const key = (node as Element).getAttribute('data-key');
      if (key !== null) keyed.set(key, node as Element);
    }
  }

  const wanted: Node[] = [];
  let at = 0;
  for (const given of sourceKids) {
    let match: Node | null = null;
    if (given.nodeType === Node.ELEMENT_NODE) {
      const key = (given as Element).getAttribute('data-key');
      if (key !== null) {
        const found = keyed.get(key);
        if (found && found.tagName === (given as Element).tagName) {
          match = found;
          keyed.delete(key);
        }
      }
    }
    if (!match) {
      while (at < targetKids.length) {
        const candidate = targetKids[at] as Node;
        at += 1;
        if (candidate.nodeType === Node.ELEMENT_NODE && (candidate as Element).hasAttribute('data-key')) continue;
        if (candidate.nodeType !== given.nodeType) continue;
        if (given.nodeType === Node.ELEMENT_NODE && (candidate as Element).tagName !== (given as Element).tagName) {
          continue;
        }
        match = candidate;
        break;
      }
    }
    if (match) {
      if (given.nodeType === Node.ELEMENT_NODE) morph(match as Element, given as Element);
      else if (match.textContent !== given.textContent) match.textContent = given.textContent;
      wanted.push(match);
    } else {
      wanted.push(document.importNode(given, true));
    }
  }

  // A node already in the right place is never moved, so focus inside it survives.
  const held = new Set(wanted);
  for (const node of targetKids) {
    if (!held.has(node) && node.parentNode === target) target.removeChild(node);
  }
  for (let index = 0; index < wanted.length; index += 1) {
    const node = wanted[index] as Node;
    const current = [...target.childNodes].filter(keep)[index];
    if (current !== node) target.insertBefore(node, current ?? null);
  }
}
