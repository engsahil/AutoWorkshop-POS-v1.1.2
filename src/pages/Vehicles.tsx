import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Car, Gauge, Plus, ShieldCheck, Wrench } from 'lucide-react';
import {
  PageHeader, Card, Button, Modal, Field, Input, Textarea, Select, Drawer, EmptyState, Loading, ErrorState,
  StatusPill, Badge, SearchInput, Money, Tabs
} from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { vehiclesWithOwner, getVehicleDetail, customersWithBalances } from '../lib/queries';
import { createVehicle, updateVehicle } from '../lib/repo';
import { useApp } from '../state/AppContext';
import { bump } from '../lib/bus';
import { fmtDate } from '../lib/money';
import type { Customer, Vehicle } from '../lib/types';

export default function Vehicles() {
  const { user, can, toast } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [make, setMake] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [presetCustomer, setPresetCustomer] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(params.get('open'));

  const vehicles = useAsync(() => vehiclesWithOwner(), [], { live: true });
  const customers = useAsync(() => customersWithBalances(), []);
  const detail = useAsync(() => (openId ? getVehicleDetail(openId) : Promise.resolve(null)), [openId], { live: true });

  useEffect(() => {
    const newFlag = params.get('new') === '1';
    const customer = params.get('customer');
    if (newFlag && can('vehicles.manage')) {
      setEditing(null);
      setPresetCustomer(customer);
      setFormOpen(true);
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const rows = (vehicles.data ?? []).filter((v) => {
    const term = search.trim().toLowerCase();
    const match = !term || [v.regNo, v.make, v.model, v.ownerName, v.vin ?? '', v.engineNo ?? ''].some((f) => f.toLowerCase().includes(term));
    return match && (make === 'all' || v.make === make);
  });
  const makes = Array.from(new Set((vehicles.data ?? []).map((v) => v.make))).sort();

  return (
    <div className="page">
      <PageHeader title="Vehicles" subtitle="Registration-first vehicle records with owners and service history.">
        {can('vehicles.manage') && <Button variant="primary" icon={<Plus size={15} />} onClick={() => { setEditing(null); setPresetCustomer(null); setFormOpen(true); }}>Add vehicle</Button>}
      </PageHeader>

      <Card>
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search plate, make, model, owner, VIN…" />
          <Select value={make} onChange={(e) => setMake(e.target.value)} style={{ width: 160 }} aria-label="Filter by make">
            <option value="all">All makes</option>
            {makes.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
          <div className="grow" />
          <span className="tiny muted">{rows.length} vehicle{rows.length === 1 ? '' : 's'}</span>
        </div>

        {vehicles.loading && !vehicles.data && <Loading />}
        {vehicles.error && <ErrorState message={vehicles.error} onRetry={vehicles.reload} />}
        {vehicles.data && rows.length === 0 && (
          <EmptyState icon={<Car size={20} />} title={search ? 'No vehicles match' : 'No vehicles yet'}
            message={search ? 'Try another plate, make or owner name.' : 'Vehicles link customers to job cards, invoices and warranty history.'}
            action={can('vehicles.manage') && !search ? <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>Add vehicle</Button> : undefined} />
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Registration</th><th>Vehicle</th><th>Owner</th><th className="num">Odometer</th><th>Added</th><th /></tr></thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id} className="clickable" onClick={() => setOpenId(v.id)}>
                    <td className="mono" style={{ fontWeight: 650 }}>{v.regNo}</td>
                    <td>
                      <div>{v.make} {v.model}</div>
                      <div className="tiny muted">{v.year ? `${v.year}` : ''}{v.color ? ` · ${v.color}` : ''}</div>
                    </td>
                    <td className="truncate" style={{ maxWidth: 160 }}>{v.ownerName}</td>
                    <td className="num">{v.odometer ? v.odometer.toLocaleString() : '—'}</td>
                    <td className="tiny nowrap">{fmtDate(v.createdAt)}</td>
                    <td className="actions">
                      <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); navigate(`/jobcards?new=1&vehicle=${v.id}`); }}>New job</button>
                      {can('vehicles.manage') && <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); setEditing(v); setFormOpen(true); }}>Edit</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Drawer open={!!openId} onClose={() => { setOpenId(null); const next = new URLSearchParams(params); next.delete('open'); setParams(next, { replace: true }); }}
        width={740} title={detail.data ? `${detail.data.vehicle.regNo} · ${detail.data.vehicle.make} ${detail.data.vehicle.model}` : 'Vehicle'}
        footer={detail.data ? (
          <div className="flex gap-8">
            {can('vehicles.manage') && <Button size="sm" variant="secondary" onClick={() => { setEditing(detail.data!.vehicle); setFormOpen(true); }}>Edit</Button>}
            <div className="grow" />
            <Button size="sm" variant="secondary" onClick={() => navigate(`/jobcards?new=1&vehicle=${detail.data!.vehicle.id}`)}>New job card</Button>
            <Button size="sm" onClick={() => setOpenId(null)}>Close</Button>
          </div>
        ) : undefined}>
        {detail.loading && <Loading />}
        {detail.data && <VehicleDetail data={detail.data} />}
      </Drawer>

      {formOpen && (
        <VehicleForm
          key={editing?.id ?? 'new'}
          vehicle={editing}
          customers={customers.data ?? []}
          presetCustomer={presetCustomer}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onSaved={() => { setFormOpen(false); setEditing(null); vehicles.reload(); bump(); toast(editing ? 'Vehicle updated.' : 'Vehicle added.'); }}
        />
      )}
    </div>
  );
}

function VehicleDetail({ data }: { data: NonNullable<Awaited<ReturnType<typeof getVehicleDetail>>> }) {
  const [tab, setTab] = useState<'history' | 'invoices' | 'warranty'>('history');
  const { vehicle, owner, jobs, invoices, warranties } = data;
  return (
    <div className="flex-col gap-14">
      <div className="detail-grid">
        <div><div className="doc-label">Owner</div><div className="doc-strong">{owner?.name ?? '—'}</div><div className="tiny muted mono">{owner?.phone ?? ''}</div></div>
        <div><div className="doc-label">Odometer</div><div className="doc-strong mono">{vehicle.odometer ? `${vehicle.odometer.toLocaleString()} km` : '—'}</div></div>
        <div><div className="doc-label">VIN</div><div className="doc-strong mono tiny">{vehicle.vin || '—'}</div></div>
        <div><div className="doc-label">Engine no.</div><div className="doc-strong mono tiny">{vehicle.engineNo || '—'}</div></div>
        <div><div className="doc-label">Colour</div><div className="doc-strong">{vehicle.color || '—'}</div></div>
        <div><div className="doc-label">Year</div><div className="doc-strong">{vehicle.year || '—'}</div></div>
      </div>
      {vehicle.notes && <div><div className="label">Notes</div><p className="small" style={{ color: 'var(--text-soft)' }}>{vehicle.notes}</p></div>}

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'history', label: 'Service history', count: jobs.length },
        { id: 'invoices', label: 'Invoices', count: invoices.length },
        { id: 'warranty', label: 'Warranties', count: warranties.length }
      ]} />

      {tab === 'history' && (jobs.length === 0 ? <EmptyState icon={<Wrench size={19} />} title="No service history" message="Job cards for this vehicle will appear here." /> : (
        <div className="timeline-list">
          {jobs.map((j) => (
            <div className="timeline-row" key={j.id}>
              <div>
                <div style={{ fontWeight: 650 }}>{j.number} · {new Date(j.createdAt).toLocaleDateString('en-GB')}</div>
                <div className="small muted">{j.complaint}</div>
              </div>
              <div className="flex gap-8 items-center">
                <StatusPill status={j.status} />
                <span className="mono tiny"><Money value={j.estimatePaisa} decimals={false} /></span>
              </div>
            </div>
          ))}
        </div>
      ))}

      {tab === 'invoices' && (invoices.length === 0 ? <EmptyState title="No invoices" /> : (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Invoice</th><th>Date</th><th>Status</th><th className="num">Total</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}><td className="mono">{i.number}</td><td className="tiny">{fmtDate(i.date)}</td><td><StatusPill status={i.status === 'void' ? 'void' : i.paymentStatus} /></td><td className="num"><Money value={i.totalPaisa} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {tab === 'warranty' && (warranties.length === 0 ? <EmptyState icon={<ShieldCheck size={19} />} title="No warranties" message="Register a warranty from the Warranty module." /> : (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Item</th><th>Number</th><th>Period</th><th>Status</th></tr></thead>
            <tbody>
              {warranties.map((w) => (
                <tr key={w.id}>
                  <td>{w.itemName}</td>
                  <td className="mono tiny">{w.number}</td>
                  <td className="tiny">{w.startDate} → {w.endDate}</td>
                  <td><StatusPill status={w.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function VehicleForm({ vehicle, customers, presetCustomer, onClose, onSaved }: {
  vehicle: Vehicle | null;
  customers: Customer[];
  presetCustomer: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useApp();
  const [form, setForm] = useState({
    customerId: vehicle?.customerId ?? presetCustomer ?? '',
    regNo: vehicle?.regNo ?? '', make: vehicle?.make ?? '', model: vehicle?.model ?? '',
    year: vehicle?.year ? String(vehicle.year) : '', color: vehicle?.color ?? '',
    odometer: vehicle?.odometer ? String(vehicle.odometer) : '',
    vin: vehicle?.vin ?? '', engineNo: vehicle?.engineNo ?? '', notes: vehicle?.notes ?? ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      const payload = {
        ...form,
        year: form.year ? Number(form.year) : undefined,
        odometer: form.odometer ? Number(form.odometer) : undefined,
        regNo: form.regNo.toUpperCase().trim()
      };
      const actor = { id: user.id, name: user.name, role: user.role };
      if (vehicle) await updateVehicle(vehicle.id, payload, actor);
      else await createVehicle(payload, actor);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save vehicle.');
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="md" title={vehicle ? 'Edit vehicle' : 'Add vehicle'}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy}>{vehicle ? 'Save changes' : 'Add vehicle'}</Button></>}>
      <div className="form-section">
        {error && <div className="alert alert-danger">{error}</div>}
        <Field label="Owner" required>
          <Select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} disabled={!!vehicle}>
            <option value="">Select customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
          </Select>
        </Field>
        <div className="form-grid">
          <Field label="Registration number" required><Input value={form.regNo} onChange={(e) => setForm({ ...form, regNo: e.target.value.toUpperCase() })} placeholder="LEB-1234" className="mono" /></Field>
          <Field label="Colour"><Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></Field>
          <Field label="Make" required><Input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} placeholder="Toyota" /></Field>
          <Field label="Model" required><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="Corolla" /></Field>
          <Field label="Year"><Input value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" maxLength={4} /></Field>
          <Field label="Odometer (km)"><Input value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" /></Field>
          <Field label="VIN / chassis"><Input value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} className="mono" /></Field>
          <Field label="Engine number"><Input value={form.engineNo} onChange={(e) => setForm({ ...form, engineNo: e.target.value })} className="mono" /></Field>
        </div>
        <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ minHeight: 56 }} /></Field>
        <div className="alert alert-info"><Gauge size={14} /><span>Odometer updates are also recorded when a job card is invoiced.</span></div>
      </div>
    </Modal>
  );
}
