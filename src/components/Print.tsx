import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AppSettings, CashShift, Customer, Expense, Invoice, JobCard, Payment, Purchase, ReturnDoc, Supplier, Vehicle } from '../lib/types';
import { fmtDate, fmtDateTime, formatMoney, formatQty } from '../lib/money';
import { BrandGlyph } from './Brand';

const paymentLabel = (m: string) => ({ cash: 'Cash', card: 'Card', bank: 'Bank transfer', online: 'Online' } as Record<string, string>)[m] ?? m;

/** Injects document markup into a `.print-area` node that only appears when printing. */
export function PrintPortal({ children, paper = 'a4' }: { children: ReactNode; paper?: 'a4' | '58' | '80' }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.createElement('div');
    // `print-paper-*` drives the @page size in print.css so a thermal receipt
    // is not laid out on an A4 sheet (which silently reflows the columns).
    el.className = `print-area print-paper-${paper}`;
    document.body.appendChild(el);
    document.body.dataset.printPaper = paper;
    el.setAttribute('data-paper', paper);
    setHost(el);
    return () => {
      el.remove();
      delete document.body.dataset.printPaper;
    };
  }, [paper]);
  if (!host) return null;
  return createPortal(children, host);
}

export function printNow() {
  window.setTimeout(() => window.print(), 180);
}

function DocHeader({ settings, title, number, date, meta }: {
  settings: AppSettings; title: string; number?: string; date?: number; meta?: ReactNode;
}) {
  const logo = settings.attachments.logo;
  return (
    <div className="doc-head">
      <div className="doc-brand">
        {settings.documents.showLogoOnReceipt && (
          logo ? <img src={logo} alt="" className="doc-logo" /> : <BrandGlyph size={30} tone="light" />
        )}
        <div>
          <div className="doc-biz">{settings.profile.name || 'Workshop'}</div>
          {settings.profile.address && <div className="doc-muted">{settings.profile.address}</div>}
          <div className="doc-muted">
            {[settings.profile.phone, settings.profile.email].filter(Boolean).join(' · ')}
          </div>
          {(settings.profile.taxNumber || settings.profile.regNumber) && (
            <div className="doc-muted">
              {settings.profile.taxNumber ? `Tax: ${settings.profile.taxNumber}` : ''}
              {settings.profile.taxNumber && settings.profile.regNumber ? ' · ' : ''}
              {settings.profile.regNumber ? `Reg: ${settings.profile.regNumber}` : ''}
            </div>
          )}
        </div>
      </div>
      <div className="doc-title-block">
        <div className="doc-title">{title}</div>
        {number && <div className="doc-number mono">{number}</div>}
        {date && <div className="doc-muted">{fmtDateTime(date, settings.profile.timezone)}</div>}
        {meta}
      </div>
    </div>
  );
}

export function ReceiptDoc({
  invoice, customer, vehicle, settings, payments, job
}: {
  invoice: Invoice; customer?: Customer | null; vehicle?: Vehicle | null; settings: AppSettings;
  payments?: Payment[]; job?: JobCard | null;
}) {
  const width = settings.documents.receiptWidth === '58' ? '58mm' : '80mm';
  const compact = settings.documents.receiptWidth === '58';
  return (
    <div className="receipt-paper" style={{ width, padding: compact ? '3mm 3mm' : '4mm 4mm', fontSize: compact ? '9px' : '10px' }}>
      <div className="receipt-top">
        <div className="receipt-logo-row">
          {settings.attachments.logo ? <img src={settings.attachments.logo} alt="" className="rlogo" /> : <BrandGlyph size={26} tone="plain" />}
          <div>
            <div className="r-biz">{settings.profile.name || 'Workshop'}</div>
            {settings.profile.address && <div className="r-muted">{settings.profile.address}</div>}
            <div className="r-muted">{[settings.profile.phone, settings.profile.email].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <div className="r-divider" />
        <div className="r-row"><span>Invoice</span><span className="mono">{invoice.number}</span></div>
        <div className="r-row"><span>Date</span><span>{fmtDateTime(invoice.date)}</span></div>
        <div className="r-row"><span>Cashier</span><span>{invoice.createdBy}</span></div>
        {customer && <div className="r-row"><span>Customer</span><span>{customer.name}</span></div>}
        {customer?.phone && <div className="r-row"><span>Phone</span><span className="mono">{customer.phone}</span></div>}
        {vehicle && <div className="r-row"><span>Vehicle</span><span className="mono">{vehicle.regNo}</span></div>}
        {vehicle && <div className="r-row"><span>&nbsp;</span><span>{vehicle.make} {vehicle.model}{vehicle.year ? ` ${vehicle.year}` : ''}</span></div>}
        {job && <div className="r-row"><span>Job card</span><span className="mono">{job.number}</span></div>}
        <div className="r-divider" />
      </div>
      <table className="r-items">
        <thead>
          <tr>
            <th>Item</th>
            <th className="c">Qty</th>
            {/* 58 mm paper is ~204 px wide inside the margins: a separate rate
                column pushes the money cells into wrapping. Fold the rate under
                the item name there instead. */}
            {!compact && <th className="r">Rate</th>}
            <th className="r">Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l) => (
            <tr key={l.id}>
              <td>
                <div className="ri-name">{l.name}</div>
                {compact && (
                  <div className="r-muted">
                    {formatQty(l.qty)} × {formatMoney(l.ratePaisa, { decimals: false })}
                  </div>
                )}
                {l.discountPaisa > 0 && <div className="r-muted">Discount {formatMoney(l.discountPaisa)}</div>}
              </td>
              <td className="c mono">{formatQty(l.qty)}</td>
              {!compact && <td className="r mono">{formatMoney(l.ratePaisa, { decimals: false })}</td>}
              <td className="r mono">{formatMoney(l.totalPaisa)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="r-divider" />
      <div className="r-totals">
        <div className="r-row"><span>Subtotal</span><span className="mono">{formatMoney(invoice.subtotalPaisa)}</span></div>
        {invoice.discountPaisa > 0 && <div className="r-row"><span>Discount</span><span className="mono">-{formatMoney(invoice.discountPaisa)}</span></div>}
        {invoice.taxPaisa > 0 && <div className="r-row"><span>Tax</span><span className="mono">{formatMoney(invoice.taxPaisa)}</span></div>}
        <div className="r-row r-grand"><span>Total</span><span className="mono">{formatMoney(invoice.totalPaisa)}</span></div>
        <div className="r-row"><span>Paid</span><span className="mono">{formatMoney(invoice.paidPaisa)}</span></div>
        {invoice.duePaisa > 0 && <div className="r-row r-due"><span>Balance due</span><span className="mono">{formatMoney(invoice.duePaisa)}</span></div>}
      </div>
      {payments && payments.length > 0 && (
        <>
          <div className="r-divider" />
          <div className="r-subhead">Payments &amp; refunds</div>
          {payments.map((p) => {
            // A refund moved cash OUT of the drawer: it must print with a minus
            // sign, otherwise the payment list appears to exceed the total.
            const signed = p.kind === 'refund' ? -Math.abs(p.amountPaisa) : p.amountPaisa;
            // Refund references already read "Refund INV-000001"; repeating the
            // word wastes a whole line on 58 mm paper.
            const ref = p.kind === 'refund' ? (p.reference ?? '').replace(/^Refund\s+/i, '') : p.reference;
            return (
              <div className="r-row" key={p.id}>
                <span>
                  {paymentLabel(p.method)}
                  {p.kind === 'refund' ? ' refund' : ''}
                  {ref ? ` · ${ref}` : ''}
                </span>
                <span className="mono">{formatMoney(signed)}</span>
              </div>
            );
          })}
        </>
      )}
      <div className="r-divider" />
      <div className="r-foot">{settings.documents.footerNote}</div>
    </div>
  );
}

export function InvoiceDoc({ invoice, customer, vehicle, settings, payments }: {
  invoice: Invoice; customer?: Customer | null; vehicle?: Vehicle | null; settings: AppSettings; payments?: Payment[];
}) {
  return (
    <div className="doc-paper">
      <DocHeader settings={settings} title="TAX INVOICE" number={invoice.number} date={invoice.date}
        meta={<div className={`doc-stamp ${invoice.status === 'void' ? 'void' : ''}`}>{invoice.status === 'void' ? 'VOID' : invoice.paymentStatus.toUpperCase()}</div>} />
      <div className="doc-meta-grid">
        <div>
          <div className="doc-label">Billed to</div>
          <div className="doc-strong">{customer?.name ?? 'Walk-in customer'}</div>
          {customer?.phone && <div className="doc-muted mono">{customer.phone}</div>}
          {customer?.address && <div className="doc-muted">{customer.address}</div>}
          {customer?.cnic && <div className="doc-muted">CNIC: {customer.cnic}</div>}
        </div>
        <div>
          <div className="doc-label">Vehicle</div>
          {vehicle ? (
            <>
              <div className="doc-strong mono">{vehicle.regNo}</div>
              <div className="doc-muted">{vehicle.make} {vehicle.model}{vehicle.year ? ` · ${vehicle.year}` : ''}</div>
              {vehicle.vin && <div className="doc-muted mono">VIN {vehicle.vin}</div>}
              {vehicle.odometer != null && <div className="doc-muted">Odometer {vehicle.odometer.toLocaleString()} km</div>}
            </>
          ) : <div className="doc-muted">Not linked</div>}
        </div>
        <div>
          <div className="doc-label">Details</div>
          <div className="doc-muted">Type: {invoice.type === 'job' ? 'Job card invoice' : invoice.type === 'pos' ? 'POS sale' : 'Manual invoice'}</div>
          {invoice.shiftId && <div className="doc-muted">Shift attached</div>}
          <div className="doc-muted">Status: {invoice.status}</div>
        </div>
      </div>
      <table className="doc-table">
        <thead>
          <tr>
            <th style={{ width: '46%' }}>Description</th>
            <th className="r">Qty</th>
            <th className="r">Rate</th>
            <th className="r">Disc.</th>
            <th className="r">Tax</th>
            <th className="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l) => (
            <tr key={l.id}>
              <td>
                <div className="doc-strong">{l.name}</div>
                <div className="doc-muted">{l.kind === 'part' ? `Part${l.sku ? ` · ${l.sku}` : ''}` : l.kind === 'service' ? 'Service' : 'Labor'}</div>
              </td>
              <td className="r mono">{formatQty(l.qty)}</td>
              <td className="r mono">{formatMoney(l.ratePaisa)}</td>
              <td className="r mono">{l.discountPaisa ? formatMoney(l.discountPaisa) : '—'}</td>
              <td className="r mono">{l.taxRate ? `${l.taxRate}%` : '—'}</td>
              <td className="r mono">{formatMoney(l.totalPaisa)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="doc-summary">
        <div className="doc-terms">
          <div className="doc-label">Notes</div>
          <div className="doc-muted">{invoice.notes || 'Thank you for your business.'}</div>
          {payments && payments.length > 0 && (
            <>
              <div className="doc-label" style={{ marginTop: 10 }}>Payments</div>
              {payments.map((p) => (
                <div key={p.id} className="doc-muted">
                  {paymentLabel(p.method)}{p.kind === 'refund' ? ' refund' : ''} ·{' '}
                  {formatMoney(p.kind === 'refund' ? -Math.abs(p.amountPaisa) : p.amountPaisa)} · {fmtDate(p.date)}
                </div>
              ))}
            </>
          )}
        </div>
        <div className="doc-totals">
          <div className="doc-total-row"><span>Subtotal</span><span className="mono">{formatMoney(invoice.subtotalPaisa)}</span></div>
          {invoice.discountPaisa > 0 && <div className="doc-total-row"><span>Discount</span><span className="mono">-{formatMoney(invoice.discountPaisa)}</span></div>}
          <div className="doc-total-row"><span>Tax</span><span className="mono">{formatMoney(invoice.taxPaisa)}</span></div>
          <div className="doc-total-row grand"><span>Total</span><span className="mono">{formatMoney(invoice.totalPaisa)}</span></div>
          <div className="doc-total-row"><span>Paid</span><span className="mono">{formatMoney(invoice.paidPaisa)}</span></div>
          <div className="doc-total-row"><span>Balance due</span><span className="mono">{formatMoney(invoice.duePaisa)}</span></div>
        </div>
      </div>
      <div className="doc-footer">
        <span>{settings.documents.footerNote}</span>
        <span>{settings.profile.name} · {settings.profile.phone}</span>
      </div>
    </div>
  );
}

export function JobCardDoc({ job, customer, vehicle, settings }: { job: JobCard; customer?: Customer | null; vehicle?: Vehicle | null; settings: AppSettings }) {
  return (
    <div className="doc-paper">
      <DocHeader settings={settings} title="JOB CARD" number={job.number} date={job.createdAt}
        meta={<div className="doc-stamp">{job.status.replace('_', ' ').toUpperCase()}</div>} />
      <div className="doc-meta-grid">
        <div>
          <div className="doc-label">Customer</div>
          <div className="doc-strong">{customer?.name ?? '—'}</div>
          {customer?.phone && <div className="doc-muted mono">{customer.phone}</div>}
        </div>
        <div>
          <div className="doc-label">Vehicle</div>
          <div className="doc-strong mono">{vehicle?.regNo ?? '—'}</div>
          <div className="doc-muted">{vehicle ? `${vehicle.make} ${vehicle.model}${vehicle.year ? ` ${vehicle.year}` : ''}` : ''}</div>
          {job.odometer != null && <div className="doc-muted">Odometer {job.odometer.toLocaleString()} km</div>}
        </div>
        <div>
          <div className="doc-label">Schedule</div>
          <div className="doc-muted">Priority: {job.priority}</div>
          <div className="doc-muted">Due: {job.dueDate ? fmtDate(new Date(job.dueDate).getTime()) : '—'}</div>
          <div className="doc-muted">Estimate: {formatMoney(job.estimatePaisa)}</div>
        </div>
      </div>
      <div className="doc-block">
        <div className="doc-label">Customer complaint</div>
        <div className="doc-strong" style={{ fontWeight: 500, whiteSpace: 'pre-wrap' }}>{job.complaint}</div>
      </div>
      {job.findings && <div className="doc-block"><div className="doc-label">Inspection findings</div><div style={{ whiteSpace: 'pre-wrap' }}>{job.findings}</div></div>}
      {job.recommendation && <div className="doc-block"><div className="doc-label">Recommended work</div><div style={{ whiteSpace: 'pre-wrap' }}>{job.recommendation}</div></div>}
      {job.lines.length > 0 && (
        <table className="doc-table" style={{ marginTop: 10 }}>
          <thead><tr><th>Parts / services / labor</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Tax</th></tr></thead>
          <tbody>
            {job.lines.map((l) => (
              <tr key={l.id}>
                <td><div className="doc-strong">{l.name}</div><div className="doc-muted">{l.kind}</div></td>
                <td className="r mono">{formatQty(l.qty)}</td>
                <td className="r mono">{formatMoney(l.ratePaisa)}</td>
                <td className="r mono">{l.taxRate ? `${l.taxRate}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="doc-block">
        <div className="doc-label">Job history</div>
        {job.history.map((h, i) => (
          <div key={i} className="doc-muted">{fmtDateTime(h.at)} · {h.action}{h.note ? ` — ${h.note}` : ''} · {h.by}</div>
        ))}
      </div>
      <div className="doc-sign-row">
        <div className="doc-sign">Customer signature</div>
        <div className="doc-sign">Authorised by</div>
      </div>
      <div className="doc-footer"><span>{settings.profile.name}</span><span>{fmtDateTime(Date.now())}</span></div>
    </div>
  );
}

export function PurchaseDoc({ purchase, supplier, settings }: { purchase: Purchase; supplier?: Supplier | null; settings: AppSettings }) {
  return (
    <div className="doc-paper">
      <DocHeader settings={settings} title="PURCHASE" number={purchase.number} date={purchase.date}
        meta={<div className="doc-stamp">{purchase.status.toUpperCase()}</div>} />
      <div className="doc-meta-grid">
        <div>
          <div className="doc-label">Supplier</div>
          <div className="doc-strong">{supplier?.name ?? '—'}</div>
          {supplier?.phone && <div className="doc-muted mono">{supplier.phone}</div>}
          {supplier?.address && <div className="doc-muted">{supplier.address}</div>}
        </div>
        <div>
          <div className="doc-label">Received</div>
          <div className="doc-muted">{purchase.receivedAt ? fmtDateTime(purchase.receivedAt) : 'Not received'}</div>
        </div>
        <div>
          <div className="doc-label">Reference</div>
          <div className="doc-muted">{purchase.notes || '—'}</div>
        </div>
      </div>
      <table className="doc-table">
        <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Cost</th><th className="r">Tax</th><th className="r">Amount</th></tr></thead>
        <tbody>
          {purchase.lines.map((l) => (
            <tr key={l.id}>
              <td><div className="doc-strong">{l.name}</div><div className="doc-muted mono">{l.sku}</div></td>
              <td className="r mono">{formatQty(l.qty)}</td>
              <td className="r mono">{formatMoney(l.costPaisa)}</td>
              <td className="r mono">{l.taxRate ? `${l.taxRate}%` : '—'}</td>
              <td className="r mono">{formatMoney(l.totalPaisa)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="doc-summary">
        <div />
        <div className="doc-totals">
          <div className="doc-total-row"><span>Subtotal</span><span className="mono">{formatMoney(purchase.subtotalPaisa)}</span></div>
          <div className="doc-total-row"><span>Tax</span><span className="mono">{formatMoney(purchase.taxPaisa)}</span></div>
          {purchase.discountPaisa > 0 && <div className="doc-total-row"><span>Discount</span><span className="mono">-{formatMoney(purchase.discountPaisa)}</span></div>}
          <div className="doc-total-row grand"><span>Total</span><span className="mono">{formatMoney(purchase.totalPaisa)}</span></div>
          <div className="doc-total-row"><span>Paid</span><span className="mono">{formatMoney(purchase.paidPaisa)}</span></div>
          <div className="doc-total-row"><span>Outstanding</span><span className="mono">{formatMoney(purchase.totalPaisa - purchase.paidPaisa)}</span></div>
        </div>
      </div>
      <div className="doc-footer"><span>{settings.profile.name}</span><span>Prepared by {purchase.createdBy}</span></div>
    </div>
  );
}

export function ShiftReportDoc({ shift, expenses, payments, settings, userName }: {
  shift: CashShift; expenses: Expense[]; payments: Payment[]; settings: AppSettings; userName: string;
}) {
  const cashSales = payments.filter((p) => p.method === 'cash' && p.kind === 'sale').reduce((a, p) => a + p.amountPaisa, 0);
  const cashRefunds = payments.filter((p) => p.method === 'cash' && p.kind === 'refund').reduce((a, p) => a + p.amountPaisa, 0);
  const other = payments.filter((p) => p.method !== 'cash' && p.kind === 'sale').reduce((a, p) => a + p.amountPaisa, 0);
  return (
    <div className="doc-paper">
      <DocHeader settings={settings} title="CASH SHIFT REPORT" number={shift.number} date={shift.openedAt} />
      <div className="doc-meta-grid">
        <div><div className="doc-label">Cashier</div><div className="doc-strong">{userName}</div></div>
        <div><div className="doc-label">Opened</div><div className="doc-muted">{fmtDateTime(shift.openedAt)}</div></div>
        <div><div className="doc-label">Closed</div><div className="doc-muted">{shift.closedAt ? fmtDateTime(shift.closedAt) : 'Open'}</div></div>
      </div>
      <table className="doc-table">
        <tbody>
          <tr><td>Opening cash</td><td className="r mono">{formatMoney(shift.openingPaisa)}</td></tr>
          <tr><td>Cash sales</td><td className="r mono">{formatMoney(cashSales)}</td></tr>
          <tr><td>Cash refunds</td><td className="r mono">-{formatMoney(cashRefunds)}</td></tr>
          <tr><td>Cash expenses (approved)</td><td className="r mono">-{formatMoney(expenses.filter((e) => e.method === 'cash' && e.status === 'approved').reduce((a, e) => a + e.amountPaisa, 0))}</td></tr>
          <tr><td className="doc-strong">Expected in drawer</td><td className="r mono doc-strong">{formatMoney(shift.expectedPaisa ?? 0)}</td></tr>
          <tr><td>Counted</td><td className="r mono">{formatMoney(shift.countedPaisa ?? 0)}</td></tr>
          <tr><td>Variance</td><td className="r mono">{formatMoney(shift.variancePaisa ?? 0)}</td></tr>
          <tr><td>Non-cash sales</td><td className="r mono">{formatMoney(other)}</td></tr>
        </tbody>
      </table>
      {shift.closingNotes && <div className="doc-block"><div className="doc-label">Notes</div><div>{shift.closingNotes}</div></div>}
      <div className="doc-sign-row"><div className="doc-sign">Cashier signature</div><div className="doc-sign">Manager signature</div></div>
    </div>
  );
}

export function ReturnDocPrint({ doc, invoice, customer, settings }: { doc: ReturnDoc; invoice?: Invoice | null; customer?: Customer | null; settings: AppSettings }) {
  return (
    <div className="doc-paper">
      <DocHeader settings={settings} title="CREDIT NOTE" number={doc.number} date={doc.date} />
      <div className="doc-meta-grid">
        <div><div className="doc-label">Customer</div><div className="doc-strong">{customer?.name ?? 'Walk-in'}</div></div>
        <div><div className="doc-label">Original invoice</div><div className="doc-strong mono">{invoice?.number ?? '—'}</div></div>
        <div><div className="doc-label">Refund</div><div className="doc-muted">{paymentLabel(doc.refundMethod)} · {formatMoney(doc.refundPaisa)}</div></div>
      </div>
      <table className="doc-table">
        <thead><tr><th>Returned item</th><th className="r">Qty</th><th className="r">Amount</th></tr></thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.id}>
              <td><div className="doc-strong">{l.name}</div><div className="doc-muted">{l.restock ? 'Returned to stock' : 'Not restocked'}</div></td>
              <td className="r mono">{formatQty(l.qty)}</td>
              <td className="r mono">{formatMoney(l.totalPaisa)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="doc-block"><div className="doc-label">Reason</div><div>{doc.reason}</div></div>
      <div className="doc-summary">
        <div />
        <div className="doc-totals">
          <div className="doc-total-row"><span>Subtotal</span><span className="mono">{formatMoney(doc.subtotalPaisa)}</span></div>
          <div className="doc-total-row"><span>Tax</span><span className="mono">{formatMoney(doc.taxPaisa)}</span></div>
          <div className="doc-total-row grand"><span>Credit</span><span className="mono">{formatMoney(doc.totalPaisa)}</span></div>
        </div>
      </div>
      <div className="doc-footer"><span>{settings.profile.name}</span><span>Processed by {doc.createdBy}</span></div>
    </div>
  );
}
