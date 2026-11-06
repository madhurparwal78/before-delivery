import { refusals } from '../shared/copy.js';

/** The one refusal shape. Every refusal that leaves the server is built here. */
export class Refusal extends Error {
  constructor(status, wording, extra = {}) {
    super(wording);
    this.name = 'Refusal';
    this.status = status;
    this.wording = wording;
    this.extra = extra;
  }

  get body() {
    const body = { error: this.wording };
    if (this.extra.field !== undefined) body.field = this.extra.field;
    if (this.extra.decided_by !== undefined) body.decided_by = this.extra.decided_by;
    if (this.extra.decided_at !== undefined) body.decided_at = this.extra.decided_at;
    return body;
  }
}

export function refuse(status, wording, extra) {
  throw new Refusal(status, wording, extra);
}

export function refuseField(status, wording, field) {
  throw new Refusal(status, wording, { field });
}

export const noSuchRequest = () => new Refusal(404, refusals.noSuchRequest);
export const noSuchPerson = () => new Refusal(404, refusals.noSuchPerson);
export const noSuchLink = () => new Refusal(404, refusals.noSuchLink);
export const signedOut = () => new Refusal(401, refusals.signedOut);
export const sessionEnded = () => new Refusal(401, refusals.sessionEnded);
