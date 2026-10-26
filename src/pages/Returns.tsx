import { useState } from 'react';
import { Plus, Printer, RotateCcw } from 'lucide-react';
import {
  PageHeader, Card, Button, Modal, SearchInput, EmptyState, Loading, ErrorState, Badge, Drawer
} from '../components/ui';
import { ReturnDialog } from '../components/Billing';
import { ReturnDocPrint, PrintPortal } from '../components/Print';
import { useAsync } from '../hooks/useAsync';
import { listReturns, listInvoices, getInvoiceDetail } from '../lib/queries';
import { useApp } from '../state/AppContext';
import { formatMoney, fmtDate } from '../lib/money';
import type { Invoice } from '../lib/types';

export default function Returns() {
  const { settings, can } = useApp();
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState(false);
  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [returnInvoice, setReturnInvoice] = useState<Invoice | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [printId, setPrintId] = useState<string | null>(null);

  const data = useAsync(() => listReturns(), [], { live: true });
  const invoices = useAsync(() => listInvoices({ page: 1, size: 100 }), [], { live: true });
  const detail = useAsync(async () => {
    const doc = (data.data ?? []).find((r) => r.id === openId);
    if (!doc) return null;
    const inv = await getInvoiceDetail(doc.invoiceId);
    return { doc, invoice: inv };
  }, [openId, data.data]);

  const rows = (data.data ?? []).filter((r) => {
    const q = search.trim().toLowerCase();
    return !q || r.number.toLowerCase().includes(q) || r.invoiceNumber.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q) || r.reason.toLowerCase().includes(q);
  });

  const candidates = (invoices.data?.items ?? []).filter((i) => {
    if (i.status !== 'completed') return false;
    const q = invoiceQuery.trim().toLowerCase();
    return !q || i.number.toLowerCase().includes(q) || (i.customerName ?? '').toLowerCase().includes(q);
  });

  const print = (id: string) => {
    setPrintId(id);
    setTimeout(() => {
      window.print();
      setTimeout(() => setPrintId(null), 400);
    }, 280);
  };

  const doc = detail.data?.doc;

  return (
    <div className="page">
      <PageHeader title="Returns" subtitle="Credit notes linked to the original invoice, with controlled restocking.">
        {can('invoices.refund') && <Button variant="primary" icon={<Plus size={15} />} onClick={() => setPicker(true)}>New return</Button>}
      </PageHeader>

      <Card>
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search return, invoice, customer or reason…" />
          <div className="grow" />
          <span className="tiny muted">{rows.length} return{rows.length === 1 ? '' : 's'}</span>
        </div>
        {data.loading && !data.data && <Loading />}
        {data.error && <ErrorState message={data.error} onRetry={data.reload} />}
        {data.data && rows.length === 0 && (
          <EmptyState icon={<RotateCcw size={20} />} title="No returns recorded" message="Returns are raised against a specific invoice so quantities, taxes and refunds stay accurate."
            action={can('invoices.refund') ? <Button size="sm" variant="primary" onClick={() => setPicker(true)}>New return</Button> : undefined} />
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Return</th><th>Original invoice</th><th>Customer</th><th>Date</th><th className="num">Credit</th><th>Refund</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => setOpenId(r.id)}>
                    <td className="mono">{r.number}</td>
                    <td className="mono tiny">{r.invoiceNumber}</td>
                    <td>{r.customerName}</td>
                    <td className="tiny nowrap">{fmtDate(r.date)}</td>
                    <td className="num">{formatMoney(r.totalPaisa, { currency: settings.profile.currency, decimals: false })}</td>
                    <td><Badge tone={r.refundMethod === 'credit' ? 'info' : 'neutral'}>{r.refundMethod}</Badge></td>
                    <td className="actions"><span className="tiny" style={{ color: 'var(--bronze-600)' }}>Open</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={picker} onClose={() => setPicker(false)} title="Choose the original invoice" sub="Only completed invoices with returnable quantities can be selected." size="lg">
        <div className="flex-col gap-12">
          <SearchInput value={invoiceQuery} onChange={setInvoiceQuery} placeholder="Search invoice number or customer…" autoFocus />
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="table compact">
              <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th className="num">Total</th><th /></tr></thead>
              <tbody>
                {candidates.map((i) => (
                  <tr key={i.id}>
                    <td className="mono">{i.number}</td>
                    <td>{i.customerName}</td>
                    <td className="tiny">{fmtDate(i.date)}</td>
                    <td className="num">{formatMoney(i.totalPaisa, { currency: settings.profile.currency })}</td>
                    <td className="actions">
                      <button className="btn btn-secondary btn-xs" onClick={() => { setInvoiceQuery(''); setPicker(false); invoices.data && setReturnInvoice(i); detail.reload(); }}>
                        Return items
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {candidates.length === 0 && <EmptyState title="No completed invoices found" message="Adjust your search or complete a sale first." />}
          </div>
        </div>
      </Modal>

      <ReturnDialog invoice={returnInvoice} open={!!returnInvoice} onClose={() => setReturnInvoice(null)} onDone={() => data.reload()} />

      <Drawer open={!!openId} onClose={() => setOpenId(null)} width={560} title={doc ? `Return ${doc.number}` : ''}
        footer={doc && <div className="flex gap-8"><div className="grow" /><Button size="sm" variant="secondary" icon={<Printer size={13} />} onClick={() => print(doc.id)}>Print credit note</Button><Button size="sm" onClick={() => setOpenId(null)}>Close</Button></div>}>
        {doc && (
          <div className="flex-col gap-14">
            <div className="flex justify-between">
              <div>
                <div className="label">Original invoice</div>
                <div className="mono" style={{ fontWeight: 650 }}>{detail.data?.invoice?.invoice.number}</div>
                <div className="tiny muted">{detail.data?.invoice?.customer?.name ?? 'Walk-in'}</div>
              </div>
              <Badge tone="bronze">{doc.refundMethod}</Badge>
            </div>
            <div className="mini-row"><span className="t">Date</span><span className="v">{fmtDate(doc.date)}</span></div>
            <div className="mini-row"><span className="t">Reason</span><span className="v" style={{ maxWidth: 280 }}>{doc.reason}</span></div>
            <div className="table-wrap">
              <table className="table compact">
                <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Credit</th><th>Restock</th></tr></thead>
                <tbody>
                  {doc.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.name}<div className="tiny muted">{l.kind}</div></td>
                      <td className="num">{l.qty}</td>
                      <td className="num">{formatMoney(l.totalPaisa, { currency: settings.profile.currency })}</td>
                      <td className="tiny">{l.restock ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="mini-row"><span className="t">Subtotal</span><span className="v mono">{formatMoney(doc.subtotalPaisa, { currency: settings.profile.currency })}</span></div>
              <div className="mini-row"><span className="t">Tax</span><span className="v mono">{formatMoney(doc.taxPaisa, { currency: settings.profile.currency })}</span></div>
              <div className="mini-row"><span className="t strong" style={{ color: 'var(--text)' }}>Credit total</span><span className="v mono">{formatMoney(doc.totalPaisa, { currency: settings.profile.currency })}</span></div>
              <div className="mini-row"><span className="t">Cash/card refunded</span><span className="v mono">{formatMoney(doc.refundPaisa, { currency: settings.profile.currency })}</span></div>
            </div>
          </div>
        )}
      </Drawer>

      {printId && doc && (
        <PrintPortal>
          <ReturnDocPrint doc={doc} invoice={detail.data?.invoice?.invoice} customer={detail.data?.invoice?.customer} settings={settings} />
        </PrintPortal>
      )}
    </div>
  );
}
