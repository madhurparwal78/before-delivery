import { createHash } from 'node:crypto';
import type { AdvisoryDto, RecordDto, Stance, TapeStepDto } from '../../shared/types';

export interface ProviderDefect {
  text: string;
  type: string;
  dangerous: boolean;
}

export interface ProviderTest {
  completedDate: string;
  motTestNumber: string;
  testResult: string;
  expiryDate: string | null;
  odometerValue: string | null;
  odometerUnit: string | null;
  odometerResultType: string;
  defects: ProviderDefect[];
}

export interface ProviderVehicle {
  registration: string;
  make: string;
  model: string;
  firstUsedDate: string;
  motTests: ProviderTest[];
}

const KM_PER_MILE = 1.609344;

const toOneDecimal = (value: number): number => Math.round(value * 10) / 10;

/** The advisory's identity is its test number plus its exact text. */
export const advisoryId = (motTestNumber: string, text: string): string =>
  createHash('sha256').update(`${motTestNumber}\u0000${text}`).digest('hex').slice(0, 24);

/** Steps oldest first, with each read step compared against the previous read step. */
export const buildTape = (tests: readonly ProviderTest[]): TapeStepDto[] => {
  const ordered = [...tests].sort((a, b) => Date.parse(a.completedDate) - Date.parse(b.completedDate));
  const steps: TapeStepDto[] = [];
  let previousRead: { km: number; unit: string } | null = null;

  for (const test of ordered) {
    const common = {
      motTestNumber: test.motTestNumber,
      completedDate: test.completedDate,
      testResult: test.testResult,
      odometerValue: test.odometerValue,
      odometerUnit: test.odometerUnit,
      defects: test.defects.map((d) => ({ type: d.type, text: d.text, dangerous: d.dangerous })),
    };

    if (test.odometerResultType === 'NO_ODOMETER' || test.odometerResultType === 'UNREADABLE') {
      steps.push({
        ...common,
        status: 'skipped',
        normalisedKm: null,
        flag: test.odometerResultType === 'NO_ODOMETER' ? 'no_odometer' : 'unreadable',
      });
      continue;
    }

    const unit = test.odometerUnit ?? 'MI';
    const raw = Number(test.odometerValue);
    const km = toOneDecimal(unit === 'MI' ? raw * KM_PER_MILE : raw);

    let flag: TapeStepDto['flag'] = null;
    if (previousRead !== null) {
      if (km < previousRead.km - 1) flag = 'drop';
      else if (unit !== previousRead.unit) flag = 'unit_change';
    }
    previousRead = { km, unit };

    steps.push({ ...common, status: 'read', normalisedKm: km, flag });
  }

  return steps;
};

export interface StoredResponse {
  stance: Stance;
  note: string;
  answeredAt: string;
}

/** Every defect of type ADVISORY in any test of the latest pull, newest test first. */
export const buildAdvisories = (
  tests: readonly ProviderTest[],
  responses: ReadonlyMap<string, StoredResponse>,
): AdvisoryDto[] => {
  const ordered = [...tests].sort((a, b) => Date.parse(b.completedDate) - Date.parse(a.completedDate));
  const advisories: AdvisoryDto[] = [];

  for (const test of ordered) {
    for (const defect of test.defects) {
      if (defect.type !== 'ADVISORY') continue;
      const id = advisoryId(test.motTestNumber, defect.text);
      const response = responses.get(id);
      advisories.push({
        id,
        motTestNumber: test.motTestNumber,
        text: defect.text,
        stance: response?.stance ?? null,
        note: response?.note ?? null,
        answeredAt: response?.answeredAt ?? null,
        recurred: response?.stance === 'repaired' && textReturnsLater(tests, test, defect.text),
      });
    }
  }

  return advisories;
};

/** True when the exact text appears as an ADVISORY on a test with a later completed date. */
export const textReturnsLater = (
  tests: readonly ProviderTest[],
  answeredOn: { motTestNumber: string; completedDate: string },
  text: string,
): boolean => {
  const answeredAt = Date.parse(answeredOn.completedDate);
  return tests.some(
    (test) =>
      Date.parse(test.completedDate) > answeredAt &&
      test.defects.some((defect) => defect.type === 'ADVISORY' && defect.text === text),
  );
};

/**
 * Advisories whose stance is not `repaired`, including unanswered ones, plus every
 * recurred advisory.
 */
export const openAdvisoryTally = (advisories: readonly AdvisoryDto[]): number =>
  advisories.filter((advisory) => advisory.stance !== 'repaired' || advisory.recurred).length;

export const buildRecord = (
  pulledAt: string,
  payload: ProviderVehicle,
  responses: ReadonlyMap<string, StoredResponse>,
): RecordDto => {
  const advisories = buildAdvisories(payload.motTests, responses);
  return {
    pulledAt,
    firstUsedDate: payload.firstUsedDate,
    tape: buildTape(payload.motTests),
    advisories,
    openAdvisories: openAdvisoryTally(advisories),
  };
};
