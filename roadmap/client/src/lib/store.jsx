import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, cache } from './api.js';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

const emptySummary = { totalCompleted: 0, totalHours: 0, totalSpent: 0, notesWritten: 0, perPath: [] };

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [content, setContent] = useState(() => cache.getContent());
  const [progress, setProgress] = useState(() => cache.getProgress());
  const [summary, setSummary] = useState(emptySummary);
  const [badges, setBadges] = useState([]);
  const [nudge, setNudge] = useState(null);
  const [booting, setBooting] = useState(true);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [pendingCount, setPendingCount] = useState(() => cache.getOutbox().length);
  const [celebration, setCelebration] = useState(null);
  const [theme, setThemeState] = useState(() => localStorage.getItem('roadmap.theme') || 'system');
  const flushing = useRef(false);

  /* ------------------------------------------------------------------ theme */
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  const setTheme = useCallback(
    (next) => {
      setThemeState(next);
      localStorage.setItem('roadmap.theme', next);
      if (user) api.patch('/auth/me', { theme: next }).catch(() => {});
    },
    [user],
  );

  /* --------------------------------------------------------------- online-ness */
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  /* ------------------------------------------------------------------- content */
  const loadContent = useCallback(async () => {
    try {
      const fresh = await api.get('/content');
      setContent(fresh);
      cache.setContent(fresh);
      return fresh;
    } catch (err) {
      const cached = cache.getContent();
      if (cached) return cached;
      throw err;
    }
  }, []);

  const applyProgressPayload = useCallback((payload) => {
    if (payload.progress && Array.isArray(payload.progress)) {
      setProgress(payload.progress);
      cache.setProgress(payload.progress);
    }
    if (payload.summary) setSummary(payload.summary);
    if (payload.newBadges?.length || payload.milestones?.length) {
      setCelebration({ badges: payload.newBadges || [], milestones: payload.milestones || [] });
    }
  }, []);

  const loadProgress = useCallback(async () => {
    try {
      const [progressData, dashboard] = await Promise.all([api.get('/progress'), api.get('/progress/dashboard')]);
      setProgress(progressData.progress);
      cache.setProgress(progressData.progress);
      setSummary(progressData.summary);
      setBadges(dashboard.badges);
      setNudge(dashboard.nudge);
    } catch (err) {
      if (err.status !== 0) throw err;
      // Offline: keep whatever the cache has.
    }
  }, []);

  /* ---------------------------------------------------------------- outbox sync */
  const flushOutbox = useCallback(async () => {
    const queue = cache.getOutbox();
    if (!queue.length || flushing.current || !navigator.onLine) return;
    flushing.current = true;
    try {
      const result = await api.post('/progress/bulk', { updates: queue });
      cache.clearOutbox();
      setPendingCount(0);
      applyProgressPayload(result);
      setBadges((current) =>
        current.map((badge) =>
          result.newBadges?.some((b) => b.id === badge.id) ? { ...badge, earned: true } : badge,
        ),
      );
    } catch {
      // Still offline or the server is down — the queue stays for next time.
    } finally {
      flushing.current = false;
    }
  }, [applyProgressPayload]);

  useEffect(() => {
    if (online && user) flushOutbox();
  }, [online, user, flushOutbox]);

  /* -------------------------------------------------------------------- boot */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [me] = await Promise.all([
          api.get('/auth/me').catch((err) =>
            // A network failure is not a signed-out state: fall back to the
            // remembered user so the app opens offline. A 401 does clear it.
            err.status === 0 ? { user: cache.getUser() } : { user: null },
          ),
          loadContent().catch(() => null),
        ]);
        if (cancelled) return;
        setUser(me.user);
        cache.setUser(me.user);
        if (me.user) await loadProgress();
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadContent, loadProgress]);

  /* ------------------------------------------------------------------- actions */
  const login = useCallback(
    async (email, password) => {
      const { user: loggedIn } = await api.post('/auth/login', { email, password });
      setUser(loggedIn);
      cache.setUser(loggedIn);
      if (loggedIn.theme && loggedIn.theme !== theme) {
        setThemeState(loggedIn.theme);
        localStorage.setItem('roadmap.theme', loggedIn.theme);
      }
      await loadContent().catch(() => {});
      await loadProgress();
      return loggedIn;
    },
    [loadContent, loadProgress, theme],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
    setProgress([]);
    setSummary(emptySummary);
    setBadges([]);
    cache.setProgress([]);
    cache.setUser(null);
    cache.clearOutbox();
  }, []);

  const updateUser = useCallback(async (patch) => {
    const { user: updated } = await api.patch('/auth/me', patch);
    setUser(updated);
    cache.setUser(updated);
    return updated;
  }, []);

  /**
   * Optimistic step update. The local state moves immediately so the UI never
   * waits on the network; if the request fails the change is queued and
   * replayed later rather than being lost.
   */
  const updateStep = useCallback(
    async (stepId, pathId, patch) => {
      const now = new Date().toISOString();
      setProgress((current) => {
        const existing = current.find((r) => r.stepId === stepId);
        const merged = {
          stepId,
          pathId,
          status: patch.status ?? existing?.status ?? 'not_started',
          notes: patch.notes ?? existing?.notes ?? '',
          hoursLogged: patch.hoursLogged ?? existing?.hoursLogged ?? 0,
          costSpent: patch.costSpent ?? existing?.costSpent ?? 0,
          startedAt: existing?.startedAt ?? now,
          completedAt: (patch.status ?? existing?.status) === 'done' ? (existing?.completedAt ?? now) : null,
          updatedAt: now,
        };
        const next = existing
          ? current.map((r) => (r.stepId === stepId ? merged : r))
          : [...current, merged];
        cache.setProgress(next);
        return next;
      });

      try {
        const result = await api.put(`/progress/${stepId}`, patch);
        applyProgressPayload({ ...result, progress: undefined });
        setProgress((current) => {
          const next = current.map((r) => (r.stepId === stepId ? result.progress : r));
          cache.setProgress(next);
          return next;
        });
        if (result.newBadges?.length) {
          setBadges((current) =>
            current.map((badge) =>
              result.newBadges.some((b) => b.id === badge.id) ? { ...badge, earned: true, earnedAt: now } : badge,
            ),
          );
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 0) {
          const queue = cache.queue({ stepId, ...patch });
          setPendingCount(queue.length);
        } else {
          throw err;
        }
      }
    },
    [applyProgressPayload],
  );

  /* ------------------------------------------------------------------ lookups */
  const progressByStep = useMemo(() => new Map(progress.map((r) => [r.stepId, r])), [progress]);
  const pathsById = useMemo(() => new Map((content?.paths || []).map((p) => [p.id, p])), [content]);

  const value = {
    user,
    setUser,
    content,
    paths: content?.paths || [],
    pathsById,
    quiz: content?.quiz,
    badgeCatalog: content?.badges || [],
    progress,
    progressByStep,
    summary,
    badges,
    nudge,
    booting,
    online,
    pendingCount,
    celebration,
    dismissCelebration: () => setCelebration(null),
    theme,
    setTheme,
    login,
    logout,
    updateUser,
    updateStep,
    refresh: loadProgress,
    flushOutbox,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
