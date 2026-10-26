import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, CalendarClock, ClipboardList, CreditCard, Package, Receipt as ReceiptIcon,
  RotateCcw, Settings as SettingsIcon, ShieldCheck, ShoppingCart, Sparkles, TrendingUp, Truck, UserPlus, Users, Wallet, Wrench
} from 'lucide-react';
import {
  PageHeader, Card, CardHeader, Button, Badge, EmptyState, Loading, ErrorState, StatusPill, Money
} from '../components/ui';
import { LineChart, BarChart, DonutChart, CHART_COLORS } from '../components/charts';
import { useAsync } from '../hooks/useAsync';
import { dashboardData } from '../lib/queries';
import { useApp } from '../state/AppContext';
import { trend, percent } from '../lib/analytics';
import { assetUrl } from '../lib/assets';
import { fmtDate, formatMoney, relTime } from '../lib/money';
import type { AuditEvent, JobCard } from '../lib/types';

type SeriesKey = 'day' | 'month';
type Measure = 'revenue' | 'count';

export default function Dashboard() {
  const { user, settings, can, toast } = useApp();
  const navigate = useNavigate();
  const [seriesKey, setSeriesKey] = useState<SeriesKey>('day');
  const [measure, setMeasure] = useState<Measure>('revenue');
  const data = useAsync(() => dashboardData(), [], { live: true });

  const d = data.data;
  const cur = settings.profile.currency;
  const hero = settings.attachments.heroArt ? assetUrl(settings.attachments.heroArt, '') : null;
  const heroPos = settings.attachments.heroArtPosition || 'center 45%';
  const firstName = (user?.name ?? '').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const recentJobs = useMemo(() => (d?.recentJobs ?? []) as (JobCard & { customerName: string; vehicleLabel: string })[], [d]);
  const series = seriesKey === 'day' ? d?.daySeries ?? [] : d?.monthSeries ?? [];
  const slices = (measure === 'revenue' ? d?.distribution : d?.distributionCount) ?? [];
  const top = slices.slice(0, 4);
  const rest = slices.slice(4);
  const legend = rest.length
    ? [...top, { name: 'Other services', value: rest.reduce((a, s) => a + s.value, 0), percent: Math.round(rest.reduce((a, s) => a + s.percent, 0) * 10) / 10 }]
    : top;

  const revenueTrend = d ? trend(d.month.netRevenuePaisa, d.prevMonth.netRevenuePaisa) : null;
  const invoiceTrend = d ? trend(d.month.invoiceCount, d.prevMonth.invoiceCount) : null;
  const fresh = !!d && d.recentInvoices.length === 0 && d.recentJobs.length === 0;
  const readyJobs = d?.pendingJobs.filter((j) => j.status === 'ready').length ?? 0;
  const awaiting = d?.pendingJobs.filter((j) => j.status === 'awaiting_approval').length ?? 0;

  const quickActions = [
    { label: 'New sale', icon: ShoppingCart, to: '/pos', perm: 'pos.sell' as const, hint: 'POS billing' },
    { label: 'New job card', icon: ClipboardList, to: '/jobcards?new=1', perm: 'jobcards.manage' as const, hint: 'Workshop intake' },
    { label: 'Add customer', icon: UserPlus, to: '/customers?new=1', perm: 'customers.manage' as const, hint: 'Customer records' },
    { label: 'Receive stock', icon: Truck, to: '/purchases', perm: 'purchases.manage' as const, hint: 'Purchases' },
    { label: 'Register warranty', icon: ShieldCheck, to: '/warranty?new=1', perm: 'warranty.manage' as const, hint: 'Warranty' },
    { label: 'Open shift', icon: Wallet, to: '/shifts', perm: 'shifts.manage' as const, hint: 'Cash drawer' }
  ].filter((a) => can(a.perm));

  return (
    <div className="page">
      <PageHeader title="Dashboard" subtitle={`${fmtDate(Date.now(), settings.profile.timezone)} · ${settings.profile.name || 'Your workshop'}`}>
        {can('pos.sell') && <Button variant="primary" icon={<ShoppingCart size={15} />} onClick={() => navigate('/pos')}>New sale</Button>}
      </PageHeader>

      <div className="dash-grid">
        {/* Hero + headline figures share one dark panel, as in the design board */}
        <section className="hero-panel">
        <div className={`hero hero-strip${hero ? ' has-art' : ''}`} style={{ '--hero-pos': heroPos } as React.CSSProperties}>
          {hero && <img className="hero-img" src={hero} alt="" />}
          {hero && <div className="hero-overlay" aria-hidden="true" />}
          <div className="hero-content">
            <div className="eyebrow"><span className="bar" /> {greeting}{firstName ? `, ${firstName}` : ''}</div>
            <p className="hero-line">
              {(d?.month.invoiceCount ?? 0)} invoices this month
              <span className="sep">·</span>
              {(d?.pendingJobs.length ?? 0)} open job cards
            </p>
            <div className="hero-actions">
              {can('pos.sell') && <button className="btn btn-secondary btn-sm" onClick={() => navigate('/pos')}><ShoppingCart size={14} /> Start a sale</button>}
              {can('jobcards.manage') && <button className="btn btn-ghost btn-sm" onClick={() => navigate('/jobcards?new=1')}>New job card <ArrowRight size={13} /></button>}
            </div>
          </div>
        </div>

        {/* KPI metrics */}
        <div className="metrics metrics-dark">
          <div className="metric">
            <div className="m-top">
              <span className="m-label">Total sales <span className="m-period">this month</span></span>
              <span className="m-icon"><CreditCard size={15} /></span>
            </div>
            <div className="m-value">
              <span className="cur">{cur}</span>
              {((d?.month.netRevenuePaisa ?? 0) / 100).toLocaleString('en-PK', { maximumFractionDigits: 0 })}
            </div>
            <div className="m-sub">
              {revenueTrend != null ? (
                <span className={`delta ${revenueTrend >= 0 ? 'up' : 'down'}`}>
                  {revenueTrend >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                  {Math.abs(revenueTrend)}%
                </span>
              ) : <span className="delta flat">—</span>}
              <span>{revenueTrend != null ? 'vs last month' : 'no prior-month data'} · net of returns</span>
            </div>
          </div>

          <div className="metric">
            <div className="m-top">
              <span className="m-label">Invoices <span className="m-period">this month</span></span>
              <span className="m-icon"><ReceiptIcon size={15} /></span>
            </div>
            <div className="m-value">{d?.month.invoiceCount ?? 0}</div>
            <div className="m-sub">
              {invoiceTrend != null ? (
                <span className={`delta ${invoiceTrend >= 0 ? 'up' : 'down'}`}>
                  {invoiceTrend >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                  {Math.abs(invoiceTrend)}%
                </span>
              ) : <span className="delta flat">—</span>}
              <span>{formatMoney(d?.month.collectedPaisa ?? 0, { currency: cur, decimals: false })} collected</span>
            </div>
          </div>

          <div className="metric">
            <div className="m-top">
              <span className="m-label">Pending jobs</span>
              <span className="m-icon"><Wrench size={15} /></span>
            </div>
            <div className="m-value">{d?.pendingJobs.length ?? 0}</div>
            <div className="m-sub">
              <span className="delta flat">{readyJobs}</span>
              <span>ready for delivery{awaiting ? ` · ${awaiting} awaiting approval` : ''}</span>
            </div>
          </div>

          <div className="metric">
            <div className="m-top">
              <span className="m-label">Customers</span>
              <span className="m-icon"><Users size={15} /></span>
            </div>
            <div className="m-value">{d?.totalCustomers ?? 0}</div>
            <div className="m-sub">
              <span className="delta flat">{d?.lowStock.length ?? 0}</span>
              <span>part{(d?.lowStock.length ?? 0) === 1 ? '' : 's'} at or below reorder level</span>
            </div>
          </div>
        </div>
        </section>

        {fresh && (
          <Card className="onboarding-card">
            <div className="onboarding">
              <div className="onboarding-copy">
                <div className="onboarding-kicker"><Sparkles size={12} /> First-time workspace</div>
                <h3>Your workshop is set up. Now give it something to run on.</h3>
                <p>Nothing is shown until it is real: no invented revenue, no placeholder customers. Three steps get you to a working desk.</p>
                <ol className="onboarding-steps">
                  <li><b>1</b><span>Add your parts and services so billing has real prices.</span></li>
                  <li><b>2</b><span>Create a customer and vehicle, or open a job card straight away.</span></li>
                  <li><b>3</b><span>Open a cash shift, then ring up your first sale.</span></li>
                </ol>
                <div className="flex gap-8 wrap">
                  <Link to="/inventory" className="btn btn-primary btn-sm">Add stock <ArrowRight size={13} /></Link>
                  <Link to="/customers?new=1" className="btn btn-secondary btn-sm">Add customer</Link>
                  {can('settings.manage') && <Link to="/settings" className="btn btn-ghost btn-sm">Load sample data</Link>}
                </div>
              </div>
              <div className="onboarding-art" aria-hidden="true">
                <Package size={54} strokeWidth={1.1} />
                <Wrench size={30} strokeWidth={1.2} />
              </div>
            </div>
          </Card>
        )}

        {/* Charts */}
        <div className="dash-row two">
          <Card>
            <div className="chart-head">
              <div>
                <h3>Sales overview</h3>
                <div className="sub">
                  {seriesKey === 'day' ? 'Last 7 days' : 'Last 6 months'} · invoice value incl. tax, less credit notes
                </div>
              </div>
              <div className="segmented">
                <button className={seriesKey === 'day' ? 'active' : ''} onClick={() => setSeriesKey('day')}>7 days</button>
                <button className={seriesKey === 'month' ? 'active' : ''} onClick={() => setSeriesKey('month')}>6 months</button>
              </div>
            </div>
            <div className="chart-card-body">
              <LineChart
                data={series.map((b) => ({ label: b.label, value: b.netPaisa, meta: `${b.count} invoice${b.count === 1 ? '' : 's'}` }))}
                height={198}
                format={(v) => formatMoney(v, { currency: cur })}
                axisFormat={(v) => `${Math.round(v / 100 / 1000)}k`}
                emptyMessage="No sales recorded in this window yet."
              />
            </div>
            <div className="chart-foot">
              <div className="mini-stat"><span>Total in view</span><b>{formatMoney(series.reduce((a, b) => a + b.netPaisa, 0), { currency: cur, decimals: false })}</b></div>
              <div className="mini-stat"><span>Invoices</span><b>{series.reduce((a, b) => a + b.count, 0)}</b></div>
              <div className="mini-stat"><span>Returns</span><b>{formatMoney(series.reduce((a, b) => a + b.returnsPaisa, 0), { currency: cur, decimals: false })}</b></div>
            </div>
          </Card>

          <Card>
            <div className="chart-head">
              <div>
                <h3>Service distribution</h3>
                <div className="sub">This month · share of billed services</div>
              </div>
              <div className="segmented">
                <button className={measure === 'revenue' ? 'active' : ''} onClick={() => setMeasure('revenue')}>Value</button>
                <button className={measure === 'count' ? 'active' : ''} onClick={() => setMeasure('count')}>Jobs</button>
              </div>
            </div>
            <div className="donut-body">
              <DonutChart
                slices={top.map((s, i) => ({ ...s, color: CHART_COLORS[i % CHART_COLORS.length] }))}
                size={158}
                thickness={20}
                centerLabel={slices.length ? `${slices.length}` : '0'}
                centerSub="service types"
              />
              <div className="donut-legend">
                {legend.map((s) => (
                  <div className="legend-item" key={s.name}>
                    <span className="swatch" style={{ background: CHART_COLORS[top.findIndex((t) => t.name === s.name)] ?? '#D6C1A8' }} />
                    <span className="truncate" style={{ maxWidth: 118 }}>{s.name}</span>
                    <span className="val">{s.percent}%</span>
                  </div>
                ))}
                {slices.length === 0 && <span className="small muted">Services appear here once you bill them.</span>}
              </div>
            </div>
            <div className="chart-foot">
              <div className="mini-stat">
                <span>{measure === 'revenue' ? 'Billed value' : 'Service lines'}</span>
                <b>
                  {measure === 'revenue'
                    ? formatMoney(slices.reduce((a, s) => a + s.value, 0), { currency: cur, decimals: false })
                    : slices.reduce((a, s) => a + s.value, 0).toLocaleString('en-PK')}
                </b>
              </div>
              <div className="mini-stat"><span>Categories</span><b>{slices.length}</b></div>
            </div>
          </Card>
        </div>

        {/* Tables */}
        <div className="dash-row tables">
          <Card>
            <CardHeader
              title="Recent job cards"
              sub={`${d?.pendingJobs.length ?? 0} open`}
              right={<Link to="/jobcards" className="link-more">View all <ArrowRight size={12} /></Link>}
            />
            {data.loading && !d && <Loading />}
            {data.error && <ErrorState message={data.error} onRetry={data.reload} />}
            {recentJobs.length === 0 ? (
              <EmptyState icon={<ClipboardList size={19} />} title="No job cards yet" message="Book in a vehicle to start tracking workshop work." />
            ) : (
              <div className="table-wrap">
                <table className="table compact">
                  <thead><tr><th>Job card</th><th>Customer</th><th>Vehicle</th><th>Status</th><th className="num">Estimate</th></tr></thead>
                  <tbody>
                    {recentJobs.map((j) => (
                      <tr key={j.id} className="clickable" onClick={() => navigate(`/jobcards?open=${j.id}`)}>
                        <td className="mono">{j.number}</td>
                        <td className="truncate" style={{ maxWidth: 150 }}>{j.customerName}</td>
                        <td className="mono tiny">{j.vehicleLabel}</td>
                        <td><StatusPill status={j.status} /></td>
                        <td className="num"><Money value={j.estimatePaisa} decimals={false} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Recent invoices"
              sub="Latest billing activity"
              right={<Link to="/invoices" className="link-more">View all <ArrowRight size={12} /></Link>}
            />
            {(d?.recentInvoices ?? []).length === 0 ? (
              <EmptyState icon={<ReceiptIcon size={19} />} title="No invoices yet" message="Complete a sale in POS and it will appear here." />
            ) : (
              <div className="table-wrap">
                <table className="table compact">
                  <thead><tr><th>Invoice</th><th>Customer</th><th>Status</th><th className="num">Total</th></tr></thead>
                  <tbody>
                    {(d?.recentInvoices ?? []).map((inv) => (
                      <tr key={inv.id} className="clickable" onClick={() => navigate(`/invoices?open=${inv.id}`)}>
                        <td className="mono">{inv.number}</td>
                        <td className="truncate" style={{ maxWidth: 150 }}>{(inv as { customerName?: string }).customerName ?? 'Walk-in'}</td>
                        <td><StatusPill status={inv.paymentStatus} /></td>
                        <td className="num"><Money value={inv.totalPaisa} decimals={false} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Monthly bars + activity + quick actions */}
        <div className="dash-row bottom">
          <Card>
            <div className="chart-head">
              <div><h3>Monthly sales</h3><div className="sub">Invoice value per month, incl. tax</div></div>
            </div>
            <div className="chart-card-body">
              <BarChart
                data={(d?.monthSeries ?? []).map((b) => ({ label: b.label, value: b.netPaisa }))}
                height={176}
                format={(v) => formatMoney(v, { currency: cur })}
                axisFormat={(v) => `${Math.round(v / 100 / 1000)}k`}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Recent activity" sub="From the audit trail" right={can('audit.view') ? <Link to="/reports" className="link-more">Reports <ArrowRight size={12} /></Link> : undefined} />
            {(d?.activity ?? []).length === 0 ? (
              <EmptyState icon={<CalendarClock size={19} />} title="Nothing recorded yet" message="Actions you take are logged here with the staff member and time." />
            ) : (
              <ul className="activity-list">
                {(d?.activity ?? []).map((a) => (
                  <li key={a.id}>
                    <span className="activity-icon">{activityIcon(a)}</span>
                    <div className="grow">
                      <div className="activity-text">{a.summary || a.action}</div>
                      <div className="tiny muted">{a.userName ?? 'System'} · {relTime(a.createdAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Quick actions" sub="Based on your role" />
            <div className="quick-grid">
              {quickActions.map((a) => (
                <button key={a.label} className="quick-action" onClick={() => navigate(a.to)}>
                  <span className="qa-icon"><a.icon size={16} /></span>
                  <span>
                    <b>{a.label}</b>
                    <small>{a.hint}</small>
                  </span>
                  <ArrowRight size={13} className="qa-arrow" />
                </button>
              ))}
              {quickActions.length === 0 && <p className="small muted">No actions available for your role.</p>}
            </div>
          </Card>
        </div>

        {/* Low stock strip */}
        {(d?.lowStock.length ?? 0) > 0 && (
          <Card className="low-stock-card">
            <CardHeader
              title="Low stock"
              sub={`${d?.lowStock.length} part${(d?.lowStock.length ?? 0) === 1 ? '' : 's'} at or below reorder level`}
              right={<Link to="/inventory?low=1" className="link-more">Review inventory <ArrowRight size={12} /></Link>}
            />
            <div className="low-stock-list">
              {(d?.lowStock ?? []).slice(0, 6).map((p) => (
                <div className="low-stock-item" key={p.id}>
                  <span className="grow">
                    <b>{p.name}</b>
                    <small className="mono">{p.sku}</small>
                  </span>
                  <Badge tone={p.qty <= 0 ? 'danger' : 'warning'}>{p.qty} on hand</Badge>
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="dash-footnote">
          <span><TrendingUp size={12} /> Every figure on this page is calculated from records saved in this browser.</span>
          <span><RotateCcw size={12} /> Averages and comparisons appear only when the period contains data.</span>
        </div>
      </div>
    </div>
  );
}

function activityIcon(a: AuditEvent) {
  if (a.action.startsWith('sale') || a.action.startsWith('invoice')) return <ReceiptIcon size={13} />;
  if (a.action.startsWith('job')) return <ClipboardList size={13} />;
  if (a.action.startsWith('purchase')) return <Truck size={13} />;
  if (a.action.startsWith('return')) return <RotateCcw size={13} />;
  if (a.action.startsWith('shift')) return <Wallet size={13} />;
  if (a.action.startsWith('stock') || a.action.startsWith('part')) return <Package size={13} />;
  if (a.action.startsWith('settings') || a.action.startsWith('backup')) return <SettingsIcon size={13} />;
  return <Sparkles size={13} />;
}
