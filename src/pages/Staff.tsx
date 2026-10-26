import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardHat, UserCog, UserPlus } from 'lucide-react';
import {
  PageHeader, Card, Button, Modal, Field, Input, Select, EmptyState, Loading, ErrorState, Badge, Switch
} from '../components/ui';
import { Avatar } from '../components/ProfileDrawer';
import { useAsync } from '../hooks/useAsync';
import { listUsers, updateUser, listUsersForAssign } from '../lib/repo';
import { listJobs } from '../lib/queries';
import { useApp } from '../state/AppContext';
import { bump } from '../lib/bus';
import { mechanicPerformance } from '../lib/analytics';
import { formatMoney, fmtDateTime } from '../lib/money';
import type { PublicUser, Role } from '../lib/types';

const ROLES: Role[] = ['Administrator', 'Manager', 'Cashier', 'Mechanic', 'Inventory Manager'];

export default function Staff() {
  const { user, settings, can, toast } = useApp();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<PublicUser | null>(null);
  const [form, setForm] = useState({ name: '', role: 'Mechanic' as Role, phone: '', email: '', active: true });
  const [busy, setBusy] = useState(false);

  const users = useAsync(() => listUsers(), [], { live: true });
  const jobs = useAsync(() => listJobs({ page: 1, size: 500 }), [], { live: true });
  const assignable = useAsync(() => listUsersForAssign(), [], { live: true });
  const invoices = useAsync(async () => {
    const { dbAll } = await import('../lib/db');
    return dbAll<{ id: string; totalPaisa: number }>('invoices');
  }, [], { live: true });

  const performance = useMemo(() => {
    const rows = (jobs.data?.items ?? []) as unknown as import('../lib/types').JobCard[];
    return mechanicPerformance(rows, (invoices.data ?? []) as unknown as import('../lib/types').Invoice[], users.data ?? []);
  }, [jobs.data, invoices.data, users.data]);

  const loadCounts = (userId: string) => {
    const list = (jobs.data?.items ?? []) as unknown as import('../lib/types').JobCard[];
    return {
      active: list.filter((j) => j.mechanicId === userId && ['approved', 'in_progress', 'on_hold', 'ready'].includes(j.status)).length,
      total: list.filter((j) => j.mechanicId === userId).length
    };
  };

  const openEdit = (u: PublicUser) => {
    setEditing(u);
    setForm({ name: u.name, role: u.role, phone: u.phone ?? '', email: u.email ?? '', active: u.active });
  };

  const save = async () => {
    if (!user || !editing) return;
    setBusy(true);
    try {
      await updateUser(editing.id, form, { id: user.id, name: user.name, role: user.role });
      toast('Staff record updated.');
      setEditing(null);
      users.reload();
      assignable.reload();
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to update staff record', 'error');
    } finally {
      setBusy(false);
    }
  };

  const rows = users.data ?? [];

  return (
    <div className="page">
      <PageHeader title="Mechanics & Staff" subtitle="Team workload, assignments and workshop performance.">
        {can('staff.manage') && (
          <Button variant="primary" icon={<UserPlus size={15} />} onClick={() => navigate('/users?new=1')}>Add staff account</Button>
        )}
      </PageHeader>

      <div className="grid-side" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
        <Card>
          <div className="card-header"><h3>Team</h3><span className="sub">{rows.length} account{rows.length === 1 ? '' : 's'}</span></div>
          {users.loading && !users.data && <Loading />}
          {users.error && <ErrorState message={users.error} onRetry={users.reload} />}
          {users.data && rows.length === 0 && <EmptyState icon={<HardHat size={20} />} title="No staff accounts" message="Create staff accounts in Users & Roles, then assign mechanics to job cards." />}
          {rows.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Staff member</th><th>Role</th><th>Contact</th><th className="num">Active jobs</th><th className="num">Assigned</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {rows.map((u) => {
                    const counts = loadCounts(u.id);
                    return (
                      <tr key={u.id}>
                        <td>
                          <div className="flex items-center gap-8">
                            <Avatar name={u.name} src={u.avatar} size="sm" />
                            <div>
                              <div style={{ fontWeight: 650 }}>{u.name} {u.isOwner && <span className="badge badge-bronze" style={{ marginLeft: 4 }}>Owner</span>}</div>
                              <div className="tiny muted mono">@{u.username}</div>
                            </div>
                          </div>
                        </td>
                        <td><Badge tone={u.role === 'Administrator' ? 'bronze' : 'neutral'}>{u.role}</Badge></td>
                        <td className="tiny">{u.phone || u.email || '—'}</td>
                        <td className="num">{counts.active}</td>
                        <td className="num tiny muted">{counts.total}</td>
                        <td>{u.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral">Disabled</Badge>}</td>
                        <td className="actions">
                          {can('staff.manage') && <button className="btn btn-ghost btn-xs" onClick={() => openEdit(u)}>Edit</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card style={{ marginTop: 14 }}>
        <div className="card-header">
          <div>
            <h3>Mechanic performance</h3>
            <div className="sub">Completed jobs and billed value from actual invoices</div>
          </div>
          <Badge tone="neutral">{performance.length} mechanic{performance.length === 1 ? '' : 's'}</Badge>
        </div>
        {performance.length === 0 ? (
          <EmptyState icon={<HardHat size={19} />} title="No assigned jobs yet" message="Assign a mechanic on a job card to see performance metrics here." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Mechanic</th><th className="num">Completed jobs</th><th className="num">Billed value</th><th className="num">Avg turnaround</th></tr></thead>
              <tbody>
                {performance.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td className="num">{m.completed}</td>
                    <td className="num">{formatMoney(m.billedPaisa, { currency: settings.profile.currency, decimals: false })}</td>
                    <td className="num">{m.avgTurnaroundHours ? `${m.avgTurnaroundHours} h` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} size="sm" title="Edit staff record"
        footer={<><Button onClick={() => setEditing(null)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={save} loading={busy}>Save changes</Button></>}>
        {editing && (
          <div className="form-section">
            <div className="alert alert-info"><UserCog size={14} /><span>Login credentials are managed in Users & Roles. Role changes apply immediately.</span></div>
            <Field label="Full name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} disabled={editing.isOwner}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
            <div className="form-grid">
              <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            </div>
            <Switch label="Account active" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} disabled={editing.isOwner} />
            <div className="tiny muted">Last login: {editing.lastLogin ? fmtDateTime(editing.lastLogin) : 'never'}</div>
          </div>
        )}
      </Modal>
    </div>
  );
}
