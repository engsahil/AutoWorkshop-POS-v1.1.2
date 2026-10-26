import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { BrandGlyph } from './Brand';
import { APP_VERSION } from '../lib/types';
import { useApp } from '../state/AppContext';

/**
 * Shared layout for the two fixed policy documents (Privacy & Terms, Help & Guide).
 * These pages are intentionally not editable from Settings: they describe what the
 * software actually does, so the text ships with the build.
 */
export function LegalShell({ title, kicker, updated, children }: {
  title: string;
  kicker: string;
  updated: string;
  children: ReactNode;
}) {
  const { settings } = useApp();
  const bizName = settings.profile.name || 'Your workshop';
  return (
    <div className="legal-shell">
      <header className="legal-bar">
        <div className="legal-bar-inner">
          <BrandGlyph size={30} tone="light" />
          <div>
            <div className="legal-wordmark" title={bizName}>{bizName}</div>
            <div className="legal-sub">Workshop management</div>
          </div>
          <div className="grow" />
          <Link to="/" className="btn btn-ghost btn-xs legal-back">
            <ArrowLeft size={13} /> Back to app
          </Link>
          <button className="btn btn-secondary btn-xs" onClick={() => window.print()}>
            <Printer size={13} /> Print
          </button>
        </div>
      </header>

      <main className="legal-main">
        <div className="legal-head">
          <div className="legal-kicker">{kicker}</div>
          <h1 className="legal-title">{title}</h1>
          <div className="legal-meta">
            <span>Reference copy</span>
            <span className="legal-dot" />
            <span>Fixed document — not editable from Settings</span>
            <span className="legal-dot" />
            <span>{updated}</span>
          </div>
        </div>

        <div className="legal-paper">{children}</div>

        <footer className="legal-foot">
          <span className="legal-foot-brand">
            <BrandGlyph size={18} tone="dark" /> {bizName}
          </span>
          <span>Version {APP_VERSION} · Runs entirely in this browser</span>
        </footer>
      </main>
    </div>
  );
}

export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="legal-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
