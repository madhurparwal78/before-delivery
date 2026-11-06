import type { Bilingual } from './catalog.js';
import { NBSP } from './money.js';
import type { Locale } from './types.js';

/** Builds a bilingual string. French copy carries its no-break spaces literally. */
export function t(en: string, fr: string): Bilingual {
  return { 'en-CA': en, 'fr-CA': fr };
}

export function say(text: Bilingual, locale: Locale): string {
  return text[locale];
}

export const ELLIPSIS = '\u2026';

export const UI = {
  brand: t('Pain de Lune', 'Pain de Lune'),
  skipToContent: t('Skip to content', 'Aller au contenu'),
  mainNav: t('Main', 'Principal'),
  navDrop: t('Drop', 'Vente'),
  navSubscribe: t('Subscribe', "S'abonner"),
  navAccount: t('Account', 'Compte'),
  navContact: t('Contact', 'Contact'),
  languageToggle: t('Français', 'English'),
  serviceStatus: t('Service status', 'État du service'),

  loafFigure: t('Loaf', 'Bloc'),
  loafCanvas: t('Loaf cross-section', 'Coupe du bloc'),
  loafDiagram: t('Loaf diagram', 'Schéma du bloc'),
  scentGroup: t('Scent', 'Parfum'),
  regionBatch: t('Batch', 'Lot'),
  regionCureDate: t('Cure date', 'Date de cure'),
  regionScentNotes: t('Scent notes', 'Notes'),
  regionDropTime: t('Drop time', 'Heure de la vente'),
  regionPrice: t('Price', 'Prix'),
  batchCounts: t('Batch counts', 'Décompte du lot'),
  holdABar: t('Hold a bar', 'Réserver un pain'),
  holdingPending: t(`Holding${ELLIPSIS}`, `Réservation${ELLIPSIS}`),
  showBarList: t('Show bar list', 'Afficher la liste des pains'),
  barsInBatch: t('Bars in this batch', 'Pains de ce lot'),
  cartUpdates: t('Cart updates', 'Mises à jour du panier'),
  allBarsHeld: t('All bars are held', 'Tous les pains sont réservés'),
  soldOut: t('Sold out', 'Épuisé'),

  checkoutHeading: t('Checkout', 'Paiement'),
  heldBars: t('Your held bars', 'Vos pains réservés'),
  backToDrop: t('Back to the drop', 'Retour à la vente'),
  province: t('Province', 'Province'),
  orderTotal: t('Order total', 'Total de la commande'),
  lineSubtotal: t('Subtotal', 'Sous-total'),
  lineShipping: t('Shipping', 'Livraison'),
  lineTotal: t('Total', 'Total'),
  email: t('Email', 'Courriel'),
  sendCode: t('Send code', 'Envoyer le code'),
  sendingPending: t(`Sending${ELLIPSIS}`, `Envoi${ELLIPSIS}`),
  code: t('Code', 'Code'),
  verify: t('Verify', 'Vérifier'),
  checkingPending: t(`Checking${ELLIPSIS}`, `Vérification${ELLIPSIS}`),
  fullName: t('Full name', 'Nom complet'),
  streetAddress: t('Street address', 'Adresse'),
  city: t('City', 'Ville'),
  postalCode: t('Postal code', 'Code postal'),
  errorSummary: t('Check these fields', 'Vérifiez ces champs'),
  lockoutAlert: t('Too many incorrect codes', 'Trop de codes erronés'),
  rateLimitAlert: t('Too many code requests', 'Trop de demandes de code'),
  payingPending: t(`Paying${ELLIPSIS}`, `Paiement en cours${ELLIPSIS}`),
  checkoutPaused: t('Checkout paused', 'Paiement en pause'),
  noBarsHeld: t('No bars held', 'Aucun pain réservé'),
  verifyFirst: t('Verify your email first', "Confirmez d'abord votre courriel"),
  shippingAddress: t('Shipping address', 'Adresse de livraison'),
  emailStep: t('Email', 'Courriel'),

  trioHeading: t('Trio subscription', 'Abonnement Trio'),
  trioDescription: t(
    'Three bars of one core scent per delivery.',
    "Trois pains d'un même parfum à chaque livraison.",
  ),
  trioScentGroup: t('Trio scent', 'Parfum du Trio'),
  cadence: t('Cadence', 'Fréquence'),
  cadenceChoose: t(`Choose${ELLIPSIS}`, `Choisir${ELLIPSIS}`),
  trioPrice: t('Trio price', 'Prix du Trio'),
  lineDiscount: t('Subscribe-and-save', 'Abonnement-épargne'),
  chargedToday: t('Charged today', "Prélevé aujourd'hui"),
  startSubscription: t('Start subscription', "Commencer l'abonnement"),
  startingPending: t(`Starting${ELLIPSIS}`, `Démarrage${ELLIPSIS}`),
  subscriptionsPaused: t('Subscriptions paused', 'Abonnements en pause'),
  signIn: t('Sign in', 'Se connecter'),
  yourAccount: t('Your account', 'Votre compte'),
  orders: t('Orders', 'Commandes'),
  subscriptions: t('Subscriptions', 'Abonnements'),
  signOut: t('Sign out', 'Se déconnecter'),
  nextBillDate: t('Next bill date', 'Prochaine date de facturation'),
  paused: t('Paused', 'En pause'),
  skipNext: t('Skip next delivery', 'Sauter la prochaine livraison'),
  undoSkip: t('Undo skip', 'Annuler le saut'),
  swapScent: t('Swap scent', 'Changer de parfum'),
  pause: t('Pause', 'Mettre en pause'),
  resume: t('Resume', 'Reprendre'),
  cancelSubscription: t('Cancel subscription', "Résilier l'abonnement"),
  cancelDialog: t('Cancel subscription?', "Résilier l'abonnement?"),
  cancelConfirm: t('Yes, cancel', 'Oui, résilier'),
  keepIt: t('Keep it', 'Le garder'),
  accountUpdates: t('Account updates', 'Mises à jour du compte'),
  savingPending: t(`Saving${ELLIPSIS}`, `Enregistrement${ELLIPSIS}`),
  notFoundHeading: t("We couldn't find that", 'Introuvable'),
  notFoundLine: t(
    "That page or record doesn't exist, or it isn't yours.",
    "Cette page ou ce dossier n'existe pas, ou ne vous appartient pas.",
  ),
  state: t('State', 'État'),
  scent: t('Scent', 'Parfum'),
  pendingCadence: t('Pending cadence', 'Fréquence à venir'),
  lockDate: t('Lock date', 'Date de verrouillage'),

  contactHeading: t('Contact', 'Contact'),
  name: t('Name', 'Nom'),
  topic: t('Topic', 'Sujet'),
  topicPlaceholder: t('Choose a topic', 'Choisissez un sujet'),
  message: t('Message', 'Message'),
  sendMessage: t('Send message', 'Envoyer le message'),
  contactStatus: t('Contact status', 'État du message'),

  password: t('Password', 'Mot de passe'),
  studioNav: t('Studio', 'Atelier'),
  navBatches: t('Batches', 'Lots'),
  navPacking: t('Packing', 'Emballage'),
  navFinance: t('Finance', 'Finances'),
  navReconciliation: t('Reconciliation', 'Rapprochement'),
  navAudit: t('Audit', 'Journal'),
  navNotices: t('Notices', 'Avis'),
  studioUpdates: t('Studio updates', "Mises à jour de l'atelier"),
  studioHeading: t('Studio', 'Atelier'),
  logALoaf: t('Log a loaf', 'Consigner un bloc'),
  pourDate: t('Pour date', 'Date de coulée'),
  cureDays: t('Cure days', 'Jours de cure'),
  logLoaf: t('Log loaf', 'Consigner le bloc'),
  batchesTable: t('Batches', 'Lots'),
  barsCut: t('Bars cut', 'Pains coupés'),
  saveCut: t('Save cut', 'Enregistrer la coupe'),
  dropDateTime: t('Drop date and time (Toronto)', 'Date et heure de la vente (Toronto)'),
  saveDropTime: t('Save drop time', "Enregistrer l'heure"),
  packingCutoff: t('Packing cutoff (Toronto)', "Heure limite d'emballage (Toronto)"),
  saveCutoff: t('Save cutoff', "Enregistrer l'heure limite"),
  packToday: t('Pack today', "À emballer aujourd'hui"),
  ordersToPack: t('Orders to pack', 'Commandes à emballer'),
  findRecord: t('Find order or subscription', 'Chercher une commande ou un abonnement'),
  returnBarsToStock: t('Return bars to stock', 'Remettre en stock'),
  refundReason: t('Refund reason', 'Motif du remboursement'),
  issueRefund: t('Issue refund', 'Rembourser'),
  refundingPending: t(`Refunding${ELLIPSIS}`, `Remboursement${ELLIPSIS}`),
  creditAmount: t('Credit amount', 'Montant du crédit'),
  creditReason: t('Credit reason', 'Motif du crédit'),
  addCredit: t('Add credit', 'Ajouter le crédit'),
  month: t('Month', 'Mois'),
  onlyMismatches: t('Only mismatches', 'Seulement les écarts'),
  reconciliationLines: t('Reconciliation lines', 'Lignes de rapprochement'),
  reconciliationStatus: t('Reconciliation status', 'État du rapprochement'),
  financeAudit: t('Finance audit', 'Journal financier'),
  noticesTable: t('Notices', 'Avis'),
  studioSignInFailed: t('Email or password is incorrect.', 'Courriel ou mot de passe incorrect.'),
  credits: t('Credits', 'Crédits'),
  refunds: t('Refunds', 'Remboursements'),
} as const;

export const COLUMNS = {
  key: t('Key', 'Clé'),
  kind: t('Kind', 'Genre'),
  shop: t('Shop', 'Boutique'),
  killbill: t('Kill Bill', 'Kill Bill'),
  status: t('Status', 'Statut'),
  code: t('Code', 'Code'),
  scent: t('Scent', 'Parfum'),
  state: t('State', 'État'),
  pourDate: t('Pour date', 'Date de coulée'),
  cureDate: t('Cure date', 'Date de cure'),
  dropTime: t('Drop time', 'Heure de la vente'),
  cut: t('Cut', 'Coupés'),
  available: t('Available', 'Disponibles'),
  held: t('Held', 'Réservés'),
  sold: t('Sold', 'Vendus'),
  bars: t('Bars', 'Pains'),
  actions: t('Actions', 'Actions'),
  order: t('Order', 'Commande'),
  shipOn: t('Ship on', 'Expédition le'),
  address: t('Address', 'Adresse'),
  number: t('Number', 'Numéro'),
  shipping: t('Shipping', 'Livraison'),
  amount: t('Amount', 'Montant'),
  at: t('At', 'Le'),
  actor: t('Actor', 'Intervenant'),
  role: t('Role', 'Rôle'),
  action: t('Action', 'Action'),
  target: t('Target', 'Dossier'),
  reason: t('Reason', 'Motif'),
  outcome: t('Outcome', 'Résultat'),
  killbillRef: t('Kill Bill reference', 'Référence Kill Bill'),
  recipient: t('To', 'Destinataire'),
  subject: t('Subject', 'Objet'),
  attempts: t('Attempts', 'Tentatives'),
  enqueuedAt: t('Queued at', 'Mis en file le'),
  total: t('Total', 'Total'),
  price: t('Price', 'Prix'),
} as const;

export const BAR_STATE_WORDS = {
  available: t('available', 'disponible'),
  held: t('held', 'réservé'),
  sold: t('sold', 'vendu'),
} as const;

export function barItemText(bar: number, status: 'available' | 'held' | 'sold'): Bilingual {
  return t(
    `Bar ${bar}: ${BAR_STATE_WORDS[status]['en-CA']}`,
    `Pain ${bar}${NBSP}: ${BAR_STATE_WORDS[status]['fr-CA']}`,
  );
}

export const FIELD_MESSAGES = {
  unknown_key: t("This field can't be set.", 'Ce champ ne peut pas être défini.'),
  email: t(
    'Enter an email address like name@example.ca.',
    'Entrez une adresse courriel comme nom@exemple.ca.',
  ),
  code: t(
    "That code doesn't match or has expired. Request a new code.",
    'Ce code ne correspond pas ou a expiré. Demandez un nouveau code.',
  ),
  name: t('Enter your full name.', 'Entrez votre nom complet.'),
  line1: t('Enter your street address.', 'Entrez votre adresse.'),
  city: t('Enter your city.', 'Entrez votre ville.'),
  postal_code: t(
    'Enter a Canadian postal code like H2T 1S6.',
    'Entrez un code postal canadien comme H2T 1S6.',
  ),
  province: t('Choose a province or territory.', 'Choisissez une province ou un territoire.'),
  scent: t('Choose a scent.', 'Choisissez un parfum.'),
  cadence_missing: t(
    'Choose how often your Trio arrives.',
    'Choisissez la fréquence de votre Trio.',
  ),
  cadence_same: t('That is already your cadence.', "C'est déjà votre fréquence."),
  bars_refund: t(
    'Choose at least one bar from this order.',
    'Choisissez au moins un pain de cette commande.',
  ),
  bars_cut: t('Enter a bar count from 1 to 24.', 'Entrez un nombre de pains de 1 à 24.'),
  restock: t(
    "This batch was withdrawn; its bars can't go back on sale.",
    'Ce lot a été retiré; ses pains ne peuvent pas revenir en vente.',
  ),
  amount_cents: t(
    'Enter an amount from $1.00 to $25.00.',
    `Entrez un montant de 1,00${NBSP}$ à 25,00${NBSP}$.`,
  ),
  reason: t(
    'Give a reason of 3 to 500 characters.',
    'Indiquez un motif de 3 à 500 caractères.',
  ),
  topic: t('Choose a topic.', 'Choisissez un sujet.'),
  message: t(
    'Write a message of 10 to 2,000 characters.',
    `Écrivez un message de 10 à 2${NBSP}000 caractères.`,
  ),
  poured_on: t(
    "The pour date can't be in the future.",
    'La date de coulée ne peut pas être dans le futur.',
  ),
  cure_days: t('Cure time is 28 to 60 days.', 'La cure dure de 28 à 60 jours.'),
  drop_at_local_format: t(
    'Enter a date and time like 2026-11-07T10:00.',
    'Entrez une date et une heure comme 2026-11-07T10:00.',
  ),
  drop_at_local_past: t('Choose a time in the future.', 'Choisissez un moment dans le futur.'),
  drop_at_local_gap: t(
    "That time doesn't exist in Toronto: clocks spring forward.",
    `Cette heure n'existe pas à Toronto${NBSP}: on avance l'heure.`,
  ),
  packing_cutoff_local: t('Enter a time like 14:00.', 'Entrez une heure comme 14:00.'),
  month: t('Enter a month like 2026-10.', 'Entrez un mois comme 2026-10.'),
  holds: t('Choose at least one held bar.', 'Choisissez au moins un pain réservé.'),
  batch: t('Choose a batch.', 'Choisissez un lot.'),
  purpose: t('Use checkout or sign_in.', 'Utilisez checkout ou sign_in.'),
  q: t(
    'Enter an order number, subscription number or email.',
    "Entrez un numéro de commande, un numéro d'abonnement ou un courriel.",
  ),
  status: t(
    'Choose queued, retrying, sent or failed.',
    'Choisissez queued, retrying, sent ou failed.',
  ),
} as const;

export function dropBeforeCureMessage(cureDateLong: Bilingual): Bilingual {
  return t(
    `The drop can't be before the cure date, ${cureDateLong['en-CA']}.`,
    `La vente ne peut pas précéder la date de cure, le ${cureDateLong['fr-CA']}.`,
  );
}

export function stillCuringMessage(cureDateLong: Bilingual): Bilingual {
  return t(
    `This batch is still curing until ${cureDateLong['en-CA']}.`,
    `Ce lot est en cure jusqu'au ${cureDateLong['fr-CA']}.`,
  );
}

export const VALIDATION_SUMMARY = t('Check these fields.', 'Vérifiez ces champs.');

export const CART = {
  holdSucceeded: (bar: number, left: string): Bilingual =>
    t(
      `Bar ${bar} is held for you. Time left: ${left}.`,
      `Le pain ${bar} est réservé pour vous. Temps restant${NBSP}: ${left}.`,
    ),
  oneMinuteLeft: (bar: number): Bilingual =>
    t(
      `One minute left on your hold for bar ${bar}.`,
      `Plus qu'une minute pour votre réservation du pain ${bar}.`,
    ),
  holdEnded: (bar: number): Bilingual =>
    t(
      `Your hold on bar ${bar} ended. The bar is back in the drop.`,
      `Votre réservation du pain ${bar} a pris fin. Le pain est de retour dans la vente.`,
    ),
  released: (bar: number): Bilingual =>
    t(`Bar ${bar} released.`, `Pain ${bar} libéré.`),
  totalChanged: (total: Bilingual): Bilingual =>
    t(
      `Total is now ${total['en-CA']}.`,
      `Le total est maintenant de ${total['fr-CA']}.`,
    ),
  soldOut: t(
    'Sold out. The last bar is gone. You were not charged.',
    "Épuisé. Le dernier pain est parti. Aucun montant n'a été prélevé.",
  ),
  allHeld: t(
    'Every bar is held right now. A bar comes back if a hold ends without payment.',
    'Tous les pains sont réservés pour le moment. Un pain revient si une réservation se termine sans paiement.',
  ),
  holdLimit: t(
    'You can hold up to 2 bars from one batch.',
    "Vous pouvez réserver au plus 2 pains d'un même lot.",
  ),
  notLive: t("This batch isn't on sale yet.", "Ce lot n'est pas encore en vente."),
  codeRequested: (email: string): Bilingual =>
    t(
      `If ${email} can receive mail, a code is on its way. It works once and expires in a few minutes.`,
      `Si ${email} peut recevoir des courriels, un code est en route. Il ne sert qu'une fois et expire dans quelques minutes.`,
    ),
  holdExpired: t(
    'Your hold ended before payment. You were not charged.',
    "Votre réservation a pris fin avant le paiement. Aucun montant n'a été prélevé.",
  ),
  networkFailure: t(
    "We couldn't reach the shop. Check your connection and try again.",
    'Impossible de joindre la boutique. Vérifiez votre connexion et réessayez.',
  ),
} as const;

export const LOCKOUT_MESSAGE = t(
  'Too many incorrect codes. Wait a few minutes, then request a new code.',
  'Trop de codes erronés. Patientez quelques minutes, puis demandez un nouveau code.',
);

export const RATE_LIMIT_MESSAGE = t(
  'Too many codes were requested for this email. Wait a few minutes, then try again.',
  'Trop de codes ont été demandés pour ce courriel. Patientez quelques minutes, puis réessayez.',
);

export function dropOpensMessage(when: Bilingual): Bilingual {
  return t(`Drop opens ${when['en-CA']}`, `La vente ouvre le ${when['fr-CA']}`);
}

export function confirmationGoesTo(email: string): Bilingual {
  return t(
    `We'll email your confirmation to ${email}.`,
    `Nous enverrons votre confirmation à ${email}.`,
  );
}

export const ACCOUNT = {
  subscriptionStarted: (amount: Bilingual): Bilingual =>
    t(
      `Subscription started. Charged today: ${amount['en-CA']}.`,
      `Abonnement commencé. Prélevé aujourd'hui${NBSP}: ${amount['fr-CA']}.`,
    ),
  subscriptionExists: t(
    'You already have a Trio. Manage it from your account.',
    'Vous avez déjà un Trio. Gérez-le depuis votre compte.',
  ),
  skipped: (skipped: Bilingual, next: Bilingual): Bilingual =>
    t(
      `Your ${skipped['en-CA']} delivery is skipped. Next bill date: ${next['en-CA']}.`,
      `Votre livraison du ${skipped['fr-CA']} est sautée. Prochaine date de facturation${NBSP}: ${next['fr-CA']}.`,
    ),
  unskipped: (next: Bilingual): Bilingual =>
    t(
      `Skip undone. Next bill date: ${next['en-CA']}.`,
      `Saut annulé. Prochaine date de facturation${NBSP}: ${next['fr-CA']}.`,
    ),
  scentSwapped: (scent: Bilingual): Bilingual =>
    t(
      `Your Trio scent is now ${scent['en-CA']}.`,
      `Le parfum de votre Trio est maintenant ${scent['fr-CA']}.`,
    ),
  cadenceChanged: (from: Bilingual, cadence: Bilingual): Bilingual =>
    t(
      `From ${from['en-CA']}, your Trio arrives ${cadence['en-CA'].toLowerCase()}.`,
      `À partir du ${from['fr-CA']}, votre Trio arrive ${cadence['fr-CA'].toLowerCase()}.`,
    ),
  pausedFrom: (date: Bilingual): Bilingual =>
    t(
      `Paused. Nothing is billed after ${date['en-CA']}.`,
      `En pause. Rien n'est facturé après le ${date['fr-CA']}.`,
    ),
  resumed: (next: Bilingual): Bilingual =>
    t(
      `Resumed. Next bill date: ${next['en-CA']}.`,
      `Repris. Prochaine date de facturation${NBSP}: ${next['fr-CA']}.`,
    ),
  cancelled: t(
    'Cancelled. Your last delivery is the one already paid.',
    'Résilié. Votre dernière livraison est celle déjà payée.',
  ),
  cycleLocked: (date: Bilingual): Bilingual =>
    t(
      `This cycle is locked. Changes open again after ${date['en-CA']}.`,
      `Ce cycle est verrouillé. Les modifications rouvrent après le ${date['fr-CA']}.`,
    ),
  invalidTransition: t(
    "That change isn't possible right now.",
    "Cette modification n'est pas possible pour le moment.",
  ),
} as const;

export const BANNERS = {
  checkout: t(
    'Checkout is paused: our payment system is unreachable. Held bars stay held until their timer ends.',
    `Le paiement est en pause${NBSP}: notre système de paiement est injoignable. Les pains réservés le restent jusqu'à la fin de leur minuterie.`,
  ),
  subscription: t(
    'Subscription changes are paused: our billing system is unreachable. Nothing has been changed.',
    `Les modifications d'abonnement sont en pause${NBSP}: notre système de facturation est injoignable. Rien n'a été modifié.`,
  ),
  checkoutShort: t(
    'Checkout is paused: our payment system is unreachable.',
    `Le paiement est en pause${NBSP}: notre système de paiement est injoignable.`,
  ),
} as const;

export const RECONCILIATION_STATUS = {
  staleWith: (checked: Bilingual): Bilingual =>
    t(
      `Reconciliation is stale: Kill Bill could not be reached. Showing figures from ${checked['en-CA']}.`,
      `Le rapprochement n'est pas à jour${NBSP}: Kill Bill est injoignable. Montants du ${checked['fr-CA']}.`,
    ),
  staleWithout: t(
    'Reconciliation is stale: Kill Bill could not be reached. No earlier figures for this month.',
    `Le rapprochement n'est pas à jour${NBSP}: Kill Bill est injoignable. Aucun montant antérieur pour ce mois.`,
  ),
} as const;

export const STUDIO = {
  loafLogged: (code: string): Bilingual => t(`Loaf ${code} logged.`, `Bloc ${code} consigné.`),
  cutSaved: (code: string, bars: number): Bilingual =>
    t(`${code} cut into ${bars} bars.`, `${code} coupé en ${bars} pains.`),
  dropScheduled: (code: string, when: Bilingual): Bilingual =>
    t(`${code} drops ${when['en-CA']}.`, `${code} sera en vente le ${when['fr-CA']}.`),
  openedNow: (code: string): Bilingual =>
    t(`${code} is on sale now.`, `${code} est en vente maintenant.`),
  withdrawn: (code: string): Bilingual => t(`${code} withdrawn.`, `${code} retiré.`),
  cutoffSaved: (time: string): Bilingual =>
    t(
      `Packing cutoff is now ${time} Toronto time.`,
      `L'heure limite d'emballage est maintenant ${time}, heure de Toronto.`,
    ),
  shipped: (order: string): Bilingual =>
    t(`${order} marked shipped.`, `${order} marquée expédiée.`),
  alreadyShipped: (order: string): Bilingual =>
    t(`${order} was already shipped.`, `${order} a déjà été expédiée.`),
  orderRefunded: (order: string): Bilingual =>
    t(
      `${order} is fully refunded. Don't ship it.`,
      `${order} est entièrement remboursée. Ne l'expédiez pas.`,
    ),
  refundIssued: (refund: string, amount: Bilingual): Bilingual =>
    t(
      `Refund ${refund} issued: ${amount['en-CA']}.`,
      `Remboursement ${refund} effectué${NBSP}: ${amount['fr-CA']}.`,
    ),
  refundFailed: (refund: string): Bilingual =>
    t(
      `Kill Bill is unreachable. Refund ${refund} is recorded as failed; nothing was paid back.`,
      `Kill Bill est injoignable. Le remboursement ${refund} est consigné comme échoué; rien n'a été remboursé.`,
    ),
  creditAdded: (credit: string, amount: Bilingual): Bilingual =>
    t(
      `Credit ${credit} added: ${amount['en-CA']}.`,
      `Crédit ${credit} ajouté${NBSP}: ${amount['fr-CA']}.`,
    ),
  creditFailed: (credit: string): Bilingual =>
    t(
      `Kill Bill is unreachable. Credit ${credit} is recorded as failed; nothing was added.`,
      `Kill Bill est injoignable. Le crédit ${credit} est consigné comme échoué; rien n'a été ajouté.`,
    ),
  staleVersion: t(
    'Someone else changed this record. Reload it and try again.',
    "Quelqu'un d'autre a modifié ce dossier. Rechargez-le et réessayez.",
  ),
  figureAccepted: (amount: Bilingual, key: string): Bilingual =>
    t(
      `Kill Bill's figure of ${amount['en-CA']} is now the shop record for ${key}.`,
      `Le montant de Kill Bill, ${amount['fr-CA']}, est maintenant celui de la boutique pour ${key}.`,
    ),
  orphanRefunded: (key: string, amount: Bilingual): Bilingual =>
    t(
      `Orphan payment ${key} refunded: ${amount['en-CA']}.`,
      `Paiement orphelin ${key} remboursé${NBSP}: ${amount['fr-CA']}.`,
    ),
  noticeResent: (notice: string): Bilingual =>
    t(`${notice} queued again.`, `${notice} remis en file.`),
  noticeNotFailed: (notice: string): Bilingual =>
    t(
      `${notice} isn't failed. It may already be queued again.`,
      `${notice} n'est pas en échec. Il est peut-être déjà remis en file.`,
    ),
  billingUnavailable: t(
    'Kill Bill is unreachable. Nothing was changed.',
    "Kill Bill est injoignable. Rien n'a été modifié.",
  ),
  forbidden: t("Your role can't do that.", 'Votre rôle ne permet pas cette action.'),
} as const;

/** Conflict copy the brief leaves to the shop. */
export const CONFLICTS = {
  holdNotActive: t('That hold is no longer active.', "Cette réservation n'est plus active."),
  alreadyRefunded: t(
    'Those bars are already refunded.',
    'Ces pains sont déjà remboursés.',
  ),
  lineNotMismatched: t(
    "That line isn't a mismatch.",
    "Cette ligne n'est pas un écart.",
  ),
  lineNotOrphan: t(
    "That line isn't an orphan Kill Bill payment.",
    "Cette ligne n'est pas un paiement orphelin de Kill Bill.",
  ),
} as const;

export function contactSuccess(reference: string): Bilingual {
  return t(
    `Thanks. Your reference is ${reference}. We'll reply by email.`,
    `Merci. Votre référence est ${reference}. Nous vous répondrons par courriel.`,
  );
}

export function invalidTransitionMessage(stateLabel: Bilingual, action: BatchAction): Bilingual {
  return t(
    `A batch in state ${stateLabel['en-CA'].toLowerCase()} can't ${BATCH_ACTION_WORDS[action]['en-CA']}.`,
    `Un lot à l'état ${stateLabel['fr-CA'].toLowerCase()} ne peut pas ${BATCH_ACTION_WORDS[action]['fr-CA']}.`,
  );
}

export type BatchAction = 'cut' | 'schedule' | 'open' | 'withdraw';

export const BATCH_ACTION_WORDS: Record<BatchAction, Bilingual> = {
  cut: t('cut', 'être coupé'),
  schedule: t('schedule', 'être programmé'),
  open: t('open', 'ouvrir'),
  withdraw: t('withdraw', 'être retiré'),
};
