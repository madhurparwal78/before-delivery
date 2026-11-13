// Sign-in, the session and the service status.
import { route, jsonBody } from "../http.js";
import { pool, rows } from "../db.js";
import { ApiError, FieldErrors } from "../errors.js";
import { mailUp } from "../mail.js";
import { authenticate, CLEARED_COOKIE, endSession, passcodeMatches, PERSON_SELECT, personOf, startSession, userOf, } from "../people.js";
import { storageUp } from "../scoreStore.js";
import { field } from "../validate.js";
route("POST", "/api/session", "json", async (request) => {
    const body = jsonBody(request);
    const email = field(body, "email");
    const passcode = field(body, "passcode");
    const errors = new FieldErrors();
    if (typeof email !== "string" || email.trim() === "")
        errors.add("email", "Enter your email.");
    if (typeof passcode !== "string" || passcode === "")
        errors.add("passcode", "Enter your passcode.");
    if (typeof email !== "string" || typeof passcode !== "string" || errors.any())
        throw errors.error();
    const [row] = await rows(pool, `${PERSON_SELECT} WHERE lower(p.email) = lower($1)`, [email.trim()]);
    if (!row || !passcodeMatches(passcode, row.passcode_hash)) {
        throw new ApiError(401, { error: "invalid_credentials", message: "That email and passcode don't match." });
    }
    const person = personOf(row);
    return { status: 200, json: { user: userOf(person) }, cookie: await startSession(pool, person.id) };
});
route("GET", "/api/session", "none", async (request) => {
    const person = await authenticate(pool, request);
    return { status: 200, json: { user: userOf(person) } };
});
route("DELETE", "/api/session", "none", async (request) => {
    await authenticate(pool, request);
    await endSession(pool, request);
    return { status: 204, cookie: CLEARED_COOKIE };
});
route("GET", "/api/status", "none", async (request) => {
    await authenticate(pool, request);
    const [storage, mail] = await Promise.all([storageUp(), mailUp()]);
    return { status: 200, json: { storage: storage ? "up" : "down", mail: mail ? "up" : "down" } };
});
