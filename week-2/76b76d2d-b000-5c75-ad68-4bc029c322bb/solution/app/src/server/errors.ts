import type { Locale } from "../shared/domain.ts";

/** The one API error catalogue: status and localised message per code (brief: Error messages). */
const CATALOGUE = {
  invalid_json: [400, "The request body isn't valid JSON.", "Le corps de la requête n'est pas un JSON valide."],
  unauthenticated: [401, "Please sign in to continue.", "Connectez-vous pour continuer."],
  invalid_credentials: [401, "Email or password is incorrect.", "Courriel ou mot de passe incorrect."],
  forbidden: [403, "Your role can't do this.", "Votre rôle ne permet pas cette action."],
  cross_origin: [403, "This request must come from the Halide site.", "Cette requête doit provenir du site Halide."],
  members_priority: [403, "Member priority booking is open. Booking opens to everyone on <date> at 10:00.", "La réservation prioritaire des membres est en cours. La vente au grand public ouvre le <date> à 10 h."],
  stepup_required: [403, "Confirm it's you with the code we email you.", "Confirmez votre identité avec le code envoyé par courriel."],
  not_found: [404, "This page or record doesn't exist.", "Cette page ou cette fiche n'existe pas."],
  method_not_allowed: [405, "This action isn't allowed here.", "Cette action n'est pas permise ici."],
  idempotency_in_progress: [409, "This request is still being processed.", "Cette requête est toujours en traitement."],
  seat_taken: [409, "Just taken by another patron: <seats>. Choose other seats.", "Viennent d'être prises par une autre personne : <seats>. Choisissez d'autres places."],
  not_on_sale: [409, "Booking for this season opens to members on <date> at 10:00.", "La réservation pour cette saison ouvre aux membres le <date> à 10 h."],
  screening_closed: [409, "This screening is no longer on sale.", "Cette séance n'est plus en vente."],
  hold_already_paid: [409, "This hold has already been paid.", "Cette réservation temporaire est déjà payée."],
  booking_not_paid: [409, "This booking isn't paid.", "Cette réservation n'est pas payée."],
  already_refunded: [409, "This booking was already refunded.", "Cette réservation a déjà été remboursée."],
  booking_checked_in: [409, "This booking has been checked in and can't be refunded.", "Cette réservation a été enregistrée à l'entrée et ne peut pas être remboursée."],
  refund_window_closed: [409, "Refunds close 2 hours before showtime. The box office can offer a goodwill credit.", "Les remboursements ferment 2 heures avant la séance. La billetterie peut offrir un crédit de courtoisie."],
  already_checked_in: [409, "Already checked in at <time>.", "Déjà enregistré à <time>."],
  checkin_not_open: [409, "Check-in opens at <time>.", "L'accueil ouvre à <time>."],
  checkin_closed: [409, "Check-in closed at <time>.", "L'accueil a fermé à <time>."],
  ticket_refunded: [409, "This ticket was refunded.", "Ce billet a été remboursé."],
  already_member: [409, "You already have an active membership.", "Vous avez déjà une adhésion active."],
  not_member: [409, "You don't have an active membership.", "Vous n'avez pas d'adhésion active."],
  no_change: [409, "That is already your tier and billing.", "C'est déjà votre palier et votre facturation."],
  change_pending: [409, "A change is already scheduled for <date>.", "Un changement est déjà prévu le <date>."],
  gift_membership_locked: [409, "Gift memberships can't change tier until they end.", "Une adhésion-cadeau ne peut pas changer de palier avant sa fin."],
  illegal_transition: [409, "A season can't move from <from> to <to>.", "Une saison ne peut pas passer de <from> à <to>."],
  season_has_future_screenings: [409, "This season still has upcoming screenings.", "Cette saison a encore des séances à venir."],
  season_closed: [409, "This season is closed to changes.", "Cette saison n'accepte plus de modifications."],
  slug_taken: [409, "That season slug is already used.", "Cet identifiant de saison est déjà utilisé."],
  email_taken: [409, "An account already uses this email.", "Un compte utilise déjà ce courriel."],
  nothing_to_accept: [409, "This day already matches Kill Bill.", "Cette journée concorde déjà avec Kill Bill."],
  hold_expired: [410, "Your seat hold has expired and the seats are back on sale. Choose your seats again.", "Votre réservation temporaire a expiré et les places sont remises en vente. Choisissez de nouveau vos places."],
  code_expired: [410, "This code has expired. Send a new code.", "Ce code a expiré. Demandez un nouveau code."],
  body_too_large: [413, "The request is too large.", "La requête est trop volumineuse."],
  unsupported_media_type: [415, "Send the request as JSON.", "Envoyez la requête en JSON."],
  validation: [422, "Some fields need attention.", "Certains champs sont à corriger."],
  idempotency_conflict: [422, "This retry key was already used for a different request.", "Cette clé de reprise a déjà servi pour une autre requête."],
  code_incorrect: [422, "That code isn't right. <n> attempts left.", "Ce code est incorrect. Essais restants : <n>."],
  season_empty: [422, "Add at least one screening first.", "Ajoutez d'abord au moins une séance."],
  stepup_locked: [429, "Too many incorrect codes. Verification is locked for <minutes> min.", "Trop de codes incorrects. La vérification est bloquée pendant <minutes> min."],
  resend_too_soon: [429, "Wait <seconds> s before sending another code.", "Attendez <seconds> s avant de demander un autre code."],
  code_send_limit: [429, "Too many codes sent. Try again in <minutes> min.", "Trop de codes envoyés. Réessayez dans <minutes> min."],
  billing_unavailable: [503, "Billing is temporarily unavailable. Nothing was charged or changed. Please try again in a few minutes.", "La facturation est temporairement indisponible. Rien n'a été facturé ni modifié. Réessayez dans quelques minutes."],
} as const satisfies Record<string, readonly [number, string, string]>;

type ErrorCode = keyof typeof CATALOGUE;

/** Field message keys (brief: Field messages). */
const FIELD_MESSAGES = {
  required: ["Required.", "Obligatoire."],
  email: ["Enter a valid email address.", "Entrez une adresse courriel valide."],
  length: ["Use <min> to <max> characters.", "Utilisez de <min> à <max> caractères."],
  choice: ["Choose one of the listed options.", "Choisissez l'une des options proposées."],
  seat_count: ["Choose 1 to 10 seats.", "Choisissez de 1 à 10 places."],
  group_seat_count: ["Choose 10 to 40 seats for a group.", "Choisissez de 10 à 40 places pour un groupe."],
  fare: ["This fare isn't available for this seat.", "Ce tarif n'est pas offert pour cette place."],
  uplift: ["Enter an uplift between $1.00 and $500.00.", "Entrez une contribution entre 1,00 $ et 500,00 $."],
  credit: ["Enter a credit between $1.00 and $500.00.", "Entrez un crédit entre 1,00 $ et 500,00 $."],
  split: ["Payer seats must add up to <n>.", "Les places des payeurs doivent totaliser <n>."],
  date: ["Enter a valid date.", "Entrez une date valide."],
  retry_key: ["A retry key is required.", "Une clé de reprise est requise."],
} as const satisfies Record<string, readonly [string, string]>;

export type FieldProblem = { kind: keyof typeof FIELD_MESSAGES; params?: Record<string, string | number> };
type Params = Record<string, string | number>;

function fill(template: string, params: Params): string {
  return template.replace(/<([a-z]+)>/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    readonly params: Params = {},
    readonly extra: { fields?: Record<string, FieldProblem>; seats?: string[]; attempts_left?: number; retryAfter?: number; allow?: string } = {},
  ) {
    super(code);
    this.status = CATALOGUE[code][0];
  }
}

export function validationError(fields: Record<string, FieldProblem>): ApiError {
  return new ApiError("validation", {}, { fields });
}

/** The one serialiser for every API error body. */
export function errorBody(error: ApiError, locale: Locale): { status: number; body: string; headers: Record<string, string> } {
  const [status, en, fr] = CATALOGUE[error.code];
  const body: Record<string, unknown> = { code: error.code, message: fill(locale === "en" ? en : fr, error.params) };
  const { fields, seats, attempts_left, retryAfter } = error.extra;
  if (fields) {
    body.fields = Object.fromEntries(
      Object.entries(fields).map(([name, problem]) => {
        const [fen, ffr] = FIELD_MESSAGES[problem.kind];
        return [name, fill(locale === "en" ? fen : ffr, problem.params ?? {})];
      }),
    );
  }
  if (seats) body.seats = seats;
  if (attempts_left !== undefined) body.attempts_left = attempts_left;
  const headers: Record<string, string> = {};
  if (retryAfter !== undefined) {
    body.retry_after_seconds = retryAfter;
    headers["Retry-After"] = String(retryAfter);
  }
  if (error.extra.allow) headers.Allow = error.extra.allow;
  return { status, body: JSON.stringify({ error: body }), headers };
}
