import { officeDate } from './officeTime.js';
import {
  checkHealthRows,
  credentialJson,
  latestGoodCheck,
  loadCredentials,
  loadHolders,
  loadOpenTurns,
  loadRotations,
  loadVendors,
  type CheckHealthRow,
  type CredentialContext,
} from './domain/credentials.js';
import { loadRules, pendingRulesOf, resolveRuleInForce, ruleInForceJson, ruleJson, rulesOfVault } from './domain/rules.js';
import { allVaults } from './domain/visibility.js';
import type { CredentialRow, PersonRow, RuleRow, VaultRow } from './types.js';
import { seesEveryVault } from './domain/visibility.js';

export type DrawerContext = CredentialContext & {
  credentials: CredentialRow[];
  rules: RuleRow[];
  vaults: VaultRow[];
  today: string;
};

export async function loadDrawerContext(at: Date): Promise<DrawerContext> {
  const check = await latestGoodCheck();
  const snapshot: Map<string, CheckHealthRow> | null =
    check === null ? null : new Map((await checkHealthRows(check.id)).map((row) => [row.credential_id, row]));
  return {
    vaults: await allVaults(),
    vendors: await loadVendors(),
    rules: await loadRules(),
    holders: await loadHolders(),
    openTurns: await loadOpenTurns(),
    rotations: await loadRotations(),
    credentials: await loadCredentials(null),
    snapshot,
    at,
    today: officeDate(at),
  };
}

export function vaultJson(vault: VaultRow, context: DrawerContext, person: PersonRow): Record<string, unknown> {
  const ownRules = rulesOfVault(context.rules, vault.id);
  const inForce = resolveRuleInForce(ownRules, context.today);
  const showsRules = seesEveryVault(person);
  return {
    id: vault.id,
    name: vault.name,
    formerly: vault.formerly,
    off_when_travelling: vault.off_when_travelling,
    rule_in_force: inForce === null ? null : ruleInForceJson(inForce),
    pending_rules: showsRules ? pendingRulesOf(ownRules, vault.id).map((rule) => ruleJson(rule, context.today)) : [],
    credential_count: context.credentials.filter((credential) => credential.vault_id === vault.id).length,
  };
}

export function credentialsOfVault(vaultId: string, context: DrawerContext): Record<string, unknown>[] {
  return context.credentials
    .filter((credential) => credential.vault_id === vaultId)
    .map((credential) => credentialJson(credential, context));
}
