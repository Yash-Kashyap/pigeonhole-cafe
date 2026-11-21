// Live checks for the owner AI endpoints. Requires migrations through 0006 and a running local server.
// It creates temporary ZZ TEST rows and removes them at the end. It never calls the AI model.
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';
import {
  clearKnowledgeOverrideCache,
  getKnowledgeOverrides,
} from '../src/lib/assistant/facts.ts';

process.loadEnvFile('.env');
const base = 'http://127.0.0.1:4321';
const service = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'User-Agent': 'PigeonholeCafe-owner-ai-check/1.0' } },
  },
);
const publicClient = createClient(
  process.env.PUBLIC_SUPABASE_URL,
  process.env.PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const credentials = readFileSync('.demo-credentials', 'utf8');
const ownerEmail = /^Email: (.+)$/m.exec(credentials)?.[1];
const ownerPassword = /^Password: (.+)$/m.exec(credentials)?.[1];
if (!ownerEmail || !ownerPassword)
  throw new Error('Run the demo seed before this suite.');

let failures = 0;
const createdLogs = new Set();
const createdOverrides = new Set();
const createdDailySummary = new Set();
const createdUsers = new Set();
const rateKeys = new Set();
const ok = (name, pass, extra = '') => {
  console.log(
    `${pass ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`,
  );
  if (!pass) failures += 1;
};
const hash = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
const signExpiry = async (expiresAt) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(process.env.RATE_LIMIT_SALT),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(String(expiresAt)),
    ),
  );
  return `${expiresAt}.${Buffer.from(signature).toString('base64url')}`;
};
const cookieFor = async (session) => {
  const expiresAt = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  return `ph_owner_at=${session.access_token}; ph_owner_rt=${session.refresh_token}; ph_owner_exp=${await signExpiry(expiresAt)}`;
};
const write = async (path, method, body, cookie) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json;
  try {
    json = await response.json();
  } catch {
    json = { message: 'Response was not JSON.' };
  }
  return { status: response.status, json };
};
const get = async (path, cookie) => {
  const response = await fetch(`${base}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  let json;
  try {
    json = await response.json();
  } catch {
    json = { message: 'Response was not JSON.' };
  }
  return { status: response.status, json };
};
const ownerSignedIn = await publicClient.auth.signInWithPassword({
  email: ownerEmail,
  password: ownerPassword,
});
if (ownerSignedIn.error || !ownerSignedIn.data.session)
  throw ownerSignedIn.error ?? new Error('Owner sign-in failed.');
const ownerCookie = await cookieFor(ownerSignedIn.data.session);
const ownerWriteKey = await hash(
  `${process.env.RATE_LIMIT_SALT}:owner-write:${ownerSignedIn.data.user.id}`,
);
rateKeys.add(ownerWriteKey);
try {
  const anonymous = await get('/api/owner/questions');
  ok(
    'unauthenticated request is rejected',
    anonymous.status === 401,
    String(anonymous.status),
  );

  const suffix = Date.now();
  const nonOwnerEmail = `zz-test-owner-ai-${suffix}@example.com`;
  const nonOwnerPassword = `${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url')}Aa1!`;
  const createdUser = await service.auth.admin.createUser({
    email: nonOwnerEmail,
    password: nonOwnerPassword,
    email_confirm: true,
  });
  if (createdUser.error || !createdUser.data.user)
    throw createdUser.error ?? new Error('Temporary user creation failed.');
  createdUsers.add(createdUser.data.user.id);
  const nonOwnerLogin = await publicClient.auth.signInWithPassword({
    email: nonOwnerEmail,
    password: nonOwnerPassword,
  });
  if (nonOwnerLogin.error || !nonOwnerLogin.data.session)
    throw nonOwnerLogin.error ?? new Error('Temporary user sign-in failed.');
  const forbidden = await get(
    '/api/owner/questions',
    await cookieFor(nonOwnerLogin.data.session),
  );
  ok(
    'authenticated non-owner is rejected',
    forbidden.status === 403,
    String(forbidden.status),
  );

  const invalidAnswer = await write(
    '/api/owner/overrides',
    'POST',
    { question: 'x', answer: 'y' },
    ownerCookie,
  );
  ok(
    'strict answer validation rejects short input',
    invalidAnswer.status === 400,
    String(invalidAnswer.status),
  );
  const invalidQuery = await get('/api/owner/questions?page=0', ownerCookie);
  ok(
    'question pagination validation rejects page zero',
    invalidQuery.status === 400,
    String(invalidQuery.status),
  );

  const sessionId = `ZZ TEST session ${suffix}`;
  const userLog = await service
    .from('assistant_logs')
    .insert({
      session_id: sessionId,
      role: 'user',
      content: 'ZZ TEST Where can I park?',
      answered: true,
      unanswered_topic: null,
      handled: false,
      tool_calls: null,
      seeded: false,
      created_at: new Date(Date.now() - 1_000).toISOString(),
    })
    .select('id')
    .single();
  if (userLog.error || !userLog.data)
    throw userLog.error ?? new Error('Test guest row failed.');
  createdLogs.add(userLog.data.id);
  const questionLog = await service
    .from('assistant_logs')
    .insert({
      session_id: sessionId,
      role: 'assistant',
      content: 'ZZ TEST Where can I park?',
      answered: false,
      unanswered_topic: 'ZZ TEST Where can I park?',
      handled: false,
      tool_calls: [],
      seeded: false,
    })
    .select('id')
    .single();
  if (questionLog.error || !questionLog.data)
    throw questionLog.error ?? new Error('Test unanswered row failed.');
  createdLogs.add(questionLog.data.id);

  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const questions = await get(
    `/api/owner/questions?filter=unanswered&day=${day}&page=1`,
    ownerCookie,
  );
  const listed = questions.json?.questions?.find(
    (row) => row.id === questionLog.data.id,
  );
  ok(
    'question list includes guest question and excerpt',
    questions.status === 200 &&
      listed?.question === 'ZZ TEST Where can I park?' &&
      listed.excerpt.length <= 4,
    String(questions.status),
  );

  const answer = await write(
    `/api/owner/questions/${questionLog.data.id}/answer`,
    'POST',
    {
      question: 'ZZ TEST Where is parking?',
      answer: 'ZZ TEST Street parking is available nearby.',
    },
    ownerCookie,
  );
  ok(
    'answer and handled status are saved in one call',
    answer.status === 201 && answer.json?.handled === true,
    String(answer.status),
  );
  const handledRow = await service
    .from('assistant_logs')
    .select('handled')
    .eq('id', questionLog.data.id)
    .single();
  ok(
    'answer flow marks the question handled',
    handledRow.data?.handled === true,
  );
  const overrideId = answer.json?.id;
  if (overrideId) createdOverrides.add(overrideId);

  clearKnowledgeOverrideCache();
  const loaded = await getKnowledgeOverrides(async () => {
    const { data, error } = await service
      .from('knowledge_overrides')
      .select('question,answer')
      .order('created_at');
    if (error) throw error;
    return data ?? [];
  });
  ok(
    'next override load sees the newly taught answer',
    loaded.some(
      (row) => row.answer === 'ZZ TEST Street parking is available nearby.',
    ),
  );

  const overridePatch = await write(
    `/api/owner/overrides/${overrideId}`,
    'PATCH',
    { answer: 'ZZ TEST Updated parking answer.' },
    ownerCookie,
  );
  ok(
    'owner can edit a taught answer',
    overridePatch.status === 200 &&
      overridePatch.json?.override?.answer ===
        'ZZ TEST Updated parking answer.',
    String(overridePatch.status),
  );
  const overrideList = await get('/api/owner/overrides', ownerCookie);
  ok(
    'owner can list taught answers',
    overrideList.status === 200 &&
      overrideList.json?.overrides?.some((row) => row.id === overrideId),
    String(overrideList.status),
  );
  const overrideDelete = await write(
    `/api/owner/overrides/${overrideId}`,
    'DELETE',
    undefined,
    ownerCookie,
  );
  ok(
    'owner can delete a taught answer',
    overrideDelete.status === 200 && overrideDelete.json?.deleted === true,
    String(overrideDelete.status),
  );
  createdOverrides.delete(overrideId);

  const secondQuestion = await service
    .from('assistant_logs')
    .insert({
      session_id: `${sessionId} handled`,
      role: 'assistant',
      content: 'ZZ TEST mark this handled',
      answered: false,
      unanswered_topic: 'ZZ TEST mark this handled',
      handled: false,
      tool_calls: [],
      seeded: false,
    })
    .select('id')
    .single();
  if (secondQuestion.error || !secondQuestion.data)
    throw secondQuestion.error ?? new Error('Test handled row failed.');
  createdLogs.add(secondQuestion.data.id);
  const mark = await write(
    `/api/owner/questions/${secondQuestion.data.id}/handled`,
    'POST',
    {},
    ownerCookie,
  );
  ok(
    'mark as handled hides a question',
    mark.status === 200 && mark.json?.handled === true,
    String(mark.status),
  );

  const { data: currentOverrides, error: currentError } = await service
    .from('knowledge_overrides')
    .select('id');
  if (currentError) throw currentError;
  const fillersNeeded = Math.max(0, 50 - (currentOverrides?.length ?? 0));
  for (let index = 0; index < fillersNeeded; index += 1) {
    const { data, error } = await service
      .from('knowledge_overrides')
      .insert({
        question: `ZZ TEST cap question ${suffix}-${index}`,
        answer: `ZZ TEST cap answer ${suffix}-${index}`,
      })
      .select('id')
      .single();
    if (error || !data) throw error ?? new Error('Test cap override failed.');
    createdOverrides.add(data.id);
  }
  const capped = await write(
    '/api/owner/overrides',
    'POST',
    { question: 'ZZ TEST cap check?', answer: 'ZZ TEST cap reached.' },
    ownerCookie,
  );
  ok(
    '50 override cap returns a clear conflict',
    capped.status === 409 &&
      /50-answer limit/i.test(capped.json?.message ?? ''),
    String(capped.status),
  );

  const insights = await get('/api/owner/insights?range=7d', ownerCookie);
  ok(
    'aggregated insights endpoint returns a 7 day range',
    insights.status === 200 && insights.json?.insights?.range === '7d',
    String(insights.status),
  );

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const existingSummary = await service
    .from('daily_summaries')
    .select('day')
    .eq('day', today)
    .maybeSingle();
  if (existingSummary.error) throw existingSummary.error;
  if (!existingSummary.data) {
    const { error } = await service.from('daily_summaries').insert({
      day: today,
      content: JSON.stringify({ note: 'ZZ TEST cached summary' }),
    });
    if (error) throw error;
    createdDailySummary.add(today);
  }
  const cachedSummary = await write(
    '/api/owner/summary',
    'POST',
    {},
    ownerCookie,
  );
  ok(
    'summary POST returns the daily cache without calling the model',
    cachedSummary.status === 200 && cachedSummary.json?.summary?.day === today,
    String(cachedSummary.status),
  );
  const summaryGet = await get(`/api/owner/summary?day=${today}`, ownerCookie);
  ok(
    'summary GET returns the cached row',
    summaryGet.status === 200 && summaryGet.json?.summary?.day === today,
    String(summaryGet.status),
  );
} catch (error) {
  failures += 1;
  console.log(`FAIL: suite error: ${error?.message ?? error}`);
} finally {
  if (createdLogs.size)
    await service
      .from('assistant_logs')
      .delete()
      .in('id', [...createdLogs]);
  if (createdOverrides.size)
    await service
      .from('knowledge_overrides')
      .delete()
      .in('id', [...createdOverrides]);
  for (const day of createdDailySummary)
    await service
      .from('daily_summaries')
      .delete()
      .eq('day', day)
      .like('content', '%ZZ TEST%');
  if (createdUsers.size)
    await service.auth.admin.deleteUser([...createdUsers][0]);
  if (rateKeys.size)
    await service
      .from('rate_limits')
      .delete()
      .in('key', [...rateKeys]);
  console.log(
    `CLEANUP: ${createdLogs.size} assistant log rows, ${createdOverrides.size} overrides, ${createdDailySummary.size} daily summaries and ${createdUsers.size} temporary users targeted.`,
  );
  console.log(
    failures
      ? `\n${failures} OWNER AI CHECK(S) FAILED`
      : '\nALL OWNER AI CHECKS PASSED',
  );
  process.exit(failures ? 1 : 0);
}
