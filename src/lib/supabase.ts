import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabaseConfigurationError =
  'Supabase credentials missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.';

if (!isSupabaseConfigured) {
  console.warn(supabaseConfigurationError);
}

function createMissingSupabaseClient() {
  const throwMissingConfigError = () => {
    throw new Error(supabaseConfigurationError);
  };

  const handler: ProxyHandler<(...args: unknown[]) => never> = {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      return new Proxy(throwMissingConfigError, handler);
    },
    apply() {
      throwMissingConfigError();
    },
  };

  return new Proxy(throwMissingConfigError, handler);
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : (createMissingSupabaseClient() as unknown as ReturnType<typeof createClient>);
