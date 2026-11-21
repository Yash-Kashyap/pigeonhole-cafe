// Live evaluation for POST /api/assistant. It requires the dev server and configured services.
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';

const base = process.env.ASSISTANT_EVAL_BASE ?? 'http://127.0.0.1:4321';
const cases = JSON.parse(
  await readFile(
    new URL('../tests/assistant-eval.json', import.meta.url),
    'utf8',
  ),
);

const pause = Number(process.env.ASSISTANT_EVAL_PAUSE_MS ?? 12_000);

// The eval pins its clock with x-ph-test-now, so every run lands on the same
// fake day. That day's global message counter and token total must start and end
// at zero, otherwise repeated runs trip the real daily caps.
async function resetTestDays() {
  try {
    process.loadEnvFile('.env');
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY, RATE_LIMIT_SALT } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !RATE_LIMIT_SALT)
      throw new Error('missing env');
    const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
      global: {
        headers: { 'User-Agent': 'PigeonholeCafe-assistant-eval/1.0' },
      },
    });
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
    });
    const days = [
      ...new Set(cases.map((test) => formatter.format(new Date(test.now)))),
    ];
    const keys = [];
    for (const day of days) {
      const bytes = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          `${RATE_LIMIT_SALT}:assistant-global-day:${day}`,
        ),
      );
      keys.push(
        Array.from(new Uint8Array(bytes))
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join(''),
      );
    }
    const [{ error: usageError }, { error: limitError }] = await Promise.all([
      client.from('daily_usage').delete().in('day', days),
      client.from('rate_limits').delete().in('key', keys),
    ]);
    if (usageError || limitError) throw new Error('reset failed');
    console.log(`Test-day counters reset for: ${days.join(', ')}`);
  } catch {
    console.log('Test-day counters could not be reset.');
  }
}

await resetTestDays();

let passed = 0;
const failures = [];

function includes(value, expected) {
  return value
    .toLocaleLowerCase('en-US')
    .includes(expected.toLocaleLowerCase('en-US'));
}

function evaluate(test, body) {
  const problems = [];
  const text = String(body?.text ?? '');
  const actions = Array.isArray(body?.actions) ? body.actions : [];
  const ids = Array.isArray(body?.ids) ? body.ids : [];
  const expectation = test.expect ?? {};
  if (
    expectation.phrasesAny?.length &&
    !expectation.phrasesAny.some((phrase) => includes(text, phrase))
  )
    problems.push(`missing one of: ${expectation.phrasesAny.join(', ')}`);
  for (const phrase of expectation.phrasesAll ?? [])
    if (!includes(text, phrase)) problems.push(`missing: ${phrase}`);
  for (const phrase of expectation.notPhrases ?? [])
    if (includes(text, phrase)) problems.push(`forbidden phrase: ${phrase}`);
  if (expectation.noPhoneNumber && /(?:\+?\d[\d ()-]{7,}\d)/.test(text))
    problems.push('response contains a phone number');
  for (const type of expectation.actionTypes ?? [])
    if (!actions.some((action) => action?.type === type))
      problems.push(`missing action: ${type}`);
  for (const id of expectation.ids ?? [])
    if (!ids.includes(id)) problems.push(`missing id: ${id}`);
  for (const item of expectation.cartItems ?? []) {
    const found = actions
      .filter((action) => action?.type === 'cart_add')
      .flatMap((action) => action.items ?? [])
      .some((line) => line?.id === item.id && line?.qty === item.qty);
    if (!found) problems.push(`missing cart item: ${item.id} x${item.qty}`);
  }
  if (expectation.logged !== undefined && body?.logged !== expectation.logged)
    problems.push(`logged was ${String(body?.logged)}`);
  return problems;
}

// ASSISTANT_EVAL_ONLY="id1,id2" re-runs just those cases (session ids and test IPs
// stay tied to each case's position, so the cleanup below still covers them).
const only = process.env.ASSISTANT_EVAL_ONLY?.split(',').filter(Boolean);
let ran = 0;
for (const [index, test] of cases.entries()) {
  if (only?.length && !only.includes(test.id)) continue;
  ran += 1;
  const response = await fetch(`${base}/api/assistant`, {
    method: 'POST',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      'x-ph-test-ip': `198.51.100.${index + 1}`,
      'x-ph-test-now': test.now,
    },
    body: JSON.stringify({
      sessionId: `assistant-eval-${String(index + 1).padStart(2, '0')}`,
      messages: [{ role: 'user', text: test.prompt }],
      page: test.page,
      cart: [],
    }),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    // The failure below reports a non-JSON response without exposing headers.
  }
  const problems =
    response.status === 200
      ? evaluate(test, body)
      : [`HTTP ${response.status}`];
  if (!problems.length) {
    passed += 1;
    console.log(`PASS ${test.id}`);
  } else {
    failures.push({ id: test.id, problems, fallback: body?.fallback });
    console.log(`FAIL ${test.id}: ${problems.join('; ')}`);
    console.log(`  reply: ${String(body?.text ?? '(no text)').slice(0, 400)}`);
    if (body?.fallback) console.log(`  fallback: ${body.fallback}`);
  }
  // The free tier allows about 250K input tokens per minute and each call sends
  // roughly 14K, so back-to-back cases would measure the quota, not the answers.
  if (index < cases.length - 1) await sleep(pause);
}

await resetTestDays();

const passRate = ran ? (passed / ran) * 100 : 0;
console.log(`\n${passed}/${ran} passed (${passRate.toFixed(1)}%).`);
if (failures.length) {
  console.log('Failed cases:');
  for (const failure of failures)
    console.log(`- ${failure.id}: ${failure.problems.join('; ')}`);
  const fallbackCounts = {};
  for (const failure of failures) {
    if (failure.fallback) {
      fallbackCounts[failure.fallback] =
        (fallbackCounts[failure.fallback] ?? 0) + 1;
    }
  }
  const fallbackEntries = Object.entries(fallbackCounts);
  const fallbackSummary = fallbackEntries.length
    ? fallbackEntries.map(([kind, count]) => `${kind}: ${count}`).join(', ')
    : 'none';
  console.log(`Failures by fallback kind: ${fallbackSummary}`);
}

try {
  process.loadEnvFile('.env');
  const serviceUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const salt = process.env.RATE_LIMIT_SALT;
  if (!serviceUrl || !serviceKey || !salt)
    throw new Error('missing cleanup env');
  const client = createClient(serviceUrl, serviceKey, {
    auth: { persistSession: false },
    global: { headers: { 'User-Agent': 'PigeonholeCafe-assistant-eval/1.0' } },
  });
  const sessionIds = cases.map(
    (_test, index) => `assistant-eval-${String(index + 1).padStart(2, '0')}`,
  );
  const hash = async (value) =>
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
      ),
    )
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  const rateKeys = [];
  for (const [index, sessionId] of sessionIds.entries()) {
    rateKeys.push(
      await hash(`${salt}:assistant-ip:198.51.100.${index + 1}`),
      await hash(`${salt}:assistant-session:${sessionId}`),
    );
  }
  const [{ error: logError }, { error: rateError }] = await Promise.all([
    client.from('assistant_logs').delete().in('session_id', sessionIds),
    client.from('rate_limits').delete().in('key', rateKeys),
  ]);
  if (logError || rateError) throw new Error('cleanup failed');
  console.log('Evaluation logs and case-specific rate limits removed.');
} catch {
  console.log('Evaluation cleanup could not be completed.');
}
process.exit(passRate >= 95 ? 0 : 1);
