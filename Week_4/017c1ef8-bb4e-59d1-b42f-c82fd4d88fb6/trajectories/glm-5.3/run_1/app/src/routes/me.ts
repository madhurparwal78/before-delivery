import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import { errors, newId, conflict } from '../errors.js';
import { wrap, requireSession } from '../http.js';
import { getMemberById, skillsFor } from '../profile.js';
import type { JobCardRow } from './jobs.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const meRouter = (): Router => {
  const router = Router();
  router.use('/me', requireSession);

  router.patch('/me/sections/:section', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const section = req.params.section;
    if (!['intro', 'about', 'experience', 'education', 'skills'].includes(section)) {
      throw errors.notFound();
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const version = Number(body.version);
    const versions = await query<{ [k: string]: number }>(
      `SELECT intro_version, about_version, experience_version, education_version, skills_version
       FROM profile_sections WHERE member_id = $1`, [viewerId]);
    if (versions.rows.length === 0) throw errors.notFound();
    const currentVersion = Number(versions.rows[0][`${section}_version`]);

    // Validate and build the section payload.
    const fields: Record<string, string> = {};
    if (section === 'intro') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const headline = typeof body.headline === 'string' ? body.headline : '';
      const location = typeof body.location === 'string' ? body.location : '';
      if (name.length < 1 || name.length > 80) fields.name = 'Enter a name of 1 to 80 characters.';
      if (headline.length > 120) fields.headline = 'Headlines can be up to 120 characters.';
      if (location.length > 80) fields.location = 'Locations can be up to 80 characters.';
      if (Object.keys(fields).length > 0) throw errors.validation(fields);
      if (version !== currentVersion) {
        const member = await getMemberById(viewerId);
        throw conflict({
          error: 'version_conflict', section,
          current_version: currentVersion,
          current: member ? {
            name: member.name, headline: member.headline, location: member.location,
          } : {},
        });
      }
      await query(`UPDATE members SET name = $1, headline = $2, location = $3 WHERE id = $4`,
        [body.name, body.headline ?? '', body.location ?? '', viewerId]);
      await query(`UPDATE profile_sections SET intro_version = intro_version + 1 WHERE member_id = $1`, [viewerId]);
      const member = await getMemberById(viewerId);
      res.json({
        section, version: currentVersion + 1,
        current: { name: member?.name, headline: member?.headline, location: member?.location },
      });
      return;
    }

    if (section === 'about') {
      const about = typeof body.about === 'string' ? body.about : '';
      if ([...about].length > 2000) fields.about = 'About can be up to 2000 characters.';
      if (Object.keys(fields).length > 0) throw errors.validation(fields);
      if (version !== currentVersion) {
        const current = await query<{ about: string }>(`SELECT about FROM profile_sections WHERE member_id = $1`, [viewerId]);
        throw conflict({
          error: 'version_conflict', section, current_version: currentVersion,
          current: { about: current.rows[0]?.about ?? '' },
        });
      }
      await query(`UPDATE profile_sections SET about = $1, about_version = about_version + 1 WHERE member_id = $2`,
        [about, viewerId]);
      res.json({ section, version: currentVersion + 1, current: { about } });
      return;
    }

    if (section === 'experience' || section === 'education') {
      const list = Array.isArray(body[section]) ? body[section] as Record<string, unknown>[] : [];
      const kind = section;
      const values: { title: string; company: string; start: string; end: string | null }[] = [];
      list.forEach((row, index) => {
        const a = kind === 'experience' ? 'title' : 'school';
        const b = kind === 'experience' ? 'company' : 'degree';
        const title = typeof row[a] === 'string' ? row[a] as string : '';
        const company = typeof row[b] === 'string' ? row[b] as string : '';
        const start = typeof row.start === 'string' ? row.start : '';
        const end = row.end === null || row.end === undefined ? null : String(row.end);
        if (title.length < 1 || title.length > 100) fields[`${kind}.${index}.${a}`] = `Enter 1 to 100 characters.`;
        if (company.length < 1 || company.length > 100) fields[`${kind}.${index}.${b}`] = `Enter 1 to 100 characters.`;
        if (!MONTH_RE.test(start)) fields[`${kind}.${index}.start`] = 'Use YYYY-MM.';
        if (end !== null && !MONTH_RE.test(end)) fields[`${kind}.${index}.end`] = 'Use YYYY-MM or leave it empty.';
        if (end !== null && start && end < start) fields[`${kind}.${index}.end`] = 'End must be after start.';
        values.push({ title, company, start, end });
      });
      if (Object.keys(fields).length > 0) throw errors.validation(fields);
      if (version !== currentVersion) {
        const currentList = kind === 'experience'
          ? await query(`SELECT title, company, start_month, end_month FROM experience WHERE member_id = $1 ORDER BY position`, [viewerId])
          : await query(`SELECT school AS title, degree AS company, start_month, end_month FROM education WHERE member_id = $1 ORDER BY position`, [viewerId]);
        throw conflict({
          error: 'version_conflict', section, current_version: currentVersion,
          current: { [kind]: currentList.rows.map((r) => ({
            title: r.title, company: r.company, start: r.start_month, end: r.end_month ?? null,
          })) },
        });
      }
      await withTransaction(async (client) => {
        await client.query(`DELETE FROM ${kind} WHERE member_id = $1`, [viewerId]);
        let position = 0;
        for (const value of values) {
          const a = kind === 'experience' ? 'title' : 'school';
          const b = kind === 'experience' ? 'company' : 'degree';
          await client.query(
            `INSERT INTO ${kind} (id, member_id, ${a}, ${b}, start_month, end_month, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [newId(), viewerId, value.title, value.company, value.start, value.end, position++]);
        }
        await client.query(`UPDATE profile_sections SET ${kind}_version = ${kind}_version + 1 WHERE member_id = $1`, [viewerId]);
      });
      const fresh = kind === 'experience'
        ? await query(`SELECT title, company, start_month, end_month FROM experience WHERE member_id = $1 ORDER BY position`, [viewerId])
        : await query(`SELECT school AS title, degree AS company, start_month, end_month FROM education WHERE member_id = $1 ORDER BY position`, [viewerId]);
      res.json({
        section, version: currentVersion + 1,
        current: {
          [kind]: fresh.rows.map((r) => ({
            [kind === 'experience' ? 'title' : 'school']: r.title,
            [kind === 'experience' ? 'company' : 'degree']: r.company,
            start: r.start_month, end: r.end_month ?? null,
          })),
        },
      });
      return;
    }

    // Skills
    const skills = Array.isArray(body.skills) ? body.skills as unknown[] : [];
    const featured = Array.isArray(body.featured) ? body.featured as unknown[] : undefined;
    const names = skills.map((s) => typeof s === 'string' ? s.trim() : '');
    const seen = new Set<string>();
    for (const name of names) {
      const key = name.toLowerCase();
      if (name.length < 1 || name.length > 40) fields.skills = 'Skills are 1 to 40 characters.';
      if (seen.has(key)) fields.skills = 'Skills must differ.';
      seen.add(key);
    }
    if (names.length > config.maxSkills) {
      const e = errors.validation({});
      e.body = { error: 'skill_limit', limit: config.maxSkills };
      e.status = 422;
      throw e;
    }
    if (featured && (featured.length > 3 || featured.some((f) => !names.some((n) => n.toLowerCase() === String(f).toLowerCase())))) {
      const e = errors.validation({});
      e.body = { error: 'featured_limit', limit: 3 };
      e.status = 422;
      throw e;
    }
    if (Object.keys(fields).length > 0) throw errors.validation(fields);

    if (version !== currentVersion) {
      const existingSkills = await query<{ name: string; featured: number | null }>(
        `SELECT s.name, fs.position AS featured FROM skills s
         LEFT JOIN featured_skills fs ON fs.skill_id = s.id AND fs.member_id = s.member_id
         WHERE s.member_id = $1`, [viewerId]);
      const rows = existingSkills.rows
        .map((r) => ({ name: r.name, featured: r.featured }))
        .sort((a, b) => (b.featured ?? -1) - (a.featured ?? -1) || a.name.localeCompare(b.name));
      throw conflict({
        error: 'version_conflict', section, current_version: currentVersion,
        current: {
          skills: rows.filter((r) => r.featured === null).map((r) => r.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
          featured: rows.filter((r) => r.featured !== null).sort((a, b) => (a.featured ?? 0) - (b.featured ?? 0)).map((r) => r.name),
        },
      });
    }
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM featured_skills WHERE member_id = $1`, [viewerId]);
      await client.query(`DELETE FROM endorsements WHERE owner_id = $1`, [viewerId]);
      await client.query(`DELETE FROM skills WHERE member_id = $1`, [viewerId]);
      let position = 0;
      const idByName = new Map<string, string>();
      for (const name of names) {
        const id = newId();
        idByName.set(name.toLowerCase(), id);
        await client.query(`INSERT INTO skills (id, member_id, name) VALUES ($1, $2, $3)`, [id, viewerId, name]);
        position++;
      }
      if (featured) {
        let fpos = 1;
        for (const name of featured) {
          const id = idByName.get(String(name).toLowerCase());
          if (id) {
            await client.query(`INSERT INTO featured_skills (member_id, skill_id, position) VALUES ($1, $2, $3)`,
              [viewerId, id, fpos++]);
          }
        }
      }
      await client.query(`UPDATE profile_sections SET skills_version = skills_version + 1 WHERE member_id = $1`, [viewerId]);
    });
    const list = await skillsFor(viewerId, viewerId);
    res.json({
      section, version: currentVersion + 1,
      current: {
        skills: list.map((s) => s.name),
        featured: list.filter((s) => s.featured_position !== null).map((s) => s.name),
      },
    });
  }));

  router.patch('/me/settings', wrap(async (req, res) => {
    const { visibility } = (req.body ?? {}) as { visibility?: string };
    if (visibility !== 'public' && visibility !== 'connections' && visibility !== 'private') {
      throw errors.validation({ visibility: 'Choose Public, Connections only or Private.' });
    }
    await query(`UPDATE members SET visibility = $1 WHERE id = $2`, [visibility, req.auth!.memberId]);
    res.json({ visibility });
  }));

  router.put('/me/photo', wrap(async (req, res) => {
    const { photo_id } = (req.body ?? {}) as { photo_id?: string };
    const upload = await query(`SELECT 1 FROM uploads WHERE id = $1 AND owner_id = $2 AND kind = 'photo'`,
      [photo_id ?? '', req.auth!.memberId]);
    if (upload.rows.length === 0) throw errors.notFound();
    await query(`UPDATE members SET photo_id = $1 WHERE id = $2`, [photo_id, req.auth!.memberId]);
    res.json({ photo_url: `/media/photos/${photo_id}` });
  }));

  router.delete('/me/photo', wrap(async (req, res) => {
    await query(`UPDATE members SET photo_id = NULL WHERE id = $1`, [req.auth!.memberId]);
    res.json({ photo_url: null });
  }));

  router.get('/me/jobs', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const tab = req.query.tab === 'applied' ? 'applied' : 'saved';
    const { jobCardForViewer } = await import('./jobs.js');
    if (tab === 'saved') {
      const rows = await query(
        `SELECT j.id, j.title, j.company_id, c.name AS company_name, c.handle AS company_handle,
                j.location, j.workplace, j.posted_at, j.closes_at, s.at
         FROM saved_jobs s JOIN jobs j ON j.id = s.job_id JOIN companies c ON c.id = j.company_id
         WHERE s.member_id = $1 ORDER BY s.at DESC`, [viewerId]) as unknown as { rows: (JobCardRow & { at: Date })[] };
      const jobs = [];
      for (const row of rows.rows) {
        const card = await jobCardForViewer(viewerId, row);
        const application = await query(`SELECT id, state FROM applications WHERE job_id = $1 AND applicant_id = $2`, [row.id, viewerId]);
        if (application.rows[0]) {
          card.my_application = { id: application.rows[0].id, state: application.rows[0].state, status_text: statusTextOf(application.rows[0].state) };
        }
        jobs.push(card);
      }
      res.json({ jobs });
      return;
    }
    const rows = await query(
      `SELECT j.id, j.title, j.company_id, c.name AS company_name, c.handle AS company_handle,
              j.location, j.workplace, j.posted_at, j.closes_at, a.created_at AS applied_at,
              a.id AS application_id, a.state
       FROM applications a JOIN jobs j ON j.id = a.job_id JOIN companies c ON c.id = j.company_id
       WHERE a.applicant_id = $1 ORDER BY a.created_at DESC`, [viewerId]) as unknown as { rows: (JobCardRow & { applied_at: Date; application_id: string; state: string })[] };
    const jobs = [];
    for (const row of rows.rows) {
      const card = await jobCardForViewer(viewerId, row);
      card.my_application = { id: row.application_id, state: row.state, status_text: statusTextOf(row.state) };
      jobs.push(card);
    }
    res.json({ jobs });
  }));

  return router;
};

const statusTextOf = (state: string): string =>
  ({ applied: 'Application submitted', viewed: 'Viewed by the hiring team', interviewing: 'Interviewing',
     offered: 'Offer extended', rejected: 'Not selected', withdrawn: 'Withdrawn' })[state] ?? state;

