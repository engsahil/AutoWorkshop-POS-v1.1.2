import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Building2, Check, Eye, EyeOff, ShieldCheck, User } from 'lucide-react';
import { AuthShell } from '../components/AuthShell';
import { useApp } from '../state/AppContext';
import { Button, Field, Input, PasswordField } from '../components/ui';
import { createInitialAdmin, ValidationError, ConflictError } from '../lib/repo';
import { passwordIssues } from '../lib/auth';
import { DEFAULT_SETUP_ART } from '../lib/assets';

export default function Setup() {
  const { settings, login, refresh } = useApp();
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const checks = useMemo(() => {
    const issues = passwordIssues(password, settings.security);
    return [
      { label: `${settings.security.minPasswordLength}+ characters`, ok: password.length >= settings.security.minPasswordLength },
      ...(settings.security.requireUppercase ? [{ label: 'Uppercase letter', ok: /[A-Z]/.test(password) }] : []),
      ...(settings.security.requireNumber ? [{ label: 'Number', ok: /[0-9]/.test(password) }] : []),
      { label: 'Passwords match', ok: password.length > 0 && password === confirm },
      ...(issues.length ? [] : [])
    ];
  }, [password, confirm, settings.security]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!fullName.trim()) { setError('Enter your full name.'); return; }
    if (!username.trim()) { setError('Choose a username.'); return; }
    if (!password) { setError('Create a password.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      await createInitialAdmin({
        fullName, username, password, confirmPassword: confirm,
        businessName: businessName.trim() || undefined
      });
      const res = await login(username.trim().toLowerCase(), password);
      if (!res.ok) throw new ValidationError(res.error ?? 'Account created, but sign-in failed. Return to the login page.');
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ConflictError || err instanceof ValidationError ? err.message : err instanceof Error ? err.message : 'Setup failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      art={settings.attachments.setupArt || DEFAULT_SETUP_ART}
      artHeading="Set up your workshop in under a minute."
      artSub="Create the owner account, then add your team, parts catalogue and services."
    >
      <div className="auth-hero-mini">
        <div className="logo-badge"><Building2 size={18} color="#F6F1E9" /></div>
        <div>
          <b>Create Your Account</b>
          <span>First-time setup · Owner access</span>
        </div>
      </div>
      <h1 style={{ fontSize: 20 }}>Get your workshop ready</h1>
      <p className="auth-sub">This creates the single administrator account for this installation.</p>

      <form className="auth-form" onSubmit={submit} noValidate>
        {error && (
          <div className="alert alert-danger" role="alert">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}
        <Field label="Workshop / business name" hint="Shown on invoices and receipts. You can change it later in Settings.">
          <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Al-Madina Motors" maxLength={80} />
        </Field>
        <Field label="Your full name" required>
          <div className="input-icon">
            <User size={14} />
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Ahmed Raza" autoComplete="name" maxLength={80} autoFocus />
          </div>
        </Field>
        <Field label="Username" required hint="3–32 characters: letters, numbers, dot, dash or underscore.">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
            placeholder="Create a username"
            autoComplete="username"
            maxLength={32}
          />
        </Field>
        <div className="form-grid" style={{ gap: 12 }}>
          <Field label="Password" required>
            <PasswordField shown={showPasswords} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a password" autoComplete="new-password" />
          </Field>
          <Field label="Confirm password" required>
            <PasswordField shown={showPasswords} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" autoComplete="new-password" />
          </Field>
        </div>
        <button
          type="button"
          className="pw-shared-toggle"
          aria-pressed={showPasswords}
          onClick={() => setShowPasswords((v) => !v)}
        >
          {showPasswords ? <EyeOff size={13} /> : <Eye size={13} />}
          {showPasswords ? 'Hide passwords' : 'Show passwords'}
        </button>
        <div className="pw-hints">
          {checks.map((c) => (
            <span key={c.label} className={`pw-hint ${c.ok ? 'ok' : ''}`}>
              <Check size={10} /> {c.label}
            </span>
          ))}
        </div>
        <Button type="submit" variant="primary" loading={busy} icon={!busy ? <ArrowRight size={15} /> : undefined}>
          {busy ? 'Creating account…' : 'Create account & open workspace'}
        </Button>
        <div className="flex items-center gap-6 tiny" style={{ color: 'var(--muted)' }}>
          <ShieldCheck size={12} /> Passwords are hashed locally (PBKDF2). Setup can only be completed once.
        </div>
      </form>
    </AuthShell>
  );
}
