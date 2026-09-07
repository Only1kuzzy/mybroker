import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Ensure .env is resolved regardless of whether process started in broker/ or broker/backend/
const candidateEnvPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'backend/.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../backend/.env'),
];

for (const p of candidateEnvPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
  }
}

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { sendWithdrawalEmail, sendGeneralEmail, getSmtpConfig } from './mailer';

if (typeof (globalThis as any).WebSocket === 'undefined') {
  (globalThis as any).WebSocket = WebSocket;
}

const app = express();
app.use(cors({
  origin: (origin, callback) => callback(null, true),
  credentials: true,
}));
app.use(express.json());

const adminPath = fs.existsSync(path.resolve(process.cwd(), 'admin'))
  ? path.resolve(process.cwd(), 'admin')
  : fs.existsSync(path.resolve(process.cwd(), '../admin'))
  ? path.resolve(process.cwd(), '../admin')
  : path.resolve(__dirname, '../../admin');

app.use('/admin', express.static(adminPath));

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

function db() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error('Supabase credentials missing: please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment variables.');
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      transport: WebSocket as any,
    },
  });
}

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin-secret';

// ─── Middleware ────────────────────────────────────────────────────────────

function authMiddleware(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: string };
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminMiddleware(req: any, res: any, next: any) {
  if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// ─── Auth ──────────────────────────────────────────────────────────────────
 
app.post('/auth/register', async (req, res) => {
  try {
    const { email, fullName, password } = req.body;
    if (!email || !fullName || !password) {
      return res.status(400).json({ error: 'Email, full name and password are required' });
    }

    const supabase = db();

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { data: user, error } = await supabase
      .from('users')
      .insert({ email: email.toLowerCase(), full_name: fullName, password_hash: passwordHash })
      .select('id, email, full_name, balance_usd, profit_usd, plan, lock_until, withdrawal_approved, tax_percent, fee_paid, created_at')
      .single();

    if (error) {
      console.error('Register error:', error);
      return res.status(500).json({ error: 'Registration failed. Please try again.' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch (err: any) {
    console.error('Register unhandled error:', err);
    res.status(500).json({ error: err.message || 'Internal server error during registration' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const supabase = db();

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (error) {
      console.error('Login DB query error:', error);
      return res.status(500).json({ error: 'Database query failed' });
    }

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    const { password_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err: any) {
    console.error('Login unhandled error:', err);
    res.status(500).json({ error: err.message || 'Internal server error during login' });
  }
});

// ─── User ──────────────────────────────────────────────────────────────────

app.get('/user/me', authMiddleware, async (req: any, res) => {
  try {
    const { data: user, error } = await db()
      .from('users')
      .select('id, email, full_name, balance_usd, profit_usd, plan, lock_until, withdrawal_approved, tax_percent, fee_required, fee_paid, created_at')
      .eq('id', req.userId)
      .single();
    if (error) throw error;
    return res.json({ user });
  } catch {
    const { data: user, error } = await db()
      .from('users')
      .select('id, email, full_name, balance_usd, profit_usd, plan, lock_until, withdrawal_approved, tax_percent, fee_paid, created_at')
      .eq('id', req.userId)
      .single();
    if (error || !user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user });
  }
});

// ─── Investment Plan Submission ────────────────────────────────────────────

app.post('/investment/submit', authMiddleware, async (req: any, res) => {
  const { plan, amount, paymentMethod } = req.body;

  if (!plan || !amount || !paymentMethod) {
    return res.status(400).json({ error: 'Plan, amount and payment method are required' });
  }

  const validPlans = ['Starter', 'Growth', 'Elite'];
  if (!validPlans.includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan selected' });
  }

  if (!['crypto', 'bank'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'Invalid payment method' });
  }

  // Validate amount ranges
  const ranges: Record<string, [number, number]> = {
    Starter: [500, 5000],
    Growth: [6000, 15000],
    Elite: [16000, Infinity],
  };
  const [min, max] = ranges[plan];
  if (Number(amount) < min || Number(amount) > max) {
    return res.status(400).json({ error: `Amount must be between $${min.toLocaleString()} and ${max === Infinity ? 'above' : '$' + max.toLocaleString()} for the ${plan} plan` });
  }

  const supabase = db();

  // First try with new columns (requires migration to have been run)
  const updatePayload: any = { plan, balance_usd: Number(amount) };
  try {
    // Attempt to set new columns; will fail if migration not yet run
    const { data: user, error } = await supabase
      .from('users')
      .update({
        ...updatePayload,
        investment_amount: Number(amount),
        payment_method: paymentMethod,
        investment_status: 'pending',
      })
      .eq('id', req.userId)
      .select('id, email, full_name, balance_usd, profit_usd, plan, lock_until, withdrawal_approved, tax_percent, fee_paid, created_at')
      .single();

    if (error) throw error;
    res.json({ user });
  } catch (err: any) {
    // If new columns don't exist, fall back to updating only core columns
    if (err?.code === '42703') {
      const { data: user, error: fallbackError } = await supabase
        .from('users')
        .update(updatePayload)
        .eq('id', req.userId)
        .select('id, email, full_name, balance_usd, profit_usd, plan, lock_until, withdrawal_approved, tax_percent, fee_paid, created_at')
        .single();

      if (fallbackError) {
        console.error('Investment submit fallback error:', fallbackError);
        return res.status(500).json({ error: 'Failed to submit investment. Please try again.' });
      }
      return res.json({ user });
    }
    console.error('Investment submit error:', err);
    return res.status(500).json({ error: 'Failed to submit investment. Please try again.' });
  }
});

// ─── Payment Settings (public read) ────────────────────────────────────────

app.get('/settings/payment', async (_req, res) => {
  const supabase = db();
  const { data, error } = await supabase
    .from('payment_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) {
    // Return defaults if not configured yet
    return res.json({
      crypto_wallet: '',
      crypto_network: 'Bitcoin (BTC)',
      bank_name: '',
      bank_account_name: '',
      bank_account_number: '',
      bank_routing: '',
      bank_swift: '',
      withdrawal_fee: 0,
    });
  }

  res.json(data);
});

// ─── Admin: Payment Settings ────────────────────────────────────────────────

app.patch('/admin/settings/payment', adminMiddleware, async (req, res) => {
  const {
    crypto_wallet,
    crypto_network,
    bank_name,
    bank_account_name,
    bank_account_number,
    bank_routing,
    bank_swift,
    withdrawal_fee,
  } = req.body;

  const supabase = db();

  // Upsert row with id=1
  const { data, error } = await supabase
    .from('payment_settings')
    .upsert({
      id: 1,
      crypto_wallet,
      crypto_network,
      bank_name,
      bank_account_name,
      bank_account_number,
      bank_routing,
      bank_swift,
      withdrawal_fee: withdrawal_fee != null ? Number(withdrawal_fee) : 0,
    })
    .select()
    .single();

  if (error) {
    console.error('Settings update error:', error);
    return res.status(500).json({ error: 'Failed to update settings' });
  }

  res.json({ settings: data });
});

// ─── Withdrawals ───────────────────────────────────────────────────────────

app.post('/withdrawal/request', authMiddleware, async (req: any, res) => {
  const { amount, walletAddress } = req.body;
  if (!amount || !walletAddress) {
    return res.status(400).json({ error: 'Amount and wallet address are required' });
  }

  const supabase = db();
  const { data: user } = await supabase.from('users').select('*').eq('id', req.userId).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Gate 1: Admin approval
  if (!user.withdrawal_approved) {
    return res.status(403).json({ error: 'Withdrawal has not been approved by admin yet.' });
  }

  // Gate 2: Fee payment check
  const { data: settings } = await supabase.from('payment_settings').select('withdrawal_fee').eq('id', 1).maybeSingle();
  const reqFee = user.fee_required != null ? Number(user.fee_required) : Number(settings?.withdrawal_fee || 0);
  const paidFee = Number(user.fee_paid || 0);
  if (reqFee > 0 && paidFee < reqFee) {
    return res.status(403).json({ error: `Withdrawal locked. Remaining processing fee required: $${(reqFee - paidFee).toFixed(2)}.` });
  }

  // Gate 3: Balance check
  const total = Number(user.balance_usd) + Number(user.profit_usd);
  if (Number(amount) > total) {
    return res.status(400).json({ error: 'Amount exceeds available balance.' });
  }

  // No duplicate pending
  const { data: pending } = await supabase
    .from('withdrawal_requests')
    .select('id')
    .eq('user_id', req.userId)
    .eq('status', 'pending')
    .maybeSingle();

  if (pending) {
    return res.status(409).json({ error: 'You already have a pending withdrawal request.' });
  }

  const { data: request, error } = await supabase
    .from('withdrawal_requests')
    .insert({ user_id: req.userId, amount_usd: amount, wallet_address: walletAddress, status: 'pending' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Failed to submit withdrawal.' });
  res.status(201).json({ request });
});

app.get('/withdrawal/my-requests', authMiddleware, async (req: any, res) => {
  const { data: requests } = await db()
    .from('withdrawal_requests')
    .select('*')
    .eq('user_id', req.userId)
    .order('requested_at', { ascending: false });

  res.json({ requests: requests || [] });
});

// ─── Admin: Users ──────────────────────────────────────────────────────────

app.get('/admin/users', adminMiddleware, async (_req, res) => {
  try {
    const { data: users, error } = await db()
      .from('users')
      .select('id, email, full_name, balance_usd, profit_usd, plan, lock_until, withdrawal_approved, tax_percent, fee_required, fee_paid, investment_amount, payment_method, investment_status, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ users: users || [] });
  } catch {
    const { data: users } = await db()
      .from('users')
      .select('id, email, full_name, balance_usd, profit_usd, plan, lock_until, withdrawal_approved, tax_percent, fee_paid, investment_amount, payment_method, investment_status, created_at')
      .order('created_at', { ascending: false });
    return res.json({ users: users || [] });
  }
});

app.patch('/admin/users/:id/fee', adminMiddleware, async (req, res) => {
  const { fee_required, fee_paid, withdrawal_approved } = req.body;
  const updateData: any = {};
  if (fee_required !== undefined) {
    updateData.fee_required = fee_required === null || fee_required === '' ? null : Math.max(0, Number(fee_required));
  }
  if (fee_paid !== undefined) {
    updateData.fee_paid = Math.max(0, Number(fee_paid));
  }
  if (withdrawal_approved !== undefined) {
    updateData.withdrawal_approved = Boolean(withdrawal_approved);
  }

  try {
    const { data, error } = await db()
      .from('users')
      .update(updateData)
      .eq('id', req.params.id)
      .select('id, email, fee_required, fee_paid')
      .single();
    if (error) throw error;
    return res.json({ user: data });
  } catch (err: any) {
    // If fee_required column is not present in Supabase table yet, update fee_paid only
    if (updateData.fee_paid !== undefined) {
      const { data } = await db()
        .from('users')
        .update({ fee_paid: updateData.fee_paid })
        .eq('id', req.params.id)
        .select('id, email, fee_paid')
        .single();
      return res.json({ user: data });
    }
    return res.status(500).json({ error: 'Update failed' });
  }
});

app.patch('/admin/users/:id/fee-paid', adminMiddleware, async (req, res) => {
  const { fee_paid } = req.body;
  if (fee_paid == null || isNaN(Number(fee_paid)) || Number(fee_paid) < 0) {
    return res.status(400).json({ error: 'fee_paid must be a non-negative number' });
  }
  try {
    const { data, error } = await db()
      .from('users')
      .update({ fee_paid: Number(fee_paid) })
      .eq('id', req.params.id)
      .select('id, email, fee_required, fee_paid')
      .single();
    if (error) throw error;
    return res.json({ user: data });
  } catch {
    const { data } = await db()
      .from('users')
      .update({ fee_paid: Number(fee_paid) })
      .eq('id', req.params.id)
      .select('id, email, fee_paid')
      .single();
    return res.json({ user: data });
  }
});

app.patch('/admin/users/:id/balance', adminMiddleware, async (req, res) => {
  const { balance_usd, profit_usd } = req.body;
  const { data, error } = await db()
    .from('users')
    .update({ balance_usd, profit_usd })
    .eq('id', req.params.id)
    .select('id, email, balance_usd, profit_usd')
    .single();

  if (error) return res.status(500).json({ error: 'Update failed' });
  res.json({ user: data });
});

app.patch('/admin/users/:id/plan', adminMiddleware, async (req, res) => {
  const { plan, lock_until } = req.body;
  const { data, error } = await db()
    .from('users')
    .update({ plan, lock_until })
    .eq('id', req.params.id)
    .select('id, email, plan, lock_until')
    .single();

  if (error) return res.status(500).json({ error: 'Update failed' });
  res.json({ user: data });
});

app.patch('/admin/users/:id/tax', adminMiddleware, async (req, res) => {
  const { tax_percent } = req.body;
  const { data, error } = await db()
    .from('users')
    .update({ tax_percent })
    .eq('id', req.params.id)
    .select('id, email, tax_percent')
    .single();

  if (error) return res.status(500).json({ error: 'Update failed' });
  res.json({ user: data });
});

app.patch('/admin/users/:id/approve', adminMiddleware, async (req, res) => {
  const { withdrawal_approved } = req.body;
  const { data, error } = await db()
    .from('users')
    .update({ withdrawal_approved })
    .eq('id', req.params.id)
    .select('id, email, withdrawal_approved')
    .single();

  if (error) return res.status(500).json({ error: 'Update failed' });
  res.json({ user: data });
});

app.patch('/admin/users/:id/investment-status', adminMiddleware, async (req, res) => {
  const { investment_status } = req.body;
  const { data, error } = await db()
    .from('users')
    .update({ investment_status })
    .eq('id', req.params.id)
    .select('id, email, investment_status')
    .single();

  if (error) return res.status(500).json({ error: 'Update failed' });
  res.json({ user: data });
});

// ─── Admin: Withdrawals ────────────────────────────────────────────────────

app.get('/admin/withdrawals', adminMiddleware, async (_req, res) => {
  const { data: requests } = await db()
    .from('withdrawal_requests')
    .select('*, users(email, full_name)')
    .order('requested_at', { ascending: false });

  res.json({ requests: requests || [] });
});

app.patch('/admin/withdrawals/:id', adminMiddleware, async (req, res) => {
  const {
    status,
    send_email = true,
    recipient_email,
    subject,
    delay_reason,
    custom_message,
    tx_hash,
  } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved or rejected' });
  }

  const { data, error } = await db()
    .from('withdrawal_requests')
    .update({ status, resolved_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('*, users(id, email, full_name)')
    .single();

  if (error) return res.status(500).json({ error: 'Update failed' });

  let emailResult: { success: boolean; error?: string } = { success: false, error: 'Email skipped' };

  const targetEmail = (recipient_email && recipient_email.trim()) ? recipient_email.trim() : data?.users?.email;

  if (send_email && targetEmail) {
    emailResult = await sendWithdrawalEmail({
      to: targetEmail,
      fullName: data?.users?.full_name,
      amount: data?.amount_usd,
      walletAddress: data?.wallet_address,
      status,
      subject,
      delayReason: delay_reason,
      customMessage: custom_message,
      txHash: tx_hash,
    });
  }

  res.json({
    request: data,
    recipient: targetEmail,
    email_sent: emailResult.success,
    email_error: emailResult.error,
  });
});

app.post('/admin/withdrawals/:id/notify', adminMiddleware, async (req, res) => {
  const {
    recipient_email,
    subject,
    delay_reason,
    custom_message,
    tx_hash,
    status,
  } = req.body;

  const { data, error } = await db()
    .from('withdrawal_requests')
    .select('*, users(id, email, full_name)')
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Withdrawal request not found' });
  
  const targetEmail = (recipient_email && recipient_email.trim()) ? recipient_email.trim() : data.users?.email;
  if (!targetEmail) return res.status(400).json({ error: 'User does not have an email address and no recipient was provided' });

  const emailResult = await sendWithdrawalEmail({
    to: targetEmail,
    fullName: data.users?.full_name,
    amount: data.amount_usd,
    walletAddress: data.wallet_address,
    status: status || data.status || 'approved',
    subject,
    delayReason: delay_reason,
    customMessage: custom_message,
    txHash: tx_hash,
  });

  if (!emailResult.success) {
    return res.status(500).json({ error: emailResult.error || 'Failed to send notification email' });
  }

  res.json({ success: true, message: `Notification email sent successfully to ${targetEmail}` });
});

// ─── Admin: SMTP & Email Management ───────────────────────────────────────

app.get('/admin/smtp/status', adminMiddleware, (_req, res) => {
  const config = getSmtpConfig();
  res.json({
    configured: config.configured,
    host: config.host,
    port: config.port,
    secure: config.secure,
    sender: config.user,
    from: config.from,
  });
});

app.post('/admin/smtp/test', adminMiddleware, async (req, res) => {
  const { recipient_email } = req.body;
  const config = getSmtpConfig();
  if (!config.configured) {
    return res.status(400).json({
      error: 'SMTP credentials not configured in backend environment. Please configure SMTP_USER and SMTP_PASS.',
    });
  }

  const targetEmail = recipient_email?.trim() || config.user;
  if (!targetEmail) {
    return res.status(400).json({ error: 'Please specify a recipient email address for the test.' });
  }

  const result = await sendGeneralEmail({
    to: targetEmail,
    fullName: 'Crypto Vault Admin',
    subject: 'Crypto Vault — SMTP Configuration Test',
    message: `Hello! This is a test email confirming that your Crypto Vault SMTP mailer (${config.host}) is working properly and ready to dispatch real withdrawal updates and investor notifications.\n\nSender: ${config.user}\nTimestamp: ${new Date().toUTCString()}`,
  });

  if (!result.success) {
    return res.status(500).json({ error: result.error || 'Failed to send test email' });
  }

  res.json({ success: true, message: `Test email sent successfully to ${targetEmail}!` });
});

app.post('/admin/users/:id/email', adminMiddleware, async (req, res) => {
  const { recipient_email, subject, message } = req.body;

  const { data: user, error } = await db()
    .from('users')
    .select('id, email, full_name')
    .eq('id', req.params.id)
    .single();

  if (error || !user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const targetEmail = (recipient_email && recipient_email.trim()) ? recipient_email.trim() : user.email;
  if (!targetEmail) {
    return res.status(400).json({ error: 'User does not have an email and no custom recipient was provided.' });
  }
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Email message content is required.' });
  }

  const result = await sendGeneralEmail({
    to: targetEmail,
    fullName: user.full_name || 'Valued Investor',
    subject: subject?.trim() || 'Important Update Regarding Your Crypto Vault Portfolio',
    message: message.trim(),
  });

  if (!result.success) {
    return res.status(500).json({ error: result.error || 'Failed to send email' });
  }

  res.json({ success: true, message: `Email successfully dispatched to ${targetEmail}` });
});

// ─── Misc ──────────────────────────────────────────────────────────────────

app.get('/price', async (_req, res) => {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: { ids: 'bitcoin', vs_currencies: 'usd' }
    });
    const usd = response.data?.bitcoin?.usd;
    if (usd == null) return res.status(502).json({ error: 'Price response missing' });
    res.json({ usd });
  } catch {
    res.status(502).json({ error: 'Unable to fetch price' });
  }
});

app.get('/health', (_req, res) => {
  const supabaseOk = Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  res.json({
    status: 'ok',
    supabaseConfigured: supabaseOk,
    jwtConfigured: Boolean(process.env.JWT_SECRET),
  });
});

// Express error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('Unhandled express error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: err?.message || 'Internal server error' });
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err);
});

// Export for Vercel serverless runtime
export default app;

// Only listen when running locally (not on Vercel)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend running on port ${PORT}`);
  });
}
