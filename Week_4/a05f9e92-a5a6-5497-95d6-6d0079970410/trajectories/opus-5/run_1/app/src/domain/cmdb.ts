/**
 * Configuration item classes, the closed relationship list, the layered map,
 * effective status and impact. This is the one place the service map is decided.
 */

import { ApiError } from '../errors';

export const classNames = [
  'Configuration item',
  'Business service',
  'Application',
  'Server',
  'Virtual server',
  'Cluster',
  'Network device',
  'Storage',
] as const;

export type ClassName = (typeof classNames)[number];

interface ClassSpec {
  readonly parent: ClassName | null;
  readonly own: readonly string[];
}

const classTree: Readonly<Record<ClassName, ClassSpec>> = {
  'Configuration item': {
    parent: null,
    own: ['name', 'criticality', 'business_critical', 'owner_department', 'status'],
  },
  'Business service': { parent: 'Configuration item', own: ['used_by'] },
  Application: { parent: 'Configuration item', own: ['version'] },
  Server: { parent: 'Configuration item', own: ['operating_system', 'location'] },
  'Virtual server': { parent: 'Server', own: ['host_name'] },
  Cluster: { parent: 'Configuration item', own: ['required_healthy'] },
  'Network device': { parent: 'Configuration item', own: ['location'] },
  Storage: { parent: 'Configuration item', own: ['capacity_gb'] },
};

export function isClassName(value: string): value is ClassName {
  return (classNames as readonly string[]).includes(value);
}

/** A class has every attribute of its ancestors plus its own. */
export function classAttributes(name: ClassName): string[] {
  const out: string[] = [];
  let cursor: ClassName | null = name;
  const chain: ClassName[] = [];
  while (cursor) {
    chain.unshift(cursor);
    cursor = classTree[cursor].parent;
  }
  for (const link of chain) out.push(...classTree[link].own);
  return out;
}

/** Attributes beyond the base five, which live in a configuration item's `attributes`. */
export function ownAttributes(name: ClassName): string[] {
  const base = new Set(classTree['Configuration item'].own);
  return classAttributes(name).filter((a) => !base.has(a));
}

export function isClassOrBelow(name: ClassName, ancestor: ClassName): boolean {
  let cursor: ClassName | null = name;
  while (cursor) {
    if (cursor === ancestor) return true;
    cursor = classTree[cursor].parent;
  }
  return false;
}

export const relationshipTypes = [
  'depends on',
  'runs on',
  'hosted by',
  'member of',
  'connects to',
  'backs up',
] as const;

export type RelationshipType = (typeof relationshipTypes)[number];

export const dependencyTypes: readonly RelationshipType[] = ['depends on', 'runs on', 'hosted by'];

export function isRelationshipType(value: string): value is RelationshipType {
  return (relationshipTypes as readonly string[]).includes(value);
}

export function isDependencyType(type: RelationshipType): boolean {
  return dependencyTypes.includes(type);
}

export type CiStatus = 'healthy' | 'degraded' | 'down';
export type EffectiveStatus = CiStatus | 'maintenance';

export const statusLabels: Readonly<Record<EffectiveStatus, string>> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  down: 'Down',
  maintenance: 'In maintenance',
};

export interface ConfigurationItem {
  readonly id: number;
  readonly name: string;
  readonly className: ClassName;
  readonly criticality: number;
  readonly businessCritical: boolean;
  readonly ownerDepartment: string | null;
  readonly status: CiStatus;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly usedByDepartments: readonly string[];
  readonly usedByPeople: readonly string[];
}

export interface Relationship {
  readonly source: string;
  readonly type: RelationshipType;
  readonly target: string;
}

export interface MaintenanceWindow {
  readonly ci: string;
  readonly start: number;
  readonly end: number;
}

/** Everything the map and impact need, built once per request. */
export class ServiceMap {
  private readonly byName = new Map<string, ConfigurationItem>();
  private readonly outgoing = new Map<string, Relationship[]>();
  private readonly incoming = new Map<string, Relationship[]>();

  constructor(
    items: readonly ConfigurationItem[],
    readonly relationships: readonly Relationship[],
    private readonly maintenance: readonly MaintenanceWindow[],
    private readonly at: number,
  ) {
    for (const item of items) this.byName.set(key(item.name), item);
    for (const rel of relationships) {
      push(this.outgoing, key(rel.source), rel);
      push(this.incoming, key(rel.target), rel);
    }
  }

  get items(): ConfigurationItem[] {
    return [...this.byName.values()];
  }

  find(name: string): ConfigurationItem | undefined {
    return this.byName.get(key(name));
  }

  /** Targets this item needs: its dependency relationships, plus a cluster's members. */
  dependencyTargets(name: string): { item: ConfigurationItem; type: RelationshipType }[] {
    const out: { item: ConfigurationItem; type: RelationshipType }[] = [];
    for (const rel of this.outgoing.get(key(name)) ?? []) {
      if (!isDependencyType(rel.type)) continue;
      const item = this.find(rel.target);
      if (item) out.push({ item, type: rel.type });
    }
    return out;
  }

  clusterMembers(name: string): ConfigurationItem[] {
    const out: ConfigurationItem[] = [];
    for (const rel of this.incoming.get(key(name)) ?? []) {
      if (rel.type !== 'member of') continue;
      const item = this.find(rel.source);
      if (item) out.push(item);
    }
    return out;
  }

  /**
   * Items that need this one: dependents by dependency relationship, plus the
   * cluster an item is a member of.
   */
  dependents(name: string): { item: ConfigurationItem; type: RelationshipType }[] {
    const out: { item: ConfigurationItem; type: RelationshipType }[] = [];
    for (const rel of this.incoming.get(key(name)) ?? []) {
      if (!isDependencyType(rel.type)) continue;
      const item = this.find(rel.source);
      if (item) out.push({ item, type: rel.type });
    }
    for (const rel of this.outgoing.get(key(name)) ?? []) {
      if (rel.type !== 'member of') continue;
      const item = this.find(rel.target);
      if (item) out.push({ item, type: rel.type });
    }
    return out;
  }

  inMaintenance(name: string): boolean {
    return this.maintenance.some(
      (w) => key(w.ci) === key(name) && this.at >= w.start && this.at < w.end,
    );
  }

  /** The computed status, with statuses overridden for what-if comparisons. */
  effectiveStatus(name: string, override?: ReadonlyMap<string, CiStatus>): EffectiveStatus {
    return this.computeStatus(name, override ?? new Map(), new Map(), new Set());
  }

  effectiveStatuses(override?: ReadonlyMap<string, CiStatus>): Map<string, EffectiveStatus> {
    const memo = new Map<string, EffectiveStatus>();
    for (const item of this.byName.values()) {
      this.computeStatus(item.name, override ?? new Map(), memo, new Set());
    }
    return memo;
  }

  private computeStatus(
    name: string,
    override: ReadonlyMap<string, CiStatus>,
    memo: Map<string, EffectiveStatus>,
    visiting: Set<string>,
  ): EffectiveStatus {
    const k = key(name);
    const cached = memo.get(k);
    if (cached) return cached;
    const item = this.byName.get(k);
    if (!item) return 'healthy';
    if (visiting.has(k)) return 'healthy';
    if (this.inMaintenance(item.name)) {
      memo.set(k, 'maintenance');
      return 'maintenance';
    }
    visiting.add(k);
    let worst: CiStatus = override.get(k) ?? item.status;
    for (const { item: target } of this.dependencyTargets(item.name)) {
      const inherited = asHealthyWhenMaintained(
        this.computeStatus(target.name, override, memo, visiting),
      );
      worst = worseOf(worst, inherited === 'down' ? 'down' : inherited === 'degraded' ? 'degraded' : 'healthy');
    }
    if (item.className === 'Cluster') {
      const members = this.clusterMembers(item.name);
      if (members.length > 0) {
        const required = Number(item.attributes.required_healthy ?? members.length);
        const healthy = members.filter(
          (m) => asHealthyWhenMaintained(this.computeStatus(m.name, override, memo, visiting)) === 'healthy',
        ).length;
        if (healthy < required) worst = worseOf(worst, 'down');
        else if (healthy < members.length) worst = worseOf(worst, 'degraded');
      }
    }
    visiting.delete(k);
    memo.set(k, worst);
    return worst;
  }

  /** People of a business service: its used_by departments' members plus its used_by people. */
  peopleOf(item: ConfigurationItem, departmentMembers: ReadonlyMap<string, readonly string[]>): string[] {
    if (item.className !== 'Business service') return [];
    const out = new Set<string>();
    for (const department of item.usedByDepartments) {
      for (const person of departmentMembers.get(department) ?? []) out.add(person);
    }
    for (const person of item.usedByPeople) out.add(person);
    return [...out];
  }
}

function asHealthyWhenMaintained(status: EffectiveStatus): EffectiveStatus {
  return status === 'maintenance' ? 'healthy' : status;
}

const statusRank: Readonly<Record<CiStatus, number>> = { down: 0, degraded: 1, healthy: 2 };

export function worseOf(a: CiStatus, b: CiStatus): CiStatus {
  return statusRank[a] <= statusRank[b] ? a : b;
}

function key(name: string): string {
  return name.toLowerCase();
}

function push<T>(map: Map<string, T[]>, k: string, value: T): void {
  const list = map.get(k);
  if (list) list.push(value);
  else map.set(k, [value]);
}

/** Within a row and among dependents: criticality descending, then name. */
export function compareItems(a: ConfigurationItem, b: ConfigurationItem): number {
  if (a.criticality !== b.criticality) return b.criticality - a.criticality;
  const an = a.name.toLowerCase();
  const bn = b.name.toLowerCase();
  return an < bn ? -1 : an > bn ? 1 : 0;
}

/**
 * Layout edges are the dependency relationships plus, for each `member of`, an
 * edge from the cluster to the member.
 */
function layoutTargets(map: ServiceMap, name: string): string[] {
  const out: string[] = [];
  for (const rel of map.relationships) {
    if (rel.source.toLowerCase() === name.toLowerCase() && isDependencyType(rel.type)) out.push(rel.target);
    if (rel.target.toLowerCase() === name.toLowerCase() && rel.type === 'member of') out.push(rel.source);
  }
  return out;
}

export interface MapNode {
  readonly name: string;
  readonly className: ClassName;
  readonly status: EffectiveStatus;
  readonly layer: number;
  readonly x: number;
  readonly y: number;
}

/** The published layered coordinates. */
export function layoutMap(map: ServiceMap): MapNode[] {
  const items = map.items;
  const layers = new Map<string, number>();
  const computing = new Set<string>();
  const layerOf = (name: string): number => {
    const k = name.toLowerCase();
    const known = layers.get(k);
    if (known !== undefined) return known;
    if (computing.has(k)) return 0;
    computing.add(k);
    const targets = layoutTargets(map, name);
    const layer = targets.length === 0 ? 0 : 1 + Math.max(...targets.map((t) => layerOf(t)));
    computing.delete(k);
    layers.set(k, layer);
    return layer;
  };
  for (const item of items) layerOf(item.name);

  const highest = items.reduce((max, item) => Math.max(max, layers.get(item.name.toLowerCase()) ?? 0), 0);
  const statuses = map.effectiveStatuses();
  const rows = new Map<number, ConfigurationItem[]>();
  for (const item of items) {
    const layer = layers.get(item.name.toLowerCase()) ?? 0;
    const list = rows.get(layer);
    if (list) list.push(item);
    else rows.set(layer, [item]);
  }
  const nodes: MapNode[] = [];
  for (let layer = highest; layer >= 0; layer -= 1) {
    const row = (rows.get(layer) ?? []).sort(compareItems);
    row.forEach((item, position) => {
      nodes.push({
        name: item.name,
        className: item.className,
        status: statuses.get(item.name.toLowerCase()) ?? 'healthy',
        layer,
        x: 40 + 200 * position,
        y: 40 + 120 * (highest - layer),
      });
    });
  }
  return nodes;
}

export const nodeWidth = 160;
export const nodeHeight = 64;

/** A dependency relationship that would close a loop is refused with its chain. */
export function cycleThrough(map: ServiceMap, source: string, target: string): string[] | null {
  const sourceItem = map.find(source);
  const targetItem = map.find(target);
  if (!sourceItem || !targetItem) return null;
  if (key(source) === key(target)) return [sourceItem.name, sourceItem.name];
  const path: string[] = [targetItem.name];
  const seen = new Set<string>();
  const walk = (name: string): boolean => {
    const k = key(name);
    if (seen.has(k)) return false;
    seen.add(k);
    for (const { item } of map.dependencyTargets(name)) {
      // Reaching the source closes the loop; it is named once at each end.
      if (key(item.name) === key(source)) return true;
      path.push(item.name);
      if (walk(item.name)) return true;
      path.pop();
    }
    return false;
  };
  if (key(target) === key(source) || walk(targetItem.name)) {
    return [sourceItem.name, ...path, sourceItem.name];
  }
  return null;
}

export function cycleError(chain: readonly string[]): ApiError {
  return new ApiError(
    422,
    'cycle',
    `This relationship would form a dependency loop: ${chain.join(' -> ')}.`,
  );
}

export type Tier = 1 | 2 | 3;

export function tierOf(item: ConfigurationItem): Tier {
  if (item.businessCritical) return 1;
  if (item.criticality === 3) return 2;
  return 3;
}

export interface AffectedEntry {
  readonly item: ConfigurationItem;
  readonly path: readonly RelationshipType[];
  readonly tier: Tier;
  readonly peopleAdded: number;
  readonly runningPeople: number;
}

export interface DegradedEntry {
  readonly item: ConfigurationItem;
  readonly path: readonly RelationshipType[];
}

export interface Impact {
  readonly ci: ConfigurationItem;
  readonly status: CiStatus;
  readonly basePeople: number;
  readonly affected: readonly AffectedEntry[];
  readonly degraded: readonly DegradedEntry[];
  readonly peopleTotal: number;
  readonly businessCriticalAffected: number;
}

/**
 * The impact of an item being down or degraded: every item that is down because
 * of it, walked depth-first in preorder along dependents.
 */
export function impactOf(
  map: ServiceMap,
  name: string,
  departmentMembers: ReadonlyMap<string, readonly string[]>,
): Impact | null {
  const failed = map.find(name);
  if (!failed) return null;
  const healthyBaseline = new Map<string, CiStatus>([[name.toLowerCase(), 'healthy']]);
  const withFault = map.effectiveStatuses();
  const without = map.effectiveStatuses(healthyBaseline);

  const people = new Set<string>(map.peopleOf(failed, departmentMembers));
  const basePeople = people.size;

  const affected: AffectedEntry[] = [];
  const degraded: DegradedEntry[] = [];
  const seen = new Set<string>([name.toLowerCase()]);

  const walk = (current: ConfigurationItem, path: readonly RelationshipType[]): void => {
    const next = map
      .dependents(current.name)
      .filter((d) => !seen.has(d.item.name.toLowerCase()))
      .sort((a, b) => compareItems(a.item, b.item));
    for (const { item, type } of next) {
      const k = item.name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      const nowStatus = withFault.get(k) ?? 'healthy';
      const wasStatus = without.get(k) ?? 'healthy';
      const here: readonly RelationshipType[] = [type, ...path];
      if (nowStatus === 'down' && wasStatus !== 'down') {
        const before = people.size;
        for (const person of map.peopleOf(item, departmentMembers)) people.add(person);
        affected.push({
          item,
          path: here,
          tier: tierOf(item),
          peopleAdded: people.size - before,
          runningPeople: people.size,
        });
      } else if (nowStatus === 'degraded' && wasStatus !== 'degraded') {
        degraded.push({ item, path: here });
      }
      walk(item, here);
    }
  };
  walk(failed, []);

  return {
    ci: failed,
    status: failed.status,
    basePeople,
    affected,
    degraded,
    peopleTotal: people.size,
    businessCriticalAffected: affected.filter(
      (a) => a.item.businessCritical && a.item.className === 'Business service',
    ).length,
  };
}

/** The relay shows at most 8 panels: the first 7, then one for the rest. */
export const relayPanelLimit = 8;

export interface RelayPanel {
  readonly kind: 'item' | 'more';
  readonly name: string;
  readonly path: readonly RelationshipType[];
  readonly tier: Tier;
  readonly peopleAdded: number;
  readonly runningPeople: number;
  readonly rest: readonly string[];
}

export function relayPanels(impact: Impact): RelayPanel[] {
  const entries = impact.affected;
  if (entries.length <= relayPanelLimit) {
    return entries.map((entry) => ({
      kind: 'item' as const,
      name: entry.item.name,
      path: entry.path,
      tier: entry.tier,
      peopleAdded: entry.peopleAdded,
      runningPeople: entry.runningPeople,
      rest: [],
    }));
  }
  const shown = entries.slice(0, relayPanelLimit - 1);
  const rest = entries.slice(relayPanelLimit - 1);
  return [
    ...shown.map((entry) => ({
      kind: 'item' as const,
      name: entry.item.name,
      path: entry.path,
      tier: entry.tier,
      peopleAdded: entry.peopleAdded,
      runningPeople: entry.runningPeople,
      rest: [],
    })),
    {
      kind: 'more' as const,
      name: `and ${rest.length} more`,
      path: [],
      tier: 3 as Tier,
      peopleAdded: impact.peopleTotal - (shown[shown.length - 1]?.runningPeople ?? impact.basePeople),
      runningPeople: impact.peopleTotal,
      rest: rest.map((entry) => entry.item.name),
    },
  ];
}
