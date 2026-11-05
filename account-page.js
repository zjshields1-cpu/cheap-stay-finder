// The /account page: plan status, Upgrade to Pro (Stripe Checkout), Manage subscription.
(async function () {
  const box = document.getElementById('account');
  const params = new URLSearchParams(location.search);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function post(path) {
    const res = await fetch(path, { method: 'POST', credentials: 'same-origin' });
    let data = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { code: data.code });
    return data;
  }

  let user = await window.csfUser;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/signup?next=${next}`;
    return;
  }

  // Back from Stripe after paying: confirm right away instead of waiting for the webhook
  let banner = '';
  if (params.get('checkout') === 'success' && params.get('session_id')) {
    box.innerHTML = '<h1>Your account</h1><p class="muted"><span class="spinner"></span>Confirming your payment…</p>';
    try {
      const res = await fetch(`/api/checkout-confirm?session_id=${encodeURIComponent(params.get('session_id'))}`, { credentials: 'same-origin' });
      const data = await res.json();
      if (data.user) user = data.user;
      banner = user.isPro
        ? '<p class="notice good">🎉 Payment received. Welcome to <b>Pro</b>! AI trip plans are unlocked.</p>'
        : '<p class="notice">Your payment is still processing. Refresh this page in a minute.</p>';
    } catch {
      banner = '<p class="notice">We couldn’t confirm your payment yet. Refresh this page in a minute.</p>';
    }
    history.replaceState(null, '', '/account');
  } else if (params.get('checkout') === 'canceled') {
    banner = '<p class="notice">Checkout canceled. You haven’t been charged.</p>';
    history.replaceState(null, '', '/account');
  }

  const status = user.subscriptionStatus;
  const planLine = user.isDemo
    ? 'You’re using the <b>demo account</b>, which always has full Pro access.'
    : user.isPro
      ? `You’re on <b>Pro</b> ($7.99/month)${status && status !== 'active' ? ` · subscription status: ${esc(status)}` : ''}.`
      : 'You’re on the <b>Free</b> plan.';

  box.innerHTML = `
    <h1>Your account</h1>
    ${banner}
    <dl class="acct">
      <dt>Email</dt><dd>${esc(user.email)}</dd>
      ${user.name ? `<dt>Name</dt><dd>${esc(user.name)}</dd>` : ''}
      <dt>Plan</dt><dd>${user.isPro ? '<span class="pro-badge">PRO</span>' : 'Free'}</dd>
    </dl>
    <p>${planLine}</p>
    ${user.isPro ? '' : `
      <div class="upgrade-box">
        <h2>Upgrade to Pro: $7.99/month</h2>
        <ul>
          <li>AI-built trips: a full day-by-day itinerary for your dates, budget and interests</li>
          <li>The cheapest way there, step by step, plus where to eat cheaply and what it costs</li>
          <li>Cancel any time</li>
        </ul>
        <button type="button" class="btn primary wide" id="upgrade">Upgrade to Pro</button>
        <p class="muted small">Secure checkout by Stripe. You can cancel any time from this page.</p>
      </div>`}
    ${user.hasBilling && !user.isDemo ? '<button type="button" class="btn ghost wide" id="manage">Manage subscription</button>' : ''}
    <a class="btn ghost wide" href="/app">Open the trip planner</a>
    <p class="form-msg" id="acct-msg" role="status" aria-live="polite"></p>`;

  const msg = document.getElementById('acct-msg');
  const go = (buttonId, path, busyText) => {
    const b = document.getElementById(buttonId);
    if (!b) return null;
    const run = async () => {
      b.disabled = true;
      msg.classList.remove('error');
      msg.textContent = busyText;
      try {
        const { url } = await post(path);
        location.href = url; // off to Stripe
      } catch (err) {
        msg.textContent = err.message;
        msg.classList.add('error');
        b.disabled = false;
      }
    };
    b.onclick = run;
    return run;
  };
  const upgrade = go('upgrade', '/api/checkout', 'Opening secure checkout…');
  go('manage', '/api/billing-portal', 'Opening subscription management…');

  // Came here from a "Get Pro" button: go straight to checkout
  if (params.get('upgrade') === '1' && upgrade && !user.isPro) upgrade();
})();
