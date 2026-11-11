// Realtime push for the play page: the server (GameServer and advanceAI)
// broadcasts a "moved" ping on game:<id> after every move, and useGame then
// re-fetches the redacted view, polling only every 30 s as a fallback. Before
// this every open tab polled every 4 s — most of A&A's Cloudflare requests,
// against the free plan's 100k/day account-wide budget.
//
// These are the shared framework Supabase project's PUBLIC values (the anon
// key is meant to ship in the browser; every table has RLS on and the channel
// carries no state).
import { subscribeSupabaseRealtime } from 'digital-boardgame-framework/client/realtime';

const SUPABASE_URL = 'https://nuvhxfrqutbfcvozfwrn.supabase.co';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51dmh4ZnJxdXRiZmN2b3pmd3JuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzNzgwNjMsImV4cCI6MjA5NTk1NDA2M30.MhyUz8WDH6oXjz8yVklcrcwvmm0n4zdqTYDoXg7mVfU';

export function subscribeMoves(gameId: string): (onChange: () => void) => () => void {
  return subscribeSupabaseRealtime({ supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY, gameId });
}
