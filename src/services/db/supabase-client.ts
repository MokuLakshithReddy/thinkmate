import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://gtkvujspajcelzufpggr.supabase.co';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0a3Z1anNwYWpjZWx6dWZwZ2dyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNTk2ODcsImV4cCI6MjA5ODkzNTY4N30.xLVJ7azzc2RmVRT8pFocHfL745nzBk6PU3HXPbiMR60';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export function getServiceSupabaseClient() {
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0a3Z1anNwYWpjZWx6dWZwZ2dyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzM1OTY4NywiZXhwIjoyMDk4OTM1Njg3fQ.QU6cAcdrSR8o5yHgoecgdDrkh3gv4hA8a7KVGaLoldM';
  return createClient(supabaseUrl, serviceKey);
}
