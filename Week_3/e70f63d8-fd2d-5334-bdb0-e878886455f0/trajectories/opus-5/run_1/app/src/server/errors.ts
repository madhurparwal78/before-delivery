import { MSG } from '../shared/messages.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    override readonly message: string,
    readonly extra?: { fields?: Record<string, string>; seq?: number; holder?: string | null },
  ) {
    super(message);
  }

  body(): { error: { code: string; message: string; fields?: Record<string, string>; seq?: number; holder?: string | null } } {
    const error: {
      code: string;
      message: string;
      fields?: Record<string, string>;
      seq?: number;
      holder?: string | null;
    } = { code: this.code, message: this.message };
    if (this.extra && 'fields' in this.extra && this.extra.fields) error.fields = this.extra.fields;
    else if (this.extra && 'seq' in this.extra && this.extra.seq !== undefined) error.seq = this.extra.seq;
    else if (this.extra && 'holder' in this.extra) error.holder = this.extra.holder ?? null;
    return { error };
  }
}

export const notFound = (): HttpError => new HttpError(404, 'NOT_FOUND', MSG.notFound);
export const signInRequired = (): HttpError =>
  new HttpError(401, 'SIGN_IN_REQUIRED', MSG.signInRequired);
export const validation = (fields: Record<string, string>): HttpError =>
  new HttpError(422, 'VALIDATION', MSG.fieldErrors, { fields });
