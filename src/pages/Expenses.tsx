import { useState } from 'react';
import { CheckCircle2, Download, Plus, Receipt } from 'lucide-react';
import {
  PageHeader, Card, Button, Modal, Field, Input, Select, Textarea, EmptyState, Loading, ErrorState,
  StatusPill, DateRangeBar, defaultRange, type DateRangeValue, Money
} from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { listExpenses } from '../lib/queries';
import { createExpense, approveExpense } from '../lib/transactions';
import { useApp } from '../state/AppContext';
import { bump } from '../lib/bus';
import { downloadCsv } from '../lib/csv';
import { fmtDate, parseISODate, toPaisa } from '../lib/money';

const CATEGORIES = ['Rent', 'Utilities', 'Salaries', 'Consumables', 'Transport', 'Marketing', 'Equipment', 'Other'];

export default function Expenses() {
  const { user, settings, can, toast } = useApp();
  const [range, setRange] = useState<DateRangeValue>(defaultRange('month'));
  const [category, setCategory] = useState('all');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ category: 'Utilities', amount: '', method: 'cash' as 'cash' | 'card' | 'bank' | 'online', description: '', date: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = parseISODate(range.from).getTime();
  const to = parseISODate(range.to).getTime() + 86399999;
  const data = useAsync(() => listExpenses(from, to), [range.from, range.to], { live: true });
  const rows = (data.data ?? []).filter((e) => category === 'all' || e.category === category);
  const total = rows.reduce((a, e) => a + (e.status === 'approved' ? e.amountPaisa : 0), 0);
  const pending = rows.filter((e) => e.status === 'pending').length;

  const save = async () => {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      await createExpense({
        category: form.category, amountPaisa: toPaisa(form.amount || 0), method: form.method,
        description: form.description, date: form.date ? parseISODate(form.date).getTime() : undefined
      }, { id: user.id, name: user.name, role: user.role });
      toast('Expense recorded.');
      setModal(false);
      setForm({ category: 'Utilities', amount: '', method: 'cash', description: '', date: '' });
      data.reload();
      bump();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record expense.');
    } finally {
      setBusy(false);
    }
  };

  const approve = async (id: string) => {
    if (!user) return;
    try {
      await approveExpense(id, { id: user.id, name: user.name, role: user.role });
      toast('Expense approved.');
      data.reload();
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to approve', 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader title="Expenses" subtitle="Operating costs by category, with approval and cash-shift impact.">
        {can('reports.view') && (
          <Button variant="secondary" icon={<Download size={14} />} onClick={() => downloadCsv('servixa-expenses', ['Date', 'Category', 'Description', 'Method', 'Amount', 'Status', 'Recorded by'], rows.map((e) => [
            fmtDate(e.date), e.category, e.description, e.method, e.amountPaisa / 100, e.status, e.createdBy
          ]))} disabled={!rows.length}>Export CSV</Button>
        )}
        {can('expenses.manage') && <Button variant="primary" icon={<Plus size={15} />} onClick={() => setModal(true)}>Add expense</Button>}
      </PageHeader>

      <div className="stat-strip" style={{ marginBottom: 12 }}>
        <div className="stat"><div className="lbl">Approved expenses</div><div className="val">{formatTotal(total, settings.profile.currency)}</div></div>
        <div className="stat"><div className="lbl">Pending approval</div><div className="val">{pending}</div></div>
        <div className="stat"><div className="lbl">Entries in range</div><div className="val">{rows.length}</div></div>
      </div>

      <Card>
        <div className="table-toolbar">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 170 }} aria-label="Category">
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <div className="grow" />
          <DateRangeBar value={range} onChange={setRange} compact />
        </div>
        {data.loading && !data.data && <Loading />}
        {data.error && <ErrorState message={data.error} onRetry={data.reload} />}
        {data.data && rows.length === 0 && <EmptyState icon={<Receipt size={20} />} title="No expenses in this period" message="Record rent, utilities and consumables to see true profitability." />}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Method</th><th>Status</th><th className="num">Amount</th><th /></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="tiny nowrap">{fmtDate(e.date)}</td>
                    <td>{e.category}</td>
                    <td className="truncate" style={{ maxWidth: 260 }}>{e.description}<div className="tiny muted">by {e.createdBy}</div></td>
                    <td className="tiny" style={{ textTransform: 'capitalize' }}>{e.method}</td>
                    <td><StatusPill status={e.status} /></td>
                    <td className="num"><Money value={e.amountPaisa} /></td>
                    <td className="actions">
                      {e.status === 'pending' && can('expenses.manage') && (
                        <button className="btn btn-secondary btn-xs" onClick={() => approve(e.id)}><CheckCircle2 size={12} /> Approve</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} size="sm" title="Add expense"
        footer={<><Button onClick={() => setModal(false)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={save} loading={busy}>Save expense</Button></>}>
        <div className="form-section">
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="form-grid">
            <Field label="Category" required>
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Amount" required>
              <div className="input-affix"><span className="affix">{settings.profile.currency}</span><Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" autoFocus /></div>
            </Field>
            <Field label="Payment method">
              <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as typeof form.method })}>
                {settings.documents.paymentMethods.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Description" required className="span-2">
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What was this expense for?" />
            </Field>
          </div>
          <div className="alert alert-info"><span>Cash expenses are deducted from the open shift’s expected drawer once approved.</span></div>
        </div>
      </Modal>
    </div>
  );
}

function formatTotal(paisa: number, currency: string) {
  return `${currency} ${(paisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
}
