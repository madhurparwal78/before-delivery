// `region "Instance status"`: slim strip above the header on the ground with a faint dot texture and ONE centred bold white
// sentence. Normal copy `All systems are running.`; during a storage outage the outage copy, and its right quarter warms into
// the rust end of the gradient. It scrolls away with the page.
import { STORAGE_DOWN_COPY, STORAGE_UP_COPY, useInstance } from "../instance.ts";

export function StatusStrip() {
  const { storage } = useInstance();
  return (
    <section aria-label="Instance status" class="sp-strip" data-storage={storage}>
      <p class="sp-strip__text">{storage === "down" ? STORAGE_DOWN_COPY : STORAGE_UP_COPY}</p>
    </section>
  );
}
