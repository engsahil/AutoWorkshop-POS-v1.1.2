import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Boxes, Gauge, Percent, Receipt, TrendingUp, Users } from 'lucide-react';
import {
  PageHeader, Card, CardHeader, Loading, ErrorState, EmptyState, DateRangeBar, defaultRange, type DateRangeValue, Badge
} from '../components/ui';
import { LineChart, BarChart, DonutChart, CHART_COLORS } from '../components/charts';
import { useAsync } from '../hooks/useAsync';
import {
  rangeSummary, salesSeries, distribution, invoicesBetween, paymentsBetween, listJobs, lowStockParts, customersWithBalances
} from '../lib/queries';
import { dbAll } from '../lib/db';
import { useApp } from '../state/AppContext';
import { topItems, mechanicPerformance, trend, percent } from '../lib/analytics';
import { parseISODate, formatMoney, formatMoneyCompact } from '../lib/money';
import type { Invoice, User } from '../lib/types';

export default function Analytics() {
  const { settings } = useApp();
  const [range, setRange] = useState<DateRangeValue>(defaultRange('30d'));
  const from = parseISODate(range.from).getTime();
  const to = parseISODate(range.to).getTime() + 86399999;
  const spanDays = Math.max(1, Math.round((to - from) / 86400000));
  const gran = spanDays > 62 ? 'month' : 'day';

  const summary = useAsync(() => rangeSummary(from, to), [range.from, range.to]);
  const previous = useAsync(() => {
    const len = to - from;
    return rangeSummary(from - len, from);
  }, [range.from, range.to]);
  const series = useAsync(() => salesSeries(from, to, gran), [range.from, range.to, gran]);
  const mix = useAsync(() => distribution(from, to, 'revenue'), [range.from, range.to]);
  const invoices = useAsync(() => invoicesBetween(from, to), [range.from, range.to]);
  const payments = useAsync(() => paymentsBetween(from, to), [range.from, range.to]);
  const jobs = useAsync(() => listJobs({ page: 1, size: 500 }), []);
  const users = useAsync(() => dbAll<User>('users'), []);
  const lowStock = useAsync(() => lowStockParts(), []);
  const customers = useAsync(() => customersWithBalances(), []);
  const allInvoices = useAsync(() => dbAll<Invoice>('invoices'), []);

  const s = summary.data;
  const prev = previous.data;
  const mechanics = useMemo(() => {
    const jobRows = (jobs.data?.items ?? []) as unknown as import('../lib/types').JobCard[];
    return mechanicPerformance(jobRows, allInvoices.data ?? [], (users.data ?? []).map((u) => ({ id: u.id, name: u.name })));
  }, [jobs.data, allInvoices.data, users.data]);

  const topParts = useMemo(() => topItems(invoices.data ?? [], 'part', 5), [invoices.data]);
  const returnRate = s && s.netSalesPaisa > 0 ? Math.round((s.returnsNetPaisa / s.netSalesPaisa) * 1000) / 10 : 0;
  const aov = s && s.invoiceCount ? Math.round(s.invoiceTotalPaisa / s.invoiceCount) : 0;
  const receivables = (customers.data ?? []).reduce((a, c) => a + Math.max(0, c.balancePaisa), 0);
  const cashShare = s ? percent(s.byMethod.cash, s.collectedPaisa) : 0;
  const revenueTrend = s && prev ? trend(s.netRevenuePaisa, prev.netRevenuePaisa) : null;

  const methodSlices = s ? (['cash', 'card', 'bank', 'online'] as const).filter((m) => s.byMethod[m] > 0).map((m, i) => {
    const total = s.byMethod.cash + s.byMethod.card + s.byMethod.bank + s.byMethod.online;
    return { name: m === 'bank' ? 'Bank transfer' : m.charAt(0).toUpperCase() + m.slice(1), value: s.byMethod[m], percent: percent(s.byMethod[m], total), color: CHART_COLORS[i % CHART_COLORS.length] };
  }) : [];

  if (summary.loading && !s) return <div className="page"><PageHeader title="Analytics" /><Loading label="Crunching workshop numbers…" /></div>;
  if (summary.error) return <div className="page"><PageHeader title="Analytics" /><ErrorState message={summary.error} onRetry={summary.reload} /></div>;

  return (
    <div className="page">
      <PageHeader title="Analytics" subtitle="Revenue, margin and workshop throughput based on recorded transactions.">
        <DateRangeBar value={range} onChange={setRange} compact />
      </PageHeader>

      <div className="metrics" style={{ marginBottom: 14 }}>
        <div className="metric">
          <div className="m-top"><span className="m-label">Net revenue</span><span className="m-icon"><TrendingUp size={14} /></span></div>
          <div className="m-value"><span className="cur">{settings.profile.currency}</span>{formatMoneyCompact(s?.netRevenuePaisa ?? 0, '').replace(/^ /, '')}</div>
          <div className="m-sub">
            {revenueTrend != null && (
              <span className={`delta ${revenueTrend >= 0 ? 'up' : 'down'}`}>
                {revenueTrend >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}{Math.abs(revenueTrend)}%
              </span>
            )}
            <span>vs previous period · net of returns</span>
          </div>
        </div>
        <div className="metric">
          <div className="m-top"><span className="m-label">Gross profit</span><span className="m-icon"><Percent size={14} /></span></div>
          <div className="m-value"><span className="cur">{settings.profile.currency}</span>{formatMoneyCompact(s?.grossProfitPaisa ?? 0, '').replace(/^ /, '')}</div>
          <div className="m-sub"><span>net revenue − parts cost</span></div>
        </div>
        <div className="metric">
          <div className="m-top"><span className="m-label">Average invoice</span><span className="m-icon"><Receipt size={14} /></span></div>
          <div className="m-value"><span className="cur">{settings.profile.currency}</span>{formatMoneyCompact(aov, '').replace(/^ /, '')}</div>
          <div className="m-sub"><span>{s?.invoiceCount ?? 0} completed invoices</span></div>
        </div>
        <div className="metric">
          <div className="m-top"><span className="m-label">Return rate</span><span className="m-icon"><Gauge size={14} /></span></div>
          <div className="m-value">{returnRate}%</div>
          <div className="m-sub"><span>{formatMoney(s?.returnsNetPaisa ?? 0, { currency: settings.profile.currency, decimals: false })} credited</span></div>
        </div>
      </div>

      <div className="dash-row two">
        <Card>
          <div className="chart-head">
            <div><h3>Revenue trend</h3><div className="sub">{gran === 'day' ? 'Daily' : 'Monthly'} net revenue after returns</div></div>
            <Badge tone="neutral">{range.preset === 'custom' ? `${range.from} → ${range.to}` : range.preset}</Badge>
          </div>
          <div className="chart-card-body">
            <LineChart
              data={(series.data ?? []).map((b) => ({ label: b.label, value: b.netPaisa, meta: `${b.count} invoice${b.count === 1 ? '' : 's'}` }))}
              height={210}
              format={(v) => formatMoney(v, { currency: settings.profile.currency })}
              axisFormat={(v) => formatMoneyCompact(v, settings.profile.currency).replace(`${settings.profile.currency} `, '')}
            />
          </div>
        </Card>
        <Card>
          <div className="chart-head"><div><h3>Payment mix</h3><div className="sub">Collected in this period</div></div></div>
          <div className="donut-body">
            <DonutChart slices={methodSlices} size={156} thickness={21} centerLabel={`${cashShare}%`} centerSub="cash share" />
            <div className="donut-legend">
              {methodSlices.map((m) => (
                <div className="legend-item" key={m.name}>
                  <span className="swatch" style={{ background: m.color }} />
                  <span>{m.name}</span>
                  <span className="val">{m.percent}%</span>
                </div>
              ))}
              {methodSlices.length === 0 && <span className="small muted">No payments recorded in this period.</span>}
            </div>
          </div>
        </Card>
      </div>

      <div className="dash-row tables" style={{ marginTop: 14 }}>
        <Card>
          <div className="chart-head"><div><h3>Monthly sales</h3><div className="sub">Completed invoice value by month</div></div></div>
          <div className="chart-card-body">
            <BarChart
              data={(series.data ?? []).map((b) => ({ label: b.label, value: b.salesPaisa }))}
              height={190}
              format={(v) => formatMoney(v, { currency: settings.profile.currency })}
              axisFormat={(v) => formatMoneyCompact(v, settings.profile.currency).replace(`${settings.profile.currency} `, '')}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Service mix" sub="Revenue share by service category" />
          <div className="donut-body">
            <DonutChart
              slices={(mix.data ?? []).slice(0, 5).map((m, i) => ({ ...m, color: CHART_COLORS[i % CHART_COLORS.length] }))}
              size={148}
              thickness={20}
            />
            <div className="donut-legend">
              {(mix.data ?? []).slice(0, 5).map((m, i) => (
                <div className="legend-item" key={m.name}>
                  <span className="swatch" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="truncate" style={{ maxWidth: 110 }}>{m.name}</span>
                  <span className="val">{m.percent}%</span>
                </div>
              ))}
              {(mix.data ?? []).length === 0 && <span className="small muted">No services billed yet.</span>}
            </div>
          </div>
        </Card>
      </div>

      <div className="dash-row bottom" style={{ marginTop: 14 }}>
        <Card>
          <CardHeader title="Top parts" sub="By revenue in the selected range" />
          {(topParts.length === 0) ? <EmptyState title="No part sales in range" /> : (
            <div className="table-wrap">
              <table className="table compact">
                <thead><tr><th>Part</th><th className="num">Qty</th><th className="num">Revenue</th></tr></thead>
                <tbody>
                  {topParts.map((p) => (
                    <tr key={p.name}><td className="truncate" style={{ maxWidth: 240 }}>{p.name}</td><td className="num">{p.qty}</td><td className="num">{formatMoney(p.revenuePaisa, { currency: settings.profile.currency, decimals: false })}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Alerts" sub="Operational signals from live data" />
          <div className="section-pad flex-col gap-10">
            <div className="mini-row"><span className="t flex items-center gap-6"><Boxes size={13} /> Low stock SKUs</span><span className="v">{lowStock.data?.length ?? 0}</span></div>
            <div className="mini-row"><span className="t flex items-center gap-6"><Users size={13} /> Outstanding receivables</span><span className="v mono">{formatMoney(receivables, { currency: settings.profile.currency, decimals: false })}</span></div>
            <div className="mini-row"><span className="t">Parts cost (COGS)</span><span className="v mono">{formatMoney(s?.cogsPaisa ?? 0, { currency: settings.profile.currency, decimals: false })}</span></div>
            <div className="mini-row"><span className="t">Refunds issued</span><span className="v mono">{formatMoney(s?.refundsPaisa ?? 0, { currency: settings.profile.currency, decimals: false })}</span></div>
            <div className="mini-row"><span className="t">Receipts issued</span><span className="v">{payments.data?.filter((p) => p.kind === 'sale' && !p.voided).length ?? 0}</span></div>
          </div>
        </Card>
      </div>

      <Card style={{ marginTop: 14 }}>
        <CardHeader title="Mechanic performance" sub="Completed jobs, billed value and turnaround" />
        {mechanics.length === 0 ? <EmptyState title="No mechanic assignments yet" message="Assign mechanics to job cards to build performance history." /> : (
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Mechanic</th><th className="num">Completed</th><th className="num">Billed</th><th className="num">Avg turnaround</th></tr></thead>
              <tbody>
                {mechanics.map((m) => (
                  <tr key={m.id}><td>{m.name}</td><td className="num">{m.completed}</td><td className="num">{formatMoney(m.billedPaisa, { currency: settings.profile.currency, decimals: false })}</td><td className="num">{m.avgTurnaroundHours ? `${m.avgTurnaroundHours} h` : '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
