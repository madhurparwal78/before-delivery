import { Decimal, roundHalfEven } from './decimal.js'
import { allocateAreas, type Polygon } from './geometry.js'
import { buildReadingsFile, type CanonicalReading } from './readingsFile.js'
import { halfHourIndex } from './time.js'

/** GWP100 of methane. */
export const CH4_GWP = new Decimal('27.0')
const FC_FACTOR = new Decimal('0.00004401') // g CO2 per µmol
const FCH4_FACTOR = new Decimal('0.00000001604') // g CH4 per nmol
const HALF_HOUR_S = new Decimal(1800)
const M2_PER_HA = new Decimal(1000000) // g -> t is 1e6
/** QC values that qualify: 0 measured, 1 good-quality gap-fill. */
export const QUALIFYING_QC = new Set([0, 1])
/** Fraction of half-hours that must qualify for a sensor to contribute. */
export const CONTRIBUTE_THRESHOLD = new Decimal('0.8')

export type SensorDef = {
  id: string
  kind: 'tower' | 'satellite'
  polygon: Polygon
}

export type ReadingRow = {
  sensor_id: string
  interval_start: string
  fc: string
  fch4: string
  qc: number
}

export type Contribution = {
  sensor_id: string
  kind: 'tower' | 'satellite'
  area_m2: number
  qualifying_half_hours: number
  half_hours: number
  co2_tco2e: string
  ch4_tco2e: string
  net_tco2e: string
}

export type Derivation = {
  start: string
  end: string
  sensor_ids: string[]
  contributions: Contribution[]
  coverage_pct: string
  floor_pct: string
  net_tco2e: string
  co2_tco2e: string
  ch4_tco2e: string
  buffer_pct: string
  buffer_tco2e: string
  credited_tco2e: string
  readings_count: number
  fingerprint: string
}

export type DeriveProject = {
  boundary: Polygon
  boundary_area_m2: number
  floor_pct: string
  buffer_pct: string
  sensors: SensorDef[]
}

/** Whether a sensor with q qualifying of n half-hours contributes. */
export function contributes(q: number, n: number): boolean {
  if (n <= 0) return false
  return new Decimal(q).div(n).greaterThanOrEqualTo(CONTRIBUTE_THRESHOLD)
}

/** Exact CO2 tonnes for a sensor (unrounded). */
function co2Exact(sumFc: Decimal, area: number): Decimal {
  return sumFc.times(HALF_HOUR_S).times(FC_FACTOR).times(area).div(M2_PER_HA)
}

/** Exact CH4 tonnes CO2e for a sensor (unrounded). */
function ch4Exact(sumFch4: Decimal, area: number): Decimal {
  return sumFch4.times(HALF_HOUR_S).times(FCH4_FACTOR).times(CH4_GWP).times(area).div(M2_PER_HA)
}

/**
 * Largest-remainder allocation of a column of exact values so the parts sum
 * exactly to the rounded total. Floors each exact value at 0.001, then adds
 * 0.001 to the R values with the largest remainders (ties: ascending sensor id).
 */
export function allocateColumn(
  exacts: Map<string, Decimal>,
  total: Decimal,
): Map<string, string> {
  const ids = [...exacts.keys()].sort()
  const unit = new Decimal('0.001')
  const floors = new Map<string, Decimal>()
  for (const id of ids) {
    floors.set(id, exacts.get(id)!.div(unit).floor().times(unit))
  }
  let sumFloors = new Decimal(0)
  for (const v of floors.values()) sumFloors = sumFloors.plus(v)
  const remCount = total.minus(sumFloors).div(unit).toNumber()
  const order = ids
    .map((id) => ({
      id,
      rem: exacts.get(id)!.minus(floors.get(id)!),
    }))
    .sort((a, b) => {
      if (!a.rem.eq(b.rem)) return a.rem.greaterThan(b.rem) ? -1 : 1
      return a.id < b.id ? -1 : 1
    })
  const bump = new Set(order.slice(0, remCount).map((o) => o.id))
  const out = new Map<string, string>()
  for (const id of ids) {
    const v = floors.get(id)!.plus(bump.has(id) ? unit : new Decimal(0))
    out.set(id, v.toFixed(3))
  }
  return out
}

/** Buffer and credited tonnes from the rounded net and buffer percentage. */
export function bufferFor(netRounded: Decimal, bufferPct: Decimal): { buffer: Decimal; credited: Decimal } {
  if (netRounded.isNegative()) {
    const buffer = roundHalfEven(netRounded.abs().times(bufferPct).div(100), 3)
    return { buffer, credited: netRounded.plus(buffer) }
  }
  return { buffer: new Decimal(0), credited: netRounded }
}

/**
 * Derive a figure. One place owns the unit chain, coverage and allocation.
 * `readings` must be all stored readings of the selected sensors in [start, end).
 */
export function derive(
  project: DeriveProject,
  start: string,
  end: string,
  selectedIds: string[],
  readings: ReadingRow[],
): Derivation {
  const n = halfHourIndex(end) - halfHourIndex(start)
  const selected = new Set(selectedIds)
  const sensorsById = new Map(project.sensors.map((s) => [s.id, s]))

  // per sensor: qualifying count, exact sums
  const qual = new Map<string, number>()
  const sumFc = new Map<string, Decimal>()
  const sumFch4 = new Map<string, Decimal>()
  for (const id of selectedIds) {
    qual.set(id, 0)
    sumFc.set(id, new Decimal(0))
    sumFch4.set(id, new Decimal(0))
  }
  for (const r of readings) {
    if (!selected.has(r.sensor_id)) continue
    if (!QUALIFYING_QC.has(r.qc)) continue
    qual.set(r.sensor_id, qual.get(r.sensor_id)! + 1)
    sumFc.set(r.sensor_id, sumFc.get(r.sensor_id)!.plus(new Decimal(r.fc)))
    sumFch4.set(r.sensor_id, sumFch4.get(r.sensor_id)!.plus(new Decimal(r.fch4)))
  }

  // contributing sensors in allocation order: towers first, then satellites, ascending byte order
  const contributing = selectedIds
    .filter((id) => contributes(qual.get(id)!, n))
    .sort((a, b) => {
      const ka = sensorsById.get(a)!.kind === 'tower' ? 0 : 1
      const kb = sensorsById.get(b)!.kind === 'tower' ? 0 : 1
      if (ka !== kb) return ka - kb
      return a < b ? -1 : 1
    })

  const polys = contributing.map((id) => sensorsById.get(id)!.polygon)
  const areas = allocateAreas(project.boundary, polys)
  const areaById = new Map<string, number>()
  contributing.forEach((id, i) => areaById.set(id, areas[i]))

  const areaTotal = areas.reduce((a, b) => a + b, 0)
  const coverage = project.boundary_area_m2 === 0
    ? new Decimal(0)
    : new Decimal(areaTotal).times(100).div(project.boundary_area_m2)

  // exact totals
  const exactCo2 = new Map<string, Decimal>()
  const exactCh4 = new Map<string, Decimal>()
  const exactNet = new Map<string, Decimal>()
  let totalCo2Exact = new Decimal(0)
  let totalCh4Exact = new Decimal(0)
  for (const id of contributing) {
    const area = areaById.get(id)!
    const c = co2Exact(sumFc.get(id)!, area)
    const m = ch4Exact(sumFch4.get(id)!, area)
    exactCo2.set(id, c)
    exactCh4.set(id, m)
    exactNet.set(id, c.plus(m))
    totalCo2Exact = totalCo2Exact.plus(c)
    totalCh4Exact = totalCh4Exact.plus(m)
  }
  const totalNetExact = totalCo2Exact.plus(totalCh4Exact)

  const co2Rounded = roundHalfEven(totalCo2Exact, 3)
  const ch4Rounded = roundHalfEven(totalCh4Exact, 3)
  const netRounded = roundHalfEven(totalNetExact, 3)

  const allocCo2 = allocateColumn(exactCo2, co2Rounded)
  const allocCh4 = allocateColumn(exactCh4, ch4Rounded)
  const allocNet = allocateColumn(exactNet, netRounded)

  const contributions: Contribution[] = contributing.map((id) => ({
    sensor_id: id,
    kind: sensorsById.get(id)!.kind,
    area_m2: areaById.get(id)!,
    qualifying_half_hours: qual.get(id)!,
    half_hours: n,
    co2_tco2e: allocCo2.get(id)!,
    ch4_tco2e: allocCh4.get(id)!,
    net_tco2e: allocNet.get(id)!,
  }))

  const { buffer, credited } = bufferFor(netRounded, new Decimal(project.buffer_pct))

  // canonical readings file over all selected sensors in the interval,
  // qualifying or not
  const canon: CanonicalReading[] = readings
    .filter((r) => selected.has(r.sensor_id))
    .map((r) => ({
      sensor_id: r.sensor_id,
      interval_start: r.interval_start,
      fc: new Decimal(r.fc).toFixed(4),
      fch4: new Decimal(r.fch4).toFixed(4),
      qc: String(r.qc),
    }))
  const file = buildReadingsFile(canon)

  return {
    start,
    end,
    sensor_ids: [...selectedIds].sort(),
    contributions,
    coverage_pct: roundHalfEven(coverage, 1).toFixed(1),
    floor_pct: new Decimal(project.floor_pct).toFixed(1),
    net_tco2e: netRounded.toFixed(3),
    co2_tco2e: co2Rounded.toFixed(3),
    ch4_tco2e: ch4Rounded.toFixed(3),
    buffer_pct: new Decimal(project.buffer_pct).toFixed(1),
    buffer_tco2e: buffer.toFixed(3),
    credited_tco2e: credited.toFixed(3),
    readings_count: file.count,
    fingerprint: file.sha256,
  }
}
