import type { PenSummary } from '../../shared/api';
import { copy } from '../../shared/copy';
import { api } from '../api';
import { panel, penList } from '../components/penlist';
import { siteHeader, verifyBanner, watchVerification } from '../components/shell';
import { h, replace, say, status } from '../dom';
import { mountPage, splitPage } from '../layout';
import { PreviewHost } from '../preview';
import { goto } from '../router';
import { live, me } from '../store';

export const dashboardPage = async (): Promise<void> => {
  if (!me()) {
    window.location.replace('/signin');
    return;
  }
  const { root, stage, column } = splitPage(siteHeader(), 'stage-list');
  const region = h('div', { class: 'stage-inner' });
  stage.appendChild(region);

  const banner = verifyBanner();
  const dashboardStatus = status('Dashboard status');
  const list = h('div', { class: 'list-holder' });

  replace(column, [
    banner,
    h('button', {
      type: 'button',
      class: 'action accent',
      text: 'Start a pen',
      onclick: async () => {
        const pen = await api.post<{ id: string }>('/api/pens');
        goto(`/pen/${pen.id}`);
      },
    }),
    dashboardStatus,
    list,
  ]);
  mountPage(root);

  const deleted = window.sessionStorage.getItem('ashlar.deleted');
  if (deleted) {
    window.sessionStorage.removeItem('ashlar.deleted');
    say(dashboardStatus, copy.deleted(deleted));
  }

  const preview = new PreviewHost({ region, crossfade: true });
  const pens = (await api.get<{ pens: PenSummary[] }>('/api/pens')).pens;
  replace(list, [
    pens.length === 0
      ? panel(copy.dashboardEmpty)
      : penList('Your pens', pens, { preview }),
  ]);
  if (pens.length > 0 && pens[0]!.head > 0) {
    void preview.show({ penId: pens[0]!.id }).catch(() => undefined);
  }

  live(
    pens.map((pen) => pen.id),
    { account: watchVerification(banner) },
  );
};
