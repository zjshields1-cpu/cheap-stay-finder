// AI trip plan (Pro): sends a compact summary of the planner's data to /api/ai-plan and
// shows the itinerary as it streams in. Uses globals from app.js and trip.js.

// Tiny, safe Markdown renderer for the AI's answer: escapes everything, then allows headings,
// lists, tables, bold/italic, inline code and http(s) links.
function renderMarkdown(src) {
  const inline = (t) => esc(t)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, txt, url) => `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const lines = String(src).replace(/\r/g, '').split('\n');
  const out = [];
  let list = null, para = [], table = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => {
    if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; }
  };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((r) => !/^\|?\s*:?-{2,}/.test(r))
      .map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    const [head, ...rest] = rows;
    out.push(`<table class="md-table"><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
      rest.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    table = [];
  };
  const flushAll = () => { flushPara(); flushList(); flushTable(); };

  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); flushList(); table.push(line.trim()); continue; }
    if (table.length) flushTable();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flushAll();
      const n = Math.min(5, m[1].length + 2);
      out.push(`<h${n}>${inline(m[2])}</h${n}>`);
      continue;
    }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }
    flushList();
    para.push(line.trim());
  }
  flushAll();
  return out.join('');
}

// Everything the AI needs, from what the planner already found (kept to a few KB)
function aiTripPayload(ctx) {
  const { from, place, dates, interests, flight, drive, acts, food } = ctx;
  const miles = (m) => Math.round((m / 1609.344) * 100) / 100;
  const items = (arr, n, extra = () => ({})) => (arr || []).slice(0, n).map((it) => ({
    name: it.name || null, miles: miles(it.d), ...(it.area ? { distanceIsToNearestEdge: true } : {}), ...extra(it),
  }));
  const cheapest = [...state.stays]
    .sort((a, b) => a.price.tier - b.price.tier || a.price.range[0] - b.price.range[0]).slice(0, 6);
  const tip = CAR_FREE.find((c) => c.match.test(place.display_name));
  const wx = ctx.weather?.daily;
  return {
    destination: shortName(place.display_name),
    destinationFull: place.display_name,
    country: place.address?.country_code || null,
    leavingFrom: from ? from.label : null,
    startDate: ymd(dates.start),
    nights: dates.nights,
    interests: [...interests].map((k) => INTERESTS[k].label),
    distancesMeasuredFrom: trip.base?.label,
    travel: {
      drive: drive ? {
        miles: Math.round(drive.meters / 1609.344),
        hours: Math.round((drive.seconds / 3600) * 10) / 10,
        gasRoundTripUSD: ctx.budget?.items.find((i) => /^Gas/.test(i[0]))?.[1] ?? null,
      } : null,
      flight: flight ? {
        fromAirport: `${flight.A.c} (${flight.A.n})`,
        toAirport: `${flight.B.c} (${flight.B.n})`,
        toAirportMilesFromDestination: miles(flight.B.d),
        otherDestinationAirports: flight.toAp.slice(1).map((a) => `${a.c} (${a.n}), ${miles(a.d)} mi`),
        dotTypicalOneWayUSD: flight.fare ? {
          low: flight.fare.low,
          high: flight.fare.high,
          quarter: flight.fare.season[0],
          averageThatQuarter: flight.fare.season[1],
          cheapestAirline: carrierName(flight.fare.season[3]),
          cheapestAirlineAverage: flight.fare.season[2],
        } : 'none (the DOT data only covers flights within the US)',
      } : null,
      europeanRail: EUROPE.has(place.address?.country_code || ''),
      carFreeTip: tip ? tip.tip : null,
    },
    weather: wx ? {
      kind: ctx.weather.kind,
      days: wx.time.map((t, i) => ({
        date: t,
        conditions: wxIcon(wx.weather_code[i])[1],
        highF: Math.round(wx.temperature_2m_max[i]),
        lowF: Math.round(wx.temperature_2m_min[i]),
        precipIn: wx.precipitation_sum[i],
        snowfallIn: wx.snowfall_sum[i],
      })),
    } : null,
    cheapestStays: cheapest.map((s) => ({
      name: s.name,
      type: STAY_TYPES[s.type].label,
      estNightlyUSD: s.price.free ? 'free' : `${s.price.range[0]}-${s.price.range[1]}`,
      stars: s.stars,
      milesFromSearchPoint: miles(s.distCenter),
      chosenByTraveler: s.id === state.selectedId || undefined,
    })),
    nearby: {
      liftsDistanceToBottomStation: items(acts.lifts, 8, (it) => ({ type: it.kind, rideMinutes: it.tags['aerialway:duration'] })),
      skiAreas: items(acts.skiAreas, 4),
      skiShops: items(acts.skiShops, 3),
      mtbRoutes: items(acts.mtb, 5, (it) => ({ lengthKm: it.tags.distance, difficulty: it.tags['mtb:scale'] })),
      cyclingRoutes: items(acts.road, 5, (it) => ({ lengthKm: it.tags.distance })),
      bikeRentalsAndShops: items(acts.bikeRent, 4),
      hikingRoutes: items(acts.hiking, 6, (it) => ({ lengthKm: it.tags.distance })),
      trailheads: items(acts.trailheads, 4),
      huts: items(acts.huts, 4),
      viewpoints: items(acts.viewpoints, 4),
      paddling: items(acts.paddle, 5, (it) => ({ kind: it.tags.amenity || it.tags.leisure || it.tags.canoe || it.tags.sport })),
      nationalParks: items(acts.parks, 4),
      campgrounds: items(acts.camps, 4, (it) => ({ free: it.tags.fee === 'no' || undefined })),
    },
    food: {
      groceries: items(food.groceries, 5, (it) => ({ kind: it.tags.shop })),
      cheapEats: items(food.cheap, 5, (it) => ({ kind: it.tags.amenity, cuisine: it.tags.cuisine })),
      restaurants: items(food.restaurants, 6, (it) => ({ cuisine: it.tags.cuisine })),
    },
    appBudgetEstimate: ctx.budget,
  };
}

function aiSectionHtml() {
  return `<details class="trip-sec ai-sec" id="sec-ai" open>
    <summary>✨ AI trip plan <span class="pro-tag">PRO</span></summary>
    <div class="sec-body">
      <p>Turn everything below into one complete plan: the cheapest way there, what to do each day,
      where to eat, what it costs and what to book. Takes about a minute.</p>
      <button type="button" class="primary ai-btn">✨ Write my full trip plan</button>
      <div class="ai-msg muted small" role="status" aria-live="polite"></div>
      <div class="ai-out"></div>
    </div></details>`;
}

function wireAiSection(ctx) {
  const box = document.getElementById('sec-ai');
  if (!box) return;
  const btn = box.querySelector('.ai-btn');
  const msg = box.querySelector('.ai-msg');
  const out = box.querySelector('.ai-out');
  const here = encodeURIComponent('/app' + location.hash);

  btn.onclick = async () => {
    const user = await window.csfUser;
    if (!user) {
      msg.innerHTML = `<a href="/login?next=${here}">Log in</a> or <a href="/signup?next=${here}">create an account</a> to use the AI trip planner.`;
      return;
    }
    if (!user.isPro) {
      msg.innerHTML = 'AI-built trips are part of <b>Pro</b> ($7.99/month). <a href="/account?upgrade=1">Upgrade to Pro</a>';
      return;
    }
    btn.disabled = true;
    out.innerHTML = '';
    msg.innerHTML = '<span class="spinner"></span>Writing your plan… Checking current prices and schedules can take a minute.';
    let text = '';
    try {
      const res = await fetch('/api/ai-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ trip: aiTripPayload(ctx) }),
      });
      if (!res.ok) {
        let data = {};
        try { data = await res.json(); } catch { /* not JSON */ }
        if (data.code === 'login') msg.innerHTML = `<a href="/login?next=${here}">Log in</a> to use the AI trip planner.`;
        else if (data.code === 'upgrade') msg.innerHTML = 'AI-built trips are part of <b>Pro</b>. <a href="/account?upgrade=1">Upgrade to Pro</a>';
        else msg.textContent = data.error || `Something went wrong (${res.status}).`;
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let queued = false;
      const paint = () => { queued = false; out.innerHTML = renderMarkdown(text); };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (!queued) { queued = true; requestAnimationFrame(paint); }
      }
      text += decoder.decode();
      paint();
      msg.textContent = 'Done. Anything marked as an estimate: check it before you book.';
      btn.textContent = '↻ Write it again';
    } catch (err) {
      console.error(err);
      msg.textContent = 'The connection dropped while writing your plan. Please try again.';
      if (text) out.innerHTML = renderMarkdown(text);
    } finally {
      btn.disabled = false;
    }
  };
}
