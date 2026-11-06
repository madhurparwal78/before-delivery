(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const menuButtons = Array.from(document.querySelectorAll('[data-menu-button]'));

  function panelOf(button) {
    return document.getElementById(button.getAttribute('aria-controls'));
  }

  function closeMenus(except) {
    for (const button of menuButtons) {
      if (button === except) continue;
      button.setAttribute('aria-expanded', 'false');
      panelOf(button).hidden = true;
    }
  }

  for (const button of menuButtons) {
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') === 'true';
      closeMenus(button);
      button.setAttribute('aria-expanded', open ? 'false' : 'true');
      panelOf(button).hidden = open;
    });
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.menu-holder')) closeMenus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = menuButtons.find((button) => button.getAttribute('aria-expanded') === 'true');
    if (!open) return;
    closeMenus();
    open.focus();
  });

  const sheetButton = document.querySelector('[data-sheet-button]');
  const sheet = document.querySelector('[data-sheet]');
  if (sheetButton && sheet) {
    sheetButton.addEventListener('click', () => {
      const open = sheet.getAttribute('data-open') === 'true';
      sheet.setAttribute('data-open', open ? 'false' : 'true');
      sheetButton.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
    sheet.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      sheet.setAttribute('data-open', 'false');
      sheetButton.setAttribute('aria-expanded', 'false');
      sheetButton.focus();
    });
  }

  const sections = Array.from(document.querySelectorAll('.reveal'));
  if (reducedMotion || !('IntersectionObserver' in window)) {
    for (const section of sections) section.classList.add('shown');
  } else {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('shown');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.2 });
    for (const section of sections) observer.observe(section);
  }

  if (!reducedMotion) {
    const headings = Array.from(document.querySelectorAll('h1.display, h2.display, .hero .lead'));
    for (const heading of headings) {
      let index = 0;
      const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const words = node.textContent.split(/(\s+)/);
        const fragment = document.createDocumentFragment();
        for (const word of words) {
          if (!word.trim()) {
            fragment.appendChild(document.createTextNode(word));
            continue;
          }
          const span = document.createElement('span');
          span.className = 'blur-word';
          span.style.animationDelay = `${index * 0.05}s`;
          span.textContent = word;
          fragment.appendChild(span);
          index += 1;
        }
        node.parentNode.replaceChild(fragment, node);
      }
    }
  }
})();
