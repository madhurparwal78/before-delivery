import { useState, type FormEvent } from "react";
import { announce } from "../announce";
import { get, post } from "../api";
import { ActionButton, Band, SelectField, TextField } from "../components/ui";
import { useAction, useLoad } from "../hooks";
import { Loading, Screen } from "../shell/Page";
import { COMPANY_SIZES, CITIES, ROLES, nameOf, ROLE_FAMILIES } from "../../shared/reference";
import type { CompanyHit, CompanySearch, FounderHealth, MemberRow, ThresholdRow } from "../../shared/api";
import type { FieldErrors } from "../../shared/rules";

const ROLE_LABELS: Record<(typeof ROLES)[number], string> = {
  member: "Member",
  moderator: "Moderator",
  employer_admin: "Employer admin",
  recruiter: "Recruiter",
  founder: "Founder",
};

async function everyCompany(): Promise<CompanyHit[]> {
  const first = await get<CompanySearch>("/api/companies/search");
  if (!first.ok) return [];
  if (first.data.fallback) return first.data.cities.flatMap((entry) => entry.companies);
  const pages = Math.ceil(first.data.total / first.data.page_size);
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, index) => get<CompanySearch>(`/api/companies/search?page=${index + 2}`)));
  return [first.data, ...rest.flatMap((answer) => (answer.ok && !answer.data.fallback ? [answer.data] : []))].flatMap((answer) => (answer.fallback ? [] : answer.hits));
}

function AddCompany({ onAdded }: { onAdded: () => void }) {
  const [values, setValues] = useState({ name: "", slug: "", city: "", size: "", email_domain: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const { busy, run } = useAction();
  const set = (name: keyof typeof values, value: string) => setValues({ ...values, [name]: value });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await run(() => post("/api/founder/companies", values));
    if (result.ok) {
      announce(`${values.name} is added.`);
      setValues({ name: "", slug: "", city: "", size: "", email_domain: "" });
      setErrors({});
      onAdded();
    } else {
      setErrors(result.fields ?? { name: result.message });
    }
  }

  return (
    <form aria-label="Add company" onSubmit={(event) => void submit(event)} noValidate className="form-narrow">
      <h3>Add company</h3>
      <TextField label="Company name" value={values.name} onChange={(event) => set("name", event.target.value)} error={errors["name"]} />
      <TextField label="Slug" value={values.slug} onChange={(event) => set("slug", event.target.value)} error={errors["slug"]} />
      <SelectField label="City" placeholder="Choose a city" options={CITIES} value={values.city} onChange={(event) => set("city", event.target.value)} error={errors["city"]} />
      <SelectField label="Size" placeholder="Choose a size" options={COMPANY_SIZES.map((size) => ({ id: size, name: size }))} value={values.size} onChange={(event) => set("size", event.target.value)} error={errors["size"]} />
      <TextField label="Email domain" value={values.email_domain} onChange={(event) => set("email_domain", event.target.value)} error={errors["email_domain"]} />
      <ActionButton type="submit" busy={busy}>Add company</ActionButton>
    </form>
  );
}

function AddEmployerUser({ companies, onAdded }: { companies: CompanyHit[]; onAdded: () => void }) {
  const [values, setValues] = useState({ company_slug: "", display_name: "", email: "", role: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const { busy, run } = useAction();
  const set = (name: keyof typeof values, value: string) => setValues({ ...values, [name]: value });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await run(() => post("/api/founder/employer-users", values));
    if (result.ok) {
      announce(`${values.display_name} is added.`);
      setValues({ company_slug: "", display_name: "", email: "", role: "" });
      setErrors({});
      onAdded();
    } else {
      setErrors(result.fields ?? { company_slug: result.message });
    }
  }

  return (
    <form aria-label="Add employer user" onSubmit={(event) => void submit(event)} noValidate className="form-narrow">
      <h3>Add employer user</h3>
      <SelectField label="Company" placeholder="Choose a company" options={companies.map((company) => ({ id: company.slug, name: company.name }))} value={values.company_slug} onChange={(event) => set("company_slug", event.target.value)} error={errors["company_slug"]} />
      <TextField label="Display name" value={values.display_name} onChange={(event) => set("display_name", event.target.value)} error={errors["display_name"]} />
      <TextField label="Work email" type="email" value={values.email} onChange={(event) => set("email", event.target.value)} error={errors["email"]} />
      <SelectField label="Team role" placeholder="Choose a role" options={[{ id: "employer_admin", name: "Employer admin" }, { id: "recruiter", name: "Recruiter" }]} value={values.role} onChange={(event) => set("role", event.target.value)} error={errors["role"]} />
      <ActionButton type="submit" busy={busy}>Add user</ActionButton>
    </form>
  );
}

export function Founder() {
  const health = useLoad(() => get<FounderHealth>("/api/founder/health"), []);
  const members = useLoad(() => get<{ members: MemberRow[] }>("/api/founder/members"), []);
  const thresholds = useLoad(() => get<{ rows: ThresholdRow[] }>("/api/founder/thresholds"), []);
  const companies = useLoad(async () => ({ ok: true as const, status: 200, data: await everyCompany() }), []);
  const [failure, setFailure] = useState("");
  const action = useAction();

  async function appoint(member: MemberRow) {
    setFailure("");
    const result = await action.run(() => post<MemberRow>("/api/founder/moderators", { user_id: member.id }));
    if (result.ok) {
      announce(`${member.display_name} is now a moderator.`);
      members.reload();
    } else {
      setFailure(result.message);
    }
  }

  async function revoke(company: CompanyHit) {
    setFailure("");
    const result = await action.run(() => post<CompanyHit>(`/api/founder/companies/${company.slug}/revoke-verification`));
    if (result.ok) {
      announce(`Verification revoked for ${company.name}.`);
      companies.reload();
    } else {
      setFailure(result.message);
    }
  }

  const sorted = [...(companies.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const states = health.data;
  // Draw the console once every table has its rows, so no table pushes the next one down.
  if (health.loading || members.loading || thresholds.loading || companies.loading) return <Loading />;
  return (
    <Screen title="Founder console" band={failure ? <Band>{failure}</Band> : null}>
      <h1 className="page-title">Founder console</h1>
      <h2 className="section-title">Service health</h2>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Service health table"><table className="table" aria-label="Service health">
        <thead><tr><th scope="col">Service</th><th scope="col">State</th></tr></thead>
        <tbody>
          {states
            ? (["database", "search", "storage", "mail"] as const).map((name) => (
                <tr key={name}><td>{name}</td><td>{states[name] === "ok" ? "OK" : "Unavailable"}</td></tr>
              ))
            : null}
          {states ? <tr><td>Outbox backlog</td><td className="figure">{states.outbox_pending}</td></tr> : null}
          {states ? <tr><td>Search sync backlog</td><td className="figure">{states.search_sync_pending}</td></tr> : null}
        </tbody>
      </table></div>
      <h2 className="section-title">Members</h2>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Members table"><table className="table" aria-label="Members">
        <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Company</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
        <tbody>
          {(members.data?.members ?? []).map((member) => (
            <tr key={member.id}>
              <td>{member.display_name}</td>
              <td>{member.email}</td>
              <td>{ROLE_LABELS[member.role]}</td>
              <td>{member.company_slug ?? ""}</td>
              <td>
                {member.role === "member" ? (
                  <button type="button" className="btn-quiet" aria-label={`Make ${member.display_name} a moderator`} onClick={() => void appoint(member)}><span className="painted" data-text="Make moderator" /></button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <h2 className="section-title">Companies</h2>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Companies table"><table className="table" aria-label="Companies">
        <thead><tr><th scope="col">Name</th><th scope="col">City</th><th scope="col">Size</th><th scope="col">Verification</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
        <tbody>
          {sorted.map((company) => (
            <tr key={company.slug}>
              <td>{company.name}</td>
              <td>{company.city_name}</td>
              <td>{company.size}</td>
              <td>{company.verified ? "Verified" : "Not verified"}</td>
              <td>
                {company.verified ? (
                  <button type="button" className="btn-quiet" aria-label={`Revoke verification for ${company.name}`} onClick={() => void revoke(company)}>Revoke</button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <h2 className="section-title">Pay thresholds</h2>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Pay thresholds table"><table className="table" aria-label="Pay thresholds">
        <thead><tr><th scope="col">Company</th><th scope="col">Role</th><th scope="col">City</th><th scope="col">Reports</th><th scope="col">Range</th></tr></thead>
        <tbody>
          {(thresholds.data?.rows ?? []).map((row) => (
            <tr key={`${row.company_slug}:${row.role_family}:${row.city}`}>
              <td>{row.company_slug}</td>
              <td>{nameOf(ROLE_FAMILIES, row.role_family)}</td>
              <td>{nameOf(CITIES, row.city)}</td>
              <td className="figure">{`${row.report_count} of ${row.threshold}`}</td>
              <td>{row.shown ? "Shown to unlocked members" : "Hidden below the threshold"}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="founder-forms">
        <AddCompany onAdded={companies.reload} />
        <AddEmployerUser companies={sorted} onAdded={members.reload} />
      </div>
    </Screen>
  );
}
