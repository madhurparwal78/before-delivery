(() => {
  const preview = document.querySelector('[data-hero-preview]');
  if (!preview) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const fill = preview.querySelector('[data-preview-fill]');
  const progress = preview.querySelector('[data-preview-progress]');
  const badge = preview.querySelector('[data-preview-badge]');
  const dots = preview.querySelector('[data-preview-dots]');

  function update() {
    const offset = Math.min(400, Math.max(0, window.scrollY));
    fill.style.width = `${50 + (offset / 400) * 50}%`;
    const complete = offset > 200;
    const text = complete ? '2 of 2 approvals' : '1 of 2 approvals';
    progress.textContent = text;
    progress.setAttribute('aria-valuenow', complete ? '2' : '1');
    progress.setAttribute('aria-valuetext', text);
    badge.textContent = complete ? 'executed' : 'pending_approval';
    badge.className = `badge badge-${complete ? 'executed' : 'pending_approval'}`;
    const second = dots.querySelector('[data-second-dot]');
    if (complete && !second) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.setAttribute('data-second-dot', '');
      dot.textContent = 'BO';
      dots.appendChild(dot);
    } else if (!complete && second) {
      second.remove();
    }
  }

  window.addEventListener('scroll', update, { passive: true });
  update();
})();
