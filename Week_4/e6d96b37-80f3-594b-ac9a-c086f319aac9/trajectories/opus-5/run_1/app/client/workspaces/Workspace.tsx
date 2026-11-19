import { useState, type ReactNode } from 'react';
import { useDesk } from '../lib/desk.tsx';
import { windowText } from '../shell/Desk.tsx';
import { useLayout } from '../lib/layout.ts';
import { WORKSPACE_LABEL, type Specimen, type WorkspaceId } from '../../shared/types.ts';
import { Intake } from './Intake.tsx';
import { Attribution } from './Attribution.tsx';
import { Reconciliation } from './Reconciliation.tsx';
import { TrayPlacement } from './TrayPlacement.tsx';
import { Album } from './Album.tsx';
import { Condition } from './Condition.tsx';
import { Keepers } from './Keepers.tsx';
import { StockAudit } from './StockAudit.tsx';
import { Offers } from './Offers.tsx';
import { Counteroffers } from './Counteroffers.tsx';
import { Dispatch } from './Dispatch.tsx';
import { Receipt } from './Receipt.tsx';
import { Disputes } from './Disputes.tsx';

/**
 * Each workspace fills the specimen sheet. On desktops the left third holds
 * the stock grid or exchange list and the right two-thirds the inspector,
 * which carries the tablet's two panes plus the two fact boxes.
 */

export function Workspace({ id }: { id: WorkspaceId }): JSX.Element {
  const desk = useDesk();
  // Drafts are kept per specimen, so the workspace waits for the desk rather
  // than keying a draft against a specimen it does not know yet. The shell,
  // including both live regions, is already on the page.
  if (!desk.state) {
    return (
      <section className="fact-box" aria-label="Inspector">
        <h3 className="fact-heading">Opening the desk:</h3>
        <ul>
          <li>Reading the specimen record.</li>
          <li>Your drafts are kept.</li>
        </ul>
      </section>
    );
  }
  return <WorkspaceBody id={id} />;
}

function WorkspaceBody({ id }: { id: WorkspaceId }): JSX.Element {
  switch (id) {
    case 'intake':
      return <Intake />;
    case 'attribution':
      return <Attribution />;
    case 'catalog-reconciliation':
      return <Reconciliation />;
    case 'tray-placement':
      return <TrayPlacement />;
    case 'album':
      return <Album />;
    case 'condition':
      return <Condition />;
    case 'keepers':
      return <Keepers />;
    case 'stock-audit':
      return <StockAudit />;
    case 'offers':
      return <Offers />;
    case 'counteroffers':
      return <Counteroffers />;
    case 'dispatch':
      return <Dispatch />;
    case 'receipt':
      return <Receipt />;
    case 'disputes':
      return <Disputes />;
  }
}

/**
 * The published arrangement: one phone column, two tablet panes, and on
 * desktop a list beside an inspector holding both panes and the fact boxes.
 */
export function WorkspaceFrame({
  id,
  listKind,
  left,
  right,
  below,
  selected,
  ownFactBoxes,
}: {
  id: WorkspaceId;
  listKind: 'stock' | 'exchange';
  left: ReactNode;
  right: ReactNode;
  below?: ReactNode;
  selected?: Specimen | undefined;
  /** True when the workspace's own pane already carries G21 and G22. */
  ownFactBoxes?: boolean;
}): JSX.Element {
  const layout = useLayout();
  const label = `${WORKSPACE_LABEL[id]} workspace`;
  const regionName =
    id === 'intake'
      ? 'Intake workspace'
      : id === 'attribution'
        ? 'Attribution workspace'
        : id === 'catalog-reconciliation'
          ? 'Catalog reconciliation workspace'
          : id === 'tray-placement'
            ? 'Tray placement workspace'
            : id === 'album'
              ? 'Album workspace'
              : id === 'condition'
                ? 'Condition comparison workspace'
                : id === 'keepers'
                  ? 'Keeper preference workspace'
                  : id === 'stock-audit'
                    ? 'Stock audit workspace'
                    : id === 'offers'
                      ? 'Offer assembly workspace'
                      : id === 'counteroffers'
                        ? 'Counteroffer workspace'
                        : id === 'dispatch'
                          ? 'Dispatch workspace'
                          : id === 'receipt'
                            ? 'Receipt workspace'
                            : 'Dispute evidence workspace';
  void label;

  if (layout === 'desktop') {
    return (
      <section className="workspace desktop" aria-label={regionName}>
        {listKind === 'stock' ? <StockGrid /> : <ExchangeList />}
        <section className="inspector" aria-label="Inspector">
          <div className="pane-pair">
            <div className="pane">{left}</div>
            <div className="pane">{right}</div>
          </div>
          {below}
          {ownFactBoxes === true ? null : <FactBoxes specimen={selected} />}
        </section>
      </section>
    );
  }

  if (layout === 'tablet') {
    return (
      <section className="workspace tablet" aria-label={regionName}>
        <div className="pane-pair">
          <div className="pane">{left}</div>
          <div className="pane">{right}</div>
        </div>
        {below}
      </section>
    );
  }

  return (
    <section className="workspace phone" aria-label={regionName}>
      {left}
      {right}
      {below}
    </section>
  );
}

/** The obverse and reverse fact boxes for the selected specimen. */
export function FactBoxes({ specimen }: { specimen: Specimen | undefined }): JSX.Element {
  return (
    <div className="fact-pair">
      <section className="fact-box" aria-label="Obverse facts">
        <h3 className="fact-heading">Obverse:</h3>
        <ul>
          <li>{specimen ? specimen.display_label : 'No specimen selected'}</li>
          <li>
            {specimen?.attribution.mintmark
              ? `Mintmark ${specimen.attribution.mintmark}`
              : 'Mintmark not attributed'}
          </li>
        </ul>
      </section>
      <section className="fact-box" aria-label="Reverse facts">
        <h3 className="fact-heading">Reverse:</h3>
        <ul>
          <li>{specimen ? `Holder ${specimen.holder.kind}` : 'No holder'}</li>
          <li>
            {specimen
              ? `${specimen.holder.width_mm} by ${specimen.holder.height_mm} mm`
              : 'No measurements'}
          </li>
        </ul>
      </section>
    </div>
  );
}

/** G33: the desktop stock list of specimen chips, in capped pages. */
export function StockGrid(): JSX.Element {
  const desk = useDesk();
  const [page, setPage] = useState(0);
  const perPage = 8;
  const keys = Object.keys(desk.state?.specimens ?? {}).filter(
    (key) => desk.state?.specimens[key]?.owner === 'dealer',
  );
  const pages = Math.max(1, Math.ceil(keys.length / perPage));
  const at = Math.min(page, pages - 1);
  const shown = keys.slice(at * perPage, at * perPage + perPage);

  return (
    <section className="stock-grid" aria-label="Stock grid">
      <ul className="chip-list">
        {shown.map((key) => (
          <li key={key}>
            <SpecimenChip specimenKey={key} />
          </li>
        ))}
      </ul>
      <div className="pager">
        <button
          type="button"
          className="target"
          disabled={at === 0}
          onClick={() => setPage(at - 1)}
        >
          Previous page
        </button>
        <button
          type="button"
          className="target"
          disabled={at >= pages - 1}
          onClick={() => setPage(at + 1)}
        >
          Next page
        </button>
      </div>
    </section>
  );
}

/** G34: the desktop list of offers, each row carrying its window text. */
export function ExchangeList(): JSX.Element {
  const desk = useDesk();
  const offers = Object.entries(desk.state?.offers ?? {});
  return (
    <section className="exchange-list" aria-label="Exchange list">
      <ul className="chip-list">
        {offers.map(([key, offer]) => (
          <li key={key} className="offer-row">
            <span className="offer-key">{key}</span>
            <span className="offer-status">{offer.status}</span>
            <span className="offer-window">{windowText(offer)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** G29: a selectable, draggable specimen chip drawn at one image scale. */
export function SpecimenChip({
  specimenKey,
  interaction,
  selected,
}: {
  specimenKey: string;
  interaction?: Record<string, unknown>;
  selected?: boolean;
}): JSX.Element {
  const desk = useDesk();
  const specimen = desk.state?.specimens[specimenKey];
  const mintmark = specimen?.attribution.mintmark ?? '?';
  return (
    <button
      type="button"
      className={selected ? 'chip target chip-selected' : 'chip target'}
      aria-label={`Specimen ${specimenKey}`}
      data-item={specimenKey}
      {...interaction}
    >
      <span className="chip-disc" aria-hidden="true">
        <span className="chip-mintmark">{mintmark}</span>
      </span>
      <span className="chip-name">{specimen?.display_label ?? `Specimen ${specimenKey}`}</span>
      <span className="chip-status">{specimen?.status ?? ''}</span>
    </button>
  );
}
