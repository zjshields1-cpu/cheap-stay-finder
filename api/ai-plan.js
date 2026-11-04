// POST /api/ai-plan  { trip }  → streams an AI-written itinerary (Markdown, plain-text stream).
// Pro accounts only. The trip summary is built in the browser from the planner's own data
// (OpenStreetMap places, DOT airfares, weather); Claude turns it into a full plan and may
// search the web for current details like lift-ticket prices or train times.
import Anthropic from '@anthropic-ai/sdk';
import { db, ensureSchema } from '../lib/db.js';
import { body, currentUser, onlyPost, send } from '../lib/auth.js';

const MODEL = 'claude-opus-5-5';
const DAILY_LIMIT = { regular: 20, demo: 10 }; // the demo login is public, so it gets a smaller cap
const MAX_TRIP_JSON = 40_000; // characters

const SYSTEM = `You are the trip planner inside Cheap Stay Finder, an app for budget travelers who love the outdoors.
You receive a JSON summary of one trip: where the traveler leaves from, the destination, dates, their outdoor
interests, and data the app already gathered (nearby places from OpenStreetMap with distances, cheapest stays with
estimated nightly prices, drive time and gas cost, nearest airports with typical US fares from the US DOT
Consumer Airfare Report, weather, groceries and cheap places to eat).

Write a complete, practical trip plan so the traveler never wonders what to do next. Priorities, in order:
1. Cheapest sensible choices: groceries over restaurants, hostels/camping over hotels, trains/buses over taxis,
   off-peak tickets, free activities.
2. Their interests: build each day around them, using the specific trails, lifts, launches and parks provided,
   with distances.
3. Realism: respect the season and the forecast (closed lifts, snow on trails, daylight), travel time, and rest.

Use web search (a few searches at most) only for things that change and matter to cost or feasibility:
lift-ticket or park-entry prices, whether lifts/trails are open on these dates, train or shuttle schedules
and fares. Mention what you found with a link. Never invent exact prices, times or opening dates: mark
anything you didn't verify as an estimate ("~$40, check before booking"). The DOT fares are historical
averages, not quotes.

Format: Markdown, scannable, no preamble and no closing offer. Use these sections:
## Trip at a glance  (2-3 lines plus an estimated total per person)
## Getting there  (step by step, the cheapest option first, what to book and where)
## Day by day  (### per day; morning / afternoon / evening with places, distances and food)
## Where to stay  (pick from the cheapest stays provided; say why)
## Eating cheaply  (grocery run, cheap eats)
## Budget  (a small table: item, estimate)
## Before you go  (a short checklist: bookings, gear, rentals, passes)
Keep it under about 900 words.`;

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment (set in Vercel)

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;

  // ---------- Who's asking, and are they allowed? ----------
  let user;
  try {
    await ensureSchema();
    user = await currentUser(req);
  } catch (err) {
    console.error('ai-plan auth failed', err);
    return send(res, 500, { error: 'Couldn’t check your account. Please try again.' });
  }
  if (!user) return send(res, 401, { error: 'Log in to use the AI trip planner.', code: 'login' });
  if (user.plan !== 'pro') {
    return send(res, 402, { error: 'AI-built trips are part of Pro.', code: 'upgrade' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return send(res, 500, { error: 'The AI service isn’t configured yet (missing ANTHROPIC_API_KEY).' });
  }

  const { trip } = body(req);
  const tripJson = JSON.stringify(trip ?? null);
  if (!trip || typeof trip !== 'object' || !trip.destination) {
    return send(res, 400, { error: 'Plan a trip first, then ask the AI to write it up.' });
  }
  if (tripJson.length > MAX_TRIP_JSON) return send(res, 400, { error: 'That trip has too much data to send.' });

  const limit = user.is_demo ? DAILY_LIMIT.demo : DAILY_LIMIT.regular;
  const [{ count }] = await db()`
    SELECT count(*)::int AS count FROM ai_plans
    WHERE user_id = ${user.id} AND created_at > now() - interval '24 hours'`;
  if (count >= limit) {
    return send(res, 429, { error: `You've used today's ${limit} AI trip plans. Try again tomorrow.` });
  }
  const [{ id: planId }] = await db()`
    INSERT INTO ai_plans (user_id, destination, model) VALUES (${user.id}, ${String(trip.destination).slice(0, 200)}, ${MODEL})
    RETURNING id`;

  // ---------- Stream the plan ----------
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');

  const messages = [{
    role: 'user',
    content: `Plan this trip. Data from the app:\n\n${tripJson}`,
  }];
  const usage = { input: 0, output: 0, searches: 0 };
  let status = 'done';

  try {
    // A long web-search turn can pause; send it back to let the server continue (at most a few times).
    for (let round = 0; round < 3; round++) {
      const stream = anthropic.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default', // if a safety classifier declines, Anthropic retries on its recommended model
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: SYSTEM,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
        messages,
      });
      stream.on('text', (text) => res.write(text));
      const message = await stream.finalMessage();

      usage.input += message.usage?.input_tokens ?? 0;
      usage.output += message.usage?.output_tokens ?? 0;
      usage.searches += message.usage?.server_tool_use?.web_search_requests ?? 0;

      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      if (message.stop_reason === 'refusal') {
        status = 'refused';
        res.write('\n\n_The AI couldn’t write this plan. Try changing the destination or interests._');
      } else if (message.stop_reason === 'max_tokens') {
        status = 'truncated';
        res.write('\n\n_The plan was cut short. Try fewer nights or interests._');
      }
      break;
    }
  } catch (err) {
    status = 'error';
    console.error('ai-plan failed', err);
    let msg = 'Something went wrong writing your plan. Please try again in a minute.';
    if (err instanceof Anthropic.RateLimitError) msg = 'The AI is busy right now. Please try again in a minute.';
    else if (err instanceof Anthropic.AuthenticationError) msg = 'The AI service key isn’t valid. (Check ANTHROPIC_API_KEY in Vercel.)';
    else if (err instanceof Anthropic.APIError && err.status === 400 && /credit/i.test(err.message)) {
      msg = 'The AI account is out of credit. (Add credit in the Anthropic console.)';
    }
    res.write(`\n\n**${msg}**`);
  } finally {
    await db()`
      UPDATE ai_plans SET input_tokens = ${usage.input}, output_tokens = ${usage.output},
        searches = ${usage.searches}, status = ${status}
      WHERE id = ${planId}`.catch((e) => console.error('ai-plan usage log failed', e));
    res.end();
  }
}
