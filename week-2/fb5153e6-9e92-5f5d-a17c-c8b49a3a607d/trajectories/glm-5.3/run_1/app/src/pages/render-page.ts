import type { RequestContext } from '../http/types.js';
import { ApiError } from '../errors.js';
import type { PageContext } from './render.js';
import { t } from '../locales.js';
import { currentUser } from '../api/session.js';
import { redirect } from './redirects.js';

export interface PageOutcome {
  html: string;
  status: number;
}

export async function renderPage(pageName: string, ctx: PageContext, request: RequestContext): Promise<PageOutcome | null> {
  const l = ctx.locale;
  const protectedArea =
    pageName.startsWith('studio') || pageName === 'contribute' || pageName === 'contrib-queue' || pageName === 'staff' || pageName === 'staff-order';
  if (protectedArea && ctx.user === null) {
    redirect(request, `/sign-in?next=${encodeURIComponent(ctx.path)}`);
    return null;
  }
  if (protectedArea) {
    const role = ctx.user?.role ?? '';
    const allowed =
      role === 'author'
        ? true
        : role === 'editor'
          ? ['studio', 'studio-review', 'studio-collections', 'studio-model', 'studio-queue'].includes(pageName)
          : role === 'contributor'
            ? ['contribute', 'contrib-queue'].includes(pageName)
            : role === 'staff'
              ? ['staff', 'staff-order'].includes(pageName)
              : false;
    if (!allowed) {
      const html = forbiddenMarkup(l, role);
      return { html, status: 403 };
    }
  }
  switch (pageName) {
    case 'catalogue': {
      const { renderCatalogue } = await import('./catalogue.js');
      return { html: await renderCatalogue(ctx), status: 200 };
    }
    case 'model': {
      const { renderModelPage } = await import('./model.js');
      return renderModelPage(ctx, request);
    }
    case 'share': {
      const { renderSharePage } = await import('./model.js');
      return renderSharePage(ctx, request);
    }
    case 'embed': {
      const { renderEmbedPage } = await import('./model.js');
      return renderEmbedPage(ctx, request);
    }
    case 'receipt': {
      const { renderReceiptPage } = await import('./model.js');
      return renderReceiptPage(ctx, request);
    }
    case 'signin': {
      const { renderSignIn } = await import('./signin.js');
      return { html: renderSignIn(ctx), status: 200 };
    }
    case 'studio': {
      const { renderDashboard } = await import('./studio-pages.js');
      return renderDashboard(ctx);
    }
    case 'studio-upload': {
      const { renderUpload } = await import('./studio-pages.js');
      return { html: renderUpload(ctx), status: 200 };
    }
    case 'studio-review': {
      const { renderReview } = await import('./studio-pages.js');
      return { html: await renderReview(ctx), status: 200 };
    }
    case 'studio-collections': {
      const { renderCollections } = await import('./studio-pages.js');
      return { html: await renderCollections(ctx), status: 200 };
    }
    case 'studio-plan': {
      const { renderPlan } = await import('./studio-pages.js');
      return { html: await renderPlan(ctx), status: 200 };
    }
    case 'studio-keys': {
      const { renderApiKeys } = await import('./studio-pages.js');
      return { html: await renderApiKeys(ctx), status: 200 };
    }
    case 'studio-export': {
      const { renderExport } = await import('./studio-pages.js');
      return { html: renderExport(ctx), status: 200 };
    }
    case 'studio-model': {
      const { renderStudioModel } = await import('./studio-pages.js');
      return renderStudioModel(ctx, request);
    }
    case 'studio-queue': {
      const { renderQueuePage } = await import('./studio-pages.js');
      return renderQueuePage(ctx, request, 'studio');
    }
    case 'contribute': {
      const { renderContribute } = await import('./contrib-pages.js');
      return { html: await renderContribute(ctx, request), status: 200 };
    }
    case 'contrib-queue': {
      const { renderQueuePage } = await import('./studio-pages.js');
      return renderQueuePage(ctx, request, 'contrib');
    }
    case 'staff': {
      const { renderStaff } = await import('./staff-pages.js');
      return { html: await renderStaff(ctx), status: 200 };
    }
    case 'staff-order': {
      const { renderStaffOrder } = await import('./staff-pages.js');
      return { html: await renderStaffOrder(ctx, request), status: 200 };
    }
    default:
      throw new ApiError(404, 'not_found');
  }
}

function forbiddenMarkup(l: 'en' | 'de', role: string): string {
  const area =
    role === 'contributor'
      ? '/contribute'
      : role === 'staff'
        ? '/staff'
        : role === 'editor'
          ? '/studio/review'
          : '/studio';
  return `<!doctype html>
<html lang="${l === 'en' ? 'en' : 'de'}">
<head><meta charset="utf-8"><title>${t(l, 'forbidden')} · ${t(l, 'brand')}</title>
<link rel="stylesheet" href="/assets/styles.css"></head>
<body>
<main class="error-page">
  <h1>${t(l, 'forbidden')}</h1>
  <p><a href="${area}">${t(l, 'login.go_area')}</a></p>
</main>
</body>
</html>`;
}
