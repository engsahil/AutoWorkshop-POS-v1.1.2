import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck, Camera, KeyRound, LogOut, Settings, ShieldCheck, SlidersHorizontal, User as UserIcon } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { Field, Input, Button, PasswordField, Select, Drawer } from './ui';
import { updateOwnProfile } from '../lib/repo';
import { changePassword, readSession } from '../lib/auth';
import { passwordIssues } from '../lib/auth';
import { fmtDateTime } from '../lib/money';
import { initials } from '../lib/ids';

export function Avatar({ name, src, size = 'md' }: { name: string; src?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return (
    <span className={`avatar ${size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : size === 'xl' ? 'xl' : ''}`}>
      {src ? <img src={src} alt={name} /> : initials(name)}
    </span>
  );
}

type Tab = 'profile' | 'password' | 'preferences';

export function ProfileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, settings, refresh, toast, logout, can, setUser } = useApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('profile');
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [avatar, setAvatar] = useState<string | null>(user?.avatar ?? null);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const session = readSession();

  useEffect(() => {
    if (!open) return;
    setTab('profile');
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
    setPhone(user?.phone ?? '');
    setAvatar(user?.avatar ?? null);
    setCurrent(''); setNext(''); setConfirm(''); setPwError(null);
  }, [open, user]);

  if (!user) return null;

  const saveProfile = async () => {
    setSaving(true);
    try {
      const updated = await updateOwnProfile(user.id, { name, email, phone, avatar }, { id: user.id, name: user.name, role: user.role });
      await refresh();
      setUser(updated);
      toast('Profile updated.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to update profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  const onPickAvatar = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast('Choose a PNG, JPG or WebP image.', 'error');
      return;
    }
    if (file.size > 600 * 1024) {
      toast('Profile images must be smaller than 600 KB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAvatar(String(reader.result));
    reader.readAsDataURL(file);
  };

  const submitPassword = async () => {
    setPwError(null);
    if (next !== confirm) {
      setPwError('New passwords do not match.');
      return;
    }
    const issues = passwordIssues(next, settings.security);
    if (issues.length) {
      setPwError(issues.join(' · '));
      return;
    }
    setSaving(true);
    const res = await changePassword(user.id, current, next);
    setSaving(false);
    if (!res.ok) {
      setPwError(res.error ?? 'Unable to change password.');
      return;
    }
    setCurrent(''); setNext(''); setConfirm('');
    toast('Password changed successfully.');
    setTab('profile');
  };

  const savePrefs = async (patch: Partial<typeof user.preferences>) => {
    try {
      const updated = await updateOwnProfile(user.id, { preferences: patch }, { id: user.id, name: user.name, role: user.role });
      setUser(updated);
      await refresh();
      toast('Preferences saved.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to save preferences', 'error');
    }
  };

  return (
    <Drawer open={open} onClose={onClose} title="Your account" width={420}>
      <div className="flex-col gap-16">
        <div className="flex items-center gap-12">
          <div style={{ position: 'relative' }}>
            <Avatar name={user.name} src={avatar} size="xl" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="btn btn-secondary btn-icon sm"
              style={{ position: 'absolute', right: -4, bottom: -4, borderRadius: '50%' }}
              aria-label="Change profile photo"
              title="Change profile photo"
            >
              <Camera size={13} />
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => onPickAvatar(e.target.files?.[0])} />
          </div>
          <div className="grow">
            <div style={{ fontSize: 15, fontWeight: 750 }}>{user.name}</div>
            <div className="tiny mono" style={{ color: 'var(--muted)' }}>@{user.username}</div>
            <div className="flex gap-6 wrap" style={{ marginTop: 5 }}>
              <BadgeCheck size={13} style={{ color: 'var(--success)' }} />
              <span className="tiny" style={{ color: 'var(--success)', fontWeight: 700 }}>{user.role}</span>
              <span className="tiny muted">· Active</span>
            </div>
          </div>
        </div>

        <div className="segmented" style={{ width: '100%' }}>
          <button className={tab === 'profile' ? 'active' : ''} style={{ flex: 1 }} onClick={() => setTab('profile')}>Edit profile</button>
          <button className={tab === 'password' ? 'active' : ''} style={{ flex: 1 }} onClick={() => setTab('password')}>Password</button>
          <button className={tab === 'preferences' ? 'active' : ''} style={{ flex: 1 }} onClick={() => setTab('preferences')}>Preferences</button>
        </div>

        {tab === 'profile' && (
          <div className="form-section">
            <Field label="Full name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </Field>
            <div className="form-grid">
              <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@workshop.pk" /></Field>
              <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx xxxxxxx" /></Field>
            </div>
            <Field label="Username" hint="Usernames cannot be changed by users. Ask an administrator.">
              <Input value={user.username} disabled />
            </Field>
            <Field label="Role" hint="Roles and permissions are managed in Users & Roles.">
              <Input value={user.role} disabled />
            </Field>
            <div className="flex gap-8">
              <Button variant="primary" onClick={saveProfile} loading={saving}>Save profile</Button>
              {avatar && (
                <Button variant="ghost" onClick={() => setAvatar(null)}>Remove photo</Button>
              )}
            </div>
          </div>
        )}

        {tab === 'password' && (
          <div className="form-section">
            <div className="alert alert-info">
              <ShieldCheck size={15} />
              <span>Passwords are hashed with PBKDF2-SHA-256 and never exported in backups.</span>
            </div>
            <Field label="Current password" required>
              <PasswordField value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label="New password" required hint={`At least ${settings.security.minPasswordLength} characters${settings.security.requireNumber ? ', one number' : ''}.`}>
              <PasswordField value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Confirm new password" required error={pwError}>
              <PasswordField value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </Field>
            <Button variant="primary" onClick={submitPassword} loading={saving} icon={<KeyRound size={14} />}>Update password</Button>
          </div>
        )}

        {tab === 'preferences' && (
          <div className="form-section">
            <div className="settings-card" style={{ boxShadow: 'none' }}>
              <div className="sb flex-col gap-12">
                <div className="flex items-center justify-between">
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 12.5 }}>Notification sounds</div>
                    <div className="tiny muted">Play a chime on completed sales and alerts.</div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={user.preferences.sound} onChange={(e) => savePrefs({ sound: e.target.checked })} />
                    <span className="track" />
                  </label>
                </div>
                <div>
                  <div className="label" style={{ marginBottom: 5 }}>Volume · {user.preferences.volume}%</div>
                  <input
                    type="range" min={0} max={100} value={user.preferences.volume}
                    aria-label="Notification volume"
                    style={{ width: '100%', accentColor: 'var(--bronze-600)' }}
                    onChange={(e) => savePrefs({ volume: Number(e.target.value) })}
                  />
                </div>
                <Field label="Interface density" hint="Compact fits more rows on screen for busy counters.">
                  <Select value={user.preferences.density} onChange={(e) => savePrefs({ density: e.target.value as 'comfortable' | 'compact' })}>
                    <option value="comfortable">Comfortable</option>
                    <option value="compact">Compact</option>
                  </Select>
                </Field>
              </div>
            </div>
            <div className="settings-card" style={{ boxShadow: 'none' }}>
              <div className="sb flex-col gap-8">
                <div className="flex items-center gap-8"><UserIcon size={14} className="muted" /><span className="small strong">Session</span></div>
                <div className="mini-row"><span className="t">Signed in</span><span className="v mono">{session ? fmtDateTime(session.issuedAt) : '—'}</span></div>
                <div className="mini-row"><span className="t">Expires</span><span className="v mono">{session ? fmtDateTime(session.expiresAt) : '—'}</span></div>
                <div className="mini-row"><span className="t">Last login</span><span className="v mono">{user.lastLogin ? fmtDateTime(user.lastLogin) : 'First session'}</span></div>
                <div className="mini-row"><span className="t">Account</span><span className="v">{user.isOwner ? 'Owner account' : 'Staff account'}</span></div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-col gap-8" style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        {can('settings.manage') && (
          <button className="menu-item" onClick={() => { onClose(); navigate('/settings'); }}>
            <Settings size={15} /> Application settings
          </button>
        )}
        <button className="menu-item" onClick={() => { onClose(); navigate('/help'); }}>
          <SlidersHorizontal size={15} /> Help & guide
        </button>
        <button
          className="menu-item danger"
          onClick={async () => {
            onClose();
            await logout();
            navigate('/login');
          }}
        >
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </Drawer>
  );
}
