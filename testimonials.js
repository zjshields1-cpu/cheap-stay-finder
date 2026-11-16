// Testimonials on the homepage. Only add REAL quotes from people who used the app,
// with their permission (first name + last initial is enough). The section stays hidden
// until this list has at least one entry.
//
// Example entry:
//   { quote: 'It was nice being able to filter so I wasn't flooded with information.',
//     name: 'Sarah S.', trip: 'Planning a ski week in Switzerland' },
const TESTIMONIALS = [
];

(function () {
  const box = document.querySelector('[data-testimonials]');
  if (!box || !TESTIMONIALS.length) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  box.innerHTML = TESTIMONIALS.map((t) => `
    <figure class="card plain quote">
      <blockquote>“${esc(t.quote)}”</blockquote>
      <figcaption><b>${esc(t.name)}</b>${t.trip ? `<span class="muted"> · ${esc(t.trip)}</span>` : ''}</figcaption>
    </figure>`).join('');
  document.getElementById('testimonials').hidden = false;
})();
