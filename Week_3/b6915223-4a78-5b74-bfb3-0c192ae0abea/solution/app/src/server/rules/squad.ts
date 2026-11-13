import type { Position, Rule } from "../../shared/api.ts";

// Squad rules (brief: Business rules / Squad rules), checked together on the resulting squad.
export const BUDGET_TENTHS = 1000;
const SQUAD_SIZE = 15;
const CLUB_LIMIT = 3;
const POSITION_COUNTS: readonly { position: Position; count: number; code: string; message: string }[] = [
  { position: "GK", count: 2, code: "goalkeepers", message: "the squad needs exactly 2 goalkeepers" },
  { position: "DEF", count: 5, code: "defenders", message: "the squad needs exactly 5 defenders" },
  { position: "MID", count: 5, code: "midfielders", message: "the squad needs exactly 5 midfielders" },
  { position: "FWD", count: 3, code: "forwards", message: "the squad needs exactly 3 forwards" },
];

export interface SquadMember {
  id: string;
  club: string;
  position: Position;
}

export function squadRuleBreaks(input: {
  members: readonly SquadMember[];
  clubs: readonly { code: string; name: string }[];
  overBudget: boolean;
  positionMismatch: boolean;
}): Rule[] {
  const { members, clubs } = input;
  const rules: Rule[] = [];
  if (members.length !== SQUAD_SIZE) rules.push({ code: "squad_size", message: "the squad needs exactly 15 players" });
  const seen = new Map<string, number>();
  for (const member of members) seen.set(member.id, (seen.get(member.id) ?? 0) + 1);
  for (const times of seen.values()) {
    if (times > 1) rules.push({ code: "duplicate_player", message: "a player can only be picked once" });
  }
  for (const rule of POSITION_COUNTS) {
    if (members.filter((member) => member.position === rule.position).length !== rule.count) {
      rules.push({ code: rule.code, message: rule.message });
    }
  }
  for (const club of clubs) {
    if (members.filter((member) => member.club === club.code).length > CLUB_LIMIT) {
      rules.push({ code: "club_limit", message: `no more than 3 players may come from ${club.name}` });
    }
  }
  if (input.overBudget) rules.push({ code: "budget", message: "the squad costs more than the money available" });
  if (input.positionMismatch) {
    rules.push({ code: "position_match", message: "each player in must play the same position as the player out" });
  }
  return rules;
}

// A new squad is measured at current prices against the 100.0m budget; exactly 100.0m is allowed.
export function newSquadOverBudget(pricesTenths: readonly number[]): boolean {
  return pricesTenths.reduce((sum, price) => sum + price, 0) > BUDGET_TENTHS;
}

// Transfers may spend the bank plus the selling prices of the players going out; a 0.0m bank is allowed.
export function transfersOverBudget(bankTenths: number, sellingTenths: readonly number[], buyingTenths: readonly number[]): boolean {
  const available = bankTenths + sellingTenths.reduce((sum, price) => sum + price, 0);
  return buyingTenths.reduce((sum, price) => sum + price, 0) > available;
}

export function positionsMismatch(pairs: readonly (readonly [SquadMember, SquadMember])[]): boolean {
  return pairs.some(([out, incoming]) => out.position !== incoming.position);
}
