import { model as modelDef, type HubId, type ModelId } from '../../shared/catalogue.js';
import { roundHalfUp } from '../../shared/money.js';
import type { Quote } from '../../shared/types.js';
import { istDate } from '../clock.js';
import { referenceData } from '../db.js';

function stepInForce<T extends { from: string }>(steps: readonly T[], date: string): T {
  let current: T | null = null;
  for (const step of steps) if (step.from <= date) current = step;
  if (!current) throw new Error('no price step in force');
  return current;
}

/** The on-road make-up, decided only here. */
export function quoteFor(model: ModelId, hub: HubId, at: Date): Quote {
  const data = referenceData();
  const date = istDate(at);
  const priceStep = stepInForce(data.priceSteps.get(model) ?? [], date);
  const taxStep = stepInForce(data.roadTaxSteps.get(hub) ?? [], date);
  const def = modelDef(model);
  const gstPaise = roundHalfUp((priceStep.exFactoryPaise * def.gstPercent) / 100);
  const exShowroomPaise = priceStep.exFactoryPaise + gstPaise;
  const roadTaxPaise = roundHalfUp((exShowroomPaise * taxStep.percent) / 100);
  return {
    stepEffectiveFrom: priceStep.from > taxStep.from ? priceStep.from : taxStep.from,
    exFactoryPaise: priceStep.exFactoryPaise,
    gstPercent: def.gstPercent,
    gstPaise,
    exShowroomPaise,
    roadTaxPercent: taxStep.percent,
    roadTaxPaise,
    insurancePaise: def.insurancePaise,
    onRoadPaise: exShowroomPaise + roadTaxPaise + def.insurancePaise,
  };
}

/** Step dates that fall inside a window, so a hub's sequence can rise at midnight IST. */
export function stepDatesIn(hub: HubId, fromDate: string, toDate: string): string[] {
  const data = referenceData();
  const dates = new Set<string>();
  for (const steps of data.priceSteps.values()) {
    for (const step of steps) if (step.from > fromDate && step.from <= toDate) dates.add(step.from);
  }
  for (const step of data.roadTaxSteps.get(hub) ?? []) {
    if (step.from > fromDate && step.from <= toDate) dates.add(step.from);
  }
  return [...dates];
}
