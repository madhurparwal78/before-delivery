// multipart/form-data parsing for scan uploads, keeping header bytes as UTF-8.
const CRLF = Buffer.from("\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");
function boundaryOf(contentType) {
    const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
    return match ? (match[1] ?? match[2] ?? null) : null;
}
/** The form's text fields and its `file` part, or null when the body is not well-formed multipart. */
export function parseMultipart(raw, contentType) {
    const boundary = boundaryOf(contentType);
    if (!boundary)
        return null;
    const delimiter = Buffer.from(`--${boundary}`);
    const result = { fields: {}, file: null };
    let position = raw.indexOf(delimiter);
    if (position < 0)
        return null;
    while (true) {
        position += delimiter.length;
        if (raw.subarray(position, position + 2).toString() === "--")
            return result;
        if (!raw.subarray(position, position + 2).equals(CRLF))
            return null;
        position += 2;
        const headerEnd = raw.indexOf(HEADER_END, position);
        if (headerEnd < 0)
            return null;
        const headers = raw.subarray(position, headerEnd).toString("utf8");
        const next = raw.indexOf(Buffer.concat([CRLF, delimiter]), headerEnd + 4);
        if (next < 0)
            return null;
        const data = raw.subarray(headerEnd + 4, next);
        const disposition = /^content-disposition:(.*)$/im.exec(headers)?.[1] ?? "";
        const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
        const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1];
        if (name === "file" && filename !== undefined) {
            const type = /^content-type:\s*([^;\r\n]*)/im.exec(headers)?.[1]?.trim().toLowerCase() ?? "";
            result.file = { filename, contentType: type, data: Buffer.from(data) };
        }
        else if (name !== undefined) {
            result.fields[name] = data.toString("utf8");
        }
        position = next + 2;
    }
}
