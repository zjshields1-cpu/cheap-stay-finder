// Trip planner — departure, dates, interests, "Plan a trip" and "Plan me a weekend trip".
// Uses map, state, layers, overpass, geocode, haversine, fmtDist, fmtWalk, esc and search from app.js.

const INTERESTS = {
  mtb:   { label: 'Mountain bike',      icon: '🚵' },
  road:  { label: 'Gravel & road bike', icon: '🚴' },
  hike:  { label: 'Hike',               icon: '🥾' },
  kayak: { label: 'Kayak & paddle',     icon: '🛶' },
  ski:   { label: 'Ski & snowboard',    icon: '🏂' },
  parks: { label: 'National parks',     icon: '🏞️' },
  camp:  { label: 'Camp',               icon: '⛺' },
};

const LIFT_TYPES = {
  cable_car: 'Cable car', gondola: 'Gondola', mixed_lift: 'Gondola/chair', chair_lift: 'Chairlift',
  drag_lift: 'Drag lift', 't-bar': 'T-bar', 'j-bar': 'J-bar', platter: 'Platter lift', rope_tow: 'Rope tow',
};

// Places where you can't drive in: worth knowing before you plan the last mile
const CAR_FREE = [
  { match: /zermatt/i, tip: 'Zermatt is car-free. Drive or take the train to Täsch, park there, and ride the 12-minute Täsch–Zermatt shuttle train. Stock up at a grocery store before going up — prices in the resort are higher.' },
  { match: /saas-fee/i, tip: 'Saas-Fee is car-free. Park in the garage at the village entrance (or come by PostBus from Visp) and walk or take an e-taxi in.' },
  { match: /wengen/i, tip: 'Wengen is car-free. Park in Lauterbrunnen and take the train up (about 15 minutes).' },
  { match: /mürren|murren/i, tip: 'Mürren is car-free. Park in Lauterbrunnen or Stechelberg and take the cable car or train up.' },
];

const EUROPE = new Set('al ad at be ba bg hr cz dk ee fi fr de gr hu is ie it xk lv li lt lu mt md mc me nl mk no pl pt ro sm rs sk si es se ch ua gb'.split(' '));

// Simple, editable cost assumptions (shown to the user next to every estimate)
const COSTS = {
  mpg: 28,              // typical car
  gasUS: 3.25,          // $ per US gallon
  gasAbroad: 7.0,       // $ per US gallon equivalent in Europe and most other places
  groceriesPerDay: [15, 25], // $ per person per day cooking your own food
};

const tripLayer = L.layerGroup().addTo(map);
const trip = { from: null, fromText: '', interests: new Set(Object.keys(INTERESTS)), base: null, planning: false };

const T = {
  setup: document.getElementById('trip-setup'),
  from: document.getElementById('from'),
  locate: document.getElementById('locate'),
  date: document.getElementById('depart-date'),
  nights: document.getElementById('nights'),
  interests: document.getElementById('interests'),
  plan: document.getElementById('plan-trip'),
  weekend: document.getElementById('weekend'),
  msg: document.getElementById('setup-msg'),
  tabStays: document.getElementById('tab-stays'),
  tabTrip: document.getElementById('tab-trip'),
  staysPanel: document.getElementById('stays-panel'),
  tripPanel: document.getElementById('trip-panel'),
};

// ---------- Small helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const niceDate = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const KM_PER_MI = 1.609344;
const shortName = (displayName) => displayName.split(',').slice(0, 2).join(',').trim();
const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${text} ↗</a>`;

function nextFriday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const add = ((5 - d.getDay() + 7) % 7) || 7;
  return addDays(d, add);
}

function setMsg(html, isError = false) {
  T.msg.innerHTML = html;
  T.msg.classList.toggle('error', isError);
}

function saveSetup() {
  try {
    localStorage.setItem('csf-trip', JSON.stringify({
      from: trip.from, fromText: T.from.value, interests: [...trip.interests],
    }));
  } catch { /* storage unavailable */ }
}

function loadSetup() {
  try {
    const s = JSON.parse(localStorage.getItem('csf-trip'));
    if (!s) return;
    if (s.fromText) T.from.value = s.fromText;
    if (s.from && s.fromText === s.from.label) trip.from = s.from;
    if (Array.isArray(s.interests) && s.interests.length) trip.interests = new Set(s.interests.filter((k) => INTERESTS[k]));
  } catch { /* ignore */ }
}

// ---------- Setup form ----------
function renderInterests() {
  T.interests.innerHTML = '';
  for (const [key, it] of Object.entries(INTERESTS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (trip.interests.has(key) ? ' on' : '');
    b.style.setProperty('--c', '#1f8a4c');
    b.innerHTML = `${it.icon} ${it.label}`;
    b.onclick = () => {
      trip.interests.has(key) ? trip.interests.delete(key) : trip.interests.add(key);
      if (!trip.interests.size) trip.interests.add(key); // keep at least one
      renderInterests();
      saveSetup();
    };
    T.interests.appendChild(b);
  }
}

async function resolveFrom() {
  const text = T.from.value.trim();
  if (!text) { trip.from = null; return null; }
  if (trip.from && trip.from.label === text) return trip.from;
  const p = await geocode(text);
  trip.from = { lat: p.lat, lon: p.lon, cc: p.address?.country_code || '', label: text, full: p.display_name };
  saveSetup();
  return trip.from;
}

T.from.addEventListener('change', async () => {
  try {
    const f = await resolveFrom();
    setMsg(f ? `Leaving from <b>${esc(shortName(f.full))}</b>.` : '');
  } catch (err) { setMsg(esc(err.message), true); }
});

T.locate.addEventListener('click', () => {
  if (!navigator.geolocation) { setMsg('Your browser can’t share your location. Type a city instead.', true); return; }
  setMsg('<span class="spinner"></span>Finding you…');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      const { latitude: lat, longitude: lon } = pos.coords;
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&lat=${lat}&lon=${lon}`,
        { headers: { 'Accept-Language': 'en' } });
      const p = await res.json();
      const a = p.address || {};
      const label = [a.city || a.town || a.village || a.county, a.state || a.country].filter(Boolean).join(', ') || 'My location';
      T.from.value = label;
      trip.from = { lat, lon, cc: a.country_code || '', label, full: p.display_name || label };
      saveSetup();
      setMsg(`Leaving from <b>${esc(label)}</b>.`);
    } catch (err) { setMsg('Couldn’t look up your location. Type a city instead.', true); }
  }, () => setMsg('Location permission was denied. Type a city instead.', true), { timeout: 15000 });
});

function tripDates() {
  const start = T.date.value ? parseYmd(T.date.value) : nextFriday();
  const nights = +T.nights.value || 2;
  return { start, end: addDays(start, nights), nights };
}

// ---------- Tabs ----------
function showTab(which) {
  const isTrip = which === 'trip';
  T.tabTrip.classList.toggle('active', isTrip);
  T.tabStays.classList.toggle('active', !isTrip);
  T.tabTrip.setAttribute('aria-selected', isTrip);
  T.tabStays.setAttribute('aria-selected', !isTrip);
  T.tripPanel.hidden = !isTrip;
  T.staysPanel.hidden = isTrip;
}
T.tabStays.onclick = () => showTab('stays');
T.tabTrip.onclick = () => showTab('trip');

// ---------- Static data (DOT airfares, airports) ----------
// Small script files built by tools/build_airfares.py; each registers its data on a global.
const scriptCache = new Map();
function loadScript(src) {
  if (!scriptCache.has(src)) {
    scriptCache.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => {
        s.remove();
        scriptCache.delete(src); // let the next attempt try again
        reject(new Error(`Couldn't load ${src}. Check your connection and try again.`));
      };
      document.head.appendChild(s);
    }));
  }
  return scriptCache.get(src);
}

async function loadCities() {
  await loadScript('data/cities.js');
  return window.CSF_CITIES;
}

// Every DOT route touching one city: { otherCityId: { mi, q: [[quarter, avg, lowCarrierAvg, carrier, pax], ...] } }
async function loadRoutes(cityId) {
  try {
    await loadScript(`data/fares/${cityId}.js`);
  } catch { return {}; }
  return window.CSF_FARES?.[cityId] || {};
}

// Airports are stored in 10-degree tiles; load the tiles a circle touches
async function airportsNear(pt, km) {
  const dLat = km / 111.32, dLon = Math.min(180, km / (111.32 * Math.max(0.1, Math.cos(pt.lat * Math.PI / 180))));
  const tiles = new Set();
  for (let la = Math.floor((pt.lat - dLat) / 10); la <= Math.floor((pt.lat + dLat) / 10); la++) {
    for (let lo = Math.floor((pt.lon - dLon) / 10); lo <= Math.floor((pt.lon + dLon) / 10); lo++) tiles.add(`${la}_${lo}`);
  }
  // Tiles with no airports don't exist; a failed load just means "none here"
  await Promise.all([...tiles].map((t) => loadScript(`data/airports/${t}.js`).catch(() => {})));
  return [...tiles].flatMap((t) => (window.CSF_AP?.[t] || []).map(([c, n, lat, lon, cc, size]) => ({ c, n, lat, lon, cc, t: size })));
}

function nearestAirports(airports, pt, maxKm, n, minSize = 2) {
  return airports
    .filter((a) => a.t >= minSize)
    .map((a) => ({ ...a, d: haversine(pt, a) }))
    .filter((a) => a.d <= maxKm * 1000)
    // Big hubs usually have far cheaper flights: treat each size step as worth ~75 miles of extra travel
    .sort((a, b) => (a.d - (a.t - 1) * 120000) - (b.d - (b.t - 1) * 120000))
    .slice(0, n);
}

// The DOT city market whose airports are closest to a point
function dotCity(cities, pt, maxKm = 110) {
  let best = null;
  for (const [id, c] of Object.entries(cities.cities)) {
    const d = haversine(pt, c);
    if (d <= maxKm * 1000 && (!best || d < best.d)) best = { id, ...c, d };
  }
  return best;
}

function summarizeFare(f, month) {
  if (!f) return null;
  const q = Math.floor(month / 3) + 1;
  const sameQ = f.q.filter((r) => r[0].endsWith('Q' + q)).pop();
  const latest = f.q[f.q.length - 1];
  return {
    miles: f.mi,
    low: Math.min(...f.q.map((r) => r[2])),
    high: Math.max(...f.q.map((r) => r[1])),
    season: sameQ || latest,
    latest,
  };
}

const CARRIERS = {
  AA: 'American', AS: 'Alaska', B6: 'JetBlue', DL: 'Delta', F9: 'Frontier', G4: 'Allegiant', HA: 'Hawaiian',
  NK: 'Spirit', UA: 'United', WN: 'Southwest', SY: 'Sun Country', MX: 'Breeze', XP: 'Avelo', '3M': 'Silver',
  KG: 'Denver Air Connection', LF: 'Contour', '9X': 'Southern Airways', YX: 'Republic', OO: 'SkyWest', ZW: 'Air Wisconsin', '9K': 'Cape Air', QX: 'Horizon', YV: 'Mesa', OH: 'PSA',
};
const carrierName = (c) => CARRIERS[c] || c;

// ---------- Live helpers (free services) ----------
async function driveRoute(a, b) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const rt = j.routes?.[0];
    return rt ? { meters: rt.distance, seconds: rt.duration } : null;
  } catch { return null; }
}

const WX = [[0, '☀️', 'Clear'], [2, '⛅', 'Partly cloudy'], [3, '☁️', 'Cloudy'], [48, '🌫️', 'Fog'], [57, '🌦️', 'Drizzle'],
  [67, '🌧️', 'Rain'], [77, '🌨️', 'Snow'], [82, '🌧️', 'Showers'], [86, '🌨️', 'Snow showers'], [99, '⛈️', 'Thunderstorms']];
const wxIcon = (code) => (WX.find(([max]) => code <= max) || WX[WX.length - 1]).slice(1);

async function weatherFor(pt, start, nights) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = addDays(start, nights);
  const daysAhead = Math.round((end - today) / 86400000);
  const common = `latitude=${pt.lat.toFixed(4)}&longitude=${pt.lon.toFixed(4)}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum&hourly=snow_depth&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto`;
  let url, kind;
  if (start >= today && daysAhead <= 15) {
    url = `https://api.open-meteo.com/v1/forecast?${common}&start_date=${ymd(start)}&end_date=${ymd(end)}`;
    kind = 'Forecast';
  } else {
    // Too far ahead for a forecast: show what actually happened on the same dates last year
    const s = addDays(start, -364), e = addDays(end, -364);
    url = `https://archive-api.open-meteo.com/v1/archive?${common}&start_date=${ymd(s)}&end_date=${ymd(e)}`;
    kind = 'Last year on these dates (actual weather)';
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error('Weather service unavailable');
  const j = await r.json();
  const depth = (j.hourly?.snow_depth || []).filter((v) => v != null);
  return { kind, daily: j.daily, units: j.daily_units, snowDepth: depth.length ? Math.max(...depth) : null, depthUnit: j.hourly_units?.snow_depth };
}

// ---------- OpenStreetMap queries ----------
function boxAround(pt, km) {
  const dLat = km / 111.32, dLon = km / (111.32 * Math.cos(pt.lat * Math.PI / 180));
  return [pt.lat - dLat, pt.lon - dLon, pt.lat + dLat, pt.lon + dLon].map((v) => v.toFixed(4)).join(',');
}

// Split into small queries: the free Overpass servers are often busy, and big queries time out
function activityQueries(pt, interests) {
  const b12 = boxAround(pt, 12), b60 = boxAround(pt, 60);
  const q = [];
  q.push(`[out:json][timeout:60];
way["aerialway"~"^(cable_car|gondola|mixed_lift|chair_lift|drag_lift|t-bar|j-bar|platter|rope_tow)$"](${b12});
out tags geom;
(
  nwr["landuse"="winter_sports"]["name"](${b12});
  nwr["shop"="ski"](${b12});
  nwr["amenity"="bicycle_rental"](${b12});
  nwr["shop"="bicycle"](${b12});
  nwr["highway"="trailhead"](${b12});
  nwr["tourism"~"^(alpine_hut|wilderness_hut)$"](${b12});
  nwr["tourism"="viewpoint"]["name"](${b12});
  nwr["tourism"="camp_site"](${b12});
  nwr["leisure"="slipway"](${b12});
  nwr["canoe"="put_in"](${b12});
  nwr["amenity"="boat_rental"](${b12});
  nwr["sport"~"canoe|kayak"](${b12});
);
out tags center 900;`);
  if (interests.has('mtb') || interests.has('road') || interests.has('hike')) {
    q.push(`[out:json][timeout:60];
relation["route"~"^(mtb|bicycle|hiking)$"]["name"](${b12});
out tags bb 300;`);
  }
  if (interests.has('parks')) {
    q.push(`[out:json][timeout:60];
(
  relation["boundary"="national_park"]["name"](${b60});
  relation["boundary"="protected_area"]["protect_class"="2"]["name"](${b60});
  way["boundary"="national_park"]["name"](${b60});
);
out tags bb 100;`);
  }
  return q;
}

// Run queries at most two at a time (the public servers allow two per visitor)
async function runQueries(queries, onRetry) {
  const results = new Array(queries.length);
  let next = 0;
  const worker = async () => {
    while (next < queries.length) {
      const i = next++;
      try {
        results[i] = await overpass(queries[i], onRetry, 45000, 1);
      } catch (err) {
        console.error(err);
        results[i] = { elements: [], failed: true };
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return results;
}

function foodQuery(pt) {
  return `[out:json][timeout:40][bbox:${boxAround(pt, 3)}];
(
  nwr["shop"~"^(supermarket|convenience|bakery|greengrocer|deli|butcher)$"];
  nwr["amenity"~"^(restaurant|fast_food|cafe|pub|food_court)$"]["name"];
);
out tags center 700;`;
}

// Distance from a point to a bounding box (0 when inside)
function distToBounds(pt, b) {
  const lat = Math.min(Math.max(pt.lat, b.minlat), b.maxlat);
  const lon = Math.min(Math.max(pt.lon, b.minlon), b.maxlon);
  return haversine(pt, { lat, lon });
}

function classify(elements, base) {
  const out = { lifts: [], skiAreas: [], skiShops: [], bikeRent: [], mtb: [], road: [], hiking: [], trailheads: [], huts: [],
    viewpoints: [], camps: [], paddle: [], parks: [] };
  const seen = new Set();
  for (const el of elements) {
    const t = el.tags || {};
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = t.name || t['name:en'];
    let lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (el.bounds) { lat = (el.bounds.minlat + el.bounds.maxlat) / 2; lon = (el.bounds.minlon + el.bounds.maxlon) / 2; }
    const item = { id: key, name, lat, lon, tags: t };

    if (t.aerialway && el.geometry?.length) {
      const g = el.geometry;
      item.lat = g[0].lat; item.lon = g[0].lon; // OSM draws lifts bottom → top, so the first point is the base
      item.line = g.map((p) => [p.lat, p.lon]);
      item.kind = LIFT_TYPES[t.aerialway] || 'Lift';
      item.d = haversine(base, item);
      out.lifts.push(item);
      continue;
    }
    if (lat == null) continue;
    item.d = el.bounds ? distToBounds(base, el.bounds) : haversine(base, item);
    item.area = !!el.bounds;

    if (t.route === 'mtb') out.mtb.push(item);
    else if (t.route === 'bicycle') out.road.push(item);
    else if (t.route === 'hiking') out.hiking.push(item);
    else if (t.boundary === 'national_park' || t.boundary === 'protected_area') out.parks.push(item);
    else if (t.landuse === 'winter_sports') out.skiAreas.push(item);
    else if (t.shop === 'ski') out.skiShops.push(item);
    else if (t.amenity === 'bicycle_rental' || t.shop === 'bicycle') out.bikeRent.push(item);
    else if (t.highway === 'trailhead') out.trailheads.push(item);
    else if (t.tourism === 'alpine_hut' || t.tourism === 'wilderness_hut') out.huts.push(item);
    else if (t.tourism === 'viewpoint') out.viewpoints.push(item);
    else if (t.tourism === 'camp_site') out.camps.push(item);
    else if (t.leisure === 'slipway' || t.canoe === 'put_in' || t.amenity === 'boat_rental' || /canoe|kayak/.test(t.sport || '')) out.paddle.push(item);
  }
  for (const k of Object.keys(out)) {
    // Merge same-named items close together (e.g. a park mapped as several areas)
    const merged = [];
    for (const it of out[k].sort((a, b) => a.d - b.d)) {
      if (it.name && merged.some((m) => m.name === it.name && haversine(m, it) < 2000)) continue;
      merged.push(it);
    }
    out[k] = merged;
  }
  return out;
}

function classifyFood(elements, base) {
  const out = { groceries: [], cheap: [], restaurants: [] };
  const seen = new Set();
  for (const el of elements) {
    const t = el.tags || {};
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat == null) continue;
    const item = { id: key, name: t.name, lat, lon, tags: t, d: haversine(base, { lat, lon }) };
    if (t.shop) out.groceries.push(item);
    else if (t.amenity === 'fast_food' || t.amenity === 'cafe' || t.amenity === 'food_court') out.cheap.push(item);
    else out.restaurants.push(item);
  }
  const groceryRank = { supermarket: 0, greengrocer: 1, bakery: 2, deli: 3, butcher: 4, convenience: 5 };
  out.groceries.sort((a, b) => a.d - b.d + ((groceryRank[a.tags.shop] ?? 6) - (groceryRank[b.tags.shop] ?? 6)) * 150);
  out.cheap.sort((a, b) => a.d - b.d);
  out.restaurants.sort((a, b) => a.d - b.d);
  return out;
}

// ---------- Map markers for the plan ----------
const markerIndex = new Map();
function addMarker(item, icon, popupHtml) {
  const m = L.marker([item.lat, item.lon], {
    icon: L.divIcon({ className: '', html: `<div class="trip-pin">${icon}</div>`, iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] }),
  }).bindPopup(popupHtml, { maxWidth: 300 }).addTo(tripLayer);
  markerIndex.set(item.id, m);
  if (item.line) L.polyline(item.line, { color: '#6b4fbb', weight: 3, opacity: 0.8 }).addTo(tripLayer);
}

function focusItem(id) {
  const m = markerIndex.get(id);
  if (!m) return;
  map.setView(m.getLatLng(), Math.max(map.getZoom(), 15));
  m.openPopup();
}

// ---------- Rendering ----------
function distText(it) {
  if (it.area && it.d < 50) return 'you’re in it';
  const base = `${fmtDist(it.d)}${it.area ? ' to nearest edge' : ''}`;
  return it.d <= 3000 ? `${base} · ${fmtWalk(it.d)}` : base;
}

function reviewsLink(name) {
  const q = `${name} ${shortName(state.place.display_name)}`;
  return link(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, 'Reviews & hours');
}

function itemRow(it, icon, label, extra = '') {
  const name = it.name ? esc(it.name) : `<i>${esc(label)}</i>`;
  return `<li class="trip-item" data-id="${esc(it.id)}">
    <span class="ti-icon">${icon}</span>
    <span class="ti-main"><b>${name}</b>${it.name && label ? ` <span class="muted">· ${esc(label)}</span>` : ''}
      <span class="ti-sub">${distText(it)}${extra ? ' · ' + extra : ''}</span></span></li>`;
}

function listBlock(title, items, rowFn, max = 6) {
  if (!items.length) return '';
  const rows = items.map(rowFn);
  const shown = rows.slice(0, max).join('');
  const more = rows.length > max
    ? `<details class="more"><summary>Show ${rows.length - max} more</summary><ul class="trip-list">${rows.slice(max).join('')}</ul></details>` : '';
  return `<h4>${title}</h4><ul class="trip-list">${shown}</ul>${more}`;
}

function section(id, title, body, open = true) {
  return `<details class="trip-sec" id="sec-${id}" ${open ? 'open' : ''}><summary>${title}</summary><div class="sec-body">${body}</div></details>`;
}

function routeExtra(it) {
  const t = it.tags;
  const bits = [];
  if (t.distance) bits.push(`${(parseFloat(t.distance) / KM_PER_MI).toFixed(1)} mi long`);
  if (t['mtb:scale']) bits.push(`difficulty ${esc(t['mtb:scale'])}`);
  if (t.network) bits.push(esc(t.network.toUpperCase()));
  return bits.join(' · ');
}

// Nearest airports at both ends, and the DOT typical fare between them when it's a US route
async function flightInfo(from, dest, dates) {
  if (haversine(from, dest) <= 250000) return null; // too close to bother flying
  const [fromAps, toAps, cities] = await Promise.all([airportsNear(from, 160), airportsNear(dest, 250), loadCities()]);
  const fromAp = nearestAirports(fromAps, from, 160, 2);
  const toAp = nearestAirports(toAps, dest, 250, 3);
  if (!fromAp.length || !toAp.length) return null;
  const A = fromAp[0], B = toAp[0];
  const ca = dotCity(cities, A), cb = dotCity(cities, B);
  let fare = null;
  if (ca && cb && ca.id !== cb.id) fare = summarizeFare((await loadRoutes(ca.id))[cb.id], dates.start.getMonth());
  return { fromAp, toAp, A, B, ca, cb, fare };
}

function gettingThereHtml(ctx) {
  const { from, dest, dates, flight, drive, place } = ctx;
  if (!from) {
    return `<p class="muted">Add <b>where you're leaving from</b> above to see driving, flight and train options.</p>`;
  }
  const straight = haversine(from, dest);
  const parts = [];
  const d1 = ymd(dates.start), d2 = ymd(dates.end);
  const destCC = place.address?.country_code || '';
  const abroad = destCC && destCC !== 'us';

  // Drive
  if (drive) {
    const mi = drive.meters / 1000 / KM_PER_MI;
    const hrs = drive.seconds / 3600;
    const gas = abroad ? COSTS.gasAbroad : COSTS.gasUS;
    const gasRT = (2 * mi / COSTS.mpg) * gas;
    parts.push(`<div class="opt"><div class="opt-head">🚗 Drive <span class="muted">${Math.round(mi).toLocaleString()} mi · ${Math.floor(hrs)} h ${Math.round((hrs % 1) * 60)} min each way</span></div>
      <div>Gas ≈ <b>${money(gasRT)}</b> round trip for the whole car <span class="muted">(${COSTS.mpg} mpg at $${gas.toFixed(2)}/gal, estimate)</span>.
      ${hrs <= 6 ? '<b>Probably your cheapest option</b>, especially split between friends.' : 'Long drive: compare with flying below.'}</div>
      <div class="links">${link(`https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lon}&destination=${dest.lat},${dest.lon}&travelmode=driving`, 'Directions')}</div></div>`);
  } else if (straight < 1500000) {
    parts.push(`<div class="opt"><div class="opt-head">🚗 Drive</div><div class="muted">Couldn’t get a driving route right now.</div>
      <div class="links">${link(`https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lon}&destination=${dest.lat},${dest.lon}&travelmode=driving`, 'Directions')}</div></div>`);
  }

  // Fly
  if (flight) {
    const { fromAp, toAp, A, B, ca, cb, fare: f } = flight;
    {
      let fareHtml = '';
      if (f) {
        const [q, avg, low, carrier] = f.season;
        fareHtml = `<div>Typical one-way fare <b>${money(f.low)}–${money(f.high)}</b>
          <span class="muted">(${esc(ca.n)} ↔ ${esc(cb.n)}, last 4 quarters)</span></div>
          <div>In ${q}: average <b>${money(avg)}</b>; cheapest airline was <b>${esc(carrierName(carrier))}</b> at ${money(low)} average.
          Round trip ≈ <b>${money(2 * low)}–${money(2 * avg)}</b> per person.</div>
          <div class="muted small">Source: US DOT Consumer Airfare Report (real tickets sold, averages; not a quote).</div>`;
        ctx.flightRT = [2 * low, 2 * avg];
      } else {
        fareHtml = `<div class="muted">No government fare data for this route. It only covers flights within the US, so check live prices below.</div>`;
      }
      const yy = (s) => s.slice(2).replace(/-/g, '');
      const others = toAp.slice(1).map((a) => `${a.c} (${fmtDist(a.d)})`).join(', ');
      parts.push(`<div class="opt"><div class="opt-head">✈️ Fly ${esc(A.c)} → ${esc(B.c)}
          <span class="muted">${esc(B.n)}, ${fmtDist(B.d)} from your destination</span></div>
        ${fareHtml}
        ${others ? `<div class="muted small">Also compare: ${esc(others)}${fromAp[1] ? `, and from ${esc(fromAp[1].c)}` : ''}.</div>` : ''}
        <div class="links">
          ${link(`https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${A.c} to ${B.c} on ${d1} through ${d2}`)}`, 'Google Flights')}
          ${link(`https://www.skyscanner.com/transport/flights/${A.c.toLowerCase()}/${B.c.toLowerCase()}/${yy(d1)}/${yy(d2)}/`, 'Skyscanner')}
          ${link(`https://www.kayak.com/flights/${A.c}-${B.c}/${d1}/${d2}`, 'Kayak')}
        </div>
        <div class="muted small">From ${esc(B.c)} to your destination: ${link(`https://www.google.com/maps/dir/?api=1&origin=${B.lat},${B.lon}&destination=${dest.lat},${dest.lon}&travelmode=transit`, 'train & bus options')}</div></div>`);
    }
  }

  // Train (Europe)
  if (EUROPE.has(destCC)) {
    const rail = [];
    if (destCC === 'ch') rail.push(link('https://www.sbb.ch/en', 'SBB Swiss rail tickets'));
    rail.push(link('https://www.thetrainline.com/', 'Trainline (all of Europe)'));
    rail.push(link(`https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lon}&destination=${dest.lat},${dest.lon}&travelmode=transit`, 'Train times on Google Maps'));
    parts.push(`<div class="opt"><div class="opt-head">🚆 Train</div>
      <div>${destCC === 'ch' ? 'Swiss trains are fast and frequent. Look for <b>Supersaver</b> tickets and consider a <b>Half Fare Card</b> if you’ll ride a lot.' : 'Book early: European rail fares usually rise closer to the date.'}</div>
      <div class="links">${rail.join(' ')}</div></div>`);
  }

  const tip = CAR_FREE.find((c) => c.match.test(place.display_name));
  if (tip) parts.push(`<div class="opt tip">💡 ${esc(tip.tip)}</div>`);
  return parts.join('') || '<p class="muted">No options found.</p>';
}

function weatherHtml(w) {
  if (!w) return '<p class="muted">Weather unavailable right now.</p>';
  const d = w.daily;
  const rows = d.time.map((t, i) => {
    const [icon, label] = wxIcon(d.weather_code[i]);
    const snow = d.snowfall_sum[i] ? ` · ❄️ ${d.snowfall_sum[i].toFixed(1)} in snow` : '';
    const rain = d.precipitation_sum[i] ? ` · 💧 ${d.precipitation_sum[i].toFixed(2)} in` : '';
    return `<li><b>${niceDate(parseYmd(t))}</b> ${icon} ${label} · ${Math.round(d.temperature_2m_max[i])}° / ${Math.round(d.temperature_2m_min[i])}°F${rain}${snow}</li>`;
  }).join('');
  let depth = '';
  if (w.snowDepth) {
    const unit = w.depthUnit || 'm';
    const inches = unit === 'm' ? w.snowDepth * 39.37 : unit === 'ft' ? w.snowDepth * 12 : unit === 'cm' ? w.snowDepth / 2.54 : w.snowDepth;
    if (inches >= 1) depth = `<p>Snow on the ground (model estimate for the town): up to <b>${Math.round(inches)} in</b>. Upper slopes usually have more.</p>`;
  }
  return `<p class="muted small">${esc(w.kind)} · Open-Meteo</p><ul class="wx">${rows}</ul>${depth}`;
}

function activitiesHtml(a, interests) {
  const out = [];
  const liftRow = (it) => itemRow(it, '🚡', it.kind, it.tags['aerialway:duration'] ? `${esc(it.tags['aerialway:duration'])} min ride` : '');
  if (interests.has('ski')) {
    const body = listBlock('Lifts — distance to the bottom station', a.lifts, liftRow, 8)
      + listBlock('Ski areas', a.skiAreas, (it) => itemRow(it, '⛷️', 'Ski area'))
      + listBlock('Ski & snowboard shops (rentals)', a.skiShops, (it) => itemRow(it, '🎿', 'Shop'));
    out.push(section('ski', `${INTERESTS.ski.icon} Ski & snowboard`, body || '<p class="muted">No lifts or ski areas mapped within ~7 mi.</p>'));
  }
  if (interests.has('mtb')) {
    const body = listBlock('Mountain-bike routes', a.mtb, (it) => itemRow(it, '🚵', 'MTB route', routeExtra(it)))
      + listBlock('Bike rentals & shops', a.bikeRent, (it) => itemRow(it, '🔧', it.tags.amenity === 'bicycle_rental' ? 'Bike rental' : 'Bike shop'));
    out.push(section('mtb', `${INTERESTS.mtb.icon} Mountain biking`, body || '<p class="muted">No mapped MTB routes within ~7 mi.</p>'));
  }
  if (interests.has('road')) {
    const body = listBlock('Signed cycling routes (good for gravel & road)', a.road, (it) => itemRow(it, '🚴', 'Bike route', routeExtra(it)))
      + (interests.has('mtb') ? '' : listBlock('Bike rentals & shops', a.bikeRent, (it) => itemRow(it, '🔧', 'Bike shop')));
    out.push(section('road', `${INTERESTS.road.icon} Gravel & road riding`, body || '<p class="muted">No signed cycling routes within ~7 mi.</p>'));
  }
  if (interests.has('hike')) {
    const body = listBlock('Hiking routes', a.hiking, (it) => itemRow(it, '🥾', 'Trail', routeExtra(it)))
      + listBlock('Trailheads', a.trailheads, (it) => itemRow(it, '🚩', 'Trailhead'))
      + listBlock('Mountain huts', a.huts, (it) => itemRow(it, '🛖', 'Hut'))
      + listBlock('Viewpoints', a.viewpoints, (it) => itemRow(it, '🔭', 'Viewpoint'));
    out.push(section('hike', `${INTERESTS.hike.icon} Hiking`, body || '<p class="muted">No mapped trails within ~7 mi.</p>'));
  }
  if (interests.has('kayak')) {
    const body = listBlock('Launches & rentals', a.paddle, (it) => itemRow(it, '🛶',
      it.tags.amenity === 'boat_rental' ? 'Boat rental' : it.tags.leisure === 'slipway' ? 'Boat ramp' : 'Paddling spot'));
    out.push(section('kayak', `${INTERESTS.kayak.icon} Kayak & paddle`, body || '<p class="muted">No launches or rentals mapped within ~7 mi.</p>'));
  }
  if (interests.has('parks')) {
    const body = listBlock('National parks & protected areas (within ~37 mi)', a.parks, (it) => itemRow(it, '🏞️', it.tags.boundary === 'national_park' ? 'National park' : 'Protected area'));
    out.push(section('parks', `${INTERESTS.parks.icon} National parks`, body || '<p class="muted">No national parks within ~37 mi.</p>'));
  }
  if (interests.has('camp')) {
    const body = listBlock('Campgrounds', a.camps, (it) => itemRow(it, '⛺', 'Campground', it.tags.fee === 'no' ? '<b>free</b>' : ''));
    out.push(section('camp', `${INTERESTS.camp.icon} Camping`, body || '<p class="muted">No campgrounds mapped within ~7 mi.</p>'));
  }
  return out.join('');
}

function foodHtml(f) {
  const cuisine = (it) => (it.tags.cuisine ? esc(it.tags.cuisine.replace(/;/g, ', ').replace(/_/g, ' ')) : '');
  const body = listBlock('🛒 Groceries — cheapest way to eat', f.groceries,
    (it) => itemRow(it, '🛒', ({ supermarket: 'Supermarket', greengrocer: 'Produce', bakery: 'Bakery', deli: 'Deli', butcher: 'Butcher', convenience: 'Convenience store' })[it.tags.shop] || 'Shop',
      it.name ? reviewsLink(it.name) : ''), 6)
    + listBlock('🥪 Cheap eats (cafés, takeaway)', f.cheap, (it) => itemRow(it, it.tags.amenity === 'cafe' ? '☕' : '🌯',
      it.tags.amenity === 'cafe' ? 'Café' : 'Takeaway', [cuisine(it), it.name ? reviewsLink(it.name) : ''].filter(Boolean).join(' · ')), 6)
    + listBlock('🍽️ Restaurants', f.restaurants, (it) => itemRow(it, '🍽️', it.tags.amenity === 'pub' ? 'Pub' : 'Restaurant',
      [cuisine(it), it.name ? reviewsLink(it.name) : ''].filter(Boolean).join(' · ')), 8);
  return (body || '<p class="muted">No food places mapped within ~2 mi.</p>')
    + '<p class="muted small">Free map data doesn’t include ratings or prices. Tap “Reviews &amp; hours” to check before you go.</p>';
}

function budgetHtml(ctx) {
  const { dates } = ctx;
  const people = 1;
  const rows = [];
  let lo = 0, hi = 0;
  const sel = state.stays.find((s) => s.id === state.selectedId);
  const cheapest = [...state.stays].sort((a, b) => a.price.range[0] - b.price.range[0])[0];
  const stay = sel || cheapest;
  if (stay) {
    const [a, b] = stay.price.range;
    rows.push([`Lodging: ${esc(stay.name)} × ${dates.nights} night${dates.nights > 1 ? 's' : ''}`, a * dates.nights, b * dates.nights]);
  }
  if (ctx.flightRT) rows.push(['Round-trip flight (typical, per person)', ...ctx.flightRT]);
  else if (ctx.drive) {
    const mi = ctx.drive.meters / 1000 / KM_PER_MI;
    const gas = (2 * mi / COSTS.mpg) * ((state.place.address?.country_code || 'us') === 'us' ? COSTS.gasUS : COSTS.gasAbroad);
    rows.push(['Gas, round trip (whole car)', gas, gas]);
  }
  const days = dates.nights + 1;
  rows.push([`Groceries, ${days} days (cooking your own)`, COSTS.groceriesPerDay[0] * days * people, COSTS.groceriesPerDay[1] * days * people]);
  for (const r of rows) { lo += r[1]; hi += r[2]; }
  const body = `<table class="budget">${rows.map(([l, a, b]) => `<tr><td>${l}</td><td>${a === b ? money(a) : `${money(a)}–${money(b)}`}</td></tr>`).join('')}
    <tr class="total"><td>Estimated total</td><td>${money(lo)}–${money(hi)}</td></tr></table>
    <p class="muted small">Estimates for one person. Lift tickets, rentals and park entry aren’t included; check those on the resort or park website.
    ${stay && !sel ? 'Pick a stay on the Stays tab to use its price instead of the cheapest one.' : ''}</p>`;
  return section('budget', '💵 Trip budget (estimate)', body);
}

// A simple draft itinerary from what's nearby: one main activity per full day, groceries on arrival
function itineraryHtml(ctx) {
  const { dates, acts, food, interests } = ctx;
  const nearest = (arr) => arr && arr[0];
  const pool = [];
  if (interests.has('ski') && (acts.lifts.length || acts.skiAreas.length)) {
    const l = nearest(acts.lifts);
    pool.push(`⛷️ Ski or ride${acts.skiAreas[0]?.name ? ` at <b>${esc(acts.skiAreas[0].name)}</b>` : ''}${l ? `. Closest lift: <b>${esc(l.name || l.kind)}</b> (${fmtDist(l.d)})` : ''}. Pack lunch from the grocery store to skip mountain prices.`);
  }
  if (interests.has('mtb') && acts.mtb.length) pool.push(`🚵 Ride <b>${esc(acts.mtb[0].name)}</b>${acts.bikeRent[0] ? `; rent a bike at <b>${esc(acts.bikeRent[0].name || 'the nearest bike shop')}</b>` : ''}.`);
  if (interests.has('hike') && (acts.hiking.length || acts.trailheads.length)) {
    const h = acts.hiking[0] || acts.trailheads[0];
    pool.push(`🥾 Hike <b>${esc(h.name || 'from the nearest trailhead')}</b>${acts.viewpoints[0] ? `, with a stop at <b>${esc(acts.viewpoints[0].name)}</b>` : ''}.`);
  }
  if (interests.has('kayak') && acts.paddle.length) pool.push(`🛶 Paddle from <b>${esc(acts.paddle[0].name || 'the nearest launch')}</b> (${fmtDist(acts.paddle[0].d)}).`);
  if (interests.has('parks') && acts.parks.length) pool.push(`🏞️ Spend the day in <b>${esc(acts.parks[0].name)}</b>.`);
  if (interests.has('road') && acts.road.length) pool.push(`🚴 Ride the <b>${esc(acts.road[0].name)}</b> route.`);
  if (!pool.length && acts.viewpoints.length) pool.push(`🔭 Walk to <b>${esc(acts.viewpoints[0].name)}</b>.`);

  const g = food.groceries.find((x) => x.tags.shop === 'supermarket') || food.groceries[0];
  const eat = food.cheap[0] || food.restaurants[0];
  const days = [];
  for (let i = 0; i <= dates.nights; i++) {
    const date = addDays(dates.start, i);
    let plan;
    if (i === 0) plan = `Travel day. Check in, then ${g ? `stock up at <b>${esc(g.name || 'the nearest grocery store')}</b> (${fmtDist(g.d)})` : 'find groceries'}${pool[0] && dates.nights === 1 ? `, and if there's daylight: ${pool[0]}` : '.'}`;
    else if (i === dates.nights) plan = `${pool.length && dates.nights > 1 ? `Morning: ${pool[(i - 1) % pool.length]} ` : ''}Head home.`;
    else plan = pool.length ? pool[(i - 1) % pool.length] : 'Explore around town.';
    if (i > 0 && i < dates.nights && eat) plan += ` Dinner: cook at your stay, or <b>${esc(eat.name)}</b> for something cheap.`;
    days.push(`<li><b>${niceDate(date)}</b> — ${plan}</li>`);
  }
  return section('itinerary', '📅 Draft day-by-day plan', `<ol class="days">${days.join('')}</ol>
    <p class="muted small">Built automatically from what's mapped nearby. An AI-written, fully detailed itinerary is the next step (Phase 2).</p>`);
}

// ---------- Plan a trip ----------
async function planTrip() {
  if (!state.place || trip.planning) return;
  trip.planning = true;
  T.plan.disabled = true;
  showTab('trip');
  tripLayer.clearLayers();
  markerIndex.clear();

  const place = state.place;
  const sel = state.stays.find((s) => s.id === state.selectedId);
  const base = sel ? { lat: sel.lat, lon: sel.lon, label: sel.name } : { lat: place.lat, lon: place.lon, label: shortName(place.display_name) };
  trip.base = base;
  const dates = tripDates();
  const interests = new Set(trip.interests);
  const status = (html) => { T.tripPanel.innerHTML = `<p class="status"><span class="spinner"></span>${html}</p>`; };

  try {
    status('Getting your departure location…');
    let from = null;
    try { from = await resolveFrom(); } catch (err) { setMsg(esc(err.message), true); }

    status('Checking routes, fares and weather…');
    const straight = from ? haversine(from, place) : Infinity;
    const [drive, wx, flight] = await Promise.all([
      from && straight < 1500000 ? driveRoute(from, place) : null,
      weatherFor(place, dates.start, dates.nights).catch(() => null),
      from ? flightInfo(from, place, dates).catch((err) => { console.error(err); return null; }) : null,
    ]);
    const ctx = { from, dest: place, dates, flight, drive, place, interests };

    // Render what we have, then fill in activities and food
    const header = `<div class="trip-head">
        <h3>Trip to ${esc(shortName(place.display_name))}</h3>
        <div class="muted">${niceDate(dates.start)} – ${niceDate(dates.end)} · ${dates.nights} night${dates.nights > 1 ? 's' : ''}
        ${from ? ` · from ${esc(from.label)}` : ''}</div>
        <div class="muted small">Distances measured from <b>${esc(base.label)}</b>${sel ? '' : ' (pick a stay on the Stays tab to measure from it)'}.</div>
      </div>`;
    const travel = section('travel', '🧭 Getting there', gettingThereHtml(ctx));
    const weather = section('weather', '🌤️ Weather', weatherHtml(wx));
    T.tripPanel.innerHTML = header + travel + weather + `<p class="status" id="trip-loading"><span class="spinner"></span>Finding trails, lifts, launches and parks…</p>`;

    let tries = 0;
    const queries = [foodQuery(base), ...activityQueries(base, interests)];
    const results = await runQueries(queries, () => {
      const el = document.getElementById('trip-loading');
      if (el) el.innerHTML = `<span class="spinner"></span>Map-data server is busy, retrying (${++tries})… This can take a minute.`;
    });
    const food = classifyFood(results[0].elements || [], base);
    const acts = classify(results.slice(1).flatMap((r) => r.elements || []), base);
    const failed = results.filter((r) => r.failed).length;
    Object.assign(ctx, { acts, food });

    const warn = failed
      ? `<p class="status error">The free map-data server was too busy for ${failed} of ${results.length} searches, so some places may be missing. Press Plan again in a minute to fill them in.</p>`
      : '';
    T.tripPanel.innerHTML = header + warn + itineraryHtml(ctx) + travel + weather + activitiesHtml(acts, interests)
      + section('food', '🍴 Food', foodHtml(food)) + budgetHtml(ctx);

    // Map: everything in the plan
    const pinFor = {
      lifts: '🚡', skiAreas: '⛷️', skiShops: '🎿', bikeRent: '🔧', mtb: '🚵', road: '🚴', hiking: '🥾', trailheads: '🚩',
      huts: '🛖', viewpoints: '🔭', camps: '⛺', paddle: '🛶', parks: '🏞️',
    };
    const wanted = {
      lifts: 'ski', skiAreas: 'ski', skiShops: 'ski', bikeRent: 'mtb', mtb: 'mtb', road: 'road', hiking: 'hike', trailheads: 'hike',
      huts: 'hike', viewpoints: 'hike', camps: 'camp', paddle: 'kayak', parks: 'parks',
    };
    for (const [k, items] of Object.entries(acts)) {
      if (!interests.has(wanted[k]) && !(k === 'bikeRent' && interests.has('road'))) continue;
      for (const it of items.slice(0, 40)) {
        if (it.area && k !== 'parks') continue; // long routes: listed, not pinned
        addMarker(it, pinFor[k], `<h4>${pinFor[k]} ${esc(it.name || it.kind || 'Unnamed')}</h4>${distText(it)}`);
      }
    }
    for (const [k, icon] of [['groceries', '🛒'], ['cheap', '🥪'], ['restaurants', '🍽️']]) {
      for (const it of food[k].slice(0, 15)) addMarker(it, icon, `<h4>${icon} ${esc(it.name || 'Unnamed')}</h4>${distText(it)}<div class="links">${it.name ? reviewsLink(it.name) : ''}</div>`);
    }
    T.tripPanel.querySelectorAll('.trip-item').forEach((li) => li.addEventListener('click', (e) => {
      if (!e.target.closest('a')) focusItem(li.dataset.id);
    }));
    map.invalidateSize();
    map.setView([base.lat, base.lon], 14); // town-level view of the plan's pins
  } catch (err) {
    console.error(err);
    T.tripPanel.innerHTML = `<p class="status error">${esc(err.message)}</p>`;
  } finally {
    trip.planning = false;
    T.plan.disabled = !state.place;
  }
}

// ---------- Plan me a weekend trip ----------
function weekendQuery(pt, interests) {
  const b = boxAround(pt, 250); // roughly 3–4 hours’ drive in any direction
  const parts = [];
  if (interests.has('ski')) parts.push(`nwr["landuse"="winter_sports"]["name"](${b});`);
  if (interests.has('parks') || interests.has('hike') || interests.has('camp') || interests.has('mtb') || interests.has('kayak') || interests.has('road')) {
    parts.push(`relation["boundary"="national_park"]["name"](${b});`, `way["boundary"="national_park"]["name"](${b});`,
      `relation["boundary"="protected_area"]["protect_class"="2"]["name"](${b});`);
  }
  return `[out:json][timeout:60];(${parts.join('')});out tags bb 250;`;
}

async function planWeekend() {
  showTab('trip');
  tripLayer.clearLayers();
  markerIndex.clear();
  T.tripPanel.innerHTML = '<p class="status"><span class="spinner"></span>Getting your departure location…</p>';
  let from;
  try { from = await resolveFrom(); } catch (err) { setMsg(esc(err.message), true); }
  if (!from) {
    T.tripPanel.innerHTML = '<p class="status error">Enter where you’re leaving from (or tap 📍) first.</p>';
    T.setup.open = true;
    T.from.focus();
    return;
  }
  T.date.value = ymd(nextFriday());
  T.nights.value = '2';
  const interests = new Set(trip.interests);

  const go = (name, lat, lon, cc, radius = +els.radius.value) => {
    els.q.value = name;
    els.radius.value = String(radius);
    // Start planning as soon as the place is set; stays keep loading in the background
    document.addEventListener('place-changed', () => planTrip(), { once: true });
    search(name, radius, { lat, lon, display_name: name, address: { country_code: cc } });
  };

  try {
    // 1) Cheap short flights from the departure city (US only, DOT data): instant, no map server needed
    const cities = await loadCities();
    let flights = [];
    const home = dotCity(cities, from);
    if (home) {
      for (const [otherId, f] of Object.entries(await loadRoutes(home.id))) {
        if (f.mi > 1200) continue;
        const other = cities.cities[otherId];
        if (!other) continue;
        const last = f.q[f.q.length - 1];
        flights.push({ city: other, low: last[2], avg: last[1], carrier: last[3], q: last[0], mi: f.mi });
      }
      flights.sort((x, y) => x.low - y.low);
      flights = flights.slice(0, 10);
    }
    const flightRows = flights.map((f, i) => `<li class="trip-item">
        <span class="ti-icon">✈️</span>
        <span class="ti-main"><b>${esc(f.city.n)}</b>
        <span class="ti-sub">${f.mi.toLocaleString()} mi · ${esc(carrierName(f.carrier))} averaged <b>${money(f.low)}</b> one-way (${f.q}; overall avg ${money(f.avg)})</span></span>
        <button type="button" class="mini" data-fly="${i}">Plan this</button></li>`).join('');

    T.tripPanel.innerHTML = `<div class="trip-head"><h3>Weekend ideas from ${esc(from.label)}</h3>
        <div class="muted">${niceDate(nextFriday())} – ${niceDate(addDays(nextFriday(), 2))} · tap “Plan this” for the full plan</div></div>`
      + section('drive', '🚗 Within a few hours’ drive', '<p class="status"><span class="spinner"></span>Looking for ski areas and national parks nearby… (the free map server can take a minute)</p>')
      + section('fly', '✈️ Cheap short flights', flightRows
        ? `<ul class="trip-list">${flightRows}</ul><p class="muted small">Lowest-fare airline's average one-way fare, US DOT Consumer Airfare Report. Not a quote: check live prices in the plan.</p>`
        : '<p class="muted">Flight ideas use US government fare data, so they’re only available when leaving from a US city with an airport.</p>');
    T.tripPanel.querySelectorAll('[data-fly]').forEach((b) => b.onclick = () => {
      const f = flights[+b.dataset.fly];
      go(f.city.n, f.city.lat, f.city.lon, 'us');
    });

    // 2) Outdoor spots within a few hours' drive (OpenStreetMap)
    let drives = [];
    let failed = false;
    try {
      const j = await overpass(weekendQuery(from, interests), () => {}, 60000, 1);
      const seen = new Set();
      for (const el of j.elements || []) {
        const t = el.tags || {};
        if (!el.bounds || seen.has(t.name)) continue;
        seen.add(t.name);
        const lat = (el.bounds.minlat + el.bounds.maxlat) / 2, lon = (el.bounds.minlon + el.bounds.maxlon) / 2;
        const d = haversine(from, { lat, lon });
        drives.push({ name: t.name, lat, lon, d, kind: t.landuse === 'winter_sports' ? 'ski' : 'park' });
      }
      drives.sort((a, b) => a.d - b.d);
      // Keep both kinds visible: the nearest ski areas and the nearest parks
      drives = [...drives.filter((p) => p.kind === 'ski').slice(0, 8), ...drives.filter((p) => p.kind === 'park').slice(0, 6)];
    } catch (err) { console.error(err); failed = true; }

    const estHours = (m) => (m / 1000 * 1.3) / 85; // road distance ≈ 1.3 × straight line, ~85 km/h average
    const row = (p, i) => `<li class="trip-item" data-i="${i}">
        <span class="ti-icon">${p.kind === 'ski' ? '⛷️' : '🏞️'}</span>
        <span class="ti-main"><b>${esc(p.name)}</b>
        <span class="ti-sub">${fmtDist(p.d)} away · about ${estHours(p.d).toFixed(1)} h drive (estimate)</span></span>
        <button type="button" class="mini" data-go="${i}">Plan this</button></li>`;
    const group = (kind, title) => {
      const rows = drives.map((p, i) => (p.kind === kind ? row(p, i) : '')).join('');
      return rows ? `<h4>${title}</h4><ul class="trip-list">${rows}</ul>` : '';
    };
    const driveRows = group('park', 'National parks') + group('ski', 'Ski areas');
    const driveBody = document.querySelector('#sec-drive .sec-body');
    if (!driveBody) return; // the user moved on to something else
    driveBody.innerHTML = driveRows
      ? driveRows
      : `<p class="muted">${failed ? 'The free map server is busy right now. Press “Plan me a weekend trip” again in a minute.' : 'No ski areas or national parks found within a few hours’ drive.'}</p>`;

    for (const [i, p] of drives.entries()) addMarker({ id: `wk${i}`, ...p }, p.kind === 'ski' ? '⛷️' : '🏞️', `<h4>${esc(p.name)}</h4>${fmtDist(p.d)} away`);
    if (drives.length) map.fitBounds(L.latLngBounds([[from.lat, from.lon], ...drives.map((p) => [p.lat, p.lon])]).pad(0.1));
    driveBody.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => {
      const p = drives[+b.dataset.go];
      go(p.name, p.lat, p.lon, from.cc, 8047); // parks and ski areas are big: look for stays within 5 mi
    });
    driveBody.querySelectorAll('.trip-item[data-i]').forEach((li) => li.addEventListener('click', (e) => {
      if (!e.target.closest('button')) focusItem(`wk${li.dataset.i}`);
    }));
  } catch (err) {
    console.error(err);
    T.tripPanel.innerHTML = `<p class="status error">${esc(err.message)}</p>`;
  }
}

// ---------- Wiring ----------
T.plan.addEventListener('click', planTrip);
T.weekend.addEventListener('click', planWeekend);
document.addEventListener('place-changed', (e) => {
  T.plan.disabled = false;
  T.plan.textContent = `🧭 Plan a trip to ${shortName(e.detail.display_name).split(',')[0]}`;
  tripLayer.clearLayers();
  markerIndex.clear();
});

loadSetup();
renderInterests();
T.date.value = ymd(nextFriday());
T.date.min = ymd(new Date());
