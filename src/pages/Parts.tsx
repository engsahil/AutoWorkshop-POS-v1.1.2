import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, Plus, Tag, Upload } from 'lucide-react';
import {
  Pager,
  PageHeader, Card, Button, Modal, Field, Input, Select, Textarea, EmptyState, Loading, ErrorState,
  SearchInput, Money, StockPill, Badge
} from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { listParts, partCategories, listSuppliers } from '../lib/queries';
import { createPart, updatePart } from '../lib/repo';
import { useApp } from '../state/AppContext';
import { bump } from '../lib/bus';
import { toPaisa } from '../lib/money';
import type { Part } from '../lib/types';

const UNITS = ['pcs', 'litre', 'set', 'pair', 'kg', 'metre', 'box'];

export default function Parts() {
  const { settings, user, can, toast } = useApp();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Part | null>(null);
  const [page, setPage] = useState(1);

  const parts = useAsync(() => listParts({ search }), [search], { live: true });
  const categories = useAsync(() => partCategories(), [], { live: true });
  const suppliers = useAsync(() => listSuppliers(), []);

  const rows = (parts.data ?? []).filter((p) => category === 'all' || p.category === category);
  const PAGE_SIZE = 50;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => { setPage(1); }, [search, category]);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const pageRows = useMemo(() => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [rows, page]);
  const cur = settings.profile.currency;

  return (
    <div className="page">
      <PageHeader title="Parts" subtitle="The parts catalogue that feeds POS, job cards and purchasing.">
        {can('inventory.manage') && (
          <Link to="/inventory/import" className="btn btn-secondary"><Upload size={14} /> Bulk import</Link>
        )}
        {can('inventory.manage') && <Button variant="primary" icon={<Plus size={15} />} onClick={() => { setEditing(null); setFormOpen(true); }}>Add part</Button>}
      </PageHeader>

      <Card>
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, SKU or barcode…" />
          <Select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 170 }} aria-label="Filter by category">
            <option value="all">All categories</option>
            {(categories.data ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <div className="grow" />
          <span className="tiny muted">
            {rows.length > PAGE_SIZE
              ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, rows.length)} of ${rows.length}`
              : `${rows.length} part${rows.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {parts.loading && !parts.data && <Loading />}
        {parts.error && <ErrorState message={parts.error} onRetry={parts.reload} />}
        {parts.data && rows.length === 0 && (
          <EmptyState icon={<Package size={20} />} title={search ? 'No parts match' : 'The catalogue is empty'}
            message={search ? 'Try another name or SKU.' : 'Add parts once, then price, stock and sell them everywhere.'}
            action={can('inventory.manage') && !search ? <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>Add part</Button> : undefined} />
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Part</th><th>Category</th><th>Supplier</th><th>Stock</th><th className="num">Cost</th><th className="num">Sale price</th><th className="num">Margin</th><th /></tr></thead>
              <tbody>
                {pageRows.map((p) => {
                  const margin = p.pricePaisa > 0 ? Math.round(((p.pricePaisa - p.costPaisa) / p.pricePaisa) * 1000) / 10 : 0;
                  return (
                    <tr key={p.id}>
                      <td>
                        <div style={{ fontWeight: 650 }}>{p.name}</div>
                        <div className="tiny muted mono">{p.sku}{p.brand ? ` · ${p.brand}` : ''}</div>
                      </td>
                      <td className="tiny">{p.category}</td>
                      <td className="tiny">{p.supplierName ?? '—'}</td>
                      <td><StockPill qty={p.qty} reorder={p.reorderLevel} /><div className="tiny muted">reorder {p.reorderLevel}</div></td>
                      <td className="num"><Money value={p.costPaisa} /></td>
                      <td className="num"><Money value={p.pricePaisa} /></td>
                      <td className="num">{margin}%</td>
                      <td className="actions">
                        {can('inventory.manage') && <button className="btn btn-ghost btn-xs" onClick={() => { setEditing(p); setFormOpen(true); }}>Edit</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer">
          {rows.length > PAGE_SIZE
            ? <Pager page={page} total={rows.length} size={PAGE_SIZE} onPage={setPage} />
            : <div className="flex items-center gap-8 tiny muted"><Tag size={12} /> Quantities are changed only through purchases, returns and counted adjustments — never edited here.</div>}
        </div>
      </Card>

      {formOpen && (
        <PartForm
          key={editing?.id ?? 'new'}
          part={editing}
          categories={categories.data ?? []}
          suppliers={suppliers.data ?? []}
          currency={cur}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onSaved={() => { setFormOpen(false); setEditing(null); parts.reload(); categories.reload(); bump(); toast(editing ? 'Part updated.' : 'Part added.'); }}
        />
      )}
    </div>
  );
}

function PartForm({ part, categories, suppliers, currency, onClose, onSaved }: {
  part: Part | null;
  categories: string[];
  suppliers: { id: string; name: string }[];
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useApp();
  const [form, setForm] = useState({
    sku: part?.sku ?? '', name: part?.name ?? '', category: part?.category ?? categories[0] ?? 'General',
    brand: part?.brand ?? '', compatibility: part?.compatibility ?? '',
    cost: part ? (part.costPaisa / 100).toString() : '', price: part ? (part.pricePaisa / 100).toString() : '',
    minPrice: part?.minPricePaisa ? (part.minPricePaisa / 100).toString() : '',
    taxRate: String(part?.taxRate ?? 0), unit: part?.unit ?? 'pcs',
    reorderLevel: String(part?.reorderLevel ?? 5), openingQty: '', location: part?.location ?? '',
    supplierId: part?.supplierId ?? '', warrantyMonths: part?.warrantyMonths ? String(part.warrantyMonths) : '',
    barcode: part?.barcode ?? '', subcategory: part?.subcategory ?? '', description: part?.description ?? ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      const payload: Partial<Part> = {
        sku: form.sku.trim().toUpperCase(), name: form.name.trim(), category: form.category.trim() || 'General',
        brand: form.brand.trim(), compatibility: form.compatibility.trim(),
        costPaisa: toPaisa(form.cost || 0), pricePaisa: toPaisa(form.price || 0),
        minPricePaisa: form.minPrice ? toPaisa(form.minPrice) : undefined,
        taxRate: Number(form.taxRate) || 0, unit: form.unit, reorderLevel: Number(form.reorderLevel) || 0,
        location: form.location.trim(), supplierId: form.supplierId || undefined,
        barcode: form.barcode.trim() || undefined,
        subcategory: form.subcategory.trim() || undefined,
        description: form.description.trim() || undefined,
        warrantyMonths: form.warrantyMonths ? Number(form.warrantyMonths) : undefined
      };
      const actor = { id: user.id, name: user.name, role: user.role };
      if (part) await updatePart(part.id, payload, actor);
      else await createPart({ ...payload, qty: form.openingQty ? Number(form.openingQty) : 0 }, actor);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save part.');
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="md" title={part ? 'Edit part' : 'Add part'}
      sub={part ? undefined : 'Opening stock is recorded as a stock movement so the ledger stays complete.'}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy}>{part ? 'Save changes' : 'Add part'}</Button></>}>
      <div className="form-section">
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="form-grid">
          <Field label="SKU" required><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })} className="mono" /></Field>
          <Field label="Barcode" hint="A USB scanner types here — make sure the cursor is in this box. One part per barcode.">
            <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="mono" />
          </Field>
        </div>
        <Field label="Part name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
        <div className="form-grid">
          <Field label="Category" required>
            <Input list="part-categories" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <datalist id="part-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Subcategory"><Input value={form.subcategory} onChange={(e) => setForm({ ...form, subcategory: e.target.value })} placeholder="Brakes" /></Field>
          <Field label="Brand"><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
          <Field label="Compatibility"><Input value={form.compatibility} onChange={(e) => setForm({ ...form, compatibility: e.target.value })} placeholder="Corolla 2018–2022" /></Field>
          <Field label="Unit">
            <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </Field>
        </div>
        <div className="form-grid">
          <Field label={`Cost price (${currency})`} required><Input value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} inputMode="decimal" /></Field>
          <Field label={`Sale price (${currency})`} required><Input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" /></Field>
          <Field label={`Minimum price (${currency})`} hint="Optional floor used when discounting."><Input value={form.minPrice} onChange={(e) => setForm({ ...form, minPrice: e.target.value })} inputMode="decimal" /></Field>
          <Field label="Tax rate (%)"><Input value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: e.target.value })} inputMode="decimal" /></Field>
          <Field label="Reorder level"><Input value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} inputMode="numeric" /></Field>
          <Field label="Warranty (months)"><Input value={form.warrantyMonths} onChange={(e) => setForm({ ...form, warrantyMonths: e.target.value })} inputMode="numeric" /></Field>
          {!part && <Field label="Opening stock" hint="Recorded as an opening-stock movement."><Input value={form.openingQty} onChange={(e) => setForm({ ...form, openingQty: e.target.value })} inputMode="decimal" /></Field>}
          <Field label="Shelf location"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="A-3" /></Field>
        </div>
        <Field label="Description" hint="Optional. Shown in the parts catalogue and on this form.">
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ minHeight: 56 }} />
        </Field>
        <Field label="Preferred supplier">
          <Select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
            <option value="">No preferred supplier</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        {part && (
          <div className="alert alert-info"><Package size={14} /><span>Current stock is {part.qty} {part.unit}. Use Inventory → Adjust for counts and corrections so the movement ledger stays accurate.</span></div>
        )}
      </div>
    </Modal>
  );
}
