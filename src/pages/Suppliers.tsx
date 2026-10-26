import { useState } from 'react';
import { Building2, Plus, Truck } from 'lucide-react';
import {
  PageHeader, Card, Button, Modal, Field, Input, Textarea, Drawer, EmptyState, Loading, ErrorState,
  SearchInput, Money, Badge, StatusPill, Tabs
} from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { listSuppliers, listPurchases } from '../lib/queries';
import { createSupplier, updateSupplier } from '../lib/repo';
import { useApp } from '../state/AppContext';
import { bump } from '../lib/bus';
import { fmtDate, formatMoney } from '../lib/money';
import type { Supplier } from '../lib/types';

export default function Suppliers() {
  const { settings, user, can, toast } = useApp();
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const suppliers = useAsync(() => listSuppliers(), [], { live: true });
  const purchases = useAsync(() => listPurchases(), [], { live: true });

  const purchaseCount = (id: string) => (purchases.data ?? []).filter((p) => p.supplierId === id).length;
  const rows = (suppliers.data ?? []).filter((s) => {
    const term = search.trim().toLowerCase();
    return !term || s.name.toLowerCase().includes(term) || (s.phone ?? '').includes(term) || (s.contactPerson ?? '').toLowerCase().includes(term);
  });
  const payable = (suppliers.data ?? []).reduce((a, s) => a + Math.max(0, s.balancePaisa), 0);
  const selected = openId ? (suppliers.data ?? []).find((s) => s.id === openId) ?? null : null;
  const supplierPurchases = (purchases.data ?? []).filter((p) => p.supplierId === openId);

  return (
    <div className="page">
      <PageHeader title="Suppliers" subtitle="Vendors, payable balances and purchase history.">
        {can('purchases.manage') && <Button variant="primary" icon={<Plus size={15} />} onClick={() => { setEditing(null); setFormOpen(true); }}>Add supplier</Button>}
      </PageHeader>

      <div className="stat-strip" style={{ marginBottom: 12 }}>
        <div className="stat"><div className="lbl">Suppliers</div><div className="val">{suppliers.data?.length ?? 0}</div></div>
        <div className="stat"><div className="lbl">Total payable</div><div className="val">{formatMoney(payable, { currency: settings.profile.currency, decimals: false })}</div></div>
        <div className="stat"><div className="lbl">Purchases on file</div><div className="val">{purchases.data?.length ?? 0}</div></div>
      </div>

      <Card>
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search supplier, contact or phone…" />
          <div className="grow" />
          <span className="tiny muted">{rows.length} supplier{rows.length === 1 ? '' : 's'}</span>
        </div>
        {suppliers.loading && !suppliers.data && <Loading />}
        {suppliers.error && <ErrorState message={suppliers.error} onRetry={suppliers.reload} />}
        {suppliers.data && rows.length === 0 && (
          <EmptyState icon={<Building2 size={20} />} title="No suppliers yet" message="Add suppliers to raise purchase orders and track payables."
            action={can('purchases.manage') ? <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>Add supplier</Button> : undefined} />
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Supplier</th><th>Contact</th><th className="num">Purchases</th><th className="num">Payable</th><th /></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => setOpenId(s.id)}>
                    <td>
                      <div style={{ fontWeight: 650 }}>{s.name}</div>
                      <div className="tiny muted">{s.address || '—'}</div>
                    </td>
                    <td className="tiny">
                      <div>{s.contactPerson || '—'}</div>
                      <div className="mono muted">{s.phone || '—'}</div>
                    </td>
                    <td className="num">{purchaseCount(s.id)}</td>
                    <td className="num" style={{ color: s.balancePaisa > 0 ? 'var(--danger)' : undefined }}><Money value={s.balancePaisa} /></td>
                    <td className="actions">
                      {can('purchases.manage') && <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); setEditing(s); setFormOpen(true); }}>Edit</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Drawer open={!!selected} onClose={() => setOpenId(null)} width={640} title={selected?.name ?? 'Supplier'}
        footer={<Button size="sm" onClick={() => setOpenId(null)}>Close</Button>}>
        {selected && (
          <div className="flex-col gap-14">
            <div className="detail-grid">
              <div><div className="doc-label">Contact</div><div className="doc-strong">{selected.contactPerson || '—'}</div></div>
              <div><div className="doc-label">Phone</div><div className="doc-strong mono">{selected.phone || '—'}</div></div>
              <div><div className="doc-label">Email</div><div className="doc-strong">{selected.email || '—'}</div></div>
              <div><div className="doc-label">Payable</div><div className="doc-strong mono">{formatMoney(selected.balancePaisa, { currency: settings.profile.currency })}</div></div>
            </div>
            {selected.address && <div><div className="label">Address</div><p className="small" style={{ color: 'var(--text-soft)' }}>{selected.address}</p></div>}
            {selected.notes && <div><div className="label">Notes</div><p className="small" style={{ color: 'var(--text-soft)' }}>{selected.notes}</p></div>}

            <Tabs value="purchases" onChange={() => {}} tabs={[{ id: 'purchases', label: 'Purchases', count: supplierPurchases.length }]} />
            {supplierPurchases.length === 0 ? <EmptyState icon={<Truck size={19} />} title="No purchases" message="Purchases raised with this supplier appear here." /> : (
              <div className="table-wrap">
                <table className="table compact">
                  <thead><tr><th>Purchase</th><th>Date</th><th>Status</th><th className="num">Total</th><th className="num">Paid</th></tr></thead>
                  <tbody>
                    {supplierPurchases.map((p) => (
                      <tr key={p.id}>
                        <td className="mono">{p.number}</td>
                        <td className="tiny nowrap">{fmtDate(p.date)}</td>
                        <td><StatusPill status={p.status} /></td>
                        <td className="num"><Money value={p.totalPaisa} /></td>
                        <td className="num"><Money value={p.paidPaisa} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {selected.balancePaisa > 0 && <Badge tone="warning">Payments are recorded from the Purchases module.</Badge>}
          </div>
        )}
      </Drawer>

      {formOpen && (
        <SupplierForm key={editing?.id ?? 'new'} supplier={editing}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onSaved={() => { setFormOpen(false); setEditing(null); suppliers.reload(); bump(); toast(editing ? 'Supplier updated.' : 'Supplier added.'); }} />
      )}
    </div>
  );
}

function SupplierForm({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const { user } = useApp();
  const [form, setForm] = useState({
    name: supplier?.name ?? '', contactPerson: supplier?.contactPerson ?? '', phone: supplier?.phone ?? '',
    email: supplier?.email ?? '', address: supplier?.address ?? '', notes: supplier?.notes ?? ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      const actor = { id: user.id, name: user.name, role: user.role };
      if (supplier) await updateSupplier(supplier.id, form, actor);
      else await createSupplier(form, actor);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save supplier.');
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="sm" title={supplier ? 'Edit supplier' : 'Add supplier'}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy}>{supplier ? 'Save changes' : 'Add supplier'}</Button></>}>
      <div className="form-section">
        {error && <div className="alert alert-danger">{error}</div>}
        <Field label="Supplier name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
        <div className="form-grid">
          <Field label="Contact person"><Input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} /></Field>
          <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        </div>
        <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Address"><Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} style={{ minHeight: 56 }} /></Field>
        <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ minHeight: 48 }} /></Field>
      </div>
    </Modal>
  );
}
