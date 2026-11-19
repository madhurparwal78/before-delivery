import { useDesk } from '../lib/desk.tsx';
import { Ftpl } from '../../shared/feedback.ts';
import { navigate, type Counts } from './Desk.tsx';
import { Icon } from './Icon.tsx';

/** The desk home: the lead line, the tray directory and the two fact boxes. */

export function Home({ counts }: { counts: Counts }): JSX.Element {
  const desk = useDesk();
  const isCounterpart = desk.session?.role === 'counterpart';

  // The fact boxes describe the most recently created specimen from today's
  // intake, including whether its catalogue record is still pending.
  const created = [...(desk.state?.events ?? [])]
    .reverse()
    .find((event) => event.type === 'specimen.created');
  const latestKey = Object.entries(desk.state?.specimens ?? {})
    .filter(([, specimen]) => specimen.owner === 'dealer')
    .map(([key]) => key)
    .pop();
  const latest = latestKey ? desk.state?.specimens[latestKey] : undefined;

  return (
    <>
      <p className="lead">
        <strong>Halloway Numismatics, one bench, one pair of hands.</strong>
        <br />
        <strong>Every specimen photographed, attributed, shelved and accounted for.</strong>
      </p>

      <section className="tray-directory" aria-label="Tray directory">
        {!isCounterpart ? (
          <a
            className="lockup target"
            href={`/desk/${desk.ns}/intake`}
            onClick={(event) => {
              event.preventDefault();
              navigate(`/desk/${desk.ns}/intake`);
            }}
            aria-label="Open stock"
          >
            <span className="lockup-name">
              <Icon name="layout-grid" /> Stock
            </span>
            <span className="lockup-label">
              <span>{Ftpl.specimenCount(counts.dealerSpecimens)}</span>
              <span>{Ftpl.cellsFilled(counts.occupiedCells)}</span>
            </span>
          </a>
        ) : null}
        <a
          className="lockup target"
          href={`/desk/${desk.ns}/offers`}
          onClick={(event) => {
            event.preventDefault();
            navigate(`/desk/${desk.ns}/offers`);
          }}
          aria-label="Open exchanges"
        >
          <span className="lockup-name">
            <Icon name="arrow-left-right" /> Exchange
          </span>
          <span className="lockup-label">
            <span>{Ftpl.openOffers(counts.openOffers)}</span>
            <span>{Ftpl.awaitingReceipt(counts.awaitingReceipt)}</span>
          </span>
        </a>
        <p className="note pending-note">
          {counts.cataloguePending > 0
            ? `${counts.cataloguePending} catalogue records are still pending.`
            : 'Every catalogue record is stored.'}
        </p>
      </section>

      <div className="fact-pair">
        <section className="fact-box" aria-label="Obverse facts">
          <h3 className="fact-heading">Obverse:</h3>
          <ul>
            <li>{latest ? latest.display_label : 'No specimen taken in yet'}</li>
            <li>
              {latest?.attribution.mintmark
                ? `Mintmark ${latest.attribution.mintmark}`
                : 'Mintmark not attributed'}
            </li>
          </ul>
        </section>
        <section className="fact-box" aria-label="Reverse facts">
          <h3 className="fact-heading">Reverse:</h3>
          <ul>
            <li>
              {latest?.attribution.register === 'pending'
                ? 'Catalogue record still pending'
                : 'Catalogue record stored'}
            </li>
            <li>{created ? `Taken in ${created.at.slice(0, 10)}` : 'Not from today’s intake'}</li>
          </ul>
        </section>
      </div>
    </>
  );
}
