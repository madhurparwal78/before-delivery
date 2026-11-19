import { firstName, utcToWallTime, wallTimeToUtc } from '../../shared/format';
import { api } from '../api';
import { announce, clearAlerts, h, menu, qs, qsa, showAlert } from '../dom';
import { cfg, currentMember, on } from '../state';
import { S } from '../strings';

type Question = {
  id?: string;
  type: string;
  text: string;
  required: boolean;
  knock_out: boolean;
  ideal: string | null;
  options: string[] | null;
  accepted: string[] | null;
  minimum: number | null;
  maximum: number | null;
};

type FieldName = 'title' | 'location' | 'workplace' | 'closes_at' | 'description';

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  location: 'Location',
  workplace: 'Workplace',
  closes_at: 'Closes',
  description: 'Description',
  questions: 'Screening questions',
};

type Editor = {
  fields: Record<string, { value: unknown; version: number }>;
  editing: { id: string; name: string }[];
};

export function jobEditorView(jobId: string): HTMLElement {
  const host = h('div', { class: 'narrow editor' });
  const presence = h('p', {
    role: 'status',
    'aria-label': 'Editing now',
    class: 'muted',
    text: S.editor.onlyYou,
  });
  const fieldHost = h('div', { class: 'editor-fields' });
  const questionHost = h('div', { class: 'editor-questions' });
  let editor: Editor | null = null;
  let questions: Question[] = [];
  const dirty = new Set<string>();
  const typingTimers = new Map<string, number>();
  let lastTyping = 0;
  let questionSaveTimer = 0;

  host.append(presence, fieldHost, questionHost);
  void load();

  const offField = on('job_field', (data) => {
    if (String(data.job_id) !== jobId || !editor) return;
    const field = String(data.field);
    const by = data.by as { id: string; name: string };
    const me = currentMember();
    if (by && me && by.id === me.id) {
      editor.fields[field] = { value: data.value, version: Number(data.version) };
      return;
    }
    /* A field with an unsaved change keeps the version it read, so the next save conflicts. */
    if (!dirty.has(field)) editor.fields[field] = { value: data.value, version: Number(data.version) };
    if (field === 'questions') {
      questions = data.value as Question[];
      drawQuestions();
      return;
    }
    const input = qs<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      `[data-field-input="${field}"]`,
      fieldHost,
    );
    const note = qs<HTMLElement>(`[data-field="${field}"]`, fieldHost);
    if (!input) return;
    if (!dirty.has(field)) {
      input.value =
        field === 'closes_at'
          ? utcToWallTime(String(data.value), cfg().time_zone)
          : String(data.value);
      if (note) note.textContent = '';
    } else if (note && by) {
      note.textContent = S.editor.savedNewVersion(firstName(by.name));
    }
  });
  const offTyping = on('job_typing', (data) => {
    if (String(data.job_id) !== jobId) return;
    const me = currentMember();
    if (me && String(data.member_id) === me.id) return;
    const field = String(data.field);
    const note = qs<HTMLElement>(`[data-field="${field}"]`, fieldHost);
    if (!note) return;
    note.textContent = S.editor.typingHere(firstName(String(data.name)));
    const existing = typingTimers.get(field);
    if (existing) window.clearTimeout(existing);
    typingTimers.set(
      field,
      window.setTimeout(() => {
        if (note.textContent === S.editor.typingHere(firstName(String(data.name)))) {
          note.textContent = '';
        }
      }, cfg().typing_timeout_ms),
    );
  });
  const offPresence = on('job_presence', (data) => {
    if (String(data.job_id) !== jobId) return;
    drawPresence((data.editing as { id: string; name: string }[]) ?? []);
  });

  const heartbeat = window.setInterval(() => {
    if (document.contains(host)) void loadPresence();
  }, 3000);

  const observer = new MutationObserver(() => {
    if (!document.contains(host)) {
      offField();
      offTyping();
      offPresence();
      window.clearInterval(heartbeat);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return host;

  async function load(): Promise<void> {
    const result = await api.get<Editor>(`/api/jobs/${jobId}/editor`);
    if (!result.ok) {
      host.replaceChildren(
        h('div', { class: 'empty' }, [
          h('h1', { class: 'big-sentence', text: S.empty.profileUnavailable }),
          h('a', { href: '/jobs', class: 'link underline' }, ['Go to Home']),
        ]),
      );
      return;
    }
    editor = result.body;
    questions = (editor.fields.questions.value as Question[]) ?? [];
    drawFields();
    drawQuestions();
    drawPresence(editor.editing);
  }

  /* Keeps this editor in the job's presence list; the list itself arrives on the stream. */
  async function loadPresence(): Promise<void> {
    const result = await api.get<Editor>(`/api/jobs/${jobId}/editor`);
    if (result.ok) drawPresence(result.body.editing);
  }

  function drawPresence(editing: { id: string; name: string }[]): void {
    presence.textContent =
      editing.length === 0
        ? S.editor.onlyYou
        : S.editor.alsoEditing(
            editing.map((entry) => entry.name),
            editing.length,
          );
  }

  function drawFields(): void {
    if (!editor) return;
    fieldHost.replaceChildren(h('h1', { class: 'page-title', text: 'Edit job' }));
    const definitions: { name: FieldName; label: string; kind: 'text' | 'select' | 'area' }[] = [
      { name: 'title', label: 'Title', kind: 'text' },
      { name: 'location', label: 'Location', kind: 'text' },
      { name: 'workplace', label: 'Workplace', kind: 'select' },
      { name: 'closes_at', label: 'Closes', kind: 'text' },
      { name: 'description', label: 'Description', kind: 'area' },
    ];
    for (const definition of definitions) {
      const stored = editor.fields[definition.name];
      const initial =
        definition.name === 'closes_at'
          ? utcToWallTime(String(stored.value), cfg().time_zone)
          : String(stored.value);
      const note = h('p', { 'data-field-note': '', 'data-field': definition.name, class: 'muted' });
      const wrap = h('div', { class: 'field-block' });
      let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (definition.kind === 'select') {
        input = h(
          'select',
          {
            'aria-label': 'Workplace',
            class: 'input',
            'data-field-input': definition.name,
          },
          [
            h('option', { value: 'on-site' }, ['On-site']),
            h('option', { value: 'hybrid' }, ['Hybrid']),
            h('option', { value: 'remote' }, ['Remote']),
          ],
        ) as HTMLSelectElement;
        (input as HTMLSelectElement).value = initial;
      } else if (definition.kind === 'area') {
        input = h('textarea', {
          'aria-label': definition.label,
          class: 'input',
          rows: '4',
          'data-field-input': definition.name,
          value: initial,
        }) as HTMLTextAreaElement;
      } else {
        input = h('input', {
          type: 'text',
          'aria-label': definition.label,
          class: 'input',
          'data-field-input': definition.name,
          value: initial,
        }) as HTMLInputElement;
      }
      let loaded = initial;
      input.addEventListener('input', () => {
        dirty.add(definition.name);
        if (Date.now() - lastTyping < 1000) return;
        lastTyping = Date.now();
        void api.post(`/api/jobs/${jobId}/editor/typing`, { field: definition.name });
      });
      input.addEventListener('blur', () => void save());
      if (definition.kind !== 'area') {
        input.addEventListener('keydown', (event) => {
          if ((event as KeyboardEvent).key === 'Enter') {
            event.preventDefault();
            void save();
          }
        });
      }
      wrap.append(h('label', { class: 'field' }, [h('span', { text: definition.label }), input]), note);
      fieldHost.append(wrap);

      async function save(force?: number): Promise<void> {
        if (!editor) return;
        if (input.value === loaded && force === undefined) return;
        /* The attempted text counts as sent, so a blur never repeats the same save. */
        loaded = input.value;
        clearAlerts(wrap);
        const value =
          definition.name === 'closes_at'
            ? wallTimeToUtc(input.value, cfg().time_zone)
            : input.value;
        if (definition.name === 'closes_at' && value === null) {
          showAlert(wrap, S.alert.closesFormat);
          return;
        }
        const version = force ?? editor.fields[definition.name].version;
        const result = await api.patch<{
          error?: string;
          fields?: Record<string, string>;
          current_version?: number;
          current?: unknown;
          by?: { id: string; name: string };
          version?: number;
          value?: unknown;
        }>(`/api/jobs/${jobId}/fields/${definition.name}`, { value, version });
        if (result.ok) {
          editor.fields[definition.name] = {
            value: result.body.value,
            version: Number(result.body.version),
          };
          dirty.delete(definition.name);
          note.textContent = '';
          announce('Jobs announcements', S.announce.jobFieldSaved(definition.label));
          return;
        }
        if (result.body.error === 'field_conflict') {
          const by = result.body.by ?? { id: '', name: '' };
          const currentVersion = result.body.current_version ?? version;
          const currentValue = String(result.body.current ?? '');
          const alert = h('div', { role: 'alert', class: 'alert' }, [
            S.alert.jobFieldConflict(by.name),
            h(
              'button',
              {
                type: 'button',
                class: 'button quiet',
                click: () => {
                  input.value =
                    definition.name === 'closes_at'
                      ? utcToWallTime(currentValue, cfg().time_zone)
                      : currentValue;
                  loaded = input.value;
                  dirty.delete(definition.name);
                  if (editor) {
                    editor.fields[definition.name] = {
                      value: currentValue,
                      version: currentVersion,
                    };
                  }
                  alert.remove();
                },
              },
              ['Use theirs'],
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'button quiet',
                click: () => {
                  alert.remove();
                  void save(currentVersion);
                },
              },
              ['Keep mine'],
            ),
          ]);
          wrap.append(alert);
          return;
        }
        const fields = result.body.fields ?? {};
        showAlert(wrap, Object.values(fields)[0] ?? S.alert.somethingWrong);
      }
    }
  }

  /** Several controls change at once (a blur beside a click), so changes coalesce. */
  function scheduleQuestionSave(): void {
    window.clearTimeout(questionSaveTimer);
    questionSaveTimer = window.setTimeout(() => void saveQuestions(), 150);
  }

  async function saveQuestions(force?: number, moved?: { position: number; total: number }): Promise<void> {
    if (!editor) return;
    window.clearTimeout(questionSaveTimer);
    clearAlerts(questionHost);
    const version = force ?? editor.fields.questions.version;
    const result = await api.patch<{
      error?: string;
      fields?: Record<string, string>;
      limit?: number;
      current_version?: number;
      value?: Question[];
      version?: number;
      by?: { id: string; name: string };
    }>(`/api/jobs/${jobId}/fields/questions`, { value: questions, version });
    if (result.ok) {
      const stored = (result.body.value ?? []) as Question[];
      editor.fields.questions = { value: stored, version: Number(result.body.version) };
      /* Server ids land on the cards in place, so focus and open alerts survive a save. */
      stored.forEach((entry, index) => {
        if (questions[index]) questions[index].id = entry.id;
        const card = qs<HTMLElement>(`[data-position="${index + 1}"]`, questionHost);
        if (card && entry.id) card.setAttribute('data-question-id', entry.id);
      });
      announce(
        'Jobs announcements',
        moved
          ? S.announce.questionMoved(moved.position, moved.total)
          : S.announce.jobFieldSaved(FIELD_LABELS.questions),
      );
      return;
    }
    if (result.body.error === 'questions_locked') {
      showAlert(questionHost, S.alert.questionsLocked);
      return;
    }
    if (result.body.error === 'too_many_questions') {
      showAlert(questionHost, S.alert.tooManyQuestions);
      return;
    }
    if (result.body.error === 'field_conflict') {
      const by = result.body.by ?? { id: '', name: '' };
      showAlert(questionHost, S.alert.jobFieldConflict(by.name));
      return;
    }
    const fields = result.body.fields ?? {};
    for (const [key, message] of Object.entries(fields)) {
      const position = Number(key.split('.')[1]);
      const card = qs<HTMLElement>(`[data-position="${position}"]`, questionHost);
      if (card) showAlert(card, message);
      else showAlert(questionHost, message);
    }
    if (Object.keys(fields).length === 0) showAlert(questionHost, S.alert.somethingWrong);
  }

  function drawQuestions(): void {
    questionHost.replaceChildren();
    const region = h('section', { 'aria-label': 'Screening questions', class: 'panel' }, [
      h('h2', { class: 'section-title', text: 'Screening questions' }),
    ]);
    const list = h('ul', { 'aria-label': 'Questions', class: 'question-list' });
    questions.forEach((question, index) => list.append(questionCard(question, index)));
    region.append(list);
    const addButton = h(
      'button',
      {
        type: 'button',
        class: 'button',
        click: () => {
          menu(addButton, [
            { label: 'Short answer', run: () => addQuestion('short_answer') },
            { label: 'Yes or no', run: () => addQuestion('yes_no') },
            { label: 'Single choice', run: () => addQuestion('single_choice') },
            { label: 'Number', run: () => addQuestion('number') },
          ]);
        },
      },
      ['Add question'],
    );
    region.append(addButton);
    questionHost.append(region);
  }

  function addQuestion(type: string): void {
    questions.push({
      type,
      text: '',
      required: false,
      knock_out: false,
      ideal: null,
      options: type === 'single_choice' ? ['', ''] : null,
      accepted: type === 'single_choice' ? [] : null,
      minimum: null,
      maximum: null,
    });
    drawQuestions();
    const cards = qsa<HTMLElement>('[data-position]', questionHost);
    const last = cards[cards.length - 1];
    qs<HTMLInputElement>('input[type="text"]', last)?.focus();
  }

  function moveQuestion(index: number, delta: number): void {
    const next = index + delta;
    if (next < 0 || next >= questions.length) return;
    const [moved] = questions.splice(index, 1);
    questions.splice(next, 0, moved);
    drawQuestions();
    const card = qs<HTMLElement>(`[data-position="${next + 1}"]`, questionHost);
    card?.focus();
    void saveQuestions(undefined, { position: next + 1, total: questions.length });
  }

  function questionCard(question: Question, index: number): HTMLElement {
    const card = h('li', {
      class: 'question-card',
      tabindex: '0',
      'data-question-id': question.id ?? '',
      'data-question-type': question.type,
      'data-position': String(index + 1),
      draggable: 'true',
      dragstart: (event: Event) => {
        (event as DragEvent).dataTransfer?.setData('text/plain', String(index));
      },
      dragover: (event: Event) => event.preventDefault(),
      drop: (event: Event) => {
        event.preventDefault();
        const from = Number((event as DragEvent).dataTransfer?.getData('text/plain') ?? '-1');
        if (from < 0 || from === index) return;
        moveQuestion(from, index - from);
      },
      keydown: (event: Event) => {
        const keyEvent = event as KeyboardEvent;
        if (!keyEvent.altKey) return;
        if (keyEvent.target !== card) return;
        if (keyEvent.key === 'ArrowUp') {
          keyEvent.preventDefault();
          moveQuestion(index, -1);
        } else if (keyEvent.key === 'ArrowDown') {
          keyEvent.preventDefault();
          moveQuestion(index, 1);
        }
      },
    });

    const text = h('input', {
      type: 'text',
      'aria-label': 'Question text',
      class: 'input',
      value: question.text,
      input: () => {
        question.text = text.value;
      },
      blur: () => scheduleQuestionSave(),
    }) as HTMLInputElement;

    const required = h('input', {
      type: 'checkbox',
      'aria-label': 'Required',
      checked: question.required,
      change: () => {
        question.required = required.checked;
        scheduleQuestionSave();
      },
    }) as HTMLInputElement;

    const knockOut = h('input', {
      type: 'checkbox',
      'aria-label': 'Knock-out',
      checked: question.knock_out,
      change: () => {
        question.knock_out = knockOut.checked;
        scheduleQuestionSave();
      },
    }) as HTMLInputElement;

    card.append(
      text,
      h('label', { class: 'field inline' }, [required, h('span', { text: 'Required' })]),
      h('label', { class: 'field inline' }, [knockOut, h('span', { text: 'Knock-out' })]),
    );

    if (question.type === 'yes_no') {
      const group = h('div', { role: 'radiogroup', 'aria-label': 'Ideal answer', class: 'radiogroup' });
      for (const [value, label] of [
        ['yes', 'Yes'],
        ['no', 'No'],
      ]) {
        const radio = h('input', {
          type: 'radio',
          name: `ideal-${index}`,
          'aria-label': label,
          value,
          checked: question.ideal === value,
          change: () => {
            question.ideal = value;
            scheduleQuestionSave();
          },
        }) as HTMLInputElement;
        group.append(h('label', { class: 'field inline' }, [radio, h('span', { text: label })]));
      }
      card.append(group);
    }

    if (question.type === 'single_choice') {
      const options = question.options ?? [];
      options.forEach((option, optionIndex) => {
        const input = h('input', {
          type: 'text',
          'aria-label': `Option ${optionIndex + 1}`,
          class: 'input',
          value: option,
          input: () => {
            options[optionIndex] = input.value;
          },
          blur: () => scheduleQuestionSave(),
        }) as HTMLInputElement;
        const accept = h('input', {
          type: 'checkbox',
          'aria-label': `Accept ${option}`,
          checked: (question.accepted ?? []).includes(option),
          change: () => {
            const accepted = new Set(question.accepted ?? []);
            if (accept.checked) accepted.add(option);
            else accepted.delete(option);
            question.accepted = [...accepted];
            scheduleQuestionSave();
          },
        }) as HTMLInputElement;
        card.append(
          input,
          h('label', { class: 'field inline' }, [accept, h('span', { text: `Accept ${option}` })]),
        );
      });
      card.append(
        h(
          'button',
          {
            type: 'button',
            class: 'button quiet',
            click: () => {
              question.options = [...options, ''];
              drawQuestions();
            },
          },
          ['Add option'],
        ),
      );
    }

    if (question.type === 'number') {
      const minimum = h('input', {
        type: 'number',
        'aria-label': 'Minimum',
        class: 'input',
        value: question.minimum === null ? '' : String(question.minimum),
        change: () => {
          question.minimum = minimum.value === '' ? null : Number(minimum.value);
          scheduleQuestionSave();
        },
      }) as HTMLInputElement;
      const maximum = h('input', {
        type: 'number',
        'aria-label': 'Maximum',
        class: 'input',
        value: question.maximum === null ? '' : String(question.maximum),
        change: () => {
          question.maximum = maximum.value === '' ? null : Number(maximum.value);
          scheduleQuestionSave();
        },
      }) as HTMLInputElement;
      card.append(minimum, maximum);
    }

    card.append(
      h(
        'button',
        {
          type: 'button',
          class: 'text-button',
          click: () => {
            questions.splice(index, 1);
            drawQuestions();
            const cards = qsa<HTMLElement>('[data-position]', questionHost);
            const next = cards[index];
            if (next) next.focus();
            else qsa<HTMLElement>('button', questionHost).at(-1)?.focus();
            scheduleQuestionSave();
          },
        },
        ['Remove question'],
      ),
    );
    return card;
  }
}
