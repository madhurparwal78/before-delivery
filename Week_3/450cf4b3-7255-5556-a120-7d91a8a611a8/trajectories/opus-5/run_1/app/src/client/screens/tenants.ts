import { request } from '../api';
import { el, focusElement } from '../dom';
import { heading, internalLink, type Screen, type ScreenContext } from '../shell';
import * as copy from '../copy';
import { formatDateLabel } from '../../shared/format';
import type { TenantRecord } from '../../shared/types';

export async function mountTenants(ctx: ScreenContext): Promise<Screen> {
  const level1 = heading('Tenants');
  const table = el('table', { className: 'data-table', attrs: { 'aria-label': 'Tenants' } });
  const head = el('thead');
  const headRow = el('tr');
  for (const column of ['Business', 'Contact', 'Status', 'Insurance expires', 'Food-handler card expires']) {
    headRow.append(el('th', { text: column, attrs: { scope: 'col' } }));
  }
  head.append(headRow);
  const body = el('tbody');
  table.append(head, body);
  ctx.root.append(level1, table);
  focusElement(level1);

  const result = await request<{ tenants: TenantRecord[] }>('GET', '/api/tenants');
  if (result.kind === 'ok') {
    for (const tenant of result.body.tenants) {
      const row = el('tr');
      const nameCell = el('td');
      nameCell.append(internalLink(tenant.businessName, `/tenants/${tenant.id}`));
      row.append(nameCell);
      row.append(el('td', { text: tenant.contactName }));
      row.append(el('td', { text: copy.tenantStatusLabel(tenant.status, tenant.suspendedReason) }));
      row.append(
        el('td', {
          text: tenant.insuranceExpiresOn === null ? '\u2014' : formatDateLabel(tenant.insuranceExpiresOn),
        }),
      );
      row.append(
        el('td', {
          text:
            tenant.foodHandlerExpiresOn === null ? '\u2014' : formatDateLabel(tenant.foodHandlerExpiresOn),
        }),
      );
      body.append(row);
    }
  }

  return { unmount: () => undefined };
}
