import { HK_ZONE, REGION_LABELS, SECTOR_LABELS, type Region, type Sector } from '../../shared/domain.js';
import { formatInstant } from '../../shared/format.js';
import { setPageTitle } from '../lib/router.jsx';
import { useResource } from '../lib/workspace.jsx';
import { TableRegion } from '../components/Panel.jsx';

interface Enquiry {
  id: string;
  reference: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  sector: Sector;
  region: Region;
  sites: number;
  openingMonth: string;
  message: string;
  createdAt: string;
}

export function Enquiries(): JSX.Element {
  const { data } = useResource<{ enquiries: Enquiry[] }>('/api/enquiries');
  setPageTitle('Enquiries · Marrow Hall Interiors');
  const enquiries = data?.enquiries ?? [];

  return (
    <section className="panel">
      <h1>Enquiries</h1>
      <p className="meta">Newest first.</p>
      <TableRegion label="Enquiries table">
        <table>
          <caption>Enquiries</caption>
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Received</th>
              <th scope="col">Name</th>
              <th scope="col">Company</th>
              <th scope="col">Email</th>
              <th scope="col">Phone</th>
              <th scope="col">Sector</th>
              <th scope="col">Region</th>
              <th scope="col" className="numeric">
                Sites
              </th>
              <th scope="col">Opening</th>
              <th scope="col">Message</th>
            </tr>
          </thead>
          <tbody>
            {enquiries.map((enquiry) => (
              <tr key={enquiry.id}>
                <th scope="row">{enquiry.reference}</th>
                <td>{formatInstant(new Date(enquiry.createdAt), HK_ZONE)}</td>
                <td>{enquiry.name}</td>
                <td>{enquiry.company}</td>
                <td>{enquiry.email}</td>
                <td>{enquiry.phone === '' ? '—' : enquiry.phone}</td>
                <td>{SECTOR_LABELS[enquiry.sector]}</td>
                <td>{REGION_LABELS[enquiry.region]}</td>
                <td className="numeric">{enquiry.sites}</td>
                <td>{enquiry.openingMonth}</td>
                <td>{enquiry.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>
    </section>
  );
}
