import { Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AuthService } from './auth/auth.service';
import { tokenFromRequest } from './auth/session.guard';
import { routeKind } from '../shared/routes';

const CLIENT_DIR = join(__dirname, '..', '..', 'client');
const OUTLET = '<!--ssr-outlet-->';

type RenderApp = (url: string) => string;

@Controller()
export class PagesController {
  private readonly template = readFileSync(join(CLIENT_DIR, 'index.html'), 'utf8');
  private readonly renderApp: RenderApp = require(join(__dirname, '..', '..', 'ssr', 'entry-server.cjs')).renderApp;

  constructor(private readonly auth: AuthService) {}

  @Get('*')
  async page(@Req() request: Request, @Res() response: Response): Promise<void> {
    const path = request.path;
    if (path.startsWith('/api')) {
      response.status(404).json({ error: 'not_found' });
      return;
    }

    const kind = routeKind(path);
    const signedIn = Boolean(await this.auth.resolveSession(tokenFromRequest(request)));
    if (kind === 'studio' && !signedIn) {
      response.redirect(302, '/login');
      return;
    }
    if (signedIn && (path === '/login' || path === '/signup')) {
      response.redirect(302, '/studio');
      return;
    }

    const html = this.template.replace(OUTLET, this.renderApp(request.originalUrl));
    response.status(kind === 'none' ? 404 : 200);
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.send(html);
  }
}
