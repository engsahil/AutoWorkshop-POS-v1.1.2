import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Building2, CheckCircle2, Database, Download, FileArchive, FileText, HardDrive, Image as ImageIcon,
  Info, Lock, RotateCcw, Save, ShieldCheck, Upload, Volume2, Bell, Palette
} from 'lucide-react';
import {
  PageHeader, Card, Button, Field, Input, Select, Textarea, Switch, Checkbox, Tabs, Badge,
  ConfirmDialog, Alert, Loading, PasswordField
} from '../components/ui';
import { useApp } from '../state/AppContext';
import { BrandGlyph } from '../components/Brand';
import { APP_VERSION, type AppSettings } from '../lib/types';
import {
  exportBackup, downloadBlob, parseBackupFile, importBackup, factoryReset, storageInfo, integrityReport,
  type ValidationResult
} from '../lib/backup';
import { loadDemoData, clearAllBusinessData, demoDataExists } from '../lib/demo';
import {
  buildDataArchive, parseDataArchive, planRestore, applyRestore, readCurrentIndex,
  type ParsedArchive, type RestorePlan, type RestoreMode
} from '../lib/dataArchive';
import { fileToDataUrl, DEFAULT_LOGIN_ART } from '../lib/assets';
import { fmtDateTime, formatBytes } from '../lib/money';
import { bump } from '../lib/bus';

type Tab = 'business' | 'documents' | 'appearance' | 'security' | 'notifications' | 'data';

export default function Settings() {
  const { settings, user, saveAppSettings, can, toast, notifySound, alertSound, refresh } = useApp();
  const [tab, setTab] = useState<Tab>('business');
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const heroRef = useRef<HTMLInputElement>(null);
  const loginRef = useRef<HTMLInputElement>(null);
  const [artBusy, setArtBusy] = useState<string | null>(null);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings]);
  const readOnly = !can('settings.manage');

  const set = <K extends 'profile' | 'documents' | 'security' | 'notifications' | 'loginCopy' | 'attachments'>(
    section: K,
    patch: Partial<AppSettings[K]>
  ) => {
    setDraft((d) => ({
      ...d,
      [section]: { ...(d[section] as Record<string, unknown>), ...(patch as Record<string, unknown>) }
    }) as AppSettings);
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveAppSettings(draft);
      toast('Settings saved.');
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const pickArt = async (kind: 'logo' | 'hero' | 'login', file: File) => {
    setArtBusy(kind);
    try {
      const url = kind === 'logo'
        ? await fileToDataUrl(file, { maxEdge: 512, preserveAlpha: true })
        : await fileToDataUrl(file, { maxEdge: 1920, quality: 0.82 });
      const attachments = {
        ...draft.attachments,
        ...(kind === 'logo' ? { logo: url } : kind === 'hero' ? { heroArt: url } : { loginArt: url })
      };
      setDraft({ ...draft, attachments });
      await saveAppSettings({ ...draft, attachments });
      toast(`${kind === 'logo' ? 'Logo' : kind === 'hero' ? 'Hero image' : 'Login artwork'} updated.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to use that image', 'error');
    } finally {
      setArtBusy(null);
    }
  };

  if (readOnly) {
    return (
      <div className="page">
        <PageHeader title="Settings" />
        <Card><Alert tone="info" title="Read-only">Your role can view settings but not change them. Ask an administrator for access.</Alert></Card>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="Settings">
        <Button variant="primary" icon={<Save size={14} />} onClick={save} loading={saving} disabled={!dirty}>Save changes</Button>
      </PageHeader>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'business', label: 'Business' },
          { id: 'documents', label: 'Documents' },
          { id: 'appearance', label: 'Appearance' },
          { id: 'security', label: 'Users & security' },
          { id: 'notifications', label: 'Notifications' },
          { id: 'data', label: 'Data management' }
        ]}
      />

      {tab === 'business' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <Card>
            <div className="card-header"><h3><Building2 size={15} className="inline" /> Workshop profile</h3></div>
            <div className="card-body form-grid">
              <Field label="Business name" required className="span-2">
                <Input value={draft.profile.name} onChange={(e) => set('profile', { name: e.target.value })} />
              </Field>
              <Field label="Legal / registered name" className="span-2">
                <Input value={draft.profile.legalName ?? ''} onChange={(e) => set('profile', { legalName: e.target.value })} />
              </Field>
              <Field label="Phone"><Input value={draft.profile.phone ?? ''} onChange={(e) => set('profile', { phone: e.target.value })} /></Field>
              <Field label="Email"><Input value={draft.profile.email ?? ''} onChange={(e) => set('profile', { email: e.target.value })} /></Field>
              <Field label="Address" className="span-2">
                <Textarea value={draft.profile.address ?? ''} onChange={(e) => set('profile', { address: e.target.value })} style={{ minHeight: 62 }} />
              </Field>
              <Field label="NTN / tax number"><Input value={draft.profile.taxNumber ?? ''} onChange={(e) => set('profile', { taxNumber: e.target.value })} /></Field>
              <Field label="Registration number"><Input value={draft.profile.regNumber ?? ''} onChange={(e) => set('profile', { regNumber: e.target.value })} /></Field>
              <Field label="Workshop hours"><Input value={draft.profile.hours ?? ''} onChange={(e) => set('profile', { hours: e.target.value })} placeholder="Mon–Sat · 9:00 – 19:00" /></Field>
              <Field label="Timezone">
                <Select value={draft.profile.timezone} onChange={(e) => set('profile', { timezone: e.target.value })}>
                  {['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Europe/London', 'UTC'].map((z) => <option key={z} value={z}>{z}</option>)}
                </Select>
              </Field>
              <Field label="Currency" hint="Three-letter code or symbol used across the app.">
                <Input value={draft.profile.currency} onChange={(e) => set('profile', { currency: e.target.value })} maxLength={6} />
              </Field>
              <Field label="Locale">
                <Select value={draft.profile.locale} onChange={(e) => set('profile', { locale: e.target.value })}>
                  {['en-PK', 'en-IN', 'en-AE', 'en-GB', 'en-US'].map((l) => <option key={l} value={l}>{l}</option>)}
                </Select>
              </Field>
            </div>
          </Card>
          <div className="flex-col gap-14">
            <Card>
              <div className="card-header"><h3>Login screen copy</h3></div>
              <div className="card-body form-grid">
                <Field label="Heading" className="span-2"><Input value={draft.loginCopy.heading} onChange={(e) => setDraft({ ...draft, loginCopy: { ...draft.loginCopy, heading: e.target.value } })} /></Field>
                <Field label="Subtitle" className="span-2"><Input value={draft.loginCopy.subtitle} onChange={(e) => setDraft({ ...draft, loginCopy: { ...draft.loginCopy, subtitle: e.target.value } })} /></Field>
                <Field label="Tagline" className="span-2"><Input value={draft.loginCopy.tagline} onChange={(e) => setDraft({ ...draft, loginCopy: { ...draft.loginCopy, tagline: e.target.value } })} /></Field>
              </div>
            </Card>
            <Card>
              <div className="card-header"><h3>Fixed policy pages</h3></div>
              <div className="card-body small flex-col gap-8" style={{ color: 'var(--text-soft)' }}>
                <p>Privacy &amp; Terms and Help &amp; Guide are maintained with the app and cannot be edited here, so published policy text cannot drift from what the software actually does.</p>
                <div className="flex gap-8"><Link to="/privacy" className="btn btn-ghost btn-xs">Open Privacy &amp; Terms</Link><Link to="/help" className="btn btn-ghost btn-xs">Open Help &amp; Guide</Link></div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'documents' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <Card>
            <div className="card-header"><h3><FileText size={15} className="inline" /> Numbering</h3></div>
            <div className="card-body form-grid">
              <Field label="Invoice prefix"><Input value={draft.documents.invoicePrefix} onChange={(e) => set('documents', { invoicePrefix: e.target.value })} /></Field>
              <Field label="Invoice padding" hint="Digits after the prefix (e.g. 6 → 000001).">
                <Input type="number" min={1} max={10} value={draft.documents.invoicePadding} onChange={(e) => set('documents', { invoicePadding: Number(e.target.value) })} />
              </Field>
              <Field label="Job card prefix"><Input value={draft.documents.jobPrefix} onChange={(e) => set('documents', { jobPrefix: e.target.value })} /></Field>
              <Field label="Purchase prefix"><Input value={draft.documents.purchasePrefix} onChange={(e) => set('documents', { purchasePrefix: e.target.value })} /></Field>
              <Field label="Return prefix"><Input value={draft.documents.returnPrefix} onChange={(e) => set('documents', { returnPrefix: e.target.value })} /></Field>
              <Field label="Shift prefix"><Input value={draft.documents.shiftPrefix} onChange={(e) => set('documents', { shiftPrefix: e.target.value })} /></Field>
              <Field label="Warranty prefix"><Input value={draft.documents.warrantyPrefix} onChange={(e) => set('documents', { warrantyPrefix: e.target.value })} /></Field>
              <Field label="Receipt width">
                <Select value={draft.documents.receiptWidth} onChange={(e) => set('documents', { receiptWidth: e.target.value as '58' | '80' | 'a4' })}>
                  <option value="58">58 mm thermal</option>
                  <option value="80">80 mm thermal</option>
                  <option value="a4">A4 sheet</option>
                </Select>
              </Field>
              <Field label="Receipt footer note" className="span-2">
                <Textarea value={draft.documents.footerNote} onChange={(e) => set('documents', { footerNote: e.target.value })} style={{ minHeight: 58 }} />
              </Field>
            </div>
          </Card>
          <Card>
            <div className="card-header"><h3>Sales rules</h3></div>
            <div className="card-body flex-col gap-14">
              <Field label="Default tax rate (%)"><Input type="number" min={0} max={100} step="0.01" value={draft.documents.defaultTaxRate} onChange={(e) => set('documents', { defaultTaxRate: Number(e.target.value) })} /></Field>
              <Switch label="Allow invoice discounts" checked={draft.documents.allowDiscounts} onChange={(v) => set('documents', { allowDiscounts: v })} />
              <Field label="Maximum discount (%)" hint="Checked again inside the sale transaction.">
                <Input type="number" min={0} max={100} value={draft.documents.maxDiscountPercent} onChange={(e) => set('documents', { maxDiscountPercent: Number(e.target.value) })} disabled={!draft.documents.allowDiscounts} />
              </Field>
              <Switch label="Allow selling below available stock" checked={draft.documents.negativeStock} onChange={(v) => set('documents', { negativeStock: v })} />
              <Switch label="Deduct stock when a job card is completed" checked={draft.documents.deductStockOnJobComplete} onChange={(v) => set('documents', { deductStockOnJobComplete: v })} />
              <Field label="Payment methods offered at POS" hint="Cash is always required for shift reconciliation.">
                <div className="flex gap-14 wrap" style={{ paddingTop: 4 }}>
                  {(['cash', 'card', 'bank', 'online'] as const).map((m) => (
                    <Checkbox
                      key={m}
                      label={m.charAt(0).toUpperCase() + m.slice(1)}
                      checked={draft.documents.paymentMethods.includes(m)}
                      disabled={m === 'cash'}
                      onChange={(v) => set('documents', {
                        paymentMethods: v
                          ? Array.from(new Set([...draft.documents.paymentMethods, m]))
                          : draft.documents.paymentMethods.filter((x) => x !== m)
                      })}
                    />
                  ))}
                </div>
              </Field>
              <Checkbox label="Show logo on receipts" checked={draft.documents.showLogoOnReceipt} onChange={(v) => set('documents', { showLogoOnReceipt: v })} />
              {dirty && <Alert tone="info" title="Unsaved changes">Use “Save changes” at the top to persist document settings.</Alert>}
            </div>
          </Card>
        </div>
      )}

      {tab === 'appearance' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <Card>
            <div className="card-header"><h3><ImageIcon size={15} className="inline" /> Brand artwork</h3></div>
            <div className="card-body flex-col gap-16">
              <ArtRow
                label="Workshop logo"
                hint="Shown in the sidebar, login and printed documents. PNG with transparency recommended."
                preview={draft.attachments.logo ?? null}
                fallbackText="No logo — the app glyph is used"
                busy={artBusy === 'logo'}
                onPick={() => logoRef.current?.click()}
                onReset={() => { setDraft({ ...draft, attachments: { ...draft.attachments, logo: null } }); }}
              />
              <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pickArt('logo', f); e.target.value = ''; }} />
              <ArtRow
                label="Dashboard artwork (optional)"
                hint="Adds a wide photograph behind the dashboard summary strip. Leave empty for the plain dark panel. 1600 × 600 works well."
                preview={draft.attachments.heroArt ?? null}
                fallbackText="No artwork — plain panel"
                busy={artBusy === 'hero'}
                onPick={() => heroRef.current?.click()}
                onReset={() => { setDraft({ ...draft, attachments: { ...draft.attachments, heroArt: null } }); }}
              />
              <input ref={heroRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pickArt('hero', f); e.target.value = ''; }} />
              <ArtRow
                label="Login artwork"
                hint="Illustration on the split login screen. Portrait or square crops look best."
                preview={draft.attachments.loginArt ?? null}
                fallbackText="Using the bundled illustration"
                busy={artBusy === 'login'}
                onPick={() => loginRef.current?.click()}
                onReset={() => { setDraft({ ...draft, attachments: { ...draft.attachments, loginArt: null } }); }}
              />
              <input ref={loginRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pickArt('login', f); e.target.value = ''; }} />
              <div className="alert alert-info"><Info size={14} /><span>Uploads are resized and stored inside this browser, so they travel with backups. Defaults are restored by choosing “Use default”.</span></div>
            </div>
          </Card>
          <Card>
            <div className="card-header"><h3><Palette size={15} className="inline" /> Interface</h3></div>
            <div className="card-body flex-col gap-14 small" style={{ color: 'var(--text-soft)' }}>
              <p>The palette is fixed so documents, receipts and screens stay consistent: warm cream surfaces, dark-brown navigation and bronze accents.</p>
              <div className="flex gap-8 wrap">
                {[['#38271D', 'Topbar'], ['#68452F', 'Sidebar'], ['#875B3E', 'Accent'], ['#B99A78', 'Bronze'], ['#F6F1E9', 'Cream'], ['#FFFEFC', 'Card']].map(([hex, name]) => (
                  <div key={hex} className="swatch-chip" title={`${name} ${hex}`}>
                    <span style={{ background: hex }} /><small>{name}</small>
                  </div>
                ))}
              </div>
              <p className="muted">Table density follows each user’s preference in the profile drawer.</p>
            </div>
          </Card>
        </div>
      )}

      {tab === 'security' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <Card>
            <div className="card-header"><h3><Lock size={15} className="inline" /> Authentication policy</h3></div>
            <div className="card-body form-grid">
              <Field label="Minimum password length"><Input type="number" min={6} max={64} value={draft.security.minPasswordLength} onChange={(e) => set('security', { minPasswordLength: Number(e.target.value) })} /></Field>
              <Field label="Session length (hours)"><Input type="number" min={1} max={72} value={draft.security.sessionHours} onChange={(e) => set('security', { sessionHours: Number(e.target.value) })} /></Field>
              <Field label="Lock after failed attempts" hint="0 disables temporary lockout."><Input type="number" min={0} max={20} value={draft.security.lockAfterFailures} onChange={(e) => set('security', { lockAfterFailures: Number(e.target.value) })} /></Field>
              <div className="flex-col gap-10" style={{ paddingTop: 22 }}>
                <Checkbox label="Require an uppercase letter" checked={draft.security.requireUppercase} onChange={(v) => set('security', { requireUppercase: v })} />
                <Checkbox label="Require a number" checked={draft.security.requireNumber} onChange={(v) => set('security', { requireNumber: v })} />
              </div>
            </div>
          </Card>
          <div className="flex-col gap-14">
            <Card>
              <div className="card-header"><h3>Accounts</h3></div>
              <div className="card-body small flex-col gap-10" style={{ color: 'var(--text-soft)' }}>
                <p>Create staff accounts, assign roles and reset passwords in Users &amp; Roles.</p>
                <Link to="/users" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>Open Users &amp; Roles</Link>
              </div>
            </Card>
            <Alert tone="warning" title="Security scope — be aware">
              This workspace runs entirely in this browser. Passwords are stored as PBKDF2-derived hashes with per-user salts, never in plain text, and password hashes are excluded from backups. Anyone with access to this device profile and developer tools can still read the local database, so treat device access as the real security boundary.
            </Alert>
          </div>
        </div>
      )}

      {tab === 'notifications' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <Card>
            <div className="card-header"><h3><Bell size={15} className="inline" /> In-app alerts</h3></div>
            <div className="card-body flex-col gap-14">
              <Switch label="Play notification sounds" checked={draft.notifications.soundEnabled} onChange={(v) => set('notifications', { soundEnabled: v })} />
              <Field label={`Volume — ${draft.notifications.volume}%`}>
                <input
                  type="range" min={0} max={100} step={5} value={draft.notifications.volume}
                  onChange={(e) => set('notifications', { volume: Number(e.target.value) })}
                  disabled={!draft.notifications.soundEnabled}
                  style={{ width: '100%', accentColor: 'var(--bronze-500)' }}
                  aria-label="Notification volume"
                />
              </Field>
              <div className="flex gap-8">
                <Button size="sm" variant="secondary" icon={<Volume2 size={13} />} onClick={notifySound} disabled={!draft.notifications.soundEnabled}>Test chime</Button>
                <Button size="sm" variant="secondary" onClick={alertSound} disabled={!draft.notifications.soundEnabled}>Test alert</Button>
              </div>
              <div className="divider" />
              <div className="label">Notify me about</div>
              <Checkbox label="Low stock and reorder points" checked={draft.notifications.lowStock} onChange={(v) => set('notifications', { lowStock: v })} />
              <Checkbox label="Each completed sale" checked={draft.notifications.sales} onChange={(v) => set('notifications', { sales: v })} />
              <Checkbox label="Job card status changes" checked={draft.notifications.jobs} onChange={(v) => set('notifications', { jobs: v })} />
              <Checkbox label="Warranty expiry (within 30 days)" checked={draft.notifications.warranty} onChange={(v) => set('notifications', { warranty: v })} />
              <Checkbox label="Shift opened / closed and variance" checked={draft.notifications.shift} onChange={(v) => set('notifications', { shift: v })} />
            </div>
          </Card>
          <Card>
            <div className="card-header"><h3>How notifications work</h3></div>
            <div className="card-body small flex-col gap-10" style={{ color: 'var(--text-soft)' }}>
              <p>Notifications are generated from real records — stock movements, invoices, job card transitions and warranty expiry. Nothing is pre-seeded, and the bell only shows events this workshop actually produced.</p>
              <p>No email, SMS or push messages are sent. The tone is generated locally through the Web Audio API, so it works offline and no external audio file is fetched.</p>
              <p>Use the bell in the top bar to review and mark notifications read.</p>
            </div>
          </Card>
        </div>
      )}

      {tab === 'data' && <DataTab />}
    </div>
  );
}

function ArtRow({ label, hint, preview, fallbackText, busy, onPick, onReset }: {
  label: string; hint: string; preview: string | null; fallbackText: string; busy: boolean;
  onPick: () => void; onReset: () => void;
}) {
  return (
    <div className="art-row">
      <div className="art-preview">
        {preview ? <img src={preview} alt={`${label} preview`} /> : <span className="tiny muted center">{fallbackText}</span>}
      </div>
      <div className="grow">
        <div style={{ fontWeight: 650, fontSize: 13 }}>{label}</div>
        <div className="tiny muted" style={{ marginTop: 3, lineHeight: 1.5 }}>{hint}</div>
        <div className="flex gap-8" style={{ marginTop: 8 }}>
          <Button size="sm" variant="secondary" icon={<Upload size={12} />} onClick={onPick} loading={busy}>Upload</Button>
          {preview && <Button size="sm" variant="ghost" onClick={onReset}>Use default</Button>}
        </div>
      </div>
    </div>
  );
}

function DataTab() {
  const { settings, user, toast, refresh } = useApp();
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [adminId, setAdminId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [report, setReport] = useState<{ level: string; message: string }[] | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [demoExists, setDemoExists] = useState<boolean | null>(null);
  const [archive, setArchive] = useState<ParsedArchive | null>(null);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [archiveAdminId, setArchiveAdminId] = useState('');
  const [archivePassword, setArchivePassword] = useState('');
  const [archiveConfirm, setArchiveConfirm] = useState('');
  const [archiveBusy, setArchiveBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadStorage = async () => {
    setStorage(await storageInfo());
    setReport(await integrityReport());
    setDemoExists(await demoDataExists());
  };
  useEffect(() => { void loadStorage(); }, []);

  const chooseMode = async (next: RestoreMode) => {
    setMode(next);
    setArchiveConfirm('');
    if (!archive) return;
    setPlan(planRestore(archive, next, await readCurrentIndex()));
  };
  void settings; void refresh;

  const doExport = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await exportBackup(user?.name ?? 'Administrator');
      downloadBlob(blob, filename);
      toast('Backup exported.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doExportAll = async () => {
    setArchiveBusy(true);
    try {
      const built = await buildDataArchive(user?.name ?? 'Administrator');
      downloadBlob(built.blob, built.filename);
      toast(`Exported ${Object.entries(built.manifest.counts).reduce((a, [, n]) => a + n, 0)} rows across ${built.manifest.files.length} CSV files.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setArchiveBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    setArchive(null);
    setPlan(null);
    setFileName(file.name);
    if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
      setArchiveBusy(true);
      try {
        const parsed = await parseDataArchive(file);
        const planned = planRestore(parsed, mode, await readCurrentIndex());
        setArchive(parsed);
        setPlan(planned);
        setArchiveAdminId(planned.adminCandidates[0]?.id ?? '');
        setArchivePassword('');
        setArchiveConfirm('');
      } catch (err) {
        setResult({ ok: false, issues: [{ level: 'error', message: err instanceof Error ? err.message : 'The archive could not be read.' }] });
      } finally {
        setArchiveBusy(false);
      }
      return;
    }
    try {
      const res = await parseBackupFile(file);
      setResult(res);
      const firstAdmin = (res.file?.data.users ?? []).find((u) => u.role === 'Administrator' || u.isOwner);
      setAdminId(firstAdmin?.id ?? '');
    } catch (err) {
      setResult({ ok: false, issues: [{ level: 'error', message: err instanceof Error ? err.message : 'The file could not be read.' }] });
    }
  };

  const doRestore = async () => {
    if (!result?.ok) return;
    setBusy(true);
    try {
      await importBackup(result, { adminUserId: adminId, newPassword: password, actorName: user?.name });
      toast('Restore complete. Sign in with the new administrator password.');
      setResult(null); setPassword(''); setConfirmText('');
      setTimeout(() => window.location.assign('/login'), 700);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Restore failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doArchiveRestore = async () => {
    if (!archive || !plan) return;
    setArchiveBusy(true);
    try {
      const nextPlan = planRestore(archive, mode, await readCurrentIndex());
      const res = await applyRestore(archive, nextPlan, {
        mode,
        adminUserId: archiveAdminId,
        newPassword: archivePassword,
        actorId: user?.id,
        actorName: user?.name
      });
      if (mode === 'clean') {
        toast(`Restored ${res.total} records. Sign in with the new administrator password.`);
        setTimeout(() => window.location.assign('/login'), 900);
      } else {
        toast(`Merged ${res.total} records; ${nextPlan.totals.skip} were already present.`);
        setArchive(null);
        setPlan(null);
        bump();
        await loadStorage();
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Restore failed', 'error');
    } finally {
      setArchiveBusy(false);
    }
  };

  const doDemo = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const res = await loadDemoData({ id: user.id, name: user.name, role: user.role });
      toast(`Sample workshop loaded — ${res.invoices} invoices, ${res.jobs} job cards.`);
      setConfirmDemo(false);
      bump();
      await loadStorage();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to load sample data', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doClear = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await clearAllBusinessData({ id: user.id, name: user.name, role: user.role });
      toast('Business data cleared. Your account and settings were kept.');
      setConfirmClear(false);
      bump();
      await loadStorage();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to clear data', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    setBusy(true);
    try {
      await factoryReset();
      window.location.assign('/setup');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Reset failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-col gap-14">
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card>
          <div className="card-header">
            <div><h3><Download size={15} className="inline" /> Backup file</h3><div className="sub">One JSON file — the fastest way to move this workshop to another device.</div></div>
          </div>
          <div className="card-body small flex-col gap-10" style={{ color: 'var(--text-soft)' }}>
            <p>Every business record, setting and artwork, with a checksum. Password hashes and salts are never included.</p>
            <div className="flex gap-8 wrap">
              <Button variant="secondary" icon={<Download size={13} />} onClick={doExport} loading={busy}>Download backup</Button>
              <Button variant="secondary" icon={<FileArchive size={13} />} onClick={doExportAll} loading={archiveBusy}>Export all data (.zip)</Button>
            </div>
            <p className="tiny muted">The ZIP holds one CSV per entity plus a manifest describing columns and relationships — open it in any spreadsheet.</p>
          </div>
        </Card>
        <Card>
          <div className="card-header"><h3><HardDrive size={15} className="inline" /> Local storage</h3></div>
          <div className="card-body small flex-col gap-8" style={{ color: 'var(--text-soft)' }}>
            {storage ? (
              <>
                <div className="mini-row"><span className="t">Used by this origin</span><span className="v mono">{formatBytes(storage.usage)}</span></div>
                <div className="mini-row"><span className="t">Browser quota</span><span className="v mono">{formatBytes(storage.quota)}</span></div>
                <div className="mini-row"><span className="t">Data lives on</span><span className="v">This device only</span></div>
              </>
            ) : <p className="muted">Storage estimates are not available in this browser.</p>}
            <div className="divider" />
            <div className="label">Integrity checks</div>
            {report === null && <Loading label="Checking data…" />}
            {report?.map((r, i) => (
              <div key={i} className="flex items-start gap-8 tiny">
                {r.level === 'ok' ? <CheckCircle2 size={13} color="var(--success)" /> : r.level === 'warning' ? <AlertTriangle size={13} color="var(--warning)" /> : <AlertTriangle size={13} color="var(--danger)" />}
                <span>{r.message}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <div className="card-header">
          <div><h3><Upload size={15} className="inline" /> Restore</h3><div className="sub">Reads a JSON backup or a CSV data archive, validates it, then writes only after you confirm.</div></div>
        </div>
        <div className="card-body flex-col gap-14">
          <input ref={fileRef} type="file" accept="application/json,.json,application/zip,.zip" hidden
            onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          <div className="flex gap-10 items-center wrap">
            <Button variant="secondary" icon={<Upload size={13} />} onClick={() => fileRef.current?.click()}>Choose file</Button>
            {fileName && <span className="tiny muted mono">{fileName}</span>}
            <span className="tiny muted">.json backup or .zip archive · max 30 MB / 120 MB</span>
          </div>

          {result && (
            <div className="flex-col gap-10">
              {result.issues.length > 0 && (
                <div className="flex-col gap-6">
                  {result.issues.map((i, idx) => (
                    <div key={idx} className={`alert ${i.level === 'error' ? 'alert-danger' : 'alert-warning'}`}>
                      {i.level === 'error' ? <AlertTriangle size={14} /> : <Info size={14} />}<span>{i.message}</span>
                    </div>
                  ))}
                </div>
              )}
              {result.file && (
                <div className="restore-preview">
                  <div className="grid-3">
                    <div><div className="doc-label">Workshop</div><div className="doc-strong">{result.file.manifest.businessName || '—'}</div></div>
                    <div><div className="doc-label">Exported</div><div className="doc-strong">{fmtDateTime(result.file.createdAt)}</div></div>
                    <div><div className="doc-label">App version</div><div className="doc-strong">{result.file.appVersion || '—'}</div></div>
                  </div>
                  <div className="divider" />
                  <div className="tiny" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 6 }}>
                    {Object.entries(result.file.manifest.counts ?? {}).filter(([, n]) => n > 0).map(([store, n]) => (
                      <div key={store} className="mini-row" style={{ border: 'none', padding: 0 }}><span className="t">{store}</span><span className="v mono">{n}</span></div>
                    ))}
                  </div>
                </div>
              )}
              {result.ok && result.file && (
                <>
                  <div className="form-grid">
                    <Field label="Administrator account to recover" required>
                      <Select value={adminId} onChange={(e) => setAdminId(e.target.value)}>
                        {(result.file.data.users ?? []).map((u) => (
                          <option key={u.id} value={u.id}>{u.name} · @{u.username} ({u.role})</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="New administrator password" required hint="Hashes are never included in backups.">
                      <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} />
                    </Field>
                  </div>
                  <Field label="Type RESTORE to confirm" hint="All current data will be replaced.">
                    <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESTORE" />
                  </Field>
                  <div className="alert alert-warning"><AlertTriangle size={14} /><span>Restoring replaces every record on this device. Export the current data first if you may need it.</span></div>
                  <div className="flex gap-8">
                    <Button variant="danger" onClick={doRestore} disabled={!adminId || !password || confirmText !== 'RESTORE'} loading={busy}>Restore backup</Button>
                    <Button variant="ghost" onClick={() => { setResult(null); setFileName(''); }}>Cancel</Button>
                  </div>
                </>
              )}
            </div>
          )}

          {archive && plan && (
            <div className="flex-col gap-12">
              <div className="restore-preview">
                <div className="grid-3">
                  <div><div className="doc-label">Workshop</div><div className="doc-strong">{archive.manifest.businessName || '—'}</div></div>
                  <div><div className="doc-label">Exported</div><div className="doc-strong">{fmtDateTime(archive.manifest.createdAt)}</div></div>
                  <div><div className="doc-label">Records</div><div className="doc-strong">{plan.totals.add + plan.totals.skip + plan.totals.conflict}</div></div>
                </div>
                <div className="divider" />
                <div className="tiny" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 6 }}>
                  {plan.entities.filter((e) => e.inArchive > 0).map((e) => (
                    <div key={e.entity} className="mini-row" style={{ border: 'none', padding: 0 }}>
                      <span className="t">{e.label}</span>
                      <span className="v mono">{mode === 'clean' ? e.inArchive : `${e.willAdd}/${e.inArchive}`}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-8 wrap items-center">
                <Button size="sm" variant={mode === 'merge' ? 'primary' : 'secondary'} onClick={() => { void chooseMode('merge'); }}>Merge (add missing)</Button>
                <Button size="sm" variant={mode === 'clean' ? 'primary' : 'secondary'} onClick={() => { void chooseMode('clean'); }}>Clean install (replace)</Button>
                <span className="tiny muted">
                  {mode === 'merge'
                    ? `${plan.totals.add} to add · ${plan.totals.skip} already present · ${plan.totals.conflict} conflicting keys kept`
                    : `${plan.totals.add} records will replace the current workspace`}
                </span>
              </div>

              {plan.warnings.map((w, i) => (
                <div key={i} className="alert alert-warning"><Info size={14} /><span>{w}</span></div>
              ))}
              {plan.errors.map((e, i) => (
                <div key={i} className="alert alert-danger"><AlertTriangle size={14} /><span>{e}</span></div>
              ))}

              {mode === 'clean' && (
                <>
                  <div className="form-grid">
                    <Field label="Administrator account to keep" required>
                      <Select value={archiveAdminId} onChange={(e) => setArchiveAdminId(e.target.value)}>
                        {plan.adminCandidates.map((u) => (
                          <option key={u.id} value={u.id}>{u.name} · @{u.username}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="New password for that account" required>
                      <PasswordField value={archivePassword} onChange={(e) => setArchivePassword(e.target.value)} />
                    </Field>
                  </div>
                  <Field label="Type RESTORE to confirm" hint="The current workspace is replaced by the archive.">
                    <Input value={archiveConfirm} onChange={(e) => setArchiveConfirm(e.target.value)} placeholder="RESTORE" />
                  </Field>
                </>
              )}

              <div className="flex gap-8">
                <Button
                  variant={mode === 'clean' ? 'danger' : 'secondary'}
                  onClick={doArchiveRestore}
                  loading={archiveBusy}
                  disabled={mode === 'clean' && (!archiveAdminId || !archivePassword || archiveConfirm !== 'RESTORE')}
                >
                  {mode === 'clean' ? 'Restore archive' : 'Merge archive'}
                </Button>
                <Button variant="ghost" onClick={() => { setArchive(null); setPlan(null); setFileName(''); }}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="card-header"><h3><Database size={15} className="inline" /> Maintenance</h3></div>
        <div className="card-body small flex-col gap-12" style={{ color: 'var(--text-soft)' }}>
          <div className="flex gap-8 wrap items-center">
            <Button variant="secondary" size="sm" onClick={() => setConfirmDemo(true)} disabled={demoExists === true}>Load sample data</Button>
            <span className="tiny muted">Fictional records for a first look; blocked once real invoices exist.</span>
            {demoExists && <Badge tone="info">Sample data present</Badge>}
          </div>
          <div className="divider" />
          <div className="flex gap-8 wrap items-center">
            <Button variant="secondary" size="sm" onClick={() => setConfirmClear(true)}>Clear business data</Button>
            <span className="tiny muted">Removes sales, stock and customers; keeps users, settings and numbering.</span>
          </div>
          <div className="divider" />
          <div className="flex gap-8 wrap items-center">
            <Button variant="danger" size="sm" onClick={() => setConfirmReset(true)}>Reset this device</Button>
            <span className="tiny muted">Deletes the local database and returns to first-time setup.</span>
          </div>
        </div>
      </Card>
      <div className="about-software">
        <BrandGlyph size={22} tone="dark" />
        <div>
          <b>Servixa — Auto Workshop POS</b>
          <span>Version {APP_VERSION} · Local-only build · records never leave this browser</span>
        </div>
      </div>

      <ConfirmDialog open={confirmDemo} title="Load sample data?" message="Fictional workshop records will be added. This is blocked once real invoices or job cards exist." confirmLabel="Load sample data" busy={busy} onConfirm={doDemo} onClose={() => setConfirmDemo(false)} />
      <ConfirmDialog open={confirmClear} title="Clear business data?" message="Removes customers, vehicles, sales, job cards, stock, purchases, returns, warranties, shifts and expenses. Users, settings and numbering sequences are kept." confirmLabel="Clear business data" tone="danger" requireText="CLEAR" busy={busy} onConfirm={doClear} onClose={() => setConfirmClear(false)} />
      <ConfirmDialog open={confirmReset} title="Factory reset this device?" message="This cannot be undone without a backup. All accounts and records in this browser will be erased." confirmLabel="Erase everything" tone="danger" requireText="ERASE" busy={busy} onConfirm={doReset} onClose={() => setConfirmReset(false)} />
    </div>
  );
}
