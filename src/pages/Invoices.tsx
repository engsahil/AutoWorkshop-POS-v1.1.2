import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FileText, Receipt } from 'lucide-react';
import { PageHeader, Card, SearchInput, Select, Pager, EmptyState, ErrorState, Loading, StatusPill, Button, DateRangeBar, defaultRange, type DateRangeValue } from '../components/ui';
import { InvoiceDetailModal } from '../components/InvoiceDetail';
import { useAsync } from '../hooks/useAsync';
import { listInvoices } from '../lib/queries';
import { useApp } from '../state/AppContext';
import { downloadCsv } from '../lib/csv';
import { fmtDateTime, parseISODate, formatMoney } from '../lib/money';
import { useDebounced } from '../components/ui';

export default function Invoices() {
  const { settings, can } = useApp();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 220);
  const [status, setStatus] = useState('all');
  const [payment, setPayment] = useState('all');
  const [range, setRange] = useState<DateRangeValue>(defaultRange('30d'));
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(params.get('open'));

  useEffect(() => {
    const open = params.get('open');
    if (open) setOpenId(open);
  }, [params]);

  const close = () => {
    setOpenId(null);
    if (params.get('open')) {
      params.delete('open');
      setParams(params, { replace: true });
    }
  };

  const from = parseISODate(range.from).getTime();
  const to = parseISODate(range.to).getTime() + 86399999;

  const data = useAsync(
    () => listInvoices({ search: debounced, status, payment, from, to, page, size: 15 }),
    [debounced, status, payment, range.from, range.to, page],
    { live: true }
  );

  useEffect(() => setPage(1), [debounced, status, payment, range.from, range.to]);

  const rows = data.data?.items ?? [];
  const total = data.data?.total ?? 0;

  const exportCsv = () => {
    downloadCsv(
      `servixa-invoices-${range.from}-to-${range.to}`,
      ['Invoice', 'Date', 'Customer', 'Total', 'Paid', 'Due', 'Payment status', 'Status', 'Created by'],
      rows.map((i) => [
        i.number, fmtDateTime(i.date), i.customerName ?? 'Walk-in',
        formatMoney(i.totalPaisa, { currency: settings.profile.currency }),
        formatMoney(i.paidPaisa, { currency: settings.profile.currency }),
        formatMoney(i.duePaisa, { currency: settings.profile.currency }),
        i.paymentStatus, i.status, i.createdBy
      ])
    );
  };

  return (
    <div className="page">
      <PageHeader title="Invoices" subtitle="Every completed sale, its payments, returns and outstanding balance.">
        {can('reports.view') && <Button variant="secondary" icon={<Download size={14} />} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>}
      </PageHeader>

      <Card>
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search invoice number, customer or plate…" />
          <Select value={payment} onChange={(e) => setPayment(e.target.value)} aria-label="Payment status" style={{ width: 150 }}>
            <option value="all">All payments</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="unpaid">Unpaid</option>
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Invoice status" style={{ width: 140 }}>
            <option value="all">All invoices</option>
            <option value="completed">Completed</option>
            <option value="void">Void</option>
          </Select>
          <div className="grow" />
          <DateRangeBar value={range} onChange={setRange} compact />
        </div>

        {data.loading && !data.data && <Loading label="Loading invoices…" />}
        {data.error && <ErrorState message={data.error} onRetry={data.reload} />}
        {data.data && rows.length === 0 && (
          <EmptyState
            icon={<Receipt size={20} />}
            title="No invoices match these filters"
            message="Adjust the date range or clear the search. Completed POS sales appear here immediately."
          />
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Vehicle</th>
                  <th className="num">Total</th>
                  <th className="num">Balance</th>
                  <th>Payment</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => (
                  <tr key={inv.id} className="clickable" onClick={() => setOpenId(inv.id)}>
                    <td><span className="mono">{inv.number}</span></td>
                    <td className="nowrap">{fmtDateTime(inv.date)}</td>
                    <td className="truncate" style={{ maxWidth: 160 }}>{inv.customerName}</td>
                    <td><span className="mono tiny">{inv.vehicleLabel}</span></td>
                    <td className="num">{formatMoney(inv.totalPaisa, { currency: settings.profile.currency, decimals: false })}</td>
                    <td className="num" style={{ color: inv.duePaisa > 0 ? 'var(--danger)' : undefined }}>
                      {inv.duePaisa > 0 ? formatMoney(inv.duePaisa, { currency: settings.profile.currency, decimals: false }) : '—'}
                    </td>
                    <td><StatusPill status={inv.paymentStatus} /></td>
                    <td><StatusPill status={inv.status === 'void' ? 'void' : 'completed'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="table-footer">
          <span>{total} invoice{total === 1 ? '' : 's'} in range · page {page} of {Math.max(1, Math.ceil(total / 15))}</span>
          <Pager page={page} total={total} size={15} onPage={setPage} />
        </div>
      </Card>

      <div className="flex items-center gap-8 tiny muted" style={{ marginTop: 10 }}>
        <FileText size={12} /> Click any invoice to review, print, record a payment, return items or void.
      </div>

      <InvoiceDetailModal
        invoiceId={openId}
        onClose={close}
        onChanged={() => data.reload()}
      />
    </div>
  );
}
