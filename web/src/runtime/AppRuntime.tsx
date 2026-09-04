import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type HealthInfo } from '@/services/api';

type RuntimeValue = {
  health: HealthInfo | null;
  git: any;
  notifications: any[];
  syncSummary: { attention: number; running: number; completed: number };
  loading: boolean;
  reload: () => Promise<void>;
};

const RuntimeContext = createContext<RuntimeValue | null>(null);

export function AppRuntimeProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [git, setGit] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [syncSummary, setSyncSummary] = useState({ attention: 0, running: 0, completed: 0 });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const [nextHealth, nextGit, nextNotifications, nextSync] = await Promise.all([
      api.health().catch(() => null),
      api.gitStatus({ fast: true, cache: true }).catch(() => null),
      api.listNotifications().catch(() => []),
      api.listSyncRecords().catch(() => ({ counts: { attention: 0, running: 0, completed: 0 } })),
    ]);
    setHealth(nextHealth);
    setGit(nextGit);
    setNotifications(nextNotifications);
    setSyncSummary(nextSync?.counts || { attention: 0, running: 0, completed: 0 });
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const value = useMemo(
    () => ({ health, git, notifications, syncSummary, loading, reload }),
    [git, health, loading, notifications, reload, syncSummary],
  );
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useAppRuntime() {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error('useAppRuntime must be used inside AppRuntimeProvider');
  return value;
}
