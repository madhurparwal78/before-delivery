(() => {
  const buttons = Array.from(document.querySelectorAll('[data-question]'));

  function answerOf(button) {
    return document.getElementById(button.getAttribute('aria-controls'));
  }

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') === 'true';
      for (const other of buttons) {
        other.setAttribute('aria-expanded', 'false');
        answerOf(other).hidden = true;
      }
      button.setAttribute('aria-expanded', open ? 'false' : 'true');
      answerOf(button).hidden = open;
    });
  }
})();
