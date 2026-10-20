// Cheap Stay Finder — OpenStreetMap (Nominatim + Overpass) + Leaflet

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Accommodation types, with a rough typical nightly range (USD) used for "cheapest" ordering.
const STAY_TYPES = {
  camp_site:    { label: 'Camping',        icon: '⛺', color: '#2e7d32', tier: 1, range: [10, 35] },
  caravan_site: { label: 'RV park',        icon: '🚐', color: '#558b2f', tier: 1, range: [20, 55] },
  alpine_hut:   { label: 'Hut',            icon: '🛖', color: '#6d4c41', tier: 1, range: [20, 60] },
  hostel:       { label: 'Hostel',         icon: '🛏️', color: '#ef6c00', tier: 1, range: [20, 50] },
  guest_house:  { label: 'Guest house/B&B', icon: '🏡', color: '#8e24aa', tier: 2, range: [50, 110] },
  motel:        { label: 'Motel',          icon: '🚗', color: '#00838f', tier: 2, range: [60, 120] },
  apartment:    { label: 'Apartment',      icon: '🏢', color: '#3949ab', tier: 2, range: [70, 150] },
  chalet:       { label: 'Cabin/Chalet',   icon: '🏠', color: '#795548', tier: 3, range: [90, 200] },
  hotel:        { label: 'Hotel',          icon: '🏨', color: '#c62828', tier: 3, range: [80, 200] },
};
const HOTEL_BY_STARS = {
  1: { tier: 2, range: [45, 90] },
  2: { tier: 2, range: [60, 110] },
  3: { tier: 3, range: [90, 170] },
  4: { tier: 4, range: [150, 300] },
  5: { tier: 4, range: [300, 700] },
};

const ATTR_TYPES = {
  attraction: { label: 'Attraction', icon: '⭐' },
  museum: { label: 'Museum', icon: '🏛️' },
  gallery: { label: 'Gallery', icon: '🖼️' },
  viewpoint: { label: 'Viewpoint', icon: '🔭' },
  zoo: { label: 'Zoo', icon: '🦁' },
  aquarium: { label: 'Aquarium', icon: '🐠' },
  theme_park: { label: 'Theme park', icon: '🎢' },
  castle: { label: 'Castle', icon: '🏰' },
  monument: { label: 'Monument', icon: '🗿' },
  ruins: { label: 'Ruins', icon: '🏚️' },
  archaeological_site: { label: 'Archaeological site', icon: '⛏️' },
  park: { label: 'Park', icon: '🌳' },
  beach: { label: 'Beach', icon: '🏖️' },
};

const WALK_M_PER_MIN = 80; // ~3 mph
const MILE = 1609.34;      // metres; distances are computed in metres and displayed in imperial
const NEAR_RADIUS = MILE / 2; // "attractions within" radius

// ---------- Map setup ----------
const map = L.map('map', { worldCopyJump: true }).setView([30, 0], 2);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

const layers = {
  center: L.layerGroup().addTo(map),
  attractions: L.markerClusterGroup({
    maxClusterRadius: 40,
    disableClusteringAtZoom: 16,
    showCoverageOnHover: false,
    iconCreateFunction: (c) => L.divIcon({ className: '', html: `<div class="poi cluster">⭐${c.getChildCount()}</div>`, iconSize: [36, 24] }),
  }).addTo(map),
  links: L.layerGroup().addTo(map),
  stays: L.markerClusterGroup({
    maxClusterRadius: 45,
    disableClusteringAtZoom: 17,
    showCoverageOnHover: false,
    iconCreateFunction: (c) => {
      const kids = c.getAllChildMarkers();
      const cheapest = Math.min(...kids.map((m) => m.options.tier));
      return L.divIcon({
        className: '',
        html: `<div class="stay-cluster"><b>${kids.length}</b><span>from ${cheapest === 0 ? 'Free' : '$'.repeat(cheapest)}</span></div>`,
        iconSize: [46, 46],
      });
    },
  }).addTo(map),
};

const state = {
  place: null,
  stays: [],
  attractions: [],
  activeTypes: new Set(Object.keys(STAY_TYPES)),
  sort: 'cheap',
  limit: 10,
  selectedId: null,
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const els = {
  form: $('search-form'), q: $('q'), radius: $('radius'), go: $('go'),
  status: $('status'), results: $('results'), filters: $('type-filters'),
  sort: $('sort'), showAttr: $('show-attr'), limit: $('limit'),
};

try {
  const saved = +localStorage.getItem('csf-limit');
  if (saved > 0) state.limit = saved;
} catch { /* storage unavailable */ }
els.limit.value = String(state.limit);
if (els.limit.value !== String(state.limit)) { state.limit = 10; els.limit.value = '10'; }
els.limit.addEventListener('change', () => {
  state.limit = +els.limit.value;
  try { localStorage.setItem('csf-limit', state.limit); } catch { /* ignore */ }
  syncLimitSelect();
  renderList();
});

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = els.q.value.trim();
  if (q) search(q, +els.radius.value);
});
els.sort.addEventListener('change', () => { state.sort = els.sort.value; renderList(); });
els.showAttr.addEventListener('change', () => {
  if (els.showAttr.checked) map.addLayer(layers.attractions);
  else map.removeLayer(layers.attractions);
});

// ---------- Helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = (m) => {
  const ft = m * 3.28084;
  if (ft < 1000) return `${Math.max(10, Math.round(ft / 10) * 10)} ft`;
  const mi = m / MILE;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
};
const fmtWalk = (m) => {
  const min = Math.max(1, Math.round(m / WALK_M_PER_MIN));
  return min <= 90 ? `${min} min walk` : `${Math.round(min / 60)} h walk`;
};

function setStatus(html, isError = false) {
  els.status.innerHTML = html;
  els.status.classList.toggle('error', isError);
}

function parseStars(v) {
  if (!v) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return n >= 1 && n <= 5 ? n : null;
}

function estimatePrice(tags) {
  const t = STAY_TYPES[tags.tourism];
  let { tier, range } = t;
  const stars = parseStars(tags.stars);
  if (tags.tourism === 'hotel' && stars) ({ tier, range } = HOTEL_BY_STARS[Math.round(stars)]);
  const free = (tags.fee === 'no' || tags.charge === '0') && /camp|caravan|alpine/.test(tags.tourism);
  if (free) return { tier: 0, range: [0, 0], free: true, listed: null };
  const listedRaw = tags.charge || (tags.fee && !/^(yes|no)$/i.test(tags.fee) ? tags.fee : null);
  return { tier, range, free: false, listed: listedRaw };
}

function priceLabel(p) {
  if (p.free) return 'Free';
  return `${'$'.repeat(p.tier)} <small>~$${p.range[0]}–${p.range[1]}/night</small>`;
}

function starsHtml(stars) {
  if (!stars) return '<span>No rating listed in open data</span>';
  const full = Math.round(stars);
  return `<span class="stars">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span> ${stars}-star class`;
}

function placeShortName() {
  return state.place ? state.place.display_name.split(',').slice(0, 2).join(',') : '';
}

function reviewLinks(s) {
  const q = `${s.name} ${placeShortName()}`;
  const g = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  const b = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(q)}`;
  let html = `<a href="${g}" target="_blank" rel="noopener">Prices &amp; reviews ↗</a>
              <a href="${b}" target="_blank" rel="noopener">Booking ↗</a>`;
  const site = s.tags.website || s.tags['contact:website'];
  if (site && /^https?:\/\//i.test(site)) html += `<a href="${esc(site)}" target="_blank" rel="noopener">Website ↗</a>`;
  return html;
}

// ---------- Data fetching ----------
async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const data = await res.json();
  if (!data.length) throw new Error(`Couldn't find “${q}”. Try adding a country or region.`);
  const p = data[0];
  return { ...p, lat: +p.lat, lon: +p.lon };
}

// Bounding box around a point (bbox queries are much faster on Overpass than "around").
function bbox(lat, lon, r) {
  const dLat = r / 111320, dLon = r / (111320 * Math.cos(lat * Math.PI / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(5)).join(',');
}

// Simple key=value filters use Overpass's tag index, so they're cheaper than regexes.
function unionQuery(bb, filters, limit) {
  return `[out:json][timeout:30][bbox:${bb}];(${filters.map((f) => `nwr${f};`).join('')});out center tags ${limit};`;
}
const stayQuery = (bb) => unionQuery(bb, Object.keys(STAY_TYPES).map((t) => `["tourism"="${t}"]`), 800);
const attractionQuery = (bb) => unionQuery(bb, [
  ...['attraction', 'museum', 'gallery', 'viewpoint', 'zoo', 'aquarium', 'theme_park'].map((t) => `["tourism"="${t}"]["name"]`),
  ...['castle', 'monument', 'ruins', 'archaeological_site'].map((t) => `["historic"="${t}"]["name"]`),
  '["leisure"="park"]["name"]',
  '["natural"="beach"]["name"]',
], 800);

const CACHE_TTL = 24 * 3600 * 1000;
function cacheGet(key) {
  try {
    const v = JSON.parse(localStorage.getItem('csf:' + key));
    return v && Date.now() - v.t < CACHE_TTL ? v.data : null;
  } catch { return null; }
}
function cacheSet(key, data) {
  try { localStorage.setItem('csf:' + key, JSON.stringify({ t: Date.now(), data })); } catch { /* storage full or blocked */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Public Overpass servers are often overloaded; rotate mirrors and retry with backoff.
async function overpass(query, onRetry) {
  const cached = cacheGet(query);
  if (cached) return cached;
  let lastErr;
  for (let round = 0; round < 3; round++) {
    for (const ep of OVERPASS_ENDPOINTS) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 35000);
      try {
        const res = await fetch(ep, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`server returned ${res.status}`);
        const data = await res.json();
        cacheSet(query, data);
        return data;
      } catch (err) {
        lastErr = err.name === 'AbortError' ? new Error('timed out') : err;
        onRetry?.();
      } finally {
        clearTimeout(timer);
      }
    }
    await sleep(2000 * (round + 1));
  }
  throw new Error(`The free map-data servers are overloaded right now (${lastErr?.message}). Please try again in a minute.`);
}

function parseElements(elements) {
  const stays = [], attractions = [];
  const seen = new Set();
  for (const el of elements) {
    const tags = el.tags || {};
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat == null) continue;
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (STAY_TYPES[tags.tourism]) {
      const type = tags.tourism;
      // Unnamed apartments/hotels are usually individual flats or data noise; unnamed campsites are still useful.
      if (!tags.name && !/camp|caravan|alpine/.test(type)) continue;
      stays.push({
        id: key, lat, lon, tags, type,
        name: tags.name || `Unnamed ${STAY_TYPES[type].label.toLowerCase()}`,
        stars: parseStars(tags.stars),
        price: estimatePrice(tags),
      });
      continue;
    }
    const aType = ATTR_TYPES[tags.tourism] ? tags.tourism
      : ATTR_TYPES[tags.historic] ? tags.historic
      : tags.leisure === 'park' ? 'park'
      : tags.natural === 'beach' ? 'beach' : null;
    if (aType && tags.name) attractions.push({ id: key, lat, lon, tags, type: aType, name: tags.name });
  }

  // Collapse duplicate attractions (e.g. a park mapped as several areas)
  const deduped = [];
  for (const a of attractions) {
    if (!deduped.some((d) => d.name === a.name && haversine(d, a) < 300)) deduped.push(a);
  }
  return { stays, attractions: deduped };
}

function enrich() {
  const center = state.place;
  for (const s of state.stays) {
    s.distCenter = haversine(center, s);
    s.nearby = state.attractions
      .map((a) => ({ a, d: haversine(s, a) }))
      .sort((x, y) => x.d - y.d);
    s.countNear = s.nearby.filter((n) => n.d <= NEAR_RADIUS).length;
  }
  for (const a of state.attractions) a.distCenter = haversine(center, a);
}

// ---------- Search ----------
async function search(q, radius) {
  els.go.disabled = true;
  setStatus(`<span class="spinner"></span>Finding “${esc(q)}”…`);
  try {
    const place = await geocode(q);
    state.place = place;
    state.selectedId = null;
    state.attractionError = null;
    layers.links.clearLayers();
    location.hash = 'q=' + encodeURIComponent(q) + '&r=' + radius;
    map.setView([place.lat, place.lon], radius <= 2000 ? 15 : radius <= 5000 ? 14 : 12);
    drawCenter(radius);

    const bb = bbox(place.lat, place.lon, radius);
    const inRange = (x) => haversine(place, x) <= radius;
    let tries = 0;
    const retryNote = () => setStatus(`<span class="spinner"></span>Map-data server is busy, retrying (${++tries})…`);

    // 1) Stays first, so results show up as soon as possible
    setStatus(`<span class="spinner"></span>Looking for places to stay within ${fmtDist(radius)}…`);
    state.loadingStays = true;
    const stayData = await overpass(stayQuery(bb), retryNote).finally(() => { state.loadingStays = false; });
    state.stays = parseElements(stayData.elements || []).stays.filter(inRange);
    state.attractions = [];
    state.loadingAttractions = true;
    enrich();
    renderFilters();
    renderAttractions();
    renderList();
    fitToResults(radius);

    // 2) Then attractions, and recompute distances
    try {
      const attrData = await overpass(attractionQuery(bb), () => {});
      state.attractions = parseElements(attrData.elements || []).attractions.filter(inRange);
    } catch (err) {
      console.error(err);
      state.attractionError = err.message;
    }
    state.loadingAttractions = false;
    enrich();
    renderAttractions();
    renderList();
  } catch (err) {
    console.error(err);
    setStatus(esc(err.message), true);
  } finally {
    els.go.disabled = false;
  }
}

// ---------- Rendering ----------
function drawCenter(radius) {
  layers.center.clearLayers();
  const p = state.place;
  L.circle([p.lat, p.lon], { radius, color: '#0b6bcb', weight: 1, fillOpacity: 0.03, dashArray: '4 6' }).addTo(layers.center);
  L.marker([p.lat, p.lon], {
    icon: L.divIcon({ className: '', html: '<div class="center-pin">📍</div>', iconSize: [30, 30], iconAnchor: [15, 28] }),
    zIndexOffset: 1000,
  }).bindPopup(`<h4>${esc(p.display_name.split(',')[0])}</h4>${esc(p.display_name)}`).addTo(layers.center);
}

function renderFilters() {
  const counts = {};
  for (const s of state.stays) counts[s.type] = (counts[s.type] || 0) + 1;
  els.filters.innerHTML = '';
  for (const [type, t] of Object.entries(STAY_TYPES)) {
    if (!counts[type]) continue;
    const b = document.createElement('button');
    b.className = 'chip' + (state.activeTypes.has(type) ? ' on' : '');
    b.style.setProperty('--c', t.color);
    b.innerHTML = `${t.icon} ${t.label} <span class="n">${counts[type]}</span>`;
    b.onclick = () => {
      state.activeTypes.has(type) ? state.activeTypes.delete(type) : state.activeTypes.add(type);
      renderFilters();
      renderList();
    };
    els.filters.appendChild(b);
  }
}

function sortedStays() {
  const list = state.stays.filter((s) => state.activeTypes.has(s.type));
  const by = {
    cheap: (a, b) => a.price.tier - b.price.tier || a.price.range[0] - b.price.range[0] || (b.stars || 0) - (a.stars || 0) || a.distCenter - b.distCenter,
    attractions: (a, b) => b.countNear - a.countNear || a.price.tier - b.price.tier,
    center: (a, b) => a.distCenter - b.distCenter,
    rating: (a, b) => (b.stars || 0) - (a.stars || 0) || a.price.tier - b.price.tier,
  }[state.sort];
  return list.sort(by);
}

function stayIcon(s, selected = false) {
  const t = STAY_TYPES[s.type];
  return L.divIcon({
    className: '',
    html: `<div class="pin${selected ? ' selected' : ''}" style="--c:${t.color}">${t.icon}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14],
  });
}

function nearestListHtml(s, n = 5) {
  const items = s.nearby.slice(0, n);
  if (!items.length) return '<i>No mapped attractions in range.</i>';
  return '<ol>' + items.map(({ a, d }) =>
    `<li>${ATTR_TYPES[a.type].icon} ${esc(a.name)} — <b>${fmtDist(d)}</b> · ${fmtWalk(d)}</li>`).join('') + '</ol>';
}

function stayPopup(s) {
  const t = STAY_TYPES[s.type];
  return `<h4>${t.icon} ${esc(s.name)}</h4>
    <div>${t.label} · <b>${priceLabel(s.price)}</b></div>
    <div class="rating">${starsHtml(s.stars)}</div>
    ${s.price.listed ? `<div>Listed fee: ${esc(s.price.listed)}</div>` : ''}
    <div style="margin-top:6px"><b>Closest attractions</b> (${s.countNear} within ½ mi):</div>
    ${nearestListHtml(s)}
    <div class="links" style="margin-top:6px">${reviewLinks(s)}</div>`;
}

function renderList() {
  if (state.loadingStays) return; // the search status message stays up until results arrive
  const all = sortedStays();
  const list = all.slice(0, state.limit);
  layers.stays.clearLayers();
  els.results.innerHTML = '';

  if (!state.stays.length) {
    setStatus(`No accommodations mapped within this radius. Try a larger radius or a nearby town.`);
    return;
  }
  const attrNote = state.loadingAttractions
    ? '<br><span class="spinner"></span>Loading nearby attractions…'
    : state.attractionError ? `<br>Couldn't load attractions: ${esc(state.attractionError)}` : '';
  const count = list.length < all.length ? `Showing top <b>${list.length}</b> of ${all.length}` : `<b>${all.length}</b>`;
  setStatus(`${count} stays · <b>${state.attractions.length}</b> attractions near <b>${esc(placeShortName())}</b>. Click a stay to see what’s around it.${attrNote}`);

  for (const s of list) {
    const t = STAY_TYPES[s.type];
    const selected = s.id === state.selectedId;
    s.marker = L.marker([s.lat, s.lon], { icon: stayIcon(s, selected), zIndexOffset: selected ? 900 : 0, tier: s.price.tier })
      .bindPopup(() => stayPopup(s), { maxWidth: 320 })
      .on('click', () => select(s.id, { fromMap: true }))
      .addTo(layers.stays);

    const first = s.nearby[0];
    const li = document.createElement('li');
    li.className = 'card' + (selected ? ' selected' : '');
    li.dataset.id = s.id;
    li.innerHTML = `
      <div class="card-head">
        <span class="badge" style="background:${t.color}">${t.icon} ${t.label}</span>
        <span class="price">${priceLabel(s.price)}</span>
      </div>
      <h3>${esc(s.name)}</h3>
      <div class="rating">${starsHtml(s.stars)}</div>
      <div class="meta">${fmtDist(s.distCenter)} from search point · <b>${s.countNear}</b> attraction${s.countNear === 1 ? '' : 's'} within ½ mi</div>
      ${first ? `<div class="near">Nearest: ${ATTR_TYPES[first.a.type].icon} ${esc(first.a.name)} — ${fmtDist(first.d)} (${fmtWalk(first.d)})</div>` : ''}
      <div class="links">${reviewLinks(s)}</div>`;
    li.addEventListener('click', (e) => { if (!e.target.closest('a')) select(s.id); });
    els.results.appendChild(li);
  }

  if (list.length < all.length) {
    const more = document.createElement('li');
    const step = Math.min(state.limit, all.length - list.length);
    more.innerHTML = `<button class="more-btn">Show ${step} more</button>`;
    more.querySelector('button').onclick = () => { state.limit += step; syncLimitSelect(); renderList(); };
    els.results.appendChild(more);
  }
}

function syncLimitSelect() {
  // Reflect a "Show more"-expanded limit in the dropdown
  const sel = els.limit;
  [...sel.options].filter((o) => o.dataset.custom).forEach((o) => o.remove());
  if (![...sel.options].some((o) => +o.value === state.limit)) {
    const o = new Option(`${state.limit}`, state.limit);
    o.dataset.custom = '1';
    sel.add(o, [...sel.options].find((x) => +x.value > state.limit) || null);
  }
  sel.value = String(state.limit);
}

function attractionIcon(a, near = false) {
  return L.divIcon({
    className: '',
    html: `<div class="poi${near ? ' near' : ''}" title="${esc(a.name)}">${ATTR_TYPES[a.type].icon}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -10],
  });
}

function renderAttractions(highlight = new Set()) {
  layers.attractions.clearLayers();
  for (const a of state.attractions) {
    L.marker([a.lat, a.lon], { icon: attractionIcon(a, highlight.has(a.id)) })
      .bindTooltip(esc(a.name), { direction: 'top', offset: [0, -10] })
      .bindPopup(() => attractionPopup(a))
      .addTo(layers.attractions);
  }
}

function attractionPopup(a) {
  const cheapest = state.stays
    .map((s) => ({ s, d: haversine(a, s) }))
    .filter((x) => x.d <= MILE)
    .sort((x, y) => x.s.price.tier - y.s.price.tier || x.d - y.d)
    .slice(0, 3);
  const list = cheapest.length
    ? '<ol>' + cheapest.map(({ s, d }) => `<li>${STAY_TYPES[s.type].icon} ${esc(s.name)} — ${s.price.free ? 'Free' : '$'.repeat(s.price.tier)} · ${fmtDist(d)}</li>`).join('') + '</ol>'
    : '<i>No stays within 1 mi.</i>';
  return `<h4>${ATTR_TYPES[a.type].icon} ${esc(a.name)}</h4>
    <div>${ATTR_TYPES[a.type].label} · ${fmtDist(a.distCenter)} from search point</div>
    <div style="margin-top:6px"><b>Cheapest stays nearby:</b></div>${list}`;
}

function select(id, { fromMap = false } = {}) {
  const s = state.stays.find((x) => x.id === id);
  if (!s) return;
  state.selectedId = id;

  // Re-style markers / cards
  for (const x of state.stays) {
    if (x.marker) {
      x.marker.setIcon(stayIcon(x, x.id === id));
      x.marker.setZIndexOffset(x.id === id ? 900 : 0);
    }
  }
  document.querySelectorAll('.card').forEach((c) => c.classList.toggle('selected', c.dataset.id === id));
  const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (card && fromMap) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Distance lines to the nearest attractions + ½ mile walking ring
  layers.links.clearLayers();
  const near = s.nearby.slice(0, 5);
  L.circle([s.lat, s.lon], { radius: NEAR_RADIUS, color: '#0b6bcb', weight: 1, fillOpacity: 0.06 }).addTo(layers.links);
  for (const { a, d } of near) {
    L.polyline([[s.lat, s.lon], [a.lat, a.lon]], { color: '#0b6bcb', weight: 2.5, dashArray: '6 6', opacity: 0.85 })
      .bindTooltip(`${fmtDist(d)} · ${fmtWalk(d)}`, { permanent: true, direction: 'center', className: 'dist-label' })
      .addTo(layers.links);
  }
  renderAttractions(new Set(near.map((n) => n.a.id)));

  // Keep the current zoom: pan to the stay (or zoom in only if it's hidden inside a cluster).
  if (!fromMap) layers.stays.zoomToShowLayer(s.marker, () => s.marker.openPopup());
}

function fitToResults(radius) {
  const p = state.place;
  const pts = [[p.lat, p.lon], ...sortedStays().slice(0, state.limit).map((s) => [s.lat, s.lon])];
  if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.08), { maxZoom: 16 });
  else map.setView([p.lat, p.lon], radius <= 2000 ? 15 : 13);
}

// ---------- Start: restore last search from URL ----------
(function init() {
  const params = new URLSearchParams(location.hash.slice(1));
  const q = params.get('q');
  if (q) {
    els.q.value = q;
    const r = params.get('r');
    if (r && [...els.radius.options].some((o) => o.value === r)) els.radius.value = r;
    search(q, +els.radius.value);
  } else {
    els.q.focus();
  }
})();
