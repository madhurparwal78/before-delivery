import { invalid } from './errors.js';
import { PROVINCES } from '../shared/catalog.js';
const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROL_EXCEPT_NEWLINES = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/;
function fail(scope, path, message) {
    scope.issues[path] = message(scope.m);
    return undefined;
}
/** A trimmed text of `min` to `max` characters; single-line unless `multiline`. */
export function text(message, min = 1, max = 500, multiline = false) {
    return (value, path, scope) => {
        if (typeof value !== 'string')
            return fail(scope, path, message);
        const trimmed = value.trim();
        const length = [...trimmed].length;
        if ((multiline ? CONTROL_EXCEPT_NEWLINES : CONTROL).test(value) || length < min || length > max)
            return fail(scope, path, message);
        return trimmed;
    };
}
/** A bare address: 3 to 254 characters, one `@`, a dotted domain, no space, comma, semicolon, bracket, quote or control. */
export function email() {
    return (value, path, scope) => {
        const message = (m) => m.fields.email;
        if (typeof value !== 'string')
            return fail(scope, path, message);
        const address = value.trim();
        const at = address.indexOf('@');
        const valid = address.length >= 3 &&
            address.length <= 254 &&
            at > 0 &&
            at === address.lastIndexOf('@') &&
            address.slice(at + 1).includes('.') &&
            !/[\s,;<>"'\u0000-\u001f\u007f]/.test(address) &&
            !address.endsWith('.') &&
            !address.slice(at + 1).startsWith('.');
        return valid ? address.toLowerCase() : fail(scope, path, message);
    };
}
export function oneOf(values, message) {
    return (value, path, scope) => (values.includes(value) ? value : fail(scope, path, message));
}
export function integer(min, max, message) {
    return (value, path, scope) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fail(scope, path, message);
}
export function boolean(message) {
    return (value, path, scope) => (typeof value === 'boolean' ? value : fail(scope, path, message));
}
export function list(item, message, min = 1, max = 48) {
    return (value, path, scope) => {
        if (!Array.isArray(value) || value.length < min || value.length > max)
            return fail(scope, path, message);
        const out = [];
        value.forEach((entry, index) => {
            const parsed = item(entry, `${path}.${index}`, scope);
            if (parsed !== undefined)
                out.push(parsed);
        });
        return out.length === value.length ? out : undefined;
    };
}
export function optional(check) {
    return Object.assign((value, path, scope) => check(value, path, scope), { optional: true });
}
/** A closed object: every key outside `shape` is reported under its dotted path. */
export function object(shape, message = (m) => m.fields.cantSet) {
    return (value, path, scope) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return fail(scope, path || '', message);
        }
        const record = value;
        const out = {};
        let complete = true;
        for (const key of Object.keys(record)) {
            if (!(key in shape)) {
                scope.issues[path ? `${path}.${key}` : key] = scope.m.fields.cantSet;
                complete = false;
            }
        }
        for (const [key, check] of Object.entries(shape)) {
            if (check.optional && record[key] === undefined)
                continue;
            const parsed = check(record[key], path ? `${path}.${key}` : key, scope);
            if (parsed === undefined)
                complete = false;
            else
                out[key] = parsed;
        }
        return complete ? out : undefined;
    };
}
/** Reads a body against its declaration, or throws 422 with every failing field. */
export function read(declaration, body, m) {
    const scope = { m, issues: {} };
    const parsed = declaration(body ?? {}, '', scope);
    if (parsed === undefined || Object.keys(scope.issues).length > 0)
        throw invalid(m, scope.issues);
    return parsed;
}
const POSTAL_CODE = /^([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]) ?(\d[ABCEGHJ-NPRSTV-Z]\d)$/i;
function postalCode() {
    return (value, path, scope) => {
        const match = typeof value === 'string' ? POSTAL_CODE.exec(value.trim()) : null;
        return match ? `${match[1]} ${match[2]}`.toUpperCase() : fail(scope, path, (m) => m.fields.postal_code);
    };
}
/** The closed shipping object shared by checkout and subscription start. */
export const shippingAddress = object({
    name: text((m) => m.fields.name, 1, 120),
    line1: text((m) => m.fields.line1, 1, 200),
    city: text((m) => m.fields.city, 1, 100),
    province: oneOf(PROVINCES.map((p) => p.code), (m) => m.fields.province),
    postal_code: postalCode(),
});
/** Reads one declared field without reporting, for the checks the error precedence makes before validation. */
export function peek(check, value, m) {
    return check(value, '', { m, issues: {} });
}
