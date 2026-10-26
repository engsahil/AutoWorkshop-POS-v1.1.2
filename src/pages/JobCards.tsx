import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, ClipboardList, Plus, Printer, Trash2
} from 'lucide-react';
import {
  PageHeader, Card, Button, Modal, Field, Input, Select, Textarea, Drawer, EmptyState, Loading, ErrorState,
  StatusPill, PriorityPill, Badge, ConfirmDialog, SearchInput, Money, Pager
} from '../components/ui';
import { ItemPicker, type PickedItem } from '../components/ItemPicker';
import { JobCardDoc, PrintPortal } from '../components/Print';
import { InvoiceDetailModal } from '../components/InvoiceDetail';
import { useAsync } from '../hooks/useAsync';
import { listJobs, getJob, customersWithBalances } from '../lib/queries';
import { listUsersForAssign } from '../lib/repo';
import { createJobCard, updateJobCard, changeJobStatus, invoiceJobCard, computeInvoice } from '../lib/transactions';
import { dbBy } from '../lib/db';
import { uid } from '../lib/ids';
import { useApp } from '../state/AppContext';
import { bump } from '../lib/bus';
import { formatMoney, fmtDate, fmtDateTime, toPaisa, parseISODate, todayISO } from '../lib/money';
import type { AppSettings, Customer, Invoice, JobCard, JobLine, JobStatus, Vehicle } from '../lib/types';

const STATUSES: JobStatus[] = ['draft', 'awaiting_approval', 'approved', 'in_progress', 'on_hold', 'ready', 'completed', 'cancelled'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

const NEXT: Record<JobStatus, JobStatus[]> = {
  draft: ['awaiting_approval', 'approved', 'cancelled'],
  awaiting_approval: ['approved', 'cancelled'],
  approved: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['on_hold', 'ready', 'cancelled'],
  on_hold: ['in_progress', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
};

type Row = JobCard & { customerName?: string; vehicle?: Vehicle; mechanicName?: string | null };

function emptyTotals() {
  return { subtotalPaisa: 0, discountPaisa: 0, taxPaisa: 0, totalPaisa: 0 };
}

function totalsFor(lines: JobLine[], discount = 0) {
  if (!lines.length) return emptyTotals();
  try {
    const t = computeInvoice(lines, discount);
    return { subtotalPaisa: t.subtotalPaisa, discountPaisa: t.discountPaisa, taxPaisa: t.taxPaisa, totalPaisa: t.totalPaisa };
  } catch {
    return emptyTotals();
  }
}

export default function JobCards() {
  const { settings, user, can, toast } = useApp();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | JobStatus>('all');
  const [mechanic, setMechanic] = useState('all');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<JobCard | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<JobCard | null>(null);
  const [presetVehicle, setPresetVehicle] = useState<string | null>(null);

  // Deep links from the dashboard, vehicle rows and global search.
  useEffect(() => {
    const open = params.get('open');
    const vehicle = params.get('vehicle');
    if (open) setOpenId(open);
    if (params.get('new') === '1' && can('jobcards.manage')) {
      setEditing(null);
      setPresetVehicle(vehicle);
      setCreateOpen(true);
    }
    if (open || vehicle || params.get('new')) {
      const next = new URLSearchParams(params);
      next.delete('open'); next.delete('new'); next.delete('vehicle');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const jobs = useAsync(() => listJobs({
    search, page, size: 20,
    status: status === 'all' ? undefined : status,
    mechanicId: mechanic === 'all' ? undefined : mechanic
  }), [search, status, mechanic, page], { live: true });
  const detail = useAsync(() => (openId ? getJob(openId) : Promise.resolve(null)), [openId], { live: true });
  const mechanics = useAsync(() => listUsersForAssign(), []);
  const customers = useAsync(() => customersWithBalances(), []);

  const rows = (jobs.data?.items ?? []) as unknown as Row[];
  const total = jobs.data?.total ?? 0;
  const counts = jobs.data?.counts ?? { open: 0, awaiting: 0, ready: 0, inProgress: 0 };
  const actor = user ? { id: user.id, name: user.name, role: user.role } : null;

  return (
    <div className="page">
      <PageHeader title="Job Cards" subtitle="Workshop intake, approvals and progress for every vehicle.">
        {can('jobcards.manage') && (
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => { setEditing(null); setCreateOpen(true); }}>New job card</Button>
        )}
      </PageHeader>

      <div className="stat-strip" style={{ marginBottom: 12 }}>
        <div className="stat"><div className="lbl">Open job cards</div><div className="val">{counts.open}</div></div>
        <div className="stat"><div className="lbl">Awaiting approval</div><div className="val">{counts.awaiting}</div></div>
        <div className="stat"><div className="lbl">In progress</div><div className="val">{counts.inProgress}</div></div>
        <div className="stat"><div className="lbl">Ready for delivery</div><div className="val">{counts.ready}</div></div>
      </div>

      <Card>
        <div className="table-toolbar">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search job number, complaint, customer or plate…" />
          <Select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }} style={{ width: 170 }} aria-label="Filter by status">
            <option value="all">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </Select>
          <Select value={mechanic} onChange={(e) => { setMechanic(e.target.value); setPage(1); }} style={{ width: 170 }} aria-label="Filter by mechanic">
            <option value="all">All mechanics</option>
            {(mechanics.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
          <div className="grow" />
          <span className="tiny muted">{total} job card{total === 1 ? '' : 's'}</span>
        </div>

        {jobs.loading && !jobs.data && <Loading />}
        {jobs.error && <ErrorState message={jobs.error} onRetry={jobs.reload} />}
        {jobs.data && rows.length === 0 && (
          <EmptyState
            icon={<ClipboardList size={20} />}
            title={search || status !== 'all' || mechanic !== 'all' ? 'No job cards match those filters' : 'No job cards yet'}
            message={search || status !== 'all' ? 'Try clearing the search or status filter.' : 'Book in a vehicle to start tracking repairs, approvals and billing.'}
            action={can('jobcards.manage') ? <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>New job card</Button> : undefined}
          />
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Job card</th><th>Customer</th><th>Vehicle</th><th>Mechanic</th>
                  <th>Priority</th><th>Status</th><th>Due</th><th className="num">Estimate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((j) => (
                  <tr key={j.id} className="clickable" onClick={() => setOpenId(j.id)}>
                    <td>
                      <div className="mono">{j.number}</div>
                      <div className="tiny muted truncate" style={{ maxWidth: 200 }}>{j.complaint}</div>
                    </td>
                    <td className="truncate" style={{ maxWidth: 150 }}>{j.customerName ?? '—'}</td>
                    <td>
                      <div className="mono tiny">{j.vehicle?.regNo ?? '—'}</div>
                      <div className="tiny muted">{j.vehicle ? `${j.vehicle.make} ${j.vehicle.model}` : ''}</div>
                    </td>
                    <td className="tiny">{j.mechanicName ?? <span className="muted">Unassigned</span>}</td>
                    <td><PriorityPill priority={j.priority} /></td>
                    <td><StatusPill status={j.status} /></td>
                    <td className="tiny nowrap">{j.dueDate ? fmtDate(parseISODate(j.dueDate).getTime()) : '—'}</td>
                    <td className="num"><Money value={j.estimatePaisa} decimals={false} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 20 && (
          <div className="table-footer">
            <Pager page={page} total={total} size={20} onPage={setPage} />
          </div>
        )}
      </Card>

      <JobDetail
        open={!!openId}
        data={detail.data}
        loading={detail.loading}
        canManage={can('jobcards.manage')}
        actor={actor}
        onClose={() => setOpenId(null)}
        onEdit={(job) => { setEditing(job); setCreateOpen(true); }}
        onChanged={() => { detail.reload(); jobs.reload(); bump(); }}
        onInvoice={(job) => setInvoiceFor(job)}
        settings={settings}
      />

      {createOpen && (
        <JobEditor
          key={editing?.id ?? 'new'}
          job={editing}
          mechanics={mechanics.data ?? []}
          customers={customers.data ?? []}
          presetVehicleId={presetVehicle}
          onClose={() => { setCreateOpen(false); setEditing(null); setPresetVehicle(null); }}
          onSaved={(id) => {
            setCreateOpen(false);
            setEditing(null);
            jobs.reload();
            setOpenId(id);
            bump();
            toast(editing ? 'Job card updated.' : 'Job card created.');
          }}
        />
      )}

      {invoiceFor && (
        <InvoiceJobDialog
          job={invoiceFor}
          settings={settings}
          onClose={() => setInvoiceFor(null)}
          onDone={(invoice) => {
            setInvoiceFor(null);
            jobs.reload();
            detail.reload();
            bump();
            toast(`${invoice.number} created from this job card.`);
            // Land on the finished invoice so the counter staff can print the
            // receipt straight away instead of hunting for it in the register.
            navigate(`/invoices?open=${invoice.id}`);
          }}
        />
      )}
    </div>
  );
}

function label(s: string) {
  return s === 'awaiting_approval' ? 'Awaiting approval' : s === 'in_progress' ? 'In progress' : s === 'on_hold' ? 'On hold' : s.charAt(0).toUpperCase() + s.slice(1);
}

function JobDetail({ open, data, loading, canManage, actor, onClose, onEdit, onChanged, onInvoice, settings }: {
  open: boolean;
  data: Awaited<ReturnType<typeof getJob>> | null;
  loading: boolean;
  canManage: boolean;
  actor: { id: string; name: string; role: import('../lib/types').Role } | null;
  onClose: () => void;
  onEdit: (j: JobCard) => void;
  onChanged: () => void;
  onInvoice: (j: JobCard) => void;
  settings: AppSettings;
}) {
  const { toast } = useApp();
  const [note, setNote] = useState('');
  const [transitioning, setTransitioning] = useState<JobStatus | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [invoicePreview, setInvoicePreview] = useState<string | null>(null);

  const job = data?.job ?? null;

  const move = async (next: JobStatus) => {
    if (!job || !actor) return;
    setTransitioning(next);
    try {
      await changeJobStatus(job.id, next, note, actor);
      setNote('');
      toast(`Job moved to ${label(next).toLowerCase()}.`);
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to change status', 'error');
    } finally {
      setTransitioning(null);
    }
  };

  const cancel = async () => {
    if (!job || !actor) return;
    try {
      await changeJobStatus(job.id, 'cancelled', note || 'Cancelled from job card', actor);
      setConfirmCancel(false);
      setNote('');
      toast('Job card cancelled.');
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to cancel', 'error');
    }
  };

  const print = () => {
    setPrinting(true);
    setTimeout(() => { window.print(); setTimeout(() => setPrinting(false), 400); }, 260);
  };

  const lines = job?.lines ?? [];
  const totals = totalsFor(lines);
  const nextStates = job ? NEXT[job.status].filter((s) => s !== 'cancelled') : [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={760}
      title={job ? `${job.number} · ${data?.vehicle?.regNo ?? 'Vehicle'}` : 'Job card'}
      footer={job ? (
        <div className="flex gap-8 wrap">
          <div className="grow" />
          <Button variant="ghost" size="sm" icon={<Printer size={13} />} onClick={print}>Print</Button>
          {job.status === 'ready' && canManage && (
            <Button variant="primary" size="sm" icon={<ArrowRight size={13} />} onClick={() => onInvoice(job)}>Convert to invoice</Button>
          )}
          {canManage && job.status !== 'completed' && job.status !== 'cancelled' && <Button variant="secondary" size="sm" onClick={() => onEdit(job)}>Edit</Button>}
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      ) : undefined}
    >
      {loading && !job && <Loading />}
      {job && (
        <div className="flex-col gap-16">
          <div className="flex items-center gap-8 wrap">
            <StatusPill status={job.status} />
            <PriorityPill priority={job.priority} />
            {job.invoiceId ? <Badge tone="bronze" dot>Invoiced</Badge> : null}
            <div className="grow" />
            <span className="tiny muted">Created {fmtDateTime(job.createdAt)}</span>
          </div>

          <div className="detail-grid">
            <div><div className="doc-label">Customer</div><div className="doc-strong">{data?.customer?.name ?? '—'}</div><div className="tiny muted">{data?.customer?.phone ?? ''}</div></div>
            <div><div className="doc-label">Vehicle</div><div className="doc-strong mono">{data?.vehicle?.regNo ?? '—'}</div><div className="tiny muted">{data?.vehicle ? `${data.vehicle.make} ${data.vehicle.model}${data.vehicle.year ? ` · ${data.vehicle.year}` : ''}` : ''}</div></div>
            <div><div className="doc-label">Mechanic</div><div className="doc-strong">{job.mechanicId ? (data?.job ? 'Assigned' : '—') : 'Unassigned'}</div></div>
            <div><div className="doc-label">Due</div><div className="doc-strong">{job.dueDate ? fmtDate(parseISODate(job.dueDate).getTime()) : '—'}</div></div>
            <div><div className="doc-label">Odometer</div><div className="doc-strong mono">{job.odometer ? `${job.odometer.toLocaleString()} km` : '—'}</div></div>
            <div><div className="doc-label">Estimate</div><div className="doc-strong mono">{formatMoney(job.estimatePaisa, { currency: settings.profile.currency })}</div></div>
          </div>

          <div>
            <div className="label">Reported complaint</div>
            <p className="small" style={{ color: 'var(--text-soft)', lineHeight: 1.6 }}>{job.complaint || '—'}</p>
            {job.findings && <><div className="label" style={{ marginTop: 10 }}>Findings</div><p className="small" style={{ color: 'var(--text-soft)', lineHeight: 1.6 }}>{job.findings}</p></>}
            {job.recommendation && <><div className="label" style={{ marginTop: 10 }}>Recommendation</div><p className="small" style={{ color: 'var(--text-soft)', lineHeight: 1.6 }}>{job.recommendation}</p></>}
          </div>

          <div>
            <div className="row-between"><div className="label">Estimate lines</div><span className="tiny muted">{lines.length} line{lines.length === 1 ? '' : 's'}</span></div>
            {lines.length === 0 ? (
              <div className="small muted">No lines added. Edit the job card to price parts and labour.</div>
            ) : (
              <div className="table-wrap">
                <table className="table compact">
                  <thead><tr><th>Item</th><th>Kind</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.name}</td>
                        <td className="tiny" style={{ textTransform: 'capitalize' }}>{l.kind}</td>
                        <td className="num">{l.qty}</td>
                        <td className="num"><Money value={l.ratePaisa} /></td>
                        <td className="num"><Money value={Math.round(l.qty * l.ratePaisa)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mini-row" style={{ marginTop: 8 }}><span className="t">Subtotal</span><span className="v mono">{formatMoney(totals.subtotalPaisa, { currency: settings.profile.currency })}</span></div>
            <div className="mini-row"><span className="t">Tax</span><span className="v mono">{formatMoney(totals.taxPaisa, { currency: settings.profile.currency })}</span></div>
            <div className="mini-row"><span className="t" style={{ fontWeight: 700 }}>Estimate total</span><span className="v mono" style={{ fontWeight: 700 }}>{formatMoney(totals.totalPaisa, { currency: settings.profile.currency })}</span></div>
          </div>

          {canManage && NEXT[job.status].length > 0 && (
            <div className="job-actions">
              <div className="label">Move job</div>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for the history timeline" />
              <div className="flex gap-8 wrap">
                {nextStates.map((s) => (
                  <Button key={s} size="sm" variant={s === 'completed' || s === 'ready' ? 'primary' : 'secondary'} loading={transitioning === s} onClick={() => move(s)}>
                    {s === 'awaiting_approval' ? 'Send for approval' : s === 'approved' ? 'Approve' : s === 'in_progress' ? 'Start work' : s === 'on_hold' ? 'Put on hold' : s === 'ready' ? 'Mark ready' : 'Complete'}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(true)}>Cancel job</Button>
              </div>
            </div>
          )}

          <div>
            <div className="label">History</div>
            <ol className="timeline">
              {[...(job.history ?? [])].reverse().map((h, i) => (
                <li key={i}>
                  <span className="timeline-dot" />
                  <div className="grow">
                    <div className="timeline-title">{h.status ? label(h.status) : h.action}</div>
                    {h.note && <div className="tiny" style={{ color: 'var(--text-soft)' }}>{h.note}</div>}
                    <div className="tiny muted">{h.by} · {fmtDateTime(h.at)}</div>
                  </div>
                </li>
              ))}
              {(job.history ?? []).length === 0 && <li><span className="tiny muted">No history recorded.</span></li>}
            </ol>
          </div>

          {job.invoiceId && (
            <Button variant="secondary" size="sm" icon={<ClipboardList size={13} />} onClick={() => setInvoicePreview(job.invoiceId!)}>View linked invoice</Button>
          )}
        </div>
      )}

      {printing && data && (
        <PrintPortal>
          <JobCardDoc job={data.job} customer={data.customer} vehicle={data.vehicle} settings={settings} />
        </PrintPortal>
      )}

      {invoicePreview && <InvoiceDetailModal invoiceId={invoicePreview} onClose={() => setInvoicePreview(null)} onChanged={onChanged} />}

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this job card?"
        message="The job card closes as cancelled. Its history stays intact; stock is not moved."
        confirmLabel="Cancel job card"
        tone="danger"
        onConfirm={cancel}
        onClose={() => setConfirmCancel(false)}
      />
    </Drawer>
  );
}

function JobEditor({ job, mechanics, customers, presetVehicleId, onClose, onSaved }: {
  job: JobCard | null;
  mechanics: { id: string; name: string; role: string }[];
  customers: Customer[];
  presetVehicleId?: string | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { settings, user } = useApp();
  const actor = user ? { id: user.id, name: user.name, role: user.role } : null;
  const [customerId, setCustomerId] = useState(job?.customerId ?? '');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [resolvePreset, setResolvePreset] = useState(!!presetVehicleId && !job);
  const [vehicleId, setVehicleId] = useState(job?.vehicleId ?? '');
  const [mechanicId, setMechanicId] = useState(job?.mechanicId ?? '');
  const [priority, setPriority] = useState(job?.priority ?? 'normal');
  const [complaint, setComplaint] = useState(job?.complaint ?? '');
  const [findings, setFindings] = useState(job?.findings ?? '');
  const [recommendation, setRecommendation] = useState(job?.recommendation ?? '');
  const [odometer, setOdometer] = useState(job?.odometer ? String(job.odometer) : '');
  const [dueDate, setDueDate] = useState(job?.dueDate ?? todayISO());
  const [lines, setLines] = useState<JobLine[]>(job?.lines ?? []);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve the deep-linked vehicle to its owner before the first render of the selects.
  useEffect(() => {
    if (!resolvePreset || !presetVehicleId) return;
    let alive = true;
    import('../lib/db').then(({ dbGet }) => dbGet<Vehicle>('vehicles', presetVehicleId)).then((v) => {
      if (!alive) return;
      if (v) { setCustomerId(v.customerId); setVehicleId(v.id); }
      setResolvePreset(false);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvePreset, presetVehicleId]);

  useEffect(() => {
    let alive = true;
    if (!customerId) { setVehicles([]); return; }
    dbBy<Vehicle>('vehicles', 'customerId', customerId).then((rows) => {
      if (!alive) return;
      setVehicles(rows.filter((v) => !v.archived));
      if (!rows.some((v) => v.id === vehicleId)) setVehicleId(rows[0]?.id ?? '');
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const addLine = (picked: PickedItem) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.kind === picked.kind && l.refId === picked.refId);
      if (existing) return prev.map((l) => l.id === existing.id ? { ...l, qty: l.qty + 1 } : l);
      return [...prev, {
        id: uid('jl'),
        kind: picked.kind,
        refId: picked.refId,
        name: picked.name,
        qty: 1,
        ratePaisa: picked.ratePaisa,
        taxRate: picked.taxRate
      }];
    });
    setPicker(false);
  };

  const totals = totalsFor(lines);

  const submit = async () => {
    setError(null);
    if (!actor) return;
    if (!customerId) { setError('Choose the customer this job belongs to.'); return; }
    if (!vehicleId) { setError('Choose the vehicle, or add one on the Vehicles screen first.'); return; }
    if (!complaint.trim()) { setError('Describe the customer’s complaint.'); return; }
    setBusy(true);
    try {
      const payload = {
        customerId, vehicleId, mechanicId: mechanicId || null, priority: priority as JobCard['priority'],
        complaint, findings, recommendation,
        odometer: odometer ? Number(odometer) : undefined,
        dueDate: dueDate || undefined,
        lines,
        estimatePaisa: totalsFor(lines).totalPaisa
      };
      if (job) {
        await updateJobCard(job.id, payload, actor);
        onSaved(job.id);
      } else {
        const created = await createJobCard(payload, actor);
        onSaved(created.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save job card.');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={job ? `Edit ${job.number}` : 'New job card'}
      sub={job ? undefined : 'Capture the vehicle, complaint and estimate.'}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy}>{job ? 'Save changes' : 'Create job card'}</Button></>}
    >
      <div className="form-section">
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="form-grid">
          <Field label="Customer" required>
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={!!job}>
              <option value="">Select customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
            </Select>
          </Field>
          <Field label="Vehicle" required hint={vehicles.length === 0 && customerId ? 'No vehicles on file for this customer.' : undefined}>
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={!customerId}>
              <option value="">{customerId ? 'Select vehicle…' : 'Choose a customer first'}</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.regNo} · {v.make} {v.model}</option>)}
            </Select>
          </Field>
          <Field label="Assign mechanic">
            <Select value={mechanicId} onChange={(e) => setMechanicId(e.target.value)}>
              <option value="">Unassigned</option>
              {mechanics.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </Select>
          </Field>
          <Field label="Odometer (km)"><Input value={odometer} onChange={(e) => setOdometer(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" /></Field>
          <Field label="Promised date"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
        </div>
        <Field label="Reported complaint" required>
          <Textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="What did the customer report?" style={{ minHeight: 64 }} />
        </Field>
        <div className="form-grid">
          <Field label="Findings"><Textarea value={findings} onChange={(e) => setFindings(e.target.value)} style={{ minHeight: 56 }} /></Field>
          <Field label="Recommendation"><Textarea value={recommendation} onChange={(e) => setRecommendation(e.target.value)} style={{ minHeight: 56 }} /></Field>
        </div>
      </div>

      <div className="form-section">
        <div className="row-between">
          <div className="form-section-title">Estimate lines</div>
          <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setPicker(true)}>Add item</Button>
        </div>
        {lines.length === 0 ? (
          <div className="small muted">No lines yet. Add parts, services or labour to build the estimate.</div>
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Item</th><th style={{ width: 74 }}>Qty</th><th style={{ width: 110 }}>Rate ({settings.profile.currency})</th><th className="num">Amount</th><th /></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name}<div className="tiny muted" style={{ textTransform: 'capitalize' }}>{l.kind}{l.taxRate ? ` · ${l.taxRate}% tax` : ''}</div></td>
                    <td><Input value={String(l.qty)} onChange={(e) => setLines((prev) => prev.map((x) => x.id === l.id ? { ...x, qty: Math.max(0.001, Number(e.target.value) || 0) } : x))} inputMode="decimal" style={{ height: 28, padding: '2px 6px', fontSize: 12 }} /></td>
                    <td><Input value={(l.ratePaisa / 100).toString()} onChange={(e) => setLines((prev) => prev.map((x) => x.id === l.id ? { ...x, ratePaisa: toPaisa(e.target.value) } : x))} inputMode="decimal" style={{ height: 28, padding: '2px 6px', fontSize: 12 }} /></td>
                    <td className="num"><Money value={Math.round(l.qty * l.ratePaisa)} /></td>
                    <td className="actions"><button className="btn btn-ghost btn-xs" onClick={() => setLines((prev) => prev.filter((x) => x.id !== l.id))} aria-label={`Remove ${l.name}`}><Trash2 size={12} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex-col gap-2" style={{ alignItems: 'flex-end' }}>
          <div className="mini-row" style={{ width: 230 }}><span className="t">Subtotal</span><span className="v mono">{formatMoney(totals.subtotalPaisa, { currency: settings.profile.currency })}</span></div>
          <div className="mini-row" style={{ width: 230 }}><span className="t">Tax</span><span className="v mono">{formatMoney(totals.taxPaisa, { currency: settings.profile.currency })}</span></div>
          <div className="mini-row" style={{ width: 230 }}><span className="t" style={{ fontWeight: 700 }}>Estimate</span><span className="v mono" style={{ fontWeight: 700 }}>{formatMoney(totals.totalPaisa, { currency: settings.profile.currency })}</span></div>
        </div>
      </div>

      <ItemPicker open={picker} onClose={() => setPicker(false)} onPick={addLine} kinds={['part', 'service', 'labor']} />
    </Modal>
  );
}

function InvoiceJobDialog({ job, settings, onClose, onDone }: {
  job: JobCard; settings: AppSettings; onClose: () => void; onDone: (invoice: Invoice) => void;
}) {
  const { user } = useApp();
  const [opId] = useState(() => uid('inv'));
  const [discount, setDiscount] = useState('0');
  const [payNow, setPayNow] = useState(true);
  const [method, setMethod] = useState<'cash' | 'card' | 'bank' | 'online'>('cash');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = totalsFor(job.lines ?? [], 0);
  const totals = totalsFor(job.lines ?? [], toPaisa(discount || 0));
  const tendered = amount ? toPaisa(amount) : totals.totalPaisa;
  const paying = payNow ? Math.max(0, Math.min(tendered, totals.totalPaisa)) : 0;

  const submit = async () => {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      const invoice = await invoiceJobCard(
        job.id,
        paying > 0 ? [{ method, amountPaisa: paying }] : [],
        toPaisa(discount || 0),
        { id: user.id, name: user.name, role: user.role },
        opId
      );
      // onDone fires the single user-facing confirmation for this action.
      onDone(invoice);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create invoice.');
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="sm" title={`Invoice ${job.number}`}
      sub="Stock is deducted once, at the moment this invoice is created."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy}>Create invoice</Button></>}>
      <div className="form-section">
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="mini-row"><span className="t">Estimate lines</span><span className="v">{job.lines?.length ?? 0}</span></div>
        <div className="mini-row"><span className="t">Subtotal</span><span className="v mono">{formatMoney(base.subtotalPaisa, { currency: settings.profile.currency })}</span></div>
        <Field label={`Invoice discount (${settings.profile.currency})`}>
          <Input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" />
        </Field>
        <div className="mini-row"><span className="t">Tax</span><span className="v mono">{formatMoney(totals.taxPaisa, { currency: settings.profile.currency })}</span></div>
        <div className="mini-row"><span className="t" style={{ fontWeight: 700 }}>Invoice total</span><span className="v mono" style={{ fontWeight: 700 }}>{formatMoney(totals.totalPaisa, { currency: settings.profile.currency })}</span></div>
        <div className="divider" />
        <label className="flex items-center gap-8" style={{ fontSize: 12.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} style={{ accentColor: 'var(--bronze-500)' }} />
          Take a payment now
        </label>
        {payNow && (
          <>
            <div className="form-grid">
              <Field label="Method">
                <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                  {settings.documents.paymentMethods.map((m) => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
                </Select>
              </Field>
              <Field label="Amount" hint="Leave blank to settle the full total.">
                <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={(totals.totalPaisa / 100).toFixed(2)} />
              </Field>
            </div>
            {paying < totals.totalPaisa && (
              <div className="alert alert-warning">Partial payment — the invoice is saved with an outstanding balance of {formatMoney(totals.totalPaisa - paying, { currency: settings.profile.currency })}.</div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
