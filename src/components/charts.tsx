import { useEffect, useMemo, useRef, useState } from 'react';

export const CHART_COLORS = ['#875B3E', '#B99A78', '#68452F', '#A77E5C', '#D6C1A8', '#4A3223', '#8C6A4F', '#C9AE90'];

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && Math.abs(w - width) > 1) setWidth(w);
    });
    ro.observe(el);
    setWidth(el.clientWidth || 560);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { ref, width };
}

function niceMax(value: number): number {
  if (value <= 0) return 100;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const norm = value / base;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * base;
}

function smoothPath(pts: { x: number; y: number }[]): string {
  if (!pts.length) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.16;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export interface ChartPoint { label: string; value: number; meta?: string }

export function LineChart({
  data, height = 196, color = '#875B3E', format = (v: number) => String(v), axisFormat, yTicks = 4, emptyMessage
}: {
  data: ChartPoint[]; height?: number; color?: string; format?: (v: number) => string; axisFormat?: (v: number) => string; yTicks?: number; emptyMessage?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 46, r: 12, t: 12, b: 24 };
  const innerW = Math.max(40, width - pad.l - pad.r);
  const innerH = Math.max(40, height - pad.t - pad.b);
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const hasData = data.some((d) => d.value > 0);
  const pts = data.map((d, i) => ({
    x: pad.l + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW),
    y: pad.t + innerH - (d.value / max) * innerH
  }));
  const path = smoothPath(pts);
  const areaPath = pts.length ? `${path} L ${pts[pts.length - 1].x} ${pad.t + innerH} L ${pts[0].x} ${pad.t + innerH} Z` : '';
  const labels = data.length <= 8 ? data : data.filter((_, i) => i % Math.ceil(data.length / 7) === 0 || i === data.length - 1);
  const stepX = labels.length > 1 ? innerW / (data.length - 1) : 0;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - pad.l;
    const idx = Math.round((x / innerW) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, idx)));
  };

  return (
    <div className="chart-wrap" ref={ref} style={{ height }}>
      {!hasData ? (
        <div className="chart-empty" style={{ height }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#B99A78" strokeWidth="1.6" aria-hidden="true">
            <path d="M3 17 9 11l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 21h18" strokeLinecap="round" />
          </svg>
          <span>{emptyMessage ?? 'No sales recorded for this period yet.'}</span>
        </div>
      ) : (
        <svg
          height={height}
          role="img"
          aria-label={`Line chart with ${data.length} points, maximum ${format(max)}`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`area-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {Array.from({ length: yTicks + 1 }).map((_, i) => {
            const y = pad.t + (i / yTicks) * innerH;
            const value = max - (i / yTicks) * max;
            return (
              <g key={i}>
                <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke="#EDE6DB" strokeWidth="1" strokeDasharray={i === yTicks ? '0' : '3 4'} />
                <text x={pad.l - 8} y={y + 3.5} textAnchor="end" fontSize="9.5" fill="#948A80" fontFamily="IBM Plex Mono, monospace">
                  {(axisFormat ?? format)(value)}
                </text>
              </g>
            );
          })}
          <path d={areaPath} fill={`url(#area-${color.replace('#', '')})`} />
          <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {labels.map((d) => {
            const idx = data.indexOf(d);
            return (
              <text
                key={`${d.label}-${idx}`}
                x={pad.l + (data.length === 1 ? innerW / 2 : (idx / (data.length - 1)) * innerW)}
                y={height - 6}
                textAnchor="middle"
                fontSize="9.5"
                fill="#948A80"
                fontFamily="Manrope, sans-serif"
              >
                {d.label}
              </text>
            );
          })}
          {hover != null && pts[hover] && (
            <g>
              <line x1={pts[hover].x} x2={pts[hover].x} y1={pad.t} y2={pad.t + innerH} stroke="#C6B29A" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={pts[hover].x} cy={pts[hover].y} r="4" fill="#fff" stroke={color} strokeWidth="2" />
            </g>
          )}
          <rect x={pad.l} y={pad.t} width={innerW} height={innerH} fill="transparent" />
        </svg>
      )}
      {hover != null && data[hover] && (
        <div className="chart-tooltip" style={{ left: pad.l + hover * (stepX || 0), top: Math.max(12, pts[hover]?.y ?? 0) }}>
          <div style={{ color: '#D6C1A8', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.06em' }}>{data[hover].label}</div>
          <div className="mono" style={{ fontSize: 12 }}>{format(data[hover].value)}</div>
          {data[hover].meta && <div style={{ color: '#C6B5A2', fontSize: 10 }}>{data[hover].meta}</div>}
        </div>
      )}
    </div>
  );
}

export function BarChart({
  data, height = 200, format = (v: number) => String(v), axisFormat, emptyMessage, color = '#68452F'
}: {
  data: ChartPoint[]; height?: number; format?: (v: number) => string; axisFormat?: (v: number) => string; emptyMessage?: string; color?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 46, r: 10, t: 12, b: 24 };
  const innerW = Math.max(40, width - pad.l - pad.r);
  const innerH = Math.max(40, height - pad.t - pad.b);
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const hasData = data.some((d) => d.value > 0);
  const band = innerW / Math.max(1, data.length);
  const barW = Math.max(6, Math.min(26, band * 0.52));

  return (
    <div className="chart-wrap" ref={ref} style={{ height }}>
      {!hasData ? (
        <div className="chart-empty" style={{ height }}>
          <span>{emptyMessage ?? 'No data for this period yet.'}</span>
        </div>
      ) : (
        <svg height={height} role="img" aria-label={`Bar chart with ${data.length} periods`}>
          {Array.from({ length: 5 }).map((_, i) => {
            const y = pad.t + (i / 4) * innerH;
            return (
              <g key={i}>
                <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke="#EDE6DB" strokeDasharray={i === 4 ? '0' : '3 4'} />
                <text x={pad.l - 8} y={y + 3.5} textAnchor="end" fontSize="9.5" fill="#948A80" fontFamily="IBM Plex Mono, monospace">
        {(axisFormat ?? format)(max - (i / 4) * max)}
                </text>
              </g>
            );
          })}
          {data.map((d, i) => {
            const h = Math.max(d.value > 0 ? 3 : 0, (d.value / max) * innerH);
            const x = pad.l + band * i + (band - barW) / 2;
            const y = pad.t + innerH - h;
            // Thin out tick labels so long month names never collide.
            const labelEvery = Math.max(1, Math.ceil((Math.max(...data.map((p) => p.label.length)) * 5.4 + 10) / band));
            const showLabel = i % labelEvery === 0;
            return (
              <g key={`${d.label}-${i}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={pad.l + band * i} y={pad.t} width={band} height={innerH} fill="transparent" />
                <rect
                  x={x} y={y} width={barW} height={h}
                  rx={Math.min(3, barW / 3)}
                  fill={hover === i ? '#38271D' : color}
                  opacity={d.value > 0 ? 1 : 0.15}
                />
                {showLabel && (
                  <text x={pad.l + band * i + band / 2} y={height - 6} textAnchor="middle" fontSize="9.5" fill="#948A80" fontFamily="Manrope, sans-serif">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover != null && data[hover] && (
        <div className="chart-tooltip" style={{ left: pad.l + band * hover + band / 2, top: Math.max(14, pad.t + innerH - (data[hover].value / max) * innerH - 8) }}>
          <div style={{ color: '#D6C1A8', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.06em' }}>{data[hover].label}</div>
          <div className="mono" style={{ fontSize: 12 }}>{format(data[hover].value)}</div>
        </div>
      )}
    </div>
  );
}

export interface DonutSlice { name: string; value: number; percent: number; color?: string }

export function DonutChart({
  slices, size = 164, thickness = 22, centerLabel, centerSub
}: { slices: DonutSlice[]; size?: number; thickness?: number; centerLabel?: string; centerSub?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  const top = slices[0];
  if (!total) {
    return (
      <div className="chart-empty" style={{ height: size, width: size }}>
        <span style={{ maxWidth: 120, lineHeight: 1.5 }}>No services billed in this period.</span>
      </div>
    );
  }
  let offset = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Donut chart: ${slices.map((s) => `${s.name} ${s.percent}%`).join(', ')}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F1EAE0" strokeWidth={thickness} />
        {slices.map((s, i) => {
          const frac = s.value / total;
          const dash = frac * circ;
          const el = (
            <circle
              key={s.name}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={hover === i ? thickness + 4 : thickness}
              strokeDasharray={`${Math.max(0, dash - 2)} ${circ - dash + 2}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              strokeLinecap="butt"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ transition: 'stroke-width .15s ease', cursor: 'default' }}
            >
              <title>{`${s.name}: ${s.percent}%`}</title>
            </circle>
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div className="mono" style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-.04em' }}>
          {hover != null ? `${slices[hover].percent}%` : centerLabel ?? `${top?.percent ?? 0}%`}
        </div>
        <div style={{ fontSize: 9.5, color: 'var(--muted)', maxWidth: 80, textAlign: 'center', lineHeight: 1.35 }}>
          {hover != null ? slices[hover].name : centerSub ?? 'Top share'}
        </div>
      </div>
    </div>
  );
}

export function Sparkline({ values, color = '#875B3E', width = 74, height = 24 }: { values: number[]; color?: string; width?: number; height?: number }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => ({
    x: (i / Math.max(1, values.length - 1)) * width,
    y: height - ((v - min) / Math.max(1, max - min)) * height
  }));
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ overflow: 'visible' }}>
      <path d={smoothPath(pts)} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
