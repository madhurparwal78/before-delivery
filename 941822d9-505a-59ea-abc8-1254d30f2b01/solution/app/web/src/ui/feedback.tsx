import { createContext, useContext, type ReactNode } from "react";
import { ApiFailure, NetworkFailure } from "../api";
import { Icon } from "./icons";

// Pending and success copy goes to the Activity status region; outage and conflict copy to an alert.

export interface Feedback {
  announce: (text: string) => void;
  showAlert: (text: string | null) => void;
}

export const FeedbackContext = createContext<Feedback>({ announce: () => undefined, showAlert: () => undefined });
export const useFeedback = (): Feedback => useContext(FeedbackContext);

export const NETWORK_COPY = "We couldn't reach Credwell. Check your connection and try again.";
export const WITHDRAWN_COPY = "This course is no longer open for enrolment.";
const UNEXPECTED_COPY = "Something went wrong on our side. Nothing was changed; please try again.";

interface FailureCopy {
  alert: string | null;
  fields: Record<string, string>;
}

/** Maps a failed request to the brief's copy: field errors for 422, the row's copy for each error code. */
export function describeFailure(error: unknown, copies: Record<string, string> = {}): FailureCopy {
  if (error instanceof NetworkFailure) return { alert: NETWORK_COPY, fields: {} };
  if (error instanceof ApiFailure) {
    if (error.status === 422) return { alert: null, fields: error.fields };
    return { alert: copies[error.code] ?? (error.status === 404 ? "That record could not be found." : UNEXPECTED_COPY), fields: {} };
  }
  return { alert: UNEXPECTED_COPY, fields: {} };
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="alert">
      <Icon name="warning" />
      <div>{children}</div>
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="field-error">
      <Icon name="warning" size={16} />
      {message}
    </p>
  );
}
