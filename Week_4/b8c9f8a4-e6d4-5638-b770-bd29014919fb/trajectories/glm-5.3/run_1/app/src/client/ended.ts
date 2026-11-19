/** Ended and unknown link pages: one dim still and one notice panel. */

export function mountEnded(root: HTMLElement, kind: 'ended' | 'unknown'): void {
  const heading = kind === 'ended' ? 'This link has ended' : 'We could not find that link';
  const body = kind === 'ended' ? 'Ask the owner for a new link.' : 'Check the address the owner gave you.';
  root.innerHTML = `
    <main style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--deep);color:#fff;padding:22px">
      <img src="/stage-still.svg" alt="Facet still of this car" style="width:min(420px,90vw);border-radius:22px;opacity:.5" />
      <div class="notice-panel" style="margin-top:34px;max-width:520px;text-align:center" role="region">
        <h1 style="font-size:1.6rem;margin:0 0 10px">${heading}</h1>
        <p style="margin:0">${body}</p>
      </div>
    </main>`;
  const heading1 = root.querySelector('h1') as HTMLHeadingElement;
  heading1.setAttribute('tabindex', '-1');
  heading1.focus();
}
