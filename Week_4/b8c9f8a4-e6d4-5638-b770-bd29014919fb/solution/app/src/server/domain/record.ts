// The roadworthiness record: the odometer tape, the advisories and the open tally. The upstream
// reply is kept as it arrived; everything the product shows is derived from it here.

import { createHash } from 'node:crypto';
import { KM_PER_MILE } from '../../shared/measures.js';

type OdometerFlag = 'unit_change' | 'drop' | 'no_odometer' | 'unreadable' | null;

interface Defect {
  text: string;
  type: string;
  dangerous: boolean;
}

interface MotTest {
  completedDate: string;
  motTestNumber: string;
  testResult: string;
  expiryDate: string | null;
  odometerValue: string | null;
  odometerUnit: string | null;
  odometerResultType: string;
  defects: Defect[];
}

export interface RecordPayload {
  registration: string;
  make: string;
  model: string;
  firstUsedDate: string;
  motTests: MotTest[];
}

interface TapeStep {
  motTestNumber: string;
  completedDate: string;
  testResult: string;
  status: 'read' | 'skipped';
  odometerValue: string | null;
  odometerUnit: string | null;
  normalisedKm: number | null;
  flag: OdometerFlag;
  defects: Defect[];
}

interface Advisory {
  id: string;
  motTestNumber: string;
  text: string;
  stance: string | null;
  note: string | null;
  answeredAt: string | null;
  recurred: boolean;
}

export interface ConditionRecord {
  pulledAt: string;
  firstUsedDate: string;
  tape: TapeStep[];
  advisories: Advisory[];
  openAdvisories: number;
}

export const STANCES = ['repaired', 'monitoring', 'not_repaired'];

/** An advisory is its test number plus its exact text, so a response carries across re-pulls. */
export function advisoryId(motTestNumber: string, text: string): string {
  return createHash('sha256').update(`${motTestNumber}\u0000${text}`).digest('hex').slice(0, 24);
}

function tests(payload: RecordPayload): MotTest[] {
  return [...payload.motTests].sort(
    (a, b) => new Date(a.completedDate).getTime() - new Date(b.completedDate).getTime(),
  );
}

/** Steps oldest first; a read step compares with the previous read step. */
function buildTape(payload: RecordPayload): TapeStep[] {
  const steps: TapeStep[] = [];
  let previous: TapeStep | null = null;
  for (const test of tests(payload)) {
    const kind = test.odometerResultType;
    if (kind === 'NO_ODOMETER' || kind === 'UNREADABLE' || test.odometerValue === null || test.odometerUnit === null) {
      steps.push({
        motTestNumber: test.motTestNumber,
        completedDate: test.completedDate,
        testResult: test.testResult,
        status: 'skipped',
        odometerValue: test.odometerValue,
        odometerUnit: test.odometerUnit,
        normalisedKm: null,
        flag: kind === 'UNREADABLE' ? 'unreadable' : 'no_odometer',
        defects: test.defects ?? [],
      });
      continue;
    }
    const value = Number(test.odometerValue);
    const kilometres = test.odometerUnit === 'MI' ? value * KM_PER_MILE : value;
    const normalisedKm = Math.round(kilometres * 10) / 10;
    let flag: OdometerFlag = null;
    if (previous && previous.normalisedKm !== null) {
      if (normalisedKm < previous.normalisedKm - 1) flag = 'drop';
      else if (test.odometerUnit !== previous.odometerUnit) flag = 'unit_change';
    }
    const step: TapeStep = {
      motTestNumber: test.motTestNumber,
      completedDate: test.completedDate,
      testResult: test.testResult,
      status: 'read',
      odometerValue: test.odometerValue,
      odometerUnit: test.odometerUnit,
      normalisedKm,
      flag,
      defects: test.defects ?? [],
    };
    steps.push(step);
    previous = step;
  }
  return steps;
}

export interface StoredResponse {
  advisory_id: string;
  stance: string;
  note: string;
  answered_at: Date;
}

/** Every ADVISORY defect of the latest pull, with its answer and whether it has returned. */
export function buildAdvisories(payload: RecordPayload, responses: StoredResponse[]): Advisory[] {
  const answers = new Map(responses.map((item) => [item.advisory_id, item]));
  const ordered = tests(payload);
  const found: Advisory[] = [];
  for (const test of ordered) {
    for (const defect of test.defects ?? []) {
      if (defect.type !== 'ADVISORY') continue;
      const id = advisoryId(test.motTestNumber, defect.text);
      if (found.some((item) => item.id === id)) continue;
      const answer = answers.get(id);
      found.push({
        id,
        motTestNumber: test.motTestNumber,
        text: defect.text,
        stance: answer?.stance ?? null,
        note: answer?.note ?? null,
        answeredAt: answer ? new Date(answer.answered_at).toISOString() : null,
        recurred: false,
      });
    }
  }
  for (const advisory of found) {
    advisory.recurred = advisory.stance === 'repaired' && hasLaterTest(ordered, advisory);
  }
  return found;
}

/** The same exact text on an ADVISORY of a test with a later completed date. */
export function hasLaterTest(ordered: MotTest[], advisory: { motTestNumber: string; text: string }): boolean {
  const own = ordered.find((test) => test.motTestNumber === advisory.motTestNumber) as MotTest; // the advisory came from these tests
  const when = new Date(own.completedDate).getTime();
  return ordered.some(
    (test) =>
      new Date(test.completedDate).getTime() > when &&
      (test.defects ?? []).some((defect) => defect.type === 'ADVISORY' && defect.text === advisory.text),
  );
}

/** Advisories whose stance is not repaired, plus every recurred one. */
export function openAdvisories(advisories: Advisory[]): number {
  return advisories.filter((item) => item.stance !== 'repaired' || item.recurred).length;
}

export function buildRecord(pulledAt: Date, payload: RecordPayload, responses: StoredResponse[]): ConditionRecord {
  const advisories = buildAdvisories(payload, responses);
  return {
    pulledAt: pulledAt.toISOString(),
    firstUsedDate: payload.firstUsedDate,
    tape: buildTape(payload),
    advisories,
    openAdvisories: openAdvisories(advisories),
  };
}
