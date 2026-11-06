import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { FieldErrors } from '../shared/rules.js';

/** A refusal the brief names: `{"error", ...details}` for 401-409, `{"errors"}` for 422. */
class ApiError extends HttpException {
  constructor(status: number, body: Record<string, unknown>) {
    super(body, status);
  }
}

export const refuse = (status: number, error: string, details: Record<string, unknown> = {}) =>
  new ApiError(status, { error, ...details });

export const invalid = (errors: FieldErrors) => new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, { errors });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Record ids are uuids; anything else names no record. */
export function recordId(id: string): string {
  if (!UUID.test(id)) throw refuse(HttpStatus.NOT_FOUND, 'not_found');
  return id;
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ApiError) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const error = status === HttpStatus.NOT_FOUND ? 'not_found' : status >= 500 ? 'unavailable' : 'bad_request';
      response.status(status).json({ error });
      return;
    }
    this.logger.error((exception as Error)?.stack ?? String(exception));
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'server_error' });
  }
}
