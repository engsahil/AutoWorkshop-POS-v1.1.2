import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, ArrowRight, Banknote, CreditCard, Landmark, Minus, Plus, Printer, Receipt,
  ScanBarcode, ShoppingCart, Trash2, UserPlus, Wallet, X
} from 'lucide-react';
import { PageHeader, Card, Button, Field, Input, Select, Modal, EmptyState, Badge, Loading } from '../components/ui';
import { ReceiptDoc, PrintPortal, printNow } from '../components/Print';
import { useApp } from '../state/AppContext';
import { useAsync } from '../hooks/useAsync';
import { customersWithBalances, listParts, listServices, listLabor, currentShift } from '../lib/queries';
import { computeInvoice, sell, openShift, type PaymentInput, type SaleLineInput } from '../lib/transactions';
import { createCustomer } from '../lib/repo';
import { bump } from '../lib/bus';
import { formatMoney, toPaisa, fromPaisa } from '../lib/money';
import { uid, opId } from '../lib/ids';
import type { Invoice, Part } from '../lib/types';

interface CartLine {
  key: string;
  kind: 'part' | 'service' | 'labor';
  refId: string;
  name: string;
  qty: number;
  ratePaisa: number;
  taxRate: number;
  stock?: number;
  sku?: string;
}

const METHOD_ICON: Record<string, React.ReactNode> = {
  cash: <Banknote size={13} />,
  card: <CreditCard size={13} />,
  bank: <Landmark size={13} />,
  online: <Wallet size={13} />
};

export default function POS() {
  const { user, settings, can, toast, notifySound } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const catalog = useAsync(async () => {
    const [parts, services, labor, customers] = await Promise.all([
      listParts(), listServices(), listLabor(), customersWithBalances()
    ]);
    return { parts, services, labor, customers: customers.filter((c) => !c.archived) };
  }, [], { live: true });
  const shiftState = useAsync(() => (user ? currentShift(user.id) : Promise.resolve(null)), [user?.id], { live: true });

  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'part' | 'service' | 'labor'>('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState<string>('');
  const [vehicleId, setVehicleId] = useState<string>('');
  const [invoiceDiscount, setInvoiceDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState<PaymentInput['method']>('cash');
  const [received, setReceived] = useState('');
  const [split, setSplit] = useState(false);
  const [splitRows, setSplitRows] = useState<{ method: PaymentInput['method']; amount: string }[]>([
    { method: 'cash', amount: '' }, { method: 'card', amount: '' }
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Invoice | null>(null);
  const [newCustomer, setNewCustomer] = useState(false);
  const [nc, setNc] = useState({ name: '', phone: '', email: '' });
  const [ncBusy, setNcBusy] = useState(false);
  const [shiftModal, setShiftModal] = useState(false);
  const [openingCash, setOpeningCash] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const saleOpId = useRef(opId());

  const currency = settings.profile.currency;
  const parts = catalog.data?.parts ?? [];
  const services = catalog.data?.services ?? [];
  const labor = catalog.data?.labor ?? [];
  const customers = catalog.data?.customers ?? [];
  const selectedCustomer = customers.find((c) => c.id === customerId);
  void selectedCustomer;

  const [vehicleOptions, setVehicleOptions] = useState<{ id: string; regNo: string; make: string; model: string }[]>([]);
  const [receiptVehicle, setReceiptVehicle] = useState<{ id: string; regNo: string; make: string; model: string } | null>(null);
  useEffect(() => {
    let alive = true;
    setVehicleId('');
    if (!customerId) { setVehicleOptions([]); return; }
    import('../lib/db').then(async ({ dbBy }) => {
      const rows = await dbBy<{ id: string; regNo: string; make: string; model: string; customerId: string }>('vehicles', 'customerId', customerId);
      if (alive) setVehicleOptions(rows.map((v) => ({ id: v.id, regNo: v.regNo, make: v.make, model: v.model })));
    });
    return () => { alive = false; };
  }, [customerId]);

  useEffect(() => {
    if (params.get('new') === '1') {
      setCart([]);
      setReceipt(null);
      saleOpId.current = opId();
      params.delete('new');
      setParams(params, { replace: true });
    }
    // Keyed on the query string so Ctrl/Cmd+N restarts a sale even when POS is
    // already open (a mount-only effect silently ignored the shortcut there).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list: CartLine[] = [];
    const match = (name: string, extra: string[] = []) =>
      !q || name.toLowerCase().includes(q) || extra.some((e) => e.toLowerCase().includes(q));
    if (kindFilter === 'all' || kindFilter === 'part') {
      for (const p of parts) {
        if (match(p.name, [p.sku, p.barcode ?? '', p.category, p.brand ?? ''])) {
          list.push({ key: `part:${p.id}`, kind: 'part', refId: p.id, name: p.name, qty: 1, ratePaisa: p.pricePaisa, taxRate: p.taxRate, stock: p.qty, sku: p.sku });
        }
      }
    }
    if (kindFilter === 'all' || kindFilter === 'service') {
      for (const s of services) {
        if (match(s.name, [s.code, s.category])) {
          list.push({ key: `service:${s.id}`, kind: 'service', refId: s.id, name: s.name, qty: 1, ratePaisa: s.pricePaisa, taxRate: s.taxRate });
        }
      }
    }
    if (kindFilter === 'all' || kindFilter === 'labor') {
      for (const l of labor) {
        if (match(l.name, [l.code, l.category])) {
          list.push({ key: `labor:${l.id}`, kind: 'labor', refId: l.id, name: l.name, qty: 1, ratePaisa: l.ratePaisa, taxRate: 0 });
        }
      }
    }
    return list.slice(0, 60);
  }, [parts, services, labor, query, kindFilter]);

  const totals = useMemo(() => {
    if (!cart.length) return { subtotal: 0, tax: 0, discount: 0, total: 0 };
    try {
      const computed = computeInvoice(cart.map((c) => ({
        kind: c.kind, refId: c.refId, name: c.name, qty: c.qty, ratePaisa: c.ratePaisa, taxRate: c.taxRate, discountPaisa: 0
      })), toPaisa(invoiceDiscount || 0));
      return { subtotal: computed.subtotalPaisa, tax: computed.taxPaisa, discount: computed.discountPaisa, total: computed.totalPaisa };
    } catch {
      return { subtotal: 0, tax: 0, discount: 0, total: 0 };
    }
  }, [cart, invoiceDiscount]);

  const appliedPayments: PaymentInput[] = useMemo(() => {
    if (!split) {
      const entered = received ? toPaisa(received) : totals.total;
      const amount = Math.min(entered, totals.total);
      return amount > 0 ? [{ method, amountPaisa: amount }] : [];
    }
    return splitRows
      .map((r) => ({ method: r.method, amountPaisa: toPaisa(r.amount || 0) }))
      .filter((r) => r.amountPaisa > 0);
  }, [split, received, totals.total, method, splitRows]);

  const paidTotal = appliedPayments.reduce((a, p) => a + p.amountPaisa, 0);
  const change = !split && received ? Math.max(0, toPaisa(received) - paidTotal) : 0;
  const due = Math.max(0, totals.total - paidTotal);

  const addLine = (line: CartLine) => {
    setError(null);
    setReceipt(null);
    if (line.kind === 'part' && (line.stock ?? 0) <= 0) {
      setError(`${line.name} is out of stock.`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((c) => c.key === line.key);
      if (existing) {
        if (line.kind === 'part' && existing.qty + 1 > (line.stock ?? 0)) {
          setError(`Only ${line.stock} × ${line.name} available.`);
          return prev;
        }
        return prev.map((c) => (c.key === line.key ? { ...c, qty: c.qty + 1 } : c));
      }
      return [...prev, { ...line }];
    });
  };

  const maybeReset = () => {
    if (receipt) {
      setReceipt(null);
      setCart([]);
      setInvoiceDiscount('');
      setReceived('');
      setNotes('');
      setCustomerId('');
      setVehicleId('');
      setSplit(false);
      setSplitRows([{ method: 'cash', amount: '' }, { method: 'card', amount: '' }]);
      saleOpId.current = opId();
      searchRef.current?.focus();
    }
  };

  const updateQty = (key: string, delta: number) => {
    setCart((prev) => prev.flatMap((c) => {
      if (c.key !== key) return [c];
      const qty = c.qty + delta;
      if (qty <= 0) return [];
      if (c.kind === 'part' && c.stock != null && qty > c.stock) {
        setError(`Only ${c.stock} × ${c.name} available.`);
        return [c];
      }
      return [{ ...c, qty }];
    }));
  };

  const complete = async () => {
    setError(null);
    if (!user) return;
    if (!cart.length) { setError('Add at least one item to the bill.'); return; }
    if (paidTotal > totals.total) { setError('Payment exceeds the bill total.'); return; }
    setBusy(true);
    try {
      const invoice = await sell({
        customerId: customerId || null,
        vehicleId: vehicleId || null,
        lines: cart.map<SaleLineInput>((c) => ({
          kind: c.kind, refId: c.refId, name: c.name, qty: c.qty, ratePaisa: c.ratePaisa, taxRate: c.taxRate, discountPaisa: 0
        })),
        invoiceDiscountPaisa: toPaisa(invoiceDiscount || 0),
        payments: appliedPayments,
        notes,
        actor: { id: user.id, name: user.name, role: user.role },
        opId: saleOpId.current
      });
      setReceipt(invoice);
      setReceiptVehicle(vehicleOptions.find((v) => v.id === vehicleId) ?? null);
      notifySound();
      toast(`Invoice ${invoice.number} completed.`);
      bump();
      shiftState.reload();
      catalog.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete the sale.');
    } finally {
      setBusy(false);
    }
  };

  const openNewShift = async () => {
    if (!user) return;
    try {
      await openShift(toPaisa(openingCash || 0), '', { id: user.id, name: user.name, role: user.role });
      setShiftModal(false);
      setOpeningCash('');
      shiftState.reload();
      toast('Shift opened.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to open shift', 'error');
    }
  };

  const saveCustomer = async () => {
    if (!user) return;
    setNcBusy(true);
    try {
      const created = await createCustomer({ name: nc.name, phone: nc.phone, email: nc.email }, { id: user.id, name: user.name, role: user.role });
      setCustomerId(created.id);
      setNewCustomer(false);
      setNc({ name: '', phone: '', email: '' });
      catalog.reload();
      toast('Customer added.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to add customer', 'error');
    } finally {
      setNcBusy(false);
    }
  };

  if (catalog.loading && !catalog.data) return <div className="page"><PageHeader title="POS Billing" /><Loading /></div>;

  return (
    <div className="page">
      <PageHeader
        title="POS Billing"
        subtitle="Scan or search to bill a customer. Stock moves when the sale completes."
      >
        {shiftState.data ? (
          <Badge tone="success" dot>Shift open · {formatMoney(shiftState.data.openingPaisa, { currency, decimals: false })} float</Badge>
        ) : (
          <button className="chip" onClick={() => setShiftModal(true)} style={{ cursor: 'pointer' }}>
            <AlertCircle size={12} /> No open shift — open one for cash reconciliation
          </button>
        )}
        {can('invoices.view') && (
          <Button variant="secondary" icon={<Receipt size={14} />} onClick={() => navigate('/invoices')}>Invoice history</Button>
        )}
      </PageHeader>

      <div className="pos-layout">
        <div className="pos-catalog">
          <Card>
            <div className="card-header" style={{ paddingBottom: 12 }}>
              <div className="pos-search-row grow">
                <div className="input-icon grow">
                  <ScanBarcode size={15} />
                  <input
                    ref={searchRef}
                    className="input"
                    value={query}
                    placeholder="Scan barcode or search parts, services, labor…"
                    aria-label="Search catalogue"
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && filtered[0]) addLine(filtered[0]);
                      if (e.key === 'Escape') setQuery('');
                    }}
                  />
                  {query && (
                    <button className="icon-btn sm clear-btn" onClick={() => setQuery('')} aria-label="Clear search"><X size={13} /></button>
                  )}
                </div>
                {can('customers.manage') && (
                  <Button variant="secondary" icon={<UserPlus size={14} />} onClick={() => setNewCustomer(true)}>New customer</Button>
                )}
              </div>
            </div>
            <div style={{ padding: '0 16px 14px' }}>
              <div className="pos-cats">
                {[
                  { id: 'all', label: `All items (${parts.length + services.length + labor.length})` },
                  { id: 'part', label: `Parts (${parts.length})` },
                  { id: 'service', label: `Services (${services.length})` },
                  { id: 'labor', label: `Labor (${labor.length})` }
                ].map((c) => (
                  <button key={c.id} className={`cat-chip ${kindFilter === c.id ? 'active' : ''}`} onClick={() => setKindFilter(c.id as typeof kindFilter)}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ padding: '0 16px 16px' }}>
              {filtered.length === 0 ? (
                <EmptyState
                  icon={<ShoppingCart size={19} />}
                  title="Nothing in the catalogue matches"
                  message="Try another search term, or add parts and services in the Inventory module."
                  action={can('inventory.manage') ? <Button size="sm" onClick={() => navigate('/parts?new=1')}>Add a part</Button> : undefined}
                />
              ) : (
                <div className="pos-grid">
                  {filtered.map((item) => (
                    <button
                      key={item.key}
                      className="pos-item"
                      onClick={() => addLine(item)}
                      disabled={item.kind === 'part' && (item.stock ?? 0) <= 0}
                      title={item.kind === 'part' ? `${item.sku} · ${item.stock} in stock` : item.name}
                    >
                      <span className="p-kind">{item.kind === 'part' ? item.sku ?? 'Part' : item.kind}</span>
                      <span className="p-name">{item.name}</span>
                      <span className="p-meta">
                        <span className="p-price">{formatMoney(item.ratePaisa, { currency, decimals: false })}</span>
                        {item.kind === 'part' && (
                          <span className={item.stock != null && item.stock <= 4 ? 'p-stock low' : 'p-stock'}>{item.stock} left</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="cart">
          <div className="cart-head">
            <div>
              <div style={{ fontSize: 13, fontWeight: 750 }}>Current Bill</div>
              <div className="tiny muted">{cart.reduce((a, c) => a + c.qty, 0)} item(s)</div>
            </div>
            {cart.length > 0 && (
              <Button size="xs" variant="ghost" icon={<Trash2 size={12} />} onClick={() => { setCart([]); setError(null); }}>Clear</Button>
            )}
          </div>

          <div style={{ padding: '10px 15px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="flex gap-6">
              <Select value={customerId} aria-label="Customer" onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Walk-in customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
              </Select>
              {can('customers.manage') && (
                <button className="btn btn-secondary btn-icon" onClick={() => setNewCustomer(true)} aria-label="Add customer" title="Add customer"><UserPlus size={14} /></button>
              )}
            </div>
            <Select value={vehicleId} aria-label="Vehicle" onChange={(e) => setVehicleId(e.target.value)} disabled={!customerId}>
              <option value="">{customerId ? (vehicleOptions.length ? 'Select vehicle (optional)' : 'No vehicles on file') : 'Select a customer to add a vehicle'}</option>
              {vehicleOptions.map((v) => <option key={v.id} value={v.id}>{v.regNo} · {v.make} {v.model}</option>)}
            </Select>
          </div>

          <div className="cart-lines">
            {cart.length === 0 ? (
              <div className="empty" style={{ padding: '26px 12px' }}>
                <div className="icon-wrap"><Receipt size={18} /></div>
                <h4>The bill is empty</h4>
                <p>Search or scan an item to begin. Press Enter in search to add the first match.</p>
              </div>
            ) : cart.map((line) => (
              <div className="cart-line" key={line.key}>
                <div className="cl-top">
                  <div className="grow">
                    <div className="cl-name">{line.name}</div>
                    <div className="cl-meta">
                      {line.kind !== 'part' ? line.kind : line.sku} · {formatMoney(line.ratePaisa, { currency })}
                      {line.taxRate > 0 ? ` · tax ${line.taxRate}%` : ''}
                    </div>
                  </div>
                  <div className="cl-total">{formatMoney(line.ratePaisa * line.qty, { currency, decimals: false })}</div>
                  <button className="icon-btn sm" onClick={() => setCart((prev) => prev.filter((c) => c.key !== line.key))} aria-label={`Remove ${line.name}`}>
                    <X size={13} />
                  </button>
                </div>
                <div className="flex items-center gap-8">
                  <div className="qty">
                    <button onClick={() => updateQty(line.key, -1)} aria-label="Decrease quantity"><Minus size={11} /></button>
                    <input
                      value={line.qty}
                      aria-label="Quantity"
                      inputMode="decimal"
                      onChange={(e) => {
                        const qty = Number(e.target.value);
                        setCart((prev) => prev.map((c) => (c.key === line.key ? { ...c, qty: isFinite(qty) && qty > 0 ? qty : 1 } : c)));
                      }}
                    />
                    <button onClick={() => updateQty(line.key, 1)} aria-label="Increase quantity"><Plus size={11} /></button>
                  </div>
                  {can('pos.discount') && (
                    <input
                      className="input"
                      style={{ height: 26, width: 92, fontSize: 11, fontFamily: 'var(--font-mono)' }}
                      value={fromPaisa(line.ratePaisa)}
                      aria-label={`Rate for ${line.name}`}
                      onChange={(e) => {
                        const rate = toPaisa(e.target.value);
                        setCart((prev) => prev.map((c) => (c.key === line.key ? { ...c, ratePaisa: rate } : c)));
                      }}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="cart-totals">
            <div className="total-row"><span>Subtotal</span><span className="mono">{formatMoney(totals.subtotal, { currency })}</span></div>
            <div className="total-row">
              <span className="flex items-center gap-6">
                Discount
                {can('pos.discount') && (
                  <input
                    className="input"
                    style={{ height: 24, width: 80, fontSize: 11, fontFamily: 'var(--font-mono)' }}
                    value={invoiceDiscount}
                    placeholder="0.00"
                    aria-label="Invoice discount"
                    disabled={!settings.documents.allowDiscounts}
                    onChange={(e) => setInvoiceDiscount(e.target.value)}
                  />
                )}
              </span>
              <span className="mono">-{formatMoney(totals.discount, { currency })}</span>
            </div>
            <div className="total-row"><span>Tax</span><span className="mono">{formatMoney(totals.tax, { currency })}</span></div>
            <div className="total-row grand"><span>Total</span><span className="mono">{formatMoney(totals.total, { currency })}</span></div>
            {paidTotal > 0 && (
              <>
                <div className="total-row"><span>Paid</span><span className="mono">{formatMoney(paidTotal, { currency })}</span></div>
                {due > 0 && <div className="total-row" style={{ color: 'var(--danger)' }}><span>Balance due</span><span className="mono">{formatMoney(due, { currency })}</span></div>}
                {change > 0 && <div className="total-row" style={{ color: 'var(--success)' }}><span>Change due</span><span className="mono">{formatMoney(change, { currency })}</span></div>}
              </>
            )}
          </div>

          <div className="cart-foot">
            {error && <div className="alert alert-danger" style={{ padding: '8px 10px', fontSize: 11.5 }}><AlertCircle size={13} /><span>{error}</span></div>}
            {!split ? (
              <>
                <div className="pay-methods">
                  {settings.documents.paymentMethods.map((m) => (
                    <button key={m} className={`pay-method ${method === m ? 'active' : ''}`} onClick={() => setMethod(m)}>
                      {METHOD_ICON[m]} {m === 'bank' ? 'Bank' : m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="flex gap-6 items-center">
                  <div className="input-affix grow">
                    <span className="affix">{currency}</span>
                    <Input
                      value={received}
                      placeholder={fromPaisa(totals.total).toFixed(2)}
                      aria-label="Amount received"
                      inputMode="decimal"
                      onChange={(e) => setReceived(e.target.value)}
                    />
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setSplit(true); setReceived(''); }}>Split</button>
                </div>
              </>
            ) : (
              <div className="flex-col gap-6">
                {splitRows.map((row, i) => (
                  <div className="flex gap-6" key={i}>
                    <Select
                      value={row.method}
                      aria-label="Payment method"
                      style={{ height: 32, fontSize: 11.5 }}
                      onChange={(e) => setSplitRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, method: e.target.value as PaymentInput['method'] } : r)))}
                    >
                      {settings.documents.paymentMethods.map((m) => <option key={m} value={m}>{m}</option>)}
                    </Select>
                    <Input
                      value={row.amount}
                      placeholder="0.00"
                      inputMode="decimal"
                      aria-label="Split payment amount"
                      style={{ height: 32, fontFamily: 'var(--font-mono)' }}
                      onChange={(e) => setSplitRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, amount: e.target.value } : r)))}
                    />
                    {splitRows.length > 2 && (
                      <button className="icon-btn sm" aria-label="Remove split row" onClick={() => setSplitRows((rows) => rows.filter((_, idx) => idx !== i))}><X size={13} /></button>
                    )}
                  </div>
                ))}
                <div className="flex justify-between">
                  <button className="btn btn-ghost btn-xs" onClick={() => setSplitRows((r) => [...r, { method: 'bank', amount: '' }])}>+ Add method</button>
                  <button className="btn btn-ghost btn-xs" onClick={() => setSplit(false)}>Use single payment</button>
                </div>
              </div>
            )}
            <textarea
              className="textarea"
              style={{ minHeight: 38, height: 38, fontSize: 11.5, padding: '8px 10px' }}
              placeholder="Note on this invoice (optional)"
              value={notes}
              aria-label="Invoice note"
              onChange={(e) => setNotes(e.target.value)}
            />
            <Button variant="primary" size="lg" block loading={busy} disabled={!cart.length} icon={!busy ? <ArrowRight size={15} /> : undefined} onClick={complete}>
              {busy ? 'Completing…' : `Complete sale · ${formatMoney(totals.total, { currency, decimals: false })}`}
            </Button>
          </div>
        </div>
      </div>

      <Modal
        open={!!receipt}
        onClose={() => setReceipt(null)}
        title="Sale complete"
        sub={receipt ? `${receipt.number} · ${formatMoney(receipt.totalPaisa, { currency })}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReceipt(null)}>Close</Button>
            {can('invoices.view') && receipt && (
              <Button variant="secondary" onClick={() => navigate(`/invoices?open=${receipt.id}`)}>Open invoice</Button>
            )}
            <Button variant="secondary" icon={<Printer size={14} />} onClick={() => printNow()}>Print receipt</Button>
            <Button variant="primary" onClick={maybeReset}>New sale</Button>
          </>
        }
      >
        {receipt && (
          <div className="receipt-preview-shell">
            <ReceiptDoc
              invoice={receipt}
              customer={customers.find((c) => c.id === receipt.customerId) ?? null}
              vehicle={receiptVehicle as never}
              settings={settings}
            />
          </div>
        )}
        {receipt && (
          <PrintPortal paper={settings.documents.receiptWidth === '58' ? '58' : '80'}>
            <ReceiptDoc
              invoice={receipt}
              customer={customers.find((c) => c.id === receipt.customerId) ?? null}
              vehicle={receiptVehicle as never}
              settings={settings}
            />
          </PrintPortal>
        )}
      </Modal>

      <Modal
        open={newCustomer}
        onClose={() => setNewCustomer(false)}
        title="Add customer"
        size="sm"
        footer={<><Button onClick={() => setNewCustomer(false)}>Cancel</Button><Button variant="primary" loading={ncBusy} onClick={saveCustomer}>Save customer</Button></>}
      >
        <div className="form-section">
          <Field label="Full name" required><Input value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} autoFocus /></Field>
          <Field label="Phone" required><Input value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} placeholder="03xx xxxxxxx" /></Field>
          <Field label="Email"><Input type="email" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal
        open={shiftModal}
        onClose={() => setShiftModal(false)}
        title="Open a cash shift"
        sub="Cash sales are reconciled against the shift that was open when they were taken."
        size="sm"
        footer={<><Button onClick={() => setShiftModal(false)}>Cancel</Button><Button variant="primary" onClick={openNewShift}>Open shift</Button></>}
      >
        <div className="form-section">
          <Field label="Opening cash float" hint={`Currency: ${currency}. Count the drawer before starting.`}>
            <Input value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} inputMode="decimal" placeholder="0.00" />
          </Field>
          <div className="alert alert-info"><AlertCircle size={14} /><span>A shift is optional for card/bank sales, but cash reconciliation requires it.</span></div>
        </div>
      </Modal>
    </div>
  );
}
