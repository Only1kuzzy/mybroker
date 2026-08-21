import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

type User = {
  id: string;
  email: string;
  full_name: string;
  balance_usd: number;
  profit_usd: number;
  plan: string;
  lock_until: string | null;
  withdrawal_approved: boolean;
  tax_percent: number;
  created_at: string;
};

type WithdrawalRequest = {
  id: string;
  amount_usd: number;
  wallet_address: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
};

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function daysLeft(lockUntil: string | null): number {
  if (!lockUntil) return 0;
  const diff = new Date(lockUntil).getTime() - Date.now();
  return diff <= 0 ? 0 : Math.ceil(diff / 86_400_000);
}

export default function App() {
  const [page, setPage] = useState<'auth' | 'dashboard'>('auth');
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [user, setUser] = useState<User | null>(null);
  const [requests, setRequests] = useState<WithdrawalRequest[]>([]);
  const [booting, setBooting] = useState(true);

  // Auth form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // Withdrawal form
  const [wAmount, setWAmount] = useState('');
  const [wWallet, setWWallet] = useState('');
  const [wLoading, setWLoading] = useState(false);
  const [wError, setWError] = useState('');
  const [wSuccess, setWSuccess] = useState('');

  // Boot — restore session
  useEffect(() => {
    const token = localStorage.getItem('cv_token');
    if (!token) { setBooting(false); return; }
    fetch(`${API}/user/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { setUser(data.user); setPage('dashboard'); loadRequests(token); })
      .catch(() => localStorage.removeItem('cv_token'))
      .finally(() => setBooting(false));
  }, []);

  function loadRequests(token: string) {
    fetch(`${API}/withdrawal/my-requests`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setRequests(d.requests || []));
  }

  // ── Auth handlers ────────────────────────────────────────────────────────

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(''); setAuthLoading(true);
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const d = await r.json();
      if (!r.ok) { setAuthError(d.error); return; }
      localStorage.setItem('cv_token', d.token);
      setUser(d.user); setPage('dashboard'); loadRequests(d.token);
    } catch { setAuthError('Network error. Please try again.'); }
    finally { setAuthLoading(false); }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(''); setAuthLoading(true);
    try {
      const r = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, fullName, password })
      });
      const d = await r.json();
      if (!r.ok) { setAuthError(d.error); return; }
      localStorage.setItem('cv_token', d.token);
      setUser(d.user); setPage('dashboard'); loadRequests(d.token);
    } catch { setAuthError('Network error. Please try again.'); }
    finally { setAuthLoading(false); }
  }

  function logout() {
    localStorage.removeItem('cv_token');
    setUser(null); setPage('auth');
    setEmail(''); setPassword(''); setFullName('');
  }

  // ── Withdrawal ───────────────────────────────────────────────────────────

  async function handleWithdrawal(e: React.FormEvent) {
    e.preventDefault();
    setWError(''); setWSuccess(''); setWLoading(true);
    const token = localStorage.getItem('cv_token')!;
    try {
      const r = await fetch(`${API}/withdrawal/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: Number(wAmount), walletAddress: wWallet })
      });
      const d = await r.json();
      if (!r.ok) { setWError(d.error); return; }
      setWSuccess('Withdrawal request submitted! We will process it within 24 hours.');
      setWAmount(''); setWWallet('');
      loadRequests(token);
    } catch { setWError('Network error. Please try again.'); }
    finally { setWLoading(false); }
  }

  // ── Splash ───────────────────────────────────────────────────────────────

  if (booting) {
    return (
      <div className="splash">
        <div className="logo-icon-lg">◈</div>
        <div className="spinner" />
      </div>
    );
  }

  // ── Auth page ────────────────────────────────────────────────────────────

  if (page === 'auth') {
    return (
      <div className="auth-bg">
        <div className="auth-card">
          <div className="auth-logo">
            <span className="logo-icon">◈</span>
            <span className="logo-text">CryptoVault</span>
          </div>
          <p className="auth-tagline">Premium crypto investment platform</p>

          <div className="auth-tabs">
            <button
              className={`auth-tab${authTab === 'login' ? ' active' : ''}`}
              onClick={() => { setAuthTab('login'); setAuthError(''); }}
            >Sign In</button>
            <button
              className={`auth-tab${authTab === 'register' ? ' active' : ''}`}
              onClick={() => { setAuthTab('register'); setAuthError(''); }}
            >Create Account</button>
          </div>

          {authTab === 'login' ? (
            <form className="auth-form" onSubmit={handleLogin}>
              <div className="field">
                <label>Email address</label>
                <input type="email" placeholder="you@example.com" value={email}
                  onChange={e => setEmail(e.target.value)} required />
              </div>
              <div className="field">
                <label>Password</label>
                <input type="password" placeholder="••••••••" value={password}
                  onChange={e => setPassword(e.target.value)} required />
              </div>
              {authError && <div className="alert alert-error">{authError}</div>}
              <button type="submit" className="btn-primary" disabled={authLoading}>
                {authLoading ? 'Signing in…' : 'Sign In →'}
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={handleRegister}>
              <div className="field">
                <label>Full name</label>
                <input type="text" placeholder="John Doe" value={fullName}
                  onChange={e => setFullName(e.target.value)} required />
              </div>
              <div className="field">
                <label>Email address</label>
                <input type="email" placeholder="you@example.com" value={email}
                  onChange={e => setEmail(e.target.value)} required />
              </div>
              <div className="field">
                <label>Password</label>
                <input type="password" placeholder="Min. 8 characters" value={password}
                  onChange={e => setPassword(e.target.value)} required minLength={8} />
              </div>
              {authError && <div className="alert alert-error">{authError}</div>}
              <button type="submit" className="btn-primary" disabled={authLoading}>
                {authLoading ? 'Creating account…' : 'Create Account →'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ── Dashboard ────────────────────────────────────────────────────────────

  if (!user) return null;

  const total = Number(user.balance_usd) + Number(user.profit_usd);
  const tax = (total * Number(user.tax_percent)) / 100;
  const netPayout = total - tax;
  const days = daysLeft(user.lock_until);
  const timeLocked = user.lock_until ? days > 0 : false;
  const canWithdraw = !timeLocked && user.withdrawal_approved;

  const profitPct = user.balance_usd > 0
    ? ((Number(user.profit_usd) / Number(user.balance_usd)) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="dash">
      {/* Header */}
      <header className="dash-header">
        <div className="dash-logo">
          <span className="logo-icon">◈</span>
          <span className="logo-text">CryptoVault</span>
        </div>
        <div className="dash-header-right">
          <div className="user-pill">
            <div className="user-avatar">{user.full_name[0]}</div>
            <span>{user.full_name}</span>
          </div>
          <button className="btn-logout" onClick={logout}>Logout</button>
        </div>
      </header>

      <main className="dash-main">
        {/* Greeting */}
        <div className="greeting">
          <h1>Welcome back, <span className="gradient-text">{user.full_name.split(' ')[0]}</span> 👋</h1>
          <p className="subtitle">Here's your investment overview</p>
        </div>

        {/* Balance Cards */}
        <div className="cards-row">
          <div className="card card-balance">
            <div className="card-top-bar" />
            <div className="card-label">Total Balance</div>
            <div className="card-value">{fmt(Number(user.balance_usd))}</div>
            <div className="card-sub">Principal investment</div>
          </div>
          <div className="card card-profit">
            <div className="card-top-bar" />
            <div className="card-label">Total Profit</div>
            <div className="card-value profit-val">+{fmt(Number(user.profit_usd))}</div>
            <div className="card-sub">+{profitPct}% returns</div>
          </div>
          <div className="card card-plan">
            <div className="card-top-bar" />
            <div className="card-label">Investment Plan</div>
            <div className="card-value plan-val">{user.plan}</div>
            <div className="card-sub">Tax rate: {user.tax_percent}%</div>
          </div>
          <div className="card card-payout">
            <div className="card-top-bar" />
            <div className="card-label">Net Payout</div>
            <div className="card-value">{fmt(netPayout)}</div>
            <div className="card-sub">After {user.tax_percent}% tax ({fmt(tax)})</div>
          </div>
        </div>

        {/* Withdrawal Gates */}
        <section className="section">
          <h2 className="section-title">Withdrawal Requirements</h2>
          <div className="gates">
            <div className={`gate ${timeLocked ? 'gate-locked' : 'gate-ok'}`}>
              <div className="gate-icon">{timeLocked ? '🔒' : '✅'}</div>
              <div>
                <div className="gate-name">Time Lock Period</div>
                <div className="gate-desc">
                  {user.lock_until
                    ? timeLocked
                      ? `${days} day${days !== 1 ? 's' : ''} remaining until unlock`
                      : 'Lock period has ended'
                    : 'No lock period set by admin'}
                </div>
              </div>
              <div className={`gate-badge ${timeLocked ? 'badge-locked' : 'badge-ok'}`}>
                {timeLocked ? 'Locked' : 'Unlocked'}
              </div>
            </div>

            <div className={`gate ${user.withdrawal_approved ? 'gate-ok' : 'gate-pending'}`}>
              <div className="gate-icon">{user.withdrawal_approved ? '✅' : '⏳'}</div>
              <div>
                <div className="gate-name">Admin Approval</div>
                <div className="gate-desc">
                  {user.withdrawal_approved
                    ? 'Withdrawal approved by administrator'
                    : 'Awaiting approval from administrator'}
                </div>
              </div>
              <div className={`gate-badge ${user.withdrawal_approved ? 'badge-ok' : 'badge-pending'}`}>
                {user.withdrawal_approved ? 'Approved' : 'Pending'}
              </div>
            </div>

            <div className="gate gate-info">
              <div className="gate-icon">💰</div>
              <div>
                <div className="gate-name">Tax / Fee ({user.tax_percent}%)</div>
                <div className="gate-desc">
                  {fmt(tax)} will be deducted — you receive {fmt(netPayout)}
                </div>
              </div>
              <div className="gate-badge badge-info">{user.tax_percent}%</div>
            </div>
          </div>
        </section>

        {/* Withdrawal Form */}
        <section className="section">
          <h2 className="section-title">Request Withdrawal</h2>
          {canWithdraw ? (
            <div className="form-card">
              <form onSubmit={handleWithdrawal}>
                <div className="field">
                  <label>Wallet / Account Address</label>
                  <input type="text" placeholder="Enter your wallet address to receive funds"
                    value={wWallet} onChange={e => setWWallet(e.target.value)} required />
                </div>
                <div className="field">
                  <label>Amount (USD)</label>
                  <input type="number" placeholder="Enter amount to withdraw"
                    value={wAmount} onChange={e => setWAmount(e.target.value)}
                    min={1} max={total} step="0.01" required />
                </div>
                {wAmount && Number(wAmount) > 0 && (
                  <div className="tax-preview">
                    <span>Tax ({user.tax_percent}%): <strong>{fmt((Number(wAmount) * Number(user.tax_percent)) / 100)}</strong></span>
                    <span>You receive: <strong className="profit-val">{fmt(Number(wAmount) - (Number(wAmount) * Number(user.tax_percent)) / 100)}</strong></span>
                  </div>
                )}
                {wError && <div className="alert alert-error">{wError}</div>}
                {wSuccess && <div className="alert alert-success">{wSuccess}</div>}
                <button type="submit" className="btn-primary" disabled={wLoading}>
                  {wLoading ? 'Submitting…' : 'Submit Withdrawal Request'}
                </button>
              </form>
            </div>
          ) : (
            <div className="locked-box">
              <div className="locked-emoji">🔐</div>
              <h3>Withdrawal Locked</h3>
              <p>Complete all requirements above to unlock your withdrawal.</p>
            </div>
          )}
        </section>

        {/* History */}
        {requests.length > 0 && (
          <section className="section">
            <h2 className="section-title">Withdrawal History</h2>
            <div className="history-table">
              {requests.map(r => (
                <div className="history-row" key={r.id}>
                  <div className="history-amount">{fmt(r.amount_usd)}</div>
                  <div className="history-wallet">{r.wallet_address.slice(0, 20)}…</div>
                  <div className="history-date">{new Date(r.requested_at).toLocaleDateString()}</div>
                  <div className={`status-badge status-${r.status}`}>{r.status}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
