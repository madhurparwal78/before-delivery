import { longDateString } from '../shared/dates';
import { ReturnRecord, STATUS_LABELS, ReturnStatus } from '../shared/types';
import { Line, orderLines, PRIORITY } from './announce';
import { api, ApiError } from './api';
import { centralDate, centralMonth, centralYear, weekRange } from './clock';
import { prefersReducedMotion, rememberFocus, restoreFocus } from './dom';
import { renderShell, writeAnnouncement } from './shell';
import { AppState, DialogState, Draft, initialState } from './state';

export const MAIL_BANNER = "Reminders are waiting: mail can't be reached right now.";
export const PDF_BANNER = "Packets are waiting: the PDF service can't be reached right now.";
const UNEXPECTED = "That didn't save. Try again.";

export interface RouteInfo {
  kind:
    | 'sign-in'
    | 'sign-up'
    | 'today'
    | 'catalogue'
    | 'month'
    | 'year'
    | 'clients'
    | 'states'
    | 'settings'
    | 'return'
    | 'home'
    | 'not-found';
  month?: string;
  year?: string;
  returnId?: string;
}

const BOOKKEEPER_ROUTES = new Set<RouteInfo['kind']>([
  'today',
  'catalogue',
  'month',
  'year',
  'clients',
  'states',
  'settings',
]);

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^\d{4}$/;

const SIGN_UP_ORDER = ['display_name', 'email', 'password'];
const SIGN_IN_ORDER = ['email', 'password'];
const CLIENT_ORDER = ['name', 'display_name', 'owner.email', 'owner.password'];
const REGISTER_ORDER = ['state', 'frequency', 'first_period'];
const EDITION_ORDER = ['effective_date', 'due_day', 'carry', 'rate', 'extension_days'];
const AMEND_ORDER = ['gross_sales', 'tax_due', 'note'];
const AMOUNT_ORDER = ['gross_sales', 'tax_due', 'version'];

export class App {
  state: AppState = initialState();

  /** Work that must run once the new DOM is in place, such as animations. */
  mountTasks: (() => void)[] = [];

  private pending = 0;

  private reloadTimer: number | null = null;

  private stream: EventSource | null = null;

  private queuedLines: Line[] = [];

  // ---------- routing ----------

  route(): RouteInfo {
    const path = this.state.path.replace(/\/+$/, '') || '/';
    const segments = path.split('/').filter(Boolean);
    if (path === '/sign-in') return { kind: 'sign-in' };
    if (path === '/sign-up') return { kind: 'sign-up' };
    if (path === '/today') return { kind: 'today' };
    if (path === '/catalogue') return { kind: 'catalogue' };
    if (path === '/clients') return { kind: 'clients' };
    if (path === '/states') return { kind: 'states' };
    if (path === '/settings') return { kind: 'settings' };
    if (path === '/home') return { kind: 'home' };
    if (segments[0] === 'month') {
      if (segments.length === 1) return { kind: 'month', month: this.currentMonth() };
      if (segments.length === 2 && MONTH_RE.test(segments[1])) {
        return { kind: 'month', month: segments[1] };
      }
    }
    if (segments[0] === 'year') {
      if (segments.length === 1) return { kind: 'year', year: this.currentYear() };
      if (segments.length === 2 && YEAR_RE.test(segments[1])) {
        return { kind: 'year', year: segments[1] };
      }
    }
    if (segments[0] === 'returns' && segments.length === 2) {
      return { kind: 'return', returnId: segments[1] };
    }
    return { kind: 'not-found' };
  }

  currentMonth(): string {
    return this.state.me ? centralMonth(this.state.me.now) : '';
  }

  currentYear(): string {
    return this.state.me ? centralYear(this.state.me.now) : '';
  }

  todayDate(): string {
    return this.state.me ? centralDate(this.state.me.now) : '';
  }

  query(): URLSearchParams {
    return new URLSearchParams(this.state.search);
  }

  isBusy(key: string): boolean {
    return this.state.saving[key] === true;
  }

  // ---------- rendering ----------

  /** Set by the shell when it moved focus itself, such as into a dialog. */
  focusClaimed = false;

  render(): void {
    const memory = rememberFocus();
    this.mountTasks = [];
    this.focusClaimed = false;
    renderShell(this);
    if (!this.focusClaimed) restoreFocus(memory);
    const tasks = this.mountTasks;
    this.mountTasks = [];
    for (const task of tasks) task();
  }

  /** Lowest priority first, so the highest-priority line is the one that stays. */
  announce(lines: readonly Line[]): void {
    for (const line of orderLines(lines)) {
      this.state.announcement = line.text;
      writeAnnouncement(line.text);
    }
    this.render();
  }

  announceOne(text: string, priority: number): void {
    this.announce([{ text, priority }]);
  }

  private statusSavedLine(record: ReturnRecord): Line {
    return {
      text: `${record.client.name} ${record.state} ${record.period_label} is now ${record.status_label}.`,
      priority: PRIORITY.status_saved,
    };
  }

  // ---------- navigation ----------

  navigate(to: string, options: { replace?: boolean; focusDate?: string | null } = {}): void {
    const url = new URL(to, window.location.origin);
    if (options.replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    this.state.path = url.pathname;
    this.state.search = url.search;
    this.state.notFound = false;
    this.state.openDay = null;
    this.state.bandPhase = 'closed';
    this.state.formErrors = {};
    this.state.focusedDate = options.focusDate ?? null;
    this.state.pendingDayFocus = options.focusDate ?? null;
    void this.load();
  }

  /** Keeps the screen and changes only the query, with no reload. */
  setQuery(params: URLSearchParams): void {
    const search = params.toString();
    window.history.replaceState(null, '', `${this.state.path}${search ? `?${search}` : ''}`);
    this.state.search = search ? `?${search}` : '';
    this.render();
    void this.load();
  }

  private replacePath(to: string): void {
    window.history.replaceState(null, '', to);
    this.state.path = to;
    this.state.search = '';
  }

  // ---------- boot and loading ----------

  async boot(): Promise<void> {
    try {
      this.state.me = await api.me();
    } catch {
      this.state.me = null;
    }
    this.state.booted = true;
    this.redirectIfNeeded();
    await this.load();
    this.openStream();
  }

  private redirectIfNeeded(): void {
    const route = this.route();
    const me = this.state.me;
    const path = this.state.path.replace(/\/+$/, '') || '/';
    if (!me) {
      if (route.kind !== 'sign-in' && route.kind !== 'sign-up') this.replacePath('/sign-in');
      return;
    }
    if (path === '/' || route.kind === 'sign-in' || route.kind === 'sign-up') {
      this.replacePath(me.user.role === 'bookkeeper' ? '/today' : '/home');
      return;
    }
    if (me.user.role === 'owner' && BOOKKEEPER_ROUTES.has(route.kind)) {
      this.replacePath('/home');
      return;
    }
    if (me.user.role === 'bookkeeper' && route.kind === 'home') this.replacePath('/today');
  }

  async load(): Promise<void> {
    const ticket = (this.pending += 1);
    try {
      await this.fetchForRoute();
      if (ticket === this.pending) this.state.notFound = false;
    } catch (error) {
      if (error instanceof ApiError && error.failure.status === 404) {
        this.state.notFound = true;
      } else if (error instanceof ApiError && error.failure.status === 401) {
        this.state.me = null;
        this.replacePath('/sign-in');
      }
    }
    if (ticket === this.pending) this.render();
  }

  private async fetchForRoute(): Promise<void> {
    const route = this.route();
    const me = this.state.me;
    if (!me) return;
    switch (route.kind) {
      case 'today': {
        const all = await api.returns('');
        this.state.returns = all.returns;
        this.state.counts = all.counts;
        this.state.practiceCounts = all.counts;
        this.ensureSelection(this.weekReturns());
        return;
      }
      case 'catalogue': {
        const [all, clients] = await Promise.all([api.returns(''), api.clients()]);
        this.state.returns = all.returns;
        this.state.counts = all.counts;
        this.state.practiceCounts = all.counts;
        this.state.clients = clients;
        return;
      }
      case 'month': {
        const month = route.month ?? this.currentMonth();
        const [inMonth, all] = await Promise.all([api.returns(`?month=${month}`), api.returns('')]);
        this.state.returns = inMonth.returns;
        this.state.counts = inMonth.counts;
        this.state.practiceCounts = all.counts;
        this.state.ghosts = all.returns.filter(
          (record) => record.carried_from !== null && record.carried_from.slice(0, 7) === month,
        );
        if (!this.state.focusedDate) {
          this.state.focusedDate =
            centralMonth(me.now) === month ? this.todayDate() : `${month}-01`;
        }
        return;
      }
      case 'year': {
        const year = route.year ?? this.currentYear();
        const params = new URLSearchParams({ year });
        const status = this.query().get('status');
        const state = this.query().get('state');
        if (status) params.set('status', status);
        if (state) params.set('state', state);
        const [list, states] = await Promise.all([
          api.returns(`?${params.toString()}`),
          this.state.states.length > 0 ? Promise.resolve(this.state.states) : api.states(),
        ]);
        this.state.returns = list.returns;
        this.state.counts = list.counts;
        this.state.states = states;
        return;
      }
      case 'clients': {
        const [clients, states] = await Promise.all([api.clients(), api.states()]);
        this.state.clients = clients;
        this.state.states = states;
        return;
      }
      case 'states':
        this.state.states = await api.states();
        return;
      case 'settings':
        this.state.me = await api.me();
        return;
      case 'return': {
        const id = route.returnId ?? '';
        const record = await api.getReturn(id);
        this.state.detail = record;
        this.seedDraft(record);
        this.state.reminders = me.user.role === 'bookkeeper' ? await api.reminders(id) : [];
        return;
      }
      case 'home': {
        const all = await api.returns('');
        this.state.returns = all.returns;
        this.state.counts = all.counts;
        this.state.practiceCounts = all.counts;
        this.ensureSelection(all.returns.filter((record) => record.awaiting_approval));
        return;
      }
      default:
        return;
    }
  }

  weekReturns(): ReturnRecord[] {
    if (!this.state.me) return [];
    const { from, to } = weekRange(this.todayDate());
    return this.state.returns.filter(
      (record) => record.due_date >= from && record.due_date <= to,
    );
  }

  private ensureSelection(candidates: readonly ReturnRecord[]): void {
    const selected = this.state.selectedReturnId;
    if (selected && candidates.some((record) => record.id === selected)) return;
    this.state.selectedReturnId = candidates.length > 0 ? candidates[0].id : null;
  }

  // ---------- drafts ----------

  seedDraft(record: ReturnRecord): void {
    if (this.state.drafts[record.id]) return;
    this.state.drafts[record.id] = {
      gross_sales: record.gross_sales ?? '',
      tax_due: record.tax_due ?? '',
      version: record.version,
    };
  }

  draft(record: ReturnRecord): Draft {
    this.seedDraft(record);
    return this.state.drafts[record.id];
  }

  setDraft(returnId: string, patch: Partial<Draft>): void {
    const current = this.state.drafts[returnId];
    if (!current) return;
    this.state.drafts[returnId] = { ...current, ...patch };
  }

  // ---------- dialogs ----------

  openDialog(
    dialog: Omit<DialogState, 'saving' | 'entering' | 'leaving' | 'errors'>,
  ): void {
    this.state.dialog = {
      ...dialog,
      errors: {},
      saving: false,
      entering: dialog.kind === 'send-back' && !prefersReducedMotion(),
      leaving: false,
    };
    this.state.dialogFocused = false;
    this.render();
  }

  closeDialog(): void {
    const dialog = this.state.dialog;
    if (!dialog) return;
    const openerKey = dialog.openerKey;
    const finish = (): void => {
      this.state.dialog = null;
      this.render();
      this.returnFocus(openerKey);
    };
    if (dialog.kind === 'send-back' && !prefersReducedMotion()) {
      this.state.dialog = { ...dialog, leaving: true };
      this.render();
      window.setTimeout(finish, 300);
      return;
    }
    finish();
  }

  /** Focus goes back to the opener, or the return heading when it has gone. */
  private returnFocus(openerKey: string): void {
    const opener = document.querySelector<HTMLElement>(`[data-focus-key="${openerKey}"]`);
    if (opener) {
      opener.focus();
      return;
    }
    document.querySelector<HTMLElement>('[data-focus-key="return-heading"]')?.focus();
  }

  setDialogField(name: string, value: string): void {
    if (this.state.dialog) this.state.dialog.fields[name] = value;
  }

  private dialogBusy(busy: boolean): void {
    if (this.state.dialog) this.state.dialog.saving = busy;
    this.render();
  }

  private dialogFailure(error: unknown, order: readonly string[]): void {
    const dialog = this.state.dialog;
    if (!dialog) return;
    if (error instanceof ApiError && error.failure.status === 422) {
      dialog.errors = error.fieldErrors;
      const first = order.find((key) => dialog.errors[key]) ?? Object.keys(dialog.errors)[0];
      this.state.dialogRefocus = true;
      this.announceOne(dialog.errors[first] ?? UNEXPECTED, PRIORITY.field_error);
      return;
    }
    if (error instanceof ApiError && error.code === 'deadline_passed') {
      const copy = 'The deadline for this return has passed.';
      dialog.errors = { _message: copy };
      this.state.dialogRefocus = true;
      this.announceOne(copy, PRIORITY.extension_refused);
      return;
    }
    if (error instanceof ApiError && error.code === 'conflict') {
      const copy = this.conflictCopy(error);
      dialog.errors = { _message: copy };
      this.state.dialogRefocus = true;
      void this.load();
      this.announceOne(copy, PRIORITY.conflict);
      return;
    }
    dialog.errors = { _message: UNEXPECTED };
    this.state.dialogRefocus = true;
    this.announceOne(UNEXPECTED, PRIORITY.banner);
  }

  private conflictCopy(error: ApiError): string {
    const body = error.failure.body;
    const changedBy = typeof body.changed_by === 'string' ? body.changed_by : 'Someone';
    const returnBody = body.return as { status?: string } | undefined;
    const status = (returnBody?.status ?? 'prepared') as ReturnStatus;
    return `${changedBy} changed this return first. It is now ${STATUS_LABELS[status] ?? status}.`;
  }

  // ---------- form helpers ----------

  private formFailure(error: unknown, order: readonly string[]): void {
    if (error instanceof ApiError && error.failure.status === 422) {
      this.state.formErrors = error.fieldErrors;
      const first =
        order.find((key) => this.state.formErrors[key]) ?? Object.keys(this.state.formErrors)[0];
      const message = this.state.formErrors[first] ?? UNEXPECTED;
      this.announceOne(message, PRIORITY.field_error);
      window.setTimeout(() => {
        document.querySelector<HTMLElement>(`[data-field-error="${first}"]`)?.scrollIntoView({
          block: 'nearest',
        });
      }, 0);
      return;
    }
    this.announceOne(UNEXPECTED, PRIORITY.banner);
  }

  private busy(key: string, value: boolean): void {
    this.state.saving[key] = value;
    this.render();
  }

  // ---------- authentication ----------

  async submitSignUp(): Promise<void> {
    this.state.formErrors = {};
    this.busy('auth', true);
    try {
      await api.signUp({
        display_name: this.state.formFields.display_name ?? '',
        email: this.state.formFields.email ?? '',
        password: this.state.formFields.password ?? '',
      });
      await this.afterSignIn();
    } catch (error) {
      this.formFailure(error, SIGN_UP_ORDER);
    } finally {
      this.busy('auth', false);
    }
  }

  async submitSignIn(): Promise<void> {
    this.state.formErrors = {};
    this.busy('auth', true);
    try {
      await api.signIn({
        email: this.state.formFields.email ?? '',
        password: this.state.formFields.password ?? '',
      });
      await this.afterSignIn();
    } catch (error) {
      this.formFailure(error, SIGN_IN_ORDER);
    } finally {
      this.busy('auth', false);
    }
  }

  private async afterSignIn(): Promise<void> {
    this.state.formFields = {};
    this.state.me = await api.me();
    this.replacePath(this.state.me.user.role === 'bookkeeper' ? '/today' : '/home');
    await this.load();
    this.openStream();
  }

  async signOut(): Promise<void> {
    await api.signOut().catch(() => undefined);
    this.stream?.close();
    this.stream = null;
    this.state = initialState();
    this.state.booted = true;
    this.replacePath('/sign-in');
    this.render();
  }

  // ---------- settings ----------

  async saveReminderHour(): Promise<void> {
    const me = this.state.me;
    if (!me) return;
    this.state.formErrors = {};
    this.busy('reminder-hour', true);
    try {
      const hour = Number(this.state.formFields.reminder_hour ?? String(me.reminder_hour));
      const saved = await api.patchPractice(hour);
      this.state.me = { ...me, reminder_hour: saved.reminder_hour };
      this.announceOne('Reminder hour saved.', PRIORITY.own_action);
    } catch (error) {
      this.formFailure(error, ['reminder_hour']);
    } finally {
      this.busy('reminder-hour', false);
    }
  }

  // ---------- clients and states ----------

  async submitAddClient(): Promise<void> {
    const dialog = this.state.dialog;
    if (!dialog) return;
    this.dialogBusy(true);
    try {
      const client = await api.addClient({
        name: dialog.fields.name ?? '',
        owner: {
          display_name: dialog.fields.display_name ?? '',
          email: dialog.fields['owner.email'] ?? '',
          password: dialog.fields['owner.password'] ?? '',
        },
      });
      this.closeDialog();
      this.announceOne(`Client added: ${client.name}.`, PRIORITY.own_action);
      void this.load();
    } catch (error) {
      this.dialogBusy(false);
      this.dialogFailure(error, CLIENT_ORDER);
    }
  }

  async submitRegistration(): Promise<void> {
    const dialog = this.state.dialog;
    if (!dialog || !dialog.clientId) return;
    this.dialogBusy(true);
    try {
      await api.register(dialog.clientId, {
        state: dialog.fields.state ?? '',
        frequency: dialog.fields.frequency ?? '',
        first_period: dialog.fields.first_period ?? '',
      });
      const clientName = dialog.clientName ?? '';
      const stateCode = dialog.fields.state ?? '';
      this.closeDialog();
      this.announceOne(`${clientName} registered in ${stateCode}.`, PRIORITY.own_action);
      void this.load();
    } catch (error) {
      this.dialogBusy(false);
      this.dialogFailure(error, REGISTER_ORDER);
    }
  }

  async submitHolidays(): Promise<void> {
    const dialog = this.state.dialog;
    if (!dialog || !dialog.stateCode) return;
    const code = dialog.stateCode;
    const lines = (dialog.fields.holidays ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    this.dialogBusy(true);
    try {
      await api.saveHolidays(code, lines);
      this.closeDialog();
      this.announceOne(`Holidays saved for ${code}.`, PRIORITY.own_action);
      void this.load();
    } catch (error) {
      this.dialogBusy(false);
      this.dialogFailure(error, ['holidays']);
    }
  }

  async submitEdition(): Promise<void> {
    const dialog = this.state.dialog;
    if (!dialog || !dialog.stateCode) return;
    const code = dialog.stateCode;
    this.dialogBusy(true);
    try {
      await api.publishEdition(code, {
        effective_date: dialog.fields.effective_date ?? '',
        due_day: numberOrNull(dialog.fields.due_day),
        carry: dialog.fields.carry ?? '',
        rate: dialog.fields.rate ?? '',
        extension_days: numberOrNull(dialog.fields.extension_days),
      });
      this.closeDialog();
      this.announceOne(`Rule change published for ${code}.`, PRIORITY.own_action);
      void this.load();
    } catch (error) {
      this.dialogBusy(false);
      this.dialogFailure(error, EDITION_ORDER);
    }
  }

  // ---------- return actions ----------

  async saveAmounts(record: ReturnRecord): Promise<void> {
    const draft = this.draft(record);
    this.state.formErrors = {};
    this.busy('save-amounts', true);
    try {
      const updated = await api.saveAmounts(record.id, {
        version: draft.version,
        gross_sales: draft.gross_sales,
        tax_due: draft.tax_due,
      });
      this.state.detail = updated;
      this.setDraft(record.id, { version: updated.version });
      this.announceOne(
        `Amounts saved for ${updated.client.name} ${updated.state} ${updated.period_label}.`,
        PRIORITY.amounts_saved,
      );
    } catch (error) {
      this.returnFailure(error, record, AMOUNT_ORDER);
    } finally {
      this.busy('save-amounts', false);
    }
  }

  async markPrepared(record: ReturnRecord): Promise<void> {
    const draft = this.draft(record);
    this.state.formErrors = {};
    this.busy('mark-prepared', true);
    try {
      const updated = await api.prepare(record.id, {
        version: draft.version,
        gross_sales: draft.gross_sales,
        tax_due: draft.tax_due,
      });
      this.state.detail = updated;
      this.setDraft(record.id, { version: updated.version });
      this.announce([this.statusSavedLine(updated)]);
    } catch (error) {
      this.returnFailure(error, record, AMOUNT_ORDER);
    } finally {
      this.busy('mark-prepared', false);
    }
  }

  /** A losing save keeps its draft and takes the winning version. */
  private returnFailure(
    error: unknown,
    record: ReturnRecord,
    order: readonly string[],
  ): void {
    if (error instanceof ApiError && error.code === 'conflict') {
      const body = error.failure.body.return as { version?: number } | undefined;
      if (typeof body?.version === 'number') {
        this.setDraft(record.id, { version: body.version });
      }
      const copy = this.conflictCopy(error);
      void this.load();
      this.announceOne(copy, PRIORITY.conflict);
      return;
    }
    if (error instanceof ApiError && error.failure.status === 422) {
      this.formFailure(error, order);
      return;
    }
    this.announceOne(UNEXPECTED, PRIORITY.banner);
  }

  async approve(record: ReturnRecord): Promise<void> {
    this.busy('approve', true);
    try {
      const updated = await api.approve(record.id, this.latestVersion(record));
      if (this.state.detail) this.state.detail = updated;
      this.announce([this.statusSavedLine(updated)]);
      void this.load();
    } catch (error) {
      this.returnFailure(error, record, []);
    } finally {
      this.busy('approve', false);
    }
  }

  openSendBack(record: ReturnRecord): void {
    this.openDialog({
      kind: 'send-back',
      openerKey: 'send-back',
      clientId: record.client.id,
      clientName: record.client.name,
      stateCode: record.state,
      returnId: record.id,
      fields: { reason: '' },
    });
  }

  async submitSendBack(): Promise<void> {
    const dialog = this.state.dialog;
    if (!dialog || !dialog.returnId) return;
    const record = this.recordById(dialog.returnId);
    if (!record) return;
    this.dialogBusy(true);
    try {
      const updated = await api.sendBack(
        record.id,
        this.latestVersion(record),
        dialog.fields.reason ?? '',
      );
      if (this.state.detail) this.state.detail = updated;
      this.closeDialog();
      this.announce([this.statusSavedLine(updated)]);
      void this.load();
    } catch (error) {
      this.dialogBusy(false);
      this.dialogFailure(error, ['reason']);
    }
  }

  async confirmFiling(): Promise<void> {
    const dialog = this.state.dialog;
    const record = dialog?.returnId ? this.recordById(dialog.returnId) : null;
    if (!dialog || !record) return;
    this.dialogBusy(true);
    try {
      const updated = await api.file(record.id, this.latestVersion(record));
      this.state.detail = updated;
      this.closeDialog();
      this.announce([this.statusSavedLine(updated)]);
      void this.load();
    } catch (error) {
      this.dialogBusy(false);
      this.dialogFailure(error, []);
    }
  }

  async confirmExtension(): Promise<void> {
    const dialog = this.state.dialog;
    const record = dialog?.returnId ? this.recordById(dialog.returnId) : null;
    if (!dialog || !record) return;
    this.dialogBusy(true);
    try {
      const updated = await api.extend(record.id, this.latestVersion(record));
      this.state.detail = updated;
      this.closeDialog();
      this.announceOne(
        `Extended to ${longDateString(updated.due_date)}.`,
        PRIORITY.extension_granted,
      );
      void this.load();
    } catch (error) {
      this.dialogBusy(false);
      this.dialogFailure(error, []);
    }
  }

  async submitAmendment(): Promise<void> {
    const dialog = this.state.dialog;
    const record = dialog?.returnId ? this.recordById(dialog.returnId) : null;
    if (!dialog || !record) return;
    this.dialogBusy(true);
    try {
      const updated = await api.amend(record.id, {
        version: this.latestVersion(record),
        gross_sales: dialog.fields.gross_sales ?? '',
        tax_due: dialog.fields.tax_due ?? '',
        note: dialog.fields.note ?? '',
      });
      this.state.detail = updated;
      this.closeDialog();
      this.announce([this.statusSavedLine(updated)]);
      void this.load();
    } catch (error) {
      this.dialogBusy(false);
      this.dialogFailure(error, AMEND_ORDER);
    }
  }

  private recordById(id: string): ReturnRecord | null {
    if (this.state.detail && this.state.detail.id === id) return this.state.detail;
    return this.state.returns.find((record) => record.id === id) ?? null;
  }

  /** Every action but a draft save uses the latest version the tab has received. */
  private latestVersion(record: ReturnRecord): number {
    return this.recordById(record.id)?.version ?? record.version;
  }

  // ---------- month grid and band ----------

  focusDay(date: string, month: string): void {
    const targetMonth = date.slice(0, 7);
    this.state.focusedDate = date;
    this.state.pendingDayFocus = date;
    if (targetMonth !== month) {
      this.goToMonth(targetMonth, date);
      return;
    }
    this.render();
  }

  goToMonth(month: string, focusDate: string | null): void {
    this.navigate(`/month/${month}`, { focusDate });
  }

  toggleBand(date: string, count: number): void {
    if (this.state.openDay === date) {
      this.closeBand();
      return;
    }
    if (count === 0) return;
    this.state.openDay = date;
    this.state.bandPhase = 'opening';
    this.state.focusedDate = date;
    this.state.pendingDayFocus = date;
    this.announceOne(
      `${count === 1 ? '1 return' : `${count} returns`} due ${longDateString(date)}.`,
      PRIORITY.band_opened,
    );
  }

  closeBand(): void {
    const date = this.state.openDay;
    this.state.openDay = null;
    this.state.bandPhase = 'closed';
    if (date) this.state.pendingDayFocus = date;
    this.render();
  }

  // ---------- year filters ----------

  toggleFilter(kind: 'status' | 'state', value: string): void {
    const params = this.query();
    if (params.get(kind) === value) params.delete(kind);
    else params.set(kind, value);
    this.setQuery(params);
  }

  // ---------- catalogue rows ----------

  refreshRowControls(row: HTMLElement): void {
    const controls = row.parentElement?.querySelector('[data-row-controls]');
    if (!controls) return;
    const atStart = row.scrollLeft <= 1;
    const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 1;
    const previous = controls.querySelector<HTMLElement>('[data-row-previous]');
    const next = controls.querySelector<HTMLElement>('[data-row-next]');
    if (previous) previous.hidden = atStart;
    if (next) next.hidden = atEnd;
  }

  // ---------- live band ----------

  private openStream(): void {
    if (!this.state.me || this.stream) return;
    const stream = new EventSource('/api/events');
    this.stream = stream;
    stream.onmessage = (message: MessageEvent<string>) => {
      const payload: unknown = JSON.parse(message.data);
      if (payload === null || typeof payload !== 'object') return;
      const event = payload as {
        type?: string;
        lines?: Line[];
        services?: { mail: boolean; pdf: boolean };
      };
      if (event.services) this.applyServices(event.services);
      if (event.type === 'change') this.scheduleReload(Array.isArray(event.lines) ? event.lines : []);
    };
  }

  private applyServices(services: { mail: boolean; pdf: boolean }): void {
    const before = this.state.services;
    this.state.services = services;
    const lines: Line[] = [];
    if (!services.mail && before.mail) lines.push({ text: MAIL_BANNER, priority: PRIORITY.banner });
    if (!services.pdf && before.pdf) lines.push({ text: PDF_BANNER, priority: PRIORITY.banner });
    if (lines.length > 0) this.announce(lines);
    else this.render();
  }

  private scheduleReload(lines: readonly Line[]): void {
    this.queuedLines.push(...lines);
    if (this.reloadTimer !== null) return;
    this.reloadTimer = window.setTimeout(() => {
      this.reloadTimer = null;
      const queued = this.queuedLines;
      this.queuedLines = [];
      void this.load().then(() => {
        if (queued.length > 0) this.announce(queued);
      });
    }, 60);
  }
}

function numberOrNull(value: string | undefined): number | string {
  if (value === undefined || value.trim() === '') return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}
