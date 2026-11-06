/**
 * Catalogue, plate lookup, fit check and quote. None of these needs a session.
 */

import type { Router } from 'express';

import {
  BIKES,
  CONTROLLER,
  DONORS,
  FIXED_LINES,
  FRAME_REVISIONS,
  HUBS,
  HUB_FRAMES,
  HUB_STATION_TRAVELS,
  INSPECTION_FEES,
  MIN_CLEARANCE_TENTHS_MM,
  PACKS,
  PLATE_FORMATS,
  ROAD_CLASS_NAMES,
  SCENE_PARTS,
  STORY_CAPTIONS,
  VAT_RATE_PCT,
  revisionFor,
} from '../../../shared/seed.js';
import { tenthsToOneDecimalString } from '../../../shared/format.js';
import type { RoadClass, Units } from '../../../shared/types.js';
import { amsterdamDate } from '../../domain/clock.js';
import { checkFit } from '../../domain/fit.js';
import { canonicalPlate, invalidPlateMessage, isRegCountry } from '../../domain/plates.js';
import { buildKitQuote } from '../../domain/quote.js';
import { lookupPlate } from '../../providers/registry.js';
import { NOT_CATALOGUED_MESSAGE, resolveDonor } from '../../services/donors.js';
import { validateConfig } from '../../services/orderFlow.js';
import { listSlots } from '../../services/rides.js';
import { donorByModel } from '../../../shared/seed.js';
import { ApiError, ValidationError } from '../errors.js';
import { asyncRoute } from '../context.js';

function unitsOf(raw: unknown): Units {
  return raw === 'imperial' ? 'imperial' : 'metric';
}

export function registerCatalogueRoutes(api: Router): void {
  api.get('/catalogue', (_req, res) => {
    res.status(200).json({
      donors: DONORS.map((donor) => ({
        ...donor,
        // Donors carry their frame revisions.
        revisions: FRAME_REVISIONS.filter((revision) => revision.model === donor.model),
        hubFrame: HUB_FRAMES.find((frame) => frame.model === donor.model) ?? null,
      })),
      packs: PACKS,
      hubs: HUBS,
      parts: SCENE_PARTS,
      roadClasses: ROAD_CLASS_NAMES,
      fixedLines: { ...FIXED_LINES, CTRL: { name: CONTROLLER.name, grossCents: CONTROLLER.grossCents } },
      inspectionFees: INSPECTION_FEES,
      hubStations: HUB_STATION_TRAVELS,
      plateFormats: PLATE_FORMATS,
      vatRates: VAT_RATE_PCT,
      storyCaptions: STORY_CAPTIONS,
      minClearanceMm: tenthsToOneDecimalString(MIN_CLEARANCE_TENTHS_MM),
      bikes: BIKES,
    });
  });

  api.post(
    '/plates/lookup',
    asyncRoute(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!isRegCountry(body.country)) {
        throw new ValidationError({ country: 'Enter NL, BE or DE.' });
      }
      const country = body.country;
      if (typeof body.plate !== 'string') {
        throw new ValidationError({ plate: invalidPlateMessage(country) });
      }

      // An invalid plate makes no registry request.
      const plate = canonicalPlate(body.plate, country);
      if (!plate) throw new ValidationError({ plate: invalidPlateMessage(country) });

      const answer = await lookupPlate(plate, country);
      if (answer.outcome === 'unreachable') throw new ApiError(503, 'registry_unreachable');
      if (answer.outcome === 'not_found') throw new ApiError(404, 'plate_not_found');

      const catalogued = donorByModel(answer.record.model);
      if (!catalogued) throw new ValidationError({ plate: NOT_CATALOGUED_MESSAGE });

      const record = answer.record;
      res.status(200).json({
        plate: record.plate,
        country: record.country,
        model: record.model,
        modelName: catalogued.name,
        firstAdmissionYear: record.firstAdmissionYear,
        roadClass: record.roadClass,
        className: ROAD_CLASS_NAMES[record.country][record.roadClass],
        plateColour: record.plateColour,
        registeredMassKg: tenthsToOneDecimalString(record.registeredMassTenthsKg),
        revision: revisionFor(record.model, record.firstAdmissionYear),
        confirmed: true,
      });
    }),
  );

  api.post(
    '/fit-checks',
    asyncRoute(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const units = unitsOf(body.units);
      const donor = await resolveDonor(body.donor as never);

      const errors: Record<string, string> = {};
      if (typeof body.packId !== 'string' || !PACKS.some((p) => p.id === body.packId)) {
        errors.packId = 'Pick a pack from the catalogue.';
      }
      if (typeof body.hubId !== 'string' || !HUBS.some((h) => h.id === body.hubId)) {
        errors.hubId = 'Pick a hub from the catalogue.';
      }
      const roadClass = Number(body.roadClass);
      if (roadClass !== 25 && roadClass !== 45) errors.roadClass = 'Enter 25 or 45.';
      if (Object.keys(errors).length > 0) throw new ValidationError(errors);

      if (roadClass < donor.roadClass) {
        throw new ValidationError({ roadClass: 'A kit cannot move a scooter down a road class.' });
      }

      res.status(200).json(
        checkFit({
          donor,
          packId: body.packId as string,
          hubId: body.hubId as string,
          roadClass: roadClass as RoadClass,
          units,
        }),
      );
    }),
  );

  api.post(
    '/quotes',
    asyncRoute(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const units = unitsOf(body.units);
      const config = validateConfig({ ...body, units });
      const donor = await resolveDonor(body.donor as never);

      if (config.roadClass < donor.roadClass) {
        throw new ValidationError({ roadClass: 'A kit cannot move a scooter down a road class.' });
      }

      const fit = checkFit({
        donor,
        packId: config.packId,
        hubId: config.hubId,
        roadClass: config.roadClass,
        units,
      });

      // Nothing is stored.
      res.status(200).json(
        buildKitQuote({
          donor,
          packId: config.packId,
          hubId: config.hubId,
          roadClass: config.roadClass,
          fulfilment: config.fulfilment,
          country: config.country,
          amsterdamDate: amsterdamDate(),
          fit,
        }),
      );
    }),
  );

  api.get('/bikes', (req, res) => {
    const filter = req.query.class;
    const roadClass = filter === '25' ? 25 : filter === '45' ? 45 : null;
    const bikes = BIKES.filter((bike) => roadClass === null || bike.roadClass === roadClass)
      // Longest range first.
      .slice()
      .sort((a, b) => b.rangeKm - a.rangeKm);
    res.status(200).json({ bikes });
  });

  api.get(
    '/bikes/:id/slots',
    asyncRoute<{ id: string }>(async (req, res) => {
      const bike = BIKES.find((row) => row.id === req.params.id);
      if (!bike) throw new ApiError(404, 'not_found');
      res.status(200).json({ slots: await listSlots(bike.id) });
    }),
  );
}
