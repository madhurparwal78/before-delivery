// The opening field: floor-to-ceiling near-black, white type, the holder and the countdown.
import { html, useRef, useLayoutEffect } from '../../lib/html.js';
import { fmtCountdown } from '../../lib/format.js';
import { countdownLabel, holderText, capitalised } from './store.js';
import { useMergeTarget } from './lookup.js';

// The field starts below whatever sits above it (the header, the notices, an outage bar) and reaches the bottom of the
// first viewport, so a screenshot of that viewport reads as one near-black field. The page measures where it begins.
function useFieldTop() {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const place = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.setProperty('--field-top', `${Math.round(top)}px`);
    };
    place();
    const watch = new ResizeObserver(place);
    watch.observe(document.body);
    return () => watch.disconnect();
  }, []);
  return ref;
}

export function Field({ incident, shown }) {
  const ref = useFieldTop();
  const text = fmtCountdown(shown.kind === 'none' ? null : shown.remaining);
  const merged = incident.merged_into;
  return html`<section class="night-field" ref=${ref} aria-labelledby="incident-heading">
    <div class="field-head">
      <h1 id="incident-heading"><span class="field-number">Incident #${incident.number}</span><span class="field-title">${incident.title}</span></h1>
      <p class="field-line">
        <span class="field-status">${capitalised(incident.status)}</span>
        <span>${incident.service.name}</span>
        ${incident.status === 'resolved' && incident.resolve_reason && incident.resolve_reason !== 'Resolved'
          ? html`<span>${incident.resolve_reason}</span>` : null}
        ${merged ? html`<span>Merged into <${MergedLink} number=${merged} /></span>` : null}
      </p>
    </div>
    <div class="field-body">
      <section aria-label="Holder" class="holder" data-level=${shown.level} data-cycle=${shown.cycle}
        data-holder=${holderText(shown.holders)} data-remaining-seconds=${shown.remaining}>
        <p class="field-label">Held by</p>
        <p class="holder-name">${holderText(shown.holders)}</p>
      </section>
      <div class="countdown">
        <p class="field-label">${countdownLabel(incident, shown)}</p>
        <div role="timer" aria-label="Incident countdown" class="countdown-figure" style=${`--chars:${text.length}`}>${text}</div>
      </div>
    </div>
  </section>`;
}

function MergedLink({ number }) {
  const target = useMergeTarget(number);
  return target ? html`<a href=${'/incidents/' + target}>Incident #${number}</a>` : html`<span>#${number}</span>`;
}
