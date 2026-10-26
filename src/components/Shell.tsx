import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, Bell, Boxes, Building2, Car, ChevronDown, ClipboardList, FileText, Hammer,
  HardHat, LayoutDashboard, Menu, Package, PanelLeftClose, PanelLeftOpen, Receipt, RotateCcw,
  ScanLine, Search, Settings, ShieldCheck, TrendingUp, Truck, UserCog, Users, Wallet, Wrench, X
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { APP_VERSION } from '../lib/types';
import { BrandLockup } from './Brand';
import { useLocalState } from './ui';
import { Avatar } from './ProfileDrawer';
import { ProfileDrawer } from './ProfileDrawer';
import { GlobalSearch } from './GlobalSearch';
import { markNotificationRead } from '../lib/repo';
import { relTime } from '../lib/money';
import type { Permission } from '../lib/types';
import { lowStockParts, listJobs } from '../lib/queries';
import { useAsync } from '../hooks/useAsync';

interface NavEntry { to: string; label: string; icon: React.ReactNode; perm: Permission }

const NAV: NavEntry[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={15} />, perm: 'dashboard.view' },
  { to: '/pos', label: 'POS Billing', icon: <ScanLine size={15} />, perm: 'pos.sell' },
  { to: '/jobcards', label: 'Job Cards', icon: <ClipboardList size={15} />, perm: 'jobcards.view' },
  { to: '/invoices', label: 'Invoices', icon: <FileText size={15} />, perm: 'invoices.view' },
  { to: '/shifts', label: 'Cash Shifts', icon: <Wallet size={15} />, perm: 'shifts.view' },
  { to: '/customers', label: 'Customers', icon: <Users size={15} />, perm: 'customers.view' },
  { to: '/vehicles', label: 'Vehicles', icon: <Car size={15} />, perm: 'vehicles.view' },
  { to: '/inventory', label: 'Inventory', icon: <Boxes size={15} />, perm: 'inventory.view' },
  { to: '/parts', label: 'Parts', icon: <Package size={15} />, perm: 'inventory.view' },
  { to: '/services', label: 'Services', icon: <Wrench size={15} />, perm: 'inventory.view' },
  { to: '/labor', label: 'Labor', icon: <Hammer size={15} />, perm: 'inventory.view' },
  { to: '/purchases', label: 'Purchases', icon: <Truck size={15} />, perm: 'purchases.view' },
  { to: '/suppliers', label: 'Suppliers', icon: <Building2 size={15} />, perm: 'suppliers.view' },
  { to: '/returns', label: 'Returns', icon: <RotateCcw size={15} />, perm: 'returns.view' },
  { to: '/warranty', label: 'Warranty', icon: <ShieldCheck size={15} />, perm: 'warranty.view' },
  { to: '/expenses', label: 'Expenses', icon: <Receipt size={15} />, perm: 'expenses.view' },
  { to: '/staff', label: 'Mechanics & Staff', icon: <HardHat size={15} />, perm: 'staff.view' },
  { to: '/reports', label: 'Reports', icon: <BarChart3 size={15} />, perm: 'reports.view' },
  { to: '/analytics', label: 'Analytics', icon: <TrendingUp size={15} />, perm: 'analytics.view' },
  { to: '/users', label: 'Users & Roles', icon: <UserCog size={15} />, perm: 'users.manage' },
  { to: '/settings', label: 'Settings', icon: <Settings size={15} />, perm: 'settings.manage' }
];

const NOTIF_ICON: Record<string, React.ReactNode> = {
  low_stock: <Boxes size={14} />,
  sale: <Receipt size={14} />,
  payment: <Wallet size={14} />,
  job_assigned: <Wrench size={14} />,
  job_ready: <ClipboardList size={14} />,
  warranty_expiry: <ShieldCheck size={14} />,
  purchase_received: <Truck size={14} />,
  shift_warning: <Wallet size={14} />,
  backup: <FileText size={14} />,
  system: <Bell size={14} />
};

const NEW_RECORD_TARGETS: { path: string; perm: Permission }[] = [
  { path: '/jobcards', perm: 'jobcards.manage' },
  { path: '/purchases', perm: 'purchases.manage' },
  { path: '/users', perm: 'users.manage' },
  { path: '/pos', perm: 'pos.sell' }
];

export function AppLayout() {
  const { user, settings, can, notifications, unreadCount, markAllRead, refreshNotifications } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useLocalState('servixa.sidebar.collapsed', false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState(false);
  const [bell, setBell] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  const nav = useMemo(() => NAV.filter((n) => can(n.perm)), [can]);
  const counts = useAsync(async () => {
    const [jobs, low] = await Promise.all([listJobs({ page: 1, size: 500 }), lowStockParts()]);
    return {
      jobs: jobs.items.filter((j) => ['draft', 'awaiting_approval', 'approved', 'in_progress', 'on_hold', 'ready'].includes(j.status)).length,
      low: low.length
    };
  }, [], { live: true });

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBell(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearch(true);
        return;
      }
      if (e.altKey && !mod && !typing) {
        if (e.key === '1' && can('dashboard.view')) { e.preventDefault(); navigate('/'); }
        if (e.key === '2' && can('pos.sell')) { e.preventDefault(); navigate('/pos'); }
        if (e.key === '3' && can('jobcards.view')) { e.preventDefault(); navigate('/jobcards'); }
      }
      if (mod && !typing && e.key.toLowerCase() === 'n') {
        // Ctrl/Cmd+N starts a new record in the module you are in, falling back
        // to a new sale when the current page has no create flow (or the role
        // lacks permission for it).
        const target = NEW_RECORD_TARGETS.find((t) => t.path === location.pathname);
        if (target && can(target.perm)) {
          e.preventDefault();
          navigate(`${target.path}?new=1`);
        } else if (can('pos.sell')) {
          e.preventDefault();
          navigate('/pos?new=1');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [can, navigate]);

  if (!user) return null;
  const unread = notifications.filter((n) => !n.read);
  const lowCount = counts.data?.low ?? 0;
  const jobCount = counts.data?.jobs ?? 0;

  return (
    <div className="app-shell">
      {mobileOpen && <div className="drawer-overlay" style={{ zIndex: 39 }} onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <BrandLockup name={settings.profile.name || 'Your workshop'} subtitle="Workshop POS" />
        </div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              {item.icon}
              <span className="label">{item.label}</span>
              {item.to === '/jobcards' && jobCount > 0 && <span className="nav-badge">{jobCount}</span>}
              {item.to === '/inventory' && lowCount > 0 && <span className="nav-badge" style={{ background: 'rgba(217,141,99,.25)' }}>{lowCount}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-version" title="Data is saved in this browser. Export a backup regularly.">
            <span className="lbl">Saved in this browser</span>
            <b>v{APP_VERSION}</b>
          </div>
        </div>
      </aside>

      <div className={`main ${collapsed ? 'collapsed' : ''}`}>
        <header className="topbar">
          <button
            className="icon-btn sidebar-toggle"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => {
              if (window.innerWidth <= 900) setMobileOpen((m) => !m);
              else setCollapsed(!collapsed);
            }}
          >
            {window.innerWidth <= 900 ? <Menu size={18} /> : collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>

          <button className="global-search" onClick={() => setSearch(true)} aria-label="Open global search">
            <Search size={14} />
            <span className="grow truncate" style={{ textAlign: 'left', color: '#a2937f', fontSize: 12 }}>Search anything…</span>
            <kbd>⌘K</kbd>
          </button>

          <div className="topbar-right">
            <div style={{ position: 'relative' }} ref={bellRef}>
              <button className="icon-btn bell-btn" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} onClick={() => setBell((b) => !b)} aria-expanded={bell}>
                <Bell size={17} />
                {unreadCount > 0 && <span className="dot" />}
              </button>
              {bell && (
                <div className="popover notif-pop" role="dialog" aria-label="Notifications">
                  <div className="notif-head">
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 750 }}>Notifications</div>
                      <div className="tiny muted">{unreadCount ? `${unreadCount} unread` : 'Everything is up to date'}</div>
                    </div>
                    <div className="flex gap-4">
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={async () => { await markAllRead(); await refreshNotifications(); }}
                        disabled={!unreadCount}
                      >
                        Mark all read
                      </button>
                      <button className="icon-btn sm" onClick={() => setBell(false)} aria-label="Close notifications"><X size={14} /></button>
                    </div>
                  </div>
                  <div className="notif-list">
                    {notifications.length === 0 && (
                      <div className="empty" style={{ padding: 22 }}>
                        <div className="icon-wrap"><Bell size={17} /></div>
                        <h4>No notifications yet</h4>
                        <p>Sales, low stock and job updates appear here.</p>
                      </div>
                    )}
                    {notifications.slice(0, 12).map((n) => (
                      <button
                        key={n.id}
                        className={`notif-item ${n.read ? '' : 'unread'}`}
                        onClick={async () => {
                          await markNotificationRead(n.id);
                          await refreshNotifications();
                          setBell(false);
                          if (n.link) navigate(n.link);
                        }}
                      >
                        <span className="n-icon">{NOTIF_ICON[n.type] ?? <Bell size={14} />}</span>
                        <span className="grow">
                          <span className="n-title">{n.title}</span>
                          <span className="n-msg" style={{ display: 'block' }}>{n.message}</span>
                          <span className="n-time">{relTime(n.createdAt)}</span>
                        </span>
                        {!n.read && <span className="unread-dot" />}
                      </button>
                    ))}
                  </div>
                  {can('settings.manage') && (
                    <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
                      <button className="menu-item" onClick={() => { setBell(false); navigate('/settings'); }}>
                        <Settings size={14} /> Notification preferences
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <span className="topbar-divider" />
            <button className="user-menu-btn" onClick={() => setDrawer(true)} aria-label="Open profile menu" aria-haspopup="dialog">
              <Avatar name={user.name} src={user.avatar} />
              <span>
                <span className="name" style={{ display: 'block' }}>{user.name}</span>
                <span className="role" style={{ display: 'block' }}>{user.role}</span>
              </span>
              <ChevronDown size={14} className="chev" />
            </button>
          </div>
        </header>

        <main id="main-content">
          <Outlet />
        </main>
      </div>

      <ProfileDrawer open={drawer} onClose={() => setDrawer(false)} />
      <GlobalSearch open={search} onClose={() => setSearch(false)} />
    </div>
  );
}
