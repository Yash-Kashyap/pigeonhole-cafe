import type { APIRoute } from 'astro';
import { jsonResponse } from '../../../lib/owner/http';
import { readServerEnv } from '../../../lib/server-env';
import { createServerSupabaseClient } from '../../../lib/supabase/server';

export const prerender = false;

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export const GET: APIRoute = async () => {
  const now = new Date();
  const today = dateFormatter.format(now);
  const currentTime = timeFormatter.format(now);
  try {
    const client = createServerSupabaseClient(readServerEnv());
    const [
      newOrders,
      bookingsToday,
      tonight,
      questions,
      nextBookings,
      latestOrders,
    ] = await Promise.all([
      client
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'new'),
      client
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('date', today)
        .in('status', ['confirmed', 'requested', 'seated']),
      client
        .from('bookings')
        .select('party_size')
        .eq('date', today)
        .gte('start_time', '17:00:00')
        .in('status', ['confirmed', 'seated']),
      client
        .from('assistant_logs')
        .select('*', { count: 'exact', head: true })
        .eq('handled', false)
        .or('answered.eq.false,unanswered_topic.not.is.null'),
      client
        .from('bookings')
        .select('id,code,name,start_time,party_size,status')
        .eq('date', today)
        .gte('start_time', currentTime)
        .in('status', ['confirmed', 'requested'])
        .order('start_time')
        .limit(5),
      client
        .from('orders')
        .select('id,code,name,pickup_at,subtotal,status,created_at')
        .order('created_at', { ascending: false })
        .limit(5),
    ]);
    const results = [
      newOrders,
      bookingsToday,
      tonight,
      questions,
      nextBookings,
      latestOrders,
    ];
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
    const seatsTonight = (tonight.data ?? []).reduce(
      (sum, row) => sum + Number(row.party_size),
      0,
    );
    return jsonResponse({
      date: today,
      stats: {
        newOrders: newOrders.count ?? 0,
        bookingsToday: bookingsToday.count ?? 0,
        seatsBookedTonight: seatsTonight,
        unansweredQuestions: questions.count ?? 0,
      },
      nextBookings: nextBookings.data ?? [],
      latestOrders: latestOrders.data ?? [],
    });
  } catch {
    return jsonResponse({ message: 'Today overview is unavailable.' }, 500);
  }
};
