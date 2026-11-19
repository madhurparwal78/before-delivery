export interface Failure {
  status: number;
  body: { error: string; message: string; fields?: Record<string, string>; winner?: { display_name: string; claim_id: string } };
}

export class Refusal extends Error {
  readonly status: number;
  readonly code: string = "";
  readonly failure: Failure;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>, extra?: { display_name: string; claim_id: string }) {
    super(message);
    this.status = status;
    this.code = code;
    const body: Failure["body"] = { error: code, message };
    if (fields && Object.keys(fields).length) body.fields = fields;
    if (extra) body.winner = extra;
    this.failure = { status, body };
  }
}
