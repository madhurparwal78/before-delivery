import { LINK_WORD, OFFER_WORD, PENDING, SUCCESS, linkReadyFor } from '../../shared/copy';
import { formatDateTime } from '../../shared/format';
import type { LinkDto } from '../../shared/types';
import { ApiRefusal, request } from '../shared/api';
import { el, focusTarget, onPress, setPending } from '../shared/dom';
import { announce } from '../shared/live';
import { bindTimeLeft } from '../shared/timeleft';
import { dataTable, sectionShell, showFieldError, type SectionContext, type SectionView } from './sectionKit';
import { ownerAction, sessionEnded } from './session';
import type { CarFileState } from './state';

interface LinkReply extends LinkDto {
  token?: string;
  path?: string;
}

/** People: the link form, the one-time address and the per-buyer progress table. */
export const peopleSection = (context: SectionContext): SectionView => {
  const { section, heading } = sectionShell('people', 'People');

  const name = el('input', { type: 'text', class: 'text-input', id: 'person-name' }) as HTMLInputElement;
  name.setAttribute('aria-label', "Person's name");
  const nameError = el('p', { class: 'field-error' });
  nameError.hidden = true;

  const buyer = el('input', { type: 'radio', name: 'link-type', value: 'buyer', id: 'link-buyer' }) as HTMLInputElement;
  buyer.setAttribute('aria-label', 'Buyer');
  buyer.checked = true;
  const inspector = el('input', {
    type: 'radio',
    name: 'link-type',
    value: 'inspector',
    id: 'link-inspector',
  }) as HTMLInputElement;
  inspector.setAttribute('aria-label', 'Inspector');

  const linkType = el('fieldset', { class: 'radio-group', role: 'radiogroup', 'aria-label': 'Link type' }, [
    el('label', { class: 'radio-label', for: 'link-buyer', text: 'Buyer' }, [buyer]),
    el('label', { class: 'radio-label', for: 'link-inspector', text: 'Inspector' }, [inspector]),
  ]);

  const create = el('button', { type: 'button', class: 'pill-solid', text: 'Create link' });

  const newLink = el('div', { class: 'new-link card', role: 'region', 'aria-label': 'New link' });
  newLink.hidden = true;

  const body = el('tbody', { role: 'rowgroup' });
  const table = dataTable(
    'People',
    ['Person', 'Role', 'Status', 'Seen', 'Last seen', 'Offer', 'Time left', 'Actions'],
    body,
  );

  /** The region stays through every poll until the next press of one of these controls. */
  const showNewLink = (reply: LinkReply): void => {
    if (reply.path === undefined) return;
    const address = `${window.location.origin}${reply.path}`;
    const link = el('a', { class: 'new-link-address', href: address, text: address });
    const copy = el('button', { type: 'button', class: 'pill-outline', text: 'Copy link' });
    onPress(copy, () => {
      void navigator.clipboard.writeText(address).then(
        () => announce(context.status, SUCCESS.copyLink),
        () => announce(context.status, SUCCESS.copyLink),
      );
    });
    newLink.hidden = false;
    newLink.replaceChildren(el('p', { class: 'new-link-label', text: `Link for ${reply.name}` }), link, copy);
    focusTarget(copy);
  };

  const hideNewLink = (): void => {
    newLink.hidden = true;
    newLink.replaceChildren();
  };

  onPress(create, () => {
    hideNewLink();
    void ownerAction(async () => {
      setPending(create, true);
      announce(context.status, PENDING.createLink);
      showFieldError(nameError, undefined);
      try {
        const reply = await request<LinkReply>(`/api/owner/cars/${context.carId}/links`, {
          method: 'POST',
          body: { role: buyer.checked ? 'buyer' : 'inspector', name: name.value },
        });
        await context.refresh(['people']);
        announce(context.status, linkReadyFor(reply.name));
        showNewLink(reply);
        name.value = '';
      } catch (error) {
        // An ended session is the sign-in dialog’s business, not this handler’s.
        if (sessionEnded(error)) throw error;
        if (error instanceof ApiRefusal) {
          const message = error.body.errors?.name ?? error.body.message;
          showFieldError(nameError, message);
          announce(context.status, message);
          return;
        }
        throw error;
      } finally {
        setPending(create, false);
      }
    }, create);
  });

  const linkAction = (
    link: LinkDto,
    action: 'revoke' | 'renew' | 'replace',
    control: HTMLElement,
  ): void => {
    hideNewLink();
    void ownerAction(async () => {
      setPending(control, true);
      announce(context.status, PENDING.updateLink);
      try {
        const reply = await request<LinkReply>(`/api/owner/links/${link.id}/${action}`, { method: 'POST' });
        await context.refresh(['people', 'viewings', 'offers']);
        announce(
          context.status,
          action === 'revoke' ? SUCCESS.revoke : action === 'renew' ? SUCCESS.renew : SUCCESS.replace,
        );
        if (action === 'replace') showNewLink(reply);
        else focusTarget(heading);
      } catch (error) {
        // An ended session is the sign-in dialog’s business, not this handler’s.
        if (sessionEnded(error)) throw error;
        if (error instanceof ApiRefusal) {
          announce(context.status, error.body.message);
          return;
        }
        throw error;
      } finally {
        if (control.isConnected) setPending(control, false);
      }
    }, control);
  };

  const paint = (state: CarFileState): void => {
    if (state.links.length === 0) {
      body.replaceChildren(el('tr', { role: 'row' }, [el('td', { role: 'cell', text: 'No links yet' })]));
      return;
    }
    body.replaceChildren(
      ...state.links.map((link) => {
        const actions = el('td', { class: 'actions-cell', role: 'cell' });
        if (link.status === 'active') {
          const revoke = el('button', { type: 'button', class: 'pill-outline', text: 'Revoke' });
          onPress(revoke, () => linkAction(link, 'revoke', revoke));
          actions.append(revoke);
        }
        if (link.status !== 'revoked') {
          const renew = el('button', { type: 'button', class: 'pill-outline', text: 'Renew' });
          const replace = el('button', { type: 'button', class: 'pill-outline', text: 'Replace' });
          onPress(renew, () => linkAction(link, 'renew', renew));
          onPress(replace, () => linkAction(link, 'replace', replace));
          actions.append(renew, replace);
        }

        const timeCell = el('td', { class: 'time-cell figures', role: 'cell' });
        if (link.status === 'active') {
          const time = el('span', { class: 'figures' });
          bindTimeLeft(time, link.secondsRemaining);
          timeCell.append(time);
        }

        return el('tr', { class: 'people-row', role: 'row', 'data-link-id': link.id }, [
          el('td', { role: 'cell', text: link.name }),
          el('td', { role: 'cell', text: link.role === 'buyer' ? 'Buyer' : 'Inspector' }),
          el('td', { role: 'cell', text: LINK_WORD[link.status] }),
          el('td', { class: 'figures', role: 'cell', text: `${link.seen} of ${link.total}` }),
          el('td', { role: 'cell', text: link.lastSeenAt === null ? '' : formatDateTime(link.lastSeenAt) }),
          el('td', { role: 'cell', text: link.offerStatus === null ? '' : OFFER_WORD[link.offerStatus] }),
          timeCell,
          actions,
        ]);
      }),
    );
  };

  section.append(
    el('div', { class: 'card' }, [
      el('label', { class: 'field-label', for: 'person-name', text: "Person's name" }),
      name,
      nameError,
      linkType,
      create,
    ]),
    newLink,
    table,
  );

  return { id: 'people', heading, node: section, paint };
};
