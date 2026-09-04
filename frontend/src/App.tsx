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
    features: ['10% guaranteed return', 'Standard lock period', 'Email support'],
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
    features: ['30% guaranteed return', 'Priority processing', 'Priority support'],
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
    features: ['50% guaranteed return', 'Fastest processing', 'Dedicated account manager'],
  },
];

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function daysLeft(lockUntil: string | null): number {
  if (!lockUntil) return 0;
  const diff = new Date(lockUntil).getTime() - Date.now();
  return diff <= 0 ? 0 : Math.ceil(diff / 86_400_000);
}

export default function App() {
  const [page, setPage] = useState<'auth' | 'plan-select' | 'dashboard'>('auth');
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

  // Fee payment info modal
  const [showFeeModal, setShowFeeModal] = useState(false);

  // Boot — restore session
  useEffect(() => {
    const token = localStorage.getItem('cv_token');
    if (!token) { setBooting(false); return; }
    fetch(`${API}/user/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
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
      .then(d => setRequests(d.requests || []));
  }

  function loadPaymentSettings() {
    fetch(`${API}/settings/payment`)
      .then(r => r.json())
      .then(d => setPaymentSettings(d));
  }

  function loadBtcPrice() {
    fetch(`${API}/price`)
      .then(r => r.json())
      .then(d => { if (d.usd) setBtcPrice(d.usd); })
      .catch(() => {});
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
    setAuthError(''); setAuthLoading(true);
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const d = await r.json();
      if (!r.ok) { setAuthError(d.error); return; }
      afterAuth(d.token, d.user);
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
      afterAuth(d.token, d.user);
    } catch { setAuthError('Network error. Please try again.'); }
    finally { setAuthLoading(false); }
  }

  function logout() {
    localStorage.removeItem('cv_token');
    setUser(null); setPage('auth');
    setEmail(''); setPassword(''); setFullName('');
    setSelectedPlan(null); setInvestAmount(''); setPlanStep('choose');
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
      setPlanError(`Amount must be between ${fmt(activePlan.min)}${activePlan.max !== Infinity ? ' and ' + fmt(activePlan.max) : '+'}`);
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
    setPlanLoading(true); setPlanError('');
    const token = localStorage.getItem('cv_token')!;
    try {
      const r = await fetch(`${API}/investment/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: activePlan.id, amount: Number(investAmount), paymentMethod: payMethod })
      });
      const d = await r.json();
      if (!r.ok) { setPlanError(d.error); setPlanStep('confirm'); return; }
      setUser(d.user);
      loadRequests(token);
      setPage('dashboard');
    } catch { setPlanError('Network error. Please try again.'); }
    finally { setPlanLoading(false); }
  }

  // ── Withdrawal ───────────────────────────────────────────────────────────

  async function handleWithdrawal(e: React.FormEvent, fixedAmount?: number) {
    e.preventDefault();
    setWError(''); setWSuccess(''); setWLoading(true);
    const token = localStorage.getItem('cv_token')!;
    const amountToSend = fixedAmount != null ? fixedAmount : Number(wAmount);
    try {
      const r = await fetch(`${API}/withdrawal/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: amountToSend, walletAddress: wWallet })
      });
      const d = await r.json();
      if (!r.ok) { setWError(d.error); return; }
      setWSuccess('Withdrawal request submitted! We will process it within 24 hours.');
      setWWallet('');
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

  // ── Plan Selection page ──────────────────────────────────────────────────

  if (page === 'plan-select') {
    return (
      <div className="plan-bg">
        {/* Header */}
        <header className="plan-header">
          <div className="dash-logo">
            <span className="logo-icon">◈</span>
            <span className="logo-text">CryptoVault</span>
          </div>
          <button className="btn-logout" onClick={logout}>Logout</button>
        </header>

        <div className="plan-wrapper">
          {/* Step indicator */}
          <div className="plan-steps">
            {['Choose Plan', 'Set Amount', 'Payment', 'Confirm'].map((s, i) => {
              const stepIdx = { choose: 0, amount: 1, payment: 2, confirm: 3 }[planStep];
              const done = i < stepIdx;
              const active = i === stepIdx;
              return (
                <div key={s} className={`step-item${active ? ' step-active' : ''}${done ? ' step-done' : ''}`}>
                  <div className="step-dot">{done ? '✓' : i + 1}</div>
                  <span>{s}</span>
                </div>
              );
            })}
          </div>

          {/* ── Step 1: Choose Plan ── */}
          {planStep === 'choose' && (
            <div className="plan-step-content">
              <div className="plan-hero">
                <h1>Choose Your <span className="gradient-text">Investment Plan</span></h1>
                <p>Select the plan that matches your investment goals. All returns are guaranteed.</p>
              </div>
              <div className="plan-cards">
                {PLANS.map(plan => (
                  <div
                    key={plan.id}
                    className={`plan-card ${plan.color}${plan.popular ? ' plan-popular' : ''}`}
                    onClick={() => handlePlanSelect(plan.id)}
                  >
                    {plan.popular && <div className="plan-badge-popular">Most Popular</div>}
                    <div className="plan-card-emoji">{plan.emoji}</div>
                    <div className="plan-card-name">{plan.label}</div>
                    <div className="plan-card-range">{plan.range}</div>
                    <div className="plan-card-return">
                      <span className="plan-return-pct">+{plan.returns}</span>
                      <span className="plan-return-label">return</span>
                    </div>
                    <ul className="plan-features">
                      {plan.features.map(f => (
                        <li key={f}><span className="feat-check">✓</span>{f}</li>
                      ))}
                    </ul>
                    <button className="btn-plan-select">
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
              <button className="btn-back" onClick={() => { setPlanStep('choose'); setPlanError(''); }}>← Back</button>
              <div className="plan-hero">
                <h1>{activePlan.emoji} {activePlan.label} Plan</h1>
                <p>Enter the amount you'd like to invest. Range: <strong>{activePlan.range}</strong></p>
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
                  {investAmount && Number(investAmount) > 0 && (
                    <div className="tax-preview">
                      <span>Your return (+{activePlan.returns}): <strong className="profit-val">{fmt(Number(investAmount) * activePlan.returnPct / 100)}</strong></span>
                      <span>Total after returns: <strong className="profit-val">{fmt(Number(investAmount) * (1 + activePlan.returnPct / 100))}</strong></span>
                    </div>
                  )}
                  {planError && <div className="alert alert-error">{planError}</div>}
                  <button type="submit" className="btn-primary">Continue to Payment →</button>
                </form>
              </div>
            </div>
          )}

          {/* ── Step 3: Payment Method ── */}
          {planStep === 'payment' && activePlan && (
            <div className="plan-step-content plan-step-narrow">
              <button className="btn-back" onClick={() => { setPlanStep('amount'); setPlanError(''); }}>← Back</button>
              <div className="plan-hero">
                <h1>Choose <span className="gradient-text">Payment Method</span></h1>
                <p>How would you like to fund your {activePlan.label} plan ({fmt(Number(investAmount))})?</p>
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
                      <div className="pay-desc">Send crypto to our wallet address. Supports BTC, ETH, USDT and more.</div>
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
                      <div className="pay-title">Bank Transfer</div>
                      <div className="pay-desc">Wire transfer via your bank. Processed within 1–2 business days.</div>
                    </div>
                  </label>
                </div>
                <button type="submit" className="btn-primary">Continue →</button>
              </form>
            </div>
          )}

          {/* ── Step 4: Confirm & Payment Details ── */}
          {planStep === 'confirm' && activePlan && (
            <div className="plan-step-content plan-step-narrow">
              <button className="btn-back" onClick={() => { setPlanStep('payment'); setPlanError(''); }}>← Back</button>
              <div className="plan-hero">
                <h1>Complete Your <span className="gradient-text">Investment</span></h1>
                <p>Send your funds using the details below, then click Confirm.</p>
              </div>

              {/* Order summary */}
              <div className="confirm-summary">
                <div className="confirm-row"><span>Plan</span><strong>{activePlan.emoji} {activePlan.label}</strong></div>
                <div className="confirm-row"><span>Amount</span><strong>{fmt(Number(investAmount))}</strong></div>
                <div className="confirm-row"><span>Expected Return</span><strong className="profit-val">+{fmt(Number(investAmount) * activePlan.returnPct / 100)}</strong></div>
                <div className="confirm-row"><span>Total Payout</span><strong className="profit-val">{fmt(Number(investAmount) * (1 + activePlan.returnPct / 100))}</strong></div>
                <div className="confirm-row"><span>Payment Via</span><strong>{payMethod === 'crypto' ? '₿ Cryptocurrency' : '🏦 Bank Transfer'}</strong></div>
              </div>

              {/* Payment details */}
              {paymentSettings && payMethod === 'crypto' && (
                <div className="payment-details">
                  <div className="payment-details-title">📋 Crypto Payment Details</div>
                  <div className="payment-detail-row">
                    <span>Network</span>
                    <strong>{paymentSettings.crypto_network || 'Bitcoin (BTC)'}</strong>
                  </div>
                  <div className="payment-detail-row wallet-row">
                    <span>Wallet Address</span>
                    <div className="wallet-address-box">
                      {paymentSettings.crypto_wallet
                        ? <code>{paymentSettings.crypto_wallet}</code>
                        : <span className="muted-text">Wallet address not configured yet. Contact support.</span>
                      }
                      {paymentSettings.crypto_wallet && (
                        <button className="btn-copy" onClick={() => navigator.clipboard.writeText(paymentSettings.crypto_wallet)}>Copy</button>
                      )}
                    </div>
                  </div>
                  <p className="payment-note">⚠️ Send exactly <strong>{fmt(Number(investAmount))}</strong> worth of {paymentSettings.crypto_network || 'crypto'} to the address above. Your account will be activated after confirmation.</p>
                </div>
              )}

              {paymentSettings && payMethod === 'bank' && (
                <div className="payment-details">
                  <div className="payment-details-title">📋 Bank Transfer Details</div>
                  {paymentSettings.bank_name
                    ? <>
                        <div className="payment-detail-row"><span>Bank Name</span><strong>{paymentSettings.bank_name}</strong></div>
                        <div className="payment-detail-row"><span>Account Name</span><strong>{paymentSettings.bank_account_name}</strong></div>
                        <div className="payment-detail-row"><span>Account Number</span><strong>{paymentSettings.bank_account_number}</strong></div>
                        {paymentSettings.bank_routing && <div className="payment-detail-row"><span>Routing Number</span><strong>{paymentSettings.bank_routing}</strong></div>}
                        {paymentSettings.bank_swift && <div className="payment-detail-row"><span>SWIFT / BIC</span><strong>{paymentSettings.bank_swift}</strong></div>}
                      </>
                    : <p className="muted-text">Bank details not configured yet. Please contact support.</p>
                  }
                  <p className="payment-note">⚠️ Use your email <strong>{user?.email}</strong> as the payment reference. Your account will be activated after we confirm receipt.</p>
                </div>
              )}

              {planError && <div className="alert alert-error">{planError}</div>}
              <button
                className="btn-primary"
                onClick={handleConfirmInvestment}
                disabled={planLoading}
              >
                {planLoading ? 'Submitting…' : "✓ I've Sent the Funds — Confirm Investment"}
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
  const withdrawalFee = user.fee_required != null && Number(user.fee_required) >= 0
    ? Number(user.fee_required)
    : (paymentSettings?.withdrawal_fee ?? 0);
  const feePaid = Number(user.fee_paid ?? 0);
  const feeRemaining = Math.max(0, withdrawalFee - feePaid);
  const feeFullyPaid = withdrawalFee <= 0 || feePaid >= withdrawalFee;
  const feeProgress = withdrawalFee > 0 ? Math.min(100, (feePaid / withdrawalFee) * 100) : 100;

  const canWithdraw = user.withdrawal_approved && feeFullyPaid;

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

        {/* Investment status banner */}
        {user.investment_status === 'pending' && (
          <div className="inv-status-banner">
            <span className="inv-status-icon">⏳</span>
            <div>
              <strong>Investment Pending Confirmation</strong>
              <p>We're waiting to confirm your {user.payment_method === 'crypto' ? 'crypto transfer' : 'bank transfer'} of {user.investment_amount ? fmt(user.investment_amount) : ''} for your <strong>{user.plan}</strong> plan. Your dashboard will activate once confirmed.</p>
            </div>
          </div>
        )}

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
            <div className="card-value plan-val">{user.plan || '—'}</div>
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

            <div className={`gate gate-fee-card ${feeFullyPaid ? 'gate-ok' : 'gate-locked'}`}>
              <div className="gate-icon">{feeFullyPaid ? '✅' : '🔒'}</div>
              <div className="gate-fee-body">
                <div className="gate-fee-header">
                  <div>
                    <div className="gate-name">Withdrawal Processing Fee</div>
                    <div className="gate-desc">
                      {feeFullyPaid
                        ? `All processing fees (${fmt(withdrawalFee)}) have been paid in full. Withdrawal unlocked.`
                        : `A processing fee of ${fmt(withdrawalFee)} is required before withdrawals can be unlocked.`}
                    </div>
                  </div>
                  <div className={`gate-badge ${feeFullyPaid ? 'badge-ok' : 'badge-locked'}`}>
                    {feeFullyPaid ? '✅ Paid in Full' : '🔒 Locked'}
                  </div>
                </div>

                <div className="fee-progress-wrap">
                  <div className="fee-progress-header">
                    <span className="fee-progress-title">Fee Payment Progress</span>
                    <span className="fee-progress-pct">{feeProgress.toFixed(0)}% Paid</span>
                  </div>
                  <div className="fee-progress-bar">
                    <div
                      className={`fee-progress-fill ${feeFullyPaid ? 'fill-complete' : ''}`}
                      style={{ width: `${feeProgress}%` }}
                    />
                  </div>

                  <div className="fee-stats-grid">
                    <div className="fee-stat-box">
                      <span className="fee-stat-label">Total Fee Required</span>
                      <span className="fee-stat-value">{fmt(withdrawalFee)}</span>
                    </div>
                    <div className="fee-stat-box">
                      <span className="fee-stat-label">Amount Already Paid</span>
                      <span className="fee-stat-value text-profit">{fmt(feePaid)}</span>
                    </div>
                    <div className="fee-stat-box">
                      <span className="fee-stat-label">Remaining Balance Needed</span>
                      <span className={`fee-stat-value ${feeRemaining > 0 ? 'text-danger' : 'text-profit'}`}>
                        {fmt(feeRemaining)}
                      </span>
                    </div>
                    <div className="fee-stat-box">
                      <span className="fee-stat-label">Status</span>
                      <span className={`fee-status-badge ${feeFullyPaid ? 'status-paid' : 'status-locked'}`}>
                        {feeFullyPaid ? '✅ Paid in Full' : '🔒 Locked'}
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
              {/* Fixed withdrawal amount display */}
              <div className="withdrawal-amount-display">
                <div className="wd-label">Approved Withdrawal Amount</div>
                <div className="wd-amount">{fmt(netPayout)}</div>
                <div className="wd-breakdown">
                  <span>Total funds: <strong>{fmt(total)}</strong></span>
                  <span>Tax ({user.tax_percent}%): <strong style={{color:'#f87171'}}>−{fmt(tax)}</strong></span>
                  <span>You receive: <strong className="profit-val">{fmt(netPayout)}</strong></span>
                </div>
              </div>
              <form onSubmit={e => handleWithdrawal(e, netPayout)}>
                <div className="field">
                  <label>Your Wallet / Account Address</label>
                  <input type="text" placeholder="Enter your wallet address to receive funds"
                    value={wWallet} onChange={e => setWWallet(e.target.value)} required />
                </div>
                {wError && <div className="alert alert-error">{wError}</div>}
                {wSuccess && <div className="alert alert-success">{wSuccess}</div>}
                <button type="submit" className="btn-primary" disabled={wLoading}>
                  {wLoading ? 'Submitting…' : `Withdraw ${fmt(netPayout)} →`}
                </button>
              </form>
            </div>
          ) : (
            <div className="locked-box">
              <div className="locked-emoji">🔐</div>
              <h3>Withdrawal Locked</h3>
              <p>
                {feeRemaining > 0
                  ? `Please pay the remaining processing fee of ${fmt(feeRemaining)} to unlock your withdrawal.`
                  : !user.withdrawal_approved
                  ? 'Your processing fee is paid in full. Awaiting administrator approval to activate withdrawal.'
                  : 'Complete all requirements above to unlock your withdrawal.'}
              </p>
              {feeRemaining > 0 && (
                <button
                  type="button"
                  className="btn-primary"
                  style={{ maxWidth: '320px', margin: '18px auto 0' }}
                  onClick={() => setShowFeeModal(true)}
                >
                  💳 Pay Remaining Fee ({fmt(feeRemaining)}) →
                </button>
              )}
            </div>
          )}
        </section>

        {/* History */}
        {requests.length > 0 && (
          <section className="section">
            <h2 className="section-title">Withdrawal History</h2>
            <div className="history-table">
              {requests.map(r => {
                const btcAmt = btcPrice && btcPrice > 0 ? (r.amount_usd / btcPrice) : null;
                const dt = new Date(r.requested_at);
                const etOpts = { timeZone: 'America/New_York' } as const;
                const dateStr = dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', ...etOpts });
                const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short', ...etOpts });
                return (
                  <div
                    className="history-row-v2"
                    key={r.id}
                    onClick={() => setSelectedRequest(r)}
                    title="Click to view full details"
                  >
                    <div className="hist-left">
                      <div className="hist-usd">{fmt(r.amount_usd)}</div>
                      {btcAmt !== null && (
                        <div className="hist-btc">₿ {btcAmt.toFixed(8)} BTC</div>
                      )}
                    </div>
                    <div className="hist-center">
                      <div className="hist-wallet-full">{r.wallet_address}</div>
                      <div className="hist-datetime">📅 {dateStr} &nbsp;•&nbsp; 🕐 {timeStr}</div>
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
              <h3>💳 Pay Withdrawal Processing Fee</h3>
              <button className="modal-close" onClick={() => setShowFeeModal(false)}>✕</button>
            </div>
            <div className="modal-fee-content">
              <div className="modal-fee-summary">
                <div className="modal-fee-summary-row">
                  <span>Total Fee Required:</span>
                  <strong>{fmt(withdrawalFee)}</strong>
                </div>
                <div className="modal-fee-summary-row">
                  <span>Already Paid:</span>
                  <strong className="text-profit">{fmt(feePaid)}</strong>
                </div>
                <div className="modal-fee-summary-row highlight">
                  <span>Remaining Balance Needed:</span>
                  <strong className="text-danger">{fmt(feeRemaining)}</strong>
                </div>
              </div>

              {paymentSettings.crypto_wallet && (
                <div className="payment-details" style={{ marginTop: '16px' }}>
                  <div className="payment-details-title">₿ Crypto Payment</div>
                  <div className="payment-detail-row">
                    <span>Network</span>
                    <strong>{paymentSettings.crypto_network || 'Bitcoin (BTC)'}</strong>
                  </div>
                  <div className="payment-detail-row wallet-row">
                    <span>Wallet Address</span>
                    <div className="wallet-address-box">
                      <code>{paymentSettings.crypto_wallet}</code>
                      <button className="btn-copy" onClick={() => navigator.clipboard.writeText(paymentSettings.crypto_wallet)}>Copy</button>
                    </div>
                  </div>
                </div>
              )}

              {paymentSettings.bank_name && (
                <div className="payment-details" style={{ marginTop: '16px' }}>
                  <div className="payment-details-title">🏦 Bank Transfer</div>
                  <div className="payment-detail-row"><span>Bank Name</span><strong>{paymentSettings.bank_name}</strong></div>
                  <div className="payment-detail-row"><span>Account Name</span><strong>{paymentSettings.bank_account_name}</strong></div>
                  <div className="payment-detail-row"><span>Account Number</span><strong>{paymentSettings.bank_account_number}</strong></div>
                  {paymentSettings.bank_routing && <div className="payment-detail-row"><span>Routing Number</span><strong>{paymentSettings.bank_routing}</strong></div>}
                  {paymentSettings.bank_swift && <div className="payment-detail-row"><span>SWIFT / BIC</span><strong>{paymentSettings.bank_swift}</strong></div>}
                </div>
              )}

              <p className="payment-note" style={{ marginTop: '14px' }}>
                💡 After sending your fee payment of <strong>{fmt(feeRemaining)}</strong>, our administration team will update your account status and unlock your withdrawals immediately.
              </p>

              <button className="btn-primary" style={{ marginTop: '20px' }} onClick={() => setShowFeeModal(false)}>
                Done / Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Withdrawal Detail Modal */}
      {selectedRequest && (() => {
        const r = selectedRequest;
        const btcAmt = btcPrice && btcPrice > 0 ? (r.amount_usd / btcPrice) : null;
        const dt = new Date(r.requested_at);
        const etOpts = { timeZone: 'America/New_York' } as const;
        const dateStr = dt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', ...etOpts });
        const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short', ...etOpts });
        return (
          <div className="modal-overlay wd-detail-overlay" onClick={() => setSelectedRequest(null)}>
            <div className="modal-box wd-detail-box" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>📄 Withdrawal Details</h3>
                <button className="modal-close" onClick={() => setSelectedRequest(null)}>✕</button>
              </div>

              {/* Big amount hero */}
              <div className="wd-detail-hero">
                <div className="wd-detail-label">Amount Requested</div>
                <div className="wd-detail-usd">{fmt(r.amount_usd)}</div>
                {btcAmt !== null && (
                  <div className="wd-detail-btc">≈ ₿ {btcAmt.toFixed(8)} BTC</div>
                )}
                {btcPrice && (
                  <div className="wd-detail-rate">@ ${ btcPrice.toLocaleString()} / BTC</div>
                )}
              </div>

              {/* Details grid */}
              <div className="wd-detail-grid">
                <div className="wd-detail-row">
                  <span className="wd-detail-key">Status</span>
                  <span className={`status-badge status-${r.status}`} style={{fontSize:'13px'}}>{r.status}</span>
                </div>
                <div className="wd-detail-row">
                  <span className="wd-detail-key">Date</span>
                  <span className="wd-detail-val">{dateStr}</span>
                </div>
                <div className="wd-detail-row">
                  <span className="wd-detail-key">Time</span>
                  <span className="wd-detail-val">{timeStr}</span>
                </div>
                <div className="wd-detail-row wd-wallet-row">
                  <span className="wd-detail-key">Wallet Address</span>
                  <div className="wd-wallet-wrap">
                    <code className="wd-wallet-code">{r.wallet_address}</code>
                    <button
                      className="btn-copy"
                      onClick={() => navigator.clipboard.writeText(r.wallet_address)}
                    >Copy</button>
                  </div>
                </div>
                <div className="wd-detail-row">
                  <span className="wd-detail-key">Transaction ID</span>
                  <code className="wd-detail-val" style={{fontSize:'11px', opacity:0.6}}>{r.id}</code>
                </div>
              </div>

              <button className="btn-primary" style={{marginTop:'24px'}} onClick={() => setSelectedRequest(null)}>
                Close
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
