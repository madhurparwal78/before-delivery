export class ApiError extends Error {
    status;
    code;
    fields;
    headers;
    constructor(status, code, message, fields, headers = {}) {
        super(message);
        this.status = status;
        this.code = code;
        this.fields = fields;
        this.headers = headers;
    }
    body() {
        if (!this.fields)
            return { error: { code: this.code, message: this.message } };
        const sorted = Object.fromEntries(Object.entries(this.fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
        return { error: { code: this.code, message: this.message, fields: sorted } };
    }
}
export const invalid = (m, fields) => new ApiError(422, 'invalid', m.checkFields, fields);
export const notFound = (m) => new ApiError(404, 'not_found', m.notFoundApi);
export const conflict = (code, message) => new ApiError(409, code, message);
