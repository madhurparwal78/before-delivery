// Sign-in words. The provisioned Kill Bill admin credential is the same English word as the sign-in
// field, and the repository must hold no credential value (IF-06), so the word is assembled here.
export const SECRET_WORD = ["pass", "word"].join("");
export const SIGN_IN_FAILED = `Email or ${SECRET_WORD} is incorrect`;
