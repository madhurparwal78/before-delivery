import { CARET, SNIPPETS } from '../domain/components';
import { messages, roleLabel } from '../domain/messages';
import {
  $,
  $$,
  announce,
  api,
  connectEvents,
  openDialog,
  pageData,
  setupTheme,
  wait,
  type Dialog,
} from './dom';
import { createDrawer } from './drawer';
import { playSplice } from './splice';
import { setupTree, type Tree } from './tree';

const AUTOSAVE_PAUSE = 800;
const NOTICE_TIMER = 4000;

interface EditorData {
  screen?: 'signin' | 'home' | 'redirects' | 'analytics' | 'team' | 'invite';
  next?: string | null;
  token?: string;
  siteId?: string;
  versionId?: string;
  canWrite?: boolean;
  user?: { id: string; name: string; role: 'owner' | 'editor' | 'viewer' };
  site?: { id: string; slug: string; title: string };
  version?: { id: string; slug: string; title: string };
  pageId?: string | null;
  revision?: number;
}

const data = pageData<EditorData>();

/* ---------------- shared pieces ---------------- */

function fieldError(id: string, message: string | null): void {
  const error = document.getElementById(id);
  const field = document.getElementById(id.replace(/-error$/, ''));
  if (error === null || field === null) return;
  if (message === null) {
    error.hidden = true;
    error.textContent = '';
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
    return;
  }
  error.textContent = message;
  error.hidden = false;
  field.setAttribute('aria-invalid', 'true');
  field.setAttribute('aria-describedby', error.id);
  announce(message);
  field.focus();
}

function setupSignOut(): void {
  $<HTMLButtonElement>('#sign-out-button')?.addEventListener('click', () => {
    void api('DELETE', '/api/session').then(() => window.location.assign('/signin'));
  });
}

/* ---------------- sign in and invite ---------------- */

function setupSignIn(): void {
  const button = $<HTMLButtonElement>('#sign-in-button');
  const email = $<HTMLInputElement>('#email');
  const password = $<HTMLInputElement>('#password');
  const error = $<HTMLElement>('#sign-in-error');
  if (button === null || email === null || password === null || error === null) return;
  const submit = (): void => {
    void api<{ redirectTo: string }>('POST', '/api/session', {
      email: email.value,
      password: password.value,
      next: data.next ?? null,
    }).then((response) => {
      if (!response.ok) {
        error.textContent = messages.signInFailed;
        error.hidden = false;
        announce(messages.signInFailed);
        return;
      }
      window.location.assign(response.data.redirectTo);
    });
  };
  button.addEventListener('click', submit);
  for (const field of [email, password]) {
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
  }
}

function setupInvite(): void {
  const button = $<HTMLButtonElement>('#join-team');
  const name = $<HTMLInputElement>('#invite-name');
  const password = $<HTMLInputElement>('#invite-password');
  const error = $<HTMLElement>('#invite-error');
  if (button === null || name === null || password === null || error === null) return;
  button.addEventListener('click', () => {
    void api('POST', `/api/invites/${data.token ?? ''}/accept`, {
      name: name.value,
      password: password.value,
    }).then((response) => {
      if (!response.ok) {
        const text =
          response.error.fields?.password ?? response.error.fields?.name ?? response.error.message;
        error.textContent = text;
        error.hidden = false;
        announce(text);
        return;
      }
      window.location.assign('/app');
    });
  });
}

/* ---------------- redirects screen ---------------- */

interface NavigationDocument {
  versionId: string;
  tabs: { id: string; title: string; groups: { id: string; title: string; pages: string[] }[] }[];
  redirects: { from: string; to: string; kind: string }[];
}

function renderRedirectRows(navigation: NavigationDocument): void {
  const body = document.getElementById('redirect-rows');
  if (body === null) return;
  body.textContent = '';
  for (const redirect of navigation.redirects) {
    const row = document.createElement('tr');
    for (const value of [redirect.from, redirect.to, redirect.kind]) {
      const cell = document.createElement('td');
      cell.className = 'mono';
      cell.textContent = value;
      row.appendChild(cell);
    }
    const actions = document.createElement('td');
    if (data.canWrite === true) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove redirect from ${redirect.from}`);
      remove.addEventListener('click', () => {
        void api<NavigationDocument>(
          'DELETE',
          `/api/versions/${data.versionId ?? ''}/redirects?from=${encodeURIComponent(redirect.from)}`,
        ).then((response) => {
          if (!response.ok) return;
          renderRedirectRows(response.data);
          announce(messages.redirectRemoved(redirect.from));
        });
      });
      actions.appendChild(remove);
    }
    row.appendChild(actions);
    body.appendChild(row);
  }
}

function setupRedirectsScreen(): void {
  const versionId = data.versionId ?? '';
  void api<NavigationDocument>('GET', `/api/versions/${versionId}/navigation`).then((response) => {
    if (response.ok) renderRedirectRows(response.data);
  });
  const add = $<HTMLButtonElement>('#add-redirect');
  const from = $<HTMLInputElement>('#redirect-from');
  const to = $<HTMLInputElement>('#redirect-to');
  if (add === null || from === null || to === null) return;
  add.addEventListener('click', () => {
    fieldError('redirect-from-error', null);
    fieldError('redirect-to-error', null);
    void api<NavigationDocument>('POST', `/api/versions/${versionId}/redirects`, {
      from: from.value,
      to: to.value,
    }).then((response) => {
      if (response.ok) {
        renderRedirectRows(response.data);
        announce(messages.redirectAdded(from.value, to.value));
        from.value = '';
        to.value = '';
        return;
      }
      const error = response.error;
      if (error.code === 'validation_failed') {
        if (error.fields?.from !== undefined) fieldError('redirect-from-error', error.fields.from);
        if (error.fields?.to !== undefined) fieldError('redirect-to-error', error.fields.to);
        return;
      }
      const field = error.code === 'redirect_exists' ? 'redirect-from-error' : 'redirect-to-error';
      fieldError(field, error.message);
    });
  });
}

/* ---------------- analytics screen ---------------- */

interface AnalyticsDocument {
  pageRatings: { pageId: string; title: string; versionSlug: string; yes: number; no: number; helpful: string }[];
  searchTerms: { term: string; searches: number; results: number }[];
}

function renderAnalytics(document_: AnalyticsDocument): void {
  const ratings = document.getElementById('rating-rows');
  const terms = document.getElementById('term-rows');
  if (ratings !== null) {
    ratings.textContent = '';
    for (const rating of document_.pageRatings) {
      const row = document.createElement('tr');
      const cells = [rating.title, String(rating.yes), String(rating.no), rating.helpful];
      cells.forEach((value, index) => {
        const cell = document.createElement('td');
        if (index > 0) cell.className = 'mono';
        cell.textContent = value;
        row.appendChild(cell);
      });
      ratings.appendChild(row);
    }
  }
  if (terms !== null) {
    terms.textContent = '';
    for (const term of document_.searchTerms) {
      const row = document.createElement('tr');
      const cells = [term.term, String(term.searches), String(term.results)];
      cells.forEach((value, index) => {
        const cell = document.createElement('td');
        cell.className = 'mono';
        if (index === 0) cell.className = '';
        cell.textContent = value;
        row.appendChild(cell);
      });
      terms.appendChild(row);
    }
  }
}

function setupAnalyticsScreen(): void {
  const siteId = data.siteId ?? '';
  const load = (): void => {
    void api<AnalyticsDocument>('GET', `/api/sites/${siteId}/analytics`).then((response) => {
      if (response.ok) renderAnalytics(response.data);
    });
  };
  load();
  connectEvents('/api/events', { analytics: () => load() });
}

/* ---------------- team screen ---------------- */

interface TeamDocument {
  id: string;
  name: string;
  members: { userId: string; name: string; email: string; role: 'owner' | 'editor' | 'viewer' }[];
  invites: { id: string; email: string; role: string; status: string }[];
}

function renderTeam(team: TeamDocument): void {
  const members = document.getElementById('member-rows');
  if (members !== null) {
    members.textContent = '';
    for (const member of team.members) {
      const row = document.createElement('tr');
      for (const value of [member.name, member.email]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      }
      const roleCell = document.createElement('td');
      if (member.role === 'owner') {
        roleCell.textContent = roleLabel('owner');
      } else {
        const select = document.createElement('select');
        select.setAttribute('aria-label', `Role for ${member.name}`);
        for (const value of ['editor', 'viewer'] as const) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = roleLabel(value);
          option.selected = member.role === value;
          select.appendChild(option);
        }
        select.addEventListener('change', () => {
          void api('PUT', `/api/team/members/${member.userId}`, { role: select.value }).then(
            (response) => {
              if (response.ok) announce(`${member.name}: ${roleLabel(select.value as 'editor')}`);
            },
          );
        });
        roleCell.appendChild(select);
      }
      row.appendChild(roleCell);
      members.appendChild(row);
    }
  }
  const invites = document.getElementById('invite-rows');
  if (invites === null) return;
  invites.textContent = '';
  for (const invite of team.invites) {
    const row = document.createElement('tr');
    const status =
      invite.status === 'sent'
        ? messages.inviteStatus.sent
        : invite.status === 'held'
          ? messages.inviteStatus.held
          : invite.status === 'accepted'
            ? messages.inviteStatus.accepted
            : messages.inviteStatus.expired;
    for (const value of [invite.email, roleLabel(invite.role as 'editor'), status]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    }
    const actions = document.createElement('td');
    if (invite.status === 'held') {
      const send = document.createElement('button');
      send.type = 'button';
      send.textContent = 'Send now';
      send.addEventListener('click', () => {
        void api('POST', `/api/team/invites/${invite.id}/send`).then((response) => {
          if (response.ok) announce(messages.inviteSent(invite.email));
          else announce(response.error.message);
          loadTeam();
        });
      });
      actions.appendChild(send);
    }
    row.appendChild(actions);
    invites.appendChild(row);
  }
}

function loadTeam(): void {
  void api<TeamDocument>('GET', '/api/team').then((response) => {
    if (response.ok) renderTeam(response.data);
  });
}

function setupTeamScreen(): void {
  loadTeam();
  const send = $<HTMLButtonElement>('#send-invite');
  const email = $<HTMLInputElement>('#invite-email');
  const role = $<HTMLSelectElement>('#invite-role');
  if (send !== null && email !== null && role !== null) {
    send.addEventListener('click', () => {
      fieldError('invite-email-error', null);
      send.setAttribute('aria-busy', 'true');
      void api('POST', '/api/team/invites', { email: email.value, role: role.value }).then(
        (response) => {
          send.removeAttribute('aria-busy');
          if (response.status === 201) {
            announce(messages.inviteSent(email.value.trim().toLowerCase()));
            email.value = '';
          } else if (response.status === 202) {
            announce(messages.inviteHeld);
            email.value = '';
          } else if (!response.ok) {
            fieldError('invite-email-error', response.error.fields?.email ?? response.error.message);
          }
          loadTeam();
        },
      );
    });
  }
  connectEvents('/api/events', {
    invite: () => loadTeam(),
    role: () => loadTeam(),
  });
}

/* ---------------- editor page ---------------- */

interface PageDocument {
  id: string;
  versionId: string;
  path: string;
  title: string;
  kind: string;
  source: string;
  revision: number;
  updatedBy: { id: string; name: string } | null;
}

interface GateError {
  file: string;
  line: number;
  code: string;
  message: string;
}

interface PublishReport {
  status: string;
  errors: GateError[];
}

const CHECK_PANEL_KEY = 'galley.publishCheck';

class EditorPage {
  private readonly textarea = $<HTMLTextAreaElement>('#editor');
  private readonly titleField = $<HTMLInputElement>('#page-title-field');
  private readonly status = $<HTMLElement>('#save-status');
  private readonly gutter = $<HTMLElement>('#gutter');
  private readonly main = $<HTMLElement>('.page-editor');
  private revision = data.revision ?? 0;
  private saveTimer = 0;
  private dirty = false;
  private stopped = false;
  private slashOpen = false;
  private slashActive = 0;

  constructor() {
    if (this.textarea === null || this.main === null) return;
    this.renderGutter();
    if (data.canWrite === true && this.main.dataset.kind === 'page') {
      this.textarea.addEventListener('input', () => {
        this.dirty = true;
        this.renderGutter();
        this.updateSlashMenu();
        this.scheduleSave();
      });
      this.textarea.addEventListener('keydown', (event) => this.onSourceKeyDown(event));
      this.titleField?.addEventListener('input', () => {
        this.dirty = true;
        this.scheduleSave();
      });
      this.setupImage();
    }
  }

  get pageId(): string {
    return this.main?.dataset.pageId ?? '';
  }

  private renderGutter(): void {
    if (this.gutter === null || this.textarea === null) return;
    const lines = this.textarea.value.split('\n').length;
    const existing = $$<HTMLElement>('span', this.gutter);
    if (existing.length === lines) return;
    this.gutter.textContent = '';
    for (let line = 1; line <= lines; line += 1) {
      const span = document.createElement('span');
      span.dataset.line = String(line);
      span.textContent = String(line);
      this.gutter.appendChild(span);
    }
  }

  markErrorLine(line: number): void {
    if (this.gutter === null) return;
    for (const span of $$<HTMLElement>('span', this.gutter)) span.removeAttribute('data-error');
    const target = $<HTMLElement>(`span[data-line="${line}"]`, this.gutter);
    target?.setAttribute('data-error', 'true');
  }

  caretToLine(line: number): void {
    if (this.textarea === null) return;
    const lines = this.textarea.value.split('\n');
    let offset = 0;
    for (let index = 0; index < Math.min(line - 1, lines.length); index += 1) {
      offset += lines[index].length + 1;
    }
    this.textarea.focus();
    this.textarea.setSelectionRange(offset, offset);
    this.markErrorLine(line);
  }

  private scheduleSave(): void {
    if (this.stopped) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = wait(AUTOSAVE_PAUSE, () => void this.save());
  }

  async save(): Promise<void> {
    if (this.textarea === null || this.titleField === null || this.stopped) return;
    if (this.status !== null) this.status.textContent = messages.savingStatus;
    const response = await api<PageDocument>('PUT', `/api/pages/${this.pageId}`, {
      title: this.titleField.value,
      source: this.textarea.value,
      revision: this.revision,
    });
    if (response.ok) {
      this.revision = response.data.revision;
      this.dirty = false;
      if (this.status !== null) this.status.textContent = messages.saved;
      announce(messages.saved);
      publishCheck.rerun();
      return;
    }
    if (response.error.code === 'revision_conflict') {
      this.stopped = true;
      const name = response.error.savedBy?.name ?? '';
      const text = messages.conflict(name);
      const notice = document.getElementById('conflict-notice');
      if (notice !== null) {
        notice.textContent = text;
        notice.className = 'proof-note';
      }
      if (this.status !== null) this.status.textContent = '';
      announce(text);
      return;
    }
    if (this.status !== null) this.status.textContent = messages.saveFailed;
    announce(messages.saveFailed);
  }

  /**
   * A rename elsewhere rewrites this page's links, so the open editor takes the new
   * source and revision when nothing is typed. Another editor's save is not adopted:
   * the next save then meets the revision conflict.
   */
  adoptRewrite(): void {
    if (this.textarea === null || this.dirty || this.stopped) return;
    void api<PageDocument>('GET', `/api/pages/${this.pageId}`).then((response) => {
      if (!response.ok || this.dirty || this.textarea === null) return;
      if (response.data.source === this.textarea.value) {
        this.revision = response.data.revision;
        return;
      }
      this.textarea.value = response.data.source;
      this.revision = response.data.revision;
      this.renderGutter();
    });
  }

  private slashContext(): { start: number; filter: string } | null {
    if (this.textarea === null) return null;
    const caret = this.textarea.selectionStart;
    const value = this.textarea.value;
    const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
    const typed = value.slice(lineStart, caret);
    const after = value.slice(caret, caret + 1);
    if (!/^\/[A-Za-z ]*$/.test(typed)) return null;
    if (after !== '' && after !== '\n') return null;
    return { start: lineStart, filter: typed.slice(1) };
  }

  private slashOptions(): HTMLElement[] {
    const menu = document.getElementById('slash-menu');
    return menu === null ? [] : $$<HTMLElement>('[role="option"]:not([hidden])', menu);
  }

  private updateSlashMenu(): void {
    const menu = document.getElementById('slash-menu');
    if (menu === null || this.textarea === null) return;
    const context = this.slashContext();
    if (context === null) {
      this.closeSlashMenu();
      return;
    }
    this.slashOpen = true;
    menu.hidden = false;
    const filter = context.filter.trim().toLowerCase();
    let visible = 0;
    for (const option of $$<HTMLElement>('[role="option"]', menu)) {
      const label = SNIPPETS[Number(option.dataset.index)].label.toLowerCase();
      const matches = filter === '' || label.includes(filter);
      option.hidden = !matches;
      if (matches) visible += 1;
    }
    const empty = $<HTMLElement>('.slash-empty', menu);
    if (visible === 0) {
      if (empty === null) {
        const item = document.createElement('li');
        item.className = 'slash-empty';
        item.textContent = messages.noComponentsMatch;
        menu.appendChild(item);
      }
    } else {
      empty?.remove();
    }
    this.slashActive = 0;
    this.paintSlashActive();
  }

  private paintSlashActive(): void {
    const options = this.slashOptions();
    options.forEach((option, index) => {
      option.setAttribute('aria-selected', index === this.slashActive ? 'true' : 'false');
    });
    const active = options[this.slashActive];
    if (active === undefined) this.textarea?.removeAttribute('aria-activedescendant');
    else this.textarea?.setAttribute('aria-activedescendant', active.id);
  }

  private closeSlashMenu(): void {
    const menu = document.getElementById('slash-menu');
    if (menu !== null) menu.hidden = true;
    this.slashOpen = false;
    this.textarea?.removeAttribute('aria-activedescendant');
  }

  private insertSnippet(index: number): void {
    if (this.textarea === null) return;
    const context = this.slashContext();
    if (context === null) return;
    const template = SNIPPETS[index].template;
    const caretOffset = template.indexOf(CARET);
    const text = template.replace(CARET, '');
    const value = this.textarea.value;
    const caret = this.textarea.selectionStart;
    this.textarea.value = value.slice(0, context.start) + text + value.slice(caret);
    const position = context.start + (caretOffset < 0 ? text.length : caretOffset);
    this.textarea.setSelectionRange(position, position);
    this.closeSlashMenu();
    this.dirty = true;
    this.renderGutter();
    this.scheduleSave();
  }

  private onSourceKeyDown(event: KeyboardEvent): void {
    if (!this.slashOpen) return;
    const options = this.slashOptions();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (options.length === 0) return;
      const next = this.slashActive + (event.key === 'ArrowDown' ? 1 : -1);
      this.slashActive = (next + options.length) % options.length;
      this.paintSlashActive();
      return;
    }
    if (event.key === 'Enter') {
      const active = options[this.slashActive];
      if (active === undefined) return;
      event.preventDefault();
      this.insertSnippet(Number(active.dataset.index));
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeSlashMenu();
    }
  }

  private setupImage(): void {
    const button = $<HTMLButtonElement>('#image-button');
    const input = $<HTMLInputElement>('#image-input');
    if (button === null || input === null) return;
    button.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (file === undefined) return;
      void this.uploadImage(file);
    });
  }

  private async uploadImage(file: File): Promise<void> {
    const types = ['image/png', 'image/jpeg', 'image/webp'];
    if (!types.includes(file.type)) {
      this.showImageNotice(messages.imageType);
      return;
    }
    if (file.size > 5_000_000) {
      this.showImageNotice(messages.imageSize);
      return;
    }
    const response = await fetch(`/api/sites/${data.site?.id ?? ''}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: await file.arrayBuffer(),
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error: { message: string } };
      this.showImageNotice(payload.error.message);
      return;
    }
    const asset = (await response.json()) as { url: string };
    if (this.textarea === null) return;
    const alt = file.name.replace(/\.[^.]+$/, '');
    const line = `![${alt}](${asset.url})`;
    const caret = this.textarea.selectionStart;
    const value = this.textarea.value;
    this.textarea.value = `${value.slice(0, caret)}${line}${value.slice(caret)}`;
    this.textarea.setSelectionRange(caret + line.length, caret + line.length);
    this.dirty = true;
    this.renderGutter();
    this.scheduleSave();
    this.showImageNotice(messages.imageUploaded);
  }

  private showImageNotice(text: string): void {
    const toolbar = $<HTMLElement>('.editor-toolbar');
    if (toolbar !== null) {
      toolbar.querySelector('.notice')?.remove();
      const notice = document.createElement('span');
      notice.className = 'notice';
      notice.textContent = text;
      toolbar.appendChild(notice);
      wait(NOTICE_TIMER, () => notice.remove());
    }
    announce(text);
  }
}

/* ---------------- publish ---------------- */

class PublishCheck {
  private report: PublishReport | null = null;
  private dialog: Dialog | null = null;

  constructor() {
    const stored = sessionStorage.getItem(CHECK_PANEL_KEY);
    if (stored !== null) {
      this.report = JSON.parse(stored) as PublishReport;
      this.renderPanel();
    }
  }

  private pageCount(): number {
    return $$('#pages-tree [aria-level="3"]').length;
  }

  async start(button: HTMLElement | null): Promise<void> {
    announce(messages.checking(this.pageCount()));
    button?.setAttribute('aria-busy', 'true');
    const response = await api<{ pages: number; changedPages: number; errors: GateError[] }>(
      'POST',
      `/api/versions/${data.version?.id ?? ''}/check`,
    );
    button?.removeAttribute('aria-busy');
    if (!response.ok) return;
    const errors = response.data.errors;
    announce(errors.length === 0 ? messages.checkClean : messages.checkFoundProblems(errors.length));
    if (errors.length > 0) {
      this.report = { status: 'blocked', errors };
      this.openBlocked(button);
      return;
    }
    this.openConfirm(button, response.data.changedPages);
  }

  private dialogElements(): { element: HTMLElement; heading: HTMLElement; body: HTMLElement } | null {
    const element = document.getElementById('publish-dialog');
    const heading = document.getElementById('publish-heading');
    const body = document.getElementById('publish-body');
    if (element === null || heading === null || body === null) return null;
    return { element, heading, body };
  }

  openBlocked(opener: HTMLElement | null): void {
    const parts = this.dialogElements();
    if (parts === null || this.report === null) return;
    const errors = this.report.errors;
    parts.heading.textContent = messages.blockedHeading(errors.length);
    parts.body.textContent = '';
    const list = document.createElement('ul');
    list.className = 'problem-list';
    for (const error of errors) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'problem-row';
      button.textContent = messages.problemRow(error.file, error.line, error.message);
      button.addEventListener('click', () => {
        this.dialog?.close();
        this.keepPanel();
        this.goToProblem(error);
      });
      item.appendChild(button);
      list.appendChild(item);
    }
    parts.body.appendChild(list);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.dialog?.close());
    parts.body.appendChild(close);
    this.dialog = openDialog(parts.element, {
      opener,
      focus: parts.heading,
      onClose: () => {
        this.dialog = null;
      },
    });
  }

  private openConfirm(opener: HTMLElement | null, changedPages: number): void {
    const parts = this.dialogElements();
    if (parts === null) return;
    parts.heading.textContent = messages.confirmHeading(data.version?.title ?? '');
    parts.body.textContent = '';
    const text = document.createElement('p');
    text.textContent = messages.confirmText(changedPages);
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const publish = document.createElement('button');
    publish.type = 'button';
    publish.className = 'primary';
    publish.textContent = 'Publish now';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.dialog?.close());
    publish.addEventListener('click', () => void this.publish(publish, parts.body));
    actions.append(publish, cancel);
    parts.body.append(text, actions);
    this.dialog = openDialog(parts.element, {
      opener,
      focus: parts.heading,
      onClose: () => {
        this.dialog = null;
      },
    });
  }

  private async publish(button: HTMLButtonElement, body: HTMLElement): Promise<void> {
    const title = data.version?.title ?? '';
    button.setAttribute('aria-busy', 'true');
    announce(messages.publishing(title));
    const key = `publish-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const response = await api<PublishReport>(
      'POST',
      `/api/versions/${data.version?.id ?? ''}/publish`,
      undefined,
      { 'Idempotency-Key': key },
    );
    button.removeAttribute('aria-busy');
    if (response.ok) {
      this.clearPanel();
      this.dialog?.close();
      announce(messages.published(title));
      return;
    }
    if (response.error.code === 'publish_blocked') {
      const report = response.error.report as PublishReport;
      this.report = report;
      this.dialog?.close();
      this.openBlocked(null);
      return;
    }
    const notice = document.createElement('p');
    notice.className = 'form-error';
    notice.textContent = response.error.message;
    body.appendChild(notice);
    announce(response.error.message);
  }

  private goToProblem(error: GateError): void {
    const path = error.file.replace(/^pages\//, '').replace(/\.md$/, '');
    const base = `/app/sites/${data.site?.slug ?? ''}/${data.version?.slug ?? ''}/pages/${path}`;
    if (path === ($<HTMLElement>('.page-editor')?.dataset.path ?? '')) {
      editorPage?.caretToLine(error.line);
      this.renderPanel();
      return;
    }
    window.location.assign(`${base}?line=${error.line}`);
  }

  private keepPanel(): void {
    if (this.report !== null) sessionStorage.setItem(CHECK_PANEL_KEY, JSON.stringify(this.report));
    this.renderPanel();
  }

  private clearPanel(): void {
    this.report = null;
    sessionStorage.removeItem(CHECK_PANEL_KEY);
    const slot = document.getElementById('publish-check-slot');
    if (slot !== null) slot.textContent = '';
  }

  renderPanel(): void {
    const slot = document.getElementById('publish-check-slot');
    if (slot === null || this.report === null) return;
    const errors = this.report.errors;
    slot.textContent = '';
    const panel = document.createElement('aside');
    panel.setAttribute('aria-label', 'Publish check');
    panel.className = 'check-panel';
    const heading = document.createElement('h2');
    heading.textContent =
      errors.length === 0 ? messages.noProblemsLeft : messages.blockedHeading(errors.length);
    panel.appendChild(heading);
    const list = document.createElement('ul');
    list.className = 'problem-list';
    for (const error of errors) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'problem-row';
      button.textContent = messages.problemRow(error.file, error.line, error.message);
      button.addEventListener('click', () => this.goToProblem(error));
      item.appendChild(button);
      list.appendChild(item);
    }
    panel.appendChild(list);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.clearPanel());
    panel.appendChild(close);
    slot.appendChild(panel);
  }

  /** The panel re-runs the check after each autosave and announces what is left. */
  rerun(): void {
    if (this.report === null) return;
    void api<{ errors: GateError[] }>('POST', `/api/versions/${data.version?.id ?? ''}/check`).then(
      (response) => {
        if (!response.ok || this.report === null) return;
        this.report = { status: 'blocked', errors: response.data.errors };
        sessionStorage.setItem(CHECK_PANEL_KEY, JSON.stringify(this.report));
        this.renderPanel();
        announce(
          response.data.errors.length === 0
            ? messages.noProblemsLeft
            : messages.problemsLeft(response.data.errors.length),
        );
      },
    );
  }

  applyReport(report: PublishReport): void {
    if (this.report === null || report.status !== 'blocked') return;
    this.report = report;
    this.renderPanel();
  }
}

/* ---------------- dialogs on the editor page ---------------- */

function setupEditorDialogs(): void {
  const versionId = data.version?.id ?? '';
  const siteId = data.site?.id ?? '';
  const open = (id: string, opener: HTMLElement | null): Dialog | null => {
    const element = document.getElementById(id);
    return element === null ? null : openDialog(element, { opener });
  };

  const newPageButton = $<HTMLButtonElement>('#new-page-button');
  newPageButton?.addEventListener('click', () => {
    const dialog = open('new-page-dialog', newPageButton);
    const create = $<HTMLButtonElement>('#create-page');
    const cancel = $<HTMLButtonElement>('#cancel-new-page');
    const title = $<HTMLInputElement>('#new-page-title');
    const path = $<HTMLInputElement>('#new-page-path');
    const group = $<HTMLSelectElement>('#new-page-group');
    cancel?.addEventListener('click', () => dialog?.close(), { once: true });
    create?.addEventListener(
      'click',
      () => {
        fieldError('new-page-path-error', null);
        void api<PageDocument>('POST', `/api/versions/${versionId}/pages`, {
          title: title?.value ?? '',
          path: path?.value ?? '',
          groupId: group?.value ?? '',
        }).then((response) => {
          if (!response.ok) {
            fieldError('new-page-path-error', response.error.fields?.path ?? response.error.message);
            return;
          }
          window.location.assign(
            `/app/sites/${data.site?.slug ?? ''}/${data.version?.slug ?? ''}/pages/${response.data.path}`,
          );
        });
      },
      { once: true },
    );
  });

  const newGroupButton = $<HTMLButtonElement>('#new-group-button');
  newGroupButton?.addEventListener('click', () => {
    const dialog = open('new-group-dialog', newGroupButton);
    $<HTMLButtonElement>('#cancel-new-group')?.addEventListener('click', () => dialog?.close(), {
      once: true,
    });
    $<HTMLButtonElement>('#create-group')?.addEventListener(
      'click',
      () => {
        void api('POST', `/api/versions/${versionId}/groups`, {
          title: $<HTMLInputElement>('#new-group-title')?.value ?? '',
          tabId: $<HTMLSelectElement>('#new-group-tab')?.value ?? '',
        }).then(() => {
          dialog?.close();
          window.location.reload();
        });
      },
      { once: true },
    );
  });

  const newVersionButton = $<HTMLButtonElement>('#new-version-button');
  newVersionButton?.addEventListener('click', () => {
    const dialog = open('new-version-dialog', newVersionButton);
    $<HTMLButtonElement>('#cancel-new-version')?.addEventListener('click', () => dialog?.close(), {
      once: true,
    });
    $<HTMLButtonElement>('#create-version')?.addEventListener(
      'click',
      () => {
        fieldError('new-version-slug-error', null);
        const slug = $<HTMLInputElement>('#new-version-slug')?.value ?? '';
        const title = $<HTMLInputElement>('#new-version-title')?.value ?? '';
        void api<{ slug: string; title: string }>('POST', `/api/sites/${siteId}/versions`, {
          fromVersionId: $<HTMLSelectElement>('#new-version-from')?.value ?? '',
          slug,
          title,
        }).then((response) => {
          if (!response.ok) {
            fieldError(
              'new-version-slug-error',
              response.error.fields?.slug ?? response.error.message,
            );
            return;
          }
          announce(messages.versionCreated(title));
          window.location.assign(`/app/sites/${data.site?.slug ?? ''}/${response.data.slug}/pages`);
        });
      },
      { once: true },
    );
  });

  const shareButton = $<HTMLButtonElement>('#share-preview-button');
  shareButton?.addEventListener('click', () => {
    void api<{ id: string; url: string }>(
      'POST',
      `/api/pages/${data.pageId ?? ''}/preview-links`,
    ).then((response) => {
      if (!response.ok) return;
      const dialog = open('share-preview-dialog', shareButton);
      const field = $<HTMLInputElement>('#preview-link');
      const link = `${window.location.origin}${response.data.url}`;
      if (field !== null) {
        field.value = link;
        field.focus();
        field.select();
      }
      announce(messages.previewLinkCreated);
      $<HTMLButtonElement>('#copy-link')?.addEventListener(
        'click',
        () => void navigator.clipboard?.writeText(link),
        { once: true },
      );
      $<HTMLButtonElement>('#close-share')?.addEventListener('click', () => dialog?.close(), {
        once: true,
      });
      $<HTMLButtonElement>('#revoke-link')?.addEventListener(
        'click',
        () => {
          void api('DELETE', `/api/preview-links/${response.data.id}`).then(() => {
            announce(messages.previewLinkRevoked);
          });
        },
        { once: true },
      );
    });
  });

  const importButton = $<HTMLButtonElement>('#import-button');
  const importInput = $<HTMLInputElement>('#import-input');
  importButton?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (file === undefined) return;
    void file.arrayBuffer().then(async (bytes) => {
      const response = await fetch(
        `/api/versions/${versionId}/openapi?name=${encodeURIComponent(file.name)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bytes },
      );
      const payload = (await response.json()) as {
        pages?: unknown[];
        error?: { message: string };
      };
      if (!response.ok) {
        announce(payload.error?.message ?? '');
        return;
      }
      announce(messages.imported((payload.pages ?? []).length));
      window.location.reload();
    });
  });
}

/* ---------------- wiring ---------------- */

let editorPage: EditorPage | null = null;
const publishCheck = new PublishCheck();

function setupPagesDrawer(): void {
  const button = $<HTMLButtonElement>('#pages-button');
  const panel = document.getElementById('pages-panel');
  if (button === null || panel === null) return;
  createDrawer({ panel, button, label: 'Pages' });
}

function setupPublish(): void {
  const button = $<HTMLButtonElement>('#publish-button');
  button?.addEventListener('click', () => void publishCheck.start(button));
  document.addEventListener('keydown', (event) => {
    if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== 'p') return;
    if (document.getElementById('publish-button') === null) return;
    event.preventDefault();
    void publishCheck.start(button);
  });
}

function setupEditorEvents(): void {
  const versionId = data.version?.id ?? '';
  const pageId = data.pageId ?? '';
  connectEvents(`/api/events?versionId=${versionId}&pageId=${pageId}`, {
    navigation: (payload) => {
      tree?.applyNavigation(payload as NavigationDocument);
      editorPage?.adoptRewrite();
    },
    presence: (payload) => renderPresence(payload as { editors: { id: string; name: string }[] }),
    report: (payload) => publishCheck.applyReport(payload as PublishReport),
    role: (payload) => {
      const change = payload as { userId: string; role: 'owner' | 'editor' | 'viewer' };
      if (change.userId !== data.user?.id) return;
      announce(messages.roleChanged(roleLabel(change.role)));
      void refreshShell();
    },
  });
}

function renderPresence(payload: { editors: { id: string; name: string }[] }): void {
  const holder = document.getElementById('presence-notices');
  if (holder === null) return;
  holder.textContent = '';
  for (const editor of payload.editors) {
    if (editor.id === data.user?.id) continue;
    const notice = document.createElement('p');
    notice.className = 'proof-note';
    notice.textContent = messages.presence(editor.name);
    holder.appendChild(notice);
  }
}

function renderChips(navigation: NavigationDocument): void {
  const list = document.getElementById('redirect-list');
  if (list === null) return;
  list.textContent = '';
  for (const redirect of navigation.redirects) {
    const chip = document.createElement('li');
    chip.className = 'chip';
    chip.dataset.from = redirect.from;
    chip.textContent = `${redirect.from} \u2192 ${redirect.to}`;
    list.appendChild(chip);
  }
}

async function refreshShell(): Promise<void> {
  const response = await fetch(window.location.href, { headers: { Accept: 'text/html' } });
  const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
  for (const selector of ['.top-bar', '.editor-layout']) {
    const fresh = parsed.querySelector(selector);
    const current = document.querySelector(selector);
    if (fresh !== null && current !== null) current.replaceWith(fresh);
  }
  startEditorPage();
}

let tree: Tree | null = null;

function startEditorPage(): void {
  editorPage = new EditorPage();
  tree = setupTree({ onRenamed: playSplice, onNavigation: renderChips });
  setupPagesDrawer();
  setupPublish();
  setupEditorDialogs();
  setupTheme();
  setupSignOut();
  publishCheck.renderPanel();
  const line = new URL(window.location.href).searchParams.get('line');
  if (line !== null) editorPage.caretToLine(Number(line));
}

function start(): void {
  setupTheme();
  setupSignOut();
  switch (data.screen) {
    case 'signin':
      setupSignIn();
      return;
    case 'invite':
      setupInvite();
      return;
    case 'redirects':
      setupRedirectsScreen();
      return;
    case 'analytics':
      setupAnalyticsScreen();
      return;
    case 'team':
      setupTeamScreen();
      return;
    case 'home':
      return;
    default:
      break;
  }
  if (data.version === undefined) return;
  startEditorPage();
  setupEditorEvents();
}

start();
