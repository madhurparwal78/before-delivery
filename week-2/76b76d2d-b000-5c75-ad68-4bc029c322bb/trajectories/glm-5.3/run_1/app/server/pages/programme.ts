import { DateTime } from 'luxon';
import type { Locale } from '../domain/model';
import { copy, saleTimesLine, seatsLeft } from '../domain/i18n';
import { esc, layout } from './layout';
import { seasonViews } from '../services/programmer';
import { query } from '../services/database';
import { dateOnly, timeOnly, torontoTz } from '../time';

interface ScreeningBrief {
  id: string;
  filmTitle: string;
  format: string;
  auditorium: string;
  startsAt: DateTime;
  seatsRemaining: number;
}

async function screeningsForSeason(slug: string): Promise<ScreeningBrief[]> {
  const res = await query<{ id: string; film_title: string; format: string; auditorium: string; starts_at: Date }>(
    `SELECT id, film_title, format, auditorium, starts_at FROM screenings
     WHERE season_slug = $1 AND starts_at > now() ORDER BY starts_at, ordinal`,
    [slug],
  );
  const out: ScreeningBrief[] = [];
  for (const row of res.rows) {
    const startsAt = DateTime.fromJSDate(row.starts_at).setZone(torontoTz);
    const claims = await query<{ sold: string; held: string }>(
      `SELECT
         count(*) FILTER (WHERE sc.booking_ref IS NOT NULL)::text AS sold,
         count(*) FILTER (WHERE sc.booking_ref IS NULL AND h.state='held' AND h.expires_at > now())::text AS held
       FROM seat_claims sc
       LEFT JOIN holds h ON h.id = sc.hold_id
       WHERE sc.screening_id = $1`,
      [row.id],
    );
    const aud = await query<{ capacity: number }>('SELECT capacity FROM auditoriums WHERE code = $1', [row.auditorium]);
    const remaining = Math.max(0, (aud.rows[0]?.capacity ?? 0) - Number(claims.rows[0].sold) - Number(claims.rows[0].held));
    out.push({
      id: row.id,
      filmTitle: row.film_title,
      format: row.format,
      auditorium: row.auditorium,
      startsAt,
      seatsRemaining: remaining,
    });
  }
  return out;
}

export async function programmePage(
  locale: Locale,
  path: string,
  signedIn: boolean,
  initialSeasonSlug: string | null,
): Promise<string> {
  const l = locale;
  const seasons = await seasonViews(false);
  const initialSlug = initialSeasonSlug !== null && seasons.some(s => s.slug === initialSeasonSlug)
    ? initialSeasonSlug
    : (seasons[0]?.slug ?? '');
  const initialIndex = Math.max(0, seasons.findIndex(s => s.slug === initialSlug));

  const tabs = seasons.map((season, k) => {
    const title = l === 'fr' ? season.title_fr : season.title_en;
    const selected = season.slug === initialSlug;
    return `        <button type="button" role="tab" id="season-tab-${esc(season.slug)}" data-season-slug="${esc(season.slug)}" data-season-index="${k}" aria-selected="${selected}" ${selected ? 'aria-current="true"' : ''}>${esc(title)}</button>`;
  }).join('\n');

  const layers = await Promise.all(seasons.map(async (season, k) => {
    const title = l === 'fr' ? season.title_fr : season.title_en;
    const screenings = await screeningsForSeason(season.slug);
    const rows = screenings.map(s => {
      const name = `${s.filmTitle} — ${dateOnly(s.startsAt)} ${timeOnly(s.startsAt)} — ${s.auditorium}`;
      return `            <li>
              <a class="rail-row" href="/${l}/screenings/${esc(s.id)}" data-screening-id="${esc(s.id)}" aria-label="${esc(name)}">
                <span class="rail-date mono">${esc(dateOnly(s.startsAt))}</span>
                <span class="rail-time mono">${esc(timeOnly(s.startsAt))}</span>
                <span class="rail-title">${esc(s.filmTitle)}</span>
                <span class="rail-aud mono">${esc(s.auditorium)}</span>
                <span class="rail-seats mono" data-seats-left-for="${esc(s.id)}">${esc(seatsLeft(s.seatsRemaining, l))}</span>
              </a>
            </li>`;
    }).join('\n');
    const saleLine = (season.state === 'scheduled' || season.state === 'member-priority')
      ? `        <p class="sale-times mono">${esc(saleTimesLine(dateOnly(DateTime.fromISO(season.priority_opens_at)), dateOnly(DateTime.fromISO(season.public_opens_at)), l))}</p>`
      : '';
    return `      <section class="season-layer" id="season-segment-${esc(season.slug)}" data-season-slug="${esc(season.slug)}" data-season-index="${k}" data-tint-index="${k % 4}" aria-labelledby="season-heading-${esc(season.slug)}">
        <h2 class="season-title serif" id="season-heading-${esc(season.slug)}">${esc(title)}</h2>
        <p class="season-dates mono">${esc(season.first_date ?? '')} · ${esc(season.last_date ?? '')}</p>
${saleLine}
        <div class="rail">
          <ul class="rail-list" role="list" aria-label="${esc(copy.stage[l])} — ${esc(title)}">
${rows || `            <li class="rail-empty">${l === 'en' ? 'No upcoming screenings.' : 'Aucune séance à venir.'}</li>`}
          </ul>
        </div>
      </section>`;
  }));

  const main = `  <div id="programme-stage" class="programme-stage" role="region" aria-label="${esc(copy.stage[l])}"
       data-season-count="${seasons.length}" data-segment="${initialIndex}" data-iris-open="1.000" data-iris-rotation="40.0"
       data-iris-radius="0" data-fstop="1.4" data-rail-visible="1.000" data-tint-mix="0.000"
       data-renderer="svg" data-context="none" data-initial-season="${esc(initialSlug)}">
    <h1 id="main-heading" tabindex="-1" class="visually-hidden">${l === 'en' ? 'Programme' : 'Programme'}</h1>
    <div class="stage-fixed">
      <div class="iris-frame" aria-hidden="true">
        <canvas class="iris-canvas"></canvas>
        <svg class="iris-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"></svg>
      </div>
      <div class="tabs-row">
        <div role="tablist" aria-label="${esc(copy.seasons[l])}" class="season-tabs">
${tabs}
        </div>
      </div>
      <p class="fstop-readout mono" aria-hidden="true">f/<span class="fstop-value" id="fstop-value">1.4</span></p>
      <div class="stage-layers">
${layers.join('\n')}
      </div>
    </div>
    <p class="visually-hidden" role="status" aria-live="polite" id="season-announcer" aria-label="${l === 'en' ? 'Season announcer' : 'Annonce de saison'}"></p>
    <div class="stage-spacer" aria-hidden="true"></div>
  </div>`;

  return layout({ locale, path, signedIn, isStaff: false }, {
    title: copy.navProgramme[l],
    heading: '',
    mainContent: main,
    bodyClass: 'page-programme',
  });
}
