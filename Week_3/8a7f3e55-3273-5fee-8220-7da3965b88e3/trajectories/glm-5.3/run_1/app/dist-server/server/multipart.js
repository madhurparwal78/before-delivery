export function parseMultipart(body, boundary) {
    const result = { fields: {}, files: [] };
    const dashBoundary = Buffer.from(`--${boundary}`);
    let index = body.indexOf(dashBoundary);
    while (index !== -1) {
        const start = index + dashBoundary.length;
        if (body.slice(start, start + 2).toString('latin1') === '--')
            break;
        // Skip CRLF after the boundary.
        let cursor = start;
        if (body[cursor] === 0x0d && body[cursor + 1] === 0x0a)
            cursor += 2;
        const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), cursor);
        if (headerEnd === -1)
            break;
        const headerText = body.slice(cursor, headerEnd).toString('utf8');
        const nextBoundary = body.indexOf(dashBoundary, headerEnd + 4);
        const partEnd = nextBoundary === -1 ? body.length : nextBoundary - 2; // drop trailing CRLF
        const content = body.slice(headerEnd + 4, partEnd);
        const headers = {};
        for (const line of headerText.split('\r\n')) {
            const colon = line.indexOf(':');
            if (colon === -1)
                continue;
            headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
        }
        const disposition = headers['content-disposition'] ?? '';
        const nameMatch = /name="([^"]*)"/.exec(disposition);
        const fileMatch = /filename="([^"]*)"/.exec(disposition);
        const name = nameMatch ? nameMatch[1] : '';
        if (fileMatch) {
            result.files.push({
                name,
                filename: fileMatch[1],
                contentType: headers['content-type'] ?? 'application/octet-stream',
                bytes: content,
            });
        }
        else {
            result.fields[name] = content.toString('utf8');
        }
        index = nextBoundary;
    }
    return result;
}
export function boundaryOf(contentType) {
    const match = /boundary="?([^";]+)"?/i.exec(contentType);
    return match ? match[1] : null;
}
