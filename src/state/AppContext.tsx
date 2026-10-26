import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getSettings, saveSettings, ensureInitialised } from '../lib/db';
import { readSession, login as authLogin, logout as authLogout, writeSession } from '../lib/auth';
import { listUsers, primeSettingsSnapshot, runAutomatedChecks, updateSettings as persistSettings } from '../lib/repo';
import { unreadNotifications } from '../lib/queries';
import { markNotificationRead as markReadRepo, markAllNotificationsRead as markAllReadRepo } from '../lib/repo';
import type { AppNotification, AppSettings, Permission, PublicUser } from '../lib/types';
import { DEFAULT_ROLES } from '../lib/types';
import { primeAudio, playChime, playAlert } from '../lib/sound';
import { onBump } from '../lib/bus';
import { CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; message: string; kind: ToastKind }

interface AppContextValue {
  ready: boolean;
  setupRequired: boolean;
  settings: AppSettings;
  user: PublicUser | null;
  roles: Record<string, Permission[]>;
  can: (permission: Permission | Permission[]) => boolean;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  saveAppSettings: (next: AppSettings) => Promise<void>;
  setUser: (user: PublicUser) => void;
  toast: (message: string, kind?: ToastKind) => void;
  notifySound: () => void;
  alertSound: () => void;
  notifications: AppNotification[];
  unreadCount: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [user, setUserState] = useState<PublicUser | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnread] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const refreshNotifications = useCallback(async () => {
    const { items, unread } = await unreadNotifications();
    setNotifications(items);
    setUnread(unread);
  }, []);

  const refresh = useCallback(async () => {
    const s = await getSettings();
    primeSettingsSnapshot(s);
    setSettings(s);
    const session = readSession();
    if (session) {
      const users = await listUsers();
      const found = users.find((u) => u.id === session.userId && u.active);
      setUserState(found ?? null);
      if (found) {
        await runAutomatedChecks();
        await refreshNotifications();
      }
    } else {
      setUserState(null);
    }
  }, [refreshNotifications]);

  useEffect(() => {
    (async () => {
      try {
        await ensureInitialised();
        await refresh();
      } catch (err) {
        console.error('Boot failed', err);
      } finally {
        setReady(true);
      }
    })();
  }, [refresh]);

  useEffect(() => {
    const unsub = onBump(() => {
      void refreshNotifications();
    });
    return unsub;
  }, [refreshNotifications]);

  useEffect(() => {
    const prime = () => primeAudio();
    window.addEventListener('pointerdown', prime, { once: true });
    window.addEventListener('keydown', prime, { once: true });
    return () => {
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const notifySound = useCallback(() => {
    if (!settings?.notifications.soundEnabled) return;
    if (!user?.preferences.sound) return;
    const vol = (settings.notifications.volume / 100) * ((user?.preferences.volume ?? 70) / 100);
    playChime(vol);
  }, [settings, user]);

  const alertSound = useCallback(() => {
    if (!settings?.notifications.soundEnabled) return;
    if (!user?.preferences.sound) return;
    const vol = (settings.notifications.volume / 100) * ((user?.preferences.volume ?? 70) / 100);
    playAlert(vol);
  }, [settings, user]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await authLogin(username, password);
    if (!res.ok) return { ok: false, error: res.error };
    setUserState(res.user);
    setSettings(res.settings);
    await runAutomatedChecks();
    await refreshNotifications();
    return { ok: true };
  }, [refreshNotifications]);

  const logout = useCallback(async () => {
    await authLogout(user?.id, user?.name);
    setUserState(null);
    setNotifications([]);
    setUnread(0);
  }, [user]);

  const saveAppSettings = useCallback(async (next: AppSettings) => {
    await persistSettings(next, { id: user?.id ?? 'system', name: user?.name ?? 'System', role: user?.role });
    setSettings(next);
    await saveSettings(next);
  }, [user]);

  const setUser = useCallback((u: PublicUser) => {
    setUserState(u);
    const session = readSession();
    if (session && session.userId === u.id) writeSession(u.id, settings?.security.sessionHours ?? 12);
  }, [settings]);

  const markRead = useCallback(async (id: string) => {
    await markReadRepo(id, true);
    await refreshNotifications();
  }, [refreshNotifications]);

  const markAllRead = useCallback(async () => {
    await markAllReadRepo();
    await refreshNotifications();
  }, [refreshNotifications]);

  const roles = useMemo(() => settings?.roles ?? DEFAULT_ROLES, [settings]);

  const can = useCallback((permission: Permission | Permission[]) => {
    if (!user) return false;
    const list = roles[user.role] ?? [];
    const perms = Array.isArray(permission) ? permission : [permission];
    return perms.every((p) => list.includes(p));
  }, [roles, user]);

  const value: AppContextValue | null = settings && ready
    ? {
        ready, setupRequired: !settings.setupComplete, settings, user, roles, can,
        refresh, login, logout, saveAppSettings, setUser, toast, notifySound, alertSound,
        notifications, unreadCount, markRead, markAllRead, refreshNotifications
      }
    : null;

  if (!value) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">
          <svg width="42" height="42" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <rect width="48" height="48" rx="12" fill="#38271D" />
            <path d="M13 31.5 33.5 15" stroke="#B99A78" strokeWidth="3" strokeLinecap="round" />
            <circle cx="32" cy="32" r="6.5" stroke="#F6F1E9" strokeWidth="2.6" />
            <path d="M14 14h9l-4.5 7.5H14z" fill="#875B3E" />
          </svg>
        </div>
        <div className="spinner" />
        <p>Loading your workshop…</p>
      </div>
    );
  }

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'success' ? <CheckCircle2 size={16} /> : t.kind === 'error' ? <AlertTriangle size={16} /> : <Info size={16} />}
            <span>{t.message}</span>
            <button onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
