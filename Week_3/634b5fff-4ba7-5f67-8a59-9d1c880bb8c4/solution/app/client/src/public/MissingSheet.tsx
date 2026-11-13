import { ERRORS } from "../../../shared/copy.js";
import { Link } from "../router.js";
import { PublicSheet } from "./PublicSheet.js";

export const MissingSheet = () => (
  <PublicSheet>
    <h1>{ERRORS.not_found.message()}</h1>
    <p><Link href="/shelf">Back to the shelf</Link></p>
  </PublicSheet>
);
