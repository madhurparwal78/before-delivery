export type CopyKey =
  | "sign_in_failed"
  | "session_ended"
  | "state_served"
  | "state_not_served"
  | "account_created"
  | "joined_confirmed"
  | "joined_pending"
  | "cadence_changed"
  | "cancel_saved"
  | "payments_unavailable"
  | "draw_booked_staff"
  | "draw_booked_member"
  | "draw_moved"
  | "draw_cancelled"
  | "slot_lost_staff"
  | "slot_lost_member"
  | "plus_required"
  | "changes_closed"
  | "address_required"
  | "visit_page_ended_by_coordinator"
  | "new_visit_page_sent"
  | "visit_page_ended"
  | "address_later"
  | "kit_code_added"
  | "kit_code_wrong_check"
  | "kit_code_wrong_shape"
  | "kit_code_required"
  | "not_draw_day"
  | "marked_collected"
  | "results_preview"
  | "results_saved"
  | "report_store_unavailable"
  | "results_released"
  | "release_not_ready"
  | "ranges_saved"
  | "ranges_already_change"
  | "correction_saved"
  | "correction_arrives"
  | "plan_draft_saved"
  | "plan_published"
  | "newer_plan"
  | "blend_saved"
  | "packet_full_morning"
  | "packet_full_evening"
  | "message_sent"
  | "reply_sent"
  | "thread_handled"
  | "message_rate_limited"
  | "download_rate_limited"
  | "download_started"
  | "account_closing"
  | "account_closing_write"
  | "account_restored"
  | "restore_after_wait"
  | "profile_saved"
  | "password_changed"
  | "not_found"
  | "working_on_it"
  | "email_taken"
  | "already_plus"
  | "not_plus"
  | "already_ending"
  | "same_cadence"
  | "not_booked"
  | "request_key_reused"
  | "already_collected"
  | "report_exists"
  | "not_collected"
  | "not_ready_state"
  | "erasure_started"
  | "not_closing"
  | "attachment_store_unavailable"
  | "owner_stays"
  | "csv_formula_note";

type Template = (params: Record<string, string>) => string;

const t = (pattern: string): Template => (params) => {
  return pattern.replace(/<([a-zA-Z][^<>]*)>/g, (_, key: string) => {
    const trimmed = key.trim();
    return params[trimmed] ?? params[key] ?? `<${key}>`;
  });
};

export const COPY: Record<CopyKey, Template> = {
  sign_in_failed: t("That email and password don't match."),
  session_ended: t("Your session ended. Sign in again to keep going — what you typed is still here."),
  state_served: t("Yes — we serve members in <State name>."),
  state_not_served: t("Not yet — we can't serve members in <State name>."),
  account_created: t("Your free account is ready."),
  joined_confirmed: t("Welcome to Plus. Your membership is active."),
  joined_pending: t("Your payment is being confirmed. Plus shows Active once it is."),
  cadence_changed: t("Your cadence changes at your next renewal."),
  cancel_saved: t("Plus stays until the end of your paid period."),
  payments_unavailable: t("Payments are unavailable right now. Nothing was charged."),
  draw_booked_staff: t("Draw booked for <date>, <phoenixTime> Phoenix time · <localTime> <city> time."),
  draw_booked_member: t("Draw booked for <date>, <localTime> <city> time."),
  draw_moved: t("Draw moved to <date>, <localTime> <city> time."),
  draw_cancelled: t("Draw cancelled."),
  slot_lost_staff: t("That slot was just taken by <winner>. The next free slot is <date>, <localTime> <city> time."),
  slot_lost_member: t("That slot was just taken. The next free slot is <date>, <localTime> <city> time."),
  plus_required: t("Draws are part of Plus."),
  changes_closed: t("Changes closed at <date>, 18:00 <city> time. Message your care team to change this draw."),
  address_required: t("Add your home address before booking a draw."),
  visit_page_ended_by_coordinator: t("Visit page ended."),
  new_visit_page_sent: t("A new visit page is on its way to <phlebotomist>."),
  visit_page_ended: t("This visit page has ended."),
  address_later: t("Address shown on the visit day."),
  kit_code_added: t("Kit code <kit code> added."),
  kit_code_wrong_check: t("That kit code isn't valid. Check the last character."),
  kit_code_wrong_shape: t("Enter a kit code like KT-1000042-7."),
  kit_code_required: t("Enter at least one kit code before marking collected."),
  not_draw_day: t("You can mark this draw collected on the visit day."),
  marked_collected: t("Marked collected at <HH:MM> <city> time."),
  results_preview: t("<m> matched, <u> unknown, <r> refused. Nothing is saved yet."),
  results_saved: t("Results saved and the report is stored."),
  report_store_unavailable: t("The report store is unavailable right now. Nothing was saved."),
  results_released: t("Results released. A notice is on its way to <first name>."),
  release_not_ready: t("Results can be released once the report is stored."),
  ranges_saved: t("New ranges for <marker> take effect on <date>."),
  ranges_already_change: t("Ranges for <marker> already change on <date>."),
  correction_saved: t("<marker> corrected."),
  correction_arrives: t("<name> corrected <marker> at <HH:MM> <city> time. The band shows the corrected value."),
  plan_draft_saved: t("Draft saved."),
  plan_published: t("Plan published."),
  newer_plan: t("<name> published a newer plan at <HH:MM> Phoenix time. Your changes are still here."),
  blend_saved: t("Blend saved."),
  packet_full_morning: t("The morning packet holds at most 4 capsules."),
  packet_full_evening: t("The evening packet holds at most 4 capsules."),
  message_sent: t("Message sent."),
  reply_sent: t("Reply sent."),
  thread_handled: t("Thread marked handled."),
  message_rate_limited: t("Too many messages for now. You can send another at <HH:MM> <city> time."),
  download_rate_limited: t("Too many downloads for now. You can download again at <HH:MM> <city> time."),
  download_started: t("Your results history is downloading."),
  account_closing: t("Your account is closing. It will be erased at <date>, <HH:MM> <city> time unless the practice brings it back."),
  account_closing_write: t("This account is closing."),
  account_restored: t("<member name>'s account is back."),
  restore_after_wait: t("This account is already being erased."),
  profile_saved: t("Profile saved."),
  password_changed: t("Password changed. Your other sessions have ended."),
  not_found: t("We can't find that page."),
  working_on_it: t("Working on it."),
  email_taken: t("An account with this email already exists."),
  already_plus: t("You already have Plus."),
  not_plus: t("You don't have Plus."),
  already_ending: t("Plus is already set to end."),
  same_cadence: t("You're already on that cadence."),
  not_booked: t("Only a booked draw can change."),
  request_key_reused: t("This request key was already used for a different request."),
  already_collected: t("This draw is already collected."),
  report_exists: t("This draw already has a different report."),
  not_collected: t("Results can be brought in for a collected draw."),
  not_ready_state: t("Results can be released once the report is stored."),
  erasure_started: t("This account is already being erased."),
  not_closing: t("This account isn't closing."),
  attachment_store_unavailable: t("Attachments can't be stored right now. Nothing was sent."),
  owner_stays: t("The practice owner stays the owner."),
  csv_formula_note: t(""),
};

/** Render a copy template with the given params. */
export function copy(key: CopyKey, params: Record<string, string> = {}): string {
  return COPY[key](params);
}

export const FIELD_ERRORS = {
  name: "Enter your full name.",
  email: "Enter a valid email address.",
  emailTaken: "An account with this email already exists.",
  passwordShort: "Use at least 12 characters.",
  dateOfBirth: "Members must be 18 or older.",
  dateOfBirthFormat: "Enter the date as YYYY-MM-DD.",
  state: "Not yet — we can't serve members in <State name>.",
  chooseOption: "Choose one of the options.",
  postalCode: "Enter a 5-digit ZIP code.",
  dateRange400: "Choose a date within 400 days of today.",
  dateRange28: "Choose a date from tomorrow up to 28 days ahead.",
  slotTimes: "Choose a slot from the published times.",
  phlebotomistState: "This phlebotomist doesn't serve <State name>.",
  collectedAt: "Give the collected time for a past draw.",
  collectedAtDay: "Give the collected time for a past draw.",
  kitCode: "Enter a kit code like KT-1000042-7.",
  monthFormat: "Choose a month as YYYY-MM.",
  cursorInvalid: "That page link is no longer valid.",
  fileHeader: "The first row must be kitCode,marker,value,unit.",
  fileUtf8: "The results file must be UTF-8 text.",
  reportRequired: "Attach the lab's report PDF.",
  reportPdf: "The report must be a PDF file.",
  markerChoice: "Choose a marker from the catalog.",
  valueNumber: "Value isn't a number.",
  capsulesWhole: "Use a whole number of capsules, 1 or more.",
  ingredientChoice: "Choose an ingredient from the catalog.",
  ingredientOnce: "Each ingredient appears once.",
  attachmentKind: "Attach a PDF, JPEG or PNG file.",
  bodyRequired: "Write a message first.",
  bodyTooLong: "Keep your message to 2,000 characters.",
  sectionTooLong: "Keep each section to 20,000 characters.",
  rangesAllSix: "Give all six rows.",
  rangesBounds: "Bounds must run low ≤ optimal low ≤ optimal high ≤ high.",
  rangesDate: "Choose today or a later date.",
  currentPassword: "That password isn't right.",
} as const;
