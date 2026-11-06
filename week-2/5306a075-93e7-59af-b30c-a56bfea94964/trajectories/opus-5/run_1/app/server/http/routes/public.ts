import { AppError } from '../../errors';
import { PUBLIC_PAGE_HEADERS, Router } from '../kernel';
import { inactiveRoadmapPage, publicRoadmapPage } from '../pages';
import { loadPublicRoadmap } from './roadmap';

const linkInactive = (): AppError =>
  new AppError(404, 'link_inactive', 'This roadmap link is no longer active.');

export function registerPublicRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/public/roadmap/:token',
    access: 'public',
    handle: async (ctx) => {
      const roadmap = await loadPublicRoadmap(ctx.db, ctx.params.token);
      if (roadmap === null) throw linkInactive();
      return {
        status: 200,
        json: { columns: roadmap.columns },
        headers: { ...PUBLIC_PAGE_HEADERS },
      };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/r/:token',
    access: 'public',
    handle: async (ctx) => {
      const roadmap = await loadPublicRoadmap(ctx.db, ctx.params.token);
      if (roadmap === null) {
        return { status: 404, html: inactiveRoadmapPage(), headers: { ...PUBLIC_PAGE_HEADERS } };
      }
      return {
        status: 200,
        html: publicRoadmapPage(roadmap.columns),
        headers: { ...PUBLIC_PAGE_HEADERS },
      };
    },
  });
}
