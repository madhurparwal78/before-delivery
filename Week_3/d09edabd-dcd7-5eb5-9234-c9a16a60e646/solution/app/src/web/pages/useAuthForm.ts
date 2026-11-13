import { useState, type FormEvent } from 'react';
import { ApiFailure, post } from '../api';
import { navigate } from '../nav';

/** Messages by field name; `form` is for a refusal that belongs to the whole form. */
type FieldErrors = Record<string, string>;

const TRY_AGAIN = "That didn't go through. Try again.";

const REFUSALS: Record<string, FieldErrors> = {
  invalid_credentials: { form: "That email and password don't match." },
  email_taken: { email: 'That email already has a bench.' },
};

async function send(path: string, body: object): Promise<FieldErrors | null> {
  try {
    await post(path, body);
    return null;
  } catch (error) {
    if (!(error instanceof ApiFailure)) return { form: TRY_AGAIN };
    if (error.code === 'validation') return error.fieldErrors;
    return REFUSALS[error.code] ?? { form: TRY_AGAIN };
  }
}

/** Posts a sign-in or sign-up form and lands on the editor; a refusal comes back as messages for the form's fields. */
export function useAuthForm(path: '/api/auth/login' | '/api/auth/signup') {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    const refused = await send(path, Object.fromEntries(new FormData(event.currentTarget)));
    if (refused) {
      setErrors(refused);
      setBusy(false);
    } else {
      navigate('/app');
    }
  };

  return { errors, busy, submit };
}
