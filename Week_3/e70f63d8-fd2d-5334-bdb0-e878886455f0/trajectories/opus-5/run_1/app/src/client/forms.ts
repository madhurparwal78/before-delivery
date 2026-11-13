import { MSG } from '../shared/messages.js';
import { alertNow, announce, api, bootstrap, errorOf, find, make, must } from './dom.js';

function showFields(fields: Record<string, string> | undefined): void {
  for (const element of document.querySelectorAll<HTMLElement>('.error')) element.textContent = '';
  if (!fields) return;
  for (const [name, message] of Object.entries(fields)) {
    const target = find(`#${name.replace(/[^a-zA-Z0-9_-]/g, '-')}-error`);
    if (target) target.textContent = message;
  }
  alertNow(MSG.fieldErrors);
}

export function startSignUp(): void {
  const form = must<HTMLFormElement>('#signup-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const button = must<HTMLButtonElement>('#signup-form button[type="submit"]');
    button.disabled = true;
    void (async () => {
      const answer = await api<{ user: unknown }>('/api/auth/signup', {
        method: 'POST',
        body: {
          email: must<HTMLInputElement>('#email').value,
          password: must<HTMLInputElement>('#password').value,
          display_name: must<HTMLInputElement>('#display_name').value,
        },
      });
      button.disabled = false;
      if (answer.status === 201) {
        location.assign('/matches');
        return;
      }
      showFields(errorOf(answer.body)?.fields);
    })();
  });
}

export function startSignIn(): void {
  const form = must<HTMLFormElement>('#signin-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const button = must<HTMLButtonElement>('#signin-form button[type="submit"]');
    button.disabled = true;
    void (async () => {
      const answer = await api<{ user: unknown }>('/api/auth/signin', {
        method: 'POST',
        body: {
          email: must<HTMLInputElement>('#email').value,
          password: must<HTMLInputElement>('#password').value,
        },
      });
      button.disabled = false;
      if (answer.status === 200) {
        location.assign('/matches');
        return;
      }
      const error = errorOf(answer.body);
      if (error?.code === 'VALIDATION') {
        showFields(error.fields);
        return;
      }
      must('#email-error').textContent = MSG.signInFailed;
      must('#password-error').textContent = MSG.signInFailed;
      alertNow(MSG.signInFailed);
    })();
  });
}

export function startFollow(): void {
  must<HTMLFormElement>('#follow-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const code = must<HTMLInputElement>('#viewer-code').value.trim();
    if (code.length > 0) location.assign(`/live/${encodeURIComponent(code)}`);
  });
}

export function startNewTeam(): void {
  const players: { name: string; short_name: string }[] = [];
  const fullName = must<HTMLInputElement>('#player-name');
  const shortName = must<HTMLInputElement>('#player-short');
  let shortEdited = false;
  shortName.addEventListener('input', () => {
    shortEdited = shortName.value.length > 0;
  });
  fullName.addEventListener('input', () => {
    if (shortEdited) return;
    const parts = fullName.value.trim().split(/\s+/);
    shortName.value = parts[parts.length - 1] ?? '';
  });

  const list = must('#player-list');
  must('#add-player').addEventListener('click', () => {
    const name = fullName.value.trim();
    if (name.length === 0) {
      must('#players-error').textContent = MSG.nameField;
      return;
    }
    const short = shortName.value.trim() || name.split(/\s+/).slice(-1)[0];
    if (players.some((player) => player.short_name === short)) {
      must('#players-error').textContent = MSG.shortNameClash;
      return;
    }
    players.push({ name, short_name: short });
    const item = make('li');
    item.append(make('span', { class: 'big-name' }, name), make('span', { class: 'facts' }, short));
    list.append(item);
    fullName.value = '';
    shortName.value = '';
    shortEdited = false;
    must('#players-error').textContent = '';
  });

  must<HTMLFormElement>('#team-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const answer = await api<{ id: string }>('/api/teams', {
        method: 'POST',
        body: { name: must<HTMLInputElement>('#team-name').value, players },
      });
      if (answer.status === 201) {
        location.assign(`/teams/${answer.body.id}`);
        return;
      }
      const error = errorOf(answer.body);
      if (error?.fields?.name) must('#name-error').textContent = error.fields.name;
      const playerIssue = Object.entries(error?.fields ?? {}).find(([key]) => key.startsWith('players['));
      if (playerIssue) must('#players-error').textContent = playerIssue[1];
      alertNow(MSG.fieldErrors);
    })();
  });
}

export function startTeam(): void {
  const boot = bootstrap<{ team_id: string; logo_max_bytes: number }>();
  const form = find<HTMLFormElement>('#logo-form');
  if (!form) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = must<HTMLInputElement>('#logo-input');
    const file = input.files?.[0];
    must('#logo-error').textContent = '';
    if (!file) {
      must('#logo-error').textContent = MSG.logoWrongType;
      return;
    }
    if (file.size > boot.logo_max_bytes) {
      must('#logo-error').textContent = MSG.logoTooLarge(boot.logo_max_bytes);
      return;
    }
    const button = must<HTMLButtonElement>('#logo-form button[type="submit"]');
    button.disabled = true;
    must('#logo-pending').textContent = MSG.logoUploading;
    void (async () => {
      const data = new FormData();
      data.append('logo', file);
      let status = 0;
      let body: unknown = null;
      try {
        const response = await fetch(`/api/teams/${boot.team_id}/logo`, { method: 'POST', body: data });
        status = response.status;
        body = await response.json().catch(() => null);
      } catch {
        status = 0;
      }
      button.disabled = false;
      must('#logo-pending').textContent = '';
      if (status === 201) {
        const url = (body as { logo_url: string }).logo_url;
        const slot = must('#team-logo');
        slot.textContent = '';
        const heading = must('h1').textContent ?? '';
        slot.append(make('img', { src: `${url}?v=${Date.now()}`, alt: `${heading} logo`, class: 'logo' }));
        announce(MSG.logoUploaded);
        return;
      }
      const error = errorOf(body);
      if (status === 503) {
        must('#logo-error').textContent = MSG.storageOutage;
        must('#logo-error').classList.add('band');
        alertNow(MSG.storageOutage);
        return;
      }
      must('#logo-error').textContent = error?.fields?.logo ?? MSG.serverError;
      alertNow(error?.message ?? MSG.serverError);
    })();
  });
}

export function startNewTournament(): void {
  const groups: { name: string; teams: string[] }[] = [];
  const list = must('#group-list');
  must('#add-group').addEventListener('click', () => {
    const name = must<HTMLInputElement>('#group-name').value.trim();
    const teams = [...document.querySelectorAll<HTMLInputElement>('input[data-team]')]
      .filter((box) => box.checked)
      .map((box) => box.dataset.team!);
    if (name.length === 0) {
      must('#name-error').textContent = MSG.nameField;
      return;
    }
    groups.push({ name, teams });
    const item = make('li');
    item.append(make('span', { class: 'big-name' }, name), make('span', { class: 'facts' }, String(teams.length)));
    list.append(item);
    must<HTMLInputElement>('#group-name').value = '';
    for (const box of document.querySelectorAll<HTMLInputElement>('input[data-team]')) box.checked = false;
  });

  must<HTMLFormElement>('#tournament-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const answer = await api<{ id: string }>('/api/tournaments', {
        method: 'POST',
        body: {
          name: must<HTMLInputElement>('#tournament-name').value,
          overs: Number(must<HTMLInputElement>('#overs').value),
          players_per_side: Number(must<HTMLInputElement>('#players_per_side').value),
          super_over: must<HTMLInputElement>('#super_over').checked,
          groups,
        },
      });
      if (answer.status === 201) {
        location.assign(`/tournaments/${answer.body.id}`);
        return;
      }
      showFields(errorOf(answer.body)?.fields);
    })();
  });
}

export function startNewMatch(): void {
  const tournament = must<HTMLSelectElement>('#tournament');
  const overs = must<HTMLInputElement>('#overs');
  const playersPerSide = must<HTMLInputElement>('#players_per_side');
  const superOver = must<HTMLInputElement>('#super_over');

  tournament.addEventListener('change', () => {
    void (async () => {
      if (tournament.value === '') {
        overs.disabled = false;
        playersPerSide.disabled = false;
        superOver.disabled = false;
        return;
      }
      const answer = await api<{ overs: number; players_per_side: number; super_over: boolean }>(
        `/api/tournaments/${tournament.value}`,
      );
      if (answer.status !== 200) return;
      overs.value = String(answer.body.overs);
      playersPerSide.value = String(answer.body.players_per_side);
      superOver.checked = answer.body.super_over;
      overs.disabled = true;
      playersPerSide.disabled = true;
      superOver.disabled = true;
    })();
  });

  must<HTMLFormElement>('#match-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const home = must<HTMLSelectElement>('#home').value;
      const away = must<HTMLSelectElement>('#away').value;
      const xi: Record<string, string[]> = { [home]: [], [away]: [] };
      for (const box of document.querySelectorAll<HTMLInputElement>('input[data-player]')) {
        if (!box.checked) continue;
        const team = box.dataset.team!;
        if (xi[team]) xi[team].push(box.dataset.player!);
      }
      const answer = await api<{ id: string }>('/api/matches', {
        method: 'POST',
        body: {
          home,
          away,
          overs: Number(overs.value),
          players_per_side: Number(playersPerSide.value),
          super_over: superOver.checked,
          batting_first: must<HTMLSelectElement>('#batting_first').value,
          tournament: tournament.value === '' ? null : tournament.value,
          xi,
        },
      });
      if (answer.status === 201) {
        location.assign(`/matches/${answer.body.id}`);
        return;
      }
      showFields(errorOf(answer.body)?.fields);
    })();
  });
}

export function startMatch(): void {
  const boot = bootstrap<{
    match_id: string;
    viewer_link: boolean;
    viewer_code: string | null;
    base_url: string;
  }>();
  const toggle = must<HTMLButtonElement>('#viewer-link');
  toggle.addEventListener('click', () => {
    const on = toggle.getAttribute('aria-checked') !== 'true';
    void (async () => {
      const answer = await api<{ viewer_link: boolean; viewer_code: string | null }>(
        `/api/matches/${boot.match_id}/viewer-link`,
        { method: 'PATCH', body: { on } },
      );
      if (answer.status !== 200) {
        alertNow(MSG.serverError);
        return;
      }
      toggle.setAttribute('aria-checked', String(answer.body.viewer_link));
      must('#viewer-url').textContent = answer.body.viewer_code
        ? `${boot.base_url}/live/${answer.body.viewer_code}`
        : '';
    })();
  });

  must<HTMLFormElement>('#invite-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const button = must<HTMLButtonElement>('#invite-form button[type="submit"]');
    const email = must<HTMLInputElement>('#scorer-email').value.trim();
    button.disabled = true;
    must('#email-error').textContent = '';
    void (async () => {
      const answer = await api<{ message: string }>(`/api/matches/${boot.match_id}/invitations`, {
        method: 'POST',
        body: { email },
      });
      button.disabled = false;
      if (answer.status === 202) {
        must('#invite-sent').textContent = answer.body.message;
        announce(answer.body.message);
        return;
      }
      const error = errorOf(answer.body);
      if (error?.code === 'VALIDATION') {
        must('#email-error').textContent = error.fields?.email ?? MSG.emailField;
        alertNow(MSG.fieldErrors);
        return;
      }
      alertNow(error?.message ?? MSG.serverError);
    })();
  });
}

export function startInvitation(): void {
  const boot = bootstrap<{ token: string; status: string }>();
  must('#accept-invitation').addEventListener('click', () => {
    const button = must<HTMLButtonElement>('#accept-invitation');
    button.disabled = true;
    void (async () => {
      const answer = await api<{ match_id: string }>(`/api/invitations/${boot.token}/accept`, {
        method: 'POST',
      });
      button.disabled = false;
      if (answer.status === 200) {
        location.assign(`/matches/${answer.body.match_id}/score`);
        return;
      }
      const error = errorOf(answer.body);
      must('#invitation-note').textContent = error?.message ?? MSG.serverError;
      alertNow(error?.message ?? MSG.serverError);
    })();
  });
}
