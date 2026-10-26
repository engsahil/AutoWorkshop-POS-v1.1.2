import { useState } from 'react';
import { HardHat, Plus } from 'lucide-react';
import {
  PageHeader, Card, Button, Modal, Field, Input, Select, Textarea, EmptyState, Loading, ErrorState,
  SearchInput, Money, Badge, ConfirmDialog
} from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { listLabor } from '../lib/queries';
import { createLabor, updateLabor } from '../lib/repo';
import { useApp } from '../state/AppContext';
import { bump } from '../lib/bus';
import { toPaisa } from '../lib/money';
import type { Labor } from '../lib/types';

const CATEGORIES = ['Mechanical', 'Electrical', 'Body', 'AC', 'Diagnostics', 'Helper'];

export default function LaborPage() {
  const { settings, user, can, toast } = useApp();
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Labor | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Labor | null>(null);

  const labor = useAsync(() => listLabor(), [], { live: true });
  const rows = (labor.data ?? []).filter((l) => {
    const term = search.trim().toLowerCase();
    return (!term || l.name.toLowerCase().includes(term) || l.code.toLowerCase().includes(term)) && (showArchived || !l.archived);
  });

  const toggleArchive = async (l: Labor) => {
    if (!user) return;
    try {
      await updateLabor(l.id, { archived: !l.archived }, { id: user.id, name: user.name, role: user.role });
      toast(l.archived ? 'Labour rate restored.' : 'Labour rate archived.');
      setArchiveTarget(null);
      labor.reload();
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to update labour rate', 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader title="Labor" subtitle="Labour operations and hourly rates used in estimates and invoices.">
        {can('inventory.manage') && <Button variant="primary" icon={<Plus size={15} />} onClick={() => { setEditing(null); setFormOpen(true); }}>Add labour rate</Button>}
      </PageHeader>

      <Card>
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search labour name or code…" />
          <div className="grow" />
          <Button variant="ghost" size="sm" onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Hide archived' : 'Show archived'}</Button>
        </div>
        {labor.loading && !labor.data && <Loading />}
        {labor.error && <ErrorState message={labor.error} onRetry={labor.reload} />}
        {labor.data && rows.length === 0 && (
          <EmptyState icon={<HardHat size={20} />} title="No labour rates" message="Add standard labour operations so job estimates stay consistent."
            action={can('inventory.manage') ? <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>Add labour rate</Button> : undefined} />
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Labour item</th><th>Category</th><th className="num">Rate</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div style={{ fontWeight: 650 }}>{l.name}</div>
                      <div className="tiny muted mono">{l.code}</div>
                      {l.description && <div className="tiny muted">{l.description}</div>}
                    </td>
                    <td className="tiny">{l.category}</td>
                    <td className="num"><Money value={l.ratePaisa} /></td>
                    <td>{l.archived ? <Badge tone="neutral">Archived</Badge> : <Badge tone="success" dot>Active</Badge>}</td>
                    <td className="actions">
                      {can('inventory.manage') && <button className="btn btn-ghost btn-xs" onClick={() => { setEditing(l); setFormOpen(true); }}>Edit</button>}
                      {can('inventory.manage') && <button className="btn btn-ghost btn-xs" onClick={() => setArchiveTarget(l)}>{l.archived ? 'Restore' : 'Archive'}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {formOpen && (
        <LaborForm key={editing?.id ?? 'new'} labor={editing} currency={settings.profile.currency}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onSaved={() => { setFormOpen(false); setEditing(null); labor.reload(); bump(); toast(editing ? 'Labour rate updated.' : 'Labour rate added.'); }} />
      )}

      <ConfirmDialog open={!!archiveTarget} title={archiveTarget?.archived ? 'Restore labour rate?' : 'Archive labour rate?'}
        message={archiveTarget?.archived ? 'It becomes selectable again in POS and job cards.' : 'Existing documents are unaffected; the rate is hidden from new work.'}
        confirmLabel={archiveTarget?.archived ? 'Restore' : 'Archive'}
        onConfirm={() => { if (archiveTarget) void toggleArchive(archiveTarget); }} onClose={() => setArchiveTarget(null)} />
    </div>
  );
}

function LaborForm({ labor, currency, onClose, onSaved }: {
  labor: Labor | null; currency: string; onClose: () => void; onSaved: () => void;
}) {
  const { user } = useApp();
  const [form, setForm] = useState({
    code: labor?.code ?? '', name: labor?.name ?? '', category: labor?.category ?? CATEGORIES[0],
    description: labor?.description ?? '', rate: labor ? (labor.ratePaisa / 100).toString() : ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      const payload: Partial<Labor> = {
        code: form.code.trim().toUpperCase(), name: form.name.trim(), category: form.category,
        description: form.description.trim(), ratePaisa: toPaisa(form.rate || 0)
      };
      const actor = { id: user.id, name: user.name, role: user.role };
      if (labor) await updateLabor(labor.id, payload, actor);
      else await createLabor(payload, actor);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save labour rate.');
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="sm" title={labor ? 'Edit labour rate' : 'Add labour rate'}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy}>{labor ? 'Save changes' : 'Add labour rate'}</Button></>}>
      <div className="form-section">
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="form-grid">
          <Field label="Code" required><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="mono" placeholder="LAB-BRK" /></Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Labour item" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder="Front brake pad replacement" /></Field>
        <Field label={`Rate (${currency})`} required><Input value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} inputMode="decimal" /></Field>
        <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ minHeight: 56 }} /></Field>
      </div>
    </Modal>
  );
}
