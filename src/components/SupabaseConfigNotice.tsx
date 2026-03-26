interface SupabaseConfigNoticeProps {
  title?: string;
  description?: string;
}

const DEFAULT_DESCRIPTION =
  'This app cannot start until the client-side Supabase environment variables are available.';

export function SupabaseConfigNotice({
  title = 'Supabase Setup Required',
  description = DEFAULT_DESCRIPTION,
}: SupabaseConfigNoticeProps) {
  return (
    <main className="min-h-screen app-theme flex items-center justify-center p-6">
      <section className="w-full max-w-2xl rounded-[2rem] border border-white/10 bg-black/30 p-8 shadow-2xl backdrop-blur-xl">
        <p className="text-xs font-black uppercase tracking-[0.35em] text-amber-300">Configuration</p>
        <h1 className="mt-4 text-4xl font-black uppercase italic text-white">{title}</h1>
        <p className="mt-4 text-base font-medium leading-7 theme-text-muted">{description}</p>

        <div className="mt-8 rounded-[1.5rem] border border-amber-400/20 bg-amber-400/10 p-5">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-200">Add these keys to `.env`</p>
          <pre className="mt-4 overflow-x-auto text-sm leading-7 text-amber-50">
{`VITE_SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="your-anon-key"`}
          </pre>
        </div>
      </section>
    </main>
  );
}
