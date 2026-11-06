import type { Locale, Fare, Tier, Cadence } from './model';

export function formatAmount(cents: number, locale: Locale): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  if (locale === 'fr') {
    const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
    return `${sign}${grouped},${frac} $`;
  }
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${grouped}.${frac}`;
}

export interface DateParts { date: string; time: string }

export function fareLabel(fare: Fare, locale: Locale): string {
  const map: Record<Fare, Record<Locale, string>> = {
    regular: { en: 'Regular', fr: 'Ordinaire' },
    reduced: { en: 'Reduced (student, 65+)', fr: 'Réduit (étudiant, 65 ans et plus)' },
    member: { en: 'Member', fr: 'Membre' },
    'member-guest': { en: 'Member guest', fr: 'Invité de membre' },
    group: { en: 'Group', fr: 'Groupe' },
  };
  return map[fare][locale];
}

export function tierLabel(tier: Tier, locale: Locale): string {
  const map: Record<Tier, Record<Locale, string>> = {
    friend: { en: 'Friend', fr: 'Ami' },
    cinephile: { en: 'Cinephile', fr: 'Cinéphile' },
    projectionist: { en: 'Projectionist', fr: 'Projectionniste' },
  };
  return map[tier][locale];
}

export function cadenceLabel(cadence: Cadence | 'gift', locale: Locale): string {
  const map: Record<Cadence | 'gift', Record<Locale, string>> = {
    annual: { en: 'Annual', fr: 'Annuelle' },
    monthly: { en: 'Monthly', fr: 'Mensuelle' },
    gift: { en: 'Gift, 12 months', fr: 'Cadeau, 12 mois' },
  };
  return map[cadence][locale];
}

/** Error message with <seats>, <date>, <n>, <minutes>, <seconds>, <time>, <from>, <to> substituted. */
export function applyErrorParams(template: string, params: Record<string, string>): string {
  return template.replace(/<(seats|date|n|minutes|seconds|time|from|to)>/g, (_m, key: string) => params[key] ?? '');
}

export function maskedEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`;
}

export const seatsLeft = (n: number, locale: Locale): string =>
  n === 0 ? (locale === 'en' ? 'Sold out' : 'Complet') : (locale === 'en' ? `${n} left` : `${n} restantes`);

export function seasonAnnouncement(title: string, screeningCount: number, locale: Locale): string {
  if (locale === 'en') return `${title} — ${screeningCount} ${screeningCount === 1 ? 'screening' : 'screenings'}`;
  return `${title} — ${screeningCount} ${screeningCount === 1 ? 'séance' : 'séances'}`;
}

export function saleTimesLine(priorityDate: string, publicDate: string, locale: Locale): string {
  if (locale === 'en') {
    return `Members book from ${priorityDate} 10:00 · Everyone from ${publicDate} 10:00 (Montréal time)`;
  }
  return `Membres dès le ${priorityDate} à 10 h · Grand public dès le ${publicDate} à 10 h (heure de Montréal)`;
}

export const mailOutboxState = (state: 'pending' | 'sent' | 'dead', locale: Locale): string => {
  if (state === 'sent') return locale === 'en' ? 'Sent' : 'Envoyé';
  if (state === 'dead') return locale === 'en' ? 'Not delivered' : 'Non livré';
  return locale === 'en' ? 'Pending' : 'En attente';
};

export const reconciliationStatus = (status: 'matched' | 'mismatch' | 'accepted', locale: Locale): string => {
  if (status === 'matched') return locale === 'en' ? 'Matched' : 'Concordant';
  if (status === 'accepted') return locale === 'en' ? 'Accepted' : 'Accepté';
  return locale === 'en' ? 'Mismatch' : 'Écart';
};

/** The English/French interface copy. Only these strings are used in pages. */
export const copy = {
  skip: { en: 'Skip to main content', fr: 'Passer au contenu principal' },
  primaryNav: { en: 'Primary', fr: 'Principale' },
  navProgramme: { en: 'Programme', fr: 'Programme' },
  navMembership: { en: 'Membership', fr: 'Adhésion' },
  navGift: { en: 'Gift a membership', fr: 'Offrir une adhésion' },
  navContact: { en: 'Contact', fr: 'Contact' },
  navSignIn: { en: 'Sign in', fr: 'Se connecter' },
  navMyAccount: { en: 'My account', fr: 'Mon compte' },
  navSignOut: { en: 'Sign out', fr: 'Se déconnecter' },
  menu: { en: 'Menu', fr: 'Menu' },
  language: { en: 'Français', fr: 'English' },
  notice: { en: 'Service notice', fr: 'Avis de service' },
  dismissNotice: { en: 'Dismiss notice', fr: "Fermer l'avis" },
  wordmark: { en: 'Halide Film Society', fr: 'Société du film Halide' },
  stage: { en: 'Programme stage', fr: 'Scène du programme' },
  seasons: { en: 'Seasons', fr: 'Saisons' },
  seasonAnnouncer: { en: 'Season announcer', fr: 'Annonce de saison' },
  working: { en: 'Working…', fr: 'En cours…' },
  filmNotes: { en: 'Film notes', fr: 'Notes sur le film' },
  filmNotesHeading: { en: 'Film notes', fr: 'Notes sur le film' },
  seatMap: { en: 'Seat map', fr: 'Plan de salle' },
  seat: { en: 'Seat', fr: 'Place' },
  seatsLeftShort: { en: 'left', fr: 'restantes' },
  soldOut: { en: 'Sold out', fr: 'Complet' },
  groupCheckbox: { en: 'Group booking (10 to 40 seats)', fr: 'Réservation de groupe (10 à 40 places)' },
  holdSeats: { en: 'Hold seats', fr: 'Retenir les places' },
  bookingStatus: { en: 'Booking status', fr: 'État de la réservation' },
  bookingError: { en: 'Booking error', fr: 'Erreur de réservation' },
  holdPlaced: { en: 'Seats held. Complete checkout before the timer ends.', fr: 'Places retenues. Terminez le paiement avant la fin du minuteur.' },
  seatsReleased: { en: 'Seats released.', fr: 'Places libérées.' },
  checkout: { en: 'Checkout', fr: 'Paiement' },
  holdTime: { en: 'Hold time remaining', fr: 'Temps de réservation restant' },
  fare: { en: 'Fare', fr: 'Tarif' },
  fareForSeat: { en: 'Fare for seat', fr: 'Tarif pour la place' },
  addUplift: { en: 'Add a supporter uplift', fr: 'Ajouter une contribution de soutien' },
  upliftAmount: { en: 'Uplift amount', fr: 'Montant de la contribution' },
  otherAmount: { en: 'Other amount', fr: 'Autre montant' },
  otherAmountDollars: { en: 'Other amount in dollars', fr: 'Autre montant en dollars' },
  payerName: { en: 'Payer name', fr: 'Nom du payeur' },
  seatsForPayer: { en: 'Seats for payer', fr: 'Places pour le payeur' },
  addPayer: { en: 'Add payer', fr: 'Ajouter un payeur' },
  removePayer: { en: 'Remove payer', fr: 'Retirer le payeur' },
  fullName: { en: 'Full name', fr: 'Nom complet' },
  email: { en: 'Email', fr: 'Courriel' },
  phoneOptional: { en: 'Phone (optional)', fr: 'Téléphone (facultatif)' },
  noteOptional: { en: 'Note for the box office (optional)', fr: 'Note pour la billetterie (facultatif)' },
  cardholderName: { en: 'Cardholder name', fr: 'Nom du titulaire de la carte' },
  priceSummary: { en: 'Price summary', fr: 'Récapitulatif du prix' },
  admission: { en: 'Admission', fr: 'Entrée' },
  gst: { en: 'GST (5%)', fr: 'TPS (5 %)' },
  qst: { en: 'QST (9.975%)', fr: 'TVQ (9,975 %)' },
  upliftRow: { en: 'Supporter uplift (not taxed)', fr: 'Contribution de soutien (non taxable)' },
  creditApplied: { en: 'Credit applied', fr: 'Crédit appliqué' },
  total: { en: 'Total', fr: 'Total' },
  payNow: { en: 'Pay now', fr: 'À payer maintenant' },
  verifyCode: { en: 'Verify with a code', fr: 'Vérifier avec un code' },
  confirmYou: { en: "Confirm it's you", fr: 'Confirmez votre identité' },
  verificationCode: { en: 'Verification code', fr: 'Code de vérification' },
  verify: { en: 'Verify', fr: 'Vérifier' },
  sendNewCode: { en: 'Send a new code', fr: 'Envoyer un nouveau code' },
  close: { en: 'Close', fr: 'Fermer' },
  pay: { en: 'Pay', fr: 'Payer' },
  confirmBooking: { en: 'Confirm booking', fr: 'Confirmer la réservation' },
  processingPayment: { en: 'Processing payment…', fr: 'Paiement en cours…' },
  releaseSeats: { en: 'Release seats', fr: 'Libérer les places' },
  checkoutStatus: { en: 'Checkout status', fr: 'État du paiement' },
  checkoutError: { en: 'Checkout error', fr: 'Erreur de paiement' },
  bookingConfirmed: { en: 'Booking confirmed', fr: 'Réservation confirmée' },
  booking: { en: 'Booking', fr: 'Réservation' },
  tickets: { en: 'Tickets', fr: 'Billets' },
  costSplit: { en: 'Cost split', fr: 'Répartition des coûts' },
  refundBooking: { en: 'Refund booking', fr: 'Rembourser la réservation' },
  confirmRefund: { en: 'Confirm refund', fr: 'Confirmer le remboursement' },
  chooseSeatsAgain: { en: 'Choose seats again', fr: 'Choisir de nouveau vos places' },
  membership: { en: 'Membership', fr: 'Adhésion' },
  credit: { en: 'Credit', fr: 'Crédit' },
  creditBalance: { en: 'Credit balance:', fr: 'Solde de crédit :' },
  creditMovements: { en: 'Credit movements', fr: 'Mouvements de crédit' },
  myBookings: { en: 'My bookings', fr: 'Mes réservations' },
  tier: { en: 'Tier', fr: 'Palier' },
  billing: { en: 'Billing', fr: 'Facturation' },
  billingCadence: { en: 'Billing cadence', fr: 'Fréquence de facturation' },
  joinFor: { en: 'Join for', fr: 'Adhérer pour' },
  changeTier: { en: 'Change tier', fr: 'Changer de palier' },
  formStatus: { en: 'Form status', fr: 'État du formulaire' },
  formError: { en: 'Form error', fr: 'Erreur de formulaire' },
  membershipActive: { en: 'Membership active', fr: 'Adhésion active' },
  upgradeDone: { en: 'Your new tier is active. Charged today:', fr: "Votre nouveau palier est actif. Facturé aujourd'hui :" },
  changeScheduled: { en: 'Your change takes effect on', fr: 'Votre changement prend effet le' },
  nothingCharged: { en: 'Nothing is charged today.', fr: "Rien n'est facturé aujourd'hui." },
  gift: { en: 'Gift', fr: 'Cadeau' },
  yourName: { en: 'Your name', fr: 'Votre nom' },
  yourEmail: { en: 'Your email', fr: 'Votre courriel' },
  recipientName: { en: 'Recipient name', fr: 'Nom du destinataire' },
  recipientEmail: { en: 'Recipient email', fr: 'Courriel du destinataire' },
  recipientLanguage: { en: "Recipient's language", fr: 'Langue du destinataire' },
  messageOptional: { en: 'Message (optional)', fr: 'Message (facultatif)' },
  buyGiftFor: { en: 'Buy gift for', fr: 'Acheter le cadeau pour' },
  giftPurchased: { en: 'Gift membership purchased', fr: 'Adhésion-cadeau achetée' },
  giftPurchasedLine: { en: "We'll email the gift to", fr: 'Nous enverrons le cadeau à' },
  redeemHeading: { en: 'Redeem your gift membership', fr: 'Activez votre adhésion-cadeau' },
  redeem: { en: 'Redeem membership', fr: "Activer l'adhésion" },
  giftRedeemed: { en: 'Your gift membership is active', fr: 'Votre adhésion-cadeau est active' },
  signIn: { en: 'Sign in', fr: 'Se connecter' },
  signUp: { en: 'Sign up', fr: 'Créer un compte' },
  password: { en: 'Password', fr: 'Mot de passe' },
  createAccount: { en: 'Create account', fr: 'Créer un compte' },
  createAnAccount: { en: 'Create an account', fr: 'Créer un compte' },
  preferredLanguage: { en: 'Preferred language', fr: 'Langue préférée' },
  bookingLinkPage: { en: 'Booking link', fr: 'Lien de réservation' },
  bookingReference: { en: 'Booking reference', fr: 'Référence de réservation' },
  emailMeNewLink: { en: 'Email me a new link', fr: "M'envoyer un nouveau lien" },
  contact: { en: 'Contact', fr: 'Contact' },
  subject: { en: 'Subject', fr: 'Objet' },
  message: { en: 'Message', fr: 'Message' },
  sendEnquiry: { en: 'Send enquiry', fr: 'Envoyer la demande' },
  staff: { en: 'Staff', fr: 'Personnel' },
  staffDoor: { en: 'Door', fr: 'Accueil' },
  staffProgramme: { en: 'Programme', fr: 'Programmation' },
  staffFinance: { en: 'Finance', fr: 'Finances' },
  staffStatus: { en: 'Staff status', fr: 'État' },
  staffError: { en: 'Staff error', fr: 'Erreur' },
  screening: { en: 'Screening', fr: 'Séance' },
  doorList: { en: 'Door list', fr: "Liste d'accueil" },
  ticketOrBooking: { en: 'Ticket or booking code', fr: 'Code du billet ou de la réservation' },
  checkIn: { en: 'Check in', fr: "Enregistrer l'entrée" },
  seatCol: { en: 'Seat', fr: 'Place' },
  initialCol: { en: 'Initial', fr: 'Initiale' },
  ticketCol: { en: 'Ticket', fr: 'Billet' },
  statusCol: { en: 'Status', fr: 'Statut' },
  seasonSlug: { en: 'Season slug', fr: 'Identifiant de la saison' },
  titleEn: { en: 'Title (English)', fr: 'Titre (anglais)' },
  titleFr: { en: 'Title (French)', fr: 'Titre (français)' },
  publicSaleDate: { en: 'Public sale date', fr: 'Date de vente publique' },
  createSeason: { en: 'Create season', fr: 'Créer la saison' },
  seasonsTable: { en: 'Seasons', fr: 'Saisons' },
  filmTitle: { en: 'Film title', fr: 'Titre du film' },
  format: { en: 'Format', fr: 'Format' },
  auditorium: { en: 'Auditorium', fr: 'Salle' },
  firstShowtime: { en: 'First showtime', fr: 'Première séance' },
  weeklyOccurrences: { en: 'Weekly occurrences', fr: 'Occurrences hebdomadaires' },
  addScreenings: { en: 'Add screenings', fr: 'Ajouter les séances' },
  scheduleSeason: { en: 'Schedule season', fr: 'Planifier la saison' },
  archiveSeason: { en: 'Archive season', fr: 'Archiver la saison' },
  withdrawSeason: { en: 'Withdraw season', fr: 'Retirer la saison' },
  confirmWithdrawal: { en: 'Confirm withdrawal', fr: 'Confirmer le retrait' },
  reason: { en: 'Reason', fr: 'Motif' },
  findBooking: { en: 'Find booking', fr: 'Trouver une réservation' },
  search: { en: 'Search', fr: 'Rechercher' },
  issueGoodwill: { en: 'Issue goodwill credit', fr: 'Émettre un crédit de courtoisie' },
  goodwillDialog: { en: 'Issue goodwill credit', fr: 'Émettre un crédit de courtoisie' },
  amountDollars: { en: 'Amount in dollars', fr: 'Montant en dollars' },
  issueCredit: { en: 'Issue credit', fr: 'Émettre le crédit' },
  reconciliation: { en: 'Reconciliation', fr: 'Rapprochement' },
  businessDay: { en: 'Business day', fr: "Journée d'affaires" },
  loadDay: { en: 'Load day', fr: 'Charger la journée' },
  takings: { en: 'Takings', fr: 'Recettes' },
  downloadCsv: { en: 'Download CSV', fr: 'Télécharger le CSV' },
  acceptKillBill: { en: 'Accept Kill Bill figure', fr: 'Accepter le montant de Kill Bill' },
  confirm: { en: 'Confirm', fr: 'Confirmer' },
  auditList: { en: 'Audit list', fr: "Journal d'audit" },
  mailOutbox: { en: 'Mail outbox', fr: 'File de courriels' },
  enquiries: { en: 'Enquiries', fr: 'Demandes' },
  openRef: { en: 'Open', fr: 'Ouvrir' },
  reply: { en: 'Reply', fr: 'Réponse' },
  sendReply: { en: 'Send reply', fr: 'Envoyer la réponse' },
  refundDone: { en: 'Refund issued:', fr: 'Remboursement émis :' },
  toOriginalPayment: { en: 'to the original payment.', fr: "sur le paiement d'origine." },
  returnedToCredit: { en: 'returned to your credit.', fr: 'remis en crédit.' },
  goodwillDone: { en: 'Goodwill credit of', fr: 'Crédit de courtoisie de' },
  issuedTo: { en: 'issued to', fr: 'émis au compte' },
  checkedInSeat: { en: 'Checked in: seat', fr: 'Entrée enregistrée : place' },
  checkedInBooking: { en: 'tickets.', fr: 'billets.' },
  lookupMiss: { en: 'No booking, ticket, gift or account matches', fr: 'Aucune réservation, aucun billet, aucun cadeau ni aucun compte ne correspond à' },
  reconciliationAccepted: { en: 'Kill Bill total accepted for', fr: 'Total de Kill Bill accepté pour le' },
  seasonScheduled: { en: 'Season scheduled.', fr: 'Saison planifiée.' },
  seasonArchived: { en: 'Season archived.', fr: 'Saison archivée.' },
  seasonWithdrawn: { en: 'Season withdrawn.', fr: 'Saison retirée.' },
  bookingsRefunded: { en: 'bookings refunded.', fr: 'réservations remboursées.' },
  screeningsAdded: { en: 'screenings added.', fr: 'séances ajoutées.' },
  enquiryReceived: { en: 'Thank you. Your enquiry', fr: 'Merci. Votre demande' },
  hasBeenReceived: { en: 'has been received. We reply by email.', fr: 'a bien été reçue. Nous répondons par courriel.' },
  replyRecorded: { en: 'Reply recorded. It will be emailed to', fr: 'Réponse enregistrée. Elle sera envoyée à' },
  linkRequested: { en: 'If the reference and email match, a new link is on its way and any earlier link no longer works.', fr: 'Si la référence et le courriel correspondent, un nouveau lien est en route et tout lien précédent ne fonctionne plus.' },
  billingNotice: { en: 'Billing is temporarily unavailable. You can browse the programme, but booking, membership changes and refunds are paused.', fr: "La facturation est temporairement indisponible. Vous pouvez consulter le programme, mais les réservations, les changements d'adhésion et les remboursements sont suspendus." },
  mailNotice: { en: 'Email delivery is delayed. Confirmations will be sent automatically when it recovers.', fr: "L'envoi des courriels est retardé. Les confirmations seront envoyées automatiquement à son rétablissement." },
  mailDelayedLine: { en: 'Email is delayed. It will be sent automatically when our mail service returns.', fr: 'Le courriel est retardé. Il sera envoyé automatiquement au retour de notre service de courriel.' },
  confirmationLine: { en: "We'll email your confirmation to", fr: 'Nous enverrons votre confirmation à' },
  stepupSent: { en: 'We sent a 6-digit code to', fr: 'Nous avons envoyé un code à 6 chiffres à' },
  verified: { en: 'Verified.', fr: 'Vérifié.' },
  required: { en: 'Required.', fr: 'Obligatoire.' },
  badEmail: { en: 'Enter a valid email address.', fr: 'Entrez une adresse courriel valide.' },
  lengthMsg: { en: 'Use', fr: 'Utilisez de' },
  lengthTo: { en: 'to', fr: 'à' },
  lengthChars: { en: 'characters.', fr: 'caractères.' },
  chooseListed: { en: 'Choose one of the listed options.', fr: "Choisissez l'une des options proposées." },
  seatCount: { en: 'Choose 1 to 10 seats.', fr: 'Choisissez de 1 à 10 places.' },
  groupSeatCount: { en: 'Choose 10 to 40 seats for a group.', fr: 'Choisissez de 10 à 40 places pour un groupe.' },
  fareNotAvailable: { en: "This fare isn't available for this seat.", fr: "Ce tarif n'est pas offert pour cette place." },
  upliftRange: { en: 'Enter an uplift between $1.00 and $500.00.', fr: 'Entrez une contribution entre 1,00 $ et 500,00 $.' },
  creditRange: { en: 'Enter a credit between $1.00 and $500.00.', fr: 'Entrez un crédit entre 1,00 $ et 500,00 $.' },
  splitMsg: { en: 'Payer seats must add up to', fr: 'Les places des payeurs doivent totaliser' },
  badDate: { en: 'Enter a valid date.', fr: 'Entrez une date valide.' },
  retryKeyRequired: { en: 'A retry key is required.', fr: 'Une clé de reprise est requise.' },
} as const;

export type CopyKey = keyof typeof copy;

export function t(key: CopyKey, locale: Locale): string {
  return copy[key][locale];
}
