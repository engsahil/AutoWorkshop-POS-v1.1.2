import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Car, Plus, Search, Users as UsersIcon, Wallet } from 'lucide-react';
import {
  PageHeader, Card, Button, Modal, Field, Input, Textarea, Select, Drawer, EmptyState, Loading, ErrorState,
  Badge, StatusPill, SearchInput, Money, Tabs, ConfirmDialog
} from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { customersWithBalances, getCustomerDetail } from '../lib/queries';
import { createCustomer, updateCustomer, createVehicle } from '../lib/repo';
import { useApp } from '../state/AppContext';
import { bump } from '../lib/bus';
import { downloadCsv } from '../lib/csv';
import { formatMoney, fmtDate } from '../lib/money';
import type { Customer, Vehicle } from '../lib/types';

export default function Customers() {
  const { settings, user, can, toast } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'all' | 'with-balance'>('all');
  const [editing, setEditing] = useState<Customer | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [addVehicleFor, setAddVehicleFor] = useState<Customer | null>(null);

  const customers = useAsync(() => customersWithBalances(), [], { live: true });
  const detail = useAsync(() => (openId ? getCustomerDetail(openId) : Promise.resolve(null)), [openId]);

  useEffect(() => {
    if (params.get('new') === '1' && can('customers.manage')) {
      setEditing(null);
      setFormOpen(true);
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params, can, setParams]);

  const rows = (customers.data ?? []).filter((c) => {
    const term = search.trim().toLowerCase();
    const matches = !term || c.name.toLowerCase().includes(term) || c.phone.includes(term) || c.code.toLowerCase().includes(term) || (c.email ?? '').toLowerCase().includes(term);
    return matches && (view === 'all' || Math.abs(c.balancePaisa) > 0);
  });

  const totalReceivable = (customers.data ?? []).reduce((a, c) => a + Math.max(0, c.balancePaisa), 0);
  const withBalance = (customers.data ?? []).filter((c) => Math.abs(c.balancePaisa) > 0).length;
  const vehicleTotal = (customers.data ?? []).reduce((a, c) => a + c.vehicleCount, 0);

  return (
    <div className="page">
      <PageHeader title="Customers" subtitle="Owners, contact details, vehicles and outstanding balances.">
        <Button variant="secondary" icon={<Wallet size={14} />} onClick={() => setView(view === 'all' ? 'with-balance' : 'all')}>
          {view === 'all' ? 'Show balances only' : 'Show all customers'}
        </Button>
        {can('customers.manage') && <Button variant="primary" icon={<Plus size={15} />} onClick={() => { setEditing(null); setFormOpen(true); }}>Add customer</Button>}
      </PageHeader>

      <div className="stat-strip" style={{ marginBottom: 12 }}>
        <div className="stat"><div className="lbl">Customers</div><div className="val">{customers.data?.length ?? 0}</div></div>
        <div className="stat"><div className="lbl">Vehicles on file</div><div className="val">{vehicleTotal}</div></div>
        <div className="stat"><div className="lbl">With a balance</div><div className="val">{withBalance}</div></div>
        <div className="stat"><div className="lbl">Outstanding</div><div className="val">{formatMoney(totalReceivable, { currency: settings.profile.currency, decimals: false })}</div></div>
      </div>

      <Card>
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone, email or code…" />
          <div className="grow" />
          <span className="tiny muted">{rows.length} shown</span>
        </div>
        {customers.loading && !customers.data && <Loading />}
        {customers.error && <ErrorState message={customers.error} onRetry={customers.reload} />}
        {customers.data && rows.length === 0 && (
          <EmptyState icon={<UsersIcon size={20} />} title={search ? 'No customers match that search' : 'No customers yet'}
            message={search ? 'Try a different name, phone number or code.' : 'Add your first customer to link vehicles, job cards and invoices.'}
            action={can('customers.manage') && !search ? <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>Add customer</Button> : undefined} />
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Customer</th><th>Contact</th><th className="num">Vehicles</th><th>Added</th><th className="num">Balance</th><th /></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => setOpenId(c.id)}>
                    <td>
                      <div style={{ fontWeight: 650 }}>{c.name}</div>
                      <div className="tiny muted mono">{c.code}</div>
                    </td>
                    <td className="tiny">
                      <div className="mono">{c.phone}</div>
                      <div className="muted">{c.email || '—'}</div>
                    </td>
                    <td className="num">{c.vehicleCount}</td>
                    <td className="tiny nowrap">{fmtDate(c.createdAt)}</td>
                    <td className="num" style={{ color: c.balancePaisa > 0 ? 'var(--danger)' : undefined }}>
                      <Money value={c.balancePaisa} />
                    </td>
                    <td className="actions">
                      <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); navigate(`/vehicles?new=1&customer=${c.id}`); }}>Add vehicle</button>
                      {can('customers.manage') && <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); setEditing(c); setFormOpen(true); }}>Edit</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer">
          <Button variant="ghost" size="sm" disabled={!rows.length}
            onClick={() => downloadCsv('servixa-customers', ['Code', 'Name', 'Phone', 'Email', 'Address', 'CNIC', 'Vehicles', 'Balance'], rows.map((c) => [c.code, c.name, c.phone, c.email ?? '', c.address ?? '', c.cnic ?? '', c.vehicleCount, c.balancePaisa / 100]))}>
            Export customers
          </Button>
        </div>
      </Card>

      <Drawer open={!!openId} onClose={() => setOpenId(null)} width={720} title={detail.data?.customer.name ?? 'Customer'}
        footer={detail.data ? (
          <div className="flex gap-8">
            {can('customers.manage') && <Button size="sm" variant="secondary" onClick={() => { setEditing(detail.data!.customer); setFormOpen(true); }}>Edit</Button>}
            <div className="grow" />
            <Button size="sm" variant="secondary" icon={<Car size={13} />} onClick={() => navigate(`/vehicles?new=1&customer=${detail.data!.customer.id}`)}>Add vehicle</Button>
            <Button size="sm" onClick={() => setOpenId(null)}>Close</Button>
          </div>
        ) : undefined}>
        {detail.loading && <Loading />}
        {detail.data && <CustomerDetail data={detail.data} settings={settings} onOpenVehicle={(id) => navigate(`/vehicles?open=${id}`)} />}
      </Drawer>

      {formOpen && (
        <CustomerForm
          key={editing?.id ?? 'new'}
          customer={editing}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onSaved={() => { setFormOpen(false); setEditing(null); customers.reload(); bump(); toast(editing ? 'Customer updated.' : 'Customer added.'); }}
        />
      )}

      {addVehicleFor && <span style={{ display: 'none' }}>{addVehicleFor.id}</span>}
    </div>
  );
}

function CustomerDetail({ data, settings, onOpenVehicle }: {
  data: NonNullable<Awaited<ReturnType<typeof getCustomerDetail>>>;
  settings: import('../lib/types').AppSettings;
  onOpenVehicle: (id: string) => void;
}) {
  const [tab, setTab] = useState<'overview' | 'vehicles' | 'invoices' | 'jobs'>('overview');
  const { customer, vehicles, invoices, jobs, returns } = data;
  return (
    <div className="flex-col gap-14">
      <div className="flex items-center gap-8 wrap">
        <Badge tone="neutral">{customer.code}</Badge>
        {customer.balancePaisa > 0 ? <Badge tone="danger">Owes {formatMoney(customer.balancePaisa, { currency: settings.profile.currency })}</Badge> : <Badge tone="success" dot>No balance</Badge>}
        <div className="grow" />
        <span className="tiny muted">Customer since {fmtDate(customer.createdAt)}</span>
      </div>

      <div className="detail-grid">
        <div><div className="doc-label">Phone</div><div className="doc-strong mono">{customer.phone}</div></div>
        <div><div className="doc-label">Email</div><div className="doc-strong">{customer.email || '—'}</div></div>
        <div><div className="doc-label">CNIC</div><div className="doc-strong mono">{customer.cnic || '—'}</div></div>
        <div><div className="doc-label">Address</div><div className="doc-strong">{customer.address || '—'}</div></div>
      </div>
      {customer.notes && <div><div className="label">Notes</div><p className="small" style={{ color: 'var(--text-soft)' }}>{customer.notes}</p></div>}

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview' },
        { id: 'vehicles', label: 'Vehicles', count: vehicles.length },
        { id: 'invoices', label: 'Invoices', count: invoices.length },
        { id: 'jobs', label: 'Job cards', count: jobs.length }
      ]} />

      {tab === 'overview' && (
        <div className="stat-strip">
          <div className="stat"><div className="lbl">Total invoiced</div><div className="val">{formatMoney(invoices.filter((i) => i.status !== 'void').reduce((a, i) => a + i.totalPaisa, 0), { currency: settings.profile.currency, decimals: false })}</div></div>
          <div className="stat"><div className="lbl">Open job cards</div><div className="val">{jobs.filter((j) => !['completed', 'cancelled'].includes(j.status)).length}</div></div>
          <div className="stat"><div className="lbl">Returns</div><div className="val">{returns.length}</div></div>
        </div>
      )}

      {tab === 'vehicles' && (vehicles.length === 0 ? <EmptyState icon={<Car size={19} />} title="No vehicles" message="Add a vehicle to book this customer in for service." /> : (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Plate</th><th>Vehicle</th><th className="num">Odometer</th><th>Year</th></tr></thead>
            <tbody>
              {vehicles.map((v: Vehicle) => (
                <tr key={v.id} className="clickable" onClick={() => onOpenVehicle(v.id)}>
                  <td className="mono">{v.regNo}</td>
                  <td>{v.make} {v.model}</td>
                  <td className="num">{v.odometer ? v.odometer.toLocaleString() : '—'}</td>
                  <td className="tiny">{v.year || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {tab === 'invoices' && (invoices.length === 0 ? <EmptyState title="No invoices" message="Sales and job invoices for this customer appear here." /> : (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Invoice</th><th>Date</th><th>Status</th><th className="num">Total</th><th className="num">Due</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className="mono">{i.number}</td>
                  <td className="tiny nowrap">{fmtDate(i.date)}</td>
                  <td><StatusPill status={i.status === 'void' ? 'void' : i.paymentStatus} /></td>
                  <td className="num"><Money value={i.totalPaisa} /></td>
                  <td className="num"><Money value={i.duePaisa} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {tab === 'jobs' && (jobs.length === 0 ? <EmptyState title="No job cards" message="Workshop visits for this customer appear here." /> : (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Job</th><th>Opened</th><th>Status</th><th className="num">Estimate</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="mono">{j.number}</td>
                  <td className="tiny nowrap">{fmtDate(j.createdAt)}</td>
                  <td><StatusPill status={j.status} /></td>
                  <td className="num"><Money value={j.estimatePaisa} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function CustomerForm({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: () => void }) {
  const { user } = useApp();
  const [form, setForm] = useState({
    name: customer?.name ?? '', phone: customer?.phone ?? '', email: customer?.email ?? '',
    address: customer?.address ?? '', cnic: customer?.cnic ?? '', notes: customer?.notes ?? ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      const actor = { id: user.id, name: user.name, role: user.role };
      if (customer) await updateCustomer(customer.id, form, actor);
      else await createCustomer(form, actor);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save customer.');
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="sm" title={customer ? 'Edit customer' : 'Add customer'}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy}>{customer ? 'Save changes' : 'Add customer'}</Button></>}>
      <div className="form-section">
        {error && <div className="alert alert-danger">{error}</div>}
        <Field label="Full name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
        <div className="form-grid">
          <Field label="Phone" required><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="03xx-xxxxxxx" /></Field>
          <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" /></Field>
        </div>
        <Field label="Address"><Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} style={{ minHeight: 56 }} /></Field>
        <div className="form-grid">
          <Field label="CNIC" hint="Optional, printed on invoices if set."><Input value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} /></Field>
          <Field label="Notes"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}
