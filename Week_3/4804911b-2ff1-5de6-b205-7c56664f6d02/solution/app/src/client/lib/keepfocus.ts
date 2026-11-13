// A control that is rebuilt when the layout changes (table <-> stacked list) keeps focus: it opts in with data-keep="name".
let last: string | null = null;

export function installKeepFocus(): void {
  document.addEventListener("focusin", (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.("[data-keep]");
    last = el?.getAttribute("data-keep") ?? null;
  });
  document.addEventListener("focusout", (e) => {
    if (!(e.relatedTarget instanceof Element)) return; // focus leaving the page or removed: keep the name for the rebuild
    last = null;
  });
  const restore = () => {
    const name = last;
    if (!name) return;
    setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      document.querySelector<HTMLElement>(`[data-keep="${CSS.escape(name)}"]`)?.focus({ preventScroll: true });
    }, 60);
  };
  for (const q of ["(min-width: 768px)", "(min-width: 1280px)"]) matchMedia(q).addEventListener("change", restore);
}
