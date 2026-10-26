export function BrandGlyph({ size = 30, tone = 'dark' }: { size?: number; tone?: 'dark' | 'light' | 'plain' }) {
  const bg = tone === 'dark' ? '#38271D' : tone === 'light' ? '#F6F1E9' : 'transparent';
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" style={{ flex: 'none', display: 'block' }}>
      <rect width="40" height="40" rx="10" fill={bg} />
      <path
        d="M11.5 26.2c0-3.1 2.6-4.3 6.3-5.3 3.3-.9 5-1.8 5-3.6"
        stroke={tone === 'light' ? '#68452F' : '#B99A78'}
        strokeWidth="3.1"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M28.5 13.8c0 3.1-2.6 4.3-6.3 5.3-3.3.9-5 1.8-5 3.6"
        stroke={tone === 'light' ? '#38271D' : '#F6F1E9'}
        strokeWidth="3.1"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="29.4" cy="27.2" r="2" fill="#875B3E" />
    </svg>
  );
}

export function BrandLockup({ name, light, size = 30, subtitle = 'Workshop POS' }: {
  name: string; light?: boolean; size?: number; subtitle?: string;
}) {
  return (
    <>
      <BrandGlyph size={size} tone={light ? 'light' : 'dark'} />
      <span className="wordmark">
        <b
          title={name}
          style={{
            color: light ? 'var(--brown-800)' : '#fff',
            maxWidth: 158, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}
        >
          {name}
        </b>
        <span>{subtitle}</span>
      </span>
    </>
  );
}
