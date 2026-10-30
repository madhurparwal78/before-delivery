import { readFileSync } from 'node:fs';
import type { NextFunction, Request, Response } from 'express';
import type { Area, PageData } from '../web/data.js';
import type { AuthService } from './auth.js';
import type { TeamService } from './team.js';

/** The server half of the browser app, built by Vite (`dist/ssr/entry-server.js`). */
export interface PageRenderer {
  render(url: string, data: PageData): string;
  resolvePage(path: string): { title: string; area: Area; params: Record<string, string> };
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Serves every page address: public pages with all their words in the first HTML, the studio only with a live
 * session (else a redirect to /login), and a 404 page with the public chrome for anything else.
 */
export function pageServer(templatePath: string, renderer: PageRenderer, auth: AuthService, team: TeamService) {
  const template = readFileSync(templatePath, 'utf8');

  return async (req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path === '/api' || req.path.startsWith('/api/')) {
      return next();
    }
    try {
      const path = req.path.replace(/\/+$/, '') || '/';
      const page = renderer.resolvePage(path);
      const data: PageData = {};
      if (page.area === 'studio' || page.area === 'account') {
        const token = auth.tokenOf(req);
        const member = token ? await auth.memberForToken(token) : null;
        if (page.area === 'studio' && !member) return res.redirect(302, '/login');
        if (page.area === 'account' && member) return res.redirect(302, '/studio');
        if (member) data.me = await auth.profile(member);
      }
      if (page.area === 'invite') data.invitation = (await team.invitationByToken(page.params.token)) ?? null;
      const query = req.url.slice(req.path.length);
      const html = template
        .replace('<!--title-->', () => escapeHtml(page.title))
        .replace('<!--app-->', () => renderer.render(path + query, data))
        .replace('<!--data-->', () => JSON.stringify(data).replace(/</g, '\\u003c'));
      res
        .status(page.area === 'missing' ? 404 : 200)
        .set('Cache-Control', 'no-store')
        .type('html')
        .send(html);
    } catch (error) {
      next(error);
    }
  };
}
