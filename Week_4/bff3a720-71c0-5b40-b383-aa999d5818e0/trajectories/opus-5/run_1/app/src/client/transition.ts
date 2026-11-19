let shutterPending = false;

/** Opening a ride from the results runs the shutter reveal on the ride's large plate. */
export function armShutter(): void {
  shutterPending = true;
}

export function takeShutter(): boolean {
  const armed = shutterPending;
  shutterPending = false;
  return armed;
}
