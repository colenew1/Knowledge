import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. This tool runs as an internal utility with
 * no multi-tenant auth, so everything goes through the service role key.
 */
export function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local'
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
