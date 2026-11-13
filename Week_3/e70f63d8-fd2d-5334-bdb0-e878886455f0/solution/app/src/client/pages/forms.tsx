import type { JSX } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';
import { copy } from '../../shared/copy.js';
import { defaultShortName } from '../../shared/rules.js';
import type { MatchDetail, TeamDetail, TeamListItem, TournamentDetail } from '../../shared/wire.js';
import { Band, Field, PageHeading } from '../components/ui.js';
import { failureOf as apiFailure, get, post } from '../lib/api.js';
import { raise } from '../lib/announce.js';
import { useLoad } from '../lib/load.js';
import { navigate } from '../lib/router.js';

interface Failure { message: string; fields: Record<string, string> }

const failureOf = (error: unknown): Failure => {
  const failure = apiFailure(error);
  return { message: failure.code === 'VALIDATION' ? copy.fieldErrors : failure.message, fields: failure.fields };
};

interface PendingPlayer { name: string; short_name: string }

export const NewTeam = (): JSX.Element => {
  const [name, setName] = useState('');
  const [players, setPlayers] = useState<PendingPlayer[]>([]);
  const [full, setFull] = useState('');
  const [short, setShort] = useState('');
  const [shortEdited, setShortEdited] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  const addPlayer = (): PendingPlayer[] => {
    if (full.trim() === '') return players;
    const next = [...players, { name: full.trim(), short_name: short.trim() }];
    setPlayers(next);
    setFull('');
    setShort('');
    setShortEdited(false);
    return next;
  };

  const create = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const team = await post<TeamDetail>('/api/teams', { name, players: addPlayer() });
      navigate(`/teams/${team.id}`);
    } catch (error) {
      const next = failureOf(error);
      setFailure(next);
      raise(next.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="form" onSubmit={create} noValidate>
      <PageHeading>New team</PageHeading>
      {failure ? <Band>{failure.message}</Band> : null}
      <Field label="Team name" error={failure?.fields['name']}>
        {(props) => <input {...props} type="text" value={name} onInput={(e) => setName(e.currentTarget.value)} />}
      </Field>
      <h2>Players</h2>
      <ol class="pending">
        {players.map((player, index) => (
          <li key={`${player.name}-${index}`}>
            {player.name} <span class="fact">{player.short_name || defaultShortName(player.name)}</span>
            {failure?.fields[`players[${index}].short_name`] ? <p class="band band-field">{failure.fields[`players[${index}].short_name`]}</p> : null}
            {failure?.fields[`players[${index}].name`] ? <p class="band band-field">{failure.fields[`players[${index}].name`]}</p> : null}
          </li>
        ))}
      </ol>
      <Field label="Player full name">
        {(props) => (
          <input {...props} type="text" value={full} onInput={(e) => {
            setFull(e.currentTarget.value);
            if (!shortEdited) setShort(defaultShortName(e.currentTarget.value));
          }} />
        )}
      </Field>
      <Field label="Player short name">
        {(props) => <input {...props} type="text" value={short} onInput={(e) => { setShort(e.currentTarget.value); setShortEdited(true); }} />}
      </Field>
      <button type="button" class="button" onClick={() => { addPlayer(); }}>Add player</button>
      <button type="submit" class="button" disabled={busy}>Create team</button>
    </form>
  );
};

interface PendingGroup { name: string; teams: TeamListItem[] }

export const NewTournament = (): JSX.Element => {
  const [teams] = useLoad<{ teams: TeamListItem[] }>('/api/teams');
  const [name, setName] = useState('');
  const [overs, setOvers] = useState('20');
  const [players, setPlayers] = useState('11');
  const [superOver, setSuperOver] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [groups, setGroups] = useState<PendingGroup[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const available = teams.status === 'ready' ? teams.data.teams : [];

  const addGroup = (): void => {
    if (groupName.trim() === '' || picked.length === 0) return;
    setGroups([...groups, { name: groupName.trim(), teams: available.filter((team) => picked.includes(team.id)) }]);
    setGroupName('');
    setPicked([]);
  };

  const create = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const tournament = await post<TournamentDetail>('/api/tournaments', {
        name, overs: Number(overs), players_per_side: Number(players), super_over: superOver,
        groups: groups.map((group) => ({ name: group.name, teams: group.teams.map((team) => team.id) })),
      });
      navigate(`/tournaments/${tournament.id}`);
    } catch (error) {
      const next = failureOf(error);
      setFailure(next);
      raise(next.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="form" onSubmit={create} noValidate>
      <PageHeading>New tournament</PageHeading>
      {failure ? <Band>{failure.message}</Band> : null}
      <Field label="Tournament name" error={failure?.fields['name']}>
        {(props) => <input {...props} type="text" value={name} onInput={(e) => setName(e.currentTarget.value)} />}
      </Field>
      <Field label="Overs per side" error={failure?.fields['overs']}>
        {(props) => <input {...props} type="number" inputMode="numeric" value={overs} onInput={(e) => setOvers(e.currentTarget.value)} />}
      </Field>
      <Field label="Players per side" error={failure?.fields['players_per_side']}>
        {(props) => <input {...props} type="number" inputMode="numeric" value={players} onInput={(e) => setPlayers(e.currentTarget.value)} />}
      </Field>
      <label class="check"><input type="checkbox" checked={superOver} onChange={(e) => setSuperOver(e.currentTarget.checked)} />Super over</label>
      <h2>Groups</h2>
      <ol class="pending">
        {groups.map((group) => <li key={group.name}>{group.name} <span class="fact">{group.teams.map((team) => team.name).join(', ')}</span></li>)}
      </ol>
      <Field label="Group name">
        {(props) => <input {...props} type="text" value={groupName} onInput={(e) => setGroupName(e.currentTarget.value)} />}
      </Field>
      <fieldset class="picks">
        <legend>Teams in this group</legend>
        {available.map((team) => (
          <label class="check" key={team.id}>
            <input type="checkbox" checked={picked.includes(team.id)} onChange={(e) => setPicked(e.currentTarget.checked ? [...picked, team.id] : picked.filter((id) => id !== team.id))} />
            {team.name}
          </label>
        ))}
      </fieldset>
      <button type="button" class="button" onClick={addGroup}>Add group</button>
      <button type="submit" class="button" disabled={busy}>Create tournament</button>
    </form>
  );
};

export const NewMatch = (): JSX.Element => {
  const [teams] = useLoad<{ teams: TeamListItem[] }>('/api/teams');
  const [tournaments] = useLoad<{ tournaments: { id: string; name: string }[] }>('/api/tournaments');
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [tournament, setTournament] = useState('');
  const [fixed, setFixed] = useState<TournamentDetail | null>(null);
  const [overs, setOvers] = useState('20');
  const [players, setPlayers] = useState('11');
  const [superOver, setSuperOver] = useState(false);
  const [battingFirst, setBattingFirst] = useState('');
  const [squads, setSquads] = useState<Record<string, TeamDetail>>({});
  const [ticked, setTicked] = useState<string[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const teamList = teams.status === 'ready' ? teams.data.teams : [];

  useLayoutEffect(() => {
    for (const id of [home, away]) {
      if (id !== '' && !squads[id]) get<TeamDetail>(`/api/teams/${id}`).then((detail) => setSquads((known) => ({ ...known, [id]: detail })), () => undefined);
    }
  }, [home, away]);

  useLayoutEffect(() => {
    if (tournament === '') {
      setFixed(null);
      return;
    }
    get<TournamentDetail>(`/api/tournaments/${tournament}`).then((detail) => {
      setFixed(detail);
      setOvers(String(detail.overs));
      setPlayers(String(detail.players_per_side));
      setSuperOver(detail.super_over);
    }, () => undefined);
  }, [tournament]);

  const sides = [home, away].flatMap((id) => (id === '' ? [] : [squads[id]])).filter((squad): squad is TeamDetail => squad !== undefined);
  const xi = (team: TeamDetail): string[] => team.players.filter((player) => ticked.includes(player.id)).map((player) => player.id);

  const create = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const match = await post<MatchDetail>('/api/matches', {
        home, away, overs: Number(overs), players_per_side: Number(players), super_over: superOver,
        batting_first: battingFirst === '' ? home : battingFirst, tournament: tournament === '' ? null : tournament,
        xi: Object.fromEntries(sides.map((team) => [team.id, xi(team)])),
      });
      navigate(`/matches/${match.id}`);
    } catch (error) {
      const next = failureOf(error);
      setFailure(next);
      raise(next.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="form" onSubmit={create} noValidate>
      <PageHeading>New match</PageHeading>
      {failure ? <Band>{failure.message}</Band> : null}
      <Field label="Home team" error={failure?.fields['home']}>
        {(props) => (
          <select {...props} value={home} onChange={(e) => setHome(e.currentTarget.value)}>
            <option value="">Choose a team</option>
            {teamList.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        )}
      </Field>
      <Field label="Away team" error={failure?.fields['away']}>
        {(props) => (
          <select {...props} value={away} onChange={(e) => setAway(e.currentTarget.value)}>
            <option value="">Choose a team</option>
            {teamList.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        )}
      </Field>
      <Field label="Tournament" error={failure?.fields['tournament']}>
        {(props) => (
          <select {...props} value={tournament} onChange={(e) => setTournament(e.currentTarget.value)}>
            <option value="">No tournament</option>
            {(tournaments.status === 'ready' ? tournaments.data.tournaments : []).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        )}
      </Field>
      <Field label="Overs per side" error={failure?.fields['overs']}>
        {(props) => <input {...props} type="number" inputMode="numeric" value={overs} disabled={fixed !== null} onInput={(e) => setOvers(e.currentTarget.value)} />}
      </Field>
      <Field label="Players per side" error={failure?.fields['players_per_side']}>
        {(props) => <input {...props} type="number" inputMode="numeric" value={players} disabled={fixed !== null} onInput={(e) => setPlayers(e.currentTarget.value)} />}
      </Field>
      <label class="check"><input type="checkbox" checked={superOver} disabled={fixed !== null} onChange={(e) => setSuperOver(e.currentTarget.checked)} />Super over</label>
      <Field label="Batting first" error={failure?.fields['batting_first']}>
        {(props) => (
          <select {...props} value={battingFirst === '' ? home : battingFirst} onChange={(e) => setBattingFirst(e.currentTarget.value)}>
            {sides.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        )}
      </Field>
      <fieldset class="picks">
        <legend>Playing XI</legend>
        {sides.flatMap((team) => team.players.map((player) => (
          <label class="check" key={player.id}>
            <input type="checkbox" checked={ticked.includes(player.id)} onChange={(e) => setTicked(e.currentTarget.checked ? [...ticked, player.id] : ticked.filter((id) => id !== player.id))} />
            {team.name}: {player.name}
          </label>
        )))}
        {failure?.fields['xi'] ? <p class="band band-field">{failure.fields['xi']}</p> : null}
      </fieldset>
      <button type="submit" class="button" disabled={busy}>Create match</button>
    </form>
  );
};
