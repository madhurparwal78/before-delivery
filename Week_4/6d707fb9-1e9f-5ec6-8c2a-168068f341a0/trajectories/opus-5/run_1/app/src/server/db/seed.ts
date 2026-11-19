import { createHash } from 'node:crypto';
import { one, query, withSeedLock } from './pool';
import { EDITION_2026_2, EDITION_2027_1, SEED_PASSWORD } from './seedData';
import { Decimal, dec } from '../domain/decimal';
import type { CountryId, FactorRow, ModeId } from '../domain/factors';
import {
  type FootprintInput,
  indexRows,
  workOutDataQuality,
  workOutFootprint,
} from '../domain/footprint';
import { LISBON, TOWNS, dayHours, localDate, nextLocalDate, wallToInstants } from '../domain/time';
import { hashPassword, newId, newToken, nextSortIndex } from '../ids';
import type { FibreShare, StyleRowRecord, Tier } from '../store/rows';
import { scoreShown } from '../store/read';

interface SeedLine {
  materialId: string;
  massGrams: string;
  fibreName: string;
  tier1: Tier | null;
  tier2: Tier | null;
  tier3: Tier | null;
}

interface SeedStyle {
  styleCode: string;
  name: string;
  label: string;
  season: string;
  gtin: string;
  garment: 'tshirt' | 'shirt' | 'jeans' | 'coat';
  line: SeedLine | null;
  leg: { mode: ModeId; km: string } | null;
  state: 'draft' | 'worked' | 'published' | 'archived';
  repairService?: boolean;
  rangeSize?: number;
  notes?: string;
}

function tier(factory: string, town: string, country: CountryId): Tier {
  return { factory, town, country };
}

const MARTA_LABELS = [
  { name: 'Mar\u00e9 Alta', contactName: 'In\u00eas Barros', contactEmail: 'ines@mare-alta.example' },
  { name: 'Linho & Sal', contactName: 'Tom\u00e1s Leite', contactEmail: 'tomas@linho-sal.example' },
  { name: 'Atelier Noroeste', contactName: 'Clara Pinto', contactEmail: 'clara@atelier-noroeste.example' },
];

const SUPPLIERS = [
  {
    name: 'Y\u0131ld\u0131z \u0130plik',
    label: 'Mar\u00e9 Alta',
    town: 'izmir' as const,
    language: 'tr' as const,
    contactName: 'Ay\u015fe Demir',
    contactEmail: 'ayse@yildiz-iplik.example',
  },
  {
    name: 'Coton Bio \u00c9thique',
    label: 'Mar\u00e9 Alta',
    town: 'hoChiMinhCity' as const,
    language: 'fr' as const,
    contactName: 'Camille Nguyen',
    contactEmail: 'camille@coton-bio.example',
  },
  {
    name: 'Fia\u00e7\u00e3o do Ave',
    label: 'Atelier Noroeste',
    town: 'porto' as const,
    language: 'en' as const,
    contactName: 'Rui Matos',
    contactEmail: 'rui@fiacao-ave.example',
  },
  {
    name: 'Nile Delta Weaving',
    label: 'Linho & Sal',
    town: 'cairo' as const,
    language: 'ar' as const,
    contactName: 'Salma Hassan',
    contactEmail: 'salma@nile-delta.example',
  },
];

const MARTA_STYLES: SeedStyle[] = [
  {
    styleCode: 'HT-01',
    name: 'Harbour Tee',
    label: 'Mar\u00e9 Alta',
    season: 'AW27',
    gtin: '4006381333931',
    garment: 'tshirt',
    line: {
      materialId: 'organic-cotton',
      massGrams: '250',
      fibreName: 'Organic cotton',
      tier1: tier('Y\u0131ld\u0131z \u0130plik', 'Izmir', 'TR'),
      tier2: tier('Ege Dokuma', 'Izmir', 'TR'),
      tier3: tier('Surat Fibre Co-op', 'Surat', 'IN'),
    },
    leg: { mode: 'road', km: '3200' },
    state: 'published',
    repairService: false,
    rangeSize: 100000,
    notes: 'Check dye house meter in spring.',
  },
  {
    styleCode: 'QS-01',
    name: 'Quay Shirt',
    label: 'Mar\u00e9 Alta',
    season: 'AW27',
    gtin: '5600000000014',
    garment: 'shirt',
    line: {
      materialId: 'linen',
      massGrams: '300',
      fibreName: 'Linen',
      tier1: tier('Coton Bio \u00c9thique', 'Ho Chi Minh City', 'VN'),
      tier2: tier('Saigon Looms', 'Ho Chi Minh City', 'VN'),
      tier3: tier('Mekong Flax', 'Can Tho', 'VN'),
    },
    leg: { mode: 'sea', km: '10000' },
    state: 'worked',
  },
  {
    styleCode: 'EC-01',
    name: 'Estuary Coat',
    label: 'Atelier Noroeste',
    season: 'AW27',
    gtin: '5600000000021',
    garment: 'coat',
    line: {
      materialId: 'wool',
      massGrams: '1200',
      fibreName: 'Wool',
      tier1: tier('Fia\u00e7\u00e3o do Ave', 'Porto', 'PT'),
      tier2: null,
      tier3: null,
    },
    leg: { mode: 'road', km: '450' },
    state: 'worked',
  },
  {
    styleCode: 'DJ-01',
    name: 'Delta Jeans',
    label: 'Linho & Sal',
    season: 'SS27',
    gtin: '5600000000038',
    garment: 'jeans',
    line: {
      materialId: 'cotton',
      massGrams: '800',
      fibreName: 'Cotton',
      tier1: tier('Nile Delta Weaving', 'Cairo', 'EG'),
      tier2: null,
      tier3: null,
    },
    leg: null,
    state: 'draft',
  },
  {
    styleCode: 'RP-01',
    name: 'Ribeira Polo',
    label: 'Linho & Sal',
    season: 'SS27',
    gtin: '5600000000045',
    garment: 'tshirt',
    line: {
      materialId: 'cotton',
      massGrams: '220',
      fibreName: 'Cotton',
      tier1: null,
      tier2: null,
      tier3: null,
    },
    leg: null,
    state: 'archived',
  },
];

async function makeAssessor(name: string, email: string, now: number): Promise<string> {
  const id = newId();
  await query('insert into assessors (id, name, email, password_hash, created_at) values ($1,$2,$3,$4,$5)', [
    id,
    name,
    email,
    hashPassword(SEED_PASSWORD),
    now,
  ]);
  return id;
}

async function makeLabel(
  assessorId: string,
  label: { name: string; contactName: string; contactEmail: string },
  now: number,
): Promise<string> {
  const id = newId();
  await query(
    `insert into labels (id, assessor_id, name, contact_name, contact_email, state, created_at, sort_index)
     values ($1,$2,$3,$4,$5,'open',$6,$7)`,
    [id, assessorId, label.name, label.contactName, label.contactEmail, now, nextSortIndex()],
  );
  return id;
}

async function makeStyle(
  assessorId: string,
  labelId: string,
  style: SeedStyle,
  now: number,
): Promise<{ styleId: string; lineId: string | null }> {
  const styleId = newId();
  await query(
    `insert into styles (id, assessor_id, label_id, style_code, name, season, gtin, garment, washes,
      repair_service, range_size, notes, state, version, changed_at, created_at, sort_index)
     values ($1,$2,$3,$4,$5,$6,$7,$8,30,$9,$10,$11,$12,1,$13,$13,$14)`,
    [
      styleId,
      assessorId,
      labelId,
      style.styleCode,
      style.name,
      style.season,
      style.gtin,
      style.garment,
      style.repairService ?? null,
      style.rangeSize ?? null,
      style.notes ?? null,
      style.state,
      now,
      nextSortIndex(),
    ],
  );
  let lineId: string | null = null;
  if (style.line) {
    lineId = newId();
    const fibres: FibreShare[] = [{ name: style.line.fibreName, sharePercent: '100.0' }];
    await query(
      `insert into material_lines (id, style_id, position, material_id, mass_grams, fibres, tier1, tier2, tier3,
        created_at) values ($1,$2,1,$3,$4,$5,$6,$7,$8,$9)`,
      [
        lineId,
        styleId,
        style.line.materialId,
        style.line.massGrams,
        JSON.stringify(fibres),
        style.line.tier1 === null ? null : JSON.stringify(style.line.tier1),
        style.line.tier2 === null ? null : JSON.stringify(style.line.tier2),
        style.line.tier3 === null ? null : JSON.stringify(style.line.tier3),
        now,
      ],
    );
  }
  if (style.leg) {
    await query(
      'insert into transport_legs (id, style_id, position, mode, km, created_at) values ($1,$2,1,$3,$4,$5)',
      [newId(), styleId, style.leg.mode, style.leg.km, now],
    );
  }
  return { styleId, lineId };
}

interface SeedResultInput {
  materialId: string;
  massGrams: string;
  tier1Country: CountryId;
  answeredOrigin: boolean;
  leg: { mode: ModeId; km: string } | null;
}

async function makeResult(
  styleId: string,
  edition: string,
  rows: FactorRow[],
  details: SeedResultInput,
  workedOutAt: number,
  isCurrent: boolean,
): Promise<string> {
  const input: FootprintInput = {
    lines: [
      {
        materialId: details.materialId,
        massGrams: dec(details.massGrams),
        tier1Country: details.tier1Country,
        answeredEnergyMjPerKg: null,
        answeredWaterLitresPerKg: null,
        hasAnsweredFacts: details.answeredOrigin,
      },
    ],
    legs: details.leg ? [{ mode: details.leg.mode, km: dec(details.leg.km) }] : [],
    washes: 30,
  };
  const measures = workOutFootprint(input, indexRows(rows));
  const quality = workOutDataQuality(input.lines);
  const lineRow = await one<{ id: string }>('select id from material_lines where style_id = $1', [styleId]);
  const kept = {
    lines: [
      {
        lineId: lineRow?.id ?? newId(),
        materialId: details.materialId,
        massGrams: dec(details.massGrams).toFixed(),
        tier1Country: details.tier1Country,
        answeredEnergyMjPerKg: null,
        answeredWaterLitresPerKg: null,
        hasAnsweredFacts: details.answeredOrigin,
      },
    ],
    legs: details.leg ? [{ mode: details.leg.mode, km: dec(details.leg.km).toFixed() }] : [],
    washes: 30,
  };
  const id = newId();
  await query(
    `insert into results (id, style_id, edition, worked_out_at, data_quality_percent, data_quality_grade,
      measures, factor_rows, input, is_current, sort_index)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      styleId,
      edition,
      workedOutAt,
      quality.dataQualityPercent,
      quality.dataQualityGrade,
      JSON.stringify(measures),
      JSON.stringify(rows),
      JSON.stringify(kept),
      isCurrent,
      nextSortIndex(),
    ],
  );
  return id;
}

function instantOf(text: string): number {
  return Math.floor(Date.parse(text) / 1000);
}

/** The next Lisbon day that does not have 24 hours, counted from today. */
function nextClockChangeDate(today: string): string {
  let date = today;
  for (let step = 0; step < 400; step += 1) {
    date = nextLocalDate(date);
    if (dayHours(date, LISBON) !== 24) return date;
  }
  return date;
}

function addDays(date: string, days: number): string {
  let moved = date;
  for (let step = 0; step < Math.abs(days); step += 1) {
    moved = days > 0 ? nextLocalDate(moved) : previousLocalDate(moved);
  }
  return moved;
}

function previousLocalDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(year, month - 1, day - 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}-${String(moved.getUTCDate()).padStart(2, '0')}`;
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, held]) => `${JSON.stringify(key)}:${sortedJson(held)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** On an empty database the app creates exactly the published seed and nothing else. */
export async function applySeed(now: number): Promise<void> {
  await withSeedLock(async () => {
    const marker = await one<{ done: boolean }>('select done from seed_marker where id = 1');
    if (marker) return;

    const martaId = await makeAssessor('Marta Quintela', 'marta@fio-contado.example', now);
    const irisId = await makeAssessor('Iris Vandeputte', 'iris@fio-contado.example', now);

    const labelIds = new Map<string, string>();
    for (const label of MARTA_LABELS) {
      labelIds.set(label.name, await makeLabel(martaId, label, now));
    }

    const supplierIds = new Map<string, string>();
    for (const supplier of SUPPLIERS) {
      const id = newId();
      await query(
        `insert into suppliers (id, label_id, name, town, language, contact_name, contact_email, first_sent_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          labelIds.get(supplier.label) as string,
          supplier.name,
          supplier.town,
          supplier.language,
          supplier.contactName,
          supplier.contactEmail,
          now,
        ],
      );
      supplierIds.set(supplier.name, id);
    }

    const styleIds = new Map<string, string>();
    const lineIds = new Map<string, string>();
    for (const style of MARTA_STYLES) {
      const made = await makeStyle(martaId, labelIds.get(style.label) as string, style, now);
      styleIds.set(style.name, made.styleId);
      if (made.lineId) lineIds.set(style.name, made.lineId);
    }

    const harbourTee = styleIds.get('Harbour Tee') as string;
    const quayShirt = styleIds.get('Quay Shirt') as string;
    const estuaryCoat = styleIds.get('Estuary Coat') as string;

    // Quay Shirt's answered request gave fibre origin VN only.
    await query('update material_lines set answered_origin = $1 where style_id = $2', ['VN', quayShirt]);

    await makeResult(
      harbourTee,
      '2026.2',
      EDITION_2026_2,
      { materialId: 'organic-cotton', massGrams: '250', tier1Country: 'TR', answeredOrigin: false, leg: { mode: 'road', km: '3200' } },
      instantOf('2026-03-10T09:00:00Z'),
      false,
    );
    const harbourLatest = await makeResult(
      harbourTee,
      '2027.1',
      EDITION_2027_1,
      { materialId: 'organic-cotton', massGrams: '250', tier1Country: 'TR', answeredOrigin: false, leg: { mode: 'road', km: '3200' } },
      instantOf('2026-09-15T09:00:00Z'),
      true,
    );
    await makeResult(
      quayShirt,
      '2026.2',
      EDITION_2026_2,
      { materialId: 'linen', massGrams: '300', tier1Country: 'VN', answeredOrigin: true, leg: { mode: 'sea', km: '10000' } },
      instantOf('2026-03-12T09:00:00Z'),
      true,
    );
    await makeResult(
      estuaryCoat,
      '2027.1',
      EDITION_2027_1,
      { materialId: 'wool', massGrams: '1200', tier1Country: 'PT', answeredOrigin: false, leg: { mode: 'road', km: '450' } },
      instantOf('2026-09-16T09:00:00Z'),
      true,
    );

    const mareAlta = labelIds.get('Mar\u00e9 Alta') as string;
    await query(
      `insert into supplier_requests (id, assessor_id, label_id, style_id, line_id, supplier_id, supplier_name,
        contact_name, contact_email, town, language, questions, due_date, state, sent_at, ends_at, token,
        token_ended, sort_index)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'izmir','tr',$10,$11,'ended',$12,$12,$13,true,$14)`,
      [
        newId(),
        martaId,
        mareAlta,
        harbourTee,
        lineIds.get('Harbour Tee') as string,
        supplierIds.get('Y\u0131ld\u0131z \u0130plik') as string,
        'Y\u0131ld\u0131z \u0130plik',
        'Ay\u015fe Demir',
        'ayse@yildiz-iplik.example',
        JSON.stringify(['energy', 'water', 'fibreOrigin']),
        localDate(now, TOWNS.izmir.zone),
        now,
        newToken(),
        nextSortIndex(),
      ],
    );
    await query(
      `insert into supplier_requests (id, assessor_id, label_id, style_id, line_id, supplier_id, supplier_name,
        contact_name, contact_email, town, language, questions, due_date, state, sent_at, ends_at, answered_at,
        token, token_ended, answer, sort_index)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'hoChiMinhCity','fr',$10,$11,'answered',$12,$13,$12,$14,false,$15,$16)`,
      [
        newId(),
        martaId,
        mareAlta,
        quayShirt,
        lineIds.get('Quay Shirt') as string,
        supplierIds.get('Coton Bio \u00c9thique') as string,
        'Coton Bio \u00c9thique',
        'Camille Nguyen',
        'camille@coton-bio.example',
        JSON.stringify(['fibreOrigin']),
        localDate(now, TOWNS.hoChiMinhCity.zone),
        now,
        now + 1209600,
        newToken(),
        JSON.stringify({
          energyValue: null,
          energyUnit: null,
          energyMjPerKg: null,
          waterLitresPerKg: null,
          fibreOrigin: 'VN',
          evidenceIds: [],
          answeredAt: `${new Date(now * 1000).toISOString().slice(0, 19)}Z`,
          state: 'answered',
        }),
        nextSortIndex(),
      ],
    );

    const harbourStyle = (await one<StyleRowRecord>('select * from styles where id = $1', [
      harbourTee,
    ])) as StyleRowRecord;
    const scoreBody = {
      gtin: harbourStyle.gtin,
      garment: harbourStyle.garment,
      massGrams: new Decimal('250').toFixed(),
      washes: 30,
      materials: [{ id: 'organic-cotton', sharePercent: '100.0', tier1: 'TR', tier2: 'TR', tier3: 'IN' }],
      repairService: false,
      rangeSize: 100000,
    };
    await query(
      `insert into scores (style_id, state, score, per100g, run_id, body_hash, worst_case, asked_at)
       values ($1,'current',1240,412,'run-seed',$2,'[]'::jsonb,$3)`,
      [harbourTee, createHash('sha256').update(sortedJson(scoreBody)).digest('hex'), now],
    );

    const latest = (await one<{
      edition: string;
      data_quality_percent: number;
      data_quality_grade: string;
      measures: { measure: string; totalShown: string }[];
    }>('select edition, data_quality_percent, data_quality_grade, measures from results where id = $1', [
      harbourLatest,
    ])) as {
      edition: string;
      data_quality_percent: number;
      data_quality_grade: string;
      measures: { measure: string; totalShown: string }[];
    };
    await query(
      `insert into passports (id, style_id, label_id, gtin, edition, state, published_at, corrected_on, snapshot)
       values ($1,$2,$3,$4,1,'published',$5,null,$6)`,
      [
        newId(),
        harbourTee,
        mareAlta,
        harbourStyle.gtin,
        instantOf('2026-09-20T10:00:00Z'),
        JSON.stringify({
          styleName: 'Harbour Tee',
          labelName: 'Mar\u00e9 Alta',
          garment: 'tshirt',
          factorEdition: latest.edition,
          dataQualityPercent: latest.data_quality_percent,
          dataQualityGrade: latest.data_quality_grade,
          score: 1240,
          per100g: 412,
          scoreShown: scoreShown(1240, 412),
          measures: latest.measures.map((measure) => ({
            measure: measure.measure,
            totalShown: measure.totalShown,
          })),
        }),
      ],
    );
    await query('insert into published_gtins (gtin, style_id) values ($1,$2)', [harbourStyle.gtin, harbourTee]);

    await query(
      `insert into dossiers (id, style_id, label_id, result_id, edition, state, made_at, signed_off_by,
        signed_off_at, sort_index) values ($1,$2,$3,$4,$5,'signedOff',$6,$7,$8,$9)`,
      [
        newId(),
        harbourTee,
        mareAlta,
        harbourLatest,
        latest.edition,
        instantOf('2026-09-22T15:00:00Z'),
        'In\u00eas Barros',
        instantOf('2026-09-22T15:00:00Z'),
        nextSortIndex(),
      ],
    );

    const today = localDate(now, LISBON);
    const change = nextClockChangeDate(today);
    for (const visitDate of [addDays(change, -2), addDays(change, 1)]) {
      const [year, month, day] = visitDate.split('-').map(Number) as [number, number, number];
      const at = wallToInstants({ year, month, day, hour: 7, minute: 20, second: 0 }, TOWNS.izmir.zone)[0] as number;
      await query(
        `insert into visits (id, assessor_id, label_id, factory_name, town, local_date, local_time, at, created_at)
         values ($1,$2,$3,$4,'izmir',$5,'07:20',$6,$7)`,
        [newId(), martaId, mareAlta, 'Y\u0131ld\u0131z \u0130plik', visitDate, at, now],
      );
    }

    const kadeStudio = await makeLabel(
      irisId,
      { name: 'Kade Studio', contactName: 'Jef Maes', contactEmail: 'jef@kade-studio.example' },
      now,
    );
    await makeStyle(
      irisId,
      kadeStudio,
      {
        styleCode: null as unknown as string,
        name: 'Kade Overshirt',
        label: 'Kade Studio',
        season: 'AW27',
        gtin: '5600000000069',
        garment: 'shirt',
        line: null,
        leg: null,
        state: 'draft',
      },
      now,
    );

    await query('insert into seed_marker (id, done) values (1, true)');
  });
}
