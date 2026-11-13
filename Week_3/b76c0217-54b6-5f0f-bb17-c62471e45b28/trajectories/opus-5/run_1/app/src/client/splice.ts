import { messages } from '../domain/messages';
import { $, announce, tween } from './dom';
import type { RenameResult } from './tree';

/** The rename splice: strike, set, file, count, done, on the published timers (DP-16). */

const STRIKE = 240;
const SET = 420;
const STAGGER = 18;
const FILE = 320;
const COUNT = 600;

const setPhase = (row: HTMLElement, phase: string): void => {
  row.dataset.splice = phase;
};

function strike(pathSpan: HTMLElement, done: () => void): void {
  const line = document.createElement('span');
  line.className = 'strike';
  pathSpan.appendChild(line);
  tween(
    STRIKE,
    (eased) => {
      line.style.width = `${eased * 100}%`;
    },
    () => {
      line.remove();
      done();
    },
  );
}

function setText(pathSpan: HTMLElement, newPath: string, done: () => void): void {
  const characters = [...newPath];
  const step =
    characters.length > 1
      ? Math.min(STAGGER, (SET * 6) / 7 / (characters.length - 1))
      : 0;
  pathSpan.textContent = '';
  const spans = characters.map((character) => {
    const span = document.createElement('span');
    span.textContent = character;
    span.style.visibility = 'hidden';
    pathSpan.appendChild(span);
    return span;
  });
  tween(
    SET,
    (_eased, raw) => {
      const elapsed = raw * SET;
      spans.forEach((span, index) => {
        span.style.visibility = index * step <= elapsed ? 'visible' : 'hidden';
      });
    },
    () => {
      pathSpan.textContent = newPath;
      done();
    },
  );
}

function file(
  row: HTMLElement,
  redirect: { from: string; to: string } | null,
  oldPath: string,
  newPath: string,
  done: () => void,
): void {
  const list = document.getElementById('redirect-list');
  for (const chip of [...document.querySelectorAll<HTMLElement>('#redirect-list .chip')]) {
    if (chip.textContent?.endsWith(`\u2192 ${oldPath}`) === true) {
      chip.textContent = `${chip.dataset.from ?? ''} \u2192 ${newPath}`;
    }
  }
  if (list === null || redirect === null) {
    done();
    return;
  }
  const chip = document.createElement('li');
  chip.className = 'chip';
  chip.dataset.from = redirect.from;
  chip.textContent = `${redirect.from} \u2192 ${redirect.to}`;
  const start = row.getBoundingClientRect();
  const flying = document.createElement('div');
  flying.className = 'chip flying';
  flying.textContent = chip.textContent;
  flying.style.left = `${start.left}px`;
  flying.style.top = `${start.top}px`;
  document.body.appendChild(flying);
  const target = list.getBoundingClientRect();
  tween(
    FILE,
    (eased) => {
      flying.style.transform = `translate(${(target.left - start.left) * eased}px, ${(target.bottom - start.top) * eased}px)`;
    },
    () => {
      flying.remove();
      list.appendChild(chip);
      done();
    },
  );
}

function count(total: number, done: () => void): void {
  const holder = document.getElementById('links-rewritten');
  const numeral = holder === null ? null : $<HTMLElement>('.count', holder);
  if (numeral === null) {
    done();
    return;
  }
  tween(
    COUNT,
    (eased) => {
      numeral.textContent = String(Math.round(total * eased));
    },
    () => {
      numeral.textContent = String(total);
      done();
    },
  );
}

export function playSplice(result: RenameResult, done: () => void): void {
  const { row, oldPath, newPath, linksRewritten, redirectAdded } = result;
  announce(messages.renamed(newPath, linksRewritten, oldPath));
  const pathSpan = $<HTMLElement>('.row-path', row);
  const editor = $<HTMLElement>('.page-editor');
  if (editor !== null && editor.dataset.pageId === row.dataset.pageId) {
    editor.dataset.path = newPath.replace(/^\//, '');
    history.replaceState(
      null,
      '',
      window.location.pathname.replace(/\/pages\/.*$/, `/pages/${newPath.replace(/^\//, '')}`),
    );
  }
  row.focus();
  if (pathSpan === null) {
    done();
    return;
  }
  setPhase(row, 'strike');
  strike(pathSpan, () => {
    setPhase(row, 'set');
    setText(pathSpan, newPath, () => {
      setPhase(row, 'file');
      file(row, redirectAdded, oldPath, newPath, () => {
        setPhase(row, 'count');
        count(linksRewritten, () => {
          setPhase(row, 'done');
          row.focus();
          done();
        });
      });
    });
  });
}
