import {
  FEE_STAGE_KEYS,
  isStudioRole,
  regionCurrency,
  STAGE_KEYS,
  type Currency,
  type Region,
  type StageKey,
  type StageState,
} from '../../shared/domain.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { newId } from '../db/ids.js';
import { firstRow, pool, rows, transact, type Queryable } from '../db/pool.js';
import { nextCounter } from '../db/seed.js';
import {
  projectContract,
  projectStores,
  requireProject,
  requireUuid,
  visibleProjects,
} from '../domain/access.js';
import { MAX_CENTS } from '../domain/money.js';
import { asArray, asRecord, Fields } from '../domain/validate.js';
import { jsonReply, type Reply } from '../http/context.js';
import { conflict, notFound } from '../http/errors.js';
import type { Router } from '../http/router.js';

const STORE_CODE = /^[A-Z0-9-]{1,16}$/;

export async function retentionHeldCents(
  client: Queryable,
  projectId: string,
): Promise<number> {
  const row = await firstRow<{ held: number }>(
    client,
    `SELECT COALESCE(SUM(CASE WHEN side = 'credit' THEN amount_cents ELSE -amount_cents END), 0)::bigint
              AS held
       FROM retention_entries
      WHERE project_id = $1 AND account = 'retention_held'`,
    [projectId],
  );
  return row?.held ?? 0;
}

interface StageStateRow {
  key: StageKey;
  state: StageState;
  fee_cents: number | null;
}

export function currentStageKey(stages: readonly StageStateRow[]): StageKey {
  const pending = FEE_STAGE_KEYS.find(
    (key) => stages.find((stage) => stage.key === key)?.state !== 'signed_off',
  );
  return pending ?? 'aftercare';
}

export function registerProjectRoutes(router: Router): void {
  router.get('/api/overview', async (context): Promise<Reply> => {
    const member = await context.member();
    const projects = await visibleProjects(pool, member);
    const studio = isStudioRole(member.role);

    const payload = await Promise.all(
      projects.map(async (project) => {
        const stages = await rows<StageStateRow>(
          pool,
          'SELECT key, state, fee_cents FROM stages WHERE project_id = $1 ORDER BY ord',
          [project.id],
        );
        const base = {
          id: project.id,
          reference: project.reference,
          name: project.name,
          brand: { id: project.brandId, name: project.brandName },
          region: project.region,
          currentStage: currentStageKey(stages),
        };
        if (!studio) return base;
        const fee = (states: readonly StageState[]): number =>
          stages
            .filter((stage) => stage.fee_cents !== null && states.includes(stage.state))
            .reduce((total, stage) => total + (stage.fee_cents ?? 0), 0);
        return {
          ...base,
          currency: project.currency,
          fees: {
            signedOffCents: fee(['signed_off']),
            requestedCents: fee(['requested']),
            notYetRequestedCents: fee(['not_started', 'returned']),
          },
          retentionHeldCents: await retentionHeldCents(pool, project.id),
        };
      }),
    );

    return jsonReply(200, { projects: payload });
  });

  router.post('/api/projects', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead');
    const body = await context.json();
    const fields = new Fields();

    const name = fields.text('name', body.name, { label: 'Name', max: 120, oneLine: true });
    const region = fields.enumeration<Region>('region', body.region, 'Region', ['HK', 'SG', 'MO']);
    const currency = fields.enumeration<Currency>('currency', body.currency, 'Currency', [
      'HKD',
      'SGD',
    ]);
    if (currency !== regionCurrency(region)) {
      fields.add('currency', fieldErrorCopy.currencyMismatch());
    }

    let brandId = '';
    if (typeof body.brandId !== 'string') {
      fields.add('brandId', fieldErrorCopy.required('Brand'));
    } else {
      const brand = await firstRow(pool, 'SELECT 1 FROM brands WHERE id = $1', [
        requireUuid(body.brandId),
      ]);
      if (!brand) fields.add('brandId', fieldErrorCopy.required('Brand'));
      else brandId = body.brandId;
    }

    const feeRecord = asRecord(body.stageFees);
    const fees = new Map<StageKey, number>();
    for (const key of FEE_STAGE_KEYS) {
      fees.set(key, fields.cents(`stageFees.${key}`, feeRecord[key], 'Stage fee', 1, MAX_CENTS));
    }

    const storeList = asArray(body.stores);
    if (storeList.length < 1 || storeList.length > 60) {
      fields.add('stores', fieldErrorCopy.outOfRange('Stores', '1', '60'));
    }
    const seenCodes = new Set<string>();
    const stores = storeList.map((entry, index) => {
      const record = asRecord(entry);
      const code = typeof record.code === 'string' ? record.code : '';
      if (!STORE_CODE.test(code) || seenCodes.has(code)) {
        fields.add(`stores[${index}].code`, fieldErrorCopy.required('Store code'));
      }
      seenCodes.add(code);
      return {
        code,
        name: fields.text(`stores[${index}].name`, record.name, {
          label: 'Store name',
          max: 120,
          oneLine: true,
        }),
        weight: fields.integer(`stores[${index}].weight`, record.weight, 'Weight', 1, 1_000_000),
      };
    });

    const defectsPeriodMonths =
      body.defectsPeriodMonths === undefined
        ? 12
        : fields.integer('defectsPeriodMonths', body.defectsPeriodMonths, 'Defects period', 1, 24);

    fields.finish();

    const project = await transact(async (client) => {
      const sequence = await nextCounter(client, 'project_reference');
      const reference = `MH-${String(sequence).padStart(4, '0')}`;
      const projectId = newId();
      await client.query(
        `INSERT INTO projects (id, reference, name, brand_id, region, currency,
                               defects_period_months)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [projectId, reference, name, brandId, region, currency, defectsPeriodMonths],
      );
      for (const [index, store] of stores.entries()) {
        await client.query(
          `INSERT INTO project_stores (id, project_id, code, name, weight, ord)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [newId(), projectId, store.code, store.name, store.weight, index],
        );
      }
      for (const [index, key] of STAGE_KEYS.entries()) {
        await client.query(
          'INSERT INTO stages (id, project_id, key, ord, fee_cents) VALUES ($1, $2, $3, $4, $5)',
          [newId(), projectId, key, index, fees.get(key) ?? null],
        );
      }
      return { id: projectId, reference };
    });

    return jsonReply(201, {
      project: {
        id: project.id,
        reference: project.reference,
        name,
        brand: { id: brandId },
        region,
        currency,
        defectsPeriodMonths,
        stores,
      },
    });
  });

  router.get('/api/projects/:id', async (context): Promise<Reply> => {
    const member = await context.member();
    const project = await requireProject(pool, context.param('id'), member);
    const contract = await projectContract(pool, project.id);
    return jsonReply(200, {
      project: {
        id: project.id,
        reference: project.reference,
        name: project.name,
        brand: { id: project.brandId, name: project.brandName },
        region: project.region,
        currency: project.currency,
        timeZone: project.timeZone,
        stores: await projectStores(pool, project.id),
        defectsPeriodMonths: project.defectsPeriodMonths,
        practicalCompletionOn: project.practicalCompletionOn,
        defectsEndOn: project.defectsEndOn,
        contract: contract
          ? { companyName: contract.companyName, contractSumCents: contract.contractSumCents }
          : null,
      },
    });
  });

  router.post('/api/projects/:id/contract', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead');
    const project = await requireProject(pool, context.param('id'), member);
    const body = await context.json();

    if (await projectContract(pool, project.id)) throw conflict('contract_exists');

    const fields = new Fields();
    let companyId = '';
    if (typeof body.companyId !== 'string') {
      fields.add('companyId', fieldErrorCopy.required('Company'));
    } else {
      const company = await firstRow(pool, 'SELECT 1 FROM companies WHERE id = $1', [
        requireUuid(body.companyId),
      ]);
      if (!company) fields.add('companyId', fieldErrorCopy.required('Company'));
      else companyId = body.companyId;
    }
    const contractSumCents = fields.cents(
      'contractSumCents',
      body.contractSumCents,
      'Contract sum',
      1,
      MAX_CENTS,
    );
    fields.finish();

    await pool.query(
      'INSERT INTO contracts (id, project_id, company_id, contract_sum_cents) VALUES ($1, $2, $3, $4)',
      [newId(), project.id, companyId, contractSumCents],
    );
    const contract = await projectContract(pool, project.id);
    if (!contract) throw notFound();
    return jsonReply(201, {
      contract: { companyName: contract.companyName, contractSumCents: contract.contractSumCents },
    });
  });
}
