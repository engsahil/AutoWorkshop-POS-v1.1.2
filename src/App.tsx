import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { useApp } from './state/AppContext';
import { AppLayout } from './components/Shell';
import type { Permission } from './lib/types';
import { Link } from 'react-router-dom';

const Setup = lazy(() => import('./pages/Setup'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const POS = lazy(() => import('./pages/POS'));
const JobCards = lazy(() => import('./pages/JobCards'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Shifts = lazy(() => import('./pages/Shifts'));
const Customers = lazy(() => import('./pages/Customers'));
const Vehicles = lazy(() => import('./pages/Vehicles'));
const Inventory = lazy(() => import('./pages/Inventory'));
const ImportItems = lazy(() => import('./pages/ImportItems'));
const Parts = lazy(() => import('./pages/Parts'));
const Services = lazy(() => import('./pages/Services'));
const LaborPage = lazy(() => import('./pages/Labor'));
const Purchases = lazy(() => import('./pages/Purchases'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Returns = lazy(() => import('./pages/Returns'));
const WarrantyPage = lazy(() => import('./pages/Warranty'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Staff = lazy(() => import('./pages/Staff'));
const Reports = lazy(() => import('./pages/Reports'));
const Analytics = lazy(() => import('./pages/Analytics'));
const UsersPage = lazy(() => import('./pages/Users'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Help = lazy(() => import('./pages/Help'));
const Privacy = lazy(() => import('./pages/Privacy'));

function Fallback() {
  return (
    <div className="loading-row" style={{ minHeight: '60vh' }}>
      <span className="spinner" /> Loading module…
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, settings } = useApp();
  const location = useLocation();
  if (!settings.setupComplete) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}

function Protected({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { can } = useApp();
  if (!can(perm)) {
    return (
      <div className="page narrow">
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div className="empty">
            <div className="icon-wrap" style={{ color: 'var(--danger)', background: 'var(--danger-bg)' }}><ShieldAlert size={22} /></div>
            <h4>You don’t have access to this module</h4>
            <p>Your role does not include the “{perm}” permission. Ask an administrator to update your role in Users &amp; Roles.</p>
            <Link className="btn btn-secondary btn-sm" to="/" style={{ marginTop: 8 }}><ArrowLeft size={13} /> Back to dashboard</Link>
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  const { user, settings } = useApp();

  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route
          path="/setup"
          element={
            settings.setupComplete ? <Navigate to={user ? '/' : '/login'} replace /> : <Setup />
          }
        />
        <Route
          path="/login"
          element={
            !settings.setupComplete ? <Navigate to="/setup" replace /> : user ? <Navigate to="/" replace /> : <Login />
          }
        />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/help" element={<Help />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Protected perm="dashboard.view"><Dashboard /></Protected>} />
          <Route path="pos" element={<Protected perm="pos.sell"><POS /></Protected>} />
          <Route path="jobcards" element={<Protected perm="jobcards.view"><JobCards /></Protected>} />
          <Route path="invoices" element={<Protected perm="invoices.view"><Invoices /></Protected>} />
          <Route path="shifts" element={<Protected perm="shifts.view"><Shifts /></Protected>} />
          <Route path="customers" element={<Protected perm="customers.view"><Customers /></Protected>} />
          <Route path="vehicles" element={<Protected perm="vehicles.view"><Vehicles /></Protected>} />
          <Route path="inventory" element={<Protected perm="inventory.view"><Inventory /></Protected>} />
          <Route path="inventory/import" element={<Protected perm="inventory.manage"><ImportItems /></Protected>} />
          <Route path="parts" element={<Protected perm="inventory.view"><Parts /></Protected>} />
          <Route path="services" element={<Protected perm="inventory.view"><Services /></Protected>} />
          <Route path="labor" element={<Protected perm="inventory.view"><LaborPage /></Protected>} />
          <Route path="purchases" element={<Protected perm="purchases.view"><Purchases /></Protected>} />
          <Route path="suppliers" element={<Protected perm="suppliers.view"><Suppliers /></Protected>} />
          <Route path="returns" element={<Protected perm="returns.view"><Returns /></Protected>} />
          <Route path="warranty" element={<Protected perm="warranty.view"><WarrantyPage /></Protected>} />
          <Route path="expenses" element={<Protected perm="expenses.view"><Expenses /></Protected>} />
          <Route path="staff" element={<Protected perm="staff.view"><Staff /></Protected>} />
          <Route path="reports" element={<Protected perm="reports.view"><Reports /></Protected>} />
          <Route path="analytics" element={<Protected perm="analytics.view"><Analytics /></Protected>} />
          <Route path="users" element={<Protected perm="users.manage"><UsersPage /></Protected>} />
          <Route path="settings" element={<Protected perm="settings.manage"><SettingsPage /></Protected>} />
        </Route>
        <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
      </Routes>
    </Suspense>
  );
}
