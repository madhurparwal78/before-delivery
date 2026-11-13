import { useEffect, useRef, useState } from 'react';
import type { ChipCode, SquadView } from '../../shared/types.ts';
import { CHIP_NAMES, CHIP_ORDER } from '../../shared/copy.ts';
import { formatMillions } from '../../shared/money.ts';
import { Dialog } from './Dialog.tsx';
import { RollingNumber } from './RollingNumber.tsx';

export const useIsPhone = (): boolean => {
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 480px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 480px)');
    const update = (): void => setPhone(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return phone;
};

export interface ChipsBarProps {
  squad: SquadView;
  editable: boolean;
  pendingChip: ChipCode | null;
  onChipPressed: (chip: ChipCode) => void;
}

export const ChipsBar = ({ squad, editable, pendingChip, onChipPressed }: ChipsBarProps) => (
  <div role="group" aria-label="Chips" className="chips">
    {CHIP_ORDER.map((chip) => {
      const state = squad.chips[chip];
      return (
        <button
          key={chip}
          type="button"
          className={`chip chip-${state}`}
          aria-pressed={state === 'active'}
          disabled={!editable || state === 'used'}
          onClick={() => onChipPressed(chip)}
        >
          <span className="chip-name">{CHIP_NAMES[chip]}</span>
          {state !== 'available' && (
            <span className="chip-state">{state === 'active' ? 'Active' : 'Used'}</span>
          )}
          {pendingChip === chip && <span className="chip-state">Playing…</span>}
        </button>
      );
    })}
  </div>
);

const Figure = ({ label, value }: { label: string; value: string }) => (
  <div className="figure">
    <span className="figure-label" id={`figure-${label.replace(/\s/g, '-')}`}>
      {label}
    </span>
    <span className="figure-value mono" aria-labelledby={`figure-${label.replace(/\s/g, '-')}`}>
      {value}
    </span>
  </div>
);

const TotalFigure = ({
  points,
  rolling,
  carry,
}: {
  points: number;
  rolling: boolean;
  carry: boolean;
}) => (
  <div className="figure">
    <span className="figure-label" id="figure-gameweek-total">
      Gameweek total
    </span>
    <span
      className="figure-value mono figure-total"
      aria-labelledby="figure-gameweek-total"
      {...(carry ? { 'data-gameweek-total': true, 'data-points': points } : {})}
    >
      <RollingNumber value={points} animate={rolling} />
    </span>
  </div>
);

export interface LedgerProps {
  squad: SquadView;
  gameweekTotal: number;
  rollingTotal: boolean;
  chips: React.ReactNode;
  leagueTable: React.ReactNode;
}

export const Ledger = ({
  squad,
  gameweekTotal,
  rollingTotal,
  chips,
  leagueTable,
}: LedgerProps) => {
  const phone = useIsPhone();
  const [sheetOpen, setSheetOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);

  const figures = (carryTotal: boolean) => (
    <>
      <Figure label="Bank" value={`${formatMillions(squad.bank_tenths)}m`} />
      <Figure label="Squad value" value={`${formatMillions(squad.squad_value_tenths)}m`} />
      <Figure label="Free transfers" value={String(squad.free_transfers)} />
      <Figure label="Hit cost" value={`${squad.hit_points === 0 ? 0 : -squad.hit_points} pts`} />
      <TotalFigure points={gameweekTotal} rolling={rollingTotal} carry={carryTotal} />
    </>
  );

  if (!phone) {
    return (
      <aside aria-label="Ledger" className="rail">
        <div className="rail-figures">{figures(true)}</div>
        {chips}
        {leagueTable}
      </aside>
    );
  }

  return (
    <>
      <div className="bottom-strip">
        <div className="figure">
          <span className="figure-label">Bank</span>
          <span className="figure-value mono">{formatMillions(squad.bank_tenths)}m</span>
        </div>
        <div className="figure">
          <span className="figure-label">Free transfers</span>
          <span className="figure-value mono">{squad.free_transfers}</span>
        </div>
        <div className="figure">
          <span className="figure-label">Gameweek total</span>
          <span
            className="figure-value mono figure-total"
            {...(sheetOpen ? {} : { 'data-gameweek-total': true, 'data-points': gameweekTotal })}
          >
            <RollingNumber value={gameweekTotal} animate={rollingTotal} />
          </span>
        </div>
        <button type="button" ref={opener} onClick={() => setSheetOpen(true)}>
          Ledger
        </button>
      </div>
      {sheetOpen && (
        <Dialog
          title="Ledger"
          onClose={() => setSheetOpen(false)}
          returnFocusTo={opener.current}
          className="sheet"
        >
          <aside aria-label="Ledger" className="rail rail-sheet">
            <div className="rail-figures">{figures(true)}</div>
            {chips}
          </aside>
          <button type="button" onClick={() => setSheetOpen(false)}>
            Close ledger
          </button>
        </Dialog>
      )}
    </>
  );
};
