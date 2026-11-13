// The segment editor: key list, segment editor, quality and history.

import { DeskError, Issue, KeyRow, Project, Segment, api } from './api';
import { labelledField, openModal } from './dialog';
import { clear, el, statusTag, statusWord } from './dom';
import { announce, clearProblem, failureCopy, problem, showFieldErrors } from './feedback';
import { updateQuery } from './router';

export async function renderEditor(
  screen: HTMLElement,
  project: Project,
  search: URLSearchParams,
): Promise<void> {
  const branch = search.get('branch') ?? 'main';
  const language = search.get('lang') ?? project.target_languages[0];
  const answer = await api.get<{ keys: KeyRow[] }>(
    `/api/projects/${project.slug}/branches/${encodeURIComponent(branch)}/keys?lang=${language}`,
  );
  const keys = answer.keys;
  let currentID = search.get('segment') ?? keys[0]?.translations[language]?.segment_id ?? '';

  const list = el('section', { class: 'card editor-keys', role: 'region', 'aria-label': 'Segments' });
  const editor = el('section', { class: 'card editor-main', role: 'region', 'aria-label': 'Segment editor' });
  const quality = el('section', {
    class: 'card editor-quality',
    role: 'region',
    'aria-label': 'Quality and history',
  });

  const paintList = (): void => {
    clear(list);
    list.append(el('h2', { text: 'Segments' }));
    const rows = el('ul', { class: 'key-list' });
    for (const key of keys) {
      const summary = key.translations[language];
      if (!summary) continue;
      const current = summary.segment_id === currentID;
      rows.append(
        el('li', {}, [
          el('button', {
            type: 'button',
            class: 'key-button',
            'aria-label': key.name,
            'aria-current': current ? 'true' : null,
            onclick: () => {
              currentID = summary.segment_id;
              updateQuery('segment', currentID);
              paintList();
              void paintSegment();
            },
          }, [
            el('span', { class: 'key-name', text: key.name }),
            el('span', { class: 'key-status', text: statusWord(summary.status) }),
          ]),
        ]),
      );
    }
    list.append(rows);
  };

  const paintSegment = async (): Promise<void> => {
    clear(editor);
    clear(quality);
    if (!currentID) {
      editor.append(el('h2', { text: 'Segment editor' }), el('p', { text: 'Choose a key to translate.' }));
      return;
    }
    const segment = await api.get<Segment>(`/api/segments/${currentID}`);
    for (const node of editorBody(project, segment, paintSegment, paintList)) {
      if (node) editor.append(node);
    }
    for (const node of qualityBody(segment)) {
      if (node) quality.append(node);
    }
  };

  if (currentID) updateQuery('segment', currentID);
  paintList();
  await paintSegment();

  screen.append(
    el('div', { class: 'content-column' }, [
      el('h1', { text: `${project.name}: ${branch} (${language})` }),
      el('div', { class: 'editor-grid' }, [list, editor, quality]),
    ]),
  );
}

function editorBody(
  project: Project,
  segment: Segment,
  reload: () => Promise<void>,
  reloadList: () => void,
): (Node | null)[] {
  const box = el('textarea', {
    class: 'translation-box',
    'data-field': 'value',
    rows: '5',
    'aria-label': `Translation (${segment.language})`,
    text: segment.value ?? '',
  });

  const save = el('button', { type: 'button', class: 'button primary', text: 'Save translation' });
  const record = el('button', { type: 'button', class: 'button outline', text: 'Record MQM issue' });
  const score = el('button', { type: 'button', class: 'button outline', text: 'Score' });
  const approve = el('button', { type: 'button', class: 'button outline', text: 'Approve' });
  const wrapper = el('div', { class: 'editor-body' });

  const saveValue = async (): Promise<void> => {
    clearProblem();
    save.disabled = true;
    announce('Saving.');
    try {
      await api.put(`/api/segments/${segment.id}/value`, { value: box.value });
      announce(`Saved ${segment.key}.`);
      await reload();
      reloadList();
    } catch (error) {
      save.disabled = false;
      announce('');
      if (error instanceof DeskError) {
        problem(failureCopy(error, { branch: segment.branch }));
        showFieldErrors(wrapper, error.info.fields);
      }
    }
  };

  save.addEventListener('click', () => void saveValue());
  box.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void saveValue();
    }
  });

  record.addEventListener('click', () => openIssueDialog(segment, record, reload, reloadList));

  score.addEventListener('click', async () => {
    clearProblem();
    score.disabled = true;
    announce('Recording MQM issues.');
    try {
      const updated = await api.post<Segment>(`/api/segments/${segment.id}/score`, {
        issues: segment.issues,
      });
      announce(
        updated.status === 'needs_review'
          ? `Scored MQM ${updated.score}. Sent to review.`
          : `Scored MQM ${updated.score}.`,
      );
      await reload();
      reloadList();
    } catch (error) {
      score.disabled = false;
      announce('');
      if (error instanceof DeskError) problem(failureCopy(error, { from: statusWord(segment.status) }));
    }
  });

  approve.disabled = !['scored', 'needs_review'].includes(segment.status);
  approve.addEventListener('click', async () => {
    clearProblem();
    approve.disabled = true;
    announce('Approving.');
    try {
      await api.post(`/api/segments/${segment.id}/approve`);
      announce('Approved.');
      await reload();
      reloadList();
    } catch (error) {
      approve.disabled = false;
      announce('');
      if (error instanceof DeskError) {
        problem(failureCopy(error, { from: statusWord(segment.status), branch: segment.branch }));
      }
    }
  });

  wrapper.append(
    el('h2', { text: 'Segment editor' }),
    el('p', { class: 'key-name', text: segment.key }),
    el('p', { class: 'source-text', text: segment.source ?? `This key was removed on ${segment.branch}.` }),
    el('p', {}, [statusTag(segment.status)]),
    box,
    el('div', { class: 'editor-actions' }, [save, record, score, approve]),
  );
  void project;
  return [wrapper];
}

function qualityBody(segment: Segment): (Node | null)[] {
  const nodes: (Node | null)[] = [
    el('h2', { text: 'Quality and history' }),
    el('p', { class: 'score-line tabular', text: segment.score === null ? 'Not scored' : `MQM ${segment.score}` }),
  ];
  if (segment.issues.length > 0) {
    nodes.push(
      el('ul', { class: 'issue-list' }, segment.issues.map((issue: Issue) =>
        el('li', { text: `${issue.category} / ${issue.severity}${issue.note ? ` \u2014 ${issue.note}` : ''}` }),
      )),
    );
  }
  nodes.push(el('div', { class: 'tm-box', id: 'tm-match' }, [el('p', { text: 'No exact match.' })]));
  nodes.push(
    el('h3', { text: 'Comments' }),
    segment.comments.length === 0
      ? el('p', { class: 'muted', text: 'No comments yet.' })
      : el('ul', { class: 'comment-list' }, segment.comments.map((comment) =>
          el('li', { text: `${comment.author}: ${comment.body}` }),
        )),
    el('h3', { text: 'Status history' }),
    el('ul', { class: 'history-list' }, segment.history.map((revision) =>
      el('li', {
        text: `${statusWord(revision.from)} \u2192 ${statusWord(revision.to)} by ${revision.actor}`,
      }),
    )),
  );

  if (segment.source) {
    void api
      .post<{ match: { source: string; target: string; reused_value: string } | null }>(
        `/api/projects/${segment.project}/tm/match`,
        { source: segment.source, language: segment.language },
      )
      .then((answer) => {
        const box = document.getElementById('tm-match');
        if (!box) return;
        clear(box);
        if (!answer.match) {
          box.append(el('p', { text: 'No exact match.' }));
          return;
        }
        box.append(
          el('h3', { text: 'Exact match from translation memory' }),
          el('p', { text: answer.match.reused_value }),
        );
      })
      .catch(() => undefined);
  }
  return nodes;
}

function openIssueDialog(
  segment: Segment,
  opener: HTMLElement,
  reload: () => Promise<void>,
  reloadList: () => void,
): void {
  openModal({
    name: 'Record MQM issue',
    opener,
    body: (handle) => {
      const category = el('select', { 'data-field': 'category', 'aria-label': 'Category', role: 'combobox' });
      for (const name of ['accuracy', 'fluency', 'terminology', 'style', 'locale-convention']) {
        category.append(el('option', { value: name, text: name }));
      }
      const severity = el('select', { 'data-field': 'severity', 'aria-label': 'Severity', role: 'combobox' });
      for (const name of ['minor', 'major', 'critical']) {
        severity.append(el('option', { value: name, text: name }));
      }
      const note = el('textarea', { 'data-field': 'note', rows: '3' });
      const add = el('button', { type: 'submit', class: 'button primary', text: 'Add issue' });
      const form = el('form', {
        onsubmit: async (event: Event) => {
          event.preventDefault();
          clearProblem();
          add.disabled = true;
          announce('Recording MQM issues.');
          try {
            const updated = await api.post<Segment>(`/api/segments/${segment.id}/issues`, {
              category: category.value,
              severity: severity.value,
              note: note.value,
            });
            announce(
              updated.status === 'needs_review'
                ? `Scored MQM ${updated.score}. Sent to review.`
                : `Scored MQM ${updated.score}.`,
            );
            handle.close();
            await reload();
            reloadList();
          } catch (error) {
            add.disabled = false;
            announce('');
            if (error instanceof DeskError) {
              problem(failureCopy(error, { from: statusWord(segment.status) }));
              showFieldErrors(form, error.info.fields);
            }
          }
        },
      }, [
        el('h2', { text: 'Record MQM issue' }),
        labelledField('Category', category),
        labelledField('Severity', severity),
        labelledField('Note', note),
        el('div', { class: 'dialog-actions' }, [
          add,
          el('button', { type: 'button', class: 'button quiet', text: 'Cancel', onclick: () => handle.close() }),
        ]),
      ]);
      return [form];
    },
  });
}
