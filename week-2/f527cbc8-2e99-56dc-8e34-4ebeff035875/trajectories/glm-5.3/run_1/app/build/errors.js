export class AppError extends Error {
    status;
    code;
    extra;
    constructor(status, code, extra = {}) {
        super(code);
        this.status = status;
        this.code = code;
        this.extra = extra;
    }
    body() {
        return { error: this.code, ...this.extra };
    }
}
export class ValidationError extends AppError {
    errors;
    constructor(errors) {
        super(422, 'validation');
        this.errors = errors;
    }
    body() {
        return { error: 'validation', errors: this.errors };
    }
}
export class ImportInvalidError extends AppError {
    errors;
    constructor(errors) {
        super(422, 'import_invalid');
        this.errors = errors;
    }
    body() {
        return { error: 'import_invalid', errors: this.errors };
    }
}
export class IllegalTransition extends AppError {
    constructor(from, action) {
        super(409, 'illegal_transition', { from, action });
    }
}
export class StaleMarks extends AppError {
    current;
    constructor(current) {
        super(412, 'stale_marks');
        this.current = current;
    }
    body() {
        return { error: 'stale_marks', current: this.current };
    }
}
export class Handled {
    handled;
    constructor(handled) {
        this.handled = handled;
    }
}
export function sendError(res, requestId, err) {
    if (err instanceof AppError) {
        res.writeHead(err.status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Request-Id': requestId });
        res.end(JSON.stringify(err.body()));
    }
    else {
        process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'internal_error', request_id: requestId, error: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) }) + '\n');
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'X-Request-Id': requestId });
        res.end(JSON.stringify({ error: 'internal_error' }));
    }
}
