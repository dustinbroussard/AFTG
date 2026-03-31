import React, { useEffect, useState } from 'react';
import { Database, Shield, Activity, RefreshCw, Layers } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface TableStats {
  name: string;
  count: number;
  loading: boolean;
  error?: string | null;
}

export function DatabaseDashboard() {
  const [tables, setTables] = useState<TableStats[]>([
    { name: 'questions', count: 0, loading: true },
    { name: 'games', count: 0, loading: true },
    { name: 'profiles', count: 0, loading: true },
    { name: 'user_settings', count: 0, loading: true },
    { name: 'game_invites', count: 0, loading: true },
    { name: 'recent_players', count: 0, loading: true },
    { name: 'game_messages', count: 0, loading: true },
  ]);

  const fetchStats = async (tableName: string) => {
    try {
      const { count, error } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });

      if (error) throw error;
      
      setTables(prev => prev.map(t => 
        t.name === tableName ? { ...t, count: count ?? 0, loading: false, error: null } : t
      ));
    } catch (err) {
      console.error(`[stats] Failed for ${tableName}:`, err);
      setTables(prev => prev.map(t => 
        t.name === tableName ? { ...t, loading: false, error: 'Access denied (RLS)' } : t
      ));
    }
  };

  const refreshAll = () => {
    setTables(prev => prev.map(t => ({ ...t, loading: true, error: null })));
    tables.forEach(t => fetchStats(t.name));
  };

  useEffect(() => {
    refreshAll();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database className="h-6 w-6 text-cyan-400 font-bold" />
          <h2 className="text-xl font-black uppercase tracking-widest italic">Supabase Real-Time Health</h2>
        </div>
        <button type="button" 
          onClick={refreshAll}
          className="p-2 theme-icon-button rounded-xl hover:theme-soft-surface transition-all flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-cyan-400"
        >
          <RefreshCw className="h-4 w-4" />
          Sync
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {tables.map((table) => (
          <div key={table.name} className="theme-panel-strong border rounded-2xl p-5 shadow-lg backdrop-blur-md relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-3 opacity-20 group-hover:opacity-40 transition-opacity">
               <Layers className="h-10 w-10" />
            </div>
            <p className="text-[0.625rem] font-black uppercase tracking-[0.25em] theme-text-muted mb-3 flex items-center gap-2">
              <Activity className="h-3 w-3" />
              Table
            </p>
            <h3 className="text-lg font-black tracking-tight mb-2 truncate pr-8">{table.name}</h3>
            {table.loading ? (
              <div className="h-8 w-16 bg-white/5 animate-pulse rounded-md" />
            ) : table.error ? (
              <div className="flex items-center gap-1.5 text-xs text-rose-400 font-bold">
                <Shield className="h-3 w-3" />
                {table.error}
              </div>
            ) : (
              <p className="text-3xl font-black text-white group-hover:text-cyan-400 transition-colors">
                 {table.count.toLocaleString()}
              </p>
            )}
          </div>
        ))}
      </div>
      
      <div className="theme-panel-strong border rounded-2xl p-6 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-2 mb-4">
           <Shield className="h-5 w-5 text-amber-400" />
           <h3 className="font-black uppercase tracking-widest text-sm">Security & RLS Status</h3>
        </div>
        <p className="theme-text-muted text-sm leading-relaxed mb-4">
           RLS (Row Level Security) is enabled on all tables. This dashboard reports counts based on the current user's session and the configured policies. If a table shows 'Access denied', it means the <code>public</code> role lacks <code>SELECT</code> permissions for that table.
        </p>
        <div className="flex flex-wrap gap-2">
           <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-full text-[0.625rem] font-black uppercase tracking-widest">Questions Open Read</span>
           <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-full text-[0.625rem] font-black uppercase tracking-widest">Auth RLS Enforced</span>
           <span className="px-3 py-1 bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-full text-[0.625rem] font-black uppercase tracking-widest">Admin Overrides Only</span>
        </div>
      </div>
    </div>
  );
}
