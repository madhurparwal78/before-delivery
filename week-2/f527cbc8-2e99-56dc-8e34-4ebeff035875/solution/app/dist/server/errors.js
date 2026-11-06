// The one error shape every route answers with: {"error":"<code>", ...extra} (brief: API, General rules), and the
// field error copy that is also the text of each 422 `errors` value (brief: Feedback states).
export class ApiError extends Error {
    status;
    code;
    extra;
    headers;
    constructor(status, code, extra = {}, headers = {}) {
        super(code);
        this.status = status;
        this.code = code;
        this.extra = extra;
        this.headers = headers;
    }
    body() {
        return { error: this.code, ...this.extra };
    }
}
export const notFound = () => new ApiError(404, "not_found");
export const forbidden = () => new ApiError(403, "forbidden");
export const conflict = (code, extra = {}) => new ApiError(409, code, extra);
export const illegalTransition = (from, action) => new ApiError(409, "illegal_transition", { from, action });
export const FIELD_COPY = {
    email: "Enter a valid email address.",
    required: "This is required.",
    pastDate: "Pick today or a later date.",
    amount: "Enter an amount in dollars, like 45.00.",
    coordinates: "Keep both points inside the photo and apart from each other.",
    gap: (zone) => `That time does not exist on that date in ${zone}.`,
    cardNumber: "Enter a test card token, never a card number.",
    unknownCard: "Choose one of the test cards.",
    unknownVersion: "That version is not in this hoof's history.",
    chunk: (chunkBytes) => `Send exactly ${chunkBytes} bytes, or the rest of the file.`,
    range: (min, max) => `Enter a number from ${min} to ${max}.`,
};
export const validation = (errors) => new ApiError(422, "validation", { errors });
/** Throws the 422 when any field error was collected. */
export function refuseInvalid(errors) {
    if (Object.keys(errors).length)
        throw validation(errors);
}
