import { useMemo, useState } from 'react';
import { Modal, SearchInput, Tabs, EmptyState, Loading } from './ui';
import { useAsync } from '../hooks/useAsync';
import { listParts, listServices, listLabor } from '../lib/queries';
import { formatMoney } from '../lib/money';
import { useApp } from '../state/AppContext';

export interface PickedItem {
  kind: 'part' | 'service' | 'labor';
  refId: string;
  name: string;
  ratePaisa: number;
  taxRate: number;
  sku?: string;
  stock?: number;
}

export function ItemPicker({ open, onClose, onPick, kinds = ['part', 'service', 'labor'] }: {
  open: boolean;
  onClose: () => void;
  onPick: (item: PickedItem) => void;
  kinds?: ('part' | 'service' | 'labor')[];
}) {
  const { settings } = useApp();
  const [tab, setTab] = useState<'part' | 'service' | 'labor'>(kinds[0]);
  const [query, setQuery] = useState('');
  const catalog = useAsync(async () => {
    const [parts, services, labor] = await Promise.all([listParts(), listServices(), listLabor()]);
    return { parts, services, labor };
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items: PickedItem[] = [];
    if (tab === 'part') {
      for (const p of catalog.data?.parts ?? []) {
        if (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode ?? '').includes(q)) {
          items.push({ kind: 'part', refId: p.id, name: p.name, ratePaisa: p.pricePaisa, taxRate: p.taxRate, sku: p.sku, stock: p.qty });
        }
      }
    }
    if (tab === 'service') {
      for (const s of catalog.data?.services ?? []) {
        if (!q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)) {
          items.push({ kind: 'service', refId: s.id, name: s.name, ratePaisa: s.pricePaisa, taxRate: s.taxRate });
        }
      }
    }
    if (tab === 'labor') {
      for (const l of catalog.data?.labor ?? []) {
        if (!q || l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q)) {
          items.push({ kind: 'labor', refId: l.id, name: l.name, ratePaisa: l.ratePaisa, taxRate: 0 });
        }
      }
    }
    return items.slice(0, 40);
  }, [catalog.data, tab, query]);

  return (
    <Modal open={open} onClose={onClose} title="Add line item" sub="Pick a part, service or labor item from the catalogue." size="lg">
      <div className="flex-col gap-12">
        <SearchInput value={query} onChange={setQuery} placeholder="Search by name, SKU or barcode…" autoFocus />
        {kinds.length > 1 && (
          <Tabs
            value={tab}
            onChange={(t) => { setTab(t); setQuery(''); }}
            tabs={kinds.map((k) => ({ id: k, label: k === 'part' ? 'Parts' : k === 'service' ? 'Services' : 'Labor' }))}
          />
        )}
        {catalog.loading && <Loading label="Loading catalogue…" />}
        {!catalog.loading && rows.length === 0 && (
          <EmptyState title="No catalogue items match" message="Add items in the Inventory, Services or Labor modules first." />
        )}
        {rows.length > 0 && (
          <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
            <table className="table compact">
              <thead>
                <tr><th>Item</th><th>Type</th><th className="num">Price</th><th className="num">Stock</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.kind}-${r.refId}`}>
                    <td><div style={{ fontWeight: 600 }}>{r.name}</div><div className="tiny muted mono">{r.sku ?? ''}</div></td>
                    <td className="tiny muted">{r.kind}</td>
                    <td className="num">{formatMoney(r.ratePaisa, { currency: settings.profile.currency })}</td>
                    <td className="num tiny">{r.kind === 'part' ? `${r.stock ?? 0}` : '—'}</td>
                    <td className="actions">
                      <button
                        className="btn btn-secondary btn-xs"
                        onClick={() => { onPick(r); onClose(); }}
                      >
                        Add
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
