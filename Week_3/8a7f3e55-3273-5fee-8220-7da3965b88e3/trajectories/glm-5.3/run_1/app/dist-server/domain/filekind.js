// File-kind detection from bytes only, plus the stored media type for each kind.
import { ACCEPTED_TYPES } from '../shared/terms.js';
export const KIND_MEDIA_TYPES = {
    pdf: ACCEPTED_TYPES[0],
    png: ACCEPTED_TYPES[1],
    jpeg: ACCEPTED_TYPES[2],
    docx: ACCEPTED_TYPES[3],
    pptx: ACCEPTED_TYPES[4],
};
const ZIP_LOCAL_HEADER = 0x04034b50; // bytes 50 4B 03 04 read little-endian
/** Read an entry name from a ZIP local file header at the given offset. */
function zipEntryName(buf, offset) {
    if (offset + 30 > buf.length)
        return null;
    if (buf.readUInt32LE(offset) !== ZIP_LOCAL_HEADER)
        return null;
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    if (nameStart + nameLen > buf.length)
        return null;
    return buf.subarray(nameStart, nameStart + nameLen).toString('latin1');
}
/** True when every entry name in the ZIP is relative and free of `..` segments. */
function zipEntriesSafe(buf) {
    let offset = 0;
    let seen = 0;
    while (offset + 30 <= buf.length && seen < 4096) {
        if (buf.readUInt32LE(offset) !== ZIP_LOCAL_HEADER)
            break;
        const name = zipEntryName(buf, offset);
        if (name === null)
            break;
        if (name.startsWith('/') || name.includes('..'))
            return false;
        const compLen = buf.readUInt32LE(offset + 18);
        const nameLen = buf.readUInt16LE(offset + 26);
        const extraLen = buf.readUInt16LE(offset + 28);
        offset = offset + 30 + nameLen + extraLen + compLen;
        seen++;
        if (compLen === 0)
            break;
    }
    return true;
}
function zipContains(buf, target) {
    let offset = 0;
    let seen = 0;
    while (offset + 30 <= buf.length && seen < 4096) {
        if (buf.readUInt32LE(offset) !== ZIP_LOCAL_HEADER)
            break;
        const name = zipEntryName(buf, offset);
        if (name === null)
            break;
        if (name === target)
            return true;
        const compLen = buf.readUInt32LE(offset + 18);
        const nameLen = buf.readUInt16LE(offset + 26);
        const extraLen = buf.readUInt16LE(offset + 28);
        if (compLen === 0 && name !== target) {
            offset = offset + 30 + nameLen + extraLen;
            seen++;
            continue;
        }
        offset = offset + 30 + nameLen + extraLen + compLen;
        seen++;
    }
    // Fall back to a raw substring search for stored or unusual layouts.
    return buf.includes(Buffer.from(target, 'latin1'));
}
/** Decide the kind from the bytes only. File name, extension and declared type play no part. */
export function detectKind(buf) {
    if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-')
        return 'pdf';
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
        return 'png';
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
        return 'jpeg';
    if (buf.length >= 4 && buf.readUInt32LE(0) === ZIP_LOCAL_HEADER) {
        if (!zipEntriesSafe(buf))
            return null;
        if (zipContains(buf, 'word/document.xml'))
            return 'docx';
        if (zipContains(buf, 'ppt/presentation.xml'))
            return 'pptx';
        return null;
    }
    return null;
}
