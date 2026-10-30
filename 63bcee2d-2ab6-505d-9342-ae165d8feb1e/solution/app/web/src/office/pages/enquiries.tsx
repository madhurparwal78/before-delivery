import { formatTime } from "../../../../shared/format";
import { useOffice } from "../context";
import { TableRegion } from "../layout";
import { useResource } from "../resource";
import { OfficeShell } from "../shell";
import "./casestudies.css";

// The director's enquiries, newest first.

interface Enquiry {
  reference: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  sector: string;
  region: string;
  sites: number;
  openingMonth: string;
  message: string;
  receivedAt: string;
}

const SECTOR: Record<string, string> = { retail: "Retail", workplace: "Workplace", food_beverage: "Food & beverage" };
const REGION: Record<string, string> = { HK: "Hong Kong", SG: "Singapore", MO: "Macao" };

export function EnquiriesPage() {
  const office = useOffice();
  const enquiries = useResource<{ enquiries: Enquiry[] }>(office.member ? "/api/enquiries" : null);
  const list = enquiries.data?.enquiries ?? [];
  return (
    <OfficeShell title="Enquiries">
      <div className="page-head">
        <div>
          <p className="eyebrow">Public site · Director</p>
          <h1>Enquiries</h1>
        </div>
        <p>{enquiries.data ? `${list.length} ${list.length === 1 ? "enquiry" : "enquiries"}` : "Loading…"}</p>
      </div>
      {enquiries.data && !list.length ? (
        <p className="empty-state">No enquiries yet. New ones from the public site appear here, newest first, and each is emailed to every director.</p>
      ) : (
        <TableRegion label="Enquiries, scrolls sideways">
          <table className="enquiries-table">
            <caption>Enquiries, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Reference</th><th scope="col">Received</th><th scope="col">From</th><th scope="col">Sector</th>
                <th scope="col">Region</th><th scope="col" className="num">Sites</th><th scope="col">Opening</th><th scope="col">Message</th>
              </tr>
            </thead>
            <tbody>
              {list.map((enquiry) => (
                <tr key={enquiry.reference}>
                  <td>{enquiry.reference}</td>
                  <td>{formatTime(enquiry.receivedAt)}</td>
                  <td>
                    <strong>{enquiry.name}</strong>, {enquiry.company}<br />
                    <a href={`mailto:${enquiry.email}`}>{enquiry.email}</a>{enquiry.phone ? ` · ${enquiry.phone}` : ""}
                  </td>
                  <td>{SECTOR[enquiry.sector]}</td>
                  <td>{REGION[enquiry.region]}</td>
                  <td className="num">{enquiry.sites}</td>
                  <td>{enquiry.openingMonth}</td>
                  <td className="message">{enquiry.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      )}
    </OfficeShell>
  );
}
