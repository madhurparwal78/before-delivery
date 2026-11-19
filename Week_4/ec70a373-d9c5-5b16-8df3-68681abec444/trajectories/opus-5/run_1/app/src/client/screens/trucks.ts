import { request, serverNow } from '../api';
import { COPY, SERVICE_LABELS } from '../copy';
import { Dialog } from '../dialog';
import { button, clear, el, labelled } from '../dom';
import { StatusRegion, showFieldError } from '../status';
import { every } from '../timers';
import { overdueNotice, visitTable, type VisitLike } from '../visitlog';
import { localDateOf, localTimeOf } from '../../shared/tz';
import type { AppContext } from '../main';
import type { InspectorLinkJson, MemberSearchJson, SiteJson } from '../../shared/types';

type ManagerVisit = VisitLike & { id: string };

interface VisitsResponse {
  truck: { id: string; name: string; permit_number: string; business_name: string };
  visits: ManagerVisit[];
  last_departed_at: string | null;
  overdue: boolean;
}

export function renderTrucks(container: HTMLElement, ctx: AppContext): void {
  const first = ctx.sites[0] as SiteJson | undefined;
  if (first === undefined) return;
  const site = first;
  const zone = site.time_zone;
  const status = new StatusRegion('Visit log status');
  const search = el('input', {
    type: 'text',
    role: 'combobox',
    'aria-label': 'Find a member',
    'aria-expanded': 'false',
    'aria-autocomplete': 'list',
    autocomplete: 'off',
    id: 'truck-search',
  });
  const results = el('ul', { role: 'listbox', 'aria-label': 'Members', class: 'listbox' });
  results.hidden = true;
  const truckHeading = el('h2', { class: 'truck-heading' });
  const arrived = button('Truck arrived', { class: 'primary' });
  const departed = button('Truck departed');
  const notice = overdueNotice();
  const log = visitTable('Visit log');
  const inspectorEmail = el('input', { type: 'email', id: 'inspector-email' });
  const issue = button('Issue inspector link', { class: 'primary' });
  const links = el('ul', { role: 'list', 'aria-label': 'Inspector links', class: 'link-list' });

  container.append(
    el('div', { class: 'truck-search' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'truck-search', text: 'Find a member' }),
        search,
      ]),
      results,
    ]),
    truckHeading,
    el('div', { class: 'row-actions' }, [arrived, departed]),
    notice.element,
    log.root,
    el('section', { class: 'inspector-panel' }, [
      el('h2', { text: 'Inspector access' }),
      labelled('Inspector email', inspectorEmail, 'inspector-email'),
      issue,
      links,
    ]),
    status.element,
  );

  let truckId: string | null = null;
  let searchGeneration = 0;
  let openVisitId: string | null = null;

  function loadVisits(): void {
    if (truckId === null) return;
    void request<VisitsResponse>(`/api/trucks/${truckId}/visits`).then((result) => {
      if (!result.ok) return;
      log.draw(result.data.visits, zone);
      notice.update(result.data.overdue, result.data.last_departed_at, zone);
      truckHeading.textContent = `${result.data.truck.name} · ${result.data.truck.business_name}`;
      const open = result.data.visits.find((visit) => visit.departed_at === null);
      openVisitId = open === undefined ? null : open.id;
      arrived.setAttribute('aria-disabled', openVisitId === null ? 'false' : 'true');
      departed.setAttribute('aria-disabled', openVisitId === null ? 'true' : 'false');
    });
  }

  function loadLinks(): void {
    if (truckId === null) return;
    void request<{ links: InspectorLinkJson[] }>(
      `/api/trucks/${truckId}/inspector-links`,
    ).then((result) => {
      if (!result.ok) return;
      clear(links);
      for (const link of result.data.links) {
        const item = el('li', { role: 'listitem', class: 'link-item' });
        const expires = Date.parse(link.expires_at);
        item.append(
          el('span', { text: link.inspector_email }),
          el('span', {
            class: 'mono',
            text: `${localDateOf(zone, expires)} ${localTimeOf(zone, expires)}`,
          }),
          el('span', {
            text: link.state === 'live' ? 'Live' : link.state === 'expired' ? 'Expired' : 'Revoked',
          }),
        );
        if (link.state === 'live') {
          const revoke = button('Revoke');
          const reissue = button('Reissue');
          revoke.addEventListener('click', () => void act(`/api/inspector-links/${link.id}/revoke`, 'revoke', link));
          reissue.addEventListener('click', () => void act(`/api/inspector-links/${link.id}/reissue`, 'reissue', link));
          item.append(revoke, reissue);
        }
        links.append(item);
      }
    });
  }

  async function act(path: string, kind: 'revoke' | 'reissue', link: InspectorLinkJson): Promise<void> {
    status.write(kind === 'revoke' ? COPY.revoking : COPY.reissuing);
    const result = await request(path, { method: 'POST', body: {} });
    if (result.ok) {
      status.write(kind === 'revoke' ? COPY.linkRevoked : COPY.linkReissued(link.inspector_email));
      loadLinks();
      return;
    }
    if (result.error.code === 'invalid_transition') status.write(COPY.linkNotLive);
    else if (result.error.code === 'storage_unavailable') status.write(COPY.storageUnavailableLink);
    else if (result.status === 401) return;
    else status.write(result.status === 0 ? COPY.offline : COPY.internal);
    loadLinks();
  }

  search.addEventListener('input', () => {
    const term = search.value;
    searchGeneration += 1;
    const generation = searchGeneration;
    if (term.length < 2) {
      results.hidden = true;
      search.setAttribute('aria-expanded', 'false');
      clear(results);
      return;
    }
    void request<{ members: MemberSearchJson[] }>(
      `/api/members?q=${encodeURIComponent(term)}`,
    ).then((result) => {
      if (generation !== searchGeneration || !result.ok) return;
      clear(results);
      for (const member of result.data.members) {
        const option = el('li', {
          role: 'option',
          tabindex: '-1',
          'aria-selected': 'false',
          class: 'listbox-option',
          text: member.business_name,
        });
        option.addEventListener('click', () => choose(member));
        results.append(option);
      }
      results.hidden = result.data.members.length === 0;
      search.setAttribute('aria-expanded', results.hidden ? 'false' : 'true');
    });
  });

  search.addEventListener('keydown', (event) => {
    const options = Array.from(results.querySelectorAll('[role="option"]')) as HTMLElement[];
    if (event.key === 'Escape') {
      results.hidden = true;
      search.setAttribute('aria-expanded', 'false');
      return;
    }
    if (options.length === 0) return;
    const index = options.findIndex((option) => option.getAttribute('aria-selected') === 'true');
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next =
        event.key === 'ArrowDown'
          ? Math.min(options.length - 1, index + 1)
          : Math.max(0, index - 1);
      options.forEach((option, position) =>
        option.setAttribute('aria-selected', position === next ? 'true' : 'false'),
      );
      return;
    }
    if (event.key === 'Enter' && index >= 0) {
      event.preventDefault();
      (options[index] as HTMLElement).click();
    }
  });

  function choose(member: MemberSearchJson): void {
    results.hidden = true;
    search.setAttribute('aria-expanded', 'false');
    search.value = member.business_name;
    if (member.truck === null) {
      truckId = null;
      truckHeading.textContent = `${member.business_name} has no truck`;
      return;
    }
    truckId = member.truck.id;
    loadVisits();
    loadLinks();
  }

  arrived.addEventListener('click', () => {
    if (truckId === null || arrived.getAttribute('aria-disabled') === 'true') return;
    arrived.setAttribute('aria-disabled', 'true');
    status.write(COPY.saving);
    void request(`/api/trucks/${truckId}/visits`, { method: 'POST', body: {} }).then((result) => {
      arrived.setAttribute('aria-disabled', 'false');
      if (result.ok) {
        status.write(COPY.truckArrived(localTimeOf(zone, serverNow())));
        loadVisits();
        return;
      }
      if (result.error.code === 'visit_open') status.write(COPY.visitOpen);
      else if (result.status === 401) return;
      else status.write(result.status === 0 ? COPY.offline : COPY.internal);
      loadVisits();
    });
  });

  departed.addEventListener('click', () => {
    if (openVisitId === null || departed.getAttribute('aria-disabled') === 'true') return;
    openDepartureDialog(openVisitId);
  });

  function openDepartureDialog(visitId: string): void {
    const group = el('div', { role: 'group', 'aria-label': 'Services', class: 'services-group' });
    const boxes: HTMLInputElement[] = [];
    for (const [value, label] of Object.entries(SERVICE_LABELS)) {
      const box = el('input', { type: 'checkbox', value, id: `service-${value}` });
      boxes.push(box);
      group.append(
        el('div', { class: 'field field-check' }, [
          box,
          el('label', { for: `service-${value}`, text: label }),
        ]),
      );
    }
    const signature = el('input', { type: 'text', id: 'operator-signature' });
    const save = button('Save departure', { class: 'primary' });
    const close = button('Close');
    const dialog = new Dialog({ title: 'Record departure', opener: departed });
    dialog.body.append(
      group,
      labelled('Operator signature', signature, 'operator-signature'),
      save,
      close,
    );
    close.addEventListener('click', () => dialog.close());
    save.addEventListener('click', () => {
      if (save.getAttribute('aria-disabled') === 'true') return;
      const services = boxes.filter((box) => box.checked).map((box) => box.value);
      save.setAttribute('aria-disabled', 'true');
      status.write(COPY.saving);
      void request(`/api/visits/${visitId}/depart`, {
        method: 'POST',
        body: { services, operator_signature: signature.value },
      }).then((result) => {
        save.setAttribute('aria-disabled', 'false');
        if (result.ok) {
          dialog.close();
          status.write(COPY.departureRecorded(localTimeOf(zone, serverNow())));
          loadVisits();
          return;
        }
        const fields = result.error.fields ?? {};
        if (fields.services !== undefined) {
          showFieldError(group, COPY.servicesRequired);
          status.write(COPY.servicesRequired);
        } else if (fields.operator_signature !== undefined) {
          showFieldError(signature, COPY.signatureRequired);
          status.write(COPY.signatureRequired);
        } else if (result.error.code === 'invalid_transition') {
          status.write(COPY.departureAlready);
        } else if (result.status === 401) return;
        else status.write(result.status === 0 ? COPY.offline : COPY.internal);
      });
    });
    dialog.open(boxes[0]);
  }

  issue.addEventListener('click', () => {
    if (truckId === null || issue.getAttribute('aria-disabled') === 'true') return;
    issue.setAttribute('aria-disabled', 'true');
    status.write(COPY.issuingLink);
    void request<{ link: InspectorLinkJson }>(`/api/trucks/${truckId}/inspector-links`, {
      method: 'POST',
      body: { inspector_email: inspectorEmail.value },
    }).then((result) => {
      issue.setAttribute('aria-disabled', 'false');
      if (result.ok) {
        const expires = Date.parse(result.data.link.expires_at);
        status.write(
          COPY.linkSent(
            result.data.link.inspector_email,
            localDateOf(zone, expires),
            localTimeOf(zone, expires),
          ),
        );
        loadLinks();
        return;
      }
      if (result.error.code === 'validation') {
        showFieldError(inspectorEmail, COPY.inspectorEmailInvalid);
        status.write(COPY.inspectorEmailInvalid);
      } else if (result.error.code === 'storage_unavailable') {
        status.write(COPY.storageUnavailableLink);
      } else if (result.status === 401) return;
      else status.write(result.status === 0 ? COPY.offline : COPY.internal);
    });
  });

  arrived.setAttribute('aria-disabled', 'true');
  departed.setAttribute('aria-disabled', 'true');
  every(60000, loadVisits);
}
