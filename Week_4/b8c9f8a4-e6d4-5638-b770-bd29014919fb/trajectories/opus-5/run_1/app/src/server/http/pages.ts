import { Router, type Request, type Response } from 'express';
import { hasOwnerSession } from './session';

const shell = (title: string, bundle: 'owner' | 'link', bodyClass: string): string => `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content">
<title>${title}</title>
<link rel="preload" href="/fonts/outfit-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/open-bonnet.css">
<script type="module" src="/${bundle}.js"></script>
</head>
<body class="${bodyClass}">
<div id="app" data-screen="${bundle}"></div>
</body>
</html>`;

export const pageRouter = Router();

/** A signed-out visit to any owner page below /owner/ goes to /owner?return=<path>. */
const requireOwnerPage = async (request: Request, response: Response): Promise<boolean> => {
  if (await hasOwnerSession(request)) return true;
  response.redirect(302, `/owner?return=${encodeURIComponent(request.path)}`);
  return false;
};

pageRouter.get('/', (_request: Request, response: Response) => {
  response.redirect(302, '/owner');
});

pageRouter.get('/owner', (_request: Request, response: Response) => {
  response.type('html').send(shell('Open Bonnet', 'owner', 'owner-screen'));
});

pageRouter.get('/owner/cars', async (request: Request, response: Response) => {
  if (!(await requireOwnerPage(request, response))) return;
  response.type('html').send(shell('Garage · Open Bonnet', 'owner', 'owner-screen'));
});

pageRouter.get('/owner/cars/:id', async (request: Request, response: Response) => {
  if (!(await requireOwnerPage(request, response))) return;
  response.type('html').send(shell('Car file · Open Bonnet', 'owner', 'owner-screen'));
});

pageRouter.get('/l/:token', (_request: Request, response: Response) => {
  response.type('html').send(shell('Open Bonnet', 'link', 'link-screen'));
});
