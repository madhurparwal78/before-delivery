import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend } from '../api';
import { useFeedback } from '../feedback';
import { Dialog } from '../components/Dialog';
import { formatAmount } from '../kitchenTime';
import type { InspectionLink, Shelf, Tenant } from '../types';

const STATUS_WORDS: Record<Tenant['status'], string> = {
  applied: 'Applied',
  documents_review: 'Documents review',
  active: 'Active',
  suspended: 'Suspended',
  offboarded: 'Offboarded',
};

const KIND_LABELS: Record<string, string> = {
  certificate_of_insurance: 'certificate of insurance',
  food_handler_card: 'food handler card',
  health_permit: 'health permit',
};

const LINK_DURATIONS = [
  { label: '1 hour', seconds: 3600 },
  { label: '24 hours', seconds: 86_400 },
  { label: '7 days', seconds: 604_800 },
];

export function TenantsScreen(): JSX.Element {
  const { perform, background } = useFeedback();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [offboardTarget, setOffboardTarget] = useState<Tenant | null>(null);
  const [linkTarget, setLinkTarget] = useState<Tenant | null>(null);

  const load = useCallback(
    async (announce: boolean): Promise<void> => {
      const run = async (): Promise<{ tenants: Tenant[]; shelves: Shelf[] }> => {
        const [tenantList, shelfList] = await Promise.all([
          apiGet<{ tenants: Tenant[] }>('/api/tenants'),
          apiGet<{ shelves: Shelf[] }>('/api/shelves'),
        ]);
        return { tenants: tenantList.tenants, shelves: shelfList.shelves };
      };
      const result = announce
        ? await perform({ pending: 'Loading…', success: () => '', run })
        : await background({ run });
      if (result) {
        setTenants(result.tenants);
        setShelves(result.shelves);
      }
    },
    [perform, background],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const activate = async (tenant: Tenant): Promise<void> => {
    await perform({
      pending: 'Activating…',
      success: () => `${tenant.business_name} is active.`,
      errors: (failure) => {
        if (failure.code !== 'documents_incomplete') return null;
        const missing = (failure.details['missing'] as string[] | undefined) ?? [];
        const names = missing.map((kind) => KIND_LABELS[kind] ?? kind).join(' and ');
        return `${tenant.business_name} is missing an approved, valid ${names}.`;
      },
      run: () => apiSend<Tenant>('POST', `/api/tenants/${tenant.id}/activate`, {}),
    });
    void load(false);
  };

  const offboard = async (tenant: Tenant): Promise<void> => {
    const result = await perform({
      pending: 'Offboarding…',
      success: () => `${tenant.business_name} is offboarded.`,
      errors: (failure) =>
        failure.code === 'open_bookings'
          ? `${tenant.business_name} still has open bookings. Cancel or complete them first.`
          : null,
      run: () => apiSend<Tenant>('POST', `/api/tenants/${tenant.id}/offboard`, {}),
    });
    if (result) setOffboardTarget(null);
    void load(false);
  };

  const assignShelf = async (shelf: Shelf, tenantId: string): Promise<void> => {
    const business = tenants.find((tenant) => tenant.id === tenantId)?.business_name ?? '';
    await perform({
      pending: 'Saving shelf…',
      success: () =>
        tenantId === ''
          ? `${shelf.name} is unassigned.`
          : `${shelf.name} assigned to ${business}.`,
      errors: (failure) =>
        failure.code === 'tenant_not_active' ? 'Only active tenants can rent a shelf.' : null,
      run: () =>
        apiSend<Shelf>('PUT', `/api/shelves/${shelf.id}`, {
          tenant_id: tenantId === '' ? null : tenantId,
        }),
    });
    void load(false);
  };

  return (
    <div>
      <h1>Tenants</h1>
      <div className="table-wrap">
        <table role="table" aria-label="Tenants">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader">Business</th>
              <th role="columnheader">Status</th>
              <th role="columnheader">Insurance</th>
              <th role="columnheader">Health permit</th>
              <th role="columnheader">Food handler card</th>
              <th role="columnheader">Actions</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {tenants.map((tenant) => (
              <tr role="row" key={tenant.id}>
                <td role="cell" data-label="Business">
                  {tenant.business_name}
                </td>
                <td role="cell" data-label="Status">
                  <span className="badge">{STATUS_WORDS[tenant.status]}</span>
                </td>
                {(
                  ['certificate_of_insurance', 'health_permit', 'food_handler_card'] as const
                ).map((kind) => (
                  <td role="cell" data-label={KIND_LABELS[kind]} className="num" key={kind}>
                    {tenant.required_documents[kind]?.valid
                      ? `valid to ${tenant.required_documents[kind]?.expires_on}`
                      : 'not valid'}
                  </td>
                ))}
                <td role="cell" data-label="Actions">
                  <div className="row-actions">
                    {tenant.status === 'documents_review' ? (
                      <button type="button" onClick={() => void activate(tenant)}>
                        Activate {tenant.business_name}
                      </button>
                    ) : null}
                    {tenant.status === 'active' || tenant.status === 'suspended' ? (
                      <button type="button" onClick={() => setOffboardTarget(tenant)}>
                        Offboard {tenant.business_name}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => setLinkTarget(tenant)}>
                      Inspection link for {tenant.business_name}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Storage shelves</h2>
      <div className="table-wrap">
        <table role="table" aria-label="Storage shelves">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader">Shelf</th>
              <th role="columnheader">Monthly rate</th>
              <th role="columnheader">Tenant</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {shelves.map((shelf) => (
              <tr role="row" key={shelf.id}>
                <td role="cell" data-label="Shelf">
                  {shelf.name}
                </td>
                <td role="cell" data-label="Monthly rate" className="num">
                  {formatAmount(shelf.monthly_rate_cents)}
                </td>
                <td role="cell" data-label="Tenant">
                  <label htmlFor={`shelf-${shelf.id}`}>Tenant for {shelf.name}</label>
                  <select
                    id={`shelf-${shelf.id}`}
                    value={shelf.tenant_id ?? ''}
                    onChange={(event) => void assignShelf(shelf, event.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {tenants
                      .filter((tenant) => tenant.status === 'active')
                      .map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>
                          {tenant.business_name}
                        </option>
                      ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {offboardTarget ? (
        <Dialog
          title={`Offboard ${offboardTarget.business_name}`}
          onClose={() => setOffboardTarget(null)}
        >
          <p>This ends the tenancy. Open bookings must be cancelled or completed first.</p>
          <div className="dialog-actions">
            <button type="button" onClick={() => setOffboardTarget(null)}>
              Keep tenant
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void offboard(offboardTarget)}
            >
              Offboard
            </button>
          </div>
        </Dialog>
      ) : null}

      {linkTarget ? (
        <InspectionLinkDialog tenant={linkTarget} onClose={() => setLinkTarget(null)} />
      ) : null}
    </div>
  );
}

function InspectionLinkDialog({
  tenant,
  onClose,
}: {
  tenant: Tenant;
  onClose: () => void;
}): JSX.Element {
  const { perform, background } = useFeedback();
  const [seconds, setSeconds] = useState(86_400);
  const [link, setLink] = useState<InspectionLink | null>(null);

  useEffect(() => {
    void background({
      errors: (failure) => (failure.status === 404 ? '' : null),
      run: () => apiGet<InspectionLink>(`/api/tenants/${tenant.id}/inspection-link`),
    }).then((result) => setLink(result));
  }, [tenant.id, background]);

  const issue = async (): Promise<void> => {
    const result = await perform({
      pending: 'Issuing link…',
      success: (issued: InspectionLink) =>
        `Link issued. It expires ${issued.expires_at.slice(0, 10)} ${issued.expires_at.slice(11, 16)} kitchen time. Any earlier link for this tenant no longer works.`,
      run: () =>
        apiSend<InspectionLink>('POST', `/api/tenants/${tenant.id}/inspection-link`, {
          expires_in_seconds: seconds,
        }),
    });
    if (result) setLink(result);
  };

  const revoke = async (): Promise<void> => {
    const result = await perform({
      pending: 'Revoking…',
      success: () => 'Link revoked.',
      errors: (failure) => (failure.status === 404 ? 'There is no live link to revoke.' : null),
      run: () => apiSend<void>('DELETE', `/api/tenants/${tenant.id}/inspection-link`, null),
    });
    if (result !== null) setLink(null);
  };

  const fullUrl = link ? `${window.location.origin}${link.url}` : '';

  return (
    <Dialog title={`Inspection link for ${tenant.business_name}`} onClose={onClose}>
      <div className="field">
        <label htmlFor="link-duration">Link lasts</label>
        <select
          id="link-duration"
          value={seconds}
          onChange={(event) => setSeconds(Number.parseInt(event.target.value, 10))}
        >
          {LINK_DURATIONS.map((option) => (
            <option key={option.seconds} value={option.seconds}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="link-url">Link</label>
        <input id="link-url" type="text" readOnly value={fullUrl} style={{ width: '100%' }} />
      </div>
      <div className="row-actions">
        <button type="button" className="primary" onClick={() => void issue()}>
          Issue link
        </button>
        <button
          type="button"
          onClick={() => {
            if (fullUrl) void navigator.clipboard?.writeText(fullUrl);
          }}
        >
          Copy link
        </button>
        <button type="button" onClick={() => void revoke()}>
          Revoke link
        </button>
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
