import { inflateRawSync } from "node:zlib";
import { CONTENT_MAX as ZIP_FILE_MAX, contentProblem, normalisePath, pathProblem } from "./paths.js";
const ZIP_ENTRIES_MAX = 500;
const ZIP_TOTAL_MAX = 20_000_000;
const RATIO_FLOOR = 10_000;
const RATIO_MAX = 100;
const PROBLEMS_SHOWN = 100;
class NotAZip extends Error {
}
function centralDirectory(zip) {
    const floor = Math.max(0, zip.length - 65_557);
    let eocd = -1;
    for (let i = zip.length - 22; i >= floor; i--) {
        if (zip.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0)
        throw new NotAZip();
    const count = zip.readUInt16LE(eocd + 10);
    let offset = zip.readUInt32LE(eocd + 16);
    const entries = [];
    for (let i = 0; i < count; i++) {
        if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50)
            throw new NotAZip();
        const nameLength = zip.readUInt16LE(offset + 28);
        const extraLength = zip.readUInt16LE(offset + 30);
        const commentLength = zip.readUInt16LE(offset + 32);
        if (offset + 46 + nameLength > zip.length)
            throw new NotAZip();
        entries.push({
            flags: zip.readUInt16LE(offset + 8),
            method: zip.readUInt16LE(offset + 10),
            compressedSize: zip.readUInt32LE(offset + 20),
            externalAttributes: zip.readUInt32LE(offset + 38),
            localOffset: zip.readUInt32LE(offset + 42),
            name: zip.toString("utf8", offset + 46, offset + 46 + nameLength),
        });
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}
function compressedData(zip, entry) {
    const at = entry.localOffset;
    if (at + 30 > zip.length || zip.readUInt32LE(at) !== 0x04034b50)
        return null;
    const start = at + 30 + zip.readUInt16LE(at + 26) + zip.readUInt16LE(at + 28);
    const end = start + entry.compressedSize;
    return end > zip.length ? null : zip.subarray(start, end);
}
/** Inflates for real and stops one byte past `cap`, never trusting the sizes the archive declares. */
function inflate(data, method, cap) {
    if (method === 0)
        return data.length > cap ? { over: true } : { bytes: data };
    if (method !== 8)
        return { unreadable: true };
    try {
        const bytes = inflateRawSync(data, { maxOutputLength: cap + 1 });
        return bytes.length > cap ? { over: true } : { bytes };
    }
    catch (error) {
        if (error instanceof RangeError || error.code === "ERR_BUFFER_TOO_LARGE")
            return { over: true };
        return { unreadable: true };
    }
}
const isSymlink = (entry) => ((entry.externalAttributes >>> 16) & 0o170000) === 0o120000;
const isIgnored = (path) => path.startsWith("__MACOSX/") || path.split("/").pop() === ".DS_Store";
/** Applies every zip limit and entry rule; a non-empty `problems` rejects the whole zip. */
export function checkZip(zip) {
    let entries;
    try {
        entries = centralDirectory(zip);
    }
    catch {
        return { files: [], ignored: [], problems: [{ path: "", reason: "not_a_zip" }] };
    }
    if (entries.length > ZIP_ENTRIES_MAX) {
        return { files: [], ignored: [], problems: [{ path: "", reason: "too_many_entries", limit: ZIP_ENTRIES_MAX }] };
    }
    const problems = [];
    const files = [];
    const ignored = [];
    const seen = new Set();
    let inflatedTotal = 0;
    let totalReported = false;
    for (const entry of entries) {
        const path = normalisePath(entry.name);
        if (isIgnored(path)) {
            ignored.push(entry.name);
            continue;
        }
        if (isSymlink(entry)) {
            problems.push({ path: entry.name, reason: "symlink" });
            continue;
        }
        if (entry.name.endsWith("/"))
            continue;
        const pathIssue = pathProblem(path);
        if (pathIssue) {
            problems.push({ path: entry.name, reason: pathIssue });
            continue;
        }
        if (seen.has(path))
            problems.push({ path: entry.name, reason: "duplicate_path" });
        seen.add(path);
        if (totalReported)
            continue;
        const data = compressedData(zip, entry);
        const result = data === null || entry.flags & 1 ? { unreadable: true } : inflate(data, entry.method, ZIP_FILE_MAX);
        if ("unreadable" in result) {
            problems.push({ path: entry.name, reason: "content_mismatch" });
            continue;
        }
        if ("over" in result) {
            problems.push({ path: entry.name, reason: "file_too_large", limit: ZIP_FILE_MAX });
            inflatedTotal += ZIP_FILE_MAX + 1;
        }
        else {
            inflatedTotal += result.bytes.length;
        }
        if (inflatedTotal > ZIP_TOTAL_MAX) {
            totalReported = true;
            problems.push({ path: entry.name, reason: "total_too_large", limit: ZIP_TOTAL_MAX });
        }
        if ("over" in result)
            continue;
        const size = result.bytes.length;
        if (size > RATIO_FLOOR && size > RATIO_MAX * entry.compressedSize) {
            problems.push({ path: entry.name, reason: "ratio_exceeded", limit: RATIO_MAX });
            continue;
        }
        const issue = contentProblem(path, result.bytes);
        if (issue) {
            problems.push({ path: entry.name, reason: issue });
            continue;
        }
        files.push({ path, content: result.bytes });
    }
    return { files, ignored, problems: problems.slice(0, PROBLEMS_SHOWN) };
}
