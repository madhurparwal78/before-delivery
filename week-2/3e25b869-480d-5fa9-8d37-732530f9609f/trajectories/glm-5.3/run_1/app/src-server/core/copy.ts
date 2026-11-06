// API copy: error messages by code, field messages, cart/account/studio updates,
// and email bodies. Single source for every server-produced string.

import { type Locale, batchStateLabel, type BatchState } from "./catalog.js";

/** Error codes and their published copy. */
const MESSAGES: Record<string, [string, string]> = {
  unsupported_media_type: ["Send the request as JSON.", "Envoyez la requête en JSON."],
  payload_too_large: ["That request is too large.", "Cette requête est trop volumineuse."],
  cross_origin: ["That request didn't come from this site.", "Cette requête ne vient pas de ce site."],
  unauthenticated: ["Sign in to continue.", "Connectez-vous pour continuer."],
  not_found: ["We couldn't find that.", "Nous n'avons rien trouvé."],
  forbidden: ["Your role can't do that.", "Votre rôle ne permet pas cette action."],
  method_not_allowed: ["That method isn't allowed here.", "Cette méthode n'est pas permise ici."],
  audit_immutable: ["The audit log can't be changed.", "Le journal ne peut pas être modifié."],
  idempotency_key_required: ["Send an Idempotency-Key header.", "Envoyez un en-tête Idempotency-Key."],
  idempotency_key_invalid: ["That idempotency key isn't valid.", "Cette clé d'idempotence n'est pas valide."],
  idempotency_key_reused: ["That idempotency key was used with a different request.", "Cette clé d'idempotence a été utilisée avec une requête différente."],
  request_in_progress: ["That request is still running.", "Cette requête est toujours en cours."],
  precondition_required: ["Reload the record, then try again.", "Rechargez le dossier, puis réessayez."],
  stale_version: ["Someone else changed this record. Reload it and try again.", "Quelqu'un d'autre a modifié ce dossier. Rechargez-le et réessayez."],
  invalid: ["Check these fields.", "Vérifiez ces champs."],
  invalid_credentials: ["Email or password is incorrect.", "Courriel ou mot de passe incorrect."],
  rate_limited: ["Too many codes were requested for this email. Wait a few minutes, then try again.", "Trop de codes ont été demandés pour ce courriel. Patientez quelques minutes, puis réessayez."],
  stepup_locked: ["Too many incorrect codes. Wait a few minutes, then request a new code.", "Trop de codes erronés. Patientez quelques minutes, puis demandez un nouveau code."],
  not_live: ["This batch isn't on sale yet.", "Ce lot n'est pas encore en vente."],
  hold_limit: ["You can hold up to 2 bars from one batch.", "Vous pouvez réserver au plus 2 pains d'un même lot."],
  sold_out: ["Sold out. The last bar is gone. You were not charged.", "Épuisé. Le dernier pain est parti. Aucun montant n'a été prélevé."],
  all_held: ["Every bar is held right now. A bar comes back if a hold ends without payment.", "Tous les pains sont réservés pour le moment. Un pain revient si une réservation se termine sans paiement."],
  hold_not_active: ["That hold is no longer active.", "Cette réservation n'est plus active."],
  hold_expired: ["Your hold ended before payment. You were not charged.", "Votre réservation a pris fin avant le paiement. Aucun montant n'a été prélevé."],
  hold_not_in_cart: ["That hold isn't in your cart.", "Cette réservation n'est pas dans votre panier."],
  subscription_exists: ["You already have a Trio. Manage it from your account.", "Vous avez déjà un Trio. Gérez-le depuis votre compte."],
  cycle_locked: ["This cycle is locked. Changes open again after {date}.", "Ce cycle est verrouillé. Les modifications rouvrent après le {date}."],
  invalid_transition: ["That change isn't possible right now.", "Cette modification n'est pas possible pour le moment."],
  already_skipped: ["The next delivery is already skipped.", "La prochaine livraison est déjà sautée."],
  not_skipped: ["The next delivery isn't skipped.", "La prochaine livraison n'est pas sautée."],
  already_shipped: ["{order} was already shipped.", "{order} a déjà été expédiée."],
  order_refunded: ["{order} is fully refunded. Don't ship it.", "{order} est entièrement remboursée. Ne l'expédiez pas."],
  already_refunded: ["Those bars were already refunded.", "Ces pains ont déjà été remboursés."],
  line_not_mismatched: ["That line isn't a mismatch.", "Cette ligne n'est pas un écart."],
  line_not_orphan: ["That line isn't an orphan payment.", "Cette ligne n'est pas un paiement orphelin."],
  notice_not_failed: ["{notice} isn't failed. It may already be queued again.", "{notice} n'est pas en échec. Il est peut-être déjà remis en file."],
  billing_unavailable: ["Our billing system is unreachable. Nothing was changed.", "Notre système de facturation est injoignable. Rien n'a été modifié."],
  billing_unavailable_checkout: ["Checkout is paused: our payment system is unreachable.", "Le paiement est en pause : notre système de paiement est injoignable."],
  billing_unavailable_subscription: ["Subscription changes are paused: our billing system is unreachable. Nothing has been changed.", "Les modifications d'abonnement sont en pause : notre système de facturation est injoignable. Rien n'a été modifié."],
  invalid_batch_transition: ["A batch in state {state} can't {action}.", "Un lot à l'état {state} ne peut pas {action}."]
};

export function message(code: string, locale: Locale, params: Record<string, string> = {}): string {
  const entry = MESSAGES[code] ?? MESSAGES.not_found;
  let text = locale === "fr-CA" ? entry[1] : entry[0];
  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{${k}}`, v);
  }
  return text;
}

/** Batch invalid-transition copy with the state label lower-cased. */
export function batchTransitionMessage(state: BatchState, action: "cut" | "schedule" | "open" | "withdraw", locale: Locale): { code: "invalid_transition"; message: string } {
  const stateLabel = batchStateLabel(state, locale).toLocaleLowerCase(locale === "fr-CA" ? "fr-CA" : "en-CA");
  const actionsEn: Record<string, string> = { cut: "cut", schedule: "schedule", open: "open", withdraw: "withdraw" };
  const actionsFr: Record<string, string> = { cut: "être coupé", schedule: "être programmé", open: "ouvrir", withdraw: "être retiré" };
  const actionLabel = locale === "fr-CA" ? actionsFr[action] : actionsEn[action];
  return {
    code: "invalid_transition",
    message: locale === "fr-CA"
      ? `Un lot à l'état ${stateLabel} ne peut pas ${actionLabel}.`
      : `A batch in state ${stateLabel} can't ${actionLabel}.`
  };
}

/** Field messages, keyed by field. French strings follow the no-break space rule. */
const FIELDS: Record<string, [string, string]> = {
  cant_set: ["This field can't be set.", "Ce champ ne peut pas être défini."],
  email: ["Enter an email address like name@example.ca.", "Entrez une adresse courriel comme nom@exemple.ca."],
  code: ["That code doesn't match or has expired. Request a new code.", "Ce code ne correspond pas ou a expiré. Demandez un nouveau code."],
  name: ["Enter your full name.", "Entrez votre nom complet."],
  line1: ["Enter your street address.", "Entrez votre adresse."],
  city: ["Enter your city.", "Entrez votre ville."],
  postal_code: ["Enter a Canadian postal code like H2T 1S6.", "Entrez un code postal canadien comme H2T 1S6."],
  province: ["Choose a province or territory.", "Choisissez une province ou un territoire."],
  scent: ["Choose a scent.", "Choisissez un parfum."],
  cadence_missing: ["Choose how often your Trio arrives.", "Choisissez la fréquence de votre Trio."],
  cadence_same: ["That is already your cadence.", "C'est déjà votre fréquence."],
  bars_refund: ["Choose at least one bar from this order.", "Choisissez au moins un pain de cette commande."],
  bars_cut: ["Enter a bar count from 1 to 24.", "Entrez un nombre de pains de 1 à 24."],
  restock: ["This batch was withdrawn; its bars can't go back on sale.", "Ce lot a été retiré; ses pains ne peuvent pas revenir en vente."],
  amount_cents: ["Enter an amount from $1.00 to $25.00.", `Entrez un montant de 1,00\u00A0$ à 25,00\u00A0$.`],
  reason: ["Give a reason of 3 to 500 characters.", "Indiquez un motif de 3 à 500 caractères."],
  topic: ["Choose a topic.", "Choisissez un sujet."],
  message: ["Write a message of 10 to 2,000 characters.", `Écrivez un message de 10 à 2\u00A0000 caractères.`],
  poured_on: ["The pour date can't be in the future.", "La date de coulée ne peut pas être dans le futur."],
  cure_days: ["Cure time is 28 to 60 days.", "La cure dure de 28 à 60 jours."],
  drop_at_local_format: ["Enter a date and time like 2026-11-07T10:00.", "Entrez une date et une heure comme 2026-11-07T10:00."],
  drop_at_local_past: ["Choose a time in the future.", "Choisissez un moment dans le futur."],
  drop_at_local_before_cure: ["The drop can't be before the cure date, {date}.", "La vente ne peut pas précéder la date de cure, le {date}."],
  drop_at_local_gap: ["That time doesn't exist in Toronto: clocks spring forward.", "Cette heure n'existe pas à Toronto\u00A0: on avance l'heure."],
  packing_cutoff_local: ["Enter a time like 14:00.", "Entrez une heure comme 14\u00A0h\u00A000."],
  month: ["Enter a month like 2026-10.", "Entrez un mois comme 2026-10."],
  holds: ["Choose at least one held bar.", "Choisissez au moins un pain réservé."],
  batch: ["Choose a batch.", "Choisissez un lot."],
  purpose: ["Use checkout or sign_in.", "Utilisez checkout ou sign_in."],
  q: ["Enter an order number, subscription number or email.", "Entrez un numéro de commande, un numéro d'abonnement ou un courriel."],
  status: ["Choose queued, retrying, sent or failed.", "Choisissez queued, retrying, sent ou failed."],
  open_not_cured: ["This batch is still curing until {date}.", "Ce lot est en cure jusqu'au {date}."]
};

export type FieldMessageKey = keyof typeof FIELDS;

export function fieldMessage(key: string, locale: Locale, params: Record<string, string> = {}): string {
  const entry = FIELDS[key] ?? FIELDS.cant_set;
  let text = locale === "fr-CA" ? entry[1] : entry[0];
  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{${k}}`, v);
  }
  return text;
}
