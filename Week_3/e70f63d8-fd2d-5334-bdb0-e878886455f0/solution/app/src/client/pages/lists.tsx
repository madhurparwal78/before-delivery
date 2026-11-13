import type { JSX } from 'preact';
import { copy } from '../../shared/copy.js';
import { dayText } from '../../shared/dates.js';
import type { MatchListItem, PlayerListItem, TeamListItem } from '../../shared/wire.js';
import { Empty, Loading, PageHeading } from '../components/ui.js';
import { useLoad } from '../lib/load.js';
import { Link } from '../lib/router.js';
import { NotFound } from './NotFound.js';

interface ListingProps<T> {
  heading: string;
  newLink: { href: string; label: string };
  empty: string;
  items: T[] | null;
  render: (item: T) => JSX.Element;
}

const Listing = <T,>({ heading, newLink, empty, items, render }: ListingProps<T>): JSX.Element => (
  <section>
    <PageHeading>{heading}</PageHeading>
    {items !== null && items.length > 0 ? <p><Link href={newLink.href} class="button">{newLink.label}</Link></p> : null}
    {items === null ? <Loading /> : items.length === 0 ? <Empty line={empty} href={newLink.href} link={newLink.label} /> : <ul class="names">{items.map(render)}</ul>}
  </section>
);

export const MatchesPage = (): JSX.Element => {
  const [loaded] = useLoad<{ matches: MatchListItem[] }>('/api/matches');
  if (loaded.status === 'failed') return <NotFound />;
  return (
    <Listing
      heading="Matches" newLink={{ href: '/matches/new', label: 'New match' }} empty={copy.emptyFixtures}
      items={loaded.status === 'ready' ? loaded.data.matches : null}
      render={(match) => (
        <li key={match.id}>
          <Link href={match.is_organiser ? `/matches/${match.id}` : `/matches/${match.id}/score`} class="name">{match.title}</Link>
          <span class="fact">{match.result ?? match.status.replace(/_/g, ' ')}{match.played_on ? `, ${dayText(match.played_on)}` : ''}</span>
        </li>
      )}
    />
  );
};

export const TeamsPage = (): JSX.Element => {
  const [loaded] = useLoad<{ teams: TeamListItem[] }>('/api/teams');
  if (loaded.status === 'failed') return <NotFound />;
  return (
    <Listing
      heading="Teams" newLink={{ href: '/teams/new', label: 'New team' }} empty={copy.emptyTeams}
      items={loaded.status === 'ready' ? loaded.data.teams : null}
      render={(team) => <li key={team.id}><Link href={`/teams/${team.id}`} class="name">{team.name}</Link></li>}
    />
  );
};

export const TournamentsPage = (): JSX.Element => {
  const [loaded] = useLoad<{ tournaments: { id: string; name: string }[] }>('/api/tournaments');
  if (loaded.status === 'failed') return <NotFound />;
  return (
    <Listing
      heading="Tournaments" newLink={{ href: '/tournaments/new', label: 'New tournament' }} empty={copy.emptyTournaments}
      items={loaded.status === 'ready' ? loaded.data.tournaments : null}
      render={(tournament) => <li key={tournament.id}><Link href={`/tournaments/${tournament.id}`} class="name">{tournament.name}</Link></li>}
    />
  );
};

export const PlayersPage = (): JSX.Element => {
  const [loaded] = useLoad<{ players: PlayerListItem[] }>('/api/players');
  if (loaded.status === 'failed') return <NotFound />;
  const players = loaded.status === 'ready' ? loaded.data.players : null;
  return (
    <section>
      <PageHeading>Players</PageHeading>
      {players === null ? <Loading /> : players.length === 0 ? <Empty line={copy.emptyPlayers} href="/teams/new" link="New team" /> : (
        <ul class="names">
          {players.map((player) => (
            <li key={player.id}>
              <Link href={`/players/${player.id}`} class="name">{player.name}</Link>
              <span class="fact">{player.short_name}, {player.team.name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
