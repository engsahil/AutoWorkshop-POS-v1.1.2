import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, PackageCheck, Plus, Printer, Trash2, Truck, Wallet } from 'lucide-react';
import {
  PageHeader, Card, Button, Modal, Field, Input, Select, Textarea, SearchInput, EmptyState, Loading,
  ErrorState, StatusPill, Drawer
} from '../components/ui';
import { PurchaseDoc, PrintPortal } from '../components/Print';
import { useAsync } from '../hooks/useAsync';
import { listPurchases, listSuppliers, listParts } from '../lib/queries';
import { createPurchase, receivePurchase, payPurchase, cancelPurchase } from '../lib/transactions';
import { useApp } from '../state/AppContext';
import { bump } from '../lib/bus';
import { formatMoney, fmtDate, fmtDateTime, fromPaisa, toPaisa, parseISODate } from '../lib/money';
import { uid, opId } from '../lib/ids';
import type { Purchase } from '../lib/types';

interface DraftLine { id: string; partId?: string; name: string; sku?: string; qty: string; cost: string; taxRate: string }

export default function Purchases() {
  const { user, settings, can, toast } = useApp();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'card' | 'bank' | 'online'>('bank');
  const [payBusy, setPayBusy] = useState(false);
  const [printId, setPrintId] = useState<string | null>(null);

  const data = useAsync(() => listPurchases({ status, search }), [status, search], { live: true });
  const suppliers = useAsync(() => listSuppliers(), [], { live: true });
  const parts = useAsync(() => listParts(), [], { live: true });

  useEffect(() => {
    if (params.get('new') === '1') {
      setCreating(true);
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
    // Keyed on the query string so Ctrl/Cmd+N opens the form even when the
    // page is already mounted; a mount-only effect left a stale ?new=1 behind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const rows = data.data ?? [];
  const openPurchase = rows.find((p) => p.id === openId) ?? null;
  const supplier = suppliers.data?.find((s) => s.id === openPurchase?.supplierId) ?? null;

  const draftTotal = useMemo(() => lines.reduce((a, l) => a + (Number(l.qty) || 0) * toPaisa(l.cost || 0), 0), [lines]);

  const addPartLine = (partId: string) => {
    const p = parts.data?.find((x) => x.id === partId);
    if (!p) return;
    setLines((ls) => [...ls, { id: uid('pl'), partId: p.id, name: p.name, sku: p.sku, qty: '1', cost: fromPaisa(p.costPaisa).toString(), taxRate: String(p.taxRate) }]);
  };

  const addFreeLine = () => setLines((ls) => [...ls, { id: uid('pl'), name: '', qty: '1', cost: '0', taxRate: '0' }]);

  const save = async () => {
    if (!user) return;
    setError(null);
    if (!supplierId) { setError('Select a supplier.'); return; }
    const valid = lines.filter((l) => l.name.trim() && Number(l.qty) > 0);
    if (!valid.length) { setError('Add at least one line with a name and quantity.'); return; }
    setBusy(true);
    try {
      await createPurchase({
        supplierId, notes,
        lines: valid.map((l) => ({
          partId: l.partId, name: l.name, sku: l.sku, qty: Number(l.qty), costPaisa: toPaisa(l.cost || 0), taxRate: Number(l.taxRate || 0)
        }))
      }, { id: user.id, name: user.name, role: user.role });
      toast('Purchase recorded as a draft. Receive it to add stock.');
      setCreating(false);
      setLines([]); setSupplierId(''); setNotes('');
      data.reload();
      bump();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create purchase.');
    } finally {
      setBusy(false);
    }
  };

  const receive = async (purchase: Purchase) => {
    if (!user) return;
    try {
      await receivePurchase(purchase.id, { id: user.id, name: user.name, role: user.role });
      toast(`${purchase.number} received — stock increased.`);
      data.reload();
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to receive purchase', 'error');
    }
  };

  const cancel = async (purchase: Purchase) => {
    if (!user) return;
    try {
      await cancelPurchase(purchase.id, 'Cancelled from purchases list', { id: user.id, name: user.name, role: user.role });
      toast(`${purchase.number} cancelled.`);
      data.reload();
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to cancel purchase', 'error');
    }
  };

  const pay = async () => {
    if (!user || !openPurchase) return;
    setPayBusy(true);
    try {
      await payPurchase(openPurchase.id, [{ method: payMethod, amountPaisa: toPaisa(payAmount) }], { id: user.id, name: user.name, role: user.role }, opId());
      toast('Supplier payment recorded.');
      setPayOpen(false);
      setPayAmount('');
      data.reload();
      suppliers.reload();
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to record payment', 'error');
    } finally {
      setPayBusy(false);
    }
  };

  const print = (id: string) => {
    setPrintId(id);
    setTimeout(() => {
      window.print();
      setTimeout(() => setPrintId(null), 400);
    }, 280);
  };

  return (
    <div className="page">
      <PageHeader title="Purchases" subtitle="Supplier purchases add stock only when goods are received.">
        {can('purchases.manage') && <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>New purchase</Button>}
      </PageHeader>

      <Card>
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search purchase number or supplier…" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 150 }} aria-label="Status">
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="received">Received</option>
            <option value="cancelled">Cancelled</option>
          </Select>
          <div className="grow" />
          <span className="tiny muted">{rows.length} purchase{rows.length === 1 ? '' : 's'}</span>
        </div>
        {data.loading && !data.data && <Loading />}
        {data.error && <ErrorState message={data.error} onRetry={data.reload} />}
        {data.data && rows.length === 0 && (
          <EmptyState icon={<Truck size={20} />} title="No purchases recorded" message="Record supplier purchases to bring stock in through a controlled receiving step."
            action={can('purchases.manage') ? <Button size="sm" variant="primary" onClick={() => setCreating(true)}>New purchase</Button> : undefined} />
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Purchase</th><th>Supplier</th><th>Date</th><th className="num">Total</th><th className="num">Paid</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => setOpenId(p.id)}>
                    <td className="mono">{p.number}</td>
                    <td>{p.supplierName}</td>
                    <td className="tiny nowrap">{fmtDate(p.date)}</td>
                    <td className="num">{formatMoney(p.totalPaisa, { currency: settings.profile.currency, decimals: false })}</td>
                    <td className="num tiny">{formatMoney(p.paidPaisa, { currency: settings.profile.currency, decimals: false })}</td>
                    <td><StatusPill status={p.status} /></td>
                    <td className="actions">
                      {can('purchases.manage') && p.status === 'draft' && (
                        <button className="btn btn-primary btn-xs" onClick={(e) => { e.stopPropagation(); receive(p); }}>Receive</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} size="xl" title="New purchase"
        sub="Line costs update the part cost price when the purchase is received."
        footer={<><Button variant="ghost" onClick={addFreeLine} icon={<Plus size={13} />}>Custom line</Button><div className="left" /><Button onClick={() => setCreating(false)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={save} loading={busy}>Save draft</Button></>}>
        <div className="form-section">
          {error && <div className="alert alert-danger"><AlertCircle size={14} /><span>{error}</span></div>}
          <div className="form-grid">
            <Field label="Supplier" required>
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Select supplier…</option>
                {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Add catalogue part">
              <Select value="" onChange={(e) => { addPartLine(e.target.value); e.target.value = ''; }}>
                <option value="">Choose a part to add…</option>
                {(parts.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}
              </Select>
            </Field>
            <Field label="Notes" className="span-2"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 54 }} /></Field>
          </div>
          {lines.length === 0 ? (
            <div className="alert alert-info"><PackageCheck size={14} /><span>Add at least one line. Stock increases only after you receive this purchase.</span></div>
          ) : (
            <div className="table-wrap">
              <table className="table compact">
                <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Tax %</th><th className="num">Total</th><th /></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <Input value={l.name} placeholder="Item name" aria-label="Item name" style={{ height: 28, fontSize: 12 }}
                          onChange={(e) => setLines((ls) => ls.map((x) => x.id === l.id ? { ...x, name: e.target.value } : x))} />
                        {l.sku && <div className="tiny muted mono">{l.sku}</div>}
                      </td>
                      <td className="num"><Input value={l.qty} style={{ width: 70, height: 28, textAlign: 'right' }} inputMode="decimal" aria-label="Quantity"
                        onChange={(e) => setLines((ls) => ls.map((x) => x.id === l.id ? { ...x, qty: e.target.value } : x))} /></td>
                      <td className="num"><Input value={l.cost} style={{ width: 100, height: 28, textAlign: 'right', fontFamily: 'var(--font-mono)' }} inputMode="decimal" aria-label="Unit cost"
                        onChange={(e) => setLines((ls) => ls.map((x) => x.id === l.id ? { ...x, cost: e.target.value } : x))} /></td>
                      <td className="num"><Input value={l.taxRate} style={{ width: 70, height: 28, textAlign: 'right' }} inputMode="decimal" aria-label="Tax rate"
                        onChange={(e) => setLines((ls) => ls.map((x) => x.id === l.id ? { ...x, taxRate: e.target.value } : x))} /></td>
                      <td className="num tiny">{formatMoney((Number(l.qty) || 0) * toPaisa(l.cost || 0), { currency: settings.profile.currency })}</td>
                      <td className="actions"><button className="icon-btn sm" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}><Trash2 size={13} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="tiny muted">Purchase totals exclude discounts unless entered on the invoice.</span>
            <span className="strong">Draft total <span className="mono">{formatMoney(draftTotal, { currency: settings.profile.currency })}</span></span>
          </div>
        </div>
      </Modal>

      <Drawer open={!!openId} onClose={() => setOpenId(null)} width={600} title={openPurchase ? `Purchase ${openPurchase.number}` : ''}
        footer={openPurchase && (
          <div className="flex gap-8 wrap">
            {can('purchases.manage') && openPurchase.status === 'draft' && (
              <>
                <Button size="sm" variant="primary" icon={<PackageCheck size={13} />} onClick={() => receive(openPurchase)}>Receive stock</Button>
                <Button size="sm" variant="ghost" onClick={() => cancel(openPurchase)}>Cancel purchase</Button>
              </>
            )}
            {openPurchase.paidPaisa < openPurchase.totalPaisa && openPurchase.status !== 'cancelled' && can('purchases.manage') && (
              <Button size="sm" variant="secondary" icon={<Wallet size={13} />} onClick={() => { setPayOpen(true); setPayAmount(((openPurchase.totalPaisa - openPurchase.paidPaisa) / 100).toFixed(2)); }}>Pay supplier</Button>
            )}
            <div className="grow" />
            <Button size="sm" variant="secondary" icon={<Printer size={13} />} onClick={() => print(openPurchase.id)}>Print</Button>
            <Button size="sm" onClick={() => setOpenId(null)}>Close</Button>
          </div>
        )}>
        {openPurchase && (
          <div className="flex-col gap-14">
            <div className="flex justify-between gap-10">
              <div>
                <div className="label">Supplier</div>
                <div style={{ fontWeight: 700 }}>{supplier?.name ?? openPurchase.supplierName}</div>
                <div className="tiny muted">{supplier?.phone ?? ''}</div>
              </div>
              <StatusPill status={openPurchase.status} />
            </div>
            <div className="mini-row"><span className="t">Created</span><span className="v">{fmtDateTime(openPurchase.date)}</span></div>
            {openPurchase.receivedAt && <div className="mini-row"><span className="t">Received</span><span className="v">{fmtDateTime(openPurchase.receivedAt)}</span></div>}
            <div className="table-wrap">
              <table className="table compact">
                <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Cost</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {openPurchase.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.name}<div className="tiny muted mono">{l.sku}</div></td>
                      <td className="num">{l.qty}</td>
                      <td className="num">{formatMoney(l.costPaisa, { currency: settings.profile.currency })}</td>
                      <td className="num">{formatMoney(l.totalPaisa, { currency: settings.profile.currency })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="mini-row"><span className="t">Subtotal</span><span className="v mono">{formatMoney(openPurchase.subtotalPaisa, { currency: settings.profile.currency })}</span></div>
              <div className="mini-row"><span className="t">Tax</span><span className="v mono">{formatMoney(openPurchase.taxPaisa, { currency: settings.profile.currency })}</span></div>
              <div className="mini-row"><span className="t strong" style={{ color: 'var(--text)' }}>Total</span><span className="v mono">{formatMoney(openPurchase.totalPaisa, { currency: settings.profile.currency })}</span></div>
              <div className="mini-row"><span className="t">Paid</span><span className="v mono">{formatMoney(openPurchase.paidPaisa, { currency: settings.profile.currency })}</span></div>
              <div className="mini-row"><span className="t">Outstanding</span><span className="v mono" style={{ color: 'var(--danger)' }}>{formatMoney(openPurchase.totalPaisa - openPurchase.paidPaisa, { currency: settings.profile.currency })}</span></div>
            </div>
            {openPurchase.notes && <div className="alert alert-info"><span>{openPurchase.notes}</span></div>}
          </div>
        )}
      </Drawer>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} size="sm" title="Pay supplier"
        footer={<><Button onClick={() => setPayOpen(false)} disabled={payBusy}>Cancel</Button><Button variant="primary" onClick={pay} loading={payBusy}>Record payment</Button></>}>
        <div className="form-section">
          <Field label="Amount">
            <div className="input-affix"><span className="affix">{settings.profile.currency}</span><Input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} inputMode="decimal" autoFocus /></div>
          </Field>
          <Field label="Method">
            <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}>
              {settings.documents.paymentMethods.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>
        </div>
      </Modal>

      {printId && (() => {
        const p = rows.find((x) => x.id === printId);
        if (!p) return null;
        return (
          <PrintPortal>
            <PurchaseDoc purchase={p} supplier={suppliers.data?.find((s) => s.id === p.supplierId)} settings={settings} />
          </PrintPortal>
        );
      })()}
    </div>
  );
}
