// Accounts on every page: shows who's logged in, and runs the login / signup forms.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, payload) {
    const res = await fetch(path, {
      method: payload ? 'POST' : 'GET',
      headers: payload ? { 'Content-Type': 'application/json' } : {},
      body: payload ? JSON.stringify(payload) : undefined,
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // Other scripts can wait on this: window.csfUser.then((user) => …)
  window.csfUser = api('/api/me').then((d) => d.user).catch(() => null);

  function renderNav(user) {
    for (const el of document.querySelectorAll('[data-account]')) {
      if (user) {
        el.innerHTML = `<span class="who" title="${esc(user.email)}">${esc(user.name || user.email)}</span>
          ${user.isPro ? '<span class="pro-badge">PRO</span>' : '<a class="upgrade" href="/#pricing">Go Pro</a>'}
          <button type="button" class="link-btn" data-logout>Log out</button>`;
        el.querySelector('[data-logout]').onclick = async () => {
          try { await api('/api/logout', {}); } catch { /* ignore */ }
          location.href = '/';
        };
      } else {
        const next = encodeURIComponent(location.pathname + location.search + location.hash);
        el.innerHTML = `<a href="/login?next=${next}">Log in</a> <a class="btn-small" href="/signup?next=${next}">Sign up</a>`;
      }
    }
  }
  window.csfUser.then(renderNav);

  // ---------- Login / signup forms (form[data-auth="login" | "signup"]) ----------
  const form = document.querySelector('form[data-auth]');
  if (!form) return;
  const kind = form.dataset.auth;
  const msg = form.querySelector('.form-msg');
  const button = form.querySelector('button[type="submit"]');
  const params = new URLSearchParams(location.search);
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';

  // Carry ?next= across the "Already have an account? / Need an account?" links
  for (const a of document.querySelectorAll('[data-keep-next]')) {
    if (next) a.href += `?next=${encodeURIComponent(safeNext)}`;
  }

  // Already logged in? Skip the form.
  window.csfUser.then((u) => {
    if (u) msg.innerHTML = `You're logged in as <b>${esc(u.email)}</b>. <a href="${esc(safeNext)}">Continue →</a>`;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (kind === 'signup' && data.password !== data.confirm) {
      msg.textContent = 'The passwords don’t match.';
      msg.classList.add('error');
      return;
    }
    button.disabled = true;
    msg.classList.remove('error');
    msg.textContent = kind === 'signup' ? 'Creating your account…' : 'Logging in…';
    try {
      await api(`/api/${kind}`, { email: data.email, password: data.password, name: data.name });
      location.href = safeNext;
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('error');
      button.disabled = false;
    }
  });
})();
