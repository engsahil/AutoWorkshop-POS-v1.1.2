import { useEffect, useState } from 'react';
import { FileText, Printer, Receipt, RotateCcw, ShieldAlert, Wallet } from 'lucide-react';
import { Modal, Button, Loading, ErrorState, StatusPill } from './ui';
import { InvoiceDoc, ReceiptDoc, PrintPortal } from './Print';
import { useApp } from '../state/AppContext';
import { useAsync } from '../hooks/useAsync';
import { getInvoiceDetail } from '../lib/queries';
import { voidInvoice } from '../lib/transactions';
import { PaymentDialog, ReturnDialog } from './Billing';
import { formatMoney, fmtDateTime } from '../lib/money';
import { bump } from '../lib/bus';
import type { Invoice } from '../lib/types';

export function InvoiceDetailModal({ invoiceId, onClose, onChanged }: {
  invoiceId: string | null; onClose: () => void; onChanged?: () => void;
}) {
  const { settings, can, user, toast } = useApp();
  const detail = useAsync(() => (invoiceId ? getInvoiceDetail(invoiceId) : Promise.resolve(null)), [invoiceId]);
  const [pay, setPay] = useState(false);
  const [ret, setRet] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidBusy, setVoidBusy] = useState(false);
  const [printMode, setPrintMode] = useState<'a4' | 'receipt' | null>(null);

  useEffect(() => {
    if (!printMode) return;
    let reset: ReturnType<typeof setTimeout> | undefined;
    const t = setTimeout(() => {
      window.print();
      reset = setTimeout(() => setPrintMode(null), 400);
    }, 260);
    return () => {
      clearTimeout(t);
      if (reset) clearTimeout(reset);
    };
  }, [printMode]);

  const invoice = detail.data?.invoice ?? null;
  const payments = detail.data?.payments ?? [];

  const doVoid = async () => {
    if (!user || !invoice) return;
    setVoidBusy(true);
    try {
      await voidInvoice(invoice.id, voidReason, { id: user.id, name: user.name, role: user.role });
      toast(`${invoice.number} voided. Stock restored and payments reversed.`);
      setVoidOpen(false);
      setVoidReason('');
      detail.reload();
      onChanged?.();
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to void invoice', 'error');
    } finally {
      setVoidBusy(false);
    }
  };

  if (!invoiceId) return null;

  return (
    <>
      <Modal
        open={!!invoiceId}
        onClose={onClose}
        size="xl"
        title={invoice ? `Invoice ${invoice.number}` : 'Invoice'}
        sub={invoice ? `${fmtDateTime(invoice.date)} · ${invoice.type === 'job' ? 'Job card invoice' : invoice.type === 'pos' ? 'POS sale' : 'Manual'}` : undefined}
        footer={
          <>
            <div className="left flex gap-6 wrap">
              {invoice?.status === 'completed' && invoice.duePaisa > 0 && can('pos.sell') && (
                <Button size="sm" variant="primary" icon={<Wallet size={13} />} onClick={() => setPay(true)}>Record payment</Button>
              )}
              {invoice?.status === 'completed' && can('invoices.refund') && (
                <Button size="sm" variant="secondary" icon={<RotateCcw size={13} />} onClick={() => setRet(true)}>Return items</Button>
              )}
              {invoice?.status === 'completed' && can('pos.void') && (
                <Button size="sm" variant="ghost" icon={<ShieldAlert size={13} />} onClick={() => setVoidOpen(true)}>Void</Button>
              )}
            </div>
            <Button size="sm" variant="secondary" icon={<Printer size={13} />} onClick={() => setPrintMode('receipt')} disabled={!invoice}>Receipt</Button>
            <Button size="sm" variant="secondary" icon={<FileText size={13} />} onClick={() => setPrintMode('a4')} disabled={!invoice}>Print A4</Button>
            <Button size="sm" onClick={onClose}>Close</Button>
          </>
        }
      >
        {detail.loading && !detail.data && <Loading label="Loading invoice…" />}
        {detail.error && <ErrorState message={detail.error} onRetry={detail.reload} />}
        {invoice && (
          <div className="flex-col gap-16">
            <div className="stat-strip">
              <div className="stat"><div className="lbl">Total</div><div className="val">{formatMoney(invoice.totalPaisa, { currency: settings.profile.currency })}</div></div>
              <div className="stat"><div className="lbl">Paid</div><div className="val">{formatMoney(invoice.paidPaisa, { currency: settings.profile.currency })}</div></div>
              <div className="stat"><div className="lbl">Balance</div><div className="val">{formatMoney(invoice.duePaisa, { currency: settings.profile.currency })}</div></div>
              <div className="stat"><div className="lbl">Status</div><div className="val" style={{ fontSize: 13, marginTop: 6 }}><StatusPill status={invoice.status === 'void' ? 'void' : invoice.paymentStatus} /></div></div>
            </div>

            <div className="grid-2" style={{ gap: 16 }}>
              <div>
                <div className="label">Customer</div>
                <div style={{ fontWeight: 700 }}>{detail.data?.customer?.name ?? 'Walk-in customer'}</div>
                <div className="small muted">{detail.data?.customer?.phone ?? 'No customer linked'}</div>
                {detail.data?.customer?.address && <div className="small muted">{detail.data.customer.address}</div>}
              </div>
              <div>
                <div className="label">Vehicle</div>
                <div style={{ fontWeight: 700 }} className="mono">{detail.data?.vehicle?.regNo ?? '—'}</div>
                {detail.data?.vehicle && <div className="small muted">{detail.data.vehicle.make} {detail.data.vehicle.model} {detail.data.vehicle.year ?? ''}</div>}
                {detail.data?.job && <div className="small muted">Job card: {detail.data.job.number}</div>}
              </div>
            </div>

            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Tax</th><th className="num">Amount</th></tr>
                </thead>
                <tbody>
                  {invoice.lines.map((l) => (
                    <tr key={l.id}>
                      <td><div style={{ fontWeight: 600 }}>{l.name}</div><div className="tiny muted">{l.kind}{l.sku ? ` · ${l.sku}` : ''}</div></td>
                      <td className="num">{l.qty}</td>
                      <td className="num">{formatMoney(l.ratePaisa, { currency: settings.profile.currency })}</td>
                      <td className="num">{l.taxRate ? `${l.taxRate}%` : '—'}</td>
                      <td className="num">{formatMoney(l.totalPaisa, { currency: settings.profile.currency })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between wrap gap-16" style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 240 }}>
                <div className="label" style={{ marginBottom: 6 }}>Payments</div>
                {payments.length === 0 && <div className="small muted">No payments recorded — full balance outstanding.</div>}
                {payments.map((p) => (
                  <div className="mini-row" key={p.id}>
                    <span className="t">{p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
                    <span className="v mono">{formatMoney(p.amountPaisa, { currency: settings.profile.currency })}</span>
                  </div>
                ))}
                {(detail.data?.returns.length ?? 0) > 0 && (
                  <>
                    <div className="label" style={{ margin: '12px 0 6px' }}>Returns</div>
                    {detail.data?.returns.map((r) => (
                      <div className="mini-row" key={r.id}>
                        <span className="t">{r.number} · {r.reason}</span>
                        <span className="v mono">{formatMoney(r.totalPaisa, { currency: settings.profile.currency })}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
              <div style={{ width: 260 }}>
                <div className="mini-row"><span className="t">Subtotal</span><span className="v mono">{formatMoney(invoice.subtotalPaisa, { currency: settings.profile.currency })}</span></div>
                <div className="mini-row"><span className="t">Discount</span><span className="v mono">-{formatMoney(invoice.discountPaisa, { currency: settings.profile.currency })}</span></div>
                <div className="mini-row"><span className="t">Tax</span><span className="v mono">{formatMoney(invoice.taxPaisa, { currency: settings.profile.currency })}</span></div>
                <div className="mini-row"><span className="t strong" style={{ color: 'var(--text)' }}>Total</span><span className="v mono" style={{ fontWeight: 700 }}>{formatMoney(invoice.totalPaisa, { currency: settings.profile.currency })}</span></div>
              </div>
            </div>

            {invoice.notes && (
              <div className="alert alert-info"><Receipt size={14} /><span>{invoice.notes}</span></div>
            )}
          </div>
        )}
      </Modal>

      <PaymentDialog
        invoice={invoice}
        open={pay}
        onClose={() => setPay(false)}
        onDone={() => { detail.reload(); onChanged?.(); }}
      />
      <ReturnDialog
        invoice={invoice}
        open={ret}
        onClose={() => setRet(false)}
        onDone={() => { detail.reload(); onChanged?.(); }}
      />

      <Modal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        size="sm"
        title="Void this invoice?"
        footer={<><Button onClick={() => setVoidOpen(false)} disabled={voidBusy}>Cancel</Button><Button variant="danger" onClick={doVoid} loading={voidBusy}>Void invoice</Button></>}
      >
        <div className="flex-col gap-12">
          <div className="alert alert-danger">
            <ShieldAlert size={15} />
            <span>Voiding reverses recorded payments, restores stock for part lines and marks the invoice void. This is recorded in the audit trail.</span>
          </div>
          <div className="field">
            <label>Reason <span className="req">*</span></label>
            <textarea className="textarea" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Why is this invoice being voided?" />
          </div>
        </div>
      </Modal>

      {invoice && printMode === 'a4' && (
        <PrintPortal paper="a4">
          <InvoiceDoc invoice={invoice} customer={detail.data?.customer} vehicle={detail.data?.vehicle} settings={settings} payments={payments} />
        </PrintPortal>
      )}
      {invoice && printMode === 'receipt' && (
        <PrintPortal paper={settings.documents.receiptWidth === '58' ? '58' : '80'}>
          <ReceiptDoc invoice={invoice} customer={detail.data?.customer} vehicle={detail.data?.vehicle} settings={settings} payments={payments} />
        </PrintPortal>
      )}
    </>
  );
}
