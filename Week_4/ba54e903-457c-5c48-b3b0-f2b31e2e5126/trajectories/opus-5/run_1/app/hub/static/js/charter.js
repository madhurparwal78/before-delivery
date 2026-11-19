// Teen charter cards turn on click, Enter and Space.

for (const card of document.querySelectorAll('.charter-card')) {
  card.addEventListener('click', () => {
    const turned = card.getAttribute('aria-pressed') === 'true';
    card.setAttribute('aria-pressed', turned ? 'false' : 'true');
  });
}
