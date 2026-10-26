import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Car, FileText, Package, Search, User, Wrench, ClipboardList, CornerDownLeft
} from 'lucide-react';
import { Modal, useDebounced } from './ui';
import { searchEverything } from '../lib/queries';
import { useApp } from '../state/AppContext';
import type { Permission } from '../lib/types';

interface Result {
  id: string;
  label: string;
  sub: string;
  group: string;
  to: string;
  icon: React.ReactNode;
}

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can } = useApp();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounced(term, 180);
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setTerm(''); setActive(0); }
  }, [open]);

  useEffect(() => {
    let alive = true;
    if (debounced.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    searchEverything(debounced, 5)
      .then((r) => {
        if (!alive) return;
        const out: Result[] = [];
        const allow = (p: Permission) => can(p);
        if (allow('customers.view')) {
          for (const c of r.customers) out.push({ id: c.id, label: c.name, sub: c.phone, group: 'Customers', to: `/customers?open=${c.id}`, icon: <User size={13} /> });
        }
        if (allow('vehicles.view')) {
          for (const v of r.vehicles) out.push({ id: v.id, label: v.regNo, sub: `${v.make} ${v.model}`, group: 'Vehicles', to: `/vehicles?open=${v.id}`, icon: <Car size={13} /> });
        }
        if (allow('invoices.view')) {
          for (const i of r.invoices) out.push({ id: i.id, label: i.number, sub: i.paymentStatus, group: 'Invoices', to: `/invoices?open=${i.id}`, icon: <FileText size={13} /> });
        }
        if (allow('jobcards.view')) {
          for (const j of r.jobs) out.push({ id: j.id, label: j.number, sub: j.status.replace('_', ' '), group: 'Job cards', to: `/jobcards?open=${j.id}`, icon: <ClipboardList size={13} /> });
        }
        if (allow('inventory.view')) {
          for (const p of r.parts) out.push({ id: p.id, label: p.name, sub: `${p.sku} · ${p.qty} in stock`, group: 'Parts', to: `/parts?open=${p.id}`, icon: <Package size={13} /> });
          for (const s of r.services) out.push({ id: s.id, label: s.name, sub: s.category, group: 'Services', to: '/services', icon: <Wrench size={13} /> });
        }
        setResults(out);
        setActive(0);
      })
      .finally(() => alive && setSearching(false));
    return () => { alive = false; };
  }, [debounced, can]);

  const grouped = useMemo(() => {
    const map = new Map<string, Result[]>();
    for (const r of results) {
      const list = map.get(r.group) ?? [];
      list.push(r);
      map.set(r.group, list);
    }
    return Array.from(map.entries());
  }, [results]);

  const go = (r: Result) => {
    onClose();
    navigate(r.to);
  };

  return (
    <Modal open={open} onClose={onClose} title="Search" hideClose size="md">
      <div className="search-modal" style={{ margin: -18 }}>
        <div className="search-input-row">
          <Search size={17} className="muted" />
          <input
            ref={inputRef}
            autoFocus
            value={term}
            placeholder="Search customers, vehicles, invoices, parts…"
            aria-label="Global search"
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active]); }
            }}
          />
          <kbd className="tiny muted">Esc</kbd>
        </div>
        <div className="search-results">
          {term.trim().length < 2 && (
            <div className="empty" style={{ padding: '26px 16px' }}>
              <div className="icon-wrap"><Search size={18} /></div>
              <h4>Find anything fast</h4>
              <p>Search by customer name, phone, plate number, invoice or part SKU.</p>
            </div>
          )}
          {term.trim().length >= 2 && !searching && results.length === 0 && (
            <div className="empty" style={{ padding: '26px 16px' }}>
              <h4>No matches for “{term}”</h4>
              <p>Check the spelling or try a plate number, phone or invoice reference.</p>
            </div>
          )}
          {searching && <div className="loading-row"><span className="spinner" /> Searching local records…</div>}
          {grouped.map(([group, items]) => (
            <div key={group}>
              <div className="search-group-label">{group}</div>
              {items.map((r) => {
                const index = results.indexOf(r);
                return (
                  <button
                    key={`${r.group}-${r.id}`}
                    className={`search-result ${index === active ? 'active' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(r)}
                  >
                    <span className="sr-icon">{r.icon}</span>
                    <span>{r.label}</span>
                    <span className="sr-sub">{r.sub}</span>
                    {index === active && <CornerDownLeft size={12} className="muted" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
