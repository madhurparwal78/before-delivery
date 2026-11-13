import { getJson, postJson, serverText, type ApiErrorBody, type Vessel } from '../api.js';
import { COPY } from '../copy.js';
import { button, el, selectField, setStatus, textField, wireInternalLink } from '../dom.js';
import { openDialog } from '../ui/dialog.js';
import type { Page, PageContext } from '../main.js';

const VESSEL_KINDS = [
  { value: 'workboat', label: 'Workboat' },
  { value: 'survey_boat', label: 'Survey boat' },
  { value: 'coaster', label: 'Small coaster' },
  { value: 'charter_yacht', label: 'Charter yacht' },
];

export async function renderFleet(context: PageContext): Promise<Page> {
  const list = el('ul', { class: 'vessel-list' });
  const addVessel = button('Add a vessel', { class: 'primary' });

  const load = async (): Promise<void> => {
    const result = await getJson<{ vessels: Vessel[] }>('/api/vessels');
    list.replaceChildren(
      ...(result.ok ? result.body.vessels : []).map((vessel) =>
        el('li', {}, [
          wireInternalLink(
            el('a', { href: `/vessels/${vessel.id}` }, [vessel.name]),
          ),
          el('span', {
            class: 'muted',
            text: ` keeps UTC ${vessel.current_offset_minutes >= 0 ? '+' : '-'}${Math.floor(
              Math.abs(vessel.current_offset_minutes) / 60,
            )}h${String(Math.abs(vessel.current_offset_minutes) % 60).padStart(2, '0')}`,
          }),
        ]),
      ),
    );
  };

  addVessel.addEventListener('click', () => {
    const name = textField('Vessel name');
    const kind = selectField('Vessel type', VESSEL_KINDS);
    const offset = textField('Starting offset in minutes', '0');
    openDialog({
      title: 'Add a vessel',
      content: [name.wrapper, kind.wrapper, offset.wrapper],
      submitLabel: 'Save vessel',
      onSubmit: async () => {
        setStatus(context.feedback, COPY.savingVessel);
        const result = await postJson<ApiErrorBody>('/api/vessels', {
          name: name.input.value,
          kind: kind.input.value,
          initial_offset_minutes: offset.input.value,
        });
        if (result.ok) {
          setStatus(context.feedback, COPY.vesselSaved);
          await load();
          return;
        }
        if (result.status === 409) {
          setStatus(context.feedback, COPY.vesselLimit);
          return;
        }
        if (result.status === 422) {
          setStatus(context.feedback, serverText(result.body));
          return;
        }
        setStatus(context.feedback, COPY.somethingWrong);
      },
    });
  });

  await load();

  const element = el('div', { class: 'page fleet' }, [
    el('h1', { text: 'Your vessels' }),
    el('div', { class: 'card' }, [list, el('div', { class: 'actions' }, [addVessel])]),
  ]);
  return { element };
}
