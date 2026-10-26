import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, User } from 'lucide-react';
import { AuthShell } from '../components/AuthShell';
import { useApp } from '../state/AppContext';
import { Button, Field, Input, PasswordField } from '../components/ui';
import { DEFAULT_LOGIN_ART } from '../lib/assets';

export default function Login() {
  const { settings, login } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    const res = await login(username.trim(), password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Unable to sign in.');
      return;
    }
    const next = params.get('next');
    navigate(next && next.startsWith('/') ? next : '/', { replace: true });
  };

  return (
    <AuthShell
      brandName={settings.profile.name || 'Auto Workshop'}
      brandSub="Workshop management"
      art={settings.attachments.loginArt || DEFAULT_LOGIN_ART}
      artPosition={settings.attachments.loginArtPosition}
      artHeading="Precision service, without the paperwork."
      artSub="Billing, job cards, inventory and workshop reports — in one calm workspace."
    >
      <h1>{settings.loginCopy.heading || 'Welcome back'}</h1>
      <p className="auth-sub">{settings.loginCopy.subtitle || 'Access your workshop to continue'}</p>

      <form className="auth-form" onSubmit={submit} noValidate>
        {error && (
          <div className="alert alert-danger" role="alert">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}
        <Field label="Username" htmlFor="login-username">
          <div className="input-icon">
            <User size={14} />
            <Input
              id="login-username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              autoFocus
              aria-invalid={!!error}
            />
          </div>
        </Field>
        <Field label="Password" htmlFor="login-password">
          <PasswordField
            id="login-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
            aria-invalid={!!error}
          />
        </Field>
        <Button type="submit" variant="primary" loading={busy} icon={!busy ? <ArrowRight size={15} /> : undefined}>
          {busy ? 'Signing in…' : 'Login to workspace'}
        </Button>
      </form>

      <div className="auth-links">
        <Link to="/help">Help &amp; Guide</Link>
        <span style={{ opacity: 0.4 }}>·</span>
        <Link to="/privacy">Privacy &amp; Terms</Link>
      </div>

      <div className="alert alert-info" style={{ marginTop: 16, fontSize: 11.5 }}>
        <span>
          Trouble signing in? Contact your workshop administrator — passwords are stored locally on this device and
          cannot be recovered remotely.
        </span>
      </div>
    </AuthShell>
  );
}
