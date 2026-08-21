import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors({
  origin: (origin, callback) => callback(null, true),
  credentials: true,
}));
app.use(express.json());

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

function db() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
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
    .select('id, email, full_name, balance_usd, profit_usd, plan, lock_until, withdrawal_approved, tax_percent, created_at')
    .single();

  if (error) {
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({ token, user });
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const supabase = db();

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  const { password_hash, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

// ─── User ──────────────────────────────────────────────────────────────────

app.get('/user/me', authMiddleware, async (req: any, res) => {
  const { data: user, error } = await db()
    .from('users')
    .select('id, email, full_name, balance_usd, profit_usd, plan, lock_until, withdrawal_approved, tax_percent, created_at')
    .eq('id', req.userId)
    .single();

  if (error || !user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
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

  // Gate 1: Time lock
  if (user.lock_until && new Date(user.lock_until) > new Date()) {
    return res.status(403).json({ error: 'Your funds are still under the lock period.' });
  }

  // Gate 2: Admin approval
  if (!user.withdrawal_approved) {
    return res.status(403).json({ error: 'Withdrawal has not been approved by admin yet.' });
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
  const { data: users } = await db()
    .from('users')
    .select('id, email, full_name, balance_usd, profit_usd, plan, lock_until, withdrawal_approved, tax_percent, created_at')
    .order('created_at', { ascending: false });

  res.json({ users: users || [] });
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

// ─── Admin: Withdrawals ────────────────────────────────────────────────────

app.get('/admin/withdrawals', adminMiddleware, async (_req, res) => {
  const { data: requests } = await db()
    .from('withdrawal_requests')
    .select('*, users(email, full_name)')
    .order('requested_at', { ascending: false });

  res.json({ requests: requests || [] });
});

app.patch('/admin/withdrawals/:id', adminMiddleware, async (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved or rejected' });
  }

  const { data, error } = await db()
    .from('withdrawal_requests')
    .update({ status, resolved_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Update failed' });
  res.json({ request: data });
});

// ─── Misc ──────────────────────────────────────────────────────────────────

app.get('/price', async (_req, res) => {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: { ids: 'ethereum', vs_currencies: 'usd' }
    });
    const usd = response.data?.ethereum?.usd;
    if (usd == null) return res.status(502).json({ error: 'Price response missing' });
    res.json({ usd });
  } catch {
    res.status(502).json({ error: 'Unable to fetch price' });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Export for Vercel serverless runtime
export default app;

// Only listen when running locally (not on Vercel)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
  });
}
