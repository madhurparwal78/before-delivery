// The API server: routes each /api request to its handler, applying the precedence order.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db } from './db';
import type { KillBillClient } from './killbill';
import type { Storage } from './storage';
import type { Mailer } from './mail';
import type { Config } from './config';
import { ApiError } from './errors';
import { isCrossSiteWrite, parseQuery, sendError, sendJsonResponse } from './http';
import { authenticateRequest, type AuthContext, type RouteContext } from './routes/context';
import * as core from './routes/core';
import * as loans from './routes/loans';
import * as fees from './routes/fees';

export class ApiServer {
  readonly route: RouteContext;

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    killbill: KillBillClient,
    storage: Storage,
    mailer: Mailer,
    status: { storage: 'up' | 'down'; billing: 'up' | 'down' },
  ) {
    this.route = { db, config, killbill, storage, mailer, status };
  }

  async handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    try {
      if (isCrossSiteWrite(req)) throw new ApiError(403, 'Cross-site request refused.');
      const auth = await authenticateRequest(this.db, this.config, req);
      const query = parseQuery(req.url ?? '/');
      const segments = pathname.replace(/^\/+/, '').split('/').filter((s) => s !== '');
      // segments[0] is "api"
      const parts = segments.slice(1);
      const ctx = { req, res, auth, route: this.route, pathname, query };
      await this.dispatch(ctx, parts);
    } catch (err) {
      sendError(res, err);
    }
  }

  private async dispatch(ctx: DispatchCtx, parts: string[]): Promise<void> {
    const method = ctx.req.method ?? 'GET';
    const [first, second, third, fourth] = parts;
    const ok = (allowed: string) => method === allowed;

    if (parts.length === 0) {
      if (ok('GET')) return void (await core.getBoard(ctx));
      throw new ApiError(404, 'Not found.');
    }

    switch (first) {
      case 'health':
        if (parts.length === 1 && ok('GET')) {
          if (!this.db.isConnected()) {
            sendJsonResponse(ctx.res, 503, { status: 'starting' });
            return;
          }
          sendJsonResponse(ctx.res, 200, { status: 'ok' });
          return;
        }
        break;
      case 'status':
        if (parts.length === 1 && ok('GET')) {
          sendJsonResponse(ctx.res, 200, { storage: this.route.status.storage, billing: this.route.status.billing });
          return;
        }
        break;
      case 'session':
        if (parts.length === 1 && ok('POST')) return void (await core.postSession(ctx));
        if (parts.length === 1 && ok('DELETE')) return void (await core.deleteSession(ctx));
        break;
      case 'me':
        if (parts.length === 1 && ok('GET')) return void (await core.getMe(ctx));
        break;
      case 'members':
        if (parts.length === 1 && ok('POST')) return void (await core.postMember(ctx));
        if (parts.length === 1 && ok('GET')) return void (await core.getMembers(ctx));
        break;
      case 'membership':
        if (parts.length === 2 && second === 'cancel' && ok('POST')) return void (await core.cancelMembership(ctx));
        break;
      case 'board':
        if (parts.length === 1 && ok('GET')) return void (await core.getBoard(ctx));
        break;
      case 'settings':
        if (parts.length === 1 && ok('GET')) return void (await core.getSettingsRoute(ctx));
        if (parts.length === 1 && ok('PUT')) return void (await core.putSettings(ctx));
        break;
      case 'calendar':
        if (parts.length === 1 && ok('GET')) return void (await core.getCalendarRoute(ctx));
        if (parts.length === 2 && second === 'hours' && ok('PUT')) return void (await core.putHours(ctx));
        break;
      case 'closures':
        if (parts.length === 1 && ok('POST')) return void (await core.postClosure(ctx));
        if (parts.length === 2 && ok('DELETE')) return void (await core.deleteClosure(ctx, second!));
        break;
      case 'items':
        if (parts.length === 1 && ok('POST')) return void (await core.postItem(ctx));
        if (parts.length === 2 && ok('GET')) return void (await core.getItem(ctx, second!));
        if (parts.length === 2 && ok('PATCH')) return void (await core.patchItem(ctx, second!));
        break;
      case 'holds':
        if (parts.length === 1 && ok('GET')) return void (await core.getHolds(ctx));
        if (parts.length === 1 && ok('POST')) return void (await core.postHold(ctx));
        if (parts.length === 2 && ok('DELETE')) return void (await core.cancelHold(ctx, second!));
        break;
      case 'loans':
        if (parts.length === 1 && ok('GET')) return void (await loans.getLoans(ctx));
        if (parts.length === 1 && ok('POST')) return void (await loans.postLoan(ctx));
        if (parts.length === 2 && ok('GET')) return void (await loans.getLoan(ctx, second!));
        if (parts.length === 2 && ok('DELETE')) return void (await loans.deleteLoan(ctx, second!));
        if (parts.length === 3 && second === 'checkout' && ok('POST')) return void (await loans.checkout(ctx, parts[0] === 'loans' ? second! : second!));
        break;
      case undefined:
        break;
    }

    // Loan actions: /api/loans/<id>/<action>...
    if (first === 'loans' && parts.length >= 3) {
      const id = parts[1]!;
      const action = parts[2]!;
      if (action === 'checkout' && parts.length === 3 && ok('POST')) return void (await loans.checkout(ctx, id));
      if (action === 'hang' && parts.length === 3 && ok('POST')) return void (await loans.hang(ctx, id));
      if (action === 'hang' && parts.length === 4 && ok('DELETE')) return void (await loans.takeDown(ctx, id, parts[3]!));
      if (action === 'checkin' && parts.length === 3 && ok('POST')) return void (await loans.checkin(ctx, id));
      if (action === 'finish' && parts.length === 3 && ok('POST')) return void (await loans.finish(ctx, id));
    }
    if (first === 'fees') {
      if (parts.length === 1 && ok('GET')) return void (await fees.getFees(ctx));
      if (parts.length === 2 && ok('GET')) return void (await fees.getFee(ctx, second!));
      if (parts.length === 3 && second !== undefined && parts[2] === 'pay' && ok('POST')) return void (await fees.payFee(ctx, second));
      if (parts.length === 3 && second !== undefined && parts[2] === 'waiver-request' && ok('POST')) return void (await fees.waiverRequest(ctx, second));
      if (parts.length === 3 && second !== undefined && parts[2] === 'waiver-decision' && ok('POST')) return void (await fees.waiverDecision(ctx, second));
    }
    if (first === 'photos' && parts.length === 2 && ok('GET')) return void (await fees.getPhoto(ctx, second!));

    void third;
    void fourth;
    throw new ApiError(404, 'Not found.');
  }
}

export interface DispatchCtx {
  req: IncomingMessage;
  res: ServerResponse;
  auth: AuthContext;
  route: RouteContext;
  pathname: string;
  query: URLSearchParams;
}
