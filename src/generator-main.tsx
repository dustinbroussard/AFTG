import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SupabaseConfigNotice } from './components/SupabaseConfigNotice';
import { GeneratorApp } from './generator-app';
import { isSupabaseConfigured } from './lib/supabase';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSupabaseConfigured ? (
      <ErrorBoundary>
        <GeneratorApp />
      </ErrorBoundary>
    ) : (
      <SupabaseConfigNotice
        title="Supabase Dashboard Unavailable"
        description="The monitoring dashboard needs the same client-side Supabase environment variables before it can load."
      />
    )}
  </StrictMode>,
);
