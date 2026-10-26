import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Banknote, CreditCard, Landmark, RotateCcw, Wallet } from 'lucide-react';
import { Modal, Button, Field, Input, Select, Checkbox, Money } from './ui';
import { useApp } from '../state/AppContext';
import { payInvoice, createReturn, returnedQuantities, type PaymentInput } from '../lib/transactions';
import { opId } from '../lib/ids';
import { formatMoney, toPaisa } from '../lib/money';
import { bump } from '../lib/bus';
import type { Invoice } from '../lib/types';

const METHOD_ICONS: Record<string, React.ReactNode> = {
  cash: <Banknote size={13} />, card: <CreditCard size={13} />, bank: <Landmark size={13} />, online: <Wallet size={13} />
};

export function PaymentDialog({ invoice, open, onClose, onDone }: {
  invoice: Invoice | null; open: boolean; onClose: () => void; onDone: () => void;
}) {
  const { user, settings, toast } = useApp();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentInput['method']>('cash');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && invoice) {
      setAmount((invoice.duePaisa / 100).toFixed(2));
      setMethod('cash');
      setReference('');
      setError(null);
    }
  }, [open, invoice]);

  if (!invoice) return null;

  const submit = async () => {
    if (!user) return;
    setError(null);
    const paisa = toPaisa(amount);
    if (paisa <= 0) { setError('Enter a payment amount.'); return; }
    if (paisa > invoice.duePaisa) { setError('Payment exceeds the outstanding balance.'); return; }
    setBusy(true);
    try {
      await payInvoice(invoice.id, [{ method, amountPaisa: paisa, reference }], { id: user.id, name: user.name, role: user.role }, opId());
      toast(`Payment of ${formatMoney(paisa, { currency: settings.profile.currency })} recorded on ${invoice.number}.`);
      bump();
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record payment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record payment"
      sub={`${invoice.number} · outstanding ${formatMoney(invoice.duePaisa, { currency: settings.profile.currency })}`}
      size="sm"
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy}>Record payment</Button></>}
    >
      <div className="form-section">
        {error && <div className="alert alert-danger"><AlertCircle size={14} /><span>{error}</span></div>}
        <Field label="Amount" required>
          <div className="input-affix">
            <span className="affix">{settings.profile.currency}</span>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus />
          </div>
        </Field>
        <Field label="Method">
          <div className="pay-methods">
            {settings.documents.paymentMethods.map((m) => (
              <button key={m} type="button" className={`pay-method ${method === m ? 'active' : ''}`} onClick={() => setMethod(m)}>
                {METHOD_ICONS[m]} {m === 'bank' ? 'Bank' : m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Reference" hint="Card slip, transfer reference or receipt number.">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
    </Modal>
  );
}

export function ReturnDialog({ invoice, open, onClose, onDone }: {
  invoice: Invoice | null; open: boolean; onClose: () => void; onDone: () => void;
}) {
  const { user, settings, toast } = useApp();
  const [returned, setReturned] = useState<Record<string, number>>({});
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState<'cash' | 'card' | 'bank' | 'credit'>('cash');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !invoice) return;
    returnedQuantities(invoice.id).then((map) => {
      setReturned(map);
      const initial: Record<string, string> = {};
      const restockInit: Record<string, boolean> = {};
      for (const l of invoice.lines) {
        initial[l.id] = '';
        restockInit[l.id] = l.kind === 'part';
      }
      setQtys(initial);
      setRestock(restockInit);
    });
    setMethod('cash');
    setReason('');
    setError(null);
  }, [open, invoice]);

  const estimate = useMemo(() => {
    if (!invoice) return 0;
    const ratio = invoice.subtotalPaisa > 0 ? (invoice.subtotalPaisa - invoice.discountPaisa) / invoice.subtotalPaisa : 1;
    let total = 0;
    for (const line of invoice.lines) {
      const qty = Number(qtys[line.id] || 0);
      if (!qty) continue;
      const netUnit = (line.ratePaisa * line.qty - line.discountPaisa) / line.qty;
      const base = Math.round(netUnit * qty * ratio);
      total += base + Math.round((base * line.taxRate) / 100);
    }
    return total;
  }, [invoice, qtys]);

  if (!invoice) return null;

  const submit = async () => {
    if (!user) return;
    setError(null);
    const lines = invoice.lines
      .map((l) => ({ lineId: l.id, qty: Number(qtys[l.id] || 0), restock: !!restock[l.id] }))
      .filter((l) => l.qty > 0);
    if (!lines.length) { setError('Enter a quantity to return.'); return; }
    if (!reason.trim()) { setError('Enter a reason for the return.'); return; }
    setBusy(true);
    try {
      await createReturn({
        invoiceId: invoice.id, lines, refundMethod: method, reason,
        actor: { id: user.id, name: user.name, role: user.role }, opId: opId()
      });
      toast(`Return processed against ${invoice.number}.`);
      bump();
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to process return.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Return / credit note"
      sub={`Against ${invoice.number} · ${invoice.customerId ? 'customer invoice' : 'walk-in sale'}`}
      size="lg"
      footer={
        <>
          <div className="left tiny muted">Estimated credit <b className="mono">{formatMoney(estimate, { currency: settings.profile.currency })}</b></div>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon={<RotateCcw size={14} />} onClick={submit} loading={busy}>Process return</Button>
        </>
      }
    >
      <div className="flex-col gap-14">
        {error && <div className="alert alert-danger"><AlertCircle size={14} /><span>{error}</span></div>}
        <div className="alert alert-info">
          <AlertCircle size={14} />
          <span>Credits are applied to any outstanding balance first; the remainder is refunded using the selected method. Only physically returned parts are restocked.</span>
        </div>
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr><th>Item</th><th className="num">Sold</th><th className="num">Returned</th><th className="num">Return qty</th><th>Restock</th></tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => {
                const already = returned[l.id] ?? 0;
                const remaining = l.qty - already;
                return (
                  <tr key={l.id}>
                    <td>
                      <div style={{ fontWeight: 650 }}>{l.name}</div>
                      <div className="tiny muted">{l.kind}{l.sku ? ` · ${l.sku}` : ''} · {formatMoney(l.ratePaisa, { currency: settings.profile.currency })}</div>
                    </td>
                    <td className="num">{l.qty}</td>
                    <td className="num">{already || '—'}</td>
                    <td className="num">
                      <input
                        className="input"
                        style={{ width: 76, height: 28, textAlign: 'right', fontFamily: 'var(--font-mono)' }}
                        value={qtys[l.id] ?? ''}
                        disabled={remaining <= 0}
                        placeholder="0"
                        aria-label={`Return quantity for ${l.name}`}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const qty = Number(raw);
                          setQtys((q) => ({ ...q, [l.id]: isFinite(qty) && qty > remaining ? String(remaining) : raw }));
                        }}
                      />
                    </td>
                    <td>
                      {l.kind === 'part' ? (
                        <Checkbox label="To stock" checked={!!restock[l.id]} onChange={(v) => setRestock((r) => ({ ...r, [l.id]: v }))} />
                      ) : <span className="tiny muted">Not applicable</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="form-grid">
          <Field label="Refund method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="cash">Cash refund</option>
              <option value="card">Card refund</option>
              <option value="bank">Bank transfer</option>
              <option value="credit">Store credit (customer account)</option>
            </Select>
          </Field>
          <Field label="Reason" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong fitment, damaged part" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function PayBadge({ status }: { status: string }) {
  const tone = status === 'paid' ? 'success' : status === 'partial' ? 'warning' : 'danger';
  return <span className={`badge badge-${tone}`}>{status}</span>;
}

export function TotalCell({ paisa }: { paisa: number }) {
  return <Money value={paisa} decimals={false} />;
}
