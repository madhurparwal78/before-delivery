import type { FormDetail, Person } from '../../shared/types.ts';
import { ApiFailure, api } from '../lib/api.ts';
import { frame, notFound, ready } from '../lib/shell.ts';
import { canvas } from '../builder/canvas.ts';
import type { Context } from '../builder/context.ts';
import { builderLayout } from '../builder/layout.ts';
import { logicPane } from '../builder/logic.ts';
import { pagesPane } from '../builder/pages-pane.ts';
import { Store } from '../builder/store.ts';
import { Sync } from '../builder/sync.ts';
import { topbar } from '../builder/topbar.ts';
import { Trial } from '../builder/trial.ts';

// `/forms/<id>/edit`: the builder. The draft, the trial and live editing are the builder modules; this screen
// loads the form, joins live editing and assembles the top bar and the three panes.

export async function render(params: Record<string, string>): Promise<void> {
  const id = params['id'] ?? '';
  const main = frame({ owner: true, form: { id, current: 'edit' } });
  let detail: FormDetail;
  let me: Person;
  try {
    const [form, session] = await Promise.all([api<FormDetail>('GET', `/api/forms/${id}`), api<{ user: Person }>('GET', '/api/session')]);
    detail = form;
    me = { id: session.user.id, name: session.user.name };
  } catch (error) {
    if (error instanceof ApiFailure) return notFound();
    throw error;
  }
  const store = new Store(detail, me);
  const sync = new Sync(store);
  await sync.start();
  const context: Context = { store, sync, trial: new Trial(store) };
  const { switcher, panes } = builderLayout(pagesPane(context), canvas(context), logicPane(context));
  main.append(topbar(context), switcher, panes);
  ready(main, `${store.draft.title} - Nightform`);
  void context.trial.evaluate();
}
