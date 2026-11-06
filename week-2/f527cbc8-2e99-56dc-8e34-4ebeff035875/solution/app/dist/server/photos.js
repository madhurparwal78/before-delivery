// Hoof photo intake and thumbnails (brief: Business rules, Hoof photos; Thumbnails). Only the file's own bytes
// decide its type; the stored image is upright and carries no metadata.
import sharp from "sharp";
export const PHOTO_LIMIT = 8_000_000;
const PHASES = ["before", "after"];
export const isPhase = (value) => value === "before" || value === "after";
function sniff(data) {
    if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
        return "jpeg";
    if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
        return "png";
    const brand = data.subarray(8, 12).toString("latin1");
    if (data.subarray(4, 8).toString("latin1") === "ftyp" && ["heic", "heix", "mif1"].includes(brand))
        return "heic";
    return null;
}
/**
 * Decodes the whole image, applies any declared orientation to the pixels and re-encodes it without EXIF, GPS,
 * XMP, IPTC, comments or PNG text chunks. HEIC is stored as JPEG. Null when the bytes are not a complete JPEG,
 * PNG or HEIC image.
 */
export async function prepareImage(data) {
    const kind = sniff(data);
    if (!kind)
        return null;
    const upright = sharp(data, { failOn: "error" }).rotate();
    try {
        if (kind === "png") {
            const { data: out, info } = await upright.png().toBuffer({ resolveWithObject: true });
            return { data: out, contentType: "image/png", extension: "png", width: info.width, height: info.height };
        }
        const { data: out, info } = await upright.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
        return { data: out, contentType: "image/jpeg", extension: "jpg", width: info.width, height: info.height };
    }
    catch {
        return null;
    }
}
/** A 320-pixel-wide JPEG with no metadata. */
export const thumbnail = (data) => sharp(data).resize({ width: 320 }).jpeg({ quality: 80 }).toBuffer();
export const photoKey = (visitId, hoof, phase, photoId, extension) => `visits/${visitId}/${hoof}/${phase}/${photoId}.${extension}`;
export const thumbKey = (visitId, hoof, phase, photoId) => `visits/${visitId}/${hoof}/${phase}/${photoId}.thumb.jpg`;
