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
exports.checkUpload = checkUpload;
exports.storageKey = storageKey;
exports.documentRecord = documentRecord;
exports.documentsOf = documentsOf;
exports.uploadsAllowed = uploadsAllowed;
exports.uploadDocument = uploadDocument;
exports.scheduleSlipCleanup = scheduleSlipCleanup;
const node_crypto_1 = require("node:crypto");
const db_1 = require("../db");
const errors_1 = require("../errors");
const idem_1 = require("../util/idem");
const s3 = __importStar(require("../providers/s3"));
/** The single place that checks an upload's declared type against its bytes. */
function checkUpload(contentType, body) {
    const declared = (contentType ?? "").split(";")[0].trim().toLowerCase();
    if (body.length === 0)
        return errors_1.errors.unsupportedMediaType();
    if (declared === "application/pdf") {
        if (body.subarray(0, 5).toString("latin1") === "%PDF-")
            return { type: "application/pdf", ext: "pdf" };
        return errors_1.errors.unsupportedMediaType();
    }
    if (declared === "image/png") {
        const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        if (body.subarray(0, 8).equals(sig))
            return { type: "image/png", ext: "png" };
        return errors_1.errors.unsupportedMediaType();
    }
    if (declared === "image/jpeg") {
        if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff)
            return { type: "image/jpeg", ext: "jpg" };
        return errors_1.errors.unsupportedMediaType();
    }
    return errors_1.errors.unsupportedMediaType();
}
function storageKey(cycleId, kind, ext) {
    if (kind === "invoice")
        return `cycles/${cycleId}/invoice.pdf`;
    return `cycles/${cycleId}/packing-slip.${ext}`;
}
function documentRecord(cycleId, kind) {
    const row = (0, db_1.one)("SELECT kind, key, bytes, sha256 FROM documents WHERE cycle_id = ? AND kind = ?", cycleId, kind);
    return row;
}
function documentsOf(cycleId) {
    return (0, db_1.all)("SELECT kind, key, bytes, sha256, uploaded_at FROM documents WHERE cycle_id = ? ORDER BY kind", cycleId);
}
/** Upload state rule: accepted in ordered, received, breakdown, closing. */
function uploadsAllowed(c) {
    return ["ordered", "received", "breakdown", "closing"].includes(c.status);
}
async function uploadDocument(c, kind, body, type, ext) {
    const sha256 = (0, node_crypto_1.createHash)("sha256").update(body).digest("hex");
    const key = storageKey(c.id, kind, ext);
    if (!(0, idem_1.acquireUploadLease)(c.id, kind))
        throw errors_1.errors.uploadInProgress();
    try {
        await s3.putObject(key, body, type);
        (0, db_1.tx)(() => {
            const previous = documentRecord(c.id, kind);
            (0, db_1.run)(`INSERT INTO documents (cycle_id, kind, key, bytes, sha256, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (cycle_id, kind) DO UPDATE SET key = excluded.key, bytes = excluded.bytes, sha256 = excluded.sha256, uploaded_at = excluded.uploaded_at`, c.id, kind, key, body.length, sha256, Math.floor(Date.now() / 1000));
            if (previous && previous.key !== key) {
                (0, db_1.run)("INSERT OR IGNORE INTO pending_slip_deletions (key, enqueued_at) VALUES (?, ?)", previous.key, Math.floor(Date.now() / 1000));
            }
        });
    }
    finally {
        (0, idem_1.releaseUploadLease)(c.id, kind);
    }
    scheduleSlipCleanup();
    return { kind, key, bytes: body.length, sha256 };
}
let cleanupRunning = false;
function scheduleSlipCleanup() {
    if (cleanupRunning)
        return;
    cleanupRunning = true;
    void (async () => {
        for (;;) {
            const pending = (0, db_1.all)("SELECT key FROM pending_slip_deletions ORDER BY enqueued_at LIMIT 1");
            if (pending.length === 0)
                break;
            try {
                await s3.deleteObject(pending[0].key);
                (0, db_1.tx)(() => {
                    (0, db_1.run)("DELETE FROM pending_slip_deletions WHERE key = ?", pending[0].key);
                });
            }
            catch {
                await new Promise((r) => setTimeout(r, 30000));
            }
        }
        cleanupRunning = false;
    })();
}
