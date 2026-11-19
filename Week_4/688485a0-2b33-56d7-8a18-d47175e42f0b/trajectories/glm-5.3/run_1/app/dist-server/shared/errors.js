export class RequestError extends Error {
    code;
    status;
    extras;
    constructor(code, status, extras = {}) {
        super(code);
        this.code = code;
        this.status = status;
        this.extras = extras;
    }
    get body() {
        return { error: this.code, ...this.extras };
    }
}
export function fail(code, status, extras = {}) {
    throw new RequestError(code, status, extras);
}
export function errorBody(code, extras = {}) {
    return { error: code, ...extras };
}
export function docMessage(kind, arg) {
    switch (kind) {
        case "not_json": return "not valid JSON";
        case "not_object": return "not an object";
        case "invalid_id": return "invalid _id";
        case "invalid_field_name": return `invalid field name at ${arg}`;
        case "too_large": return `document is larger than ${arg} bytes`;
        case "too_deep": return `document is nested deeper than ${arg} levels`;
        case "row_cells": return `row has ${String(arg[0])} cells, header has ${String(arg[1])}`;
        case "missing_header": return "missing header row";
        case "duplicate_header": return `duplicate header ${arg}`;
        case "conflicting_header": return `conflicting header ${arg}`;
        default: return "";
    }
}
export function validationMessage(path, rule, expected) {
    switch (rule) {
        case "required": return `Document failed validation at ${path}: required field is missing`;
        case "bsonType": return `Document failed validation at ${path}: expected ${expected ?? "string"}`;
        case "minimum": return `Document failed validation at ${path}: must be at least ${expected}`;
        case "maximum": return `Document failed validation at ${path}: must be at most ${expected}`;
        default: return `Document failed validation at ${path}: must be one of ${expected}`;
    }
}
export function duplicateMessage(valueText, indexName) {
    return `Duplicate value ${valueText} for unique index ${indexName}`;
}
