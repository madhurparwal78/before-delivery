import { instantDateText, instantTimeText } from "../shared/format";
import { stateName } from "../shared/copy";
import type { CatalogueModel, OpsClaimRow } from "../shared/types";
import { onLinkClick } from "./router";

interface ClaimsTableProps {
  /** Null while the queue is still loading: the table is there, the empty-queue note is not. */
  claims: OpsClaimRow[] | null;
  models: CatalogueModel[];
  limit?: number;
}

/** The claim queue: newest confirmation first, a link on each reference. */
export function ClaimsTable({ claims, models, limit }: ClaimsTableProps) {
  const shown = (limit ? claims?.slice(0, limit) : claims) ?? [];
  const names = new Map(models.map((model) => [model.slug, model.name]));
  return (
    <>
      <div class="table-region" role="region" aria-label="Claims" tabIndex={0}>
        <table aria-label="Claims">
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">State</th>
              <th scope="col">Model</th>
              <th scope="col">Confirmed</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((claim) => (
              <tr key={claim.reference}>
                <td>
                  <a href={`/ops/claims/${claim.reference}`} onClick={(event) => onLinkClick(event, `/ops/claims/${claim.reference}`)}>
                    {claim.reference}
                  </a>
                </td>
                <td>{stateName(claim.state, "en-GB")}</td>
                <td>{claim.model ? (names.get(claim.model) ?? claim.model) : ""}</td>
                <td>{claim.confirmed_at ? `${instantTimeText(claim.confirmed_at)} on ${instantDateText(claim.confirmed_at, "en-GB")}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {claims && shown.length === 0 ? <p class="table-note">No claims yet.</p> : null}
    </>
  );
}
