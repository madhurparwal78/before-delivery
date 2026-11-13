import type { AddressFields as Fields } from "../../shared/api";
import { TextField, fieldId } from "./Fields";

const STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

export const EMPTY_ADDRESS: Fields = { name: "", line1: "", line2: "", city: "", state: "", postcode: "", phone: "" };

/** The field order an error summary and first-invalid focus follow. */
export const ADDRESS_KEYS = ["name", "line1", "line2", "city", "state", "postcode", "phone"] as const;

interface Props {
  prefix: string;
  value: Fields;
  onChange: (value: Fields) => void;
  errors: Record<string, string>;
}

/** The delivery address fields; `prefix` is the API key prefix (`address.` in checkout, empty for saved addresses). */
export function AddressFieldset({ prefix, value, onChange, errors }: Props) {
  const set = (key: keyof Fields) => (text: string) => onChange({ ...value, [key]: text });
  const err = (key: keyof Fields) => errors[`${prefix}${key}`];
  const stateKey = `${prefix}state`;
  const stateError = errors[stateKey];
  return (
    <>
      <TextField name={`${prefix}name`} label="Full name" autoComplete="name" value={value.name} onChange={set("name")} error={err("name")} />
      <TextField name={`${prefix}line1`} label="Address line 1" autoComplete="address-line1" value={value.line1} onChange={set("line1")} error={err("line1")} />
      <TextField name={`${prefix}line2`} label="Address line 2" autoComplete="address-line2" value={value.line2} onChange={set("line2")} error={err("line2")} />
      <TextField name={`${prefix}city`} label="Town or city" autoComplete="address-level2" value={value.city} onChange={set("city")} error={err("city")} />
      <div className="field">
        <label htmlFor={fieldId(stateKey)}>State</label>
        <select
          id={fieldId(stateKey)}
          value={value.state}
          aria-describedby={stateError ? `${fieldId(stateKey)}-error` : undefined}
          aria-invalid={stateError ? true : undefined}
          onChange={(event) => set("state")(event.target.value)}
        >
          <option value="">Select a state</option>
          {STATES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
        {stateError && (
          <p className="field-error" id={`${fieldId(stateKey)}-error`}>
            {stateError}
          </p>
        )}
      </div>
      <TextField name={`${prefix}postcode`} label="PIN code" inputMode="numeric" autoComplete="postal-code" value={value.postcode} onChange={set("postcode")} error={err("postcode")} />
      <TextField name={`${prefix}phone`} label="Mobile number" type="tel" autoComplete="tel" inputMode="numeric" value={value.phone} onChange={set("phone")} error={err("phone")} />
    </>
  );
}
