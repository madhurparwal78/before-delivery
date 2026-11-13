import { FIELD_ERRORS, type FieldName } from "../../../shared/copy.js";
import { MAX_GIFT_MESSAGE } from "../../../shared/domain.js";

/** The checkout form and the rules the server applies to it, so a mistake is caught before the bank is asked. */

export interface CheckoutForm {
  name: string;
  email: string;
  street: string;
  postcode: string;
  city: string;
  gift: boolean;
  recipientName: string;
  recipientEmail: string;
  message: string;
  method: "card" | "bank";
  cardNumber: string;
  expiry: string;
  cvc: string;
}

export const EMPTY_FORM: CheckoutForm = {
  name: "", email: "", street: "", postcode: "", city: "", gift: false, recipientName: "", recipientEmail: "", message: "",
  method: "card", cardNumber: "", expiry: "", cvc: "",
};

export type FieldErrors = Partial<Record<FieldName, string>>;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const HEADER_UNSAFE = /[\r\n\0\u0085\u2028\u2029]/;

/** What the card number is once spaces are taken out. */
export const digitsOf = (cardNumber: string): string => cardNumber.replace(/\s+/g, "");

export const validate = (form: CheckoutForm): FieldErrors => {
  const errors: FieldErrors = {};
  const flag = (field: FieldName, bad: boolean): void => {
    if (bad) errors[field] = FIELD_ERRORS[field];
  };
  flag("buyer.name", form.name.trim() === "" || HEADER_UNSAFE.test(form.name));
  flag("buyer.email", !EMAIL.test(form.email.trim()) || HEADER_UNSAFE.test(form.email));
  flag("address.street", form.street.trim() === "");
  flag("address.postcode", !/^\d{4}$/.test(form.postcode.trim()));
  flag("address.city", form.city.trim() === "");
  if (form.gift) {
    flag("gift.recipientName", form.recipientName.trim() === "" || HEADER_UNSAFE.test(form.recipientName));
    flag("gift.recipientEmail", !EMAIL.test(form.recipientEmail.trim()));
    flag("gift.message", form.message.length > MAX_GIFT_MESSAGE);
  }
  if (form.method === "card") {
    flag("card.number", !/^\d{16}$/.test(digitsOf(form.cardNumber)));
    flag("card.expiry", !/^(0[1-9]|1[0-2])\/\d{2}$/.test(form.expiry));
    flag("card.cvc", !/^\d{3}$/.test(form.cvc));
  }
  return errors;
};

/** The request body of a checkout attempt for a held box. */
export const bodyOf = (number: number, form: CheckoutForm): Record<string, unknown> => ({
  number,
  method: form.method,
  buyer: { name: form.name.trim(), email: form.email.trim() },
  address: { street: form.street.trim(), postcode: form.postcode.trim(), city: form.city.trim() },
  gift: form.gift ? { recipientName: form.recipientName.trim(), recipientEmail: form.recipientEmail.trim(), message: form.message } : null,
  ...(form.method === "card" ? { card: { number: digitsOf(form.cardNumber), expiry: form.expiry, cvc: form.cvc } } : {}),
});
