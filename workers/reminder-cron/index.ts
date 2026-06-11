// Tiny scheduled Worker: pings the Pages sweep endpoint. Holds NO secrets —
// the Pages Function has the Supabase/Resend credentials.
// Deploy: node node_modules/wrangler/bin/wrangler.js deploy --config workers/reminder-cron/wrangler.toml
export interface Env {
  SWEEP_URL: string;
  CRON_KEY?: string;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await fetch(env.SWEEP_URL, {
      method: 'POST',
      headers: env.CRON_KEY ? { 'x-cron-key': env.CRON_KEY } : {},
    });
  },
};
