// The branch rail: a tablist of main and every open or in-review branch, whose
// panels show the server's merge-preview counts.

import { Branch, Preview, Project, api } from './api';
import { clear, el, reducedMotion } from './dom';
import { branchHub } from './illustrations';
import { updateQuery } from './router';

export type RailHandle = {
  node: HTMLElement;
  selected: () => string;
};

export function branchRail(options: {
  project: Project;
  branches: Branch[];
  initial: string;
  onSelect?: (branch: string) => void;
}): RailHandle {
  const { project, branches } = options;
  const tablist = el('div', { class: 'tablist', role: 'tablist', 'aria-label': 'Branches' });
  const indicator = el('span', { class: 'tab-indicator', 'aria-hidden': 'true' });
  const strip = el('div', { class: 'tab-strip' }, [tablist, indicator]);
  const panels = el('div', { class: 'tab-panels' });
  const node = el('div', { class: 'branch-rail' }, [strip, panels]);

  let selected = branches.some((branch) => branch.name === options.initial) ? options.initial : 'main';
  updateQuery('branch', selected);

  const tabs = branches.map((branch) => {
    const tab = el('button', {
      type: 'button',
      role: 'tab',
      class: 'tab',
      id: tabId(branch.name),
      'aria-selected': 'false',
      'aria-controls': panelId(branch.name),
      tabindex: '-1',
      text: branch.name,
      onclick: () => select(branch.name, false),
      onkeydown: (event: KeyboardEvent) => onKey(event, branch.name),
    });
    tablist.append(tab);
    return { branch, tab };
  });

  function onKey(event: KeyboardEvent, name: string): void {
    const names = branches.map((branch) => branch.name);
    const at = names.indexOf(name);
    let next = -1;
    if (event.key === 'ArrowRight') next = (at + 1) % names.length;
    if (event.key === 'ArrowLeft') next = (at - 1 + names.length) % names.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = names.length - 1;
    if (next < 0) return;
    event.preventDefault();
    select(names[next], true);
  }

  function paintTabs(): void {
    for (const { branch, tab } of tabs) {
      const current = branch.name === selected;
      tab.setAttribute('aria-selected', current ? 'true' : 'false');
      tab.setAttribute('tabindex', current ? '0' : '-1');
      tab.classList.toggle('current', current);
    }
    moveIndicator();
  }

  function moveIndicator(): void {
    const tab = tabs.find((item) => item.branch.name === selected)?.tab;
    if (!tab) return;
    indicator.style.transitionDuration = reducedMotion() ? '0ms' : '200ms';
    indicator.style.width = `${tab.offsetWidth}px`;
    indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
  }

  function scrollIntoView(): void {
    const tab = tabs.find((item) => item.branch.name === selected)?.tab;
    if (!tab) return;
    tablist.scrollTo({
      left: tab.offsetLeft - tablist.clientWidth / 2 + tab.offsetWidth / 2,
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
  }

  function select(name: string, keepFocus: boolean): void {
    selected = name;
    paintTabs();
    updateQuery('branch', name);
    scrollIntoView();
    options.onSelect?.(name);
    void showPanel(name);
    if (keepFocus) tabs.find((item) => item.branch.name === name)?.tab.focus();
  }

  async function showPanel(name: string): Promise<void> {
    const branch = branches.find((item) => item.name === name);
    if (!branch) return;
    const panel = el('div', {
      class: 'tab-panel fade-in',
      role: 'tabpanel',
      id: panelId(name),
      'aria-labelledby': tabId(name),
      tabindex: '0',
    }, [skeleton()]);
    if (reducedMotion()) panel.classList.remove('fade-in');

    const previous = Array.from(panels.children) as HTMLElement[];
    for (const old of previous) {
      if (reducedMotion()) {
        old.remove();
      } else {
        old.classList.remove('fade-in');
        old.classList.add('fade-out');
        window.setTimeout(() => old.remove(), 150);
      }
    }
    panels.append(panel);

    let preview: Preview;
    try {
      preview = await api.get<Preview>(
        `/api/projects/${project.slug}/branches/${encodeURIComponent(name)}/merge-preview`,
      );
    } catch {
      return;
    }
    if (!panel.isConnected) return;
    clear(panel);
    panel.append(panelBody(project, branch, preview));
  }

  paintTabs();
  void showPanel(selected);
  window.addEventListener('resize', moveIndicator);
  // The indicator is measured from the laid-out tab, so it is placed again
  // once the strip has its final width.
  window.requestAnimationFrame(() => window.requestAnimationFrame(moveIndicator));
  window.setTimeout(moveIndicator, 120);
  if (document.fonts) void document.fonts.ready.then(moveIndicator);

  return { node, selected: () => selected };
}

function tabId(name: string): string {
  return `tab-${name.replace(/[^a-z0-9]+/gi, '-')}`;
}

function panelId(name: string): string {
  return `panel-${name.replace(/[^a-z0-9]+/gi, '-')}`;
}

function skeleton(): HTMLElement {
  return el('div', { class: 'skeleton-counts' }, [
    el('span', { class: 'skeleton-bar' }),
    el('span', { class: 'skeleton-bar' }),
    el('span', { class: 'skeleton-bar' }),
    el('span', { class: 'skeleton-bar' }),
  ]);
}

function panelBody(project: Project, branch: Branch, preview: Preview): HTMLElement {
  const counts: [string, string][] = branch.is_main
    ? [
        ['Keys', String(preview.keys)],
        ['Needs review', String(preview.needs_review)],
        ['Below MQM threshold', String(preview.below_threshold)],
        ['Last publish', lastPublishWord(project)],
      ]
    : [
        ['New keys', String(preview.new_keys)],
        ['Edited keys', String(preview.edited_keys)],
        ['Conflicts', String(preview.conflicts.length)],
        ['Below MQM threshold', String(preview.below_threshold)],
      ];

  const left = el('div', { class: 'panel-left' }, [
    el('dl', { class: 'counts' }, counts.flatMap(([caption, value]) => [
      el('dt', { text: caption }),
      el('dd', { class: 'tabular', text: value }),
    ])),
  ]);

  if (!branch.is_main) {
    left.append(el('h3', { text: 'Conflicting keys' }));
    if (preview.conflicts.length === 0) {
      left.append(el('p', { text: 'No conflicts with main.' }));
    } else {
      left.append(
        el('ul', { class: 'conflict-list' }, preview.conflicts.map((conflict) =>
          el('li', { text: `${conflict.key} (${conflict.field})` }),
        )),
      );
    }
  }

  const language = project.target_languages[0];
  left.append(
    el('div', { class: 'panel-links' }, [
      el('a', {
        class: 'link-arrow',
        href: `/projects/${project.slug}/editor?branch=${encodeURIComponent(branch.name)}&lang=${language}`,
      }, ['Open editor', el('span', { class: 'arrow', 'aria-hidden': 'true', text: '\u2192' })]),
      branch.is_main
        ? null
        : el('a', {
            class: 'link-arrow',
            href: `/projects/${project.slug}/merge?branch=${encodeURIComponent(branch.name)}`,
          }, ['Open merge preview', el('span', { class: 'arrow', 'aria-hidden': 'true', text: '\u2192' })]),
    ]),
  );

  return el('div', { class: 'panel-columns' }, [
    left,
    branchHub({
      branch: branch.name,
      repository: project.repository,
      entries: project.tm_entries ?? 0,
      routes: project.target_languages.map((code) => [code, project.ai_routes[code] ?? 'lexa-general']),
    }),
  ]);
}

function lastPublishWord(project: Project): string {
  const publish = project.last_publish;
  if (!publish || !publish.pull_request) return 'Never';
  return `Pull request #${publish.pull_request.number}`;
}
