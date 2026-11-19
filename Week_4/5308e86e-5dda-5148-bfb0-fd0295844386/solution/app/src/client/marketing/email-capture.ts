/** The hero email field: "Open account" carries the typed email to sign-up. */
export function initEmailCapture(): void {
  for (const form of document.querySelectorAll<HTMLFormElement>("[data-email-capture]")) {
    const input = form.querySelector<HTMLInputElement>("input[name='email']");
    if (!input) continue;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const email = input.value.trim();
      window.location.assign(email === "" ? "/signup" : `/signup?email=${encodeURIComponent(email)}`);
    });
  }
}
