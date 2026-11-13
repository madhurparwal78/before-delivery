import { first, isUniqueViolation, pool, rows } from "../db/pool";
import { inUnit } from "../db/unit";
import { figuresFor } from "../domain/derived";
import { ApiError, invalidFields, refuse } from "../http/fail";
import { defineRoute, jsonField, requireJsonObject, type Handler } from "../http/route";
import { digest, hashPassword, newToken } from "../services/passwords";
import { companyDocuments } from "../services/searchDocs";
import { config } from "../config";
import { FIELD_COPY } from "../../shared/errors";
import { founderCompanyShape, founderEmployerShape, parseShape } from "../../shared/rules";
import type { MemberRow, ThresholdRow } from "../../shared/api";
import { toHit } from "./companies";
import { serviceStates } from "./health";

const FOUNDER = ["founder"] as const;
const MEMBER_SQL = `SELECT u.id, u.display_name, u.email, u.role, c.slug AS company_slug FROM users u LEFT JOIN companies c ON c.id = u.company_id`;

const health = defineRoute({
  method: "GET",
  path: "/api/founder/health",
  auth: "session",
  roles: FOUNDER,
  async run() {
    return { status: 200, body: await serviceStates() };
  },
});

const members = defineRoute({
  method: "GET",
  path: "/api/founder/members",
  auth: "session",
  roles: FOUNDER,
  async run() {
    const found = await rows<MemberRow>(`${MEMBER_SQL} ORDER BY u.created_at, u.id`);
    return { status: 200, body: { members: found } };
  },
});

const appoint = defineRoute({
  method: "POST",
  path: "/api/founder/moderators",
  auth: "session",
  roles: FOUNDER,
  body: "json",
  async load(ctx) {
    const id = jsonField(ctx, "user_id");
    if (typeof id !== "string" || id.trim() === "") return undefined;
    const user = await first<{ id: string; role: string }>("SELECT id, role FROM users WHERE id = $1", [id]);
    if (!user) throw refuse("not_found");
    return user;
  },
  async conflicts(_ctx, user) {
    if (user && user.role !== "member") throw refuse("invalid_transition");
  },
  input(_ctx, user) {
    if (!user) throw invalidFields({ user_id: FIELD_COPY.user });
    return user;
  },
  async run(ctx, _loaded, user) {
    const promoted = await inUnit(async (unit) => {
      const changed = await unit.first<{ id: string }>("UPDATE users SET role = 'moderator' WHERE id = $1 AND role = 'member' RETURNING id", [user.id]);
      if (!changed) throw refuse("invalid_transition");
      await unit.audit("moderator_appointed", user.id, ctx.viewer?.id ?? null, {});
      return unit.first<MemberRow>(`${MEMBER_SQL} WHERE u.id = $1`, [user.id]);
    });
    return { status: 200, body: promoted };
  },
});

const addCompany = defineRoute({
  method: "POST",
  path: "/api/founder/companies",
  auth: "session",
  roles: FOUNDER,
  body: "json",
  async input(ctx) {
    const parsed = parseShape(founderCompanyShape, requireJsonObject(ctx));
    if (!parsed.ok) throw invalidFields(parsed.fields);
    const taken = await rows<{ slug: string; name: string }>(
      "SELECT slug, name FROM companies WHERE slug = $1 OR lower(name) = lower($2)",
      [parsed.value.slug, parsed.value.name],
    );
    const fields = {
      ...(taken.some((row) => row.slug === parsed.value.slug) ? { slug: FIELD_COPY.slug_taken } : {}),
      ...(taken.some((row) => row.name.toLowerCase() === parsed.value.name.toLowerCase()) ? { name: FIELD_COPY.name_taken } : {}),
    };
    if (Object.keys(fields).length > 0) throw invalidFields(fields);
    return parsed.value;
  },
  async run(ctx, _loaded, input) {
    const id = await inUnit(async (unit) => {
      const created = await unit
        .first<{ id: string }>(
          `INSERT INTO companies (slug, name, city, size, email_domain, verified) VALUES ($1, $2, $3, $4, $5, false) RETURNING id`,
          [input.slug, input.name, input.city, input.size, input.email_domain],
        )
        .catch((error: unknown) => {
          throw isUniqueViolation(error) ? invalidFields({ slug: FIELD_COPY.slug_taken }) : error;
        });
      if (!created) throw refuse("not_found");
      await unit.syncSearch("companies", created.id);
      await unit.audit("company_added", created.id, ctx.viewer?.id ?? null, {});
      return created.id;
    });
    const [document] = await companyDocuments([id]);
    if (!document) throw refuse("not_found");
    return { status: 201, body: toHit(document) };
  },
});

const addEmployerUser = defineRoute({
  method: "POST",
  path: "/api/founder/employer-users",
  auth: "session",
  roles: FOUNDER,
  body: "json",
  async load(ctx) {
    const slug = jsonField(ctx, "company_slug");
    if (typeof slug !== "string" || slug.trim() === "") return undefined;
    const company = await first<{ id: string; slug: string }>("SELECT id, slug FROM companies WHERE slug = $1", [slug]);
    if (!company) throw refuse("not_found");
    return company;
  },
  async input(ctx, company) {
    const parsed = parseShape(founderEmployerShape, requireJsonObject(ctx));
    const fields = {
      ...(parsed.ok ? {} : parsed.fields),
      ...(company ? {} : { company_slug: FIELD_COPY.company_id }),
    };
    if (!parsed.ok || !company) throw invalidFields(fields);
    const taken = await first("SELECT 1 FROM users WHERE lower(email) = lower($1)", [parsed.value.email]);
    if (taken) throw invalidFields({ email: FIELD_COPY.email_taken });
    return { company, ...parsed.value };
  },
  async run(ctx, _company, input) {
    const token = newToken();
    const passwordHash = await hashPassword(newToken());
    const member = await inUnit(async (unit) => {
      const created = await unit
        .first<{ id: string }>(
          `INSERT INTO users (role, display_name, email, password_hash, company_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [input.role, input.display_name, input.email, passwordHash, input.company.id],
        )
        .catch((error: unknown) => {
          throw isUniqueViolation(error) ? invalidFields({ email: FIELD_COPY.email_taken }) : error;
        });
      if (!created) throw refuse("not_found");
      await unit.query(
        `INSERT INTO auth_tokens (token_hash, kind, user_id, expires_at) VALUES ($1, 'set_password', $2, app_now() + make_interval(secs => $3))`,
        [digest(token), created.id, config.limits.emailLinkTtlSeconds],
      );
      await unit.mail(input.email, "Set your Candour Bench password", `Set your password: ${config.publicUrl}/reset-password?token=${token}\n`);
      await unit.audit("employer_user_added", created.id, ctx.viewer?.id ?? null, {});
      return unit.first<MemberRow>(`${MEMBER_SQL} WHERE u.id = $1`, [created.id]);
    });
    return { status: 201, body: member };
  },
});

const revoke = defineRoute({
  method: "POST",
  path: "/api/founder/companies/:slug/revoke-verification",
  auth: "session",
  roles: FOUNDER,
  async load(ctx) {
    const company = await first<{ id: string; slug: string }>("SELECT id, slug FROM companies WHERE slug = $1", [ctx.params["slug"]]);
    if (!company) throw refuse("not_found");
    return company;
  },
  async run(ctx, company) {
    await inUnit(async (unit) => {
      await unit.query("UPDATE companies SET verified = false WHERE id = $1", [company.id]);
      await unit.query("DELETE FROM verification_codes WHERE company_id = $1", [company.id]);
      await unit.syncSearch("companies", company.id);
      unit.emit({ type: "company.changed", audience: ["all"], data: { slug: company.slug } });
      await unit.audit("verification_revoked", company.id, ctx.viewer?.id ?? null, {});
    });
    const [document] = await companyDocuments([company.id]);
    if (!document) throw new ApiError("not_found");
    return { status: 200, body: toHit(document) };
  },
});

const thresholds = defineRoute({
  method: "GET",
  path: "/api/founder/thresholds",
  auth: "session",
  roles: FOUNDER,
  async run() {
    const companies = await rows<{ id: string; slug: string }>("SELECT id, slug FROM companies ORDER BY slug");
    const figures = await figuresFor(pool, companies.map((company) => company.id));
    const found: ThresholdRow[] = companies.flatMap((company) =>
      (figures.get(company.id)?.payReports ?? []).map((report) => ({
        company_slug: company.slug,
        role_family: report.role_family,
        city: report.city,
        report_count: report.amounts.length,
        threshold: config.limits.minPayReports,
        shown: report.amounts.length >= config.limits.minPayReports,
      })),
    );
    return { status: 200, body: { rows: found } };
  },
});

export const founderRoutes: Handler[] = [health, members, appoint, addCompany, addEmployerUser, revoke, thresholds];
