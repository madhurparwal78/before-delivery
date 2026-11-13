# TRUTH — Graphite Hollow Linewright (golden)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flow)

1. **Sign up, land in the hangar, keep the language** (brief: Journeys 1; DP-01, DP-03, DP-07, DP-62, DP-77)
   - Start: signed out, no `lw_locale` cookie, `Accept-Language: es-ES` → `/` served with `<html lang="es">`, title `Linewright`, Idioma combobox showing `Español` (brief: Server boundary, Locale resolution).
   - Choose 日本語 → `PUT /api/locale {"locale":"ja"}` → 204 and `lw_locale=ja` for one year; the page re-renders in Japanese on the next frame (decided: re-render after the save is stored so later navigations agree).
   - `/signup` in Japanese → submit → `POST /api/auth/signup` 201 with `lw_session` and `lw_locale=ja`; Postgres `accounts` row (locale `ja`, `verification_email` `sent`), slot-1 hero named after the display name, equipped (brief: Seed data).
   - Mailpit: one message, From `Linewright <play@linewright.test>`, subject `Linewright アカウントの確認`, HTML `lang="ja"` and text part, exactly one link `<APP_PUBLIC_URL>/verify?token=…` (brief: Services).
   - `/verify?token=…` → heading `メールアドレスを確認しました。`, picker still 日本語.
   - Sign in → `/hangar`, title `格納庫 · Linewright`, region 装備中のヒーロー with the hero name as h1 and the 3D preview.
   - Sign out → `/`, `/signin`, `/forgot-password` stay Japanese (cookie kept on sign-out).
2. **Build, pose and save by keyboard** (brief: Journeys 2; DP-11–DP-15, DP-67, DP-78): parts radiogroups, sliders (0.50–1.50 step 0.05, value text `1,25` in es), Right arm raise (±180, 15° keys, `<n>°`), Undo/Redo (50 steps), Save dialog: pending disables Save (aria-disabled, keeps focus, `Procesando...`), Cancel and radios; 201 → `Guardado en la ranura 2.` in Avisos, focus back on Save to slot. Postgres `characters` slot 2, `pose.right_arm_raise` = 0.7854 for 45°.
3. **Draw and forge** (brief: Journeys 3; DP-18–DP-22, DP-61, DP-68): keyboard cursor 5 cm per press, Space adds a point under the 2 cm rule, Enter commits; preview per change with `drawing_revision`; Forge → 201 → lift `flying` → `catching` → `socketed`, armoury lists `Weapon 1` equipped.
4. **Upload, fix, equip a model** (brief: Journeys 4; DP-24–DP-30, DP-66, DP-69, DP-72): Upload status shows `Uploading...` → `Stored. Waiting to validate.` → `Validating against rulebook 2026.11-r1.` → verdict; MinIO `models/<account>/<model>/original.glb` byte for byte, `thumbnail.png` for accepted models; delete while storage down → 503, delete-outage banner, item stays selected and equipped.
5. **Solo chapter and resume** (brief: Journeys 5; DP-31–DP-34, DP-63): checkpoint saves exactly the motes held; resume starts at (−4, 0) with the saved motes; completion → `/stories/lantern-road/chapters/1/complete`.
6. **Party and ready check** (brief: Journeys 6; DP-38–DP-45, DP-65, DP-75): seat count decided in one SQL step; losers get 409 `party_full`; timer text is the server's `remaining_seconds`.
7. **Drop twice and rejoin** (brief: Journeys 7; DP-49–DP-51, DP-64, DP-70, DP-71, DP-76): ping every 2 s, closed after 4 s silent; fresh `REJOIN_GRACE_SECONDS` per drop; intents deduplicated by `intent_id` in Postgres.
8. **Phone chat through outages** (brief: Journeys 8; DP-46–DP-48): 280 × 👍🏽 counts 280; offline send retried with the same `client_message_id`; sixth message in 10 s → 429 with `Retry-After`.

## Palette (decided hexes for the brief's roles; brief: Visual design)

| Role | Hex |
|---|---|
| paper ground | `#faf6ee` |
| graphite (text, outlines) | `#1d1d1f` |
| graphite soft | `#55585e` |
| cobalt (actions, links, selection, focus) | `#1f4fd8` |
| marker (highlight, active tab, meter fill) | `#f7d84b` |
| brick (alerts, over-limit, failed rules) | `#b4452f` |
| card | `#fdf8ec` (decided: visibly warm cream over the scene) |
| hero material `graphite` fill | `#a7a9ae` (decided: pencil grey so the graphite hull reads) |

## Type, space and layout

- Fredoka 600 for headings, tab labels, stat numerals; Nunito 400/700 body; Noto Sans JP 400/700 for `ja`, preloaded (brief: Visual design, Server boundary).
- Heading scale ×1.25: h1 1.95rem, h2 1.56rem, h3 1.25rem; body 17px (16px below 768) (decided).
- Spacing unit 12px, radius 10px, tap targets ≥ 44px (brief: Density).
- ≥ 1024: left rail of torn-paper tabs, parts card left, inspector card right (~26%); < 1024: icon tabs across the top (label kept as the accessible name), bottom sheet; < 768: chat drawer; forge preview 220px tall with the 320px plane below (brief: Screens and layout; decided: heights).

## Scene layers

- Hangar, builder, forge and signed-out pages: the focusable Hero preview (Three.js) with the inked hero, ground shadow and pencilled ring (brief: Screens and layout).
- Armoury, models, stories, lobby, party, invite, chapter complete and not found: a still, aria-hidden sketchbook world behind the paper layer (hero at the spawn, motes, checkpoint ring, puddle, gate), rendered only on resize (decided: the brief's scene always fills the viewport; no unnamed loop).
- Play: the Game view with level props, each member's figure rebuilt only when their look, weapon or model changes; an accepted model is loaded from the session's `model_url` and falls back to the stick figure on 404/503 (brief: DP-54).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| button dip | press | 140 ms | ease | none |
| hangar turntable | idle, resumes 3 s after drag | 35 s per turn | linear | off |
| builder camera | parts section focus | 400 ms | ease-in-out | cut |
| flythrough | play page open | 4 s | ease-in-out | still overview ≤ 1 s |
| tube inflate | stroke commit | 320 ms | ease-out cubic | full radius at once, lift stays idle |
| flying | Forge 201 | 500 ms | linear yaw 0→−35°, opacity 1→0; the ink travels a quadratic Bézier from the plane centre to the projected right hand; `data-arc-height` and `data-grip-gap` are measured on that path (320 px = 2 m) | crossfade 120 ms |
| catching | after flying | 600 ms | — | none |

(brief: Motion and effects; durations decided inside the brief's ranges.)

## States per async action

Pending copy `Working...` / `処理中...` / `Procesando...` on the control (aria-disabled, keeps focus); success copy only after the server confirms, in the named polite region; field errors under the field with `aria-invalid` and a summary; outages as `role="alert"` banners (brief: Feedback states).

## Breakpoints

768 and 1024 px (brief: Screens and layout).

## Media and licences

- Icons: Lucide (`lucide-static`, ISC), inline SVG sprite.
- Fonts: Fredoka, Nunito, Noto Sans JP from Fontsource (OFL-1.1), self-hosted woff2.
- 3D: all geometry made in code (Three.js, MIT). Model thumbnails drawn by the server.

## Configuration

- `APP_PUBLIC_URL` and `S3_REGION` are required at start with no built-in fallback, like the other service variables (brief: Configuration and secrets: "It never hard-codes them").

## Disputes recorded

Resolved in the current reference-tests (`@dataclass(eq=False)`, filters rooted at `page`, the `parker` route helper); the five affected tests pass against this app unchanged. The previous oracle run used the earlier test file. History:

- reference-tests `test_app.py` lines 1158, 2000, 2031: `list.get_by_role("listitem").filter(has=<locator rooted at the same list>)` searches for the list *inside* each list item, so it matches nothing for any valid list markup.
- lines 387/2940 and 3030: `Player` is a plain `@dataclass` (unhashable) used as a dict key.
- line 2949: `page.route(..., lambda route, box=...: box.append(route))` receives the request as `box` (Playwright passes two arguments to a two-parameter handler).
