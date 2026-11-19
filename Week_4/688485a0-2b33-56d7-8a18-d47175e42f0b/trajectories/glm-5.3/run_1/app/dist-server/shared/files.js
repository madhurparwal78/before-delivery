import { isDateObject, compactJson, numberText } from "./values.js";
/** Split text into physical lines, keeping a trailing empty line as a real line. */
export function physicalLines(text) {
    if (text === "")
        return [];
    const out = text.split("\n");
    if (out[out.length - 1] === "" && /(^|[^\r])\n$/.test(text))
        out.pop();
    return out.map(l => l.endsWith("\r") ? l.slice(0, -1) : l);
}
/** JSON-lines: each non-blank line is one JSON object. */
export function parseJsonLines(text) {
    const lines = physicalLines(text);
    const docs = [];
    const errors = [];
    lines.forEach((line) => {
        if (line.trim() === "") {
            docs.push(null);
            errors.push(null);
            return;
        }
        try {
            const v = JSON.parse(line);
            if (typeof v !== "object" || v === null || Array.isArray(v)) {
                docs.push(null);
                errors.push("not an object");
            }
            else {
                docs.push(v);
                errors.push(null);
            }
        }
        catch {
            docs.push(null);
            errors.push("not valid JSON");
        }
    });
    return { docs, errors };
}
export function parseCsv(text) {
    // strip a leading UTF-8 BOM
    if (text.charCodeAt(0) === 0xfeff)
        text = text.slice(1);
    const rows = [];
    let cur = [];
    let field = "";
    let inQuotes = false;
    let line = 1;
    let i = 0;
    let rowHasContent = false;
    const endField = () => {
        cur.push(field);
        field = "";
    };
    const endRow = () => {
        endField();
        rows.push({ cells: cur, line });
        cur = [];
        rowHasContent = false;
    };
    while (i < text.length) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i++;
                continue;
            }
            if (ch === "\n")
                line++;
            field += ch;
            i++;
            continue;
        }
        if (ch === '"' && field === "") {
            inQuotes = true;
            rowHasContent = true;
            i++;
            continue;
        }
        if (ch === ",") {
            endField();
            rowHasContent = true;
            i++;
            continue;
        }
        if (ch === "\r" && text[i + 1] === "\n") {
            if (rowHasContent || field !== "" || cur.length > 0)
                endRow();
            line++;
            i += 2;
            continue;
        }
        if (ch === "\n") {
            if (rowHasContent || field !== "" || cur.length > 0)
                endRow();
            line++;
            i++;
            continue;
        }
        field += ch;
        rowHasContent = true;
        i++;
    }
    if (inQuotes)
        return { header: null, records: [], headerError: null };
    if (field !== "" || rowHasContent || cur.length > 0)
        endRow();
    // classify: the first row is the header; a blank physical line outside quotes is skipped
    const nonBlank = rows.filter(r => !(r.cells.length === 1 && r.cells[0] === ""));
    if (nonBlank.length === 0)
        return { header: null, records: [], headerError: "missing header row" };
    const headerRow = nonBlank[0];
    const header = headerRow.cells;
    let headerError = null;
    const seen = new Set();
    for (const h of header) {
        if (seen.has(h))
            headerError = headerError ?? `duplicate header ${h}`;
        seen.add(h);
    }
    // conflicting: a header that is a strict prefix path of another (a.b vs a.b.c)
    const sortedH = [...header].sort();
    for (let a = 0; a < sortedH.length; a++) {
        for (let b = a + 1; b < sortedH.length; b++) {
            if (sortedH[b].startsWith(sortedH[a] + ".")) {
                headerError = headerError ?? `conflicting header ${sortedH[a]}`;
            }
        }
    }
    const records = nonBlank.slice(1).map(r => ({ line: r.line, cells: r.cells }));
    return { header, records, headerError };
}
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const DATE_CELL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** Cell type inference (DP-71). */
export function cellValue(cell) {
    if (cell === "")
        return undefined; // an empty cell leaves the field out
    if (cell === "true")
        return true;
    if (cell === "false")
        return false;
    if (cell === "null")
        return null;
    if (NUMBER_RE.test(cell))
        return Number(cell);
    if (DATE_CELL_RE.test(cell))
        return { $date: cell };
    return cell;
}
/** Build nested fields from dotted headers. */
export function rowToDocument(header, cells) {
    const doc = {};
    header.forEach((h, idx) => {
        const v = cellValue(cells[idx] ?? "");
        if (v === undefined)
            return;
        const parts = h.split(".");
        let cur = doc;
        for (let p = 0; p < parts.length - 1; p++) {
            const key = parts[p];
            const next = cur[key];
            if (typeof next !== "object" || next === null || Array.isArray(next))
                cur[key] = {};
            cur = cur[key];
        }
        cur[parts[parts.length - 1]] = v;
    });
    return doc;
}
/** The scalar leaf paths of a document, descending into objects. */
export function leafPaths(doc, prefix, out) {
    for (const k of Object.keys(doc)) {
        const path = prefix ? prefix + "." + k : k;
        const v = doc[k];
        if (typeof v === "object" && v !== null && !Array.isArray(v) && !isDateObject(v) && Object.keys(v).length > 0) {
            leafPaths(v, path, out);
        }
        else {
            out.push(path);
        }
    }
}
/** Standard CSV quoting for one cell. */
function csvQuote(text) {
    if (/[",\r\n]/.test(text))
        return '"' + text.replace(/"/g, '""') + '"';
    return text;
}
const FORMULA_CHARS = ["=", "+", "-", "@", "\t", "\r"];
/** Spreadsheet-safe CSV: cells starting with a formula character get a leading apostrophe, except numbers. */
function csvCell(text, isNumber) {
    if (!isNumber && text.length > 0 && FORMULA_CHARS.includes(text[0]))
        return csvQuote("'" + text);
    return csvQuote(text);
}
/** The CSV text of documents: code-unit-sorted union of scalar leaf paths, CRLF endings. */
export function docsToCsvText(docs) {
    const columns = new Set();
    for (const doc of docs) {
        const paths = [];
        leafPaths(doc, "", paths);
        for (const p of paths)
            columns.add(p);
    }
    const cols = [...columns].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const lines = [cols.map(c => csvCell(c, false)).join(",")];
    for (const doc of docs) {
        const cells = cols.map(c => {
            const parts = c.split(".");
            let cur = doc;
            for (const p of parts) {
                if (typeof cur !== "object" || cur === null || Array.isArray(cur)) {
                    cur = null;
                    break;
                }
                if (!Object.prototype.hasOwnProperty.call(cur, p)) {
                    return ""; // missing values are empty
                }
                cur = cur[p];
            }
            if (cur === null)
                return csvCell("null", false);
            if (typeof cur === "boolean")
                return csvCell(cur ? "true" : "false", false);
            if (typeof cur === "number")
                return csvCell(numberText(cur), true);
            if (isDateObject(cur))
                return csvCell(cur["$date"], false);
            if (typeof cur === "string")
                return csvCell(cur, false);
            return csvCell(compactJson(cur), false); // arrays and empty objects as compact JSON
        });
        lines.push(cells.join(","));
    }
    return lines.join("\r\n") + "\r\n";
}
/** JSON-lines text: one compact document per line, LF endings and a final LF. */
export function docsToJsonlText(docs) {
    return docs.map(d => compactJson(d)).join("\n") + "\n";
}
