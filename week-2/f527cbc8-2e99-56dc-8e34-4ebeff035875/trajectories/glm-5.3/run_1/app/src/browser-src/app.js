// App bootstrap and route rendering.

const app = document.getElementById('app');

async function render() {
  const path = location.pathname;
  closeAllStreams();
  app.textContent = '';
  if (path.startsWith('/vet/')) {
    renderShell(app, path);
    await renderVetPage(path);
    return;
  }
  if (path === '/sign-in' || !state.me) {
    const meRes = await api.get('/api/me');
    if (meRes.status !== 200) {
      const target = path.startsWith('/') && !path.startsWith('//') ? location.pathname + location.search : '/';
      sessionStorage.setItem('return-to', target);
      renderSignIn();
      return;
    }
    state.me = meRes.data;
  }
  renderShell(app, path);
  await loadShell();
  noticesRegion();
  if (path === '/' || path === '') {
    const days = await api.get('/api/barn-days');
    if ((days.data || []).length > 0) {
      history.replaceState({}, '', `/days/${days.data[0].id}`);
      return render();
    }
    state.dom.main.append(el('p', { text: '' }));
  } else if (path.startsWith('/days/')) {
    await renderDay(path.slice('/days/'.length));
  } else if (path.startsWith('/horses/')) {
    await renderHorse(path.slice('/horses/'.length).split('?')[0]);
  } else if (path === '/horses') {
    await renderHorses();
  } else if (path === '/invoices') {
    await renderInvoices();
  } else if (path === '/prices') {
    await renderPrices();
  } else if (path === '/dashboard') {
    await renderDashboard();
  } else {
    state.dom.main.append(el('p', { text: "This isn't available." }));
  }
}

function renderSignIn() {
  document.body.className = '';
  app.textContent = '';
  const form = el('form', { 'aria-label': 'Sign in', style: 'max-width:380px;margin:12vh auto;display:grid;gap:12px' });
  form.append(
    el('h1', { class: 'wordmark', text: 'Rasp & Rein Clinchline' }),
    el('label', { text: 'Email' }, el('input', { type: 'email', name: 'email', 'aria-label': 'Email', required: true })),
    el('label', { text: 'Password' }, el('input', { type: 'password', name: 'password', 'aria-label': 'Password', required: true })),
    el('button', { class: 'primary', type: 'submit' }, 'Sign in')
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    setNotices('Signing in…');
    const email = form.querySelector('[name=email]').value;
    const password = form.querySelector('[name=password]').value;
    const res = await api.post('/api/session', { email, password });
    if (res.status === 200) {
      const back = sessionStorage.getItem('return-to');
      sessionStorage.removeItem('return-to');
      history.replaceState({}, '', back && back.startsWith('/') && !back.startsWith('//') ? back : '/');
      location.reload();
    } else {
      btn.disabled = false;
      announce('Email or password is wrong.');
    }
  });
  app.append(form, el('div', { role: 'status', 'aria-label': 'Notices', id: 'notices', class: 'notices' }));
}

window.addEventListener('popstate', () => render());

render();
