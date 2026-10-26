import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, Boxes, Download, History, PackageSearch, Upload } from 'lucide-react';
import {
  PageHeader, Card, Button, Modal, Field, Input, Select, Textarea, Drawer, EmptyState, Loading, ErrorState,
  StockPill, Badge, SearchInput, Money, Checkbox, Pager
} from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { listParts, partCategories, inventoryValuation, stockHistory } from '../lib/queries';
import { adjustStock } from '../lib/repo';
import { useApp } from '../state/AppContext';
import { bump } from '../lib/bus';
import { downloadCsv } from '../lib/csv';
import { formatMoney, formatQty, fmtDateTime } from '../lib/money';
import type { Part } from '../lib/types';

export default function Inventory() {
  const { settings, user, can, toast } = useApp();
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [lowOnly, setLowOnly] = useState(params.get('low') === '1');
  const [adjusting, setAdjusting] = useState<Part | null>(null);
  const [historyFor, setHistoryFor] = useState<Part | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const parts = useAsync(() => listParts({ search, category: category === 'all' ? undefined : category, lowOnly }), [search, category, lowOnly], { live: true });
  const categories = useAsync(() => partCategories(), []);
  const valuation = useAsync(() => inventoryValuation(), [], { live: true });
  const history = useAsync(() => (historyFor ? stockHistory(historyFor.id) : Promise.resolve([])), [historyFor?.id]);

  const rows = parts.data ?? [];
  const cur = settings.profile.currency;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => { setPage(1); }, [search, category, lowOnly]);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const pageRows = useMemo(() => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [rows, page]);

  return (
    <div className="page">
      <PageHeader title="Inventory" subtitle="Stock on hand, valuation and a permanent movement ledger.">
        {can('inventory.manage') && (
          <Link to="/inventory/import" className="btn btn-secondary"><Upload size={14} /> Bulk import</Link>
        )}
        <Button variant="secondary" icon={<Download size={14} />} disabled={!rows.length}
          onClick={() => downloadCsv('servixa-inventory', ['SKU', 'Name', 'Category', 'Unit', 'On hand', 'Reorder level', 'Cost', 'Price', 'Stock value'], rows.map((p) => [p.sku, p.name, p.category, p.unit, p.qty, p.reorderLevel, p.costPaisa / 100, p.pricePaisa / 100, (p.qty * p.costPaisa) / 100]))}>
          Export CSV
        </Button>
      </PageHeader>

      <div className="stat-strip" style={{ marginBottom: 12 }}>
        <div className="stat"><div className="lbl">Stock at cost</div><div className="val">{formatMoney(valuation.data?.costPaisa ?? 0, { currency: cur, decimals: false })}</div></div>
        <div className="stat"><div className="lbl">Stock at retail</div><div className="val">{formatMoney(valuation.data?.retailPaisa ?? 0, { currency: cur, decimals: false })}</div></div>
        <div className="stat"><div className="lbl">Units on hand</div><div className="val">{formatQty(valuation.data?.units ?? 0)}</div></div>
        <div className="stat"><div className="lbl">Low stock items</div><div className="val">{rows.filter((p) => p.qty <= p.reorderLevel).length}</div></div>
      </div>

      <Card>
        <div className="table-toolbar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search name, SKU or barcode…"
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const term = search.trim().toLowerCase();
              if (!term) return;
              const exact = rows.filter((p) => p.sku.toLowerCase() === term || (p.barcode ?? '').toLowerCase() === term);
              const target = exact[0] ?? (rows.length === 1 ? rows[0] : undefined);
              if (target) { e.preventDefault(); setHistoryFor(target); }
            }}
          />
          <Select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 170 }} aria-label="Filter by category">
            <option value="all">All categories</option>
            {(categories.data ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Checkbox label="Low stock only" checked={lowOnly} onChange={setLowOnly} />
          <div className="grow" />
          <span className="tiny muted">
            {rows.length > PAGE_SIZE
              ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, rows.length)} of ${rows.length}`
              : `${rows.length} item${rows.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {parts.loading && !parts.data && <Loading />}
        {parts.error && <ErrorState message={parts.error} onRetry={parts.reload} />}
        {parts.data && rows.length === 0 && (
          <EmptyState icon={<Boxes size={20} />} title={lowOnly ? 'Nothing at reorder level' : 'No stock items match'}
            message={lowOnly ? 'Every part is above its reorder point.' : 'Add parts from the Parts catalogue to start tracking stock.'} />
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Part</th><th>Category</th><th>Unit</th><th>On hand</th><th className="num">Cost</th><th className="num">Price</th><th className="num">Stock value</th><th /></tr></thead>
              <tbody>
                {pageRows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ fontWeight: 650 }}>{p.name}</div>
                      <div className="tiny muted mono">{p.sku}{p.brand ? ` · ${p.brand}` : ''}</div>
                    </td>
                    <td className="tiny">{p.category}</td>
                    <td className="tiny">{p.unit}</td>
                    <td><StockPill qty={p.qty} reorder={p.reorderLevel} /></td>
                    <td className="num"><Money value={p.costPaisa} /></td>
                    <td className="num"><Money value={p.pricePaisa} /></td>
                    <td className="num"><Money value={p.qty * p.costPaisa} /></td>
                    <td className="actions">
                      <button className="btn btn-ghost btn-xs" onClick={() => setHistoryFor(p)} title="Movement history"><History size={12} /></button>
                      {can('inventory.manage') && <button className="btn btn-secondary btn-xs" onClick={() => setAdjusting(p)}><ArrowLeftRight size={12} /> Adjust</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="table-footer">
              <Pager page={page} total={rows.length} size={PAGE_SIZE} onPage={setPage} />
            </div>
          </div>
        )}
      </Card>

      <AdjustDialog part={adjusting} onClose={() => setAdjusting(null)} onDone={() => { setAdjusting(null); parts.reload(); valuation.reload(); bump(); toast('Stock adjusted.'); }} />
      {historyFor && (
        <Drawer open onClose={() => setHistoryFor(null)} width={620} title={`${historyFor.name} · movements`}
          footer={<Button size="sm" onClick={() => setHistoryFor(null)}>Close</Button>}>
          {history.loading && <Loading />}
          {!history.loading && (history.data ?? []).length === 0 && <EmptyState icon={<History size={19} />} title="No movements yet" message="Stock changes from sales, purchases, returns and adjustments appear here." />}
          {(history.data ?? []).length > 0 && (
            <div className="table-wrap">
              <table className="table compact">
                <thead><tr><th>When</th><th>Type</th><th className="num">Qty</th><th>Note</th><th>By</th></tr></thead>
                <tbody>
                  {(history.data ?? []).map((m) => (
                    <tr key={m.id}>
                      <td className="tiny nowrap">{fmtDateTime(m.date)}</td>
                      <td><Badge tone={m.type === 'sale' ? 'neutral' : m.type === 'purchase' ? 'success' : m.type === 'return' ? 'warning' : 'info'}>{m.type}</Badge></td>
                      <td className="num" style={{ color: m.qty < 0 ? 'var(--danger)' : 'var(--success)' }}>{m.qty > 0 ? '+' : ''}{formatQty(m.qty)}</td>
                      <td className="tiny truncate" style={{ maxWidth: 190 }}>{m.note || '—'}</td>
                      <td className="tiny">{m.createdBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="alert alert-info" style={{ marginTop: 12 }}><PackageSearch size={14} /><span>Movements are append-only. Corrections are made with a new adjustment that states the reason.</span></div>
        </Drawer>
      )}
    </div>
  );
}

function AdjustDialog({ part, onClose, onDone }: { part: Part | null; onClose: () => void; onDone: () => void }) {
  const { user } = useApp();
  const [mode, setMode] = useState<'delta' | 'absolute'>('delta');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!part) return null;

  const preview = mode === 'absolute' ? Number(value || 0) : part.qty + Number(value || 0);

  const submit = async () => {
    if (!user) return;
    setError(null);
    if (!reason.trim()) { setError('A reason is required for every stock adjustment.'); return; }
    setBusy(true);
    try {
      await adjustStock(
        mode === 'absolute'
          ? { partId: part.id, absoluteQty: Number(value || 0), reason }
          : { partId: part.id, delta: Number(value || 0), reason },
        { id: user.id, name: user.name, role: user.role }
      );
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to adjust stock.');
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="sm" title={`Adjust stock · ${part.name}`}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy}>Save adjustment</Button></>}>
      <div className="form-section">
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="flex gap-16">
          <div className="mini-row" style={{ flex: 1 }}><span className="t">On hand</span><span className="v mono">{formatQty(part.qty)}</span></div>
          <div className="mini-row" style={{ flex: 1 }}><span className="t">After change</span><span className="v mono">{formatQty(preview)}</span></div>
        </div>
        <div className="segmented" style={{ alignSelf: 'flex-start' }}>
          <button className={mode === 'delta' ? 'active' : ''} onClick={() => setMode('delta')}>Add / remove</button>
          <button className={mode === 'absolute' ? 'active' : ''} onClick={() => setMode('absolute')}>Set counted</button>
        </div>
        <Field label={mode === 'delta' ? 'Change (use − for shrinkage)' : 'Counted quantity'} required>
          <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" autoFocus placeholder={mode === 'delta' ? '+5 or -2' : '0'} />
        </Field>
        <Field label="Reason" required hint="Stored on the movement record and in the audit trail.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ minHeight: 56 }} placeholder="Cycle count, damaged item, supplier correction…" />
        </Field>
      </div>
    </Modal>
  );
}
