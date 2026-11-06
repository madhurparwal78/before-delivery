import { Controller, All, Req, Res } from '@nestjs/common';
import { renderPage, staticFile } from './pages.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const PUBLIC_PAGES = new Set(['/', '/product', '/pricing', '/team-plan', '/enterprise',
  '/enterprise-contact', '/model-licensing', '/examples', '/use-cases', '/workflows',
  '/research', '/resources', '/privacy', '/signup', '/login']);
const STUDIO_PAGES = new Set(['/studio', '/studio/projects', '/studio/credits', '/studio/team']);

/** Is this address a page of the public site or the studio? */
function isPage(pathOnly) {
  if (PUBLIC_PAGES.has(pathOnly) || STUDIO_PAGES.has(pathOnly)) return true;
  if (/^\/invite\/[^/]+$/.test(pathOnly)) return true;
  if (/^\/studio\/projects\/[^/]+$/.test(pathOnly)) return true;
  if (/^\/studio\/generations\/[^/]+$/.test(pathOnly)) return true;
  return false;
}

/**
 * Everything the JSON API does not handle: the built app's files, the
 * server-rendered pages, and the 404 page for unknown addresses.
 */
@Controller()
export class PagesController {
  @All('*')
  async pages(@Req() req, @Res() res) {
    const url = req.originalUrl || req.url;
    const pathOnly = url.split('?')[0];

    if (pathOnly.startsWith('/api')) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }
    const file = staticFile(pathOnly);
    if (file) {
      res.status(200);
      res.setHeader('Content-Type', MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream');
      res.sendFile(file);
      return;
    }
    if (!isPage(pathOnly)) {
      const html = await renderPage('/not-found');
      res.status(404).type('html').send(html);
      return;
    }
    try {
      const html = await renderPage(pathOnly);
      res.status(200).type('html').send(html);
    } catch (e) {
      console.log(`[render] ${pathOnly}: ${e.message}`);
      res.status(500).send('Server error');
    }
  }
}
