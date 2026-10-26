import { useState } from 'react';
import { Clock, Plus, Wrench } from 'lucide-react';
import {
  PageHeader, Card, Button, Modal, Field, Input, Select, Textarea, EmptyState, Loading, ErrorState,
  SearchInput, Money, Badge, ConfirmDialog
} from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { listServices } from '../lib/queries';
import { createService, updateService } from '../lib/repo';
import { useApp } from '../state/AppContext';
import { bump } from '../lib/bus';
import { toPaisa } from '../lib/money';
import type { Service } from '../lib/types';

const CATEGORIES = ['General Service', 'Oil Change', 'Brake Service', 'AC Service', 'Electrical', 'Suspension', 'Engine', 'Body Work', 'Diagnostics'];

export default function Services() {
  const { settings, user, can, toast } = useApp();
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Service | null>(null);

  const services = useAsync(() => listServices(), [], { live: true });

  const rows = (services.data ?? []).filter((s) => {
    const term = search.trim().toLowerCase();
    const match = !term || s.name.toLowerCase().includes(term) || s.code.toLowerCase().includes(term) || s.category.toLowerCase().includes(term);
    return match && (showArchived || !s.archived);
  });

  const toggleArchive = async (s: Service) => {
    if (!user) return;
    try {
      await updateService(s.id, { archived: !s.archived }, { id: user.id, name: user.name, role: user.role });
      toast(s.archived ? 'Service restored.' : 'Service archived.');
      setArchiveTarget(null);
      services.reload();
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to update service', 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader title="Services" subtitle="Billable workshop services with fixed prices and tax rates.">
        {can('inventory.manage') && <Button variant="primary" icon={<Plus size={15} />} onClick={() => { setEditing(null); setFormOpen(true); }}>Add service</Button>}
      </PageHeader>

      <Card>
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search service name, code or category…" />
          <div className="grow" />
          <Button variant="ghost" size="sm" onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Hide archived' : 'Show archived'}</Button>
        </div>
        {services.loading && !services.data && <Loading />}
        {services.error && <ErrorState message={services.error} onRetry={services.reload} />}
        {services.data && rows.length === 0 && (
          <EmptyState icon={<Wrench size={20} />} title="No services yet" message="Services appear in POS and job cards with their price and tax rate."
            action={can('inventory.manage') ? <Button variant="primary" size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>Add service</Button> : undefined} />
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Service</th><th>Category</th><th>Duration</th><th className="num">Tax</th><th className="num">Price</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 650 }}>{s.name}</div>
                      <div className="tiny muted mono">{s.code}</div>
                    </td>
                    <td className="tiny">{s.category}</td>
                    <td className="tiny">{s.durationMins ? <span className="flex items-center gap-4"><Clock size={11} /> {s.durationMins} min</span> : '—'}</td>
                    <td className="num">{s.taxRate}%</td>
                    <td className="num"><Money value={s.pricePaisa} /></td>
                    <td>{s.archived ? <Badge tone="neutral">Archived</Badge> : <Badge tone="success" dot>Active</Badge>}</td>
                    <td className="actions">
                      {can('inventory.manage') && <button className="btn btn-ghost btn-xs" onClick={() => { setEditing(s); setFormOpen(true); }}>Edit</button>}
                      {can('inventory.manage') && <button className="btn btn-ghost btn-xs" onClick={() => setArchiveTarget(s)}>{s.archived ? 'Restore' : 'Archive'}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {formOpen && (
        <ServiceForm key={editing?.id ?? 'new'} service={editing} currency={settings.profile.currency}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onSaved={() => { setFormOpen(false); setEditing(null); services.reload(); bump(); toast(editing ? 'Service updated.' : 'Service added.'); }} />
      )}

      <ConfirmDialog open={!!archiveTarget} title={archiveTarget?.archived ? 'Restore service?' : 'Archive service?'}
        message={archiveTarget?.archived ? 'It will be selectable in POS and job cards again.' : 'Existing invoices keep their lines. Archived services are hidden from new sales.'}
        confirmLabel={archiveTarget?.archived ? 'Restore' : 'Archive'} busy={false}
        onConfirm={() => { if (archiveTarget) void toggleArchive(archiveTarget); }} onClose={() => setArchiveTarget(null)} />
    </div>
  );
}

function ServiceForm({ service, currency, onClose, onSaved }: {
  service: Service | null; currency: string; onClose: () => void; onSaved: () => void;
}) {
  const { user } = useApp();
  const [form, setForm] = useState({
    code: service?.code ?? '', name: service?.name ?? '', category: service?.category ?? CATEGORIES[0],
    description: service?.description ?? '', price: service ? (service.pricePaisa / 100).toString() : '',
    taxRate: String(service?.taxRate ?? 0), durationMins: service?.durationMins ? String(service.durationMins) : ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      const payload: Partial<Service> = {
        code: form.code.trim().toUpperCase(), name: form.name.trim(), category: form.category,
        description: form.description.trim(), pricePaisa: toPaisa(form.price || 0),
        taxRate: Number(form.taxRate) || 0,
        durationMins: form.durationMins ? Number(form.durationMins) : undefined
      };
      const actor = { id: user.id, name: user.name, role: user.role };
      if (service) await updateService(service.id, payload, actor);
      else await createService(payload, actor);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save service.');
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="sm" title={service ? 'Edit service' : 'Add service'}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy}>{service ? 'Save changes' : 'Add service'}</Button></>}>
      <div className="form-section">
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="form-grid">
          <Field label="Code" required><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="mono" placeholder="SRV-OIL" /></Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Service name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder="Synthetic oil change" /></Field>
        <div className="form-grid">
          <Field label={`Price (${currency})`} required><Input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" /></Field>
          <Field label="Tax rate (%)"><Input value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: e.target.value })} inputMode="decimal" /></Field>
        </div>
        <Field label="Typical duration (minutes)"><Input value={form.durationMins} onChange={(e) => setForm({ ...form, durationMins: e.target.value })} inputMode="numeric" /></Field>
        <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ minHeight: 56 }} /></Field>
      </div>
    </Modal>
  );
}
