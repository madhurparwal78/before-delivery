// The Exposure preview: stops and log H from the shared table and constants (generated from the server's).
import { APERTURES, EV_RANGE, LOG_H_PER_STOP, SHUTTER_DENOMINATORS, SHUTTER_WHOLE_SECONDS } from './domain.js';
import { signed } from './format.js';

export function parseShutter(text) {
  const fraction = /^1\/([0-9]+)$/.exec(text);
  if (fraction && Number(fraction[1]) >= SHUTTER_DENOMINATORS[0] && Number(fraction[1]) <= SHUTTER_DENOMINATORS[1]) {
    return 1 / Number(fraction[1]);
  }
  const seconds = /^([0-9]+)"$/.exec(text);
  if (seconds && Number(seconds[1]) >= SHUTTER_WHOLE_SECONDS[0] && Number(seconds[1]) <= SHUTTER_WHOLE_SECONDS[1]) {
    return Number(seconds[1]);
  }
  return null;
}

export function parseEv(text) {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= EV_RANGE[0] && value <= EV_RANGE[1] ? value : null;
}

function relativeStops(ev, ei, aperture, seconds, reciprocity) {
  const effective = seconds > 1 ? seconds ** reciprocity : seconds;
  return ev + Math.log2(ei / 100) - APERTURES.indexOf(aperture) / 3 + Math.log2(effective);
}

/** `<stops> stops · log H <log_h>`, or an em dash when the roll, shutter or EV cannot be read. */
export function previewText(roll, aperture, shutterText, evText) {
  const seconds = parseShutter(shutterText.trim());
  const ev = parseEv(evText);
  if (!roll || seconds === null || ev === null || !APERTURES.includes(aperture)) return '—';
  const stops = relativeStops(ev, roll.ei, aperture, seconds, roll.reciprocity_p);
  return `${signed(stops)} stops · log H ${signed(stops * LOG_H_PER_STOP)}`;
}
