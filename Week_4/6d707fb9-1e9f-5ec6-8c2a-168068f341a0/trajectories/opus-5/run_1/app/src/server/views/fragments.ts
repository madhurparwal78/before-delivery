import { type Raw, html, raw } from './html';

/** Generated weave patterns, one per stage, so strata are told apart by weave. */
export const WEAVES = `
<svg class="weave-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>
  <pattern id="weave-materials" width="8" height="8" patternUnits="userSpaceOnUse">
    <rect width="8" height="8" fill="none"/>
    <path d="M0 4h8" stroke="currentColor" stroke-width="1.6" opacity="0.5"/>
  </pattern>
  <pattern id="weave-making" width="8" height="8" patternUnits="userSpaceOnUse">
    <path d="M0 0l8 8M8 0l-8 8" stroke="currentColor" stroke-width="1.2" opacity="0.5"/>
  </pattern>
  <pattern id="weave-transport" width="8" height="8" patternUnits="userSpaceOnUse">
    <path d="M4 0v8" stroke="currentColor" stroke-width="1.6" opacity="0.5"/>
  </pattern>
  <pattern id="weave-use" width="8" height="8" patternUnits="userSpaceOnUse">
    <circle cx="4" cy="4" r="1.6" fill="currentColor" opacity="0.5"/>
  </pattern>
  <pattern id="weave-endOfLife" width="8" height="8" patternUnits="userSpaceOnUse">
    <path d="M0 0h4v4H0zM4 4h4v4H4z" fill="currentColor" opacity="0.4"/>
  </pattern>
</defs></svg>`;

function fragment(inner: string, label: string): Raw {
  return html`<div class="fragment" data-ui="fragment" aria-hidden="true">
    <svg viewBox="0 0 220 150" role="presentation" focusable="false" class="fragment-art">${raw(inner)}</svg>
    <span class="fragment-caption">${label}</span>
  </div>`;
}

export const materialLineFragment = fragment(
  `<rect x="0" y="10" width="220" height="34" fill="#EBE4D8"/>
   <rect x="10" y="20" width="14" height="14" fill="#2F6B4F"/>
   <rect x="34" y="23" width="96" height="8" fill="#241C14" opacity="0.72"/>
   <rect x="150" y="23" width="54" height="8" fill="#6B5B4D" opacity="0.6"/>
   <rect x="0" y="56" width="220" height="34" fill="#EBE4D8"/>
   <rect x="10" y="66" width="14" height="14" fill="#2F6B4F" opacity="0.6"/>
   <rect x="34" y="69" width="78" height="8" fill="#241C14" opacity="0.72"/>
   <rect x="150" y="69" width="54" height="8" fill="#6B5B4D" opacity="0.6"/>
   <rect x="0" y="102" width="220" height="34" fill="#EBE4D8"/>
   <rect x="10" y="112" width="14" height="14" fill="#2F6B4F" opacity="0.35"/>
   <rect x="34" y="115" width="110" height="8" fill="#241C14" opacity="0.72"/>`,
  'A material line',
);

export const strataFragment = fragment(
  `<g color="#241C14">
     <rect x="0" y="40" width="92" height="52" fill="#2F6B4F"/>
     <rect x="0" y="40" width="92" height="52" fill="url(#weave-materials)"/>
     <rect x="94" y="40" width="46" height="52" fill="#3F7C5E"/>
     <rect x="94" y="40" width="46" height="52" fill="url(#weave-making)"/>
     <rect x="142" y="40" width="12" height="52" fill="#55917A"/>
     <rect x="156" y="40" width="58" height="52" fill="#6FA38E"/>
     <rect x="156" y="40" width="58" height="52" fill="url(#weave-use)"/>
     <rect x="216" y="40" width="4" height="52" fill="#8FBAA8"/>
     <rect x="0" y="100" width="46" height="6" fill="#241C14"/>
   </g>`,
  'A strata band',
);

const PINNED_SHARES: Record<string, Record<string, string>> = {
  climate: { materials: '45.7', making: '20.9', transport: '3.8', use: '29.1', endOfLife: '0.6' },
  water: { materials: '62.4', making: '0.1', transport: '0.1', use: '37.5', endOfLife: '0.1' },
  fossilEnergy: { materials: '35.6', making: '23.4', transport: '4.6', use: '36.3', endOfLife: '0.2' },
};

/** The pinned band moves to each statement's measure, as a picture with nothing to press. */
export function pinnedBand(): Raw {
  const stages = ['materials', 'making', 'transport', 'use', 'endOfLife'];
  return html`<div class="fragment" data-ui="fragment" aria-hidden="true">
    <div class="pin-band" data-part="pin-band" data-measure="climate"
      data-shares="${JSON.stringify(PINNED_SHARES)}">
      ${raw(
        stages
          .map(
            (stage) =>
              `<div class="pin-stratum weave-${stage}" data-stage="${stage}"
                style="--share:${PINNED_SHARES.climate?.[stage] ?? '0'}%"></div>`,
          )
          .join(''),
      )}
    </div>
    <span class="fragment-caption">A strata band</span>
  </div>`;
}

export const rowMenuFragment = fragment(
  `<rect x="6" y="6" width="208" height="26" fill="#EBE4D8"/>
   <rect x="16" y="16" width="70" height="7" fill="#241C14" opacity="0.7"/>
   <rect x="54" y="40" width="130" height="98" fill="#F7F3EC" stroke="#241C14" stroke-width="1.5"/>
   <rect x="66" y="56" width="52" height="8" fill="#241C14" opacity="0.75"/>
   <rect x="66" y="84" width="76" height="8" fill="#241C14" opacity="0.55"/>
   <rect x="66" y="112" width="60" height="8" fill="#241C14" opacity="0.55"/>`,
  'A row action menu',
);

export const meterFragment = fragment(
  `<rect x="54" y="4" width="112" height="142" rx="10" fill="#241C14"/>
   <rect x="62" y="18" width="96" height="114" fill="#F7F3EC"/>
   <rect x="72" y="30" width="60" height="8" fill="#6B5B4D"/>
   <rect x="72" y="48" width="76" height="18" fill="#EBE4D8"/>
   <rect x="72" y="76" width="76" height="12" fill="#2F6B4F"/>
   <rect x="72" y="98" width="48" height="8" fill="#6B5B4D"/>`,
  'A phone meter reading',
);

export const factoryFragment = fragment(
  `<rect x="0" y="86" width="220" height="50" fill="#EBE4D8"/>
   <path d="M20 86V44l28 18V44l28 18V44l28 18V86z" fill="#2F6B4F"/>
   <rect x="120" y="54" width="18" height="32" fill="#6B5B4D"/>
   <rect x="148" y="40" width="12" height="46" fill="#241C14" opacity="0.7"/>`,
  'A factory glyph',
);

export const legFragment = fragment(
  `<path d="M6 110h208" stroke="#241C14" stroke-width="2" stroke-dasharray="10 8"/>
   <rect x="30" y="70" width="70" height="30" fill="#2F6B4F"/>
   <circle cx="48" cy="108" r="8" fill="#241C14"/>
   <circle cx="86" cy="108" r="8" fill="#241C14"/>
   <path d="M150 70l44 30h-44z" fill="#6B5B4D"/>`,
  'A transport leg',
);
