"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.netCharges = netCharges;
exports.closeCycle = closeCycle;
const db_1 = require("../db");
const errors_1 = require("../errors");
const club_1 = require("./club");
const shorts_1 = require("./shorts");
const pledge_1 = require("./pledge");
const ledger_1 = require("./ledger");
const mail_1 = require("./mail");
const mailworker_1 = require("../providers/mailworker");
const killbill_1 = require("../providers/killbill");
const money_1 = require("../money");
const db_2 = require("../db");
const s3 = __importStar(require("../providers/s3"));
const documents_1 = require("./documents");
const idem_1 = require("../util/idem");
/** Per household and case: share, short credit and net charge. */
function netCharges(c) {
    const byHousehold = new Map();
    for (const p of (0, club_1.cycleProducts)(c.id)) {
        const ln = (0, db_1.one)("SELECT status FROM lines WHERE cycle_id = ? AND product_id = ?", c.id, p.id);
        if (ln.status === "dropped")
            continue;
        const shares = (0, pledge_1.lineShares)(c, p.id);
        for (const sh of shares.shares) {
            const short = (0, shorts_1.shortSummary)(c.id, p.id, sh.pledger);
            const cases = byHousehold.get(sh.pledger) ?? new Map();
            cases.set(p.id, { shareCents: sh.share_cents, shortCreditCents: short.creditCents, netCents: sh.share_cents - short.creditCents });
            byHousehold.set(sh.pledger, cases);
        }
    }
    return byHousehold;
}
/**
 * The close pipeline: invoice confirmation, Kill Bill charges, then one
 * transaction of movements, receipts and the closed state.
 */
async function closeCycle(c) {
    if (!(0, idem_1.acquireCloseLease)(c.id))
        throw errors_1.errors.closeInProgress();
    try {
        const current = (0, club_1.cycle)(c.id);
        if (current.status !== "breakdown" && current.status !== "closing") {
            throw errors_1.errors.illegalTransition();
        }
        // 1. Confirm the invoice with MinIO before touching state or Kill Bill.
        const record = (0, documents_1.documentRecord)(c.id, "invoice");
        if (!record)
            throw errors_1.errors.invoiceMissing();
        const stat = await s3.statObject(record.key);
        if (!stat.exists)
            throw errors_1.errors.invoiceMissing();
        // 2. Enter closing (revision +1), once.
        (0, db_1.tx)(() => {
            const cyc = (0, db_1.one)("SELECT * FROM cycles WHERE id = ?", c.id);
            if (cyc.status === "breakdown") {
                (0, db_1.run)("UPDATE cycles SET status = 'closing', revision = revision + 1 WHERE id = ?", c.id);
            }
        });
        // 3. Post Kill Bill charges, skipping ones already there.
        await postCloseCharges(c);
        // 4. One transaction: movements, receipts, closed state.
        const receiptsQueued = (0, db_1.tx)(() => {
            const cyc = (0, db_1.one)("SELECT * FROM cycles WHERE id = ?", c.id);
            if (cyc.status !== "closing")
                throw errors_1.errors.illegalTransition();
            const nowSec = Math.floor(Date.now() / 1000);
            const nets = netCharges(cyc);
            for (const [householdCode, cases] of nets) {
                if (householdCode === "club")
                    continue;
                for (const [productId, net] of cases) {
                    const p = (0, club_1.product)(productId);
                    const memo = `${cyc.name}: ${p.case_name}`;
                    (0, ledger_1.writeMovement)(householdCode, "pledge_charge", cyc.id, memo, nowSec, "club:distributor", `household:${householdCode}`, net.shareCents);
                    if (net.shortCreditCents > 0) {
                        (0, ledger_1.writeMovement)(householdCode, "short_credit", cyc.id, memo, nowSec, `household:${householdCode}`, "club:distributor", net.shortCreditCents);
                    }
                }
            }
            for (const p of (0, club_1.cycleProducts)(cyc.id)) {
                const ln = (0, db_1.one)("SELECT status FROM lines WHERE cycle_id = ? AND product_id = ?", cyc.id, p.id);
                if (ln.status !== "taken_up")
                    continue;
                const shares = (0, pledge_1.lineShares)(cyc, p.id);
                const clubShare = shares.shares.find((s) => s.pledger === "club");
                if (!clubShare)
                    continue;
                const clubNet = clubShare.share_cents - (0, shorts_1.shortSummary)(cyc.id, p.id, "club").creditCents;
                const memo = `${cyc.name}: ${p.case_name}`;
                (0, ledger_1.writeMovement)("club", "take_up_charge", cyc.id, memo, nowSec, "club:distributor", "club:stock", clubNet);
            }
            // Receipts, one per pledging household on a case that was not dropped.
            let queued = 0;
            for (const [householdCode, cases] of nets) {
                if (householdCode === "club" || cases.size === 0)
                    continue;
                const lines = [];
                let netTotal = 0;
                for (const p of (0, club_1.cycleProducts)(cyc.id)) {
                    const info = cases.get(p.id);
                    if (!info)
                        continue;
                    const pledged = (0, db_1.one)("SELECT units AS n FROM pledges WHERE cycle_id = ? AND product_id = ? AND household_code = ?", cyc.id, p.id, householdCode)?.n ?? 0;
                    const short = (0, shorts_1.shortSummary)(cyc.id, p.id, householdCode);
                    lines.push({
                        caseName: p.case_name,
                        units: pledged,
                        shareCents: info.shareCents,
                        shortUnits: short.units,
                        shortCreditCents: short.creditCents,
                    });
                    netTotal += info.netCents;
                }
                const balance = (0, ledger_1.creditOf)(householdCode).balance_cents;
                (0, mail_1.queueReceipt)(cyc, householdCode, lines, netTotal, balance);
                queued += 1;
            }
            (0, db_1.run)("UPDATE cycles SET status = 'closed', revision = revision + 1 WHERE id = ?", cyc.id);
            return queued;
        });
        (0, mailworker_1.deliverSoon)();
        return { receiptsQueued };
    }
    finally {
        (0, idem_1.releaseCloseLease)(c.id);
    }
}
async function postCloseCharges(c) {
    const nets = netCharges(c);
    const households = [...nets.keys()].filter((h) => h !== "club");
    const accountIds = new Map();
    for (const hh of households) {
        let accountId = await (0, killbill_1.findAccount)(`${db_2.config.kbKeyPrefix}-${hh}`);
        if (accountId === null) {
            const row = (0, db_1.one)("SELECT * FROM households WHERE code = ?", hh);
            if (!row)
                continue;
            accountId = await (0, killbill_1.createAccount)(`${db_2.config.kbKeyPrefix}-${hh}`, row.name, row.email);
            await (0, killbill_1.ensurePaymentMethod)(accountId);
        }
        accountIds.set(hh, accountId);
    }
    for (const hh of households) {
        const accountId = accountIds.get(hh);
        if (!accountId)
            continue;
        const invoices = await (0, killbill_1.listInvoices)(accountId);
        const existing = new Map();
        for (const inv of invoices) {
            for (const item of inv.items) {
                if (item.itemType === "EXTERNAL_CHARGE" && item.description) {
                    existing.set(item.description, (0, money_1.dollarsNumberToCents)(item.amount));
                }
            }
        }
        const toPost = [];
        for (const [productId, net] of nets.get(hh)) {
            if (net.netCents <= 0)
                continue;
            const p = (0, club_1.product)(productId);
            const description = `${c.name}: ${p.case_name} [${c.id}]`;
            const already = existing.get(description);
            if (already !== undefined) {
                if (already !== net.netCents)
                    throw errors_1.errors.chargeMismatch();
                continue; // already posted on a COMMITTED invoice
            }
            toPost.push({ amount: (0, money_1.centsToDollarsString)(net.netCents), description });
        }
        if (toPost.length > 0) {
            await (0, killbill_1.postCharges)(accountId, toPost);
        }
    }
}
