let eventFocus: string | null = null;

/** Carries "focus this event's Enter button" across a navigation. */
export function requestEventFocus(eventId: string): void {
  eventFocus = eventId;
}

export function takeEventFocus(): string | null {
  const wanted = eventFocus;
  eventFocus = null;
  return wanted;
}

let garageLinkFocus = false;

/** Carries "focus the Garage page link" across a navigation. */
export function requestGarageLinkFocus(): void {
  garageLinkFocus = true;
}

export function takeGarageLinkFocus(): boolean {
  const wanted = garageLinkFocus;
  garageLinkFocus = false;
  return wanted;
}
