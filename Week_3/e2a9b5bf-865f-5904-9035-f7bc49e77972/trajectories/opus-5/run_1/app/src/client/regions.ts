import { setStatus } from './dom.js';

/** The live status regions of whatever screen is open. */
export interface Regions {
  connection: HTMLElement | null;
  syncResults: HTMLElement | null;
  saveStatus: HTMLElement | null;
  fieldAnnouncements: HTMLElement | null;
  opticsReadout: HTMLElement | null;
  pairReadout: HTMLElement | null;
  localTime: HTMLElement | null;
  tonightStatus: HTMLElement | null;
  programsStatus: HTMLElement | null;
  programRules: HTMLElement | null;
  packetStatus: HTMLElement | null;
  packetRowsStatus: HTMLElement | null;
  kitStatus: HTMLElement | null;
  accountProblem: HTMLElement | null;
}

export const regions: Regions = {
  connection: null,
  syncResults: null,
  saveStatus: null,
  fieldAnnouncements: null,
  opticsReadout: null,
  pairReadout: null,
  localTime: null,
  tonightStatus: null,
  programsStatus: null,
  programRules: null,
  packetStatus: null,
  packetRowsStatus: null,
  kitStatus: null,
  accountProblem: null,
};

export function clearScreenRegions(): void {
  regions.saveStatus = null;
  regions.fieldAnnouncements = null;
  regions.opticsReadout = null;
  regions.pairReadout = null;
  regions.localTime = null;
  regions.tonightStatus = null;
  regions.programsStatus = null;
  regions.programRules = null;
  regions.packetStatus = null;
  regions.packetRowsStatus = null;
  regions.kitStatus = null;
  regions.accountProblem = null;
}

/** Sync results holds one line per sentence, each shown exactly once. */
export function announceSync(sentences: string[]): void {
  const node = regions.syncResults;
  if (!node || sentences.length === 0) return;
  for (const sentence of sentences) {
    const line = document.createElement('p');
    line.textContent = sentence;
    node.append(line);
  }
  while (node.childElementCount > 40) node.firstElementChild?.remove();
}

export function announceField(sentence: string): void {
  setStatus(regions.fieldAnnouncements, sentence);
}

export function announceSave(sentence: string): void {
  setStatus(regions.saveStatus, sentence);
}
