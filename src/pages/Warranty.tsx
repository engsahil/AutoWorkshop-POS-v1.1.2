import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, ShieldCheck } from 'lucide-react';
import {
  PageHeader, Card, Button, Modal, Field, Input, Select, Textarea, SearchInput, EmptyState, Loading,
  ErrorState, StatusPill, Badge, Drawer
} from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { listWarranties, customersWithBalances, listParts, listServices } from '../lib/queries';
import { createWarranty, claimWarranty } from '../lib/repo';
import { runAutomatedChecks } from '../lib/repo';
import { useApp } from '../state/AppContext';
import { bump } from '../lib/bus';
import { fmtDate, todayISO } from '../lib/money';

export default function WarrantyPage() {
  const { user, can, toast } = useApp();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'expiring' | 'expired' | 'claimed'>('all');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({
    customerId: '', vehicleId: '', itemKind: 'part' as 'part' | 'service' | 'custom', refId: '',
    itemName: '', startDate: todayISO(), endDate: '', terms: ''
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimDesc, setClaimDesc] = useState('');
  const [claimRes, setClaimRes] = useState('Replacement approved');
  const [claimBusy, setClaimBusy] = useState(false);

  const data = useAsync(() => listWarranties(), [], { live: true });
  const customers = useAsync(() => customersWithBalances(), [], { live: true });
  const parts = useAsync(() => listParts(), [], { live: true });
  const services = useAsync(() => listServices(), [], { live: true });
  const [vehicles, setVehicles] = useState<{ id: string; regNo: string; make: string; model: string }[]>([]);

  useEffect(() => {
    runAutomatedChecks().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!form.customerId) { setVehicles([]); return; }
    import('../lib/db').then(({ dbBy }) => dbBy<{ id: string; regNo: string; make: string; model: string }>('vehicles', 'customerId', form.customerId).then(setVehicles));
  }, [form.customerId]);

  useEffect(() => {
    if (form.itemKind === 'part' && parts.data?.length && !form.refId) {
      const p = parts.data[0];
      setForm((f) => ({ ...f, refId: p.id, itemName: p.name }));
    }
    if (form.itemKind === 'service' && services.data?.length) {
      const s = services.data[0];
      setForm((f) => ({ ...f, refId: s.id, itemName: s.name }));
    }
  }, [form.itemKind, parts.data, services.data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayISO();
    const soon = todayISO(new Date(Date.now() + 30 * 86400000));
    return (data.data ?? []).filter((w) => {
      if (filter === 'active' && !(w.status === 'active' && w.endDate >= today)) return false;
      if (filter === 'expiring' && !(w.status === 'active' && w.endDate >= today && w.endDate <= soon)) return false;
      if (filter === 'expired' && !(w.endDate < today || w.status === 'expired')) return false;
      if (filter === 'claimed' && w.status !== 'claimed') return false;
      return !q || w.number.toLowerCase().includes(q) || w.itemName.toLowerCase().includes(q) || w.customerName.toLowerCase().includes(q) || w.vehicleLabel.toLowerCase().includes(q);
    });
  }, [data.data, search, filter]);

  const open = (data.data ?? []).find((w) => w.id === openId) ?? null;
  const today = todayISO();
  const soon = todayISO(new Date(Date.now() + 30 * 86400000));
  const effectiveStatus = (w: { status: string; endDate: string }) =>
    w.status === 'active' && w.endDate < today ? 'expired' : w.status;

  const save = async () => {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      if (!form.customerId) throw new Error('Select a customer.');
      if (!form.itemName.trim()) throw new Error('Enter the covered item name.');
      if (!form.endDate) throw new Error('Select the warranty expiry date.');
      await createWarranty({
        customerId: form.customerId, vehicleId: form.vehicleId || null,
        partId: form.itemKind === 'part' ? form.refId : null,
        serviceId: form.itemKind === 'service' ? form.refId : null,
        itemName: form.itemName, startDate: form.startDate, endDate: form.endDate, terms: form.terms
      }, { id: user.id, name: user.name, role: user.role });
      toast('Warranty registered.');
      setModal(false);
      data.reload();
      bump();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to register warranty.');
    } finally {
      setBusy(false);
    }
  };

  const submitClaim = async () => {
    if (!user || !open) return;
    setClaimBusy(true);
    try {
      await claimWarranty(open.id, claimDesc, claimRes, { id: user.id, name: user.name, role: user.role });
      toast('Warranty claim recorded.');
      setClaimOpen(false);
      setClaimDesc('');
      setOpenId(null);
      data.reload();
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to record claim', 'error');
    } finally {
      setClaimBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Warranty" subtitle="Coverage registered against parts, services, vehicles and invoices.">
        {can('warranty.manage') && <Button variant="primary" icon={<Plus size={15} />} onClick={() => setModal(true)}>Register warranty</Button>}
      </PageHeader>

      <Card>
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search warranty, item, customer or plate…" />
          <div className="grow" />
          <div className="pill-filters">
            {(['all', 'active', 'expiring', 'expired', 'claimed'] as const).map((f) => (
              <button key={f} className={`pill ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'expiring' ? 'Expiring ≤30d' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {data.loading && !data.data && <Loading />}
        {data.error && <ErrorState message={data.error} onRetry={data.reload} />}
        {data.data && rows.length === 0 && (
          <EmptyState icon={<ShieldCheck size={20} />} title="No warranties in this view" message="Register coverage when you sell a warranted part or complete warranted work." />
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Warranty</th><th>Item</th><th>Customer</th><th>Vehicle</th><th>Coverage</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id} className="clickable" onClick={() => setOpenId(w.id)}>
                    <td className="mono">{w.number}</td>
                    <td>{w.itemName}</td>
                    <td>{w.customerName}</td>
                    <td className="mono tiny">{w.vehicleLabel}</td>
                    <td className="tiny nowrap">{fmtDate(new Date(w.startDate).getTime())} → {fmtDate(new Date(w.endDate).getTime())}</td>
                    <td>
                      <div className="flex items-center gap-4">
                        <StatusPill status={effectiveStatus(w)} />
                        {w.status === 'active' && w.endDate >= today && w.endDate <= soon && <Badge tone="warning">Expiring</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} size="md" title="Register warranty"
        footer={<><Button onClick={() => setModal(false)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={save} loading={busy}>Register</Button></>}>
        <div className="form-section">
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="form-grid">
            <Field label="Customer" required>
              <Select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value, vehicleId: '' })}>
                <option value="">Select customer…</option>
                {(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
              </Select>
            </Field>
            <Field label="Vehicle (optional)">
              <Select value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })} disabled={!form.customerId}>
                <option value="">Not linked</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.regNo} · {v.make} {v.model}</option>)}
              </Select>
            </Field>
            <Field label="Covered item type">
              <Select value={form.itemKind} onChange={(e) => setForm({ ...form, itemKind: e.target.value as 'part' | 'service' | 'custom', refId: '', itemName: '' })}>
                <option value="part">Part</option>
                <option value="service">Service</option>
                <option value="custom">Other / custom</option>
              </Select>
            </Field>
            <Field label={form.itemKind === 'part' ? 'Part' : form.itemKind === 'service' ? 'Service' : 'Item name'}>
              {form.itemKind === 'custom' ? (
                <Input value={form.itemName} onChange={(e) => setForm({ ...form, itemName: e.target.value })} />
              ) : (
                <Select
                  value={form.refId}
                  onChange={(e) => {
                    const list = form.itemKind === 'part' ? parts.data ?? [] : services.data ?? [];
                    const item = list.find((x) => x.id === e.target.value);
                    setForm({ ...form, refId: e.target.value, itemName: item?.name ?? '' });
                  }}
                >
                  <option value="">Select…</option>
                  {(form.itemKind === 'part' ? parts.data ?? [] : services.data ?? []).map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Start date" required><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
            <Field label="Expiry date" required><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
            <Field label="Terms" className="span-2"><Textarea value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} placeholder="Coverage terms, exclusions…" style={{ minHeight: 64 }} /></Field>
          </div>
        </div>
      </Modal>

      <Drawer open={!!openId} onClose={() => setOpenId(null)} width={540} title={open ? `Warranty ${open.number}` : ''}
        footer={open && <div className="flex gap-8"><div className="grow" />{can('warranty.manage') && open.status !== 'claimed' && effectiveStatus(open) !== 'expired' && <Button size="sm" variant="primary" onClick={() => setClaimOpen(true)}>Record claim</Button>}<Button size="sm" onClick={() => setOpenId(null)}>Close</Button></div>}>
        {open && (
          <div className="flex-col gap-12">
            <div className="flex justify-between">
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{open.itemName}</div>
                <div className="tiny muted">{open.customerName} · {open.vehicleLabel}</div>
              </div>
              <StatusPill status={effectiveStatus(open)} />
            </div>
            <div className="mini-row"><span className="t">Coverage</span><span className="v">{fmtDate(new Date(open.startDate).getTime())} → {fmtDate(new Date(open.endDate).getTime())}</span></div>
            {open.terms && <div className="alert alert-info"><ShieldCheck size={14} /><span>{open.terms}</span></div>}
            <div>
              <div className="label" style={{ marginBottom: 4 }}>Claim history</div>
              {open.claims.length === 0 && <div className="small muted">No claims recorded.</div>}
              {open.claims.map((c, i) => (
                <div className="card card-pad" key={i} style={{ boxShadow: 'none', marginBottom: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{c.description}</div>
                  <div className="tiny muted">{c.resolution} · {fmtDate(c.at)} · {c.by}</div>
                </div>
              ))}
            </div>
            {effectiveStatus(open) === 'expired' && <div className="alert alert-warning"><AlertTriangle size={14} /><span>This warranty has expired and cannot receive new claims.</span></div>}
          </div>
        )}
      </Drawer>

      <Modal open={claimOpen} onClose={() => setClaimOpen(false)} size="sm" title="Record warranty claim"
        footer={<><Button onClick={() => setClaimOpen(false)} disabled={claimBusy}>Cancel</Button><Button variant="primary" onClick={submitClaim} loading={claimBusy}>Save claim</Button></>}>
        <div className="form-section">
          <Field label="Issue reported" required><Textarea value={claimDesc} onChange={(e) => setClaimDesc(e.target.value)} placeholder="Describe the fault and inspection outcome" /></Field>
          <Field label="Resolution"><Input value={claimRes} onChange={(e) => setClaimRes(e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  );
}
