import type {
  BuildingType,
  ClanRole,
  League,
  RaidEndReason,
  RaidState,
  RequestState,
  ResourceAmounts,
  Rotation,
  UnitCounts,
  UnitKey
} from '../shared/types.js';
import type { SimDeploy, SimLayoutBuilding } from '../shared/sim.js';

export type Me = {
  id: number;
  email: string;
  displayName: string;
  timeZone: string;
  verified: boolean;
  role: 'islander' | 'operator';
  villageId: number | null;
  trophies: number;
  league: League;
  clanId: number | null;
};

export type Building = {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  rotation: Rotation;
  level: number;
  upgrade: { toLevel: number; startedAt: string; finishesAt: string } | null;
  uncollected?: number;
};

export type TrainingBatch = {
  id: number;
  unit: UnitKey;
  count: number;
  startsAt: string;
  finishesAt: string;
};

export type Army = {
  units: UnitCounts;
  training: TrainingBatch[];
  housing: { used: number; capacity: number };
};

export type Village = {
  id: number;
  displayName: string;
  grid: { width: number; height: number };
  buildings: Building[];
  resources: Record<'brine' | 'peat' | 'copper', { amount: number; cap: number }>;
  saltmark: number;
  builders: { total: number; free: number };
  army: Army;
  shield: { endsAt: string } | null;
  underAttack: boolean;
  trophies: number;
  league: League;
  serverTime: string;
};

export type Scout = {
  villageId: number;
  displayName: string;
  trophies: number;
  league: League;
  buildings: { id: number; type: BuildingType; x: number; y: number; rotation: Rotation; level: number }[];
  lootable: ResourceAmounts;
};

export type RaidResult = {
  finalTick: number;
  destruction: number;
  stars: number;
  lootable: ResourceAmounts;
  loot: ResourceAmounts;
  transferred: ResourceAmounts;
  trophies: { attacker: number; defender: number };
  starBonus: number;
};

export type Raid = {
  id: number;
  state: RaidState;
  endReason: RaidEndReason | null;
  attacker: { villageId: number; displayName: string };
  defender: { villageId: number; displayName: string };
  lockedAt: string;
  finalizeBy: string;
  seed: number;
  layout: SimLayoutBuilding[];
  army: UnitCounts;
  lootable: ResourceAmounts;
  deploys: SimDeploy[];
  result: RaidResult | null;
  resolvedAt: string | null;
};

export type RaidListRow = {
  id: number;
  state: RaidState;
  endReason: RaidEndReason | null;
  role: 'attack' | 'defence';
  opponent: { villageId: number; displayName: string };
  lockedAt: string;
  resolvedAt: string | null;
  stars: number | null;
  destruction: number | null;
  transferred: ResourceAmounts | null;
};

export type Rewards = {
  serverTime: string;
  timeZone: string;
  daily: {
    periodStart: string;
    periodEnd: string;
    claimed: boolean;
    nextClaimAt: string | null;
    streak: number;
    streakEndsAt: string | null;
    chest: ResourceAmounts;
  };
  weekly: {
    periodStart: string;
    periodEnd: string;
    claimed: boolean;
    nextClaimAt: string | null;
    league: League;
    bonus: ResourceAmounts;
  };
  starBonus: { used: number; cap: number; periodEnd: string };
};

export type Member = {
  accountId: number;
  displayName: string;
  villageId: number | null;
  role: ClanRole;
  trophies: number;
  donated: number;
  received: number;
  joinedAt: string;
  mateSince: string | null;
};

export type ClanBody = {
  id: number;
  name: string;
  motto: string;
  trophies: number;
  rank: number;
  myRole: ClanRole;
  members: Member[];
};

export type Invitation = {
  id: number;
  clan: { id: number; name: string };
  invitedBy: { displayName: string };
};

export type ChatMessage = {
  id: number;
  author: { accountId: number; displayName: string };
  body: string | null;
  removed: boolean;
  createdAt: string;
};

export type UnitRequest = {
  id: number;
  requester: { accountId: number; displayName: string };
  unit: UnitKey;
  count: number;
  given: number;
  state: RequestState;
  createdAt: string;
};

export type CatalogBuilding = {
  type: BuildingType;
  name: string;
  width: number;
  depth: number;
  maxCount: number;
  levels: {
    level: number;
    cost: ResourceAmounts;
    buildSeconds: number;
    hitPoints: number;
    saltmark: number;
  }[];
  trainsUnits: boolean;
};

export type CatalogUnit = {
  unit: UnitKey;
  name: string;
  housing: number;
  cost: ResourceAmounts;
  trainSeconds: number;
};

export type Catalog = { buildings: CatalogBuilding[]; units: CatalogUnit[] };

export type ClanStanding = {
  rank: number;
  id: number;
  name: string;
  trophies: number;
  memberCount: number;
};
