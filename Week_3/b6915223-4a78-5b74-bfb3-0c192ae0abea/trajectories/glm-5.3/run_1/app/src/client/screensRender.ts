import { api, ApiError, type HistoryView, type TransferRow, type LedgerEntry } from './api';
import { announceOnce, pendingButton, focusTrap } from './dialog';
import { formatMillions } from '../shared/format';
import { CHIP_NAMES, type ChipCode } from '../shared/domain';
import { RECEIPT_STORED, RECEIPT_PENDING } from './state';
import type { Screen } from './screens';

type SquadView = Awaited<ReturnType<typeof api.squad>>;

export async function renderLeaguesScreen(): Promise<void> {
  const heading = document.createElement('h1');
  heading.textContent = 'Leagues';
  document.querySelector('#root')?.appendChild(heading);

  const main = document.createElement('div');
  main.className = 'wide';

  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-label', 'League updates');

  const leagues = await api.leagues();
  const list = document.createElement('table');
  list.setAttribute('aria-label', 'My leagues');
  const thead = list.createTHead();
  const headRow = thead.insertRow();
  ['League', 'Rank', 'Members'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  const tbody = list.createTBody();
  for (const league of leagues.leagues) {
    const row = tbody.insertRow();
    const nameCell = row.insertCell();
    const link = document.createElement('a');
    link.href = `/leagues/${league.id}`;
    link.textContent = league.name;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void goto({ name: 'league', leagueId: league.id });
    });
    nameCell.appendChild(link);
    const rankCell = row.insertCell();
    rankCell.textContent = String(league.rank);
    const memberCell = row.insertCell();
    memberCell.textContent = String(league.members);
  }

  const createForm = document.createElement('form');
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'League name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.setAttribute('aria-label', 'League name');
  nameLabel.appendChild(nameInput);
  const createButton = document.createElement('button');
  createButton.type = 'submit';
  createButton.textContent = 'Create league';
  createForm.append(nameLabel, createButton);
  createForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void pendingButton(createButton, 'Creating…', async () => {
      try {
        const league = await api.createLeague(nameInput.value);
        announceOnce(status, `League created. Share code ${league.code}.`);
        await rerender();
      } catch (error) {
        if (error instanceof ApiError) announceOnce(status, error.body.message ?? 'League could not be created.');
      }
    });
  });

  const joinForm = document.createElement('form');
  const codeLabel = document.createElement('label');
  codeLabel.textContent = 'Join code';
  const codeInput = document.createElement('input');
  codeInput.type = 'text';
  codeInput.setAttribute('aria-label', 'Join code');
  codeLabel.appendChild(codeInput);
  const joinButton = document.createElement('button');
  joinButton.type = 'submit';
  joinButton.textContent = 'Join league';
  joinForm.append(codeLabel, joinButton);
  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void pendingButton(joinButton, 'Joining…', async () => {
      try {
        const league = await api.joinLeague(codeInput.value);
        announceOnce(status, `Joined ${league.name}.`);
        await rerender();
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 404) announceOnce(status, 'No league uses that code.');
          else if (error.status === 409) announceOnce(status, 'You are already in this league.');
          else announceOnce(status, error.body.message ?? 'Join failed.');
        }
      }
    });
  });

  main.append(list, status, createForm, joinForm);
  document.querySelector('#root')?.appendChild(main);
}

export async function renderLeagueScreen(leagueId: string): Promise<void> {
  const heading = document.createElement('h1');
  document.querySelector('#root')?.appendChild(heading);
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-label', 'League updates');

  const league = await api.league(leagueId);
  heading.textContent = league.name;

  const main = document.createElement('div');
  main.className = 'wide';

  const table = document.createElement('table');
  table.setAttribute('aria-label', 'Standings');
  const thead = table.createTHead();
  const headRow = thead.insertRow();
  ['Rank', 'Team', 'GW', 'Total'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  const tbody = table.createTBody();
  const me = (await api.me()).id;
  for (const standing of league.standings) {
    const row = tbody.insertRow();
    row.dataset.managerId = standing.manager_id;
    row.dataset.rank = String(standing.rank);
    row.dataset.points = String(standing.season_total);
    if (standing.manager_id === me) row.classList.add('is-me');
    const rankCell = row.insertCell();
    rankCell.textContent = String(standing.rank);
    if (standing.last_rank !== null && standing.last_rank !== standing.rank) {
      const diff = standing.last_rank - standing.rank;
      const arrow = document.createElement('span');
      arrow.className = diff > 0 ? 'rank-arrow up' : 'rank-arrow down';
      arrow.setAttribute('role', 'img');
      arrow.setAttribute('aria-label', diff > 0 ? `Up ${diff}` : `Down ${-diff}`);
      arrow.textContent = diff > 0 ? '▲' : '▼';
      rankCell.appendChild(arrow);
    }
    const teamCell = row.insertCell();
    const link = document.createElement('a');
    link.href = `/leagues/${leagueId}/members/${standing.manager_id}`;
    link.textContent = standing.team_name;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void goto({ name: 'memberHistory', leagueId, managerId: standing.manager_id });
    });
    teamCell.appendChild(link);
    row.insertCell().textContent = String(standing.gameweek_points);
    row.insertCell().textContent = String(standing.season_total);
  }

  if (league.code !== null) {
    const codeRow = document.createElement('div');
    codeRow.className = 'join-code';
    const codeText = document.createElement('span');
    codeText.className = 'mono';
    codeText.textContent = league.code;
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'Copy join code';
    copyButton.addEventListener('click', () => {
      void navigator.clipboard.writeText(league.code ?? '').then(() => {
        announceOnce(status, `Join code ${league.code} copied.`);
      });
    });
    const newCodeButton = document.createElement('button');
    newCodeButton.type = 'button';
    newCodeButton.textContent = 'New join code';
    newCodeButton.addEventListener('click', () => {
      void pendingButton(newCodeButton, 'Replacing…', async () => {
        const result = await api.newCode(leagueId);
        announceOnce(status, `New join code ${result.code}. The old code no longer works.`);
        await rerender();
      });
    });
    codeRow.append(codeText, copyButton, newCodeButton);
    main.appendChild(codeRow);
  }

  main.append(table, status);
  document.querySelector('#root')?.appendChild(main);
}

export async function renderMemberHistory(leagueId: string, managerId: string): Promise<void> {
  const history = await api.memberHistory(leagueId, managerId);
  const heading = document.createElement('h1');
  heading.textContent = history.team_name;
  document.querySelector('#root')?.appendChild(heading);
  const main = document.createElement('div');
  main.className = 'wide';
  main.appendChild(historyTable(history));
  document.querySelector('#root')?.appendChild(main);
}

export async function renderHistoryScreen(): Promise<void> {
  const heading = document.createElement('h1');
  heading.textContent = 'History';
  document.querySelector('#root')?.appendChild(heading);

  const main = document.createElement('div');
  main.className = 'wide';
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-label', 'History updates');

  const history = await api.history();
  const transfers = await api.transfersHistory();
  const ledger = await api.ledger();

  main.appendChild(historyTable(history));

  const transfersTable = document.createElement('table');
  transfersTable.setAttribute('aria-label', 'Transfers');
  const thead = transfersTable.createTHead();
  const headRow = thead.insertRow();
  ['Gameweek', 'Out', 'In', 'Price'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  const transfersBody = transfersTable.createTBody();
  for (const transfer of transfers.transfers) {
    const row = transfersBody.insertRow();
    row.insertCell().textContent = String(transfer.gameweek);
    row.insertCell().textContent = transfer.out.name;
    row.insertCell().textContent = transfer.in.name;
    row.insertCell().textContent = `${formatMillions(transfer.in.price_tenths)}m`;
  }

  const ledgerTable = document.createElement('table');
  ledgerTable.setAttribute('aria-label', 'Bank ledger');
  const ledgerHead = ledgerTable.createTHead();
  const ledgerHeadRow = ledgerHead.insertRow();
  ['Kind', 'Player', 'Amount', 'Gameweek'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    ledgerHeadRow.appendChild(th);
  });
  const ledgerBody = ledgerTable.createTBody();
  for (const entry of ledger.entries) {
    ledgerBody.appendChild(ledgerRow(entry));
  }
  const balanceRow = ledgerBody.insertRow();
  balanceRow.className = 'balance-row';
  const balanceLabel = balanceRow.insertCell();
  balanceLabel.textContent = 'Balance';
  const balanceValue = balanceRow.insertCell();
  balanceValue.textContent = `${formatMillions(ledger.bank_tenths)}m`;
  balanceValue.colSpan = 3;

  const reconciliation = document.createElement('p');
  reconciliation.className = 'reconciliation';
  reconciliation.textContent = `Bank ${formatMillions(ledger.bank_tenths)}m · Squad selling value ${formatMillions(ledger.squad_selling_value_tenths)}m · Ledger balance ${formatMillions(ledger.bank_tenths)}m`;

  main.append(transfersTable, ledgerTable, reconciliation, status);
  document.querySelector('#root')?.appendChild(main);
}

function historyTable(history: HistoryView): HTMLTableElement {
  const table = document.createElement('table');
  table.setAttribute('aria-label', 'Gameweek history');
  const thead = table.createTHead();
  const headRow = thead.insertRow();
  ['Gameweek', 'Points', 'Hit', 'Net', 'Total', 'Chip', 'Captain', 'Receipt'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  const tbody = table.createTBody();
  for (const row of history.rows) {
    const tr = tbody.insertRow();
    tr.insertCell().textContent = String(row.gameweek);
    tr.insertCell().textContent = String(row.points);
    tr.insertCell().textContent = String(row.hit_points);
    tr.insertCell().textContent = String(row.net_points);
    tr.insertCell().textContent = row.running_total === null ? '—' : String(row.running_total);
    tr.insertCell().textContent = row.chip === null ? '—' : CHIP_NAMES[row.chip as ChipCode];
    tr.insertCell().textContent = row.captain ?? '—';
    const receiptCell = tr.insertCell();
    if (row.receipt === 'stored') {
      receiptCell.textContent = RECEIPT_STORED;
      const link = document.createElement('a');
      link.href = `/api/history/${row.gameweek}/snapshot`;
      link.textContent = `Download gameweek ${row.gameweek} snapshot`;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        void downloadSnapshot(row.gameweek, receiptCell);
      });
      receiptCell.appendChild(link);
    } else {
      receiptCell.textContent = RECEIPT_PENDING;
    }
  }
  return table;
}

async function downloadSnapshot(gameweek: number, anchor: HTMLElement): Promise<void> {
  const status = anchor.closest('.wide')?.querySelector<HTMLElement>('[role="status"]') ?? null;
  try {
    const response = await fetch(`/api/history/${gameweek}/snapshot`, { credentials: 'same-origin' });
    if (!response.ok) {
      const body = (await response.json()) as { error: string };
      if (status !== null) {
        if (body.error === 'receipt_pending') announceOnce(status, 'The receipt is still pending. Try again when it shows as stored.');
        else announceOnce(status, 'Storage is unreachable. Try the download again in a minute.');
      }
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `elevens-gw${String(gameweek).padStart(2, '0')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  } catch {
    if (status !== null) announceOnce(status, 'Storage is unreachable. Try the download again in a minute.');
  }
}

function ledgerRow(entry: LedgerEntry): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.insertCell().textContent = entry.kind.replace('_', ' ');
  row.insertCell().textContent = entry.player_id ?? '—';
  row.insertCell().textContent = `${formatMillions(entry.amount_tenths)}m`;
  row.insertCell().textContent = String(entry.gameweek);
  return row;
}

export async function renderOperatorShell(screen: Screen): Promise<void> {
  const heading = document.createElement('h1');
  heading.textContent = 'Operator console';
  document.querySelector('#root')?.appendChild(heading);

  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-label', 'Operator updates');

  const main = document.createElement('div');
  main.className = 'wide';

  const current = await api.currentGameweek();
  const gameweek = current.number;

  const fixturesSection = document.createElement('section');
  const fixturesHeading = document.createElement('h2');
  fixturesHeading.textContent = 'Fixtures';
  fixturesSection.appendChild(fixturesHeading);
  const clubs = await api.clubs();
  const clubOptions = clubs.clubs.map((club) => club.code);
  const fixtureRows: { home: HTMLSelectElement; away: HTMLSelectElement; kickoff: HTMLInputElement }[] = [];
  const fixturesForm = document.createElement('form');
  for (let i = 1; i <= 5; i += 1) {
    const row = document.createElement('div');
    row.className = 'fixture-row';
    const home = document.createElement('select');
    home.setAttribute('aria-label', `Home team ${i}`);
    for (const code of clubOptions) {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = code;
      home.appendChild(option);
    }
    const away = document.createElement('select');
    away.setAttribute('aria-label', `Away team ${i}`);
    for (const code of clubOptions) {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = code;
      away.appendChild(option);
    }
    const kickoff = document.createElement('input');
    kickoff.type = 'datetime-local';
    kickoff.setAttribute('aria-label', `Kickoff ${i}`);
    row.append(home, away, kickoff);
    fixturesForm.appendChild(row);
    fixtureRows.push({ home, away, kickoff });
  }
  const publishButton = document.createElement('button');
  publishButton.type = 'submit';
  publishButton.textContent = 'Publish fixtures';
  fixturesForm.appendChild(publishButton);
  fixturesForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void pendingButton(publishButton, 'Publishing…', async () => {
      const fixtures = fixtureRows.map((row) => ({
        home: row.home.value,
        away: row.away.value,
        kickoff: new Date(row.kickoff.value).toISOString(),
      }));
      try {
        const result = await api.publishFixtures(gameweek, fixtures);
        announceOnce(status, `Fixtures published. Deadline ${result.deadline_local ?? 'not set'}.`);
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 422 && error.body.fields !== undefined) {
            announceOnce(status, Object.values(error.body.fields)[0] ?? 'Fixtures could not be published.');
          } else {
            announceOnce(status, error.body.message ?? 'Fixtures could not be published.');
          }
        }
      }
    });
  });
  fixturesSection.appendChild(fixturesForm);
  main.appendChild(fixturesSection);

  const eventsSection = document.createElement('section');
  const eventsHeading = document.createElement('h2');
  eventsHeading.textContent = 'Match events';
  eventsSection.appendChild(eventsHeading);
  const fixtureSelect = document.createElement('select');
  fixtureSelect.setAttribute('aria-label', 'Fixture');
  current.fixtures.forEach((fixture) => {
    const option = document.createElement('option');
    option.value = fixture.id;
    option.textContent = `${fixture.home} v ${fixture.away}`;
    fixtureSelect.appendChild(option);
  });
  const playerSelect = document.createElement('select');
  playerSelect.setAttribute('aria-label', 'Player');
  const players = (await api.players('?sort=price_desc')).players;
  players.forEach((player) => {
    const option = document.createElement('option');
    option.value = player.id;
    option.textContent = `${player.name} (${player.club})`;
    playerSelect.appendChild(option);
  });
  const eventSelect = document.createElement('select');
  eventSelect.setAttribute('aria-label', 'Event');
  ['minutes', 'goal', 'assist', 'clean_sheet', 'yellow_card', 'red_card', 'own_goal', 'bonus'].forEach((type) => {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type.replace('_', ' ');
    eventSelect.appendChild(option);
  });
  const valueInput = document.createElement('input');
  valueInput.type = 'number';
  valueInput.setAttribute('aria-label', 'Value');
  const recordButton = document.createElement('button');
  recordButton.type = 'button';
  recordButton.textContent = 'Record event';
  const eventIdInput = document.createElement('input');
  eventIdInput.type = 'text';
  eventIdInput.setAttribute('aria-label', 'Event id');
  eventIdInput.value = `evt-${Date.now()}`;
  recordButton.addEventListener('click', () => {
    void pendingButton(recordButton, 'Recording…', async () => {
      const body: { event_id: string; fixture_id: string; player_id: string; type: string; value?: number } = {
        event_id: eventIdInput.value,
        fixture_id: fixtureSelect.value,
        player_id: playerSelect.value,
        type: eventSelect.value,
      };
      if (eventSelect.value === 'minutes' || eventSelect.value === 'bonus') body.value = Number(valueInput.value);
      try {
        await api.recordEvent(body);
        announceOnce(status, 'Event recorded.');
        await rerender();
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 409 && error.body.error === 'event_id_conflict') {
            announceOnce(status, 'That event id was already used for a different event.');
          } else if (error.body.error === 'idempotent_replay') {
            announceOnce(status, 'Already recorded, not counted again.');
          } else {
            announceOnce(status, error.body.message ?? 'Event could not be recorded.');
          }
        }
      }
    });
  });
  eventsSection.append(fixtureSelect, playerSelect, eventSelect, valueInput, eventIdInput, recordButton);

  const eventLog = document.createElement('ul');
  eventLog.setAttribute('role', 'list');
  eventLog.setAttribute('aria-label', 'Event log');
  try {
    const events = await api.events(gameweek);
    for (const event of events.events) {
      const item = document.createElement('li');
      const label = `${event.event_id}: ${event.type} ${event.value ?? ''} ${event.points_delta >= 0 ? '+' : ''}${event.points_delta}`;
      item.textContent = label;
      if (!event.voided) {
        const voidButton = document.createElement('button');
        voidButton.type = 'button';
        voidButton.textContent = 'Void';
        voidButton.addEventListener('click', () => {
          void pendingButton(voidButton, 'Voiding…', async () => {
            try {
              await api.voidEvent(event.event_id);
              announceOnce(status, 'Event voided.');
              await rerender();
            } catch (error) {
              if (error instanceof ApiError) announceOnce(status, error.body.message ?? 'Event could not be voided.');
            }
          });
        });
        item.appendChild(voidButton);
      } else {
        item.classList.add('is-voided');
      }
      eventLog.appendChild(item);
    }
  } catch {
    // gameweek may not be live
  }
  eventsSection.appendChild(eventLog);
  main.appendChild(eventsSection);

  const gameweekSection = document.createElement('section');
  const gameweekHeading = document.createElement('h2');
  gameweekHeading.textContent = 'Gameweek';
  gameweekSection.appendChild(gameweekHeading);
  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.textContent = 'Start gameweek';
  startButton.addEventListener('click', () => {
    void pendingButton(startButton, 'Starting…', async () => {
      try {
        const result = await api.startGameweek(gameweek);
        announceOnce(status, `Gameweek ${result.number} is live.`);
        await rerender();
      } catch (error) {
        if (error instanceof ApiError) announceOnce(status, error.body.message ?? 'Could not start.');
      }
    });
  });
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close gameweek';
  closeButton.addEventListener('click', () => {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Close gameweek');
    const title = document.createElement('h2');
    title.textContent = `Close gameweek ${gameweek}`;
    const confirmClose = document.createElement('button');
    confirmClose.type = 'button';
    confirmClose.textContent = 'Close gameweek';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    dialog.append(title, cancel, confirmClose);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    const closeDialog = (): void => backdrop.remove();
    cancel.addEventListener('click', closeDialog);
    confirmClose.addEventListener('click', () => {
      void pendingButton(confirmClose, 'Closing…', async () => {
        try {
          const result = await api.closeGameweek(gameweek);
          announceOnce(status, `Gameweek ${result.number} closed. Final scores are in.`);
          closeDialog();
          await rerender();
        } catch (error) {
          if (error instanceof ApiError) announceOnce(status, error.body.message ?? 'Could not close.');
          closeDialog();
        }
      });
    });
    focusTrap({ dialog, onClose: closeDialog, initialFocus: cancel, returnFocus: closeButton });
  });
  gameweekSection.append(startButton, closeButton);
  main.appendChild(gameweekSection);

  const pricesSection = document.createElement('section');
  const pricesHeading = document.createElement('h2');
  pricesHeading.textContent = 'Prices';
  pricesSection.appendChild(pricesHeading);
  const runDate = document.createElement('input');
  runDate.type = 'date';
  runDate.setAttribute('aria-label', 'Run date');
  runDate.value = new Date().toISOString().slice(0, 10);
  const movePlayer = document.createElement('select');
  movePlayer.setAttribute('aria-label', 'Move player');
  players.forEach((player) => {
    const option = document.createElement('option');
    option.value = player.id;
    option.textContent = `${player.name} (${player.club})`;
    movePlayer.appendChild(option);
  });
  const riseRadio = document.createElement('input');
  riseRadio.type = 'radio';
  riseRadio.name = 'direction';
  riseRadio.value = 'rise';
  riseRadio.checked = true;
  riseRadio.id = 'rise-radio';
  const riseLabel = document.createElement('label');
  riseLabel.htmlFor = 'rise-radio';
  riseLabel.textContent = 'Rise';
  riseLabel.appendChild(riseRadio);
  const fallRadio = document.createElement('input');
  fallRadio.type = 'radio';
  fallRadio.name = 'direction';
  fallRadio.value = 'fall';
  fallRadio.id = 'fall-radio';
  const fallLabel = document.createElement('label');
  fallLabel.htmlFor = 'fall-radio';
  fallLabel.textContent = 'Fall';
  fallLabel.appendChild(fallRadio);
  const movesList = document.createElement('ul');
  movesList.setAttribute('role', 'list');
  movesList.setAttribute('aria-label', 'Moves');
  const moves: { player_id: string; delta_tenths: number }[] = [];
  const addMove = document.createElement('button');
  addMove.type = 'button';
  addMove.textContent = 'Add move';
  addMove.addEventListener('click', () => {
    const delta = riseRadio.checked ? 1 : -1;
    const entry = { player_id: movePlayer.value, delta_tenths: delta };
    moves.push(entry);
    const item = document.createElement('li');
    item.textContent = `${movePlayer.options[movePlayer.selectedIndex]?.textContent ?? movePlayer.value} ${delta > 0 ? 'rise' : 'fall'}`;
    movesList.appendChild(item);
  });
  const runButton = document.createElement('button');
  runButton.type = 'button';
  runButton.textContent = 'Run price change';
  runButton.addEventListener('click', () => {
    void pendingButton(runButton, 'Running…', async () => {
      try {
        const result = await api.priceRun({ run_date: runDate.value, moves });
        announceOnce(status, `Price change applied: ${result.applied.length} moved, ${result.skipped.length} held at the cap.`);
        await rerender();
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.body.error === 'run_date_used') announceOnce(status, `A price change already ran for ${runDate.value}.`);
          else if (error.body.error === 'prices_frozen') announceOnce(status, 'Prices are frozen until the gameweek closes.');
          else announceOnce(status, error.body.message ?? 'Price change failed.');
        }
      }
    });
  });
  pricesSection.append(runDate, movePlayer, riseLabel, fallLabel, addMove, movesList, runButton);
  main.appendChild(pricesSection);

  main.appendChild(status);
  document.querySelector('#root')?.appendChild(main);
  void screen;
}

async function goto(screen: Screen): Promise<void> {
  const app = (await import('./app')) as { navigateScreen(screen: Screen): Promise<void> };
  await app.navigateScreen(screen);
}

async function rerender(): Promise<void> {
  const app = (await import('./app')) as { rerender(): Promise<void> };
  await app.rerender();
}

export function operatorPlaceholder(): void {
  void 0;
}
