import { copy } from '../../shared/copy.js';
import { renderNote } from '../../shared/notes.js';
import { ROLE_CHECKLIST } from '../../shared/permissions.js';
import { visibleTopics } from '../../shared/tree.js';
import type { Role, VersionRow } from '../../shared/types.js';
import { api, RequestFailed } from '../api.js';
import { clear, el, on } from '../dom.js';
import { renderMiniature } from '../miniature.js';
import { navigate } from '../router.js';
import { announce, notify, openDialog, trapFocus } from '../shell.js';
import type { Actions } from './actions.js';
import { nextId, type Editor } from './state.js';
import type { CanvasView } from './view.js';

export function openCrossLinkDialog(editor: Editor, opener: HTMLElement): void {
  openDialog({ title: 'Add cross-link', returnFocusTo: opener }, (close, body) => {
    const target = el(
      'select',
      { 'aria-label': 'Link to' },
      visibleTopics(editor.view())
        .filter((id) => id !== editor.focusId)
        .map((id) => el('option', { value: id, text: editor.doc.topics[id].title })),
    ) as HTMLSelectElement;
    const label = el('input', { type: 'text', 'aria-label': 'Label' }) as HTMLInputElement;
    const related = el('input', { type: 'radio', name: 'link-type', value: 'related', checked: true });
    const depends = el('input', { type: 'radio', name: 'link-type', value: 'depends' });
    const add = el('button', { type: 'button', class: 'primary', text: 'Add link' });
    on(add, 'click', () => {
      editor.send([
        {
          op_id: nextId('o'),
          kind: 'link_add',
          link_id: nextId('l'),
          from: editor.focusId,
          to: target.value,
          label: label.value,
          type: (depends as HTMLInputElement).checked ? 'depends' : 'related',
        },
      ]);
      close();
    });
    body.append(
      el('h2', { text: 'Add cross-link' }),
      el('label', {}, [el('span', { text: 'Link to' }), target]),
      el('label', {}, [el('span', { text: 'Label' }), label]),
      el('fieldset', { role: 'radiogroup', 'aria-label': 'Type' }, [
        el('legend', { text: 'Type' }),
        el('label', {}, [related, el('span', { text: 'Related' })]),
        el('label', {}, [depends, el('span', { text: 'Depends on' })]),
      ]),
      el('div', { class: 'dialog-actions' }, [add]),
    );
  });
}

export function openTopicMenu(
  editor: Editor,
  actions: Actions,
  id: string,
  at: { x: number; y: number },
): void {
  const menu = el('div', { class: 'topic-menu', role: 'menu', 'aria-label': 'Topic actions' });
  const collapsed = editor.collapsed.has(id);
  const items: [string, () => void][] = [
    ['Add child', () => actions.addChild(id)],
    ['Add sibling', () => actions.addSibling(id)],
    ['Rename', () => actions.openTitleInput(id, 'rename')],
    [collapsed ? 'Expand' : 'Collapse', () => actions.toggleCollapse(id)],
    ['Open details', () => actions.onOpenDetails?.(id)],
    ['Delete', () => actions.remove([id])],
  ];
  document.body.append(menu);
  const trap = trapFocus(menu, {});
  for (const [label, run] of items) {
    const item = el('button', { type: 'button', role: 'menuitem', text: label });
    on(item, 'click', () => {
      trap.close();
      run();
    });
    menu.append(item);
  }
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(at.x, window.innerWidth - box.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(at.y, window.innerHeight - box.height - 8))}px`;
  const outside = (event: Event): void => {
    if (!(event.target instanceof Node) || menu.contains(event.target)) return;
    document.removeEventListener('pointerdown', outside);
    trap.close();
  };
  window.setTimeout(() => document.addEventListener('pointerdown', outside), 0);
  (menu.firstElementChild as HTMLElement | null)?.focus();
}

export function openShareDialog(editor: Editor, opener: HTMLElement): void {
  interface LinkRow {
    id: string;
    code: string;
    role: Role;
    expires_at: string | null;
    state: string;
    url: string;
  }
  openDialog({ title: 'Share', returnFocusTo: opener, className: 'share-dialog' }, (close, body) => {
    body.append(el('h2', { text: 'Share' }));
    const preview = el('div', { class: 'share-preview' });
    const accordion = el('div', { class: 'accordion' });
    for (const role of ['owner', 'editor', 'commenter', 'viewer'] as Role[]) {
      const list = el(
        'ul',
        { class: 'checklist' },
        ROLE_CHECKLIST[role].map((line) => el('li', { text: line })),
      );
      const row = el('div', { class: 'accordion-row' });
      const button = el('button', {
        type: 'button',
        'aria-expanded': 'false',
        text: role.charAt(0).toUpperCase() + role.slice(1),
      });
      on(button, 'click', () => {
        const open = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', open ? 'false' : 'true');
        row.classList.toggle('open', !open);
        clear(preview);
        if (!open) {
          preview.append(
            el('p', { text: `As ${role}` }),
            renderMiniature(editor.doc, editor.doc.layout),
          );
        }
      });
      row.append(button, list);
      accordion.append(row);
    }
    body.append(el('div', { class: 'share-roles' }, [accordion, preview]));

    const invite = el('input', { type: 'text', 'aria-label': 'Invite username' }) as HTMLInputElement;
    const roleChoice = el('select', { 'aria-label': 'Role' }, [
      el('option', { value: 'editor', text: 'editor' }),
      el('option', { value: 'commenter', text: 'commenter' }),
      el('option', { value: 'viewer', text: 'viewer' }),
    ]) as HTMLSelectElement;
    const inviteButton = el('button', { type: 'button', class: 'primary', text: 'Invite' });
    const people = el('ul', { class: 'members', 'aria-label': 'People with access' });
    const error = el('p', { class: 'field-error' });

    const paintMembers = async (): Promise<void> => {
      const answer = await api.get<{ members: { username: string; role: Role }[] }>(
        `/api/maps/${editor.mapId}/members`,
      );
      clear(people);
      for (const member of answer.members) {
        if (member.role === 'owner') {
          people.append(el('li', {}, [el('span', { text: `${member.username} \u00b7 owner` })]));
          continue;
        }
        const select = el('select', { 'aria-label': `Role for ${member.username}` }, [
          el('option', { value: 'editor', text: 'editor' }),
          el('option', { value: 'commenter', text: 'commenter' }),
          el('option', { value: 'viewer', text: 'viewer' }),
        ]) as HTMLSelectElement;
        select.value = member.role;
        on(select, 'change', () => {
          void api
            .put(`/api/maps/${editor.mapId}/members/${member.username}`, { role: select.value })
            .catch((failure: unknown) => {
              if (failure instanceof RequestFailed) error.textContent = failure.body.message;
            });
        });
        const remove = el('button', {
          type: 'button',
          class: 'secondary',
          text: `Remove ${member.username}`,
        });
        on(remove, 'click', () => {
          void api
            .del(`/api/maps/${editor.mapId}/members/${member.username}`)
            .then(() => paintMembers())
            .catch(() => undefined);
        });
        people.append(el('li', {}, [el('span', { text: member.username }), select, remove]));
      }
    };
    on(inviteButton, 'click', () => {
      void api
        .put(`/api/maps/${editor.mapId}/members/${invite.value.trim()}`, { role: roleChoice.value })
        .then(() => {
          invite.value = '';
          error.textContent = '';
          return paintMembers();
        })
        .catch((failure: unknown) => {
          if (failure instanceof RequestFailed) error.textContent = failure.body.message;
        });
    });

    const linkRole = el('select', { 'aria-label': 'Link role' }, [
      el('option', { value: 'editor', text: 'editor' }),
      el('option', { value: 'commenter', text: 'commenter' }),
      el('option', { value: 'viewer', text: 'viewer' }),
    ]) as HTMLSelectElement;
    const expires = el('input', { type: 'datetime-local', 'aria-label': 'Expires' }) as HTMLInputElement;
    const createLink = el('button', { type: 'button', class: 'primary', text: 'Create link' });
    const links = el('ul', { class: 'links', 'aria-label': 'Share links' });
    const paintLinks = async (): Promise<void> => {
      const answer = await api.get<{ links: LinkRow[] }>(`/api/maps/${editor.mapId}/links`);
      clear(links);
      for (const link of answer.links) {
        const url = `${window.location.origin}/s/${link.code}`;
        const copyButton = el('button', { type: 'button', class: 'secondary', text: 'Copy link' });
        on(copyButton, 'click', () => {
          void navigator.clipboard?.writeText(url).catch(() => undefined);
          announce('Link copied.');
        });
        const regenerate = el('button', { type: 'button', class: 'secondary', text: 'Regenerate' });
        on(regenerate, 'click', () => {
          void api
            .post(`/api/maps/${editor.mapId}/links/${link.id}/regenerate`)
            .then(() => paintLinks())
            .catch((failure: unknown) => {
              if (failure instanceof RequestFailed) error.textContent = failure.body.message;
            });
        });
        const turnOff = el('button', { type: 'button', class: 'secondary', text: 'Turn off' });
        on(turnOff, 'click', () => {
          void api
            .del(`/api/maps/${editor.mapId}/links/${link.id}`)
            .then(() => paintLinks())
            .catch((failure: unknown) => {
              if (failure instanceof RequestFailed) error.textContent = failure.body.message;
            });
        });
        links.append(
          el('li', {}, [
            el('span', { text: `${link.role} \u00b7 ${link.state} \u00b7 ${url}` }),
            copyButton,
            regenerate,
            turnOff,
          ]),
        );
      }
    };
    on(createLink, 'click', () => {
      const value = expires.value === '' ? null : new Date(expires.value).toISOString();
      void api
        .post(`/api/maps/${editor.mapId}/links`, { role: linkRole.value, expires_at: value })
        .then(() => {
          error.textContent = '';
          return paintLinks();
        })
        .catch((failure: unknown) => {
          if (failure instanceof RequestFailed) error.textContent = failure.body.message;
        });
    });

    body.append(
      el('div', { class: 'share-invite' }, [
        el('label', {}, [el('span', { text: 'Invite username' }), invite]),
        el('label', {}, [el('span', { text: 'Role' }), roleChoice]),
        inviteButton,
      ]),
      people,
      el('div', { class: 'share-links' }, [
        el('label', {}, [el('span', { text: 'Link role' }), linkRole]),
        el('label', {}, [el('span', { text: 'Expires' }), expires]),
        createLink,
      ]),
      links,
      error,
    );
    void paintMembers();
    void paintLinks();
    const done = el('button', { type: 'button', class: 'secondary', text: 'Close' });
    on(done, 'click', close);
    body.append(done);
  });
}

export function openImportDialog(editor: Editor, opener: HTMLElement): void {
  const chosen = editor.focusId;
  openDialog({ title: 'Import outline', returnFocusTo: opener }, (close, body) => {
    const picker = el('input', {
      type: 'file',
      accept: '.txt,text/plain',
      'aria-label': 'Outline file',
    }) as HTMLInputElement;
    const errors = el('div', { class: 'import-errors' });
    const help = el('div', { class: 'accordion' });
    const questions: [string, string][] = [
      ['What does the first line say?', 'Every file starts with the line sprig 1.'],
      ['How are levels written?', 'Indent two spaces for each level below the first topic.'],
      ['How do I add a note?', 'Write | note=Your text after the title.'],
      ['How do I mark a task?', 'Write | done=40 and, if needed, | weight=2.'],
      ['Which fields are allowed?', 'done, weight, state, priority, due, assignee, colour, icon, at and note.'],
      ['How do I write a pipe?', 'Escape it as \\| inside a title or value.'],
      ['What line endings are used?', 'Exports use LF endings, and imports accept CRLF too.'],
    ];
    for (const [question, answer] of questions) {
      const row = el('div', { class: 'accordion-row' });
      const button = el('button', { type: 'button', 'aria-expanded': 'false', text: question });
      const text = el('p', { text: answer });
      on(button, 'click', () => {
        const open = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', open ? 'false' : 'true');
        row.classList.toggle('open', !open);
      });
      row.append(button, text);
      help.append(row);
    }
    on(picker, 'change', () => {
      const file = picker.files?.[0];
      if (!file) return;
      clear(errors);
      notify(copy.readingFile(file.name));
      void file
        .arrayBuffer()
        .then((bytes) => api.upload<{ import: { id: string; topic_count: number } }>(
          `/api/maps/${editor.mapId}/imports`,
          bytes,
        ))
        .then((answer) => {
          close();
          openImportPreview(editor, answer.import.id, answer.import.topic_count, chosen);
        })
        .catch((failure: unknown) => {
          if (!(failure instanceof RequestFailed)) throw failure;
          errors.append(el('h3', { text: failure.body.message }));
          for (const line of failure.body.lines ?? []) errors.append(el('p', { text: line }));
          if (!failure.body.lines) notify(failure.body.message, 'warning');
        });
    });
    body.append(
      el('h2', { text: 'Import outline' }),
      el('label', {}, [el('span', { text: 'Outline file' }), picker]),
      errors,
      help,
    );
  });
}

function openImportPreview(
  editor: Editor,
  importId: string,
  count: number,
  parentId: string,
): void {
  openDialog({ title: 'Import preview' }, (close, body) => {
    const title = editor.doc.topics[parentId]?.title ?? '';
    const add = el('button', { type: 'button', class: 'primary', text: 'Add to map' });
    const cancel = el('button', { type: 'button', class: 'secondary', text: 'Cancel' });
    on(add, 'click', () => {
      void api
        .post(`/api/maps/${editor.mapId}/imports/${importId}/graft`, {
          parent_id: parentId,
          group_id: nextId('g'),
          base_revision: editor.revision,
        })
        .then(() => editor.resync())
        .then(() => close())
        .catch((failure: unknown) => {
          if (failure instanceof RequestFailed) notify(failure.body.message, 'warning');
        });
    });
    on(cancel, 'click', close);
    body.append(
      el('h2', { text: 'Import preview' }),
      el('p', { text: copy.importPreview(count, title) }),
      el('div', { class: 'dialog-actions' }, [add, cancel]),
    );
  });
}

export function openExportDialog(editor: Editor, opener: HTMLElement): void {
  openDialog({ title: 'Export', returnFocusTo: opener }, (close, body) => {
    void close;
    const sprig = el('input', { type: 'radio', name: 'export-format', value: 'sprig', checked: true });
    const picture = el('input', { type: 'radio', name: 'export-format', value: 'svg' });
    const start = el('button', { type: 'button', class: 'primary', text: 'Start export' });
    const progress = el('div', {
      class: 'progress-bar',
      role: 'progressbar',
      'aria-label': 'Export',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': '0',
    });
    const fill = el('span', { class: 'progress-fill' });
    progress.append(fill);
    const actions = el('div', { class: 'dialog-actions' });
    const paint = (state: string, value: number, id: string): void => {
      progress.setAttribute('aria-valuenow', String(value));
      fill.style.width = `${value}%`;
      clear(actions);
      if (state === 'ready') {
        const link = el('a', {
          href: `/api/exports/${id}/download`,
          download: '',
          text: 'Download export',
        });
        actions.append(link);
        notify(copy.exportReady);
      }
      if (state === 'failed') {
        const retry = el('button', { type: 'button', class: 'secondary', text: 'Retry export' });
        on(retry, 'click', () => {
          void api
            .post<{ export: { id: string; state: string; progress: number } }>(
              `/api/exports/${id}/retry`,
            )
            .then((answer) => {
              paint(answer.export.state, answer.export.progress, id);
              poll(id);
            })
            .catch(() => undefined);
        });
        actions.append(retry);
        notify(copy.exportOutage, 'warning');
      }
    };
    const poll = (id: string): void => {
      const timer = window.setInterval(() => {
        void api
          .get<{ export: { state: string; progress: number } }>(`/api/exports/${id}`)
          .then((answer) => {
            paint(answer.export.state, answer.export.progress, id);
            if (answer.export.state === 'ready' || answer.export.state === 'failed') {
              window.clearInterval(timer);
            }
          })
          .catch(() => window.clearInterval(timer));
      }, 150);
    };
    on(start, 'click', () => {
      const format = (sprig as HTMLInputElement).checked ? 'sprig' : 'svg';
      void api
        .post<{ export: { id: string; state: string; progress: number } }>(
          `/api/maps/${editor.mapId}/exports`,
          { format, topic_id: null },
        )
        .then((answer) => {
          paint(answer.export.state, answer.export.progress, answer.export.id);
          poll(answer.export.id);
        })
        .catch((failure: unknown) => {
          if (failure instanceof RequestFailed) notify(failure.body.message, 'warning');
        });
    });
    body.append(
      el('h2', { text: 'Export' }),
      el('fieldset', { role: 'radiogroup', 'aria-label': 'Format' }, [
        el('legend', { text: 'Format' }),
        el('label', {}, [sprig, el('span', { text: 'Sprig outline' })]),
        el('label', {}, [picture, el('span', { text: 'SVG picture' })]),
      ]),
      start,
      progress,
      actions,
    );
    void picture;
  });
}

export function openHistoryDialog(editor: Editor, opener: HTMLElement): void {
  openDialog({ title: 'History', returnFocusTo: opener }, (close, body) => {
    void close;
    body.append(el('h2', { text: 'History' }));
    const slider = el('input', {
      type: 'range',
      min: '1',
      max: '1',
      value: '1',
      'aria-label': 'Version playback',
    }) as HTMLInputElement;
    const valueText = el('p', { class: 'slider-value' });
    const openVersion = el('button', { type: 'button', class: 'primary', text: 'View version' });
    body.append(slider, valueText, openVersion);
    void api
      .get<{ versions: VersionRow[] }>(`/api/maps/${editor.mapId}/versions`)
      .then((answer) => {
        const versions = answer.versions;
        if (versions.length === 0) {
          valueText.textContent = 'No versions yet.';
          return;
        }
        slider.max = String(versions.length);
        slider.value = String(versions.length);
        const paint = (): void => {
          const index = Number(slider.value) - 1;
          const version = versions[index];
          valueText.textContent = copy.sliderValueText(version.number, versions.length, version.by);
          slider.setAttribute('aria-valuetext', valueText.textContent);
        };
        paint();
        on(slider, 'input', paint);
        on(openVersion, 'click', () => {
          const version = versions[Number(slider.value) - 1];
          navigate(`/m/${editor.mapId}/versions/${version.id}`);
        });
      })
      .catch(() => undefined);
  });
}

export function openSessionDialog(editor: Editor): void {
  const existing = document.querySelector('.session-dialog');
  if (existing) return;
  const card = el('div', {
    class: 'dialog-card session-dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Sign in again',
  });
  const scrim = el('div', { class: 'scrim' }, [card]);
  const password = el('input', { type: 'password', 'aria-label': 'Password' }) as HTMLInputElement;
  const signIn = el('button', { type: 'button', class: 'primary', text: 'Sign in' });
  const error = el('p', { class: 'field-error' });
  card.append(
    el('h2', { text: 'Sign in again' }),
    el('p', { text: copy.sessionDialogText }),
    el('label', {}, [el('span', { text: 'Password' }), password]),
    error,
    signIn,
  );
  document.body.append(scrim);
  const trap = trapFocus(scrim, { escapable: false });
  on(signIn, 'click', () => {
    void api
      .post('/api/auth/login', { username: editor.me, password: password.value })
      .then(() => {
        editor.sessionExpired = false;
        trap.close();
        return editor.flushQueue();
      })
      .catch((failure: unknown) => {
        if (failure instanceof RequestFailed) error.textContent = failure.body.message;
      });
  });
}

export function openPresenter(editor: Editor, view: CanvasView, opener: HTMLElement): void {
  interface Presentation {
    id: string;
    code: string;
    state: string;
    slide_index: number;
    followers: number;
  }
  let presentation: Presentation | null = null;
  const region = el('div', { class: 'presenter', role: 'region', 'aria-label': 'Presenter' });
  editor.presenting = true;
  const slides = el('ul', { class: 'slides', 'aria-label': 'Slides' });
  const notes = el('div', { role: 'region', 'aria-label': 'Speaker notes', class: 'speaker-notes' });
  const followers = el('p', { class: 'followers', text: copy.followerCount(0) });
  const counter = el('p', { class: 'slide-counter' });
  const linkText = el('p', { class: 'presenter-link' });
  const addSlide = el('button', { type: 'button', class: 'secondary', text: 'Add slide' });
  const goLive = el('button', { type: 'button', class: 'primary', text: 'Go live' });
  const endShow = el('button', { type: 'button', class: 'secondary', text: 'End presentation' });
  const copyLink = el('button', { type: 'button', class: 'secondary', text: 'Copy link' });

  const paintSlides = (): void => {
    clear(slides);
    editor.slides.forEach((id, index) => {
      const row = el('li', {}, [
        el('span', { text: `${index + 1}. ${editor.doc.topics[id]?.title ?? 'Deleted topic'}` }),
      ]);
      const button = el('button', {
        type: 'button',
        class: 'slide-row',
        text: editor.doc.topics[id]?.title ?? 'Deleted topic',
      });
      on(button, 'keydown', (event) => {
        const key = (event as KeyboardEvent).key;
        if (!(event as KeyboardEvent).altKey) return;
        if (key !== 'ArrowUp' && key !== 'ArrowDown') return;
        event.preventDefault();
        const order = [...editor.slides];
        const to = key === 'ArrowUp' ? index - 1 : index + 1;
        if (to < 0 || to >= order.length) return;
        [order[index], order[to]] = [order[to], order[index]];
        editor.slides = order;
        editor.send([{ op_id: nextId('o'), kind: 'slides', order }]);
        paintSlides();
        (slides.children[to]?.querySelector('button') as HTMLElement | null)?.focus();
      });
      clear(row);
      row.append(button);
      slides.append(row);
    });
    counter.textContent = copy.slideCounter(
      (presentation?.slide_index ?? 0) + 1,
      Math.max(editor.slides.length, 1),
    );
    const current = editor.slides[presentation?.slide_index ?? 0];
    notes.innerHTML = current ? renderNote(editor.doc.topics[current]?.note ?? '') : '';
  };

  on(addSlide, 'click', () => {
    const order = [...editor.slides, editor.focusId];
    editor.slides = order;
    editor.send([{ op_id: nextId('o'), kind: 'slides', order }]);
    paintSlides();
  });
  on(copyLink, 'click', () => {
    if (!presentation) return;
    void navigator.clipboard?.writeText(`${window.location.origin}/p/${presentation.code}`).catch(() => undefined);
  });
  on(goLive, 'click', () => {
    if (!presentation) return;
    void api
      .post<{ presentation: Presentation; skipped: { index: number; reason: string }[] }>(
        `/api/presentations/${presentation.id}/state`,
        { to: 'live' },
      )
      .then((answer) => {
        presentation = answer.presentation;
        for (const skip of answer.skipped) {
          notify(
            skip.reason === 'deleted'
              ? copy.slideSkippedDeleted(skip.index + 1)
              : copy.slideSkippedRestricted(skip.index + 1),
            'warning',
          );
        }
        paintSlides();
        frameSlide();
      })
      .catch((failure: unknown) => {
        if (failure instanceof RequestFailed) notify(failure.body.message, 'warning');
      });
  });
  const finish = (): void => {
    if (!presentation) return;
    void api
      .post(`/api/presentations/${presentation.id}/state`, { to: 'ended' })
      .then(() => {
        editor.presenting = false;
        region.remove();
        opener.focus();
      })
      .catch(() => undefined);
  };
  on(endShow, 'click', finish);

  const frameSlide = (): void => {
    const id = editor.slides[presentation?.slide_index ?? 0];
    if (!id || !editor.doc.topics[id]) return;
    const branch: string[] = [];
    const walk = (each: string): void => {
      branch.push(each);
      for (const child of editor.doc.topics[each]?.children ?? []) walk(child);
    };
    walk(id);
    const frame = view.fitFrame(branch);
    view.animateCamera(frame);
    editor.zoom = frame.zoom;
    editor.panX = frame.panX;
    editor.panY = frame.panY;
    editor.changed();
  };

  const step = (direction: 1 | -1): void => {
    if (!presentation || presentation.state !== 'live') return;
    const index = presentation.slide_index + direction;
    if (index < 0 || index >= editor.slides.length) return;
    void api
      .post<{ presentation: Presentation; skipped: { index: number; reason: string }[] }>(
        `/api/presentations/${presentation.id}/step`,
        { index },
      )
      .then((answer) => {
        presentation = answer.presentation;
        for (const skip of answer.skipped) {
          notify(
            skip.reason === 'deleted'
              ? copy.slideSkippedDeleted(skip.index + 1)
              : copy.slideSkippedRestricted(skip.index + 1),
            'warning',
          );
        }
        paintSlides();
        frameSlide();
      })
      .catch(() => undefined);
  };

  on(region, 'keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (key === 'ArrowRight' || key === ' ') {
      event.preventDefault();
      step(1);
    } else if (key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    } else if (key === 'Escape') {
      event.preventDefault();
      finish();
    }
  });

  editor.onPresentation = (message) => {
    const incoming = message.presentation as Presentation | undefined;
    if (!incoming) return;
    presentation = incoming;
    followers.textContent = copy.followerCount(incoming.followers);
    paintSlides();
  };

  region.append(
    el('h2', { text: 'Presenter' }),
    slides,
    el('div', { class: 'presenter-actions' }, [addSlide, goLive, endShow, copyLink]),
    linkText,
    followers,
    counter,
    notes,
  );
  document.body.append(region);
  paintSlides();
  void api
    .post<{ presentation: Presentation }>(`/api/maps/${editor.mapId}/presentations`)
    .then((answer) => {
      presentation = answer.presentation;
      linkText.textContent = `${window.location.origin}/p/${answer.presentation.code}`;
      paintSlides();
    })
    .catch((failure: unknown) => {
      if (failure instanceof RequestFailed) notify(failure.body.message, 'warning');
    });
  goLive.focus();
}
