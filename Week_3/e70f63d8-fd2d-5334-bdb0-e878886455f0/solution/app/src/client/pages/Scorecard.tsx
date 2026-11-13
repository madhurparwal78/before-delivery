import type { JSX } from 'preact';
import type { InningsCard, Scorecard } from '../../shared/wire.js';
import { Loading, PageHeading } from '../components/ui.js';
import { useLoad } from '../lib/load.js';
import { Link } from '../lib/router.js';
import { NotFound } from './NotFound.js';

const InningsSection = ({ card }: { card: InningsCard }): JSX.Element => (
  <section class="innings-card">
    <h2>{card.heading}</h2>
    <div class="table-scroll" tabIndex={0} role="region" aria-label={`${card.heading}, batting`}>
      <table>
        <caption>Batting</caption>
        <thead>
          <tr><th scope="col">Batter</th><th scope="col">Dismissal</th><th scope="col">R</th><th scope="col">B</th><th scope="col">4s</th><th scope="col">6s</th><th scope="col">SR</th></tr>
        </thead>
        <tbody>
          {card.batting.map((row) => (
            <tr key={row.player}>
              <td>{row.name}</td><td>{row.dismissal}</td><td>{row.runs}</td><td>{row.balls}</td><td>{row.fours}</td><td>{row.sixes}</td><td>{row.strike_rate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p class="extras">{card.extras.text}</p>
    <p class="total">{card.total_text}</p>
    {card.did_not_bat.length > 0 ? <p class="did-not-bat">Did not bat: {card.did_not_bat.join(', ')}</p> : null}
    <p class="fow">{card.fall_of_wickets}</p>
    <div class="table-scroll" tabIndex={0} role="region" aria-label={`${card.heading}, bowling`}>
      <table>
        <caption>Bowling</caption>
        <thead>
          <tr><th scope="col">Bowler</th><th scope="col">O</th><th scope="col">M</th><th scope="col">R</th><th scope="col">W</th><th scope="col">Wd</th><th scope="col">Nb</th><th scope="col">Econ</th></tr>
        </thead>
        <tbody>
          {card.bowling.map((row) => (
            <tr key={row.player}>
              <td>{row.name}</td><td>{row.overs}</td><td>{row.maidens}</td><td>{row.runs}</td><td>{row.wickets}</td><td>{row.wides}</td><td>{row.no_balls}</td><td>{row.economy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

/** The scorecard sections in innings order, then the result. */
const ScorecardView = ({ card, back }: { card: Scorecard; back: { href: string; label: string } }): JSX.Element => (
  <article class="scorecard">
    <PageHeading>{card.match.title}</PageHeading>
    <p><Link href={back.href}>{back.label}</Link></p>
    {card.innings.map((innings) => <InningsSection key={innings.innings} card={innings} />)}
    {card.result ? <div class="result" id="result">{card.result}</div> : null}
  </article>
);

export const ScorecardPage = ({ id }: { id: string }): JSX.Element => {
  const [loaded] = useLoad<Scorecard>(`/api/matches/${id}/scorecard`);
  if (loaded.status === 'failed') return <NotFound />;
  if (loaded.status === 'loading') return <Loading />;
  return <ScorecardView card={loaded.data} back={{ href: `/matches/${id}/score`, label: 'Back to scoring' }} />;
};

export const ViewerScorecardPage = ({ code }: { code: string }): JSX.Element => {
  const [loaded] = useLoad<Scorecard>(`/api/live/${code}/scorecard`);
  if (loaded.status === 'failed') return <NotFound />;
  if (loaded.status === 'loading') return <Loading />;
  return <ScorecardView card={loaded.data} back={{ href: `/live/${code}`, label: 'Back to the score' }} />;
};
