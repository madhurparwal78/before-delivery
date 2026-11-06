// Shapes of the API objects the browser reads.
import type { Deploy, LayoutBuilding } from '../shared/battle';
import type {
  AccountRole, Amounts, ArmyCounts, BuildingType, ClanRole, EndReason, League, RaidRole, RaidState, RequestState,
  Resource, Rotation, UnitKey,
} from '../shared/catalog';

export interface Me {
  id: number;
  email: string;
  displayName: string;
  timeZone: string;
  verified: boolean;
  role: AccountRole;
  villageId: number | null;
  trophies: number;
  league: League;
  clanId: number | null;
}

export interface Building {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  rotation: Rotation;
  level: number;
  upgrade: { toLevel: number; startedAt: string; finishesAt: string } | null;
  uncollected?: number;
}

interface Batch {
  id: number;
  unit: UnitKey;
  count: number;
  startsAt: string;
  finishesAt: string;
}

export interface Army {
  units: ArmyCounts;
  training: Batch[];
  housing: { used: number; capacity: number };
}

export interface Village {
  id: number;
  displayName: string;
  buildings: Building[];
  resources: Record<Resource, { amount: number; cap: number }>;
  saltmark: number;
  builders: { total: number; free: number };
  army: Army;
  shield: { endsAt: string } | null;
  underAttack: boolean;
  trophies: number;
  league: League;
  serverTime?: string;
}

export interface Scout {
  villageId: number;
  displayName: string;
  trophies: number;
  league: League;
  buildings: Omit<Building, 'upgrade' | 'uncollected'>[];
  lootable: Amounts;
}

interface RaidResult {
  finalTick: number;
  destruction: number;
  stars: number;
  lootable: Amounts;
  loot: Amounts;
  transferred: Amounts;
  trophies: { attacker: number; defender: number };
  starBonus: number;
}

export interface Raid {
  id: number;
  state: RaidState;
  endReason: EndReason | null;
  attacker: { villageId: number; displayName: string };
  defender: { villageId: number; displayName: string };
  lockedAt: string;
  finalizeBy: string;
  seed: number;
  layout: LayoutBuilding[];
  army: ArmyCounts;
  lootable: Amounts;
  deploys: Deploy[];
  result: RaidResult | null;
  resolvedAt: string | null;
}

export interface RaidRow {
  id: number;
  state: RaidState;
  endReason: EndReason | null;
  role: RaidRole;
  opponent: { villageId: number; displayName: string };
  lockedAt: string;
  resolvedAt: string | null;
  stars: number | null;
  destruction: number | null;
  transferred: Amounts | null;
}

export interface Rewards {
  serverTime?: string;
  timeZone: string;
  daily: { periodStart: string; periodEnd: string; claimed: boolean; nextClaimAt: string | null; streak: number; streakEndsAt: string | null; chest: Amounts };
  weekly: { periodStart: string; periodEnd: string; claimed: boolean; nextClaimAt: string | null; league: League; bonus: Amounts };
  starBonus: { used: number; cap: number; periodEnd: string };
}

export interface Member {
  accountId: number;
  displayName: string;
  villageId: number;
  role: ClanRole;
  trophies: number;
  donated: number;
  received: number;
  joinedAt: string;
  mateSince: string | null;
}

export interface Clan {
  id: number;
  name: string;
  motto: string;
  trophies: number;
  rank: number;
  myRole: ClanRole;
  members: Member[];
}

export interface Message {
  id: number;
  author: { accountId: number; displayName: string };
  body: string | null;
  removed: boolean;
  createdAt: string;
}

export interface UnitRequest {
  id: number;
  requester: { accountId: number; displayName: string };
  unit: UnitKey;
  count: number;
  given: number;
  state: RequestState;
  createdAt: string;
}

export interface Invitation {
  id: number;
  clan: { id: number; name: string };
  invitedBy: { displayName: string };
}

export interface ClanBundle {
  clan: Clan | null;
  messages?: Message[];
  requests?: { requests: UnitRequest[]; mine: UnitRequest | null };
  invitations: Invitation[];
}
