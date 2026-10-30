import { ApiFault, request } from '../shared/api.js';
import { clear, el, trapTab } from '../shared/dom.js';
import { paperGround } from '../shared/paper.js';
import { Notices } from '../shared/notices.js';
import { copy } from '../game/copy.js';
import { formatWallTime, sortedTimeZones } from '../../shared/studioClock.js';

interface Mission {
  mission_id: string;
  title: string;
  resident_id: string;
  reward_stamps: number;
  kind: 'standard' | 'rush';
  rush_slots: number | null;
  dialogue: { offer: string[]; thanks: string[] };
  status: 'draft' | 'scheduled' | 'live' | 'retired';
  version: number;
  revision: number;
  live_at: string | null;
}

interface Resident {
  resident_id: string;
  name: string;
  home: string;
}

type Move = 'schedule' | 'publish' | 'unschedule' | 'retire';

const MOVE_LABELS: Record<Move, string> = {
  schedule: 'Schedule',
  publish: 'Publish now',
  unschedule: 'Unschedule',
  retire: 'Retire',
};

const LEGAL_MOVES: Record<Mission['status'], Move[]> = {
  draft: ['schedule', 'publish'],
  scheduled: ['unschedule'],
  live: ['retire'],
  retired: [],
};

interface EditorValues {
  title: string;
  resident_id: string;
  reward_stamps: string;
  kind: 'standard' | 'rush';
  rush_slots: string;
  offer: string;
  thanks: string;
  live_at: string;
}

class Console {
  private readonly notices = new Notices();
  private readonly newMission = el('button', { type: 'button', class: 'primary' }, [
    'New mission',
  ]);
  private readonly tableBody = el('tbody', {});
  private readonly form = el('form', { 'aria-label': 'Mission editor', class: 'mission-editor' });
  private readonly title = el('input', { type: 'text', id: 'field-title' });
  private readonly resident = el('select', { id: 'field-resident' });
  private readonly reward = el('input', { type: 'number', id: 'field-reward', min: 1, max: 50 });
  private readonly kindGroup = el('div', {
    role: 'radiogroup',
    'aria-label': 'Kind',
    class: 'kind-group',
  });
  private readonly standardRadio = el('div', { role: 'radio', 'aria-label': 'Standard' });
  private readonly rushRadio = el('div', { role: 'radio', 'aria-label': 'Rush' });
  private readonly rushSlots = el('input', { type: 'number', id: 'field-slots', min: 1, max: 5 });
  private readonly rushSlotsRow = el('div', { class: 'field' });
  private readonly offer = el('textarea', { id: 'field-offer', rows: 4 });
  private readonly thanks = el('textarea', { id: 'field-thanks', rows: 3 });
  private readonly liveAt = el('input', { type: 'text', id: 'field-live-at' });
  private readonly saveButton = el('button', { type: 'button', class: 'primary' }, ['Save draft']);
  private readonly moveButtons = el('div', { class: 'move-buttons' });
  private readonly timeZone = el('select', { id: 'field-zone' });
  private readonly saveZone = el('button', { type: 'button' }, ['Save time zone']);
  private readonly boardLine = el('p', { class: 'board-line' });
  private readonly onlineLine = el('p', { class: 'online-line' });
  private readonly discard = el('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Discard changes?',
    class: 'paper-dialog perforated',
    hidden: true,
  });
  private readonly discardButton = el('button', { type: 'button', class: 'primary' }, ['Discard']);
  private readonly keepEditing = el('button', { type: 'button' }, ['Keep editing']);

  private missions: Mission[] = [];
  private residents: Resident[] = [];
  private editing: Mission | null = null;
  private loaded: EditorValues | null = null;
  private creating = false;
  private studioZone = 'UTC';
  private pendingNavigation: string | null = null;
  private suppressPopstate = false;
  private readonly fieldErrors = new Map<HTMLElement, HTMLElement>();

  async start(): Promise<void> {
    const host = document.getElementById('console-app')!;
    host.append(this.notices.region);
    try {
      await request('GET', '/api/founder/studio');
    } catch (fault) {
      this.showRefusal(host, fault);
      return;
    }
    this.buildLayout(host);
    this.residents = (
      await request<{ residents: Resident[] }>('GET', '/api/world')
    ).body.residents;
    this.resident.replaceChildren(
      el('option', { value: '' }, ['—']),
      ...this.residents.map((person) =>
        el('option', { value: person.resident_id }, [`${person.name} · ${person.home}`]),
      ),
    );
    this.timeZone.replaceChildren(
      ...sortedTimeZones().map((zone) => el('option', { value: zone }, [zone])),
    );
    await this.refresh();
    this.openFromUrl({ focus: true });
    window.setInterval(() => void this.refresh(), 5000);
    window.addEventListener('popstate', () => this.onPopstate());
  }

  private async showRefusal(host: HTMLElement, fault: unknown): Promise<void> {
    const card = el('article', { class: 'stamp-card perforated console-refusal' }, [
      el('p', {}, [copy.console.founderOnly]),
    ]);
    paperGround(card);
    const walk = el('button', { type: 'button', class: 'primary' }, ['Walk on Bramble']);
    walk.addEventListener('click', () => window.location.assign('/'));
    const signedIn =
      fault instanceof ApiFault && fault.status === 403 && fault.code === 'founder_only';
    let guest = !signedIn;
    if (signedIn) {
      try {
        const me = (await request<{ role: string }>('GET', '/api/me')).body;
        guest = me.role === 'guest';
      } catch {
        guest = true;
      }
    }
    if (guest) {
      const email = el('input', { type: 'email' });
      email.setAttribute('aria-label', 'Email');
      const send = el('button', { type: 'button' }, ['Send postbox key']);
      send.addEventListener('click', () => void this.sendKey(email.value));
      card.append(el('div', { class: 'refusal-key' }, [email, send]));
    }
    card.append(walk);
    host.append(el('main', { 'aria-label': 'Founder console', class: 'console-page' }, [card]));
  }

  private async sendKey(email: string): Promise<void> {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    this.notices.say(copy.postboxKey.pending);
    try {
      await request('POST', '/api/auth/postbox-key', {
        json: { email, return_to: returnTo },
      });
      this.notices.say(copy.postboxKey.success);
    } catch (fault) {
      this.notices.say(
        fault instanceof ApiFault && fault.code === 'post_office_closed'
          ? copy.postboxKey.closed
          : copy.postboxKey.invalid,
      );
    }
  }

  private field(label: string, control: HTMLElement): HTMLElement {
    const error = el('p', { class: 'field-error', id: `${control.id}-error` });
    this.fieldErrors.set(control, error);
    return el('div', { class: 'field' }, [
      el('label', { for: control.id }, [label]),
      control,
      error,
    ]);
  }

  private buildLayout(host: HTMLElement): void {
    const table = el('table', { 'aria-label': 'Missions', class: 'missions-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col' }, ['Title']),
          el('th', { scope: 'col' }, ['Status']),
          el('th', { scope: 'col' }, ['Version']),
          el('th', { scope: 'col' }, ['Goes live']),
        ]),
      ]),
      this.tableBody,
    ]);
    const missionsRegion = el(
      'section',
      { role: 'region', 'aria-label': 'Missions', class: 'missions-region' },
      [el('h2', {}, ['Missions']), this.newMission, table],
    );

    this.kindGroup.append(this.standardRadio, this.rushRadio);
    this.rushSlotsRow.append(
      el('label', { for: this.rushSlots.id }, ['Rush slots']),
      this.rushSlots,
    );
    this.form.append(
      this.field('Title', this.title),
      this.field('Resident', this.resident),
      this.field('Stamp reward', this.reward),
      el('div', { class: 'field' }, [el('span', { class: 'field-label' }, ['Kind']), this.kindGroup]),
      this.rushSlotsRow,
      this.field('Offer lines', this.offer),
      this.field('Thanks lines', this.thanks),
      this.field('Go live at', this.liveAt),
      this.saveButton,
      this.moveButtons,
    );
    this.form.addEventListener('submit', (event) => event.preventDefault());

    const studio = el(
      'section',
      { role: 'region', 'aria-label': 'Studio', class: 'studio-region' },
      [
        el('h2', {}, ['Studio']),
        this.field('Studio time zone', this.timeZone),
        this.saveZone,
        this.boardLine,
      ],
    );
    const online = el(
      'section',
      { role: 'region', 'aria-label': 'Online now', class: 'online-region' },
      [el('h2', {}, ['Online now']), this.onlineLine],
    );
    for (const panel of [missionsRegion, this.form, studio, online]) paperGround(panel);
    host.append(
      el('main', { 'aria-label': 'Founder console', class: 'console-page' }, [
        el('h1', {}, ['Founder console']),
        el('div', { class: 'console-grid' }, [missionsRegion, this.form, studio, online]),
      ]),
      this.discard,
    );

    this.discard.append(
      el('p', {}, [copy.console.discard]),
      el('div', { class: 'confirm-actions' }, [this.discardButton, this.keepEditing]),
    );
    paperGround(this.discard);
    this.discard.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.keepEdits();
        return;
      }
      trapTab(this.discard, event);
    });
    this.discardButton.addEventListener('click', () => this.dropEdits());
    this.keepEditing.addEventListener('click', () => this.keepEdits());

    this.newMission.addEventListener('click', () => {
      this.pushUrl('/console?mission=new');
      this.startNewMission();
    });
    this.saveButton.addEventListener('click', () => void this.save());
    this.saveZone.addEventListener('click', () => void this.saveTimeZone());
    this.listenToKind();
  }

  private listenToKind(): void {
    const set = (kind: 'standard' | 'rush'): void => {
      if (this.editing !== null) return;
      this.writeKind(kind);
    };
    this.standardRadio.addEventListener('click', () => set('standard'));
    this.rushRadio.addEventListener('click', () => set('rush'));
    this.kindGroup.addEventListener('keydown', (event) => {
      if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      set(this.kindValue() === 'standard' ? 'rush' : 'standard');
    });
  }

  private kindValue(): 'standard' | 'rush' {
    return this.rushRadio.getAttribute('aria-checked') === 'true' ? 'rush' : 'standard';
  }

  private writeKind(kind: 'standard' | 'rush'): void {
    const locked = this.editing !== null;
    for (const [radio, value] of [
      [this.standardRadio, 'standard'],
      [this.rushRadio, 'rush'],
    ] as const) {
      const checked = value === kind;
      radio.setAttribute('aria-checked', checked ? 'true' : 'false');
      if (locked) {
        radio.setAttribute('aria-disabled', 'true');
        radio.removeAttribute('tabindex');
      } else {
        radio.removeAttribute('aria-disabled');
        radio.setAttribute('tabindex', checked ? '0' : '-1');
      }
    }
    this.rushSlotsRow.hidden = kind !== 'rush';
  }

  // --- the editor's values ---

  private values(): EditorValues {
    return {
      title: this.title.value,
      resident_id: this.resident.value,
      reward_stamps: this.reward.value,
      kind: this.kindValue(),
      rush_slots: this.rushSlots.value,
      offer: this.offer.value,
      thanks: this.thanks.value,
      live_at: this.liveAt.value,
    };
  }

  private get dirty(): boolean {
    if (this.loaded === null) return false;
    const now = this.values();
    return (Object.keys(now) as Array<keyof EditorValues>).some(
      (key) => now[key] !== this.loaded![key],
    );
  }

  private load(mission: Mission | null): void {
    this.editing = mission;
    this.creating = mission === null;
    this.title.value = mission?.title ?? '';
    this.resident.value = mission?.resident_id ?? '';
    this.reward.value = mission === null ? '' : String(mission.reward_stamps);
    this.rushSlots.value = mission?.rush_slots === null || mission === undefined ? '' : String(mission?.rush_slots ?? '');
    this.offer.value = mission === null ? '' : mission.dialogue.offer.join('\n');
    this.thanks.value = mission === null ? '' : mission.dialogue.thanks.join('\n');
    this.liveAt.value =
      mission?.status === 'scheduled' && mission.live_at !== null
        ? formatWallTime(new Date(mission.live_at), this.studioZone)
        : '';
    this.writeKind(mission?.kind ?? 'standard');
    this.saveButton.textContent = mission === null ? 'Save draft' : 'Save changes';
    this.form.hidden = false;
    this.clearErrors();
    this.renderMoves();
    this.loaded = this.values();
  }

  private clearEditor(): void {
    this.editing = null;
    this.creating = false;
    this.loaded = null;
    this.form.hidden = true;
    this.clearErrors();
  }

  private startNewMission(): void {
    this.load(null);
    this.title.focus();
  }

  private renderMoves(): void {
    clear(this.moveButtons);
    if (this.editing === null) return;
    for (const move of LEGAL_MOVES[this.editing.status]) {
      const button = el('button', { type: 'button' }, [MOVE_LABELS[move]]);
      button.addEventListener('click', () => void this.makeMove(move));
      this.moveButtons.append(button);
    }
  }

  private firstMoveButton(): HTMLElement | null {
    return this.moveButtons.querySelector('button');
  }

  private clearErrors(): void {
    for (const [control, error] of this.fieldErrors) {
      error.textContent = '';
      control.removeAttribute('aria-describedby');
    }
  }

  private showFieldErrors(fields: Record<string, string>): void {
    this.clearErrors();
    const order: Array<[string, HTMLElement, string]> = [
      ['title', this.title, copy.console.fields.title],
      ['resident_id', this.resident, copy.console.fields.resident_id],
      ['reward_stamps', this.reward, copy.console.fields.reward_stamps],
      ['rush_slots', this.rushSlots, copy.console.fields.rush_slots],
      ['dialogue.offer', this.offer, copy.console.fields['dialogue.offer']],
      ['dialogue.thanks', this.thanks, copy.console.fields['dialogue.thanks']],
    ];
    let firstInvalid: HTMLElement | null = null;
    for (const [name, control, message] of order) {
      if (fields[name] === undefined) continue;
      const error = this.fieldErrors.get(control)!;
      error.textContent = message;
      control.setAttribute('aria-describedby', error.id);
      firstInvalid ??= control;
    }
    for (const name of ['live_at', 'live_at_local']) {
      const reason = fields[name];
      if (reason === undefined) continue;
      const error = this.fieldErrors.get(this.liveAt)!;
      const messages = copy.console.fields.live_at_local;
      error.textContent =
        reason === 'nonexistent_time'
          ? messages.nonexistent_time
          : reason === 'in_past'
            ? messages.in_past
            : reason === 'out_of_range'
              ? messages.out_of_range
              : messages.invalid;
      this.liveAt.setAttribute('aria-describedby', error.id);
      firstInvalid ??= this.liveAt;
    }
    firstInvalid?.focus();
  }

  // --- reading from the server ---

  private async refresh(): Promise<void> {
    try {
      const [missions, studio, online] = await Promise.all([
        request<{ missions: Mission[] }>('GET', '/api/founder/missions'),
        request<{ time_zone: string; board_date: string }>('GET', '/api/founder/studio'),
        request<{ online: number; guests: number; signed_in: number }>(
          'GET',
          '/api/founder/online',
        ),
      ]);
      this.missions = missions.body.missions;
      this.studioZone = studio.body.time_zone;
      if (this.timeZone !== document.activeElement) this.timeZone.value = this.studioZone;
      this.boardLine.textContent = `Today's board: ${studio.body.board_date}`;
      this.onlineLine.textContent = `${online.body.online} couriers on Bramble (${online.body.guests} guests, ${online.body.signed_in} signed in)`;
      this.renderTable();
      this.takeFreshRevision();
    } catch {
      /* the next refresh tries afresh */
    }
  }

  /** A clean editor takes the newest revision; one with unsaved edits keeps the one it loaded. */
  private takeFreshRevision(): void {
    if (this.editing === null || this.dirty) return;
    const fresh = this.missions.find((each) => each.mission_id === this.editing!.mission_id);
    if (fresh === undefined) return;
    const changed =
      fresh.revision !== this.editing.revision || fresh.status !== this.editing.status;
    this.editing = fresh;
    if (changed) {
      const focused = document.activeElement;
      this.load(fresh);
      if (focused instanceof HTMLElement && document.contains(focused)) focused.focus();
    }
  }

  private renderTable(): void {
    clear(this.tableBody);
    for (const mission of this.missions) {
      const edit = el('button', { type: 'button' }, [`Edit ${mission.title}`]);
      edit.addEventListener('click', () => {
        this.pushUrl(`/console?mission=${mission.mission_id}`);
        this.load(mission);
        this.title.focus();
      });
      this.tableBody.append(
        el('tr', {}, [
          el('td', {}, [el('span', { class: 'row-title' }, [mission.title]), edit]),
          el('td', {}, [mission.status]),
          el('td', {}, [String(mission.version)]),
          el('td', {}, [
            mission.status === 'scheduled' && mission.live_at !== null
              ? formatWallTime(new Date(mission.live_at), this.studioZone)
              : '—',
          ]),
        ]),
      );
    }
  }

  // --- saving and moving ---

  private bodyFromEditor(): Record<string, unknown> {
    const lines = (raw: string): string[] =>
      raw.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
    const kind = this.kindValue();
    return {
      title: this.title.value,
      resident_id: this.resident.value,
      reward_stamps: Number(this.reward.value),
      kind,
      rush_slots: kind === 'rush' ? Number(this.rushSlots.value) : null,
      dialogue: { offer: lines(this.offer.value), thanks: lines(this.thanks.value) },
    };
  }

  private async save(): Promise<void> {
    this.notices.say(copy.console.savePending);
    try {
      if (this.editing === null) {
        const answer = await request<Mission>('POST', '/api/founder/missions', {
          json: this.bodyFromEditor(),
        });
        this.replaceUrl(`/console?mission=${answer.body.mission_id}`);
        this.load(answer.body);
        this.notices.say(copy.console.draftSaved);
      } else {
        const body = this.bodyFromEditor();
        delete body.kind;
        const answer = await request<Mission>(
          'PATCH',
          `/api/founder/missions/${this.editing.mission_id}`,
          { json: body, headers: { 'If-Match': `"${this.editing.revision}"` } },
        );
        this.load(answer.body);
        this.notices.say(
          answer.body.status === 'live'
            ? copy.console.liveNow(answer.body.version)
            : copy.console.draftSaved,
        );
      }
      await this.refresh();
      this.afterMoveFocus();
    } catch (fault) {
      this.handleFault(fault);
    }
  }

  private async makeMove(move: Move): Promise<void> {
    const mission = this.editing;
    if (mission === null) return;
    this.notices.say(copy.console.movePending);
    const headers = { 'If-Match': `"${mission.revision}"` };
    try {
      let answer;
      if (move === 'schedule') {
        answer = await request<Mission>(
          'POST',
          `/api/founder/missions/${mission.mission_id}/schedule`,
          { json: { live_at_local: this.liveAt.value.trim().replace(' ', 'T') }, headers },
        );
      } else if (move === 'publish') {
        answer = await request<Mission>(
          'POST',
          `/api/founder/missions/${mission.mission_id}/schedule`,
          { json: { live_at: 'now' }, headers },
        );
      } else {
        answer = await request<Mission>(
          'POST',
          `/api/founder/missions/${mission.mission_id}/${move}`,
          { json: {}, headers },
        );
      }
      this.load(answer.body);
      this.notices.say(this.moveCopy(move, answer.body));
      await this.refresh();
      this.afterMoveFocus();
    } catch (fault) {
      this.handleFault(fault);
    }
  }

  private moveCopy(move: Move, mission: Mission): string {
    if (move === 'unschedule') return copy.console.backToDraft;
    if (move === 'retire') return copy.console.retired;
    if (mission.status === 'live') return copy.console.liveNow(mission.version);
    return copy.console.scheduledFor(
      mission.live_at === null ? '' : formatWallTime(new Date(mission.live_at), this.studioZone),
    );
  }

  private afterMoveFocus(): void {
    const button = this.firstMoveButton();
    (button ?? this.newMission).focus();
  }

  private handleFault(fault: unknown): void {
    if (!(fault instanceof ApiFault)) {
      this.notices.say(copy.internal);
      return;
    }
    if (fault.code === 'validation' && fault.fields !== null) {
      this.showFieldErrors(fault.fields);
      this.notices.say('');
      return;
    }
    if (fault.code === 'stale_revision') {
      this.notices.say(copy.console.stale_revision);
      return;
    }
    if (fault.code === 'mission_retired') {
      this.notices.say(copy.console.mission_retired);
      return;
    }
    if (fault.code === 'illegal_transition') {
      this.notices.say(fault.sentence);
      return;
    }
    this.notices.say(fault.status === 500 ? copy.internal : fault.sentence);
  }

  private async saveTimeZone(): Promise<void> {
    this.notices.say(copy.console.savePending);
    try {
      const answer = await request<{ time_zone: string; board_date: string }>(
        'PATCH',
        '/api/founder/studio',
        { json: { time_zone: this.timeZone.value } },
      );
      this.studioZone = answer.body.time_zone;
      this.notices.say(copy.console.timeZoneSaved(answer.body.board_date));
      await this.refresh();
    } catch {
      this.notices.say(copy.console.timeZoneInvalid);
    }
  }

  // --- the URL and the editor ---

  private pushUrl(url: string): void {
    window.history.pushState(null, '', url);
  }

  private replaceUrl(url: string): void {
    window.history.replaceState(null, '', url);
  }

  private openFromUrl(options: { focus: boolean }): void {
    const wanted = new URLSearchParams(window.location.search).get('mission');
    if (wanted === null) {
      this.clearEditor();
      if (options.focus) this.newMission.focus();
      return;
    }
    if (wanted === 'new') {
      this.load(null);
      if (options.focus) this.title.focus();
      return;
    }
    const mission = this.missions.find((each) => each.mission_id === wanted);
    if (mission === undefined) {
      this.clearEditor();
      this.notices.say(copy.console.unknownMission);
      this.replaceUrl('/console');
      if (options.focus) this.newMission.focus();
      return;
    }
    this.load(mission);
    if (options.focus) this.title.focus();
  }

  private onPopstate(): void {
    if (this.suppressPopstate) {
      this.suppressPopstate = false;
      return;
    }
    if (!this.dirty) {
      this.openFromUrl({ focus: true });
      return;
    }
    this.pendingNavigation = `${window.location.pathname}${window.location.search}`;
    this.replaceUrl(this.editorUrl());
    this.discard.hidden = false;
    this.keepEditing.focus();
  }

  private editorUrl(): string {
    if (this.editing !== null) return `/console?mission=${this.editing.mission_id}`;
    return this.creating ? '/console?mission=new' : '/console';
  }

  private keepEdits(): void {
    this.discard.hidden = true;
    this.pendingNavigation = null;
    this.replaceUrl(this.editorUrl());
    this.title.focus();
  }

  private dropEdits(): void {
    const target = this.pendingNavigation;
    this.discard.hidden = true;
    this.pendingNavigation = null;
    if (target === null) return;
    this.loaded = this.values();
    this.replaceUrl(target);
    this.openFromUrl({ focus: true });
  }
}

void new Console().start();
