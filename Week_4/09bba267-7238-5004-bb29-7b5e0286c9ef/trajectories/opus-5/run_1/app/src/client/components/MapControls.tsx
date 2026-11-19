import type { ReactNode } from 'react';
import type { Tier } from '../../shared/api';
import { SECTIONS, type SectionCode } from '../../shared/hall';
import { formatMoney } from '../../shared/money';
import { HallKey } from './HallKey';

interface MapControlsProps {
  readonly section: SectionCode;
  readonly tiers: readonly Tier[];
  readonly tierFilter: string;
  readonly onSection: (section: SectionCode) => void;
  readonly onTier: (tierId: string) => void;
}

/** The section tabs, the price tier radio group and the hall key. */
export function MapControls({ section, tiers, tierFilter, onSection, onTier }: MapControlsProps): ReactNode {
  return (
    <div className="map-controls">
      <div role="tablist" aria-label="Sections" className="tablist">
        {SECTIONS.map((tab, index) => (
          <button
            key={tab.code}
            type="button"
            role="tab"
            aria-selected={tab.code === section}
            tabIndex={tab.code === section ? 0 : -1}
            onClick={() => onSection(tab.code)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const next = SECTIONS[index + (event.key === 'ArrowRight' ? 1 : -1)];
              if (next !== undefined) onSection(next.code);
            }}
          >
            {tab.name}
          </button>
        ))}
      </div>

      <div role="radiogroup" aria-label="Price tier" className="tier-choice">
        <label className="tier-option">
          <input
            type="radio"
            name="price-tier"
            aria-label="All tiers"
            checked={tierFilter === 'all'}
            onChange={() => onTier('all')}
          />
          <span>All tiers</span>
        </label>
        {tiers.map((tier) => (
          <label className="tier-option" key={tier.id}>
            <input
              type="radio"
              name="price-tier"
              aria-label={tier.name}
              checked={tierFilter === tier.id}
              onChange={() => onTier(tier.id)}
            />
            <span>
              {tier.name} <span className="figures">{formatMoney(tier.faceCents)}</span>{' '}
              <span className="figures">{tier.remaining === 0 ? 'Sold out' : `${tier.remaining} left`}</span>
            </span>
          </label>
        ))}
      </div>

      <HallKey section={section} />
    </div>
  );
}
