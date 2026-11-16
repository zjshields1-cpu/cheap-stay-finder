// GET /api/places?set=food|outdoor&lat=..&lon=..&radius=..  → nearby places from Geoapify
// (OpenStreetMap data on Geoapify's fast hosted servers). The API key stays on the server,
// results are cached in Neon for a week and shared by everyone, and a daily cap keeps
// usage inside Geoapify's free plan. When the cap is hit or Geoapify is down, the browser
// falls back to the public Overpass servers.
import { db, ensureSchema } from '../lib/db.js';
import { send } from '../lib/auth.js';

const SETS = {
  // Groceries and cheap places to eat
  food: {
    categories: [
      'commercial.supermarket', 'commercial.convenience', 'commercial.food_and_drink.bakery',
      'commercial.food_and_drink.deli', 'commercial.food_and_drink.fruit_and_vegetable', 'commercial.food_and_drink.butcher',
      'catering.restaurant', 'catering.fast_food', 'catering.cafe', 'catering.pub', 'catering.food_court',
    ],
    maxRadius: 5000,
  },
  // Outdoor extras (lifts and ski areas come from OpenSkiMap instead)
  outdoor: {
    categories: [
      'accommodation.hut', 'camping.camp_site', 'camping.caravan_site', 'tourism.attraction.viewpoint',
      'rental.bicycle', 'rental.boat', 'rental.ski', 'commercial.outdoor_and_sport.ski',
      'commercial.outdoor_and_sport.bicycle', 'commercial.outdoor_and_sport.water_sports',
      'leisure.spa', 'sport.swimming_pool', 'natural.water.hot_spring',
    ],
    maxRadius: 20000,
  },
  parks: { categories: ['national_park'], maxRadius: 60000 },
};
const CACHE_DAYS = 7;
const DAILY_CAP = 2500; // Geoapify's free plan allows 3,000 a day; leave headroom
const PAGE = 200;

export default async function handler(req, res) {
  const set = SETS[req.query.set];
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  const radius = Math.min(Number(req.query.radius) || 3000, set?.maxRadius || 0);
  if (!set || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || radius <= 0) {
    return send(res, 400, { error: 'Use set=food|outdoor|parks with lat, lon and radius.' });
  }
  if (!process.env.GEOAPIFY_API_KEY) return send(res, 503, { error: 'Place search isn’t configured yet.', code: 'no_key' });

  // Round the point (~100 m) so nearby searches share a cache entry
  const key = `${req.query.set}:${lat.toFixed(3)}:${lon.toFixed(3)}:${Math.round(radius / 500) * 500}`;
  try {
    await ensureSchema();
    const cached = await db()`
      SELECT data FROM place_cache WHERE cache_key = ${key} AND created_at > now() - make_interval(days => ${CACHE_DAYS})`;
    if (cached.length) {
      res.setHeader('X-Cache', 'hit');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).json(cached[0].data);
    }

    const [{ requests }] = await db()`
      INSERT INTO api_usage (day, service, requests) VALUES (current_date, 'geoapify', 1)
      ON CONFLICT (day, service) DO UPDATE SET requests = api_usage.requests + 1
      RETURNING requests`;
    if (requests > DAILY_CAP) return send(res, 429, { error: 'Daily place-search limit reached.', code: 'cap' });

    const url = new URL('https://api.geoapify.com/v2/places');
    url.searchParams.set('categories', set.categories.join(','));
    url.searchParams.set('filter', `circle:${lon},${lat},${Math.round(radius)}`);
    url.searchParams.set('bias', `proximity:${lon},${lat}`);
    url.searchParams.set('limit', String(PAGE));
    url.searchParams.set('lang', 'en');
    url.searchParams.set('apiKey', process.env.GEOAPIFY_API_KEY);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (!r.ok) {
      console.error('geoapify', r.status, (await r.text()).slice(0, 300));
      return send(res, 502, { error: 'Place search is unavailable right now.', code: 'upstream' });
    }
    const json = await r.json();

    // Keep only what the planner uses (OSM tags come through in datasource.raw when present)
    const places = (json.features || []).map((f) => {
      const p = f.properties || {};
      const raw = p.datasource?.raw || {};
      return {
        id: p.place_id,
        name: p.name || raw.name || null,
        lat: p.lat, lon: p.lon,
        categories: p.categories || [],
        tags: {
          cuisine: raw.cuisine, opening_hours: raw.opening_hours || p.opening_hours, website: raw.website || p.website,
          fee: raw.fee, stars: raw.stars, swimming_pool: raw.swimming_pool, sauna: raw.sauna,
          osm_type: raw.osm_type, osm_id: raw.osm_id,
        },
      };
    });
    const data = { source: 'geoapify', count: places.length, places };
    await db()`
      INSERT INTO place_cache (cache_key, data) VALUES (${key}, ${JSON.stringify(data)}::jsonb)
      ON CONFLICT (cache_key) DO UPDATE SET data = EXCLUDED.data, created_at = now()`;
    res.setHeader('X-Cache', 'miss');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).json(data);
  } catch (err) {
    console.error('places failed', err);
    send(res, 502, { error: 'Place search is unavailable right now.', code: 'error' });
  }
}
