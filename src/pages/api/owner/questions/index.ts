import type { APIRoute } from 'astro';
import { jsonResponse, queryObject } from '../../../../lib/owner/http';
import { questionsQuerySchema } from '../../../../lib/owner/ai';
import { readServerEnv } from '../../../../lib/server-env';
import { createServerSupabaseClient } from '../../../../lib/supabase/server';

export const prerender = false;
const PAGE_SIZE = 25;

function dayBounds(day: string) {
  const start = new Date(`${day}T00:00:00+05:30`);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 86_400_000).toISOString(),
  };
}

export const GET: APIRoute = async ({ url }) => {
  const raw = queryObject(url);
  const parsed = raw ? questionsQuerySchema.safeParse(raw) : null;
  if (!parsed?.success)
    return jsonResponse({ message: 'Check the question filters.' }, 400);
  try {
    const client = createServerSupabaseClient(readServerEnv());
    const from = (parsed.data.page - 1) * PAGE_SIZE;
    let query = client
      .from('assistant_logs')
      .select(
        'id,session_id,created_at,unanswered_topic,answered,handled,role',
        { count: 'exact' },
      )
      .eq('role', 'assistant')
      .eq('answered', false)
      .not('unanswered_topic', 'is', null)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (parsed.data.filter !== 'all') query = query.eq('handled', false);
    if (parsed.data.day) {
      const bounds = dayBounds(parsed.data.day);
      query = query
        .gte('created_at', bounds.start)
        .lt('created_at', bounds.end);
    }
    const { data: questions, error, count } = await query;
    if (error) throw error;
    const sessions = [
      ...new Set((questions ?? []).map((row) => row.session_id)),
    ];
    const logsBySession = new Map<
      string,
      { id: string; role: string; content: string; created_at: string }[]
    >();
    if (sessions.length) {
      const { data: logs, error: logsError } = await client
        .from('assistant_logs')
        .select('id,session_id,role,content,created_at')
        .in('session_id', sessions)
        .order('created_at');
      if (logsError) throw logsError;
      for (const log of logs ?? []) {
        const values = logsBySession.get(log.session_id) ?? [];
        values.push(log);
        logsBySession.set(log.session_id, values);
      }
    }
    const rows = (questions ?? []).map((row) => {
      const messages = logsBySession.get(row.session_id) ?? [];
      const rowIndex = messages.findIndex((message) => message.id === row.id);
      const prior = rowIndex < 0 ? [] : messages.slice(0, rowIndex);
      const guestQuestion =
        [...prior].reverse().find((message) => message.role === 'user')
          ?.content ?? '';
      const throughQuestion = (
        rowIndex < 0 ? [] : messages.slice(0, rowIndex + 1)
      ).slice(-4);
      return {
        id: row.id,
        time: row.created_at,
        unanswered_topic: row.unanswered_topic,
        question: guestQuestion,
        excerpt: throughQuestion.map(({ role, content, created_at }) => ({
          role,
          content: content.slice(0, 500),
          time: created_at,
        })),
        handled: row.handled,
      };
    });
    return jsonResponse({
      questions: rows,
      page: parsed.data.page,
      pageSize: PAGE_SIZE,
      total: count ?? 0,
    });
  } catch {
    return jsonResponse({ message: 'Questions are unavailable.' }, 500);
  }
};
