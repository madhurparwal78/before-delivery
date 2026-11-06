/** Published copy, exactly as printed in the brief. */

export function results_count(n: number): string {
  return n === 1 ? '1 fitting' : `${n} fittings`
}

export function variant_announcement(product_name: string, finish: string, beam: number, cct: number, lumens: number, price: string): string {
  return `${product_name}, ${finish}, ${beam}° beam, ${cct}K: ${lumens} lumens, $${price} + GST.`
}

export function added_to_cart(qty: number, subtotal: string): string {
  return `Added ${qty} to cart. Cart total $${subtotal} + GST.`
}

export const COMPARE_FULL = 'You can compare up to four fittings.'
export const COMPARE_ADDED = 'Added to comparison.'
export const FAV_SAVED = 'Saved to favourites.'
export const FAV_REMOVED = 'Removed from favourites.'
export const FAV_SIGNIN = 'Sign in to save favourites.'
export const CARD_DECLINED_HEADING = 'Card declined'
export const CARD_DECLINED_BODY = 'Your bank declined this card. No money has been taken. Try another card or contact your bank.'
export const PAYMENT_OUTAGE_HEADING = 'Payment service unavailable'
export const PAYMENT_OUTAGE_BODY = "We couldn't reach our payment service. Your order is saved and you will only be charged once. Try again in a few minutes."
export const SOLD_OUT_HEADING = 'Sold out while you were checking out'
export function sold_out_body(product_name: string): string {
  return `Someone else bought the last units of ${product_name}. Your card has not been charged.`
}
export const ORDER_CONFIRMED = 'Order confirmed'
export function order_confirmed_body(order_key: string, email: string): string {
  return `Order ${order_key} is confirmed. A receipt is on its way to ${email}.`
}
export const ORDER_PLACED = 'Order placed'
export function order_placed_body(order_key: string, email: string): string {
  return `Order ${order_key} is on your monthly account. A confirmation is on its way to ${email}.`
}
export const SIGNIN_INVALID = 'Email or password is incorrect.'
export const EMAIL_TAKEN = 'An account with this email already exists.'
export const NZBN_INVALID = 'Enter a 13-digit NZBN starting with 94.'
export const PASSWORD_SHORT = 'Use at least 10 characters.'
export const TRADE_PENDING = "Your trade application is with our team. You'll see trade prices once it's approved."
export const TRADE_DECLINED = 'Your trade application was declined. You can still shop at retail prices.'
export const PROJECT_CREATED = 'Project created.'
export function added_to_project(qty: number, code: string, name: string): string {
  return `Added ${qty} × ${code} to ${name}.`
}
export const CEILING_RANGE = 'Ceiling height must be between 2400 and 4000 mm.'
export const COVER_UPLOADING = 'Uploading cover'
export const COVER_READY = 'Cover ready.'
export const COVER_INVALID = 'Choose a JPEG, PNG or WebP image up to 5,000,000 bytes.'
export const COVER_OUTAGE = 'File storage is unavailable. Your cover was not saved; try again shortly.'
export const SPEC_SHEET_PENDING = 'Preparing spec sheet'
export const SPEC_SHEET_OUTAGE = 'Spec sheet unavailable right now. Try again shortly.'
export function placed_announcement(code: string, x: number, y: number, diameter: number, lux: number): string {
  return `${code} placed at ${x} mm, ${y} mm. Pool ${diameter} mm, ${lux} lux.`
}
export function moved_announcement(code: string, x: number, y: number): string {
  return `${code} moved to ${x} mm, ${y} mm.`
}
export function removed_announcement(code: string): string {
  return `${code} removed.`
}
export function all_placed(code: string): string {
  return `All ${code} fittings are already placed.`
}
export const COLLAB_BACK = 'Live collaboration is back.'
export const COLLAB_PAUSED = 'Live collaboration paused. Your changes are saved and will sync when it reconnects.'
export const COMMENT_TOO_LONG = 'Comments can be up to 2,000 characters.'
export const COMMENT_OUTAGE = 'Comments are unavailable while live collaboration is paused.'
export const COMMENT_POSTED = 'Comment posted.'
export function invited(name: string): string {
  return `${name} can now work on this project.`
}
export const NOT_TRADE_ACCOUNT = 'That email is not an approved trade account.'
export function share_queued(n: number): string {
  return `Quote queued for ${n} recipients. Emails go out as soon as the PDF is ready.`
}
export const RECIPIENTS_INVALID = 'Add between 1 and 10 valid email addresses.'
export function approved_copy(business: string): string {
  return `Approved ${business}.`
}
export function declined_copy(business: string): string {
  return `Declined ${business}.`
}
export const ALREADY_DECIDED = 'This application has already been decided.'
export const CANNOT_DISPATCH = "This order can't be dispatched in its current state."
export function captured_copy(order_key: string): string {
  return `Payment captured. Order ${order_key} is Paid.`
}
export function invoiced_copy(invoice_number: string, order_key: string): string {
  return `Invoice ${invoice_number} raised for ${order_key}.`
}
export const KILLBILL_OUTAGE = (order_key: string): string => `Kill Bill is unavailable. Order ${order_key} is unchanged; try again shortly.`
export function refunded_copy(amount: string, order_key: string): string {
  return `Refunded $${amount} on ${order_key}.`
}
export function exceeds_refundable(refundable: string): string {
  return `More than the $${refundable} still refundable.`
}
export function payment_recorded(order_key: string): string {
  return `Payment recorded. Order ${order_key} is Paid.`
}
export const MUST_EQUAL_INVOICE = 'The amount must equal the invoice total.'
export function stock_now(code: string, n: number): string {
  return `Stock for ${code} is now ${n}.`
}
export const STOCK_BELOW_ZERO = "Stock can't go below zero."
export function newsletter_pending(email: string): string {
  return `Check your inbox. We've sent a confirmation link to ${email}.`
}
export const NEWSLETTER_CONSENT = 'Tick the box to agree to the newsletter.'
export const NEWSLETTER_INVALID_EMAIL = 'Enter a valid email address.'
export const NEWSLETTER_CONFIRMED = "You're subscribed"
export const NEWSLETTER_INVALID_TOKEN = "That confirmation link isn't valid."
export const FIELD_ERRORS: Record<string, string> = {
  'card.number': 'Enter a valid card number.',
  'card.expiry': 'Enter an expiry date in the future.',
  'card.cvc': 'Enter the 3-digit security code.',
  'card.name': 'This field is required.',
  'delivery.name': 'This field is required.',
  'delivery.address': 'This field is required.',
  'delivery.city': 'This field is required.',
  'delivery.postcode': 'This field is required.',
}
export function stock_left(n: number): string {
  return `Only ${n} left`
}
export const SOLD_OUT = 'Sold out'
