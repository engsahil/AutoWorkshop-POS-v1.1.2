import { useEffect, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Clock, Printer, Wallet } from 'lucide-react';
import {
  PageHeader, Card, Button, Modal, Field, Input, Select, Textarea, EmptyState, Loading, ErrorState,
  StatusPill, Drawer, Badge, Money
} from '../components/ui';
import { ShiftReportDoc, PrintPortal } from '../components/Print';
import { useAsync } from '../hooks/useAsync';
import { listShifts, getShiftDetail, currentShift } from '../lib/queries';
import { computeShiftTotals, openShift, closeShift, type ShiftTotals } from '../lib/transactions';
import { addCashMovement } from '../lib/repo';
import { useApp } from '../state/AppContext';
import { bump } from '../lib/bus';
import { formatMoney, fmtDateTime, toPaisa } from '../lib/money';

export default function Shifts() {
  const { user, settings, can, toast } = useApp();
  const [openModal, setOpenModal] = useState(false);
  const [openingCash, setOpeningCash] = useState('');
  const [openNotes, setOpenNotes] = useState('');
  const [closeModal, setCloseModal] = useState(false);
  const [counted, setCounted] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [movement, setMovement] = useState<null | 'in' | 'out'>(null);
  const [movAmount, setMovAmount] = useState('');
  const [movReason, setMovReason] = useState('');
  const [printOpen, setPrintOpen] = useState(false);

  const shifts = useAsync(() => listShifts(), [], { live: true });
  const current = useAsync(() => (user ? currentShift(user.id) : Promise.resolve(null)), [user?.id], { live: true });
  const totals = useAsync<ShiftTotals | null>(() => (current.data ? computeShiftTotals(current.data) : Promise.resolve(null)), [current.data?.id], { live: true });
  const detail = useAsync(() => (detailId ? getShiftDetail(detailId) : Promise.resolve(null)), [detailId]);

  useEffect(() => {
    if (closeModal && current.data && totals.data) setCounted((totals.data.expectedPaisa / 100).toFixed(2));
  }, [closeModal, current.data, totals.data]);

  const doOpen = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await openShift(toPaisa(openingCash || 0), openNotes, { id: user.id, name: user.name, role: user.role });
      toast('Shift opened.');
      setOpenModal(false);
      setOpeningCash(''); setOpenNotes('');
      current.reload(); shifts.reload(); totals.reload();
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to open shift', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doClose = async () => {
    if (!user || !current.data) return;
    setBusy(true);
    try {
      const shift = await closeShift(current.data.id, toPaisa(counted || 0), closeNotes, { id: user.id, name: user.name, role: user.role });
      toast(`Shift closed. Variance ${formatMoney(shift.variancePaisa ?? 0, { currency: settings.profile.currency })}.`);
      setCloseModal(false);
      current.reload(); shifts.reload(); totals.reload();
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to close shift', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doMovement = async () => {
    if (!user || !current.data || !movement) return;
    setBusy(true);
    try {
      await addCashMovement({ shiftId: current.data.id, type: movement, amountPaisa: toPaisa(movAmount), reason: movReason }, { id: user.id, name: user.name, role: user.role });
      toast(`Cash ${movement} recorded.`);
      setMovement(null); setMovAmount(''); setMovReason('');
      totals.reload();
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to record movement', 'error');
    } finally {
      setBusy(false);
    }
  };

  const print = () => {
    setPrintOpen(true);
    setTimeout(() => { window.print(); setTimeout(() => setPrintOpen(false), 400); }, 280);
  };

  const rows = shifts.data ?? [];
  const detailData = detail.data;
  const variance = counted ? toPaisa(counted) - (totals.data?.expectedPaisa ?? 0) : 0;

  return (
    <div className="page">
      <PageHeader title="Cash Shifts" subtitle="Drawer reconciliation for cash sales, refunds, expenses and movements." />

      <div className="grid-2" style={{ marginBottom: 14 }}>
        <Card>
          <div className="card-header">
            <div>
              <h3 className="flex items-center gap-6"><Wallet size={15} /> {current.data ? 'Shift in progress' : 'No open shift'}</h3>
              <div className="sub">{current.data ? `${current.data.number} · opened ${fmtDateTime(current.data.openedAt)}` : 'Open a shift before taking cash payments.'}</div>
            </div>
            {current.data ? <Badge tone="success" dot>Open</Badge> : <Badge tone="neutral">Closed</Badge>}
          </div>
          <div className="card-body">
            {!current.data ? (
              <div className="flex-col gap-12">
                <p className="small muted">Cash sales taken without an open shift are still invoiced but will not appear in shift reconciliation.</p>
                {can('shifts.manage') && <Button variant="primary" onClick={() => setOpenModal(true)}>Open shift</Button>}
              </div>
            ) : (
              <div className="flex-col gap-12">
                <div className="stat-strip">
                  <div className="stat"><div className="lbl">Opening float</div><div className="val">{formatMoney(current.data.openingPaisa, { currency: settings.profile.currency, decimals: false })}</div></div>
                  <div className="stat"><div className="lbl">Cash sales</div><div className="val">{formatMoney(totals.data?.cashSales ?? 0, { currency: settings.profile.currency, decimals: false })}</div></div>
                  <div className="stat"><div className="lbl">Expected drawer</div><div className="val">{formatMoney(totals.data?.expectedPaisa ?? 0, { currency: settings.profile.currency, decimals: false })}</div></div>
                </div>
                <div className="flex gap-8 wrap">
                  {can('shifts.manage') && (
                    <>
                      <Button variant="primary" size="sm" onClick={() => setCloseModal(true)}>Close & reconcile</Button>
                      <Button variant="secondary" size="sm" icon={<ArrowUpCircle size={13} />} onClick={() => setMovement('in')}>Cash in</Button>
                      <Button variant="secondary" size="sm" icon={<ArrowDownCircle size={13} />} onClick={() => setMovement('out')}>Cash out</Button>
                    </>
                  )}
                  {detailId !== current.data.id && <Button variant="ghost" size="sm" onClick={() => setDetailId(current.data!.id)}>Details</Button>}
                </div>
                <div className="mini-row"><span className="t">Cash refunds</span><span className="v mono">{formatMoney(totals.data?.cashRefunds ?? 0, { currency: settings.profile.currency })}</span></div>
                <div className="mini-row"><span className="t">Cash expenses (approved)</span><span className="v mono">{formatMoney(totals.data?.cashExpenses ?? 0, { currency: settings.profile.currency })}</span></div>
                <div className="mini-row"><span className="t">Non-cash sales</span><span className="v mono">{formatMoney(totals.data?.otherSales ?? 0, { currency: settings.profile.currency })}</span></div>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div className="card-header"><h3>How reconciliation works</h3></div>
          <div className="card-body small" style={{ color: 'var(--text-soft)', lineHeight: 1.7 }}>
            <p><b>Expected drawer</b> = opening float + cash sales − cash refunds − approved cash expenses + cash in − cash out.</p>
            <p style={{ marginTop: 8 }}>Only payments attached to this shift are counted. Card, bank and online amounts are reported separately and never included in the drawer total.</p>
            <p style={{ marginTop: 8 }} className="muted">Closing a shift writes an immutable reconciliation record with the variance for your audit trail.</p>
          </div>
        </Card>
      </div>

      <Card>
        <div className="card-header"><h3>Shift history</h3><span className="sub">{rows.length} shift{rows.length === 1 ? '' : 's'}</span></div>
        {shifts.loading && !shifts.data && <Loading />}
        {shifts.error && <ErrorState message={shifts.error} onRetry={shifts.reload} />}
        {shifts.data && rows.length === 0 && <EmptyState icon={<Clock size={20} />} title="No shifts yet" message="Open your first cash shift to start reconciling the drawer." />}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Shift</th><th>Cashier</th><th>Opened</th><th>Closed</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Variance</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => setDetailId(s.id)}>
                    <td className="mono">{s.number}</td>
                    <td>{s.userName}</td>
                    <td className="tiny nowrap">{fmtDateTime(s.openedAt)}</td>
                    <td className="tiny nowrap">{s.closedAt ? fmtDateTime(s.closedAt) : '—'}</td>
                    <td className="num">{s.expectedPaisa != null ? formatMoney(s.expectedPaisa, { currency: settings.profile.currency, decimals: false }) : '—'}</td>
                    <td className="num">{s.countedPaisa != null ? formatMoney(s.countedPaisa, { currency: settings.profile.currency, decimals: false }) : '—'}</td>
                    <td className="num" style={{ color: s.variancePaisa ? (s.variancePaisa < 0 ? 'var(--danger)' : 'var(--success)') : undefined }}>
                      {s.variancePaisa != null ? formatMoney(s.variancePaisa, { currency: settings.profile.currency }) : '—'}
                    </td>
                    <td><StatusPill status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={openModal} onClose={() => setOpenModal(false)} size="sm" title="Open cash shift"
        footer={<><Button onClick={() => setOpenModal(false)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={doOpen} loading={busy}>Open shift</Button></>}>
        <div className="form-section">
          <Field label="Opening float" hint="Count the cash currently in the drawer.">
            <div className="input-affix"><span className="affix">{settings.profile.currency}</span><Input value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} inputMode="decimal" autoFocus /></div>
          </Field>
          <Field label="Opening notes"><Textarea value={openNotes} onChange={(e) => setOpenNotes(e.target.value)} style={{ minHeight: 56 }} /></Field>
        </div>
      </Modal>

      <Modal open={closeModal} onClose={() => setCloseModal(false)} size="sm" title="Close & reconcile shift"
        footer={<><Button onClick={() => setCloseModal(false)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={doClose} loading={busy}>Close shift</Button></>}>
        <div className="form-section">
          <div className="alert alert-info"><span>Expected drawer: <b className="mono">{formatMoney(totals.data?.expectedPaisa ?? 0, { currency: settings.profile.currency })}</b></span></div>
          <Field label="Counted cash" required>
            <div className="input-affix"><span className="affix">{settings.profile.currency}</span><Input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" /></div>
          </Field>
          <div className="mini-row"><span className="t">Variance (counted − expected)</span><span className="v mono" style={{ color: variance < 0 ? 'var(--danger)' : variance > 0 ? 'var(--warning)' : 'var(--success)' }}>{formatMoney(variance, { currency: settings.profile.currency })}</span></div>
          <Field label="Closing notes"><Textarea value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder="Explain any variance" style={{ minHeight: 56 }} /></Field>
        </div>
      </Modal>

      <Modal open={!!movement} onClose={() => setMovement(null)} size="sm" title={movement === 'in' ? 'Cash in' : 'Cash out'}
        footer={<><Button onClick={() => setMovement(null)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={doMovement} loading={busy}>Record</Button></>}>
        <div className="form-section">
          <Field label="Amount" required>
            <div className="input-affix"><span className="affix">{settings.profile.currency}</span><Input value={movAmount} onChange={(e) => setMovAmount(e.target.value)} inputMode="decimal" autoFocus /></div>
          </Field>
          <Field label="Reason" required><Input value={movReason} onChange={(e) => setMovReason(e.target.value)} placeholder="e.g. petty cash top-up, bank deposit" /></Field>
        </div>
      </Modal>

      <Drawer open={!!detailId} onClose={() => setDetailId(null)} width={620} title={detailData ? `Shift ${detailData.shift.number}` : ''}
        footer={detailData && <div className="flex gap-8"><div className="grow" />{detailData.shift.status === 'closed' && <Button size="sm" variant="secondary" icon={<Printer size={13} />} onClick={() => print()}>Print report</Button>}<Button size="sm" onClick={() => setDetailId(null)}>Close</Button></div>}>
        {detail.loading && <Loading />}
        {detailData && (
          <div className="flex-col gap-14">
            <div className="stat-strip">
              <div className="stat"><div className="lbl">Opening</div><div className="val">{formatMoney(detailData.shift.openingPaisa, { currency: settings.profile.currency, decimals: false })}</div></div>
              <div className="stat"><div className="lbl">Expected</div><div className="val">{formatMoney(detailData.shift.expectedPaisa ?? 0, { currency: settings.profile.currency, decimals: false })}</div></div>
              <div className="stat"><div className="lbl">Variance</div><div className="val">{formatMoney(detailData.shift.variancePaisa ?? 0, { currency: settings.profile.currency, decimals: false })}</div></div>
            </div>
            <div className="label">Payments ({detailData.payments.length})</div>
            <div className="table-wrap" style={{ margin: '0 -18px' }}>
              <table className="table compact">
                <thead><tr><th>Time</th><th>Kind</th><th>Method</th><th>Invoice</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {detailData.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="tiny">{fmtDateTime(p.date)}</td>
                      <td className="tiny">{p.kind}</td>
                      <td className="tiny">{p.method}</td>
                      <td className="tiny mono">{p.invoiceId ? p.invoiceId.slice(-6) : '—'}</td>
                      <td className="num"><Money value={p.amountPaisa} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detailData.payments.length === 0 && <EmptyState title="No payments in this shift" />}
            </div>
            <div className="label">Cash movements</div>
            {detailData.movements.length === 0 && <div className="small muted">No manual cash in/out recorded.</div>}
            {detailData.movements.map((m) => (
              <div className="mini-row" key={m.id}>
                <span className="t">{m.type === 'in' ? 'Cash in' : 'Cash out'} · {m.reason}</span>
                <span className="v mono">{formatMoney(m.amountPaisa, { currency: settings.profile.currency })}</span>
              </div>
            ))}
            <div className="label">Expenses in shift</div>
            {detailData.expenses.length === 0 && <div className="small muted">No expenses linked to this shift.</div>}
            {detailData.expenses.map((e) => (
              <div className="mini-row" key={e.id}>
                <span className="t">{e.category} · {e.description}</span>
                <span className="v mono">{formatMoney(e.amountPaisa, { currency: settings.profile.currency })}</span>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      {printOpen && detailData && (
        <PrintPortal>
          <ShiftReportDoc
            shift={detailData.shift}
            expenses={detailData.expenses}
            payments={detailData.payments}
            settings={settings}
            userName={rows.find((s) => s.id === detailData.shift.id)?.userName ?? 'Cashier'}
          />
        </PrintPortal>
      )}
    </div>
  );
}
