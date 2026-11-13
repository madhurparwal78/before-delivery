import type { SavedScenario, ScenarioResult } from "../shared/types.js";
import { direct, isUniqueViolation, nextId, query, transaction } from "./db.js";
import { ApiError, conflict, validation } from "./errors.js";
import { loadRegisterTotals, loadValuations } from "./registry.js";
import { MAX_POOL_HUNDREDTHS, parseAmount, parsePoolPercent, priceToFairMarketValue, roundScenario, type ScenarioInputs } from "./scenario.js";
import { parseDecimal } from "./decimal.js";
import { iso, now } from "./time.js";

const amountMessage = "Enter an amount above $0.00 with up to two decimals.";
const percentMessage = `Enter a percentage from 0.00 to ${MAX_POOL_HUNDREDTHS / 100n}.00.`;

function parseInputs(body: Record<string, unknown>): ScenarioInputs {
  const preMoneyCents = parseAmount(body.pre_money);
  const investmentCents = parseAmount(body.investment);
  const poolHundredths = parsePoolPercent(body.target_pool_percent);
  const fields: Record<string, string> = {};
  if (preMoneyCents === null) fields.pre_money = amountMessage;
  if (investmentCents === null) fields.investment = amountMessage;
  if (poolHundredths === null) fields.target_pool_percent = percentMessage;
  if (Object.keys(fields).length > 0 || preMoneyCents === null || investmentCents === null || poolHundredths === null) {
    throw validation(fields);
  }
  return { preMoneyCents, investmentCents, poolHundredths };
}

export async function runScenario(body: Record<string, unknown>, db = direct): Promise<ScenarioResult> {
  const inputs = parseInputs(body);
  const [totals, valuations] = await Promise.all([loadRegisterTotals(db), loadValuations(db)]);
  const outcome = roundScenario(inputs, totals.fullyDiluted, totals.unallocated);
  if (!outcome.ok) {
    throw validation({
      [outcome.field]: outcome.field === "pre_money" ? amountMessage : "This target pool can't be reached at this investment.",
    });
  }
  const current = valuations.current?.status === "current" ? valuations.current : null;
  const fmvUnits = current ? parseDecimal(current.fmv_per_share, 4) : null;
  return {
    fully_diluted_before: totals.fullyDiluted,
    unallocated_pool_before: totals.unallocated,
    pool_top_up: outcome.poolTopUp,
    price_per_share: outcome.pricePerShare,
    new_shares: outcome.newShares,
    fully_diluted_after: outcome.fullyDilutedAfter,
    new_investor_percent: outcome.newInvestorPercent,
    pool_after_percent: outcome.poolAfterPercent,
    dilution_percent: outcome.dilutionPercent,
    investment_used: outcome.investmentUsed,
    fmv_per_share: current ? current.fmv_per_share : null,
    price_to_fmv: fmvUnits === null ? null : priceToFairMarketValue(outcome.priceUnits, fmvUnits),
  };
}

type SavedRow = { id: string; name: string; pre_money: string; investment: string; target_pool_percent: string; saved_at: Date };
const presentSaved = (row: SavedRow): SavedScenario => ({ ...row, saved_at: iso(row.saved_at) });

export async function listSaved(): Promise<SavedScenario[]> {
  const rows = await query<SavedRow>(
    "SELECT id, name, pre_money, investment, target_pool_percent, saved_at FROM saved_scenarios ORDER BY id DESC",
  );
  return rows.map(presentSaved);
}

export async function saveScenario(body: Record<string, unknown>): Promise<SavedScenario> {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const nameOk = [...name].length >= 1 && [...name].length <= 60;
  let inputFields: Record<string, string> = {};
  try {
    parseInputs(body);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    inputFields = error.extras.fields ?? {};
  }
  if (!nameOk || Object.keys(inputFields).length > 0) {
    throw validation({ ...(nameOk ? {} : { name: "Enter a name of 1 to 60 characters." }), ...inputFields });
  }
  const key = name.toLowerCase();
  return transaction(async (tx) => {
    const id = await nextId(tx, "scenario_number", "SCN-", 3);
    const [row] = await tx.query<SavedRow>(
      `INSERT INTO saved_scenarios (id, name, name_key, pre_money, investment, target_pool_percent, saved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, pre_money, investment, target_pool_percent, saved_at`,
      [id, name, key, body.pre_money, body.investment, body.target_pool_percent, now()],
    );
    tx.emit({ to: null, type: "changed", data: { topics: ["scenarios"] } });
    return presentSaved(row as SavedRow);
  }).catch((error: unknown) => {
    throw isUniqueViolation(error) ? conflict("scenario_name_taken", "A saved scenario already has that name.") : error;
  });
}
