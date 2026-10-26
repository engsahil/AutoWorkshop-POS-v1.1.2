import { useMemo, useState } from 'react';
import { Download, FileText, Printer } from 'lucide-react';
import {
  PageHeader, Card, Button, Loading, ErrorState, EmptyState, DateRangeBar, defaultRange, type DateRangeValue,
  Tabs, StatusPill, Money, Badge
} from '../components/ui';
import { PrintPortal } from '../components/Print';
import { BrandGlyph } from '../components/Brand';
import { useAsync } from '../hooks/useAsync';
import {
  rangeSummary, invoicesBetween, paymentsBetween, expensesBetween, purchasesBetween, returnsBetween
} from '../lib/queries';
import { useApp } from '../state/AppContext';
import { dbAll } from '../lib/db';
import type { Customer, Supplier } from '../lib/types';
import { downloadCsv } from '../lib/csv';
import { formatMoney, fmtDate, fmtDateTime, parseISODate } from '../lib/money';

type Tab = 'pl' | 'sales' | 'expenses' | 'purchases' | 'returns';

export default function Reports() {
  const { settings, toast } = useApp();
  const [range, setRange] = useState<DateRangeValue>(defaultRange('month'));
  const [tab, setTab] = useState<Tab>('pl');
  const [printing, setPrinting] = useState(false);

  const from = parseISODate(range.from).getTime();
  const to = parseISODate(range.to).getTime() + 86399999;

  const summary = useAsync(() => rangeSummary(from, to), [range.from, range.to]);
  const invoices = useAsync(() => invoicesBetween(from, to), [range.from, range.to]);
  const payments = useAsync(() => paymentsBetween(from, to), [range.from, range.to]);
  const expenses = useAsync(() => expensesBetween(from, to), [range.from, range.to]);
  const purchases = useAsync(() => purchasesBetween(from, to), [range.from, range.to]);
  const returns = useAsync(() => returnsBetween(from, to), [range.from, range.to]);
  const customers = useAsync(() => dbAll<Customer>('customers'), []);
  const suppliers = useAsync(() => dbAll<Supplier>('suppliers'), []);
  const customerMap = useMemo(() => new Map((customers.data ?? []).map((c) => [c.id, c.name])), [customers.data]);
  const supplierMap = useMemo(() => new Map((suppliers.data ?? []).map((x) => [x.id, x.name])), [suppliers.data]);

  const s = summary.data;
  const approvedExpenses = useMemo(() => (expenses.data ?? []).filter((e) => e.status === 'approved'), [expenses.data]);
  const expenseTotal = approvedExpenses.reduce((a, e) => a + e.amountPaisa, 0);
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of approvedExpenses) map.set(e.category, (map.get(e.category) ?? 0) + e.amountPaisa);
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [approvedExpenses]);
  const receivedPurchases = (purchases.data ?? []).filter((p) => p.status === 'received');
  const purchaseValue = receivedPurchases.reduce((a, p) => a + p.totalPaisa, 0);
  const grossProfit = s?.grossProfitPaisa ?? 0;
  const operatingResult = grossProfit - expenseTotal;
  const margin = s && s.netRevenuePaisa > 0 ? Math.round((grossProfit / s.netRevenuePaisa) * 1000) / 10 : 0;

  const doPrint = () => {
    setPrinting(true);
    setTimeout(() => { window.print(); setTimeout(() => setPrinting(false), 400); }, 300);
  };

  const exportCurrent = () => {
    if (tab === 'pl') {
      downloadCsv('servixa-profit-loss', ['Line', 'Amount'], [
        ['Gross sales (pre-tax)', (s?.grossSalesPaisa ?? 0) / 100],
        ['Invoice discounts', -(s?.invoiceDiscountPaisa ?? 0) / 100],
        ['Net sales', (s?.netSalesPaisa ?? 0) / 100],
        ['Returns (credit notes)', -(s?.returnsNetPaisa ?? 0) / 100],
        ['Net revenue', (s?.netRevenuePaisa ?? 0) / 100],
        ['Cost of parts sold', -(s?.cogsPaisa ?? 0) / 100],
        ['Gross profit', grossProfit / 100],
        ...byCategory.map((c) => [`Expense — ${c.name}`, -c.value / 100] as [string, number]),
        ['Operating result', operatingResult / 100],
        ['Tax collected (not revenue)', (s?.taxPaisa ?? 0) / 100]
      ]);
    } else if (tab === 'sales') {
      downloadCsv('servixa-sales-register', ['Invoice', 'Date', 'Customer', 'Status', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Due'], (invoices.data ?? []).map((i) => [
        i.number, fmtDate(i.date), customerMap.get(i.customerId ?? '') ?? 'Walk-in', i.status, i.subtotalPaisa / 100, i.discountPaisa / 100, i.taxPaisa / 100, i.totalPaisa / 100, i.paidPaisa / 100, i.duePaisa / 100
      ]));
    } else if (tab === 'expenses') {
      downloadCsv('servixa-expenses-register', ['Date', 'Category', 'Description', 'Method', 'Status', 'Amount'], (expenses.data ?? []).map((e) => [fmtDate(e.date), e.category, e.description, e.method, e.status, e.amountPaisa / 100]));
    } else if (tab === 'purchases') {
      downloadCsv('servixa-purchases-register', ['Purchase', 'Date', 'Supplier', 'Status', 'Subtotal', 'Tax', 'Total', 'Paid'], (purchases.data ?? []).map((p) => [p.number, fmtDate(p.date), supplierMap.get(p.supplierId) ?? '—', p.status, p.subtotalPaisa / 100, p.taxPaisa / 100, p.totalPaisa / 100, p.paidPaisa / 100]));
    } else {
      downloadCsv('servixa-returns-register', ['Credit note', 'Date', 'Invoice', 'Reason', 'Refund method', 'Subtotal', 'Tax', 'Total'], (returns.data ?? []).map((r) => [r.number, fmtDate(r.date), r.invoiceId.slice(-6), r.reason, r.refundMethod, r.subtotalPaisa / 100, r.taxPaisa / 100, r.totalPaisa / 100]));
    }
    toast('CSV exported.');
  };

  return (
    <div className="page">
      <PageHeader title="Reports" subtitle="Defined, auditable registers for any period.">
        <Button variant="secondary" icon={<Printer size={14} />} onClick={doPrint}>Print P&amp;L</Button>
        <Button variant="secondary" icon={<Download size={14} />} onClick={exportCurrent}>Export CSV</Button>
      </PageHeader>

      <Card style={{ marginBottom: 14 }}>
        <div className="table-toolbar" style={{ borderBottom: 'none' }}>
          <DateRangeBar value={range} onChange={setRange} compact />
          <div className="grow" />
          <span className="tiny muted">Period: {fmtDate(from)} → {fmtDate(to)}</span>
        </div>
      </Card>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'pl', label: 'Profit & loss' },
          { id: 'sales', label: 'Sales register', count: invoices.data?.length },
          { id: 'expenses', label: 'Expenses', count: expenses.data?.length },
          { id: 'purchases', label: 'Purchases', count: purchases.data?.length },
          { id: 'returns', label: 'Returns', count: returns.data?.length }
        ]}
      />

      {summary.loading && !s && <Loading />}
      {summary.error && <ErrorState message={summary.error} onRetry={summary.reload} />}

      {tab === 'pl' && s && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <Card>
            <div className="card-header"><div><h3>Income statement</h3><div className="sub">Accrual view of completed invoices dated in the period</div></div></div>
            <div className="section-pad flex-col gap-2">
              <StatementRow label="Gross sales (pre-tax)" value={s.grossSalesPaisa} currency={settings.profile.currency} />
              <StatementRow label="Less invoice discounts" value={-s.invoiceDiscountPaisa} currency={settings.profile.currency} muted />
              <StatementRow label="Net sales" value={s.netSalesPaisa} currency={settings.profile.currency} bold border />
              <StatementRow label="Less returns (credit notes, pre-tax)" value={-s.returnsNetPaisa} currency={settings.profile.currency} muted />
              <StatementRow label="Net revenue" value={s.netRevenuePaisa} currency={settings.profile.currency} bold border />
              <StatementRow label="Cost of parts sold" value={-s.cogsPaisa} currency={settings.profile.currency} muted />
              <StatementRow label="Gross profit" value={grossProfit} currency={settings.profile.currency} bold border />
              <div className="label" style={{ marginTop: 10 }}>Operating expenses (approved)</div>
              {byCategory.length === 0 && <div className="small muted">No approved expenses in this period.</div>}
              {byCategory.map((c) => <StatementRow key={c.name} label={c.name} value={-c.value} currency={settings.profile.currency} muted small />)}
              <StatementRow label="Operating result" value={operatingResult} currency={settings.profile.currency} bold border />
            </div>
          </Card>
          <div className="flex-col gap-14">
            <Card>
              <div className="card-header"><h3>Definitions</h3><Badge tone="neutral">Formulas</Badge></div>
              <div className="section-pad small flex-col gap-8" style={{ color: 'var(--text-soft)', lineHeight: 1.6 }}>
                <div><b>Net sales</b> = gross sales − invoice discounts (tax excluded).</div>
                <div><b>Net revenue</b> = net sales − returns issued in the period.</div>
                <div><b>Gross profit</b> = net revenue − cost price of parts sold (plus cost of returned parts).</div>
                <div><b>Operating result</b> = gross profit − approved expenses. Overheads such as owner drawings and tax are excluded.</div>
                <div className="muted">Purchases of stock are not deducted here: they become cost of goods only when a part is sold.</div>
              </div>
            </Card>
            <Card>
              <div className="card-header"><h3>Cash &amp; credit</h3></div>
              <div className="section-pad flex-col gap-2">
                <StatementRow label="Collected via receipts" value={s.collectedPaisa} currency={settings.profile.currency} />
                <StatementRow label="Refunds paid" value={-s.refundsPaisa} currency={settings.profile.currency} muted />
                <StatementRow label="Invoiced (incl. tax)" value={s.invoiceTotalPaisa} currency={settings.profile.currency} bold border />
                <StatementRow label="Outstanding on these invoices" value={s.duePaisa} currency={settings.profile.currency} />
                <div className="mini-row" style={{ marginTop: 6 }}><span className="t">Gross margin</span><span className="v">{margin}%</span></div>
                <div className="mini-row"><span className="t">Stock received (informational)</span><span className="v mono">{formatMoney(purchaseValue, { currency: settings.profile.currency, decimals: false })}</span></div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'sales' && (
        <Card>
          <div className="card-header"><h3>Sales register</h3><span className="sub">{invoices.data?.length ?? 0} invoices</span></div>
          {invoices.loading && <Loading />}
          {(invoices.data ?? []).length === 0 ? <EmptyState icon={<FileText size={20} />} title="No invoices in this period" /> : (
            <div className="table-wrap">
              <table className="table compact">
                <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Status</th><th className="num">Subtotal</th><th className="num">Discount</th><th className="num">Tax</th><th className="num">Total</th><th className="num">Due</th></tr></thead>
                <tbody>
                  {(invoices.data ?? []).map((i) => (
                    <tr key={i.id}>
                      <td className="mono">{i.number}</td>
                      <td className="tiny nowrap">{fmtDate(i.date)}</td>
                      <td className="truncate" style={{ maxWidth: 190 }}>{customerMap.get(i.customerId ?? '') ?? 'Walk-in'}</td>
                      <td><StatusPill status={i.status} /></td>
                      <td className="num"><Money value={i.subtotalPaisa} /></td>
                      <td className="num">{i.discountPaisa ? <Money value={-i.discountPaisa} /> : '—'}</td>
                      <td className="num"><Money value={i.taxPaisa} /></td>
                      <td className="num mono" style={{ fontWeight: 700 }}><Money value={i.totalPaisa} /></td>
                      <td className="num">{i.duePaisa ? <Money value={i.duePaisa} /> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'expenses' && (
        <Card>
          <div className="card-header"><h3>Expense register</h3><span className="sub">{formatMoney(expenseTotal, { currency: settings.profile.currency })} approved</span></div>
          {(expenses.data ?? []).length === 0 ? <EmptyState icon={<FileText size={20} />} title="No expenses in this period" /> : (
            <div className="table-wrap">
              <table className="table compact">
                <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Method</th><th>Status</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {(expenses.data ?? []).map((e) => (
                    <tr key={e.id}>
                      <td className="tiny nowrap">{fmtDate(e.date)}</td>
                      <td>{e.category}</td>
                      <td className="truncate" style={{ maxWidth: 260 }}>{e.description}</td>
                      <td className="tiny" style={{ textTransform: 'capitalize' }}>{e.method}</td>
                      <td><StatusPill status={e.status} /></td>
                      <td className="num"><Money value={e.amountPaisa} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'purchases' && (
        <Card>
          <div className="card-header"><h3>Purchase register</h3><span className="sub">{receivedPurchases.length} received · {formatMoney(purchaseValue, { currency: settings.profile.currency })}</span></div>
          {(purchases.data ?? []).length === 0 ? <EmptyState icon={<FileText size={20} />} title="No purchases in this period" /> : (
            <div className="table-wrap">
              <table className="table compact">
                <thead><tr><th>Purchase</th><th>Date</th><th>Supplier</th><th>Status</th><th className="num">Subtotal</th><th className="num">Tax</th><th className="num">Total</th><th className="num">Paid</th></tr></thead>
                <tbody>
                  {(purchases.data ?? []).map((p) => (
                    <tr key={p.id}>
                      <td className="mono">{p.number}</td>
                      <td className="tiny nowrap">{fmtDate(p.date)}</td>
                      <td className="truncate" style={{ maxWidth: 190 }}>{supplierMap.get(p.supplierId) ?? '—'}</td>
                      <td><StatusPill status={p.status} /></td>
                      <td className="num"><Money value={p.subtotalPaisa} /></td>
                      <td className="num"><Money value={p.taxPaisa} /></td>
                      <td className="num mono" style={{ fontWeight: 700 }}><Money value={p.totalPaisa} /></td>
                      <td className="num"><Money value={p.paidPaisa} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'returns' && (
        <Card>
          <div className="card-header"><h3>Returns register</h3><span className="sub">{(returns.data ?? []).length} credit notes</span></div>
          {(returns.data ?? []).length === 0 ? <EmptyState icon={<FileText size={20} />} title="No returns in this period" /> : (
            <div className="table-wrap">
              <table className="table compact">
                <thead><tr><th>Credit note</th><th>Date</th><th>Invoice</th><th>Reason</th><th>Refund</th><th className="num">Subtotal</th><th className="num">Tax</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {(returns.data ?? []).map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.number}</td>
                      <td className="tiny nowrap">{fmtDate(r.date)}</td>
                      <td className="mono tiny">{r.invoiceId.slice(-6)}</td>
                      <td className="truncate" style={{ maxWidth: 240 }}>{r.reason}</td>
                      <td className="tiny" style={{ textTransform: 'capitalize' }}>{r.refundMethod}</td>
                      <td className="num"><Money value={-r.subtotalPaisa} /></td>
                      <td className="num"><Money value={-r.taxPaisa} /></td>
                      <td className="num mono" style={{ fontWeight: 700 }}><Money value={-r.totalPaisa} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card style={{ marginTop: 14 }}>
        <div className="card-header"><h3>Payments in period</h3><span className="sub">{payments.data?.length ?? 0} receipts</span></div>
        {(payments.data ?? []).length === 0 ? <EmptyState title="No payments recorded" /> : (
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Time</th><th>Kind</th><th>Method</th><th>Reference</th><th>Recorded by</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {(payments.data ?? []).filter((p) => !p.voided).slice(0, 100).map((p) => (
                  <tr key={p.id}>
                    <td className="tiny nowrap">{fmtDateTime(p.date)}</td>
                    <td className="tiny" style={{ textTransform: 'capitalize' }}>{p.kind}</td>
                    <td className="tiny" style={{ textTransform: 'capitalize' }}>{p.method}</td>
                    <td className="mono tiny">{p.reference || (p.invoiceId ? p.invoiceId.slice(-6) : '—')}</td>
                    <td className="tiny">{p.createdBy}</td>
                    <td className="num"><Money value={p.kind === 'refund' ? -p.amountPaisa : p.amountPaisa} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {printing && s && (
        <PrintPortal>
          <div className="doc-paper">
            <div className="doc-head">
              <div className="doc-brand">
                {settings.attachments.logo ? <img src={settings.attachments.logo} alt="" className="doc-logo" /> : <BrandGlyph size={30} tone="light" />}
                <div>
                  <div className="doc-biz">{settings.profile.name || 'Your workshop'}</div>
                  {settings.profile.address && <div className="doc-muted">{settings.profile.address}</div>}
                  <div className="doc-muted">{settings.profile.phone}{settings.profile.phone && settings.profile.email ? ' · ' : ''}{settings.profile.email}</div>
                </div>
              </div>
              <div className="doc-title-block">
                <div className="doc-title">PROFIT &amp; LOSS</div>
                <div className="doc-muted">{fmtDate(from)} → {fmtDate(to)}</div>
              </div>
            </div>
            <table className="doc-table">
              <tbody>
                <tr><td>Gross sales (pre-tax)</td><td className="r mono">{formatMoney(s.grossSalesPaisa, { currency: settings.profile.currency })}</td></tr>
                <tr><td>Less invoice discounts</td><td className="r mono">{formatMoney(-s.invoiceDiscountPaisa, { currency: settings.profile.currency })}</td></tr>
                <tr><td className="doc-strong">Net sales</td><td className="r mono doc-strong">{formatMoney(s.netSalesPaisa, { currency: settings.profile.currency })}</td></tr>
                <tr><td>Less returns (pre-tax)</td><td className="r mono">{formatMoney(-s.returnsNetPaisa, { currency: settings.profile.currency })}</td></tr>
                <tr><td className="doc-strong">Net revenue</td><td className="r mono doc-strong">{formatMoney(s.netRevenuePaisa, { currency: settings.profile.currency })}</td></tr>
                <tr><td>Cost of parts sold</td><td className="r mono">{formatMoney(-s.cogsPaisa, { currency: settings.profile.currency })}</td></tr>
                <tr><td className="doc-strong">Gross profit</td><td className="r mono doc-strong">{formatMoney(grossProfit, { currency: settings.profile.currency })}</td></tr>
                {byCategory.map((c) => (
                  <tr key={c.name}><td>{c.name}</td><td className="r mono">{formatMoney(-c.value, { currency: settings.profile.currency })}</td></tr>
                ))}
                <tr><td className="doc-strong">Operating result</td><td className="r mono doc-strong">{formatMoney(operatingResult, { currency: settings.profile.currency })}</td></tr>
              </tbody>
            </table>
            <div className="doc-footer">
              <span>Generated {fmtDateTime(Date.now())} by {settings.profile.name || 'Workshop'}</span>
              <span>Cash collected {formatMoney(s.collectedPaisa, { currency: settings.profile.currency })} · Tax {formatMoney(s.taxPaisa, { currency: settings.profile.currency })}</span>
            </div>
          </div>
        </PrintPortal>
      )}
    </div>
  );
}

function StatementRow({ label, value, currency, bold, muted, border, small }: {
  label: string; value: number; currency: string; bold?: boolean; muted?: boolean; border?: boolean; small?: boolean;
}) {
  return (
    <div
      className="mini-row"
      style={{
        borderTop: border ? '1px solid var(--line)' : undefined,
        paddingTop: border ? 7 : 3,
        fontWeight: bold ? 700 : 400,
        opacity: muted ? 0.82 : 1,
        fontSize: small ? 12.5 : undefined
      }}
    >
      <span className="t">{label}</span>
      <span className="v mono" style={{ color: value < 0 ? 'var(--danger)' : undefined }}>{formatMoney(value, { currency })}</span>
    </div>
  );
}
