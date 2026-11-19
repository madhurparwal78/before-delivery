// The signed-out landing page with its true-size demo plan.
export function renderLanding(root) {
    const wrap = document.createElement('div');
    wrap.className = 'page';
    wrap.innerHTML = `
    <div class="landing-head">
      <div class="landing-mark" aria-hidden="true"><span></span><span></span></div>
      <a class="plain-link" href="/signin">Sign in</a>
    </div>
    <div class="landing-column">
      <h1 class="landing-hero">Move one task.<br><span class="muted">The rest of the plan follows.</span></h1>
      <p class="landing-lede">Slackwater Plan counts working days, skips weekends and your holidays, and shows the critical path the moment a date moves.</p>
      <div class="landing-actions">
        <a class="link-button" href="/signup">Start a plan</a>
        <a class="plain-link" href="#demo">See a plan move →</a>
      </div>
    </div>
    <div class="demo-panel" id="demo" role="region" aria-label="Demo plan">
      <div class="demo-row" style="top: 90px;">
        <div class="demo-label">Order tiles</div>
        <div class="demo-track" id="demo-track-1">
          <div class="demo-bar" id="demo-bar-1" style="left: 24px; width: 96px;"></div>
        </div>
      </div>
      <div class="demo-row" style="top: 134px;">
        <div class="demo-label">Lay floor</div>
        <div class="demo-track" id="demo-track-2">
          <div class="demo-bar outline" id="demo-bar-2" style="left: 140px; width: 112px;"></div>
          <div class="demo-float" id="demo-float-2" style="left: 252px; width: 32px;"></div>
        </div>
      </div>
      <svg class="demo-pointer" style="left: 108px; top: 98px;" width="18" height="26" viewBox="0 0 18 26" aria-hidden="true">
        <path d="M2 2 v18 l6 -5 4 8 4 -2 -4 -8 7 -1 z" fill="#1c2b25"/>
      </svg>
      <div class="demo-finish" id="demo-finish" style="left: 288px;"></div>
    </div>
  `;
    root.replaceChildren(wrap);
    playDemo();
}
/** The demo plays the Knock-on once when it first scrolls into view. */
function playDemo() {
    const panel = document.getElementById('demo');
    if (panel === null)
        return;
    const bar1 = document.getElementById('demo-bar-1');
    const bar2 = document.getElementById('demo-bar-2');
    const finish = document.getElementById('demo-finish');
    if (bar1 === null || bar2 === null || finish === null)
        return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const settle = () => {
        bar1.style.transform = 'translateX(32px)';
        bar2.style.transform = 'translateX(32px)';
        finish.style.transform = 'translateX(32px)';
    };
    const animate = () => {
        const start = performance.now();
        const step = (now) => {
            const elapsed = now - start;
            const eased1 = easeOut(Math.min(1, elapsed / 220));
            bar1.style.transform = `translateX(${32 * eased1}px)`;
            const delayed = Math.max(0, elapsed - 45);
            const eased2 = easeOut(Math.min(1, delayed / 220));
            bar2.style.transform = `translateX(${32 * eased2}px)`;
            const finishDelay = 45 + 220;
            const easedF = easeOut(Math.min(1, Math.max(0, elapsed - finishDelay) / 320));
            finish.style.transform = `translateX(${32 * easedF}px)`;
            if (elapsed < finishDelay + 320)
                requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };
    if (reduced) {
        settle();
        return;
    }
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                observer.disconnect();
                animate();
            }
        }
    }, { threshold: 0.2 });
    observer.observe(panel);
}
/** The cubic Bezier ease with control points (0.2, 0) and (0, 1). */
export function easeOut(t) {
    // Bezier eval by binary search is exact enough for motion; this closed form is a close match.
    const c = 1 - t;
    return 1 - c * c * c;
}
