import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { copy } from '../../shared/copy.js';
import type { Career, GroupTable, InvitationView, MatchDetail, ServerMessage, TeamDetail, TournamentDetail } from '../../shared/wire.js';
import { Band, Field, Loading, PageHeading } from '../components/ui.js';
import { announce, raise } from '../lib/announce.js';
import { failureOf, post, request } from '../lib/api.js';
import { useLoad } from '../lib/load.js';
import { Link, navigate } from '../lib/router.js';
import { openSocket } from '../lib/socket.js';
import { NotFound } from './NotFound.js';

export const MatchPage = ({ id }: { id: string }): JSX.Element => {
  const [loaded, set] = useLoad<MatchDetail>(`/api/matches/${id}`);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState('');
  const [problem, setProblem] = useState('');
  if (loaded.status === 'failed') return <NotFound />;
  if (loaded.status === 'loading') return <Loading />;
  const match = loaded.data;

  const toggle = async (): Promise<void> => {
    try {
      const link = await request<{ viewer_link: boolean; viewer_code: string | null }>('PATCH', `/api/matches/${id}/viewer-link`, { on: !match.viewer_link });
      set({ ...match, ...link });
    } catch (error) {
      raise(failureOf(error).message);
    }
  };

  const invite = async (event: Event): Promise<void> => {
    event.preventDefault();
    setSending(true);
    setSent('');
    setProblem('');
    try {
      const answer = await post<{ message: string }>(`/api/matches/${id}/invitations`, { email });
      setSent(answer.message);
      announce(answer.message);
      setEmail('');
    } catch (error) {
      const failure = failureOf(error);
      setProblem(failure.fields['email'] ?? failure.message);
      if (failure.code !== 'VALIDATION') raise(failure.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <section>
      <PageHeading>{match.title}</PageHeading>
      <p class="fact">{match.overs} overs a side, {match.players_per_side} players{match.super_over ? ', super over' : ''}{match.tournament ? `, ${match.tournament.name}` : ''}</p>
      <p class="actions">
        <Link href={`/matches/${id}/score`} class="button">Score this match</Link>
        <Link href={`/matches/${id}/scorecard`} class="button">Scorecard</Link>
      </p>
      <h2>Sharing</h2>
      <button type="button" role="switch" class="switch" aria-checked={match.viewer_link} onClick={toggle}>
        Viewer link<span class="switch-state" aria-hidden="true">{match.viewer_link ? 'On' : 'Off'}</span>
      </button>
      {match.viewer_link && match.viewer_code ? <p id="viewer-url" class="viewer-url">{`${location.origin}/live/${match.viewer_code}`}</p> : null}
      <h2>Scorers</h2>
      <ul class="plain">{match.scorers.map((scorer) => <li key={scorer.display_name}>{scorer.display_name}</li>)}</ul>
      <form class="form" onSubmit={invite} noValidate>
        <h2>Invite a scorer</h2>
        <Field label="Scorer email" error={problem || undefined}>
          {(props) => <input {...props} type="text" inputMode="email" autoComplete="off" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />}
        </Field>
        <button type="submit" class="button" disabled={sending}>Send invitation</button>
        {sent ? <p class="sent">{sent}</p> : null}
      </form>
    </section>
  );
};

export const TeamPage = ({ id }: { id: string }): JSX.Element => {
  const [loaded, set] = useLoad<TeamDetail>(`/api/teams/${id}`);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState('');
  if (loaded.status === 'failed') return <NotFound />;
  if (loaded.status === 'loading') return <Loading />;
  const team = loaded.data;

  const upload = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    setProblem('');
    try {
      const body = new FormData();
      body.append('logo', file);
      const { logo_url: logo } = await request<{ logo_url: string }>('POST', `/api/teams/${id}/logo`, body);
      set({ ...team, logo_url: logo });
      announce(copy.logoUploaded);
    } catch (error) {
      const failure = failureOf(error);
      setProblem(failure.fields['logo'] ?? failure.message);
      raise(failure.fields['logo'] ?? failure.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <section>
      <PageHeading>{team.name}</PageHeading>
      {team.logo_url ? <img class="logo" src={team.logo_url} alt={`${team.name} logo`} width="96" height="96" /> : null}
      <h2>Players</h2>
      <ul class="names">
        {team.players.map((player) => <li key={player.id}><span class="name">{player.name}</span><span class="fact">{player.short_name}</span></li>)}
      </ul>
      {team.is_organiser ? (
        <form class="form" onSubmit={upload}>
          <h2>Logo</h2>
          <Field label="Team logo" error={problem || undefined}>
            {(props) => <input {...props} type="file" accept="image/png,image/jpeg" onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} />}
          </Field>
          <button type="submit" class="button" disabled={uploading}>Upload logo</button>
          {uploading ? <p class="fact" role="status">{copy.logoUploading}</p> : null}
        </form>
      ) : null}
      <h2>Matches</h2>
      <ul class="plain history" aria-label="Matches">
        {team.matches.map((match) => (
          <li key={match.id}>
            <span>{match.line}</span>
            {match.scorecard_url ? <Link href={match.scorecard_url}>Scorecard</Link> : null}
          </li>
        ))}
      </ul>
    </section>
  );
};

const GroupSection = ({ group }: { group: GroupTable }): JSX.Element => (
  <section class="group">
    <div class="table-scroll" tabIndex={0} role="region" aria-label={`${group.name} points table`}>
      <table class="points">
        <caption>{group.name}</caption>
        <thead>
          <tr><th scope="col">Team</th><th scope="col">P</th><th scope="col">W</th><th scope="col">L</th><th scope="col">T</th><th scope="col">Pts</th><th scope="col">NRR</th></tr>
        </thead>
        <tbody>
          {group.table.map((row) => (
            <tr key={row.team.id}>
              <td>{row.team.name}</td><td>{row.p}</td><td>{row.w}</td><td>{row.l}</td><td>{row.t}</td><td>{row.pts}</td><td>{row.nrr}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <ul class="plain fixtures" aria-label={`${group.name} matches`}>
      {group.matches.map((match) => (
        <li key={match.id}>{match.home} v {match.away}: {match.result ?? match.status.replace(/_/g, ' ')}</li>
      ))}
    </ul>
  </section>
);

export const TournamentPage = ({ id }: { id: string }): JSX.Element => {
  const [loaded, set] = useLoad<TournamentDetail>(`/api/tournaments/${id}`);
  const current = useRef<TournamentDetail | null>(null);
  current.current = loaded.status === 'ready' ? loaded.data : null;

  useLayoutEffect(() => {
    const socket = openSocket((send) => send({ type: 'watch', tournament: id }), (message: ServerMessage) => {
      if (message.type !== 'table' || !current.current) return;
      set({ ...current.current, groups: message.groups });
      announce(copy.pointsUpdated);
    });
    return socket.close;
  }, [id]);

  if (loaded.status === 'failed') return <NotFound />;
  if (loaded.status === 'loading') return <Loading />;
  const tournament = loaded.data;
  return (
    <section>
      <PageHeading>{tournament.name}</PageHeading>
      <p class="fact">{tournament.overs} overs a side, {tournament.players_per_side} players{tournament.super_over ? ', super over' : ''}</p>
      {tournament.groups.map((group) => <GroupSection key={group.name} group={group} />)}
    </section>
  );
};

const CareerTable = ({ caption, head, row }: { caption: string; head: string[]; row: (string | number)[] }): JSX.Element => (
  <div class="table-scroll" tabIndex={0} role="region" aria-label={`${caption} career`}>
    <table>
      <caption>{caption}</caption>
      <thead><tr>{head.map((name) => <th scope="col" key={name}>{name}</th>)}</tr></thead>
      <tbody><tr>{row.map((value, index) => <td key={head[index]}>{value}</td>)}</tr></tbody>
    </table>
  </div>
);

export const CareerPage = ({ id }: { id: string }): JSX.Element => {
  const [loaded] = useLoad<Career>(`/api/players/${id}`);
  if (loaded.status === 'failed') return <NotFound />;
  if (loaded.status === 'loading') return <Loading />;
  const { player, batting, bowling } = loaded.data;
  return (
    <section>
      <PageHeading>{player.name}</PageHeading>
      <p class="fact">{player.short_name}, <Link href={`/teams/${player.team.id}`}>{player.team.name}</Link></p>
      <CareerTable
        caption="Batting" head={['Mat', 'Inns', 'NO', 'Runs', 'HS', 'Avg', 'SR', '4s', '6s']}
        row={[batting.matches, batting.innings, batting.not_outs, batting.runs, batting.high_score, batting.average, batting.strike_rate, batting.fours, batting.sixes]}
      />
      <CareerTable caption="Bowling" head={['Overs', 'Runs', 'Wkts', 'Best', 'Econ']} row={[bowling.overs, bowling.runs, bowling.wickets, bowling.best, bowling.economy]} />
    </section>
  );
};

export const InvitationPage = ({ token }: { token: string }): JSX.Element => {
  const [loaded] = useLoad<InvitationView>(`/api/invitations/${token}`);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  if (loaded.status === 'failed') return <NotFound />;
  if (loaded.status === 'loading') return <Loading />;
  const { match, status } = loaded.data;

  const accept = async (): Promise<void> => {
    setBusy(true);
    try {
      const answer = await post<{ match_id: string }>(`/api/invitations/${token}/accept`);
      navigate(`/matches/${answer.match_id}/score`);
    } catch (error) {
      const message = failureOf(error).message;
      setProblem(message);
      raise(message);
      setBusy(false);
    }
  };

  return (
    <section class="form">
      <PageHeading>{`Score ${match.title}`}</PageHeading>
      {status === 'used' ? <Band>{copy.invitationUsed}</Band> : status === 'expired' ? <Band>{copy.invitationExpired}</Band> : (
        <button type="button" class="button" disabled={busy} onClick={accept}>Accept invitation</button>
      )}
      {problem ? <Band>{problem}</Band> : null}
    </section>
  );
};
