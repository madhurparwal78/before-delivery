// Mail headers. No user-written text ever reaches a header; the only
// user-supplied value is the validated recipient address.

export const MAIL_FROM = process.env.MAIL_FROM ?? 'Scopewright <no-reply@scopewright.test>';
