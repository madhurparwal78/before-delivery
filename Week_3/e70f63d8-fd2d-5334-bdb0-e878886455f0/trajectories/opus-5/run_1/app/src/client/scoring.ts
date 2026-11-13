import { wicketAllowed } from '../shared/laws.js';
import { MSG, runsPart } from '../shared/messages.js';
import type { DeliveryItem, Extra, MatchState, ScorerState, WicketKind } from '../shared/types.js';
import { alertNow, api, bootstrap, errorOf, find, make, must, openSocket } from './dom.js';
import { StateView, announcementFor } from './stateview.js';

interface TeamBoot {
  id: string;
  name: string;
  logo_url: string | null;
  players: { id: string; name: string; short_name: string }[];
}

interface ScoringBoot {
  match_id: string;
  state: ScorerState;
  teams: TeamBoot[];
  config: { live_delay_ms: number; tick_ms: number; tick_stagger_ms: number };
}

const EXTRA_KEYS: Record<string, Extra> = { d: 'wide', n: 'no-ball', b: 'bye', l: 'leg-bye' };
const KINDS: WicketKind[] = ['bowled', 'caught', 'lbw', 'stumped', 'hit-wicket', 'run-out'];

export function startScoring(): void {
  const boot = bootstrap<ScoringBoot>();
  let state: MatchState = boot.state;
  let pen: string | null = null;
  let holder: string | null = null;
  let armed: Extra | null = null;
  let busy = 0;
  let chain: Promise<void> = Promise.resolve();
  let returnFocus: HTMLElement | null = null;
  let changing: DeliveryItem | null = null;
  let changeChoice: { extra: Extra; runs: number } = { extra: 'none', runs: 0 };
  let changeArmed: Extra | null = null;

  const teamById = (id: string): TeamBoot | undefined => boot.teams.find((team) => team.id === id);
  const view = new StateView({
    scoring: true,
    tick: boot.config,
    logoFor: (teamId) => teamById(teamId)?.logo_url ?? null,
    onChange: (item) => openChange(item),
  });

  const pad = must('#pad');
  const padKeys = (): HTMLButtonElement[] => [...pad.querySelectorAll<HTMLButtonElement>('button')];
  const retireButton = must<HTMLButtonElement>('#retire-button');
  const penNotice = must('#pen-notice');
  const liveStatus = must('#live-status');
  const inningsActions = must('#innings-actions');

  const wicketDialog = must<HTMLDialogElement>('#wicket-dialog');
  const bowlerDialog = must<HTMLDialogElement>('#bowler-dialog');
  const retireDialog = must<HTMLDialogElement>('#retire-dialog');
  const inningsDialog = must<HTMLDialogElement>('#innings-dialog');
  const changeDialog = must<HTMLDialogElement>('#change-dialog');
  const dialogs = [wicketDialog, bowlerDialog, retireDialog, inningsDialog, changeDialog];

  const openDialog = (): HTMLDialogElement | null => dialogs.find((dialog) => dialog.open) ?? null;

  function openModal(dialog: HTMLDialogElement, focus: HTMLElement | null): void {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    focus?.focus();
  }

  function closeModal(dialog: HTMLDialogElement): void {
    dialog.close();
  }

  for (const dialog of dialogs) {
    dialog.addEventListener('close', () => {
      const target = returnFocus && returnFocus.isConnected ? returnFocus : padKeys()[0];
      target?.focus();
      returnFocus = null;
    });
  }

  function setBusy(delta: number): void {
    busy += delta;
    if (busy > 0) pad.setAttribute('aria-busy', 'true');
    else pad.removeAttribute('aria-busy');
  }

  function scoringLocked(): boolean {
    return (
      state.match.status === 'innings_break' ||
      state.match.status === 'super_over_break' ||
      state.match.status === 'result' ||
      state.match.status === 'tied'
    );
  }

  function paint(): void {
    const held = pen !== null;
    for (const key of padKeys()) {
      const action = key.dataset.action ?? '';
      const isUndo = action === 'undo';
      key.disabled = !held || (scoringLocked() && !isUndo);
      if (action.startsWith('extra:')) {
        const extra = action.slice('extra:'.length) as Extra;
        const isArmed = armed === extra;
        key.setAttribute('aria-pressed', String(isArmed));
        key.classList.toggle('armed', isArmed);
        const existing = key.querySelector('.armed-text');
        if (isArmed && !existing) {
          key.append(make('span', { class: 'armed-text', 'aria-hidden': 'true' }, 'armed'));
        } else if (!isArmed && existing) {
          existing.remove();
        }
      }
    }
    retireButton.disabled = !held || scoringLocked();
    for (const button of document.querySelectorAll<HTMLButtonElement>('.change-button')) {
      button.disabled = !held;
    }

    penNotice.textContent = held ? '' : holder ? MSG.penHeld(holder) : MSG.penFree;
    const takeButton = find<HTMLButtonElement>('#take-pen');
    if (!held && holder === null) {
      if (!takeButton) {
        const button = make('button', { type: 'button', id: 'take-pen' }, 'Take the pen');
        button.addEventListener('click', () => {
          socket?.send(JSON.stringify({ type: 'take-pen', match: boot.match_id }));
        });
        penNotice.after(button);
      }
    } else if (takeButton) {
      takeButton.remove();
    }

    inningsActions.textContent = '';
    const label =
      state.match.status === 'ready'
        ? 'Start first innings'
        : state.match.status === 'innings_break'
          ? 'Start second innings'
          : state.match.status === 'super_over_break'
            ? 'Start super over'
            : null;
    if (label && held) {
      const button = make('button', { type: 'button', id: 'start-innings-button' }, label);
      button.addEventListener('click', () => openInnings());
      inningsActions.append(button);
    }
  }

  function apply(next: MatchState, direction: 'up' | 'down', announcement: string | null): void {
    state = next;
    view.show(next, { direction, announce: announcement });
    armed = null;
    paint();
    if (pen && state.next_bowler_needed && !scoringLocked()) openBowler();
  }

  function handleAnswer(
    answer: { status: number; body: unknown; failed: boolean },
    direction: 'up' | 'down',
    announcement: (next: MatchState) => string | null,
    dialogError?: HTMLElement,
  ): boolean {
    if (answer.failed) {
      alertNow(MSG.notSaved);
      return false;
    }
    if (answer.status >= 200 && answer.status < 300) {
      const next = answer.body as MatchState;
      apply(next, direction, announcement(next));
      return true;
    }
    const error = errorOf(answer.body);
    if (!error) {
      alertNow(MSG.serverError);
      return false;
    }
    if (error.code === 'STALE_DELIVERY') {
      alertNow(MSG.staleDelivery);
      void refresh();
      return false;
    }
    if (error.code === 'PEN_HELD') {
      pen = null;
      holder = error.holder ?? null;
      paint();
    }
    alertNow(error.message);
    if (dialogError) dialogError.textContent = error.message;
    return false;
  }

  async function refresh(): Promise<void> {
    const answer = await api<MatchState>(`/api/matches/${boot.match_id}/state`);
    if (answer.status === 200) apply(answer.body, 'up', null);
  }

  function enqueue(task: () => Promise<void>): void {
    chain = chain.then(task).catch(() => undefined);
  }

  function sendDelivery(payload: {
    extra: Extra;
    runs: number;
    wicket: {
      kind: WicketKind;
      fielder: string | null;
      batter_out: 'striker' | 'non-striker';
      new_batter: string | null;
    } | null;
  }, dialogError?: HTMLElement): void {
    enqueue(async () => {
      setBusy(1);
      const answer = await api<MatchState>(`/api/matches/${boot.match_id}/deliveries`, {
        method: 'POST',
        pen,
        body: { expected_seq: state.last_seq + 1, ...payload },
      });
      setBusy(-1);
      handleAnswer(answer, 'up', (next) => announcementFor(next), dialogError);
    });
  }

  function pressRuns(runs: number): void {
    if (pen === null || scoringLocked()) return;
    if (state.next_bowler_needed) {
      alertNow(MSG.needsBowler);
      openBowler();
      return;
    }
    const extra = armed ?? 'none';
    if ((extra === 'bye' || extra === 'leg-bye') && runs === 0) {
      alertNow(MSG.byesNeedRuns);
      return;
    }
    armed = null;
    paint();
    sendDelivery({ extra, runs, wicket: null });
  }

  function armExtra(extra: Extra): void {
    if (pen === null || scoringLocked()) return;
    if (state.next_bowler_needed) {
      alertNow(MSG.needsBowler);
      openBowler();
      return;
    }
    armed = armed === extra ? null : extra;
    paint();
  }

  function undo(): void {
    if (pen === null) return;
    const previous = state;
    enqueue(async () => {
      setBusy(1);
      const answer = await api<MatchState>(`/api/matches/${boot.match_id}/deliveries/last`, {
        method: 'DELETE',
        pen,
      });
      setBusy(-1);
      const newest = previous.commentary[0];
      const announcement =
        newest && newest.kind === 'retirement'
          ? MSG.undidRetirement(newest.line.replace(' retired hurt', ''))
          : MSG.undid(previous.last_seq);
      handleAnswer(answer, 'down', () => announcement);
    });
  }

  function fillSelect(
    select: HTMLSelectElement,
    options: { value: string; label: string; barred?: string }[],
  ): void {
    select.textContent = '';
    for (const option of options) {
      const element = make('option', { value: option.value }, option.label);
      if (option.barred) element.setAttribute('data-barred', option.barred);
      select.append(element);
    }
  }

  function openBowler(): void {
    if (bowlerDialog.open) return;
    const select = must<HTMLSelectElement>('#next-bowler');
    const bowling = state.bowling_team ? teamById(state.bowling_team.id) : undefined;
    fillSelect(
      select,
      (bowling?.players ?? []).map((player) => ({
        value: player.id,
        label: player.short_name,
        barred: state.barred_bowlers.find((barred) => barred.player === player.id)?.reason ?? 'none',
      })),
    );
    must('#bowler-error').textContent = '';
    openModal(bowlerDialog, select);
  }

  must('#start-over').addEventListener('click', () => {
    const select = must<HTMLSelectElement>('#next-bowler');
    const button = must<HTMLButtonElement>('#start-over');
    button.disabled = true;
    enqueue(async () => {
      const answer = await api<MatchState>(`/api/matches/${boot.match_id}/overs`, {
        method: 'POST',
        pen,
        body: { bowler: select.value },
      });
      button.disabled = false;
      if (handleAnswer(answer, 'up', () => null, must('#bowler-error'))) closeModal(bowlerDialog);
    });
  });

  function nextBatting(): { id: string; name: string } | null {
    if (!state.innings) return state.batting_team;
    return state.innings === '1' || state.innings.endsWith('-1')
      ? state.bowling_team
      : state.batting_team;
  }

  function openInnings(): void {
    const batting = nextBatting();
    const bowlingId =
      batting && boot.teams.find((team) => team.id !== batting.id)
        ? boot.teams.find((team) => team.id !== batting.id)!.id
        : null;
    const battingTeam = batting ? teamById(batting.id) : undefined;
    const bowlingTeam = bowlingId ? teamById(bowlingId) : undefined;
    const striker = must<HTMLSelectElement>('#striker');
    const nonStriker = must<HTMLSelectElement>('#non-striker');
    const bowler = must<HTMLSelectElement>('#innings-bowler');
    const batters = (battingTeam?.players ?? []).map((player) => ({
      value: player.id,
      label: player.short_name,
    }));
    fillSelect(striker, batters);
    fillSelect(nonStriker, batters);
    if (batters.length > 1) nonStriker.value = batters[1].value;
    fillSelect(
      bowler,
      (bowlingTeam?.players ?? []).map((player) => ({
        value: player.id,
        label: player.short_name,
        barred: state.barred_bowlers.find((barred) => barred.player === player.id)?.reason ?? 'none',
      })),
    );
    must('#innings-error').textContent = '';
    openModal(inningsDialog, striker);
  }

  must('#start-innings').addEventListener('click', () => {
    const button = must<HTMLButtonElement>('#start-innings');
    button.disabled = true;
    enqueue(async () => {
      const answer = await api<MatchState>(`/api/matches/${boot.match_id}/innings`, {
        method: 'POST',
        pen,
        body: {
          striker: must<HTMLSelectElement>('#striker').value,
          non_striker: must<HTMLSelectElement>('#non-striker').value,
          bowler: must<HTMLSelectElement>('#innings-bowler').value,
        },
      });
      button.disabled = false;
      if (handleAnswer(answer, 'up', () => null, must('#innings-error'))) closeModal(inningsDialog);
    });
  });

  function wicketKind(): WicketKind {
    const checked = wicketDialog.querySelector<HTMLInputElement>('input[name="how-out"]:checked');
    return (checked?.value ?? 'bowled') as WicketKind;
  }

  function paintWicketFields(): void {
    const kind = wicketKind();
    const needsFielder = kind === 'caught' || kind === 'stumped' || kind === 'run-out';
    must('#fielder-field').hidden = !needsFielder;
    must('#batter-out-field').hidden = kind !== 'run-out';
    must('#runs-completed-field').hidden = kind !== 'run-out';
    must('#new-batter-field').hidden = state.yet_to_bat.length === 0;
  }

  function openWicket(): void {
    if (pen === null || scoringLocked()) return;
    if (state.next_bowler_needed) {
      alertNow(MSG.needsBowler);
      openBowler();
      return;
    }
    const extra = armed ?? 'none';
    for (const kind of KINDS) {
      const radio = must<HTMLInputElement>(`#how-out-${kind}`);
      radio.disabled = !wicketAllowed(kind, extra, state.free_hit);
      radio.checked = false;
    }
    must('#wicket-note').textContent = state.free_hit ? MSG.freeHitWicket : '';
    const fielder = must<HTMLSelectElement>('#fielder');
    const bowling = state.bowling_team ? teamById(state.bowling_team.id) : undefined;
    fillSelect(
      fielder,
      (bowling?.players ?? []).map((player) => ({ value: player.id, label: player.short_name })),
    );
    const batterOut = must('#batter-out-options');
    batterOut.textContent = '';
    state.batters.forEach((batter, index) => {
      const id = `batter-out-${index}`;
      const wrapper = make('p', { class: 'check' });
      const radio = make('input', {
        type: 'radio',
        name: 'batter-out',
        id,
        value: batter.on_strike ? 'striker' : 'non-striker',
      }) as HTMLInputElement;
      if (batter.on_strike) radio.checked = true;
      wrapper.append(radio, make('label', { for: id }, batter.short_name));
      batterOut.append(wrapper);
    });
    fillSelect(
      must<HTMLSelectElement>('#new-batter'),
      state.yet_to_bat.map((player) => ({
        value: player.player,
        label: player.retired_hurt ? `${player.short_name} (retired hurt)` : player.short_name,
      })),
    );
    must('#wicket-error').textContent = '';
    const firstEnabled = KINDS.map((kind) => must<HTMLInputElement>(`#how-out-${kind}`)).find(
      (radio) => !radio.disabled,
    );
    if (firstEnabled) firstEnabled.checked = true;
    paintWicketFields();
    openModal(wicketDialog, firstEnabled ?? null);
  }

  for (const kind of KINDS) {
    must(`#how-out-${kind}`).addEventListener('change', () => paintWicketFields());
  }

  must('#record-wicket').addEventListener('click', () => {
    const kind = wicketKind();
    const extra = armed ?? 'none';
    const runs = kind === 'run-out' ? Number(must<HTMLSelectElement>('#runs-completed').value) : 0;
    const batterOut =
      wicketDialog.querySelector<HTMLInputElement>('input[name="batter-out"]:checked')?.value ?? 'striker';
    const newBatterField = must('#new-batter-field');
    armed = null;
    paint();
    closeModal(wicketDialog);
    sendDelivery(
      {
        extra,
        runs,
        wicket: {
          kind,
          fielder: must<HTMLSelectElement>('#fielder').value,
          batter_out: batterOut === 'non-striker' ? 'non-striker' : 'striker',
          new_batter: newBatterField.hidden ? null : must<HTMLSelectElement>('#new-batter').value,
        },
      },
      must('#wicket-error'),
    );
  });

  function openRetire(): void {
    if (pen === null || scoringLocked()) return;
    const options = must('#retire-options');
    options.textContent = '';
    state.batters.forEach((batter, index) => {
      const id = `retire-batter-${index}`;
      const wrapper = make('p', { class: 'check' });
      const radio = make('input', {
        type: 'radio',
        name: 'retire-batter',
        id,
        value: batter.player,
      }) as HTMLInputElement;
      if (index === 0) radio.checked = true;
      wrapper.append(radio, make('label', { for: id }, batter.short_name));
      options.append(wrapper);
    });
    fillSelect(
      must<HTMLSelectElement>('#retire-new-batter'),
      state.yet_to_bat.map((player) => ({
        value: player.player,
        label: player.retired_hurt ? `${player.short_name} (retired hurt)` : player.short_name,
      })),
    );
    must('#retire-error').textContent = '';
    const first = options.querySelector<HTMLInputElement>('input');
    openModal(retireDialog, first ?? null);
  }

  must('#retire-confirm').addEventListener('click', () => {
    const batter = retireDialog.querySelector<HTMLInputElement>('input[name="retire-batter"]:checked')?.value;
    enqueue(async () => {
      const answer = await api<MatchState>(`/api/matches/${boot.match_id}/retirements`, {
        method: 'POST',
        pen,
        body: { batter, new_batter: must<HTMLSelectElement>('#retire-new-batter').value },
      });
      if (handleAnswer(answer, 'up', (next) => announcementFor(next), must('#retire-error'))) {
        closeModal(retireDialog);
      }
    });
  });

  function paintChange(): void {
    must('#change-preview').textContent = `New: ${runsPart(changeChoice.extra, changeChoice.runs)}`;
    for (const button of changeDialog.querySelectorAll<HTMLButtonElement>('#change-pad button')) {
      const action = button.dataset.change ?? '';
      const selected =
        action === `runs:${changeChoice.runs}` ||
        (changeChoice.extra !== 'none' && action === `extra:${changeChoice.extra}`);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  function openChange(item: DeliveryItem): void {
    if (pen === null) return;
    changing = item;
    changeArmed = null;
    changeChoice = { extra: item.extra, runs: item.runs };
    changeDialog.setAttribute('aria-label', `Change delivery ${item.seq}`);
    must('#change-title').textContent = `Change delivery ${item.seq}`;
    must('#change-error').textContent = '';
    paintChange();
    const target = changeDialog.querySelector<HTMLButtonElement>(
      `#change-pad button[data-change="runs:${changeChoice.runs}"]`,
    );
    openModal(changeDialog, target ?? null);
  }

  function pickChange(action: string): void {
    if (action.startsWith('runs:')) {
      changeChoice = { extra: changeArmed ?? 'none', runs: Number(action.slice('runs:'.length)) };
      return;
    }
    changeArmed = action.slice('extra:'.length) as Extra;
    changeChoice = {
      extra: changeArmed,
      runs: changeArmed === 'bye' || changeArmed === 'leg-bye' ? 1 : 0,
    };
  }

  for (const button of changeDialog.querySelectorAll<HTMLButtonElement>('#change-pad button')) {
    button.addEventListener('click', () => {
      pickChange(button.dataset.change ?? '');
      paintChange();
    });
  }

  must('#save-change').addEventListener('click', () => {
    if (!changing) return;
    const seq = changing.seq;
    const button = must<HTMLButtonElement>('#save-change');
    button.disabled = true;
    enqueue(async () => {
      const answer = await api<MatchState>(`/api/matches/${boot.match_id}/deliveries/${seq}`, {
        method: 'PUT',
        pen,
        body: { extra: changeChoice.extra, runs: changeChoice.runs },
      });
      button.disabled = false;
      if (handleAnswer(answer, 'down', () => MSG.changeSaved(seq), must('#change-error'))) {
        closeModal(changeDialog);
      }
    });
  });

  for (const key of padKeys()) {
    key.addEventListener('click', () => {
      const action = key.dataset.action ?? '';
      if (action.startsWith('runs:')) pressRuns(Number(action.slice('runs:'.length)));
      else if (action.startsWith('extra:')) armExtra(action.slice('extra:'.length) as Extra);
      else if (action === 'wicket') openWicket();
      else if (action === 'undo') undo();
    });
  }
  retireButton.addEventListener('click', () => openRetire());

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName ?? '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const key = event.key.toLowerCase();
    const dialog = openDialog();
    if (dialog) {
      if (dialog !== changeDialog) return;
      if (/^[0-6]$/.test(key)) {
        pickChange(`runs:${key}`);
        paintChange();
        event.preventDefault();
      } else if (EXTRA_KEYS[key]) {
        pickChange(`extra:${EXTRA_KEYS[key]}`);
        paintChange();
        event.preventDefault();
      }
      return;
    }
    if (event.key === 'Escape') {
      if (armed) {
        armed = null;
        paint();
      }
      return;
    }
    if (pen === null) return;
    if (/^[0-6]$/.test(key)) {
      pressRuns(Number(key));
      event.preventDefault();
      return;
    }
    if (EXTRA_KEYS[key]) {
      armExtra(EXTRA_KEYS[key]);
      event.preventDefault();
      return;
    }
    if (key === 'w') {
      openWicket();
      event.preventDefault();
      return;
    }
    if (key === 'u') {
      undo();
      event.preventDefault();
      return;
    }
    if (key === 'r') {
      openRetire();
      event.preventDefault();
    }
  });

  let socket: WebSocket | null = null;
  const connect = (): void => {
    socket = openSocket(
      (message) => {
        const payload = message as {
          type: string;
          pen?: string | null;
          holder?: string | null;
          state?: MatchState;
          event?: { kind: string; seq: number };
          status?: string;
        };
        if (payload.type === 'pen') {
          pen = payload.pen ?? null;
          holder = payload.holder ?? null;
          paint();
          if (pen && state.next_bowler_needed && !scoringLocked()) openBowler();
          return;
        }
        if (payload.type === 'live' && payload.status === 'paused') {
          liveStatus.textContent = MSG.liveOutageScoring;
          return;
        }
        if (payload.type === 'state' && payload.state && pen === null) {
          const kind = payload.event?.kind ?? 'delivery';
          const announcement =
            kind === 'change'
              ? MSG.changeSaved(payload.event?.seq ?? 0)
              : kind === 'undo'
                ? MSG.undid(payload.event?.seq ?? 0)
                : announcementFor(payload.state);
          state = payload.state;
          view.show(payload.state, {
            direction: kind === 'change' || kind === 'undo' ? 'down' : 'up',
            announce: announcement,
          });
          paint();
        }
      },
      (open) => {
        open.send(JSON.stringify({ type: 'score', match: boot.match_id }));
      },
    );
    socket.addEventListener('close', () => {
      socket = null;
      setTimeout(connect, 1000);
    });
  };

  view.show(state, {});
  paint();
  connect();
}
