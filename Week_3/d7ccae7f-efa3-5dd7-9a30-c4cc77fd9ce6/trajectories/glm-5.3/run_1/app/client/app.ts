import { api, ApiError, type Deck, type DeckSummary, type HostRoom, type PlayerView, type PlayerQuestion, type Question, type Reveal } from './api.ts';
import { LiveLink, errorMessage, syncClock, tallyMark, optionLetter, sharePercent, type CountdownHandle, startCountdown } from './live.ts';

// ---------- tiny DOM helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'function') {
      node.addEventListener(key.replace(/^on/, ''), value as EventListener);
    } else if (typeof value === 'boolean') {
      if (key === 'disabled' && value) (node as HTMLButtonElement).disabled = true;
    } else if (value !== '') {
      node.setAttribute(key, value);
    }
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function liveRegion(label: string): { region: HTMLElement; set: (text: string) => void } {
  const region = el('div', { role: 'status', 'aria-live': 'polite', 'aria-label': label, class: 'status' });
  return { region, set: (text: string) => { region.textContent = text; } };
}

function fieldError(id: string): { wrap: HTMLElement; set: (message: string) => void } {
  const wrap = el('div', { id, class: 'field-error' });
  return { wrap, set: (message: string) => { wrap.textContent = message; } };
}

function formatDate(epochMs: number): string {
  const date = new Date(epochMs);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

// ---------- routing ----------

function route(): { path: string; parts: string[] } {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  return { path, parts: path.split('/').filter(Boolean) };
}

function navigate(path: string): void {
  history.pushState(null, '', path);
  render();
}

window.addEventListener('popstate', () => render());

// ---------- app shell ----------

const root = document.getElementById('root')!;

function render(): void {
  const { parts } = route();
  clear(root);
  if (parts[0] === 'host') {
    renderHost(parts);
    return;
  }
  if (parts[0] === 'stage' && parts[1]) {
    renderStage(parts[1]);
    return;
  }
  if (parts[0] === 'play' && parts[1]) {
    renderPhone(parts[1]);
    return;
  }
  renderJoin();
}

// ---------- join screen ----------

function renderJoin(): void {
  const token = localStorage.getItem('lastbell.rejoin');
  if (token) {
    // try to rejoin silently
    api.rejoin(token).then((res) => {
      localStorage.setItem('lastbell.client', res.clientId);
      navigate(`/play/${res.roomId}`);
    }).catch(() => {
      localStorage.removeItem('lastbell.rejoin');
      localStorage.removeItem('lastbell.client');
      drawJoin();
    });
    return;
  }
  drawJoin();
}

function drawJoin(): void {
  const status = liveRegion('Join status');
  const pinError = fieldError('pin-error');
  const nickError = fieldError('nick-error');

  const pinInput = el('input', { type: 'text', inputmode: 'numeric', pattern: '\\d{6}', maxlength: '6', autocomplete: 'off', 'aria-describedby': 'pin-error', id: 'pin-input' }) as HTMLInputElement;
  pinInput.setAttribute('aria-label', 'Room PIN');
  pinInput.placeholder = '000000';
  pinInput.classList.add('pin-field');

  const nickInput = el('input', { type: 'text', maxlength: '20', autocomplete: 'off', 'aria-describedby': 'nick-error', id: 'nick-input' }) as HTMLInputElement;
  nickInput.setAttribute('aria-label', 'Nickname');
  nickInput.placeholder = 'Your nickname';

  const submit = async () => {
    pinError.set('');
    nickError.set('');
    status.set('Joining…');
    try {
      const res = await api.join(pinInput.value.trim(), nickInput.value);
      localStorage.setItem('lastbell.rejoin', res.rejoinToken);
      localStorage.setItem('lastbell.client', res.clientId);
      navigate(`/play/${res.roomId}`);
    } catch (err) {
      if (err instanceof ApiError) {
        status.set('');
        if (err.status === 422) {
          const pin = err.field('pin');
          if (pin) pinError.set(pin);
          const nickname = err.field('nickname');
          if (nickname) nickError.set(nickname);
          if (!pin && !nickname) status.set('Check the PIN and nickname.');
          return;
        }
        const copy: Record<string, string> = {
          room_not_found: 'No live room has that PIN.',
          nickname_taken: 'That nickname is taken in this room.',
          room_full: 'This room is full.',
          room_closed: 'This night has reached the podium. Joining is closed.',
        };
        status.set(copy[err.body.error as string] ?? 'That did not work.');
      } else {
        status.set('That did not work.');
      }
    }
  };

  const joinButton = el('button', { onclick: submit }, 'Join the night');
  joinButton.setAttribute('aria-label', 'Join the night');

  const form = el('form', { onsubmit: (e: Event) => { e.preventDefault(); void submit(); } }) as HTMLFormElement;
  form.append(
    el('label', { for: 'pin-input' }, 'Room PIN'),
    pinInput,
    pinError.wrap,
    el('label', { for: 'nick-input' }, 'Nickname'),
    nickInput,
    nickError.wrap,
    joinButton,
    status.region,
  );

  const foot = el('div', { class: 'join-foot' });
  const signIn = el('a', { href: '/host/login' }, 'Quizmaster sign in');
  signIn.setAttribute('aria-label', 'Quizmaster sign in');
  foot.append(signIn);

  const hero = el('div', { class: 'join-hero' },
    undefined);
  const wordmark = el('div', { class: 'wordmark' }, 'Lastbell');
  const tagline = el('div', { class: 'tagline' }, 'Live pub quiz nights');
  hero.append(wordmark, tagline);

  const page = el('div', { class: 'page' });
  const col = el('div', { class: 'center-col' });
  col.append(hero, form, foot);
  page.append(col);
  root.append(page);
}

// ---------- host auth guard ----------

async function requireSession(onSignedOut: () => void, onSignedIn: () => void): Promise<void> {
  try {
    await api.me();
    onSignedIn();
  } catch {
    onSignedOut();
  }
}

// ---------- host: sign in ----------

function drawAuth(mode: 'login' | 'signup'): void {
  const status = liveRegion('Account status');
  const errorsById: Record<string, ReturnType<typeof fieldError>> = {};
  const inputs: Record<string, HTMLInputElement> = {};

  const makeField = (id: string, label: string, type: string) => {
    const errorBox = fieldError(`${id}-error`);
    errorsById[id] = errorBox;
    const input = el('input', { type, id, autocomplete: 'off', 'aria-describedby': `${id}-error` }) as HTMLInputElement;
    input.setAttribute('aria-label', label);
    inputs[id] = input;
    return [el('label', { for: id }, label), input, errorBox.wrap] as const;
  };

  const submit = async () => {
    for (const box of Object.values(errorsById)) box.set('');
    status.set(mode === 'login' ? 'Signing in…' : 'Creating your account…');
    try {
      if (mode === 'login') {
        await api.login({ email: inputs.email.value.trim(), password: inputs.password.value });
      } else {
        await api.signup({
          email: inputs.email.value.trim(),
          password: inputs.password.value,
          displayName: inputs.displayName.value.trim(),
        });
      }
      navigate('/host');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 422) {
          for (const key of Object.keys(errorsById)) {
            const message = err.field(key);
            if (message) errorsById[key].set(message);
          }
          status.set('');
          return;
        }
        const copy: Record<string, string> = {
          invalid_credentials: "That email and password don't match.",
          email_taken: 'An account already uses that email.',
        };
        status.set(copy[err.body.error as string] ?? 'That did not work.');
      } else {
        status.set('That did not work.');
      }
    }
  };

  const form = el('form', { onsubmit: (e: Event) => { e.preventDefault(); void submit(); } }) as HTMLFormElement;
  if (mode === 'signup') {
    form.append(...makeField('displayName', 'Display name', 'text'));
  }
  form.append(...makeField('email', 'Email', 'email'));
  form.append(...makeField('password', 'Password', 'password'));
  form.append(el('button', {}, mode === 'login' ? 'Sign in' : 'Create account'), status.region);

  const alt = el('p', {});
  const altLink = el('a', { href: mode === 'login' ? '/host/signup' : '/host/login' },
    mode === 'login' ? 'Create an account' : 'Sign in');
  alt.append(altLink);

  const page = el('div', { class: 'page' });
  const col = el('div', { class: 'center-col' });
  const heading = el('h1', {}, mode === 'login' ? 'Sign in' : 'Create account');
  col.append(heading, form, alt);
  page.append(col);
  root.append(page);
}

// ---------- host: decks ----------

function renderHost(parts: string[]): void {
  if (parts.length === 1) {
    requireSession(() => navigate('/host/login'), drawDecks);
    return;
  }
  if (parts[1] === 'login') {
    requireSession(() => drawAuth('login'), () => navigate('/host'));
    return;
  }
  if (parts[1] === 'signup') {
    requireSession(() => drawAuth('signup'), () => navigate('/host'));
    return;
  }
  if (parts[1] === 'decks' && parts[2]) {
    requireSession(() => navigate('/host/login'), () => drawDeckEditor(parts[2]));
    return;
  }
  if (parts[1] === 'nights' && parts[2]) {
    requireSession(() => navigate('/host/login'), () => drawNightDetail(parts[2]));
    return;
  }
  if (parts[1] === 'nights') {
    requireSession(() => navigate('/host/login'), drawPastNights);
    return;
  }
  navigate('/host');
}

function hostHeader(active: 'decks' | 'nights'): { header: HTMLElement; signOut: () => void } {
  const header = el('header', { class: 'site-header' });
  const mark = el('div', { class: 'wordmark' });
  const markLink = el('a', { href: '/host' }, 'Lastbell');
  mark.append(markLink);
  const actions = el('div', { class: 'header-actions' });
  const past = el('a', { href: '/host/nights', 'aria-label': 'Past nights' }, 'Past nights');
  if (active === 'nights') past.setAttribute('aria-current', 'page');
  const out = el('button', { 'aria-label': 'Sign out' }, 'Sign out');
  const signOut = () => {
    void api.logout().then(() => {
      localStorage.removeItem('lastbell.rejoin');
      localStorage.removeItem('lastbell.client');
      navigate('/host/login');
    });
  };
  out.addEventListener('click', signOut);
  actions.append(past, out);
  header.append(mark, actions);
  return { header, signOut };
}

function drawDecks(): void {
  const status = liveRegion('Decks status');
  const titleError = fieldError('title-error');
  const list = el('ul', { 'aria-label': 'Decks', role: 'list', class: 'decks-list' });
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '0.7rem';
  list.style.listStyle = 'none';
  list.style.padding = '0';

  const titleInput = el('input', { type: 'text', id: 'new-deck-title', 'aria-describedby': 'title-error', maxlength: '80' }) as HTMLInputElement;
  titleInput.setAttribute('aria-label', 'New deck title');
  titleInput.placeholder = 'New deck title';

  const create = async () => {
    titleError.set('');
    status.set('Creating deck…');
    try {
      await api.createDeck(titleInput.value);
      status.set('Deck created');
      titleInput.value = '';
      refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        titleError.set(err.field('title') ?? '');
        status.set('');
      } else {
        status.set('That did not work.');
      }
    }
  };

  const refresh = () => {
    api.decks().then(({ decks }) => {
      clear(list);
      for (const deck of decks) {
        const item = el('li', {});
        item.setAttribute('role', 'listitem');
        const row = el('div', { class: 'deck-row' });
        const meta = el('div', { class: 'deck-meta' });
        const link = el('a', { href: `/host/decks/${deck.id}` }, deck.title);
        link.setAttribute('aria-label', deck.title);
        const count = el('div', { class: 'count-line' }, `${deck.questionCount} questions`);
        meta.append(link, count);
        const openRoom = el('button', { onclick: () => openRoomFor(deck) }, 'Open room');
        openRoom.setAttribute('aria-label', `Open room for ${deck.title}`);
        row.append(meta, openRoom);
        item.append(row);
        list.append(item);
      }
    });
  };

  const openRoomFor = (deck: DeckSummary) => {
    status.set('Opening room…');
    api.createRoom(deck.id).then(({ room }) => {
      navigate(`/stage/${room.id}`);
    }).catch((err) => {
      if (err instanceof ApiError && err.status === 422) {
        status.set('Add a question before opening a room.');
      } else {
        status.set('That did not work.');
      }
    });
  };

  const createButton = el('button', { onclick: create }, 'Create deck');
  createButton.setAttribute('aria-label', 'Create deck');
  const form = el('div', { class: 'deck-title-form' });
  form.append(titleInput, createButton);

  const page = el('div', { class: 'page' });
  const col = el('div', { class: 'wide-col' });
  col.append(el('h1', {}, 'Your decks'), form, titleError.wrap, status.region, list);
  page.append(hostHeader('decks').header, col);
  root.append(page);
  refresh();
}

// ---------- host: deck editor ----------

function drawDeckEditor(deckId: string): void {
  const status = liveRegion('Editor status');
  let deck: Deck | null = null;

  const page = el('div', { class: 'page' });
  const col = el('div', { class: 'wide-col' });
  const header = hostHeader('decks');
  page.append(header.header, col);
  root.append(page);

  const draw = (loaded: Deck) => {
    deck = loaded;
    clear(col);
    const titleInput = el('input', { type: 'text', id: 'deck-title', maxlength: '80' }) as HTMLInputElement;
    titleInput.setAttribute('aria-label', 'Deck title');
    titleInput.value = loaded.title;

    const saveTitle = async () => {
      status.set('Saving…');
      try {
        const { deck: fresh } = await api.saveTitle(loaded.id, titleInput.value, loaded.version);
        status.set('Saved');
        draw(fresh);
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.body.error === 'version_conflict') {
            status.set('A newer version was saved elsewhere. Reload to see it.');
          } else if (err.status === 422) {
            status.set(err.field('title') ?? 'Check the title.');
          }
        } else {
          status.set('That did not work.');
        }
      }
    };
    const saveTitleButton = el('button', { onclick: saveTitle }, 'Save title');
    saveTitleButton.setAttribute('aria-label', 'Save title');

    const titleRow = el('div', { class: 'deck-title-form' });
    titleRow.append(titleInput, saveTitleButton);

    col.append(el('h1', {}, 'Deck'), titleRow, status.region);

    loaded.questions.forEach((question) => {
      col.append(questionPanel(loaded, question));
    });

    col.append(el('button', { onclick: addQuestion }, 'Add question'));
  };

  const addQuestion = () => {
    if (!deck) return;
    status.set('Saving…');
    api.addQuestion(deck.id, {
      type: 'multiple_choice',
      prompt: 'New question',
      timeLimitSeconds: 30,
      options: ['Option A', 'Option B'],
      correctIndex: 0,
    }).then(() => {
      status.set('Saved');
      api.deck(deck!.id).then(({ deck: fresh }) => draw(fresh));
    }).catch((err) => {
      status.set(err instanceof ApiError ? (errorMessage(err) || 'That did not work.') : 'That did not work.');
    });
  };

  const questionPanel = (owner: Deck, question: Question): HTMLElement => {
    const panel = el('section', { class: 'panel question-panel' });
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', `Question ${question.position}`);

    const fields = el('div', { class: 'question-fields' });
    const picture = el('div', { class: 'picture-area' });
    panel.append(fields, picture);

    const typeSelect = el('select', { id: `q-type-${question.id}` }) as HTMLSelectElement;
    typeSelect.setAttribute('aria-label', 'Question type');
    for (const [value, label] of [['multiple_choice', 'Multiple choice'], ['estimate', 'Estimate'], ['sequence', 'Sequence']] as const) {
      const option = el('option', { value }, label) as HTMLOptionElement;
      option.selected = question.type === value;
      typeSelect.append(option);
    }

    const promptInput = el('input', { type: 'text', maxlength: '200' }) as HTMLInputElement;
    promptInput.setAttribute('aria-label', 'Prompt');
    promptInput.value = question.prompt;

    const timeInput = el('input', { type: 'number', min: '5', max: '120', step: '1' }) as HTMLInputElement;
    timeInput.setAttribute('aria-label', 'Time limit (seconds)');
    timeInput.value = String(question.timeLimitSeconds);

    const state: Record<string, string> = { options: '', correctIndex: '', min: '', max: '', step: '', answer: '', tolerance: '', unit: '', items: '' };
    const inputs: Record<string, HTMLInputElement> = {};
    const dynamic = el('div', {});

    const mcFields = () => {
      clear(dynamic);
      const options = state.options ? JSON.parse(state.options) as string[] : (question.options ?? ['', '']);
      for (let i = 0; i < 4; i += 1) {
        const row = el('div', { class: 'option-row' });
        const letter = optionLetter(i);
        const input = el('input', { type: 'text', maxlength: '80' }) as HTMLInputElement;
        input.setAttribute('aria-label', `Option ${letter}`);
        input.value = options[i] ?? '';
        inputs[`option${i}`] = input;
        const radioId = `correct-${question.id}-${i}`;
        const radio = el('input', { type: 'radio', name: `correct-${question.id}`, id: radioId, value: String(i) }) as HTMLInputElement;
        radio.setAttribute('aria-label', `Correct: ${letter}`);
        radio.checked = (question.correctIndex ?? 0) === i;
        row.append(radio, input);
        dynamic.append(row);
      }
    };

    const estimateFields = () => {
      clear(dynamic);
      const grid = el('div', { class: 'number-grid' });
      const defs: [string, string][] = [['min', 'Minimum'], ['max', 'Maximum'], ['step', 'Step'], ['answer', 'Correct value'], ['tolerance', 'Tolerance'], ['unit', 'Unit']];
      for (const [key, label] of defs) {
        const box = el('div', {});
        const input = el('input', { type: key === 'unit' ? 'text' : 'number', step: 'any', maxlength: '20' }) as HTMLInputElement;
        input.setAttribute('aria-label', label);
        const value = (question as unknown as Record<string, number | string>)[key];
        input.value = value === undefined || value === null ? '' : String(value);
        inputs[key] = input;
        box.append(el('label', {}, label), input);
        grid.append(box);
      }
      dynamic.append(grid);
    };

    const sequenceFields = () => {
      clear(dynamic);
      const items = state.items ? JSON.parse(state.items) as string[] : (question.items ?? ['', '', '']);
      for (let i = 0; i < 6; i += 1) {
        const input = el('input', { type: 'text', maxlength: '80' }) as HTMLInputElement;
        input.setAttribute('aria-label', `Item ${i + 1}`);
        input.value = items[i] ?? '';
        input.placeholder = i >= 3 ? '(optional)' : '';
        inputs[`item${i}`] = input;
        dynamic.append(input);
      }
      dynamic.append(el('p', { class: 'hint' }, 'Items are entered in the correct order.'));
    };

    const redrawDynamic = () => {
      if (typeSelect.value === 'multiple_choice') mcFields();
      else if (typeSelect.value === 'estimate') estimateFields();
      else sequenceFields();
    };
    typeSelect.addEventListener('change', redrawDynamic);
    redrawDynamic();

    const collect = (): Record<string, unknown> => {
      const body: Record<string, unknown> = {
        type: typeSelect.value,
        prompt: promptInput.value,
        timeLimitSeconds: Number(timeInput.value || '0'),
      };
      if (typeSelect.value === 'multiple_choice') {
        const options = [0, 1, 2, 3]
          .map((i) => inputs[`option${i}`]?.value.trim() ?? '')
          .filter((value) => value !== '');
        const radios = [0, 1, 2, 3].map((i) => document.getElementById(`correct-${question.id}-${i}`) as HTMLInputElement | null);
        const selected = radios.findIndex((radio) => radio?.checked);
        body.options = options;
        body.correctIndex = selected >= 0 ? selected : 0;
      } else if (typeSelect.value === 'estimate') {
        for (const key of ['min', 'max', 'step', 'answer', 'tolerance', 'unit'] as const) {
          body[key] = key === 'unit' ? (inputs[key]?.value ?? '') : Number(inputs[key]?.value || '0');
        }
      } else {
        const items = [0, 1, 2, 3, 4, 5]
          .map((i) => inputs[`item${i}`]?.value.trim() ?? '')
          .filter((value) => value !== '');
        body.items = items;
      }
      return body;
    };

    const saveQuestion = async () => {
      status.set('Saving…');
      try {
        await api.saveQuestion(owner.id, question.id, { ...collect(), version: question.version });
        status.set('Saved');
        const { deck: fresh } = await api.deck(owner.id);
        draw(fresh);
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.body.error === 'version_conflict') {
            status.set('A newer version was saved elsewhere. Reload to see it.');
          } else if (err.status === 422) {
            status.set('Check the question fields.');
          } else {
            status.set('That did not work.');
          }
        } else {
          status.set('That did not work.');
        }
      }
    };
    const removeQuestion = async () => {
      await api.deleteQuestion(owner.id, question.id);
      const { deck: fresh } = await api.deck(owner.id);
      draw(fresh);
    };

    const saveButton = el('button', { onclick: saveQuestion }, 'Save question');
    const deleteButton = el('button', { onclick: removeQuestion }, 'Delete question');
    const actions = el('div', { class: 'panel-actions' });
    actions.append(saveButton, deleteButton);

    fields.append(typeSelect, promptInput, timeInput, dynamic, actions);

    // picture area
    const stateText = el('div', { class: 'picture-state' }, question.image ? 'Picture attached' : 'No picture');
    const fileLabel = el('label', {}, `Picture for question ${question.position}`);
    const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' }) as HTMLInputElement;
    fileInput.setAttribute('aria-label', `Picture for question ${question.position}`);
    picture.append(fileLabel, fileInput, stateText);

    const thumbSlot = el('div', {});

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      clear(thumbSlot);
      stateText.textContent = 'Uploading picture…';
      status.set('Uploading picture…');
      api.uploadImage(owner.id, question.id, file).then(() => {
        status.set('Picture attached');
        void api.deck(owner.id).then(({ deck: loaded }) => draw(loaded));
      }).catch((err) => {
        stateText.textContent = 'No picture';
        if (err instanceof ApiError) {
          const copy: Record<string, string> = {
            unsupported_type: "That file isn't a PNG, JPEG or WebP picture.",
            image_too_large: 'That picture is too large for a question.',
            empty_file: 'That file is empty.',
            image_store_unavailable: 'Picture storage is down. The question is saved without a picture.',
          };
          status.set(copy[err.body.error as string] ?? 'That did not work.');
        } else {
          status.set('That did not work.');
        }
      });
    });

    if (question.image) {
      const img = el('img', { src: question.image.previewUrl, alt: `Picture for question ${question.position}` });
      img.setAttribute('aria-label', `Picture for question ${question.position}`);
      const removeButton = el('button', { onclick: async () => {
        status.set('Removing picture…');
        try {
          await api.removeImage(owner.id, question.id);
          status.set('Picture removed');
          const { deck: fresh } = await api.deck(owner.id);
          draw(fresh);
        } catch (err) {
          if (err instanceof ApiError && err.body.error === 'image_store_unavailable') {
            status.set('Picture storage is down. The question is saved without a picture.');
          } else {
            status.set('That did not work.');
          }
        }
      } }, 'Remove picture');
      thumbSlot.append(img, removeButton);
    }
    picture.append(thumbSlot);

    return panel;
  };

  api.deck(deckId).then(({ deck: loaded }) => draw(loaded)).catch(() => navigate('/host'));
}

// ---------- host: past nights ----------

function drawPastNights(): void {
  const page = el('div', { class: 'page' });
  const col = el('div', { class: 'wide-col' });
  col.append(el('h1', {}, 'Past nights'));
  const loading = el('p', {}, 'Loading nights…');
  const list = el('ul', { 'aria-label': 'Past nights', role: 'list' });
  list.style.listStyle = 'none';
  list.style.padding = '0';
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '0.7rem';
  col.append(loading, list);
  page.append(hostHeader('nights').header, col);
  root.append(page);

  api.nights().then(({ nights }) => {
    loading.remove();
    if (nights.length === 0) {
      col.append(el('p', {}, 'No nights yet.'));
      return;
    }
    for (const night of nights) {
      const item = el('li', {});
      item.setAttribute('role', 'listitem');
      const panel = el('div', { class: 'panel night-row' });
      const left = el('div', {});
      const link = el('a', { href: `/host/nights/${night.roomId}` }, `${night.deckTitle} — ${formatDate(night.endedAt)}`);
      const top = night.podium.map((entry) => entry.nickname).join(', ');
      left.append(link, el('div', { class: 'top-three' }, `Top three: ${top || '—'}`));
      panel.append(left);
      item.append(panel);
      list.append(item);
    }
  });
}

function drawNightDetail(roomId: string): void {
  const page = el('div', { class: 'page' });
  const col = el('div', { class: 'wide-col' });
  page.append(hostHeader('nights').header, col);
  root.append(page);

  api.night(roomId).then(({ night }) => {
    col.append(el('h1', {}, night.deckTitle), el('p', { class: 'hint' }, formatDate(night.endedAt)));
    const table = el('table', {}) as HTMLTableElement;
    table.setAttribute('aria-label', 'Final standings');
    const thead = el('thead', {});
    const headRow = el('tr', {});
    headRow.append(el('th', {}, 'Rank'), el('th', {}, 'Nickname'), el('th', { class: 'num' }, 'Score'));
    thead.append(headRow);
    const tbody = el('tbody', {});
    for (const standing of night.standings) {
      const row = el('tr', {});
      row.append(
        el('td', { class: 'num' }, String(standing.rank)),
        el('td', {}, standing.nickname),
        el('td', { class: 'num' }, String(standing.score)),
      );
      tbody.append(row);
    }
    table.append(thead, tbody);
    col.append(table);
  }).catch(() => {
    col.append(el('p', {}, 'That night is not available.'));
  });
}

// ---------- stage ----------

function stageLegalCommands(state: string, questionIndex: number | null, questionCount: number): Record<string, boolean> {
  const more = questionIndex !== null && questionIndex < questionCount;
  switch (state) {
    case 'lobby': return { open_question: true, lock: false, reveal: false, show_leaderboard: false, show_podium: false, end: false };
    case 'question_open': return { open_question: false, lock: true, reveal: false, show_leaderboard: false, show_podium: false, end: false };
    case 'locked': return { open_question: false, lock: false, reveal: true, show_leaderboard: false, show_podium: false, end: false };
    case 'reveal': return { open_question: false, lock: false, reveal: false, show_leaderboard: true, show_podium: false, end: false };
    case 'leaderboard': return { open_question: more, lock: false, reveal: false, show_leaderboard: false, show_podium: true, end: false };
    case 'podium': return { open_question: false, lock: false, reveal: false, show_leaderboard: false, show_podium: false, end: true };
    case 'ended': return { open_question: false, lock: false, reveal: false, show_leaderboard: false, show_podium: false, end: false };
    default: return { open_question: false, lock: false, reveal: false, show_leaderboard: false, show_podium: false, end: false };
  }
}

function renderStage(roomId: string): void {
  void syncClock();
  const page = el('div', { class: 'stage' });
  root.append(page);

  const statusRegion = liveRegion('Stage status');
  const connectionRegion = liveRegion('Connection status');

  let room: HostRoom | null = null;
  let countdown: CountdownHandle | null = null;
  const replayedReveals = new Set<number>();

  const statusStrip = el('div', { class: 'stage-status-strip' });
  statusStrip.append(statusRegion.region, connectionRegion.region);

  const questionBand = el('div', { class: 'question-band' });
  const answerArea = el('div', { class: 'answer-area' });

  const controlBar = el('div', { class: 'control-bar' });

  const commandButtons: Record<string, HTMLButtonElement> = {};
  const shortcuts: Record<string, string> = { o: 'open_question', l: 'lock', r: 'reveal', b: 'show_leaderboard', p: 'show_podium', e: 'end' };
  const labels: Record<string, string> = {
    open_question: 'Open question',
    lock: 'Lock',
    reveal: 'Reveal',
    show_leaderboard: 'Leaderboard',
    show_podium: 'Podium',
    end: 'End night',
  };

  let dialogOpen = false;
  let openerButton: HTMLElement | null = null;
  const dialog = el('dialog', {});
  dialog.setAttribute('aria-label', 'End the night?');

  const sendCommand = (command: string) => {
    api.command(roomId, command).then(({ room: fresh }) => {
      const copy: Record<string, string> = {
        open_question: `Question ${fresh.questionIndex} open`,
        lock: 'Locked',
        reveal: 'Revealed',
        show_leaderboard: 'Leaderboard',
        show_podium: 'Podium',
        end: 'Night ended',
      };
      statusRegion.set(copy[command] ?? '');
      room = fresh;
      draw();
    }).catch((err) => {
      if (err instanceof ApiError && (err.body.error === 'illegal_transition' || err.body.error === 'no_more_questions')) {
        statusRegion.set("That step isn't available right now.");
      } else {
        statusRegion.set('That did not work.');
      }
    });
  };

  for (const [key, command] of Object.entries(shortcuts)) {
    const button = el('button', {});
    const label = el('span', {}, labels[command]);
    const hint = el('span', { class: 'key-hint' }, key.toUpperCase());
    button.append(label, hint);
    button.setAttribute('aria-label', labels[command]);
    button.setAttribute('aria-keyshortcuts', key);
    button.addEventListener('click', () => {
      if (command === 'end') {
        openEndDialog(button);
      } else {
        sendCommand(command);
      }
    });
    commandButtons[command] = button;
    controlBar.append(button);
  }

  const openEndDialog = (opener: HTMLElement) => {
    openerButton = opener;
    dialogOpen = true;
    clear(dialog);
    const text = el('p', {}, "Everyone's seat closes and the night moves to Past nights.");
    const keep = el('button', {}, 'Keep going');
    const end = el('button', {}, 'End night');
    const actions = el('div', { class: 'dialog-actions' });
    actions.append(keep, end);
    dialog.append(text, actions);
    dialog.addEventListener('close', () => {
      dialogOpen = false;
      openerButton?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dialog.close();
        event.preventDefault();
        return;
      }
      if (event.key === 'Tab') {
        const focusables = [keep, end];
        const index = focusables.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        if (event.shiftKey) {
          focusables[(index - 1 + focusables.length) % focusables.length].focus();
        } else {
          focusables[(index + 1) % focusables.length].focus();
        }
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    keep.addEventListener('click', () => dialog.close());
    end.addEventListener('click', () => {
      dialog.close();
      sendCommand('end');
    });
    dialog.showModal();
    keep.focus();
  };

  document.addEventListener('keydown', (event) => {
    if (dialogOpen) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const command = shortcuts[event.key.toLowerCase()];
    if (!command) return;
    const button = commandButtons[command];
    if (!button || button.disabled) return;
    event.preventDefault();
    if (command === 'end') openEndDialog(button);
    else sendCommand(command);
  });

  page.append(statusStrip, questionBand, answerArea, controlBar, dialog);

  const pictureSlotFor = (imageUrl: string | null, label: string): HTMLElement => {
    if (!imageUrl) return el('div', {});
    const img = el('img', { src: imageUrl, alt: label });
    img.addEventListener('error', () => {
      img.replaceWith(el('span', { class: 'hint' }, 'Picture unavailable'));
    });
    return img;
  };

  let seenEventId = 0;

  const link = new LiveLink(roomId, 'role=stage', {
    onEvent: (event) => {
      seenEventId = Math.max(seenEventId, event.id);
      if (event.type === 'superseded' || event.type === 'ended') {
        refresh();
        return;
      }
      if (event.type === 'reveal') {
        const reveal = event.data as Reveal;
        if (!replayedReveals.has(reveal.questionIndex)) {
          replayedReveals.add(reveal.questionIndex);
          revealJustSeen.set(reveal.questionIndex, Date.now());
        }
      }
      refresh();
    },
    onTransport: (transport) => {
      if (transport === 'backup') connectionRegion.set('Backup link: live updates are down. Answers still count.');
      else connectionRegion.set('Back on the live link');
    },
  });

  const revealJustSeen = new Map<number, number>();

  const refresh = () => {
    api.hostRoom(roomId).then(({ room: fresh }) => {
      room = fresh;
      if (fresh.transport === 'backup') {
        connectionRegion.set('Backup link: live updates are down. Answers still count.');
      } else if (connectionRegion.region.textContent?.startsWith('Backup')) {
        connectionRegion.set('Back on the live link');
      }
      draw();
    }).catch(() => {
      /* stage lost its session; leave as-is */
    });
  };

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const hasWebgl = (): boolean => {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(canvas.getContext('webgl'));
    } catch {
      return false;
    }
  };

  const draw = () => {
    if (!room) return;
    const current = room;
    clear(questionBand);
    clear(answerArea);

    for (const [command, button] of Object.entries(commandButtons)) {
      const legal = stageLegalCommands(current.state, current.questionIndex, current.questionCount);
      button.disabled = !legal[command];
    }

    if (current.state === 'ended') {
      statusRegion.set(statusRegion.region.textContent || 'Night ended');
    }

    const meta = el('div', { class: 'meta' });
    questionBand.append(meta);

    if (current.state === 'lobby') {
      drawStageLobby();
      return;
    }
    if (current.state === 'ended') {
      const ended = el('div', { class: 'stage-lobby' });
      ended.append(el('h1', {}, 'The night has ended'));
      answerArea.append(ended);
      return;
    }

    if (current.questionIndex !== null) {
      meta.textContent = `Question ${current.questionIndex} of ${current.questionCount}`;
    }

    if (current.state === 'question_open' || current.state === 'locked' || current.state === 'reveal') {
      const question = current.question;
      const promptEl = el('div', { class: 'prompt' }, question?.prompt ?? '');
      questionBand.append(promptEl);
      if (question?.imageUrl) {
        questionBand.append(pictureSlotFor(question.imageUrl, 'Question picture'));
      }
      const answeredLine = el('div', { class: 'count-line' }, `${current.answered} of ${current.seated} answered`);
      questionBand.append(answeredLine);
    }

    if (current.state === 'question_open' || current.state === 'locked') {
      const timerEl = el('div', { class: 'timer-band', role: 'timer' });
      timerEl.setAttribute('aria-label', 'Time left');
      answerArea.append(timerEl);
      countdown?.stop();
      countdown = startCountdown(current.question?.deadlineAt ?? null, (left) => {
        timerEl.textContent = String(left);
        timerEl.classList.toggle('late', left <= 5);
      });
      if (current.state === 'question_open' && current.question) {
        answerArea.append(drawStageQuestionBody(current.question, false));
      }
      return;
    }

    if (current.state === 'reveal' || current.state === 'leaderboard') {
      if (current.state === 'reveal' && current.reveal) {
        drawTallyPour(current.reveal, current);
      } else {
        drawLeaderboard(current);
      }
      return;
    }

    if (current.state === 'podium') {
      drawPodium(current);
    }
  };

  const drawStageLobby = () => {
    if (!room) return;
    const lobby = el('div', { class: 'stage-lobby' });
    const joinDetails = el('div', { role: 'region', 'aria-label': 'Join details' });
    joinDetails.append(
      el('div', { class: 'pin-display' }, room.pin),
      el('div', { class: 'join-line' }, `Join at ${location.origin}`),
      el('div', { class: 'count-line' }, `${room.connected} of ${room.seated} phones connected`),
    );
    const playersList = el('ul', { class: 'player-list', 'aria-label': 'Players' });
    for (const player of room.players) {
      const item = el('li', { role: 'listitem' }, player.nickname);
      playersList.append(item);
    }
    lobby.append(joinDetails, playersList);
    answerArea.append(lobby);
  };

  const drawStageQuestionBody = (question: PlayerQuestion, interactive: boolean): HTMLElement => {
    const wrap = el('div', {});
    if (question.type === 'multiple_choice') {
      const tiles = el('div', { class: 'tiles' });
      const options = question.options ?? [];
      for (let i = 0; i < options.length; i += 1) {
        const tile = el('div', { class: 'tile', role: 'button', tabindex: interactive ? '0' : '-1' });
        tile.setAttribute('aria-label', `${optionLetter(i)}: ${options[i]}`);
        const letter = el('div', { class: 'letter' }, `${optionLetter(i)} `);
        letter.append(el('span', { class: 'tally' }, tallyMark(i + 1)));
        tile.append(letter);
        tile.append(el('div', { class: 'option' }, options[i]));
        tiles.append(tile);
      }
      wrap.append(tiles);
    } else if (question.type === 'estimate') {
      const unit = question.unit ?? '';
      wrap.append(el('div', { class: 'estimate-band' }, `Estimate between ${question.min} and ${question.max} ${unit}`));
    } else {
      const list = el('ul', { class: 'sequence-list', 'aria-label': 'Items to order' });
      for (const item of question.items ?? []) {
        const li = el('li', { role: 'listitem' }, item.label);
        list.append(li);
      }
      wrap.append(list);
    }
    return wrap;
  };

  const revealItems = (reveal: Reveal, room_: HostRoom): { text: string; correct: boolean; count: number }[] => {
    const items: { text: string; correct: boolean; count: number }[] = [];
    if (reveal.type === 'multiple_choice') {
      const question = room_.question;
      const options = question?.options ?? [];
      (reveal.counts ?? []).forEach((count, i) => {
        items.push({ text: `${optionLetter(i)}: ${options[i] ?? ''} — ${count}`, correct: i === reveal.correctIndex, count });
      });
    } else if (reveal.type === 'estimate') {
      (reveal.bins ?? []).forEach((bin, i) => {
        const correct = (reveal.inBandBins ?? []).includes(i);
        items.push({ text: `${fmtBin(bin.from)} to ${fmtBin(bin.to)} — ${bin.count}`, correct, count: bin.count });
      });
    } else {
      (reveal.buckets ?? []).forEach((count, k) => {
        items.push({ text: `${k} in place — ${count}`, correct: k === (reveal.buckets?.length ?? 1) - 1 && count > 0, count });
      });
    }
    return items;
  };

  function fmtBin(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  const drawTallyPour = (reveal: Reveal, room_: HostRoom) => {
    const still = reducedMotion() || !hasWebgl();
    const items = revealItems(reveal, room_);
    const total = items.reduce((sum, item) => sum + item.count, 0);
    const maxCount = Math.max(...items.map((item) => item.count), 1);

    if (reveal.type === 'estimate') {
      const meta = el('div', { class: 'meta' });
      meta.textContent = `Answer: ${reveal.answer} ${room_.question?.unit ?? ''} ± ${reveal.tolerance}`;
      questionBand.append(meta);
    }

    const floorEl = el('div', { class: 'pour-floor' });
    const splitList = el('ul', { class: 'still-bars', 'aria-label': 'Answer split' });

    const justSeen = revealJustSeen.get(reveal.questionIndex);
    const animate = !still && justSeen !== undefined && Date.now() - justSeen < 1500;

    items.forEach((item, index) => {
      const pillar = el('div', { class: 'pillar' });
      const column = el('div', { class: 'column' });
      const count = el('div', { class: 'count' }, '0');
      const label = el('div', { class: 'label' }, item.text.split(' — ')[0]);
      pillar.append(count, column, label);
      floorEl.append(pillar);

      const targetHeight = `${(item.count / maxCount) * 88}%`;
      const startMs = index * 90;
      if (animate) {
        column.style.height = '0%';
        setTimeout(() => {
          column.style.height = targetHeight;
        }, startMs);
        const duration = 600;
        const startedAt = Date.now() + startMs;
        const tick = () => {
          const progress = Math.min(1, Math.max(0, (Date.now() - startedAt) / duration));
          const eased = 1 - Math.pow(1 - progress, 3);
          count.textContent = String(Math.min(item.count, Math.round(item.count * eased)));
          if (progress < 1) requestAnimationFrame(tick);
          else count.textContent = String(item.count);
        };
        requestAnimationFrame(tick);
        setTimeout(() => {
          pillar.classList.add(item.correct ? 'correct' : 'dimmed');
          if (item.correct) label.textContent = `${item.text} ✓ Correct answer`;
        }, 600 + items.length * 90);
      } else {
        column.style.height = item.count === 0 ? '2%' : targetHeight;
        count.textContent = String(item.count);
        pillar.classList.add(item.correct ? 'correct' : 'dimmed');
        if (item.correct) label.textContent = `${item.text} ✓ Correct answer`;
      }
    });

    if (still) {
      const list = el('ul', { class: 'still-bars', 'aria-label': 'Answer split' });
      for (const item of items) {
        const li = el('li', {});
        li.setAttribute('role', 'listitem');
        if (item.correct) li.classList.add('correct');
        const share = sharePercent(item.count, total);
        const bar = el('div', { class: 'bar' });
        bar.style.width = `${Math.max(2, sharePercent(item.count, Math.max(total, 1)))}%`;
        li.append(
          bar,
          el('span', { class: 'bar-text' }, `${item.text} (${share}%)${item.correct ? ' ✓ Correct answer' : ''}`),
        );
        list.append(li);
      }
      answerArea.append(list);
      return;
    }

    splitList.remove();
    splitList.setAttribute('class', 'leaderboard');
    splitList.style.display = 'flex';
    splitList.style.flexDirection = 'row';
    splitList.style.flexWrap = 'wrap';
    splitList.style.justifyContent = 'center';
    splitList.style.gap = '0.5rem';
    splitList.style.width = 'min(1000px, 94vw)';
    splitList.style.margin = '0';
    splitList.style.padding = '0';
    for (const item of items) {
      const li = el('li', { role: 'listitem' }, `${item.text}${item.correct ? ' ✓ Correct answer' : ''}`);
      li.style.border = '1px solid rgba(127,144,134,0.3)';
      li.style.borderRadius = '999px';
      li.style.padding = '0.15rem 0.7rem';
      li.style.listStyle = 'none';
      li.style.fontSize = '0.9rem';
      if (item.correct) li.style.color = 'var(--brass)';
      splitList.append(li);
    }
    const pourWrap = el('div', {});
    pourWrap.style.display = 'flex';
    pourWrap.style.flexDirection = 'column';
    pourWrap.style.height = '100%';
    pourWrap.style.minHeight = '0';
    pourWrap.append(floorEl, splitList);
    answerArea.append(pourWrap);

    if (reveal.type === 'sequence' && reveal.correctOrder) {
      const orderList = el('ul', { class: 'sequence-list', 'aria-label': 'Correct order' });
      const labelById = new Map((room_.question?.items ?? []).map((item) => [item.id, item.label]));
      for (const id of reveal.correctOrder) {
        orderList.append(el('li', { role: 'listitem' }, labelById.get(id) ?? ''));
      }
      const wrap = el('div', {});
      wrap.append(orderList);
      wrap.style.position = 'absolute';
      wrap.style.bottom = '6.2rem';
      wrap.style.left = '50%';
      wrap.style.transform = 'translateX(-50%)';
      wrap.style.width = 'min(560px, 90vw)';
      answerArea.append(wrap);
    }
  };

  const drawLeaderboard = (room_: HostRoom) => {
    const list = el('ul', { class: 'leaderboard', 'aria-label': 'Leaderboard' });
    for (const standing of room_.standings.slice(0, 10)) {
      const li = el('li', { role: 'listitem' });
      li.append(
        el('span', { class: 'who' }, `${standing.rank}. ${standing.nickname} — ${standing.score}`),
      );
      list.append(li);
    }
    answerArea.append(list);
  };

  const drawPodium = (room_: HostRoom) => {
    const view = el('div', { class: 'podium-view' });
    const plinths = el('div', { class: 'podium-plinths' });
    const top = room_.standings.slice(0, 3);
    const order = [1, 0, 2];
    const classes = ['second', 'first', 'third'];
    order.forEach((index, position) => {
      const standing = top[index];
      const plinth = el('div', { class: `plinth ${classes[position]}` });
      if (!standing) {
        plinth.append(el('div', { class: 'block' }));
        plinths.append(plinth);
        return;
      }
      plinth.append(
        el('div', { class: 'rank-tag' }, String(standing.rank)),
        el('div', { class: 'name' }, standing.nickname),
        el('div', { class: 'pts' }, String(standing.score)),
        el('div', { class: 'block' }),
      );
      plinths.append(plinth);
    });
    const list = el('ul', { class: 'leaderboard', 'aria-label': 'Podium' });
    for (const standing of top) {
      const li = el('li', { role: 'listitem' });
      li.append(el('span', { class: 'who' }, `${standing.rank}. ${standing.nickname} — ${standing.score}`));
      list.append(li);
    }
    view.append(plinths, list);
    if (!reducedMotion() && hasWebgl()) {
      view.style.opacity = '0';
      view.style.transition = 'opacity 1.4s cubic-bezier(0.22, 1, 0.36, 1)';
      requestAnimationFrame(() => {
        view.style.opacity = '1';
      });
    }
    answerArea.append(view);
  };

  api.hostRoom(roomId).then(({ room: fresh }) => {
    room = fresh;
    seenEventId = fresh.lastEventId;
    link.start();
    draw();
  }).catch(() => {
    navigate('/host/login');
  });
}

// ---------- phone controller ----------

function renderPhone(roomId: string): void {
  void syncClock();
  const clientId = localStorage.getItem('lastbell.client');
  if (!clientId) {
    navigate('/');
    return;
  }

  const page = el('div', { class: 'phone' });
  root.append(page);

  const answerStatus = liveRegion('Answer status');
  const connectionStatus = liveRegion('Connection status');
  let view: PlayerView | null = null;
  let countdown: CountdownHandle | null = null;
  let selectedChoice: number | null = null;
  let orderItems: string[] = [];
  let estimateValue = 0;

  const standing = el('div', { class: 'standing-strip' });
  standing.setAttribute('role', 'region');
  standing.setAttribute('aria-label', 'Your standing');

  const scrollArea = el('div', { class: 'phone-scroll' });
  const inner = el('div', { class: 'phone-inner' });
  scrollArea.append(inner);
  const connectionStrip = el('div', { class: 'phone-connection' });
  connectionStrip.append(connectionStatus.region);

  page.append(standing, connectionStrip, scrollArea);

  const answerRegion = () => {
    const region = el('div', { class: 'answer-status' });
    region.setAttribute('role', 'region');
    region.append(answerStatus.region);
    return region;
  };

  const setStateCopy: Record<string, (n: number) => string> = {
    question_open: (n) => `Question ${n} is open`,
    locked: () => "Time's up",
    reveal: () => 'Answers are in',
    leaderboard: () => 'Leaderboard is on the big screen',
    podium: () => 'Podium time — watch the big screen',
    ended: () => 'The night is over. Thanks for playing.',
  };

  const draw = (announce: string | null) => {
    if (!view) return;
    const current = view;
    clear(inner);

    if (current.you) {
      standing.textContent = `Rank ${current.you.rank ?? '—'} of ${current.standings.length} · ${current.you.score} pts`;
    } else {
      standing.textContent = '';
    }

    const thumbZone = el('div', { class: 'thumb-zone' });

    if (current.state === 'ended') {
      const ended = el('div', { class: 'phone-ended' });
      ended.append(el('div', { class: 'big' }, 'The night is over'), el('div', {}, 'Thanks for playing.'));
      inner.append(ended, answerRegion());
      answerStatus.set(setStateCopy.ended(0));
      localStorage.removeItem('lastbell.rejoin');
      localStorage.removeItem('lastbell.client');
      return;
    }

    if (current.state === 'lobby') {
      const lobby = el('div', { class: 'phone-lobby' });
      lobby.append(
        el('div', { class: 'big' }, `You're in, ${current.you?.nickname ?? ''}.`),
        el('div', { class: 'hint' }, 'Watch the big screen.'),
      );
      inner.append(lobby, answerRegion());
      if (announce === null) answerStatus.set(`You're in, ${current.you?.nickname ?? ''}. Watch the big screen.`);
      return;
    }

    const echo = el('div', { class: 'question-echo' });
    echo.setAttribute('role', 'region');
    echo.setAttribute('aria-label', 'Question echo');

    const questionIndexText = current.questionIndex ? `Question ${current.questionIndex} of ${current.questionCount}` : '';
    const question = current.question;

    if (question && (current.state === 'question_open' || current.state === 'locked')) {
      const text = el('div', { class: 'echo-text' });
      text.append(el('div', { class: 'meta' }, questionIndexText));
      text.append(el('div', { class: 'prompt' }, question.prompt));
      echo.append(text);
      if (question.imageUrl) {
        const img = el('img', { src: question.imageUrl, alt: 'Question picture' });
        img.addEventListener('error', () => img.replaceWith(el('span', { class: 'hint' }, 'Picture unavailable')));
        echo.append(img);
      }
    }

    const timerEl = el('div', { class: 'phone-timer', role: 'timer' });
    timerEl.setAttribute('aria-label', 'Time left');

    if (current.state === 'question_open' || current.state === 'locked') {
      countdown?.stop();
      countdown = startCountdown(question?.deadlineAt ?? null, (left) => {
        timerEl.textContent = String(left);
        timerEl.classList.toggle('late', left <= 5 && left > 0);
      });
    }

    inner.append(echo, timerEl);

    if (current.state === 'question_open' && question) {
      drawPhoneControls(question, current, thumbZone);
    } else if (current.state === 'locked') {
      const locked = el('div', { class: 'reveal-note' });
      locked.append(el('div', {}, "Time's up"));
      thumbZone.append(locked);
    } else if (current.state === 'reveal' && current.reveal) {
      const mine = current.reveal.results.find((entry) => entry.seatId === current.you?.seatId);
      const note = el('div', { class: 'reveal-note' });
      const points = mine?.points ?? 0;
      const outcome = mine?.outcome ?? 'none';
      const line = outcome === 'correct' ? 'Correct' : outcome === 'partial' ? 'Nearly there' : outcome === 'wrong' ? 'Not this time' : 'No answer';
      note.append(
        el('div', { class: `points ${outcome}` }, `${points} pts`),
        el('div', {}, line),
      );
      thumbZone.append(note);
    } else if (current.state === 'leaderboard' || current.state === 'podium') {
      const list = el('ul', { class: 'leaderboard', 'aria-label': current.state === 'podium' ? 'Podium' : 'Leaderboard' });
      const slice = current.state === 'podium' ? current.standings.slice(0, 3) : current.standings.slice(0, 10);
      for (const entry of slice) {
        const li = el('li', { role: 'listitem' });
        li.append(el('span', { class: 'who' }, `${entry.rank}. ${entry.nickname} — ${entry.score}`));
        list.append(li);
      }
      const mine = current.standings.find((entry) => entry.seatId === current.you?.seatId);
      const note = el('div', { class: 'reveal-note' });
      note.append(el('div', {}, `You are ${mine ? `rank ${mine.rank}` : 'unranked'} with ${current.you?.score ?? 0} pts`));
      thumbZone.append(list, note);
    }

    inner.append(thumbZone, answerRegion());

    if (announce !== null) {
      answerStatus.set(announce);
    }
  };

  let refusalAt = 0;

  const sendAnswer = (body: Record<string, unknown>) => {
    answerStatus.set('Sending…');
    api.answer(roomId, { clientId, ...body }).then(() => {
      answerStatus.set('Locked in');
      refresh();
    }).catch((err) => {
      if (err instanceof ApiError) {
        if (err.body.error === 'window_closed') {
          const remaining = Number((err.body as { remainingMs?: number }).remainingMs ?? 0);
          if (remaining < 0) {
            answerStatus.set(`Too late — the server got it ${Math.abs(remaining)} ms after the bell.`);
          } else {
            answerStatus.set('Too late — the quizmaster locked this question.');
          }
          refusalAt = Date.now();
          refresh();
        } else if (err.body.error === 'already_answered') {
          answerStatus.set('Already answered — your first answer stands.');
          refusalAt = Date.now();
          refresh();
        } else if (err.body.error === 'client_superseded') {
          answerStatus.set('This seat is now open on another screen.');
        } else if (err.body.error === 'room_ended') {
          answerStatus.set('The night is over. Thanks for playing.');
        } else if (err.body.error === 'question_not_open') {
          answerStatus.set("Time's up");
          refusalAt = Date.now();
          refresh();
        } else {
          answerStatus.set('That did not work.');
        }
      } else {
        answerStatus.set('That did not work.');
      }
    });
  };

  const drawPhoneControls = (question: PlayerQuestion, current: PlayerView, thumbZone: HTMLElement) => {
    if (question.type === 'multiple_choice') {
      const tiles = el('div', { class: 'choice-tiles' });
      (question.options ?? []).forEach((option, index) => {
        const button = el('button', {}, '');
        button.setAttribute('aria-label', `${optionLetter(index)}: ${option}`);
        const letter = el('span', { class: 'letter' }, optionLetter(index));
        const tally = el('span', { class: 'tally' }, tallyMark(index + 1));
        const text = el('span', {}, option);
        button.append(letter, tally, text);
        if (current.you?.answeredCurrent || selectedChoice !== null) {
          button.disabled = true;
          if (selectedChoice === index) button.classList.add('chosen');
          else button.classList.add('dimmed');
        }
        button.addEventListener('click', () => {
          selectedChoice = index;
          void syncClock();
          sendAnswer({ clientId, questionIndex: question.index, choice: index });
          draw(null);
        });
        tiles.append(button);
      });
      thumbZone.append(tiles);
    } else if (question.type === 'estimate') {
      const min = question.min ?? 0;
      const max = question.max ?? 100;
      const step = question.step ?? 1;
      const slider = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
      slider.setAttribute('aria-label', 'Your estimate');
      if (estimateValue === 0) estimateValue = min;
      slider.value = String(estimateValue);
      const valueLine = el('div', { class: 'estimate-value' });
      const updateValue = () => {
        estimateValue = Number(slider.value);
        valueLine.textContent = '';
        valueLine.append(el('span', {}, String(estimateValue)));
        if (question.unit) valueLine.append(el('span', { class: 'unit' }, ` ${question.unit}`));
      };
      updateValue();
      slider.addEventListener('input', updateValue);
      slider.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'PageUp') {
          event.preventDefault();
          slider.value = String(Math.min(max, estimateValue + step * 10));
          updateValue();
        } else if (event.key === 'PageDown') {
          event.preventDefault();
          slider.value = String(Math.max(min, estimateValue - step * 10));
          updateValue();
        } else if (event.key === 'Home') {
          slider.value = String(min);
          updateValue();
        } else if (event.key === 'End') {
          slider.value = String(max);
          updateValue();
        }
      });
      const lock = el('button', { class: 'lock-button', onclick: () => sendAnswer({ clientId, questionIndex: question.index, estimate: estimateValue }) }, 'Lock in estimate');
      lock.setAttribute('aria-label', 'Lock in estimate');
      const control = el('div', { class: 'estimate-control' });
      control.append(slider, valueLine, lock);
      thumbZone.append(control);
      if (current.you?.answeredCurrent) {
        slider.disabled = true;
        lock.disabled = true;
      }
    } else {
      if (orderItems.length === 0) {
        orderItems = (question.items ?? []).map((item) => item.id);
      }
      const list = el('ul', { class: 'order-list' });
      list.setAttribute('aria-label', 'Your order');
      const renderList = () => {
        clear(list);
        orderItems.forEach((id, index) => {
          const label = (question.items ?? []).find((item) => item.id === id)?.label ?? '';
          const li = el('li', {});
          const pos = el('span', { class: 'pos' }, String(index + 1));
          const text = el('span', { class: 'item-label' }, label);
          const up = el('button', {}, '↑');
          up.setAttribute('aria-label', `Move ${label} up`);
          up.disabled = index === 0 || (current.you?.answeredCurrent ?? false);
          const down = el('button', {}, '↓');
          down.setAttribute('aria-label', `Move ${label} down`);
          down.disabled = index === orderItems.length - 1 || (current.you?.answeredCurrent ?? false);
          const move = (delta: number) => {
            const target = index + delta;
            const swap = orderItems[index];
            orderItems[index] = orderItems[target];
            orderItems[target] = swap;
            renderList();
            const focusLabel = label;
            const buttons = [...list.querySelectorAll('button')];
            const targetButton = buttons.filter((button) => button.getAttribute('aria-label')?.startsWith(`Move ${focusLabel}`) && !(button as HTMLButtonElement).disabled);
            (targetButton[0] as HTMLButtonElement | undefined)?.focus();
          };
          up.addEventListener('click', () => move(-1));
          down.addEventListener('click', () => move(1));
          li.append(pos, text, up, down);
          list.append(li);
        });
      };
      renderList();
      const lock = el('button', { class: 'lock-button', onclick: () => sendAnswer({ clientId, questionIndex: question.index, order: [...orderItems] }) }, 'Lock in order');
      lock.setAttribute('aria-label', 'Lock in order');
      lock.disabled = current.you?.answeredCurrent ?? false;
      thumbZone.append(list, lock);
    }
  };

  const link = new LiveLink(roomId, `clientId=${encodeURIComponent(clientId)}`, {
    onEvent: (event) => {
      if (event.type === 'superseded') {
        answerStatus.set('This seat is now open on another screen.');
        return;
      }
      refresh();
    },
    onTransport: (transport) => {
      if (transport === 'backup') connectionStatus.set('Backup link: live updates are down. Answers still count.');
      else connectionStatus.set('Back on the live link');
    },
  });

  let lastState: string | null = null;
  const refresh = (announce: string | null = null) => {
    api.playerState(roomId, clientId).then((fresh) => {
      const stateChanged = fresh.state !== lastState;
      const previousState = lastState;
      lastState = fresh.state;
      view = fresh;
      if (stateChanged && previousState !== null && announce === null && Date.now() - refusalAt > 2500) {
        const copy = setStateCopy[fresh.state];
        if (copy) {
          draw(copy(fresh.questionIndex ?? 0));
          return;
        }
      }
      draw(announce);
    }).catch((err) => {
      if (err instanceof ApiError) {
        if (err.body.error === 'invalid_client') {
          navigate('/');
        } else if (err.body.error === 'room_ended') {
          answerStatus.set('The night is over. Thanks for playing.');
          drawEnded();
        } else if (err.body.error === 'client_superseded') {
          answerStatus.set('This seat is now open on another screen.');
          link.stop();
        }
      }
    });
  };

  const drawEnded = () => {
    clear(inner);
    const ended = el('div', { class: 'phone-ended' });
    ended.append(el('div', { class: 'big' }, 'The night is over'), el('div', {}, 'Thanks for playing.'));
    inner.append(ended, answerRegion());
    answerStatus.set('The night is over. Thanks for playing.');
    localStorage.removeItem('lastbell.rejoin');
    localStorage.removeItem('lastbell.client');
  };

  api.playerState(roomId, clientId).then((fresh) => {
    view = fresh;
    link.start();
    draw(null);
  }).catch(() => {
    navigate('/');
  });
}

render();
