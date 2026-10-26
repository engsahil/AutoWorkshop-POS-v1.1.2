import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { KeyRound, Lock, ShieldCheck, UserPlus } from 'lucide-react';
import {
  PageHeader, Card, Button, Modal, Field, Input, Select, Checkbox, EmptyState, Loading, ErrorState,
  Badge, ConfirmDialog, PasswordField, Tabs
} from '../components/ui';
import { Avatar } from '../components/ProfileDrawer';
import { useAsync } from '../hooks/useAsync';
import { listUsers, createUser, updateUser, resetUserPassword } from '../lib/repo';
import { useApp } from '../state/AppContext';
import { bump } from '../lib/bus';
import { fmtDateTime } from '../lib/money';
import { DEFAULT_ROLES, type Permission, type PublicUser, type Role } from '../lib/types';

const ROLE_LIST: Role[] = ['Administrator', 'Manager', 'Cashier', 'Mechanic', 'Inventory Manager'];

const PERMISSION_META: { key: Permission; label: string; group: string }[] = [
  { key: 'dashboard.view', label: 'View dashboard', group: 'General' },
  { key: 'analytics.view', label: 'View analytics', group: 'General' },
  { key: 'reports.view', label: 'View & export reports', group: 'General' },
  { key: 'audit.view', label: 'View audit trail', group: 'General' },
  { key: 'pos.sell', label: 'Create POS sales', group: 'Point of sale' },
  { key: 'pos.discount', label: 'Apply invoice discounts', group: 'Point of sale' },
  { key: 'pos.void', label: 'Void completed invoices', group: 'Point of sale' },
  { key: 'shifts.view', label: 'View cash shifts', group: 'Point of sale' },
  { key: 'shifts.manage', label: 'Open / close shifts & cash movements', group: 'Point of sale' },
  { key: 'invoices.view', label: 'View invoices', group: 'Invoices & returns' },
  { key: 'invoices.refund', label: 'Process returns & refunds', group: 'Invoices & returns' },
  { key: 'jobcards.view', label: 'View job cards', group: 'Workshop' },
  { key: 'jobcards.manage', label: 'Create & progress job cards', group: 'Workshop' },
  { key: 'warranty.view', label: 'View warranties', group: 'Workshop' },
  { key: 'warranty.manage', label: 'Register & claim warranties', group: 'Workshop' },
  { key: 'customers.view', label: 'View customers', group: 'Customers & vehicles' },
  { key: 'customers.manage', label: 'Add / edit customers', group: 'Customers & vehicles' },
  { key: 'vehicles.view', label: 'View vehicles', group: 'Customers & vehicles' },
  { key: 'vehicles.manage', label: 'Add / edit vehicles', group: 'Customers & vehicles' },
  { key: 'inventory.view', label: 'View inventory', group: 'Inventory & purchasing' },
  { key: 'inventory.manage', label: 'Adjust stock & edit parts', group: 'Inventory & purchasing' },
  { key: 'purchases.view', label: 'View purchases', group: 'Inventory & purchasing' },
  { key: 'purchases.manage', label: 'Create, receive & pay purchases', group: 'Inventory & purchasing' },
  { key: 'suppliers.view', label: 'View suppliers', group: 'Inventory & purchasing' },
  { key: 'expenses.view', label: 'View expenses', group: 'Finance' },
  { key: 'expenses.manage', label: 'Record & approve expenses', group: 'Finance' },
  { key: 'staff.view', label: 'View staff', group: 'Administration' },
  { key: 'staff.manage', label: 'Edit staff records', group: 'Administration' },
  { key: 'users.manage', label: 'Manage users & roles', group: 'Administration' },
  { key: 'settings.manage', label: 'Change workshop settings', group: 'Administration' },
  { key: 'backup.manage', label: 'Export / restore backups', group: 'Administration' }
];

export default function Users() {
  const { user, settings, can, toast, saveAppSettings } = useApp();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'accounts' | 'roles'>('accounts');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PublicUser | null>(null);
  const [resetting, setResetting] = useState<PublicUser | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<PublicUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const users = useAsync(() => listUsers(), [], { live: true });

  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'Cashier' as Role, phone: '', email: '' });
  const [editForm, setEditForm] = useState({ name: '', role: 'Cashier' as Role, phone: '', email: '' });
  const [newPassword, setNewPassword] = useState('');
  const [roleDraft, setRoleDraft] = useState<Record<string, Permission[]>>({});

  useEffect(() => {
    if (params.get('new') === '1' && can('users.manage')) {
      setCreateOpen(true);
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const rows = users.data ?? [];
  const groups = useMemo(() => {
    const map = new Map<string, typeof PERMISSION_META>();
    for (const p of PERMISSION_META) {
      const list = map.get(p.group) ?? [];
      list.push(p);
      map.set(p.group, list);
    }
    return Array.from(map.entries());
  }, []);

  const rolePermissions = (role: Role): Permission[] => roleDraft[role] ?? settings.roles[role] ?? DEFAULT_ROLES[role] ?? [];
  const dirty = Object.keys(roleDraft).length > 0;

  const create = async () => {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      await createUser(form, { id: user.id, name: user.name, role: user.role });
      toast(`Account created for ${form.name}.`);
      setCreateOpen(false);
      setForm({ name: '', username: '', password: '', role: 'Cashier', phone: '', email: '' });
      users.reload();
      bump();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create account.');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!user || !editing) return;
    setBusy(true);
    try {
      await updateUser(editing.id, editForm, { id: user.id, name: user.name, role: user.role });
      toast('Account updated.');
      setEditing(null);
      users.reload();
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to update account', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveReset = async () => {
    if (!user || !resetting) return;
    setBusy(true);
    try {
      await resetUserPassword(resetting.id, newPassword, { id: user.id, name: user.name, role: user.role });
      toast('Password reset. Share the new password securely.');
      setResetting(null);
      setNewPassword('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to reset password', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (target: PublicUser) => {
    if (!user) return;
    setBusy(true);
    try {
      await updateUser(target.id, { active: !target.active }, { id: user.id, name: user.name, role: user.role });
      toast(target.active ? 'Account disabled.' : 'Account enabled.');
      setConfirmToggle(null);
      users.reload();
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to update account', 'error');
    } finally {
      setBusy(false);
    }
  };

  const togglePermission = (role: Role, key: Permission) => {
    setRoleDraft((prev) => {
      const current = prev[role] ?? settings.roles[role] ?? DEFAULT_ROLES[role] ?? [];
      return { ...prev, [role]: current.includes(key) ? current.filter((k) => k !== key) : [...current, key] };
    });
  };

  const saveRoles = async () => {
    setBusy(true);
    try {
      const nextRoles = { ...settings.roles, ...roleDraft, Administrator: [...PERMISSION_META.map((p) => p.key)] };
      await saveAppSettings({ ...settings, roles: nextRoles });
      toast('Role permissions saved.');
      setRoleDraft({});
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to save permissions', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!can('users.manage')) {
    return (
      <div className="page">
        <PageHeader title="Users & Roles" />
        <Card><EmptyState icon={<Lock size={20} />} title="Administrator access required" message="Your role does not include user management." /></Card>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="Users & Roles" subtitle="Accounts, access levels and per-role permissions.">
        <Button variant="primary" icon={<UserPlus size={15} />} onClick={() => setCreateOpen(true)}>Add user</Button>
      </PageHeader>

      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'accounts', label: 'Accounts', count: rows.length }, { id: 'roles', label: 'Role permissions' }]} />

      {tab === 'accounts' && (
        <Card>
          <div className="card-header"><h3>Accounts</h3><span className="sub">{rows.filter((u) => u.active).length} active · {rows.length} total</span></div>
          {users.loading && !users.data && <Loading />}
          {users.error && <ErrorState message={users.error} onRetry={users.reload} />}
          {users.data && rows.length === 0 && <EmptyState title="No accounts" />}
          {rows.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last login</th><th>Created</th><th /></tr></thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div className="flex items-center gap-8">
                          <Avatar name={u.name} src={u.avatar} size="sm" />
                          <div>
                            <div style={{ fontWeight: 650 }}>{u.name}</div>
                            <div className="tiny muted mono">@{u.username}{u.email ? ` · ${u.email}` : ''}</div>
                          </div>
                        </div>
                      </td>
                      <td><Badge tone={u.role === 'Administrator' ? 'bronze' : 'neutral'}>{u.role}</Badge></td>
                      <td>{u.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral">Disabled</Badge>}</td>
                      <td className="tiny">{u.lastLogin ? fmtDateTime(u.lastLogin) : 'Never'}</td>
                      <td className="tiny">{fmtDateTime(u.createdAt)}</td>
                      <td className="actions">
                        <button className="btn btn-ghost btn-xs" onClick={() => { setEditing(u); setEditForm({ name: u.name, role: u.role, phone: u.phone ?? '', email: u.email ?? '' }); }}>Edit</button>
                        <button className="btn btn-ghost btn-xs" onClick={() => { setResetting(u); setNewPassword(''); }}>Reset password</button>
                        {!u.isOwner && u.id !== user?.id && (
                          <button className="btn btn-ghost btn-xs" onClick={() => setConfirmToggle(u)}>{u.active ? 'Disable' : 'Enable'}</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'roles' && (
        <div className="flex-col gap-14">
          <Card>
            <div className="card-header">
              <div><h3>Role permissions</h3><div className="sub">Administrators always have full access. Changes apply immediately to permission checks.</div></div>
              <Button variant="primary" size="sm" onClick={saveRoles} loading={busy} disabled={!dirty}>Save permissions</Button>
            </div>
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th style={{ minWidth: 220 }}>Permission</th>
                    {ROLE_LIST.filter((r) => r !== 'Administrator').map((r) => <th key={r} className="center" style={{ width: 130 }}>{r}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {groups.map(([group, perms]) => (
                    <PermissionGroup key={group} group={group} perms={perms} rolePermissions={rolePermissions} onToggle={togglePermission} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="alert alert-info">
            <ShieldCheck size={15} />
            <span>Permissions control navigation and buttons, and are checked again inside transaction functions. Local authentication uses PBKDF2-derived hashes stored in this browser only — it is not server-grade security. See Help &amp; Guide.</span>
          </div>
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add user" size="sm"
        footer={<><Button onClick={() => setCreateOpen(false)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={create} loading={busy}>Create account</Button></>}>
        <div className="form-section">
          {error && <div className="alert alert-danger">{error}</div>}
          <Field label="Full name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
          <div className="form-grid">
            <Field label="Username" required hint="3–32 chars: letters, numbers, dot, dash, underscore."><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
            <Field label="Role" required>
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLE_LIST.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Temporary password" required hint="Minimum 8 characters. The user should change it after first login.">
            <PasswordField value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <div className="form-grid">
            <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          </div>
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit account" size="sm"
        footer={<><Button onClick={() => setEditing(null)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={saveEdit} loading={busy}>Save changes</Button></>}>
        {editing && (
          <div className="form-section">
            <Field label="Full name"><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></Field>
            <Field label="Role" hint={editing.isOwner ? 'The owner account keeps full administrator access.' : undefined}>
              <Select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value as Role })} disabled={editing.isOwner}>
                {ROLE_LIST.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
            <div className="form-grid">
              <Field label="Phone"><Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></Field>
              <Field label="Email"><Input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></Field>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!resetting} onClose={() => setResetting(null)} title={`Reset password · ${resetting?.name ?? ''}`} size="sm"
        footer={<><Button onClick={() => setResetting(null)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={saveReset} loading={busy} icon={<KeyRound size={13} />}>Reset password</Button></>}>
        <div className="form-section">
          <div className="alert alert-warning"><KeyRound size={14} /><span>Existing sessions for this user are revoked. Never share passwords over public channels.</span></div>
          <Field label="New password" required hint="Minimum 8 characters."><PasswordField value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoFocus /></Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmToggle}
        title={confirmToggle?.active ? 'Disable account?' : 'Enable account?'}
        message={confirmToggle?.active ? `${confirmToggle?.name} will no longer be able to log in until re-enabled.` : `${confirmToggle?.name} will be able to log in again.`}
        confirmLabel={confirmToggle?.active ? 'Disable' : 'Enable'}
        tone={confirmToggle?.active ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={() => { if (confirmToggle) void toggleActive(confirmToggle); }}
        onClose={() => setConfirmToggle(null)}
      />
    </div>
  );
}

function PermissionGroup({ group, perms, rolePermissions, onToggle }: {
  group: string;
  perms: { key: Permission; label: string }[];
  rolePermissions: (role: Role) => Permission[];
  onToggle: (role: Role, key: Permission) => void;
}) {
  return (
    <>
      <tr>
        <td colSpan={5} style={{ background: 'var(--cream-100)', fontWeight: 800, fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-soft)' }}>{group}</td>
      </tr>
      {perms.map((p) => (
        <tr key={p.key}>
          <td>{p.label}</td>
          {ROLE_LIST.filter((r) => r !== 'Administrator').map((r) => (
            <td key={r} className="center">
              <Checkbox label="" checked={rolePermissions(r).includes(p.key)} onChange={() => onToggle(r, p.key)} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
