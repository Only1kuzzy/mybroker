/* ─────────────────────────────────────────────────────────────────
   CryptoVault Admin Panel — app.js
   ───────────────────────────────────────────────────────────────── */

let API = '';
let SECRET = '';

// ── Auth ──────────────────────────────────────────────────────────

async function doLogin() {
  const url    = document.getElementById('inp-url').value.trim().replace(/\/$/, '');
  const secret = document.getElementById('inp-secret').value.trim();
  const errEl  = document.getElementById('login-err');
  const btn    = document.getElementById('login-btn');

  if (!url || !secret) { showLoginErr('Please fill in both fields.'); return; }

  btn.textContent = 'Connecting…';
  btn.disabled = true;
  errEl.classList.add('hidden');

  try {
    const res = await fetch(`${url}/admin/users`, {
      headers: { 'x-admin-secret': secret }
    });
    if (res.status === 403) throw new Error('Wrong admin secret.');
    if (!res.ok) throw new Error(`Server returned ${res.status}.`);

    API = url; SECRET = secret;
    localStorage.setItem('cv_admin_url', url);
    localStorage.setItem('cv_admin_secret', secret);
    openDashboard();
  } catch (err) {
    showLoginErr(err.message || 'Could not connect. Check the URL and secret.');
    btn.textContent = 'Access Dashboard';
    btn.disabled = false;
  }
}

function showLoginErr(msg) {
  const el = document.getElementById('login-err');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function doLogout() {
  localStorage.removeItem('cv_admin_url');
  localStorage.removeItem('cv_admin_secret');
  API = ''; SECRET = '';
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('dashboard').classList.add('hidden');
}

function openDashboard() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  loadUsers();
}

// Auto-restore session on page load
window.addEventListener('DOMContentLoaded', () => {
  const savedUrl    = localStorage.getItem('cv_admin_url');
  const savedSecret = localStorage.getItem('cv_admin_secret');
  if (savedUrl && savedSecret) {
    document.getElementById('inp-url').value    = savedUrl;
    document.getElementById('inp-secret').value = savedSecret;
    API = savedUrl; SECRET = savedSecret;
    fetch(`${API}/admin/users`, { headers: { 'x-admin-secret': SECRET } })
      .then(r => r.ok ? openDashboard() : null)
      .catch(() => {});
  }

  // Enter key on inputs
  document.getElementById('inp-secret').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  // Escape closes modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
});

// ── Tabs ──────────────────────────────────────────────────────────

function switchTab(name, btn) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.remove('hidden');
  btn.classList.add('active');
  if (name === 'users') loadUsers();
  if (name === 'withdrawals') loadWithdrawals();
}

// ── Users ─────────────────────────────────────────────────────────

async function loadUsers() {
  setState('users', 'Loading users…');
  try {
    const res = await fetch(`${API}/admin/users`, {
      headers: { 'x-admin-secret': SECRET }
    });
    if (!res.ok) throw new Error();
    const { users } = await res.json();
    renderUsers(users || []);
  } catch {
    setState('users', 'Failed to load users. Check connection and try again.');
  }
}

function renderUsers(users) {
  const tbody = document.getElementById('users-body');
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No users registered yet.</td></tr>';
  } else {
    tbody.innerHTML = users.map(u => {
      const lockDate = u.lock_until ? new Date(u.lock_until).toLocaleDateString() : '—';
      const approvedLabel = u.withdrawal_approved ? 'Approved' : 'Locked';
      const approvedClass = u.withdrawal_approved ? 'badge-approved' : 'badge-locked';
      const toggleLabel   = u.withdrawal_approved ? 'Revoke' : 'Approve';
      const toggleClass   = u.withdrawal_approved ? 'btn-act-danger' : 'btn-act-approve';
      return `<tr>
        <td>
          <div class="investor-cell">
            <span class="investor-name">${esc(u.full_name)}</span>
            <span class="investor-email">${esc(u.email)}</span>
          </div>
        </td>
        <td class="amount">$${Number(u.balance_usd).toFixed(2)}</td>
        <td class="amount amount-profit">+$${Number(u.profit_usd).toFixed(2)}</td>
        <td><span class="badge badge-plan">${esc(u.plan)}</span></td>
        <td class="cell-muted">${lockDate}</td>
        <td class="cell-muted">${u.tax_percent}%</td>
        <td><span class="badge ${approvedClass}">${approvedLabel}</span></td>
        <td>
          <div class="actions">
            <button class="btn-act btn-act-edit" onclick="openBalanceModal('${u.id}','${esc(u.full_name)}',${u.balance_usd},${u.profit_usd})">Balance</button>
            <button class="btn-act btn-act-edit" onclick="openPlanModal('${u.id}','${esc(u.full_name)}','${esc(u.plan)}','${u.lock_until||''}')">Plan</button>
            <button class="btn-act btn-act-edit" onclick="openTaxModal('${u.id}','${esc(u.full_name)}',${u.tax_percent})">Tax</button>
            <button class="btn-act ${toggleClass}" onclick="toggleApproval('${u.id}',${u.withdrawal_approved})">${toggleLabel}</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }
  showContent('users');
}

async function toggleApproval(id, current) {
  await apiPatch(`/admin/users/${id}/approve`, { withdrawal_approved: !current });
  loadUsers();
}

// ── Withdrawals ───────────────────────────────────────────────────

async function loadWithdrawals() {
  setState('withdrawals', 'Loading withdrawal requests…');
  try {
    const res = await fetch(`${API}/admin/withdrawals`, {
      headers: { 'x-admin-secret': SECRET }
    });
    if (!res.ok) throw new Error();
    const { requests } = await res.json();
    renderWithdrawals(requests || []);
  } catch {
    setState('withdrawals', 'Failed to load. Try refreshing.');
  }
}

function renderWithdrawals(requests) {
  const tbody = document.getElementById('withdrawals-body');
  if (requests.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No withdrawal requests yet.</td></tr>';
  } else {
    tbody.innerHTML = requests.map(r => {
      const user = r.users || {};
      const date = new Date(r.requested_at).toLocaleDateString();
      const isPending = r.status === 'pending';
      return `<tr>
        <td>
          <div class="investor-cell">
            <span class="investor-name">${esc(user.full_name || '—')}</span>
            <span class="investor-email">${esc(user.email || '—')}</span>
          </div>
        </td>
        <td class="amount">$${Number(r.amount_usd).toFixed(2)}</td>
        <td class="mono">${esc(r.wallet_address)}</td>
        <td class="cell-muted">${date}</td>
        <td><span class="badge badge-${r.status}">${r.status}</span></td>
        <td>
          ${isPending
            ? `<div class="actions">
                <button class="btn-act btn-act-approve" onclick="resolveW('${r.id}','approved')">Approve</button>
                <button class="btn-act btn-act-danger"  onclick="resolveW('${r.id}','rejected')">Reject</button>
               </div>`
            : '<span class="cell-muted">—</span>'
          }
        </td>
      </tr>`;
    }).join('');
  }
  showContent('withdrawals');
}

async function resolveW(id, status) {
  await apiPatch(`/admin/withdrawals/${id}`, { status });
  loadWithdrawals();
}

// ── Modals ────────────────────────────────────────────────────────

function openBalanceModal(id, name, balance, profit) {
  setModal(`Set Balance — ${name}`, `
    <div class="field"><label>Balance (USD)</label>
      <input type="number" id="m-bal" value="${balance}" min="0" step="0.01" /></div>
    <div class="field"><label>Profit (USD)</label>
      <input type="number" id="m-pft" value="${profit}" min="0" step="0.01" /></div>
    <p class="modal-hint">These values will be immediately visible on the user's dashboard.</p>
    <button class="btn-primary" onclick="saveBalance('${id}')">Save Changes</button>
  `);
}

async function saveBalance(id) {
  const balance_usd = parseFloat(document.getElementById('m-bal').value);
  const profit_usd  = parseFloat(document.getElementById('m-pft').value);
  await apiPatch(`/admin/users/${id}/balance`, { balance_usd, profit_usd });
  closeModal(); loadUsers();
}

function openPlanModal(id, name, plan, lockUntil) {
  const lockVal = lockUntil ? lockUntil.slice(0, 10) : '';
  setModal(`Set Plan — ${name}`, `
    <div class="field"><label>Plan Name</label>
      <input type="text" id="m-plan" value="${esc(plan)}" placeholder="e.g. Basic, Growth, Diamond" /></div>
    <div class="field"><label>Lock Until Date</label>
      <input type="date" id="m-lock" value="${lockVal}" /></div>
    <p class="modal-hint">Leave the date empty to remove the lock period.</p>
    <button class="btn-primary" onclick="savePlan('${id}')">Save Changes</button>
  `);
}

async function savePlan(id) {
  const plan      = document.getElementById('m-plan').value.trim();
  const lockRaw   = document.getElementById('m-lock').value;
  const lock_until = lockRaw ? new Date(lockRaw).toISOString() : null;
  await apiPatch(`/admin/users/${id}/plan`, { plan, lock_until });
  closeModal(); loadUsers();
}

function openTaxModal(id, name, tax) {
  setModal(`Set Tax — ${name}`, `
    <div class="field"><label>Tax / Fee Percentage (%)</label>
      <input type="number" id="m-tax" value="${tax}" min="0" max="100" step="0.5" /></div>
    <p class="modal-hint">This percentage is deducted from the user's withdrawal amount before payout.</p>
    <button class="btn-primary" onclick="saveTax('${id}')">Save Changes</button>
  `);
}

async function saveTax(id) {
  const tax_percent = parseFloat(document.getElementById('m-tax').value);
  await apiPatch(`/admin/users/${id}/tax`, { tax_percent });
  closeModal(); loadUsers();
}

function setModal(title, bodyHTML) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modal')) closeModal();
}

// ── API helper ────────────────────────────────────────────────────

async function apiPatch(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': SECRET },
    body: JSON.stringify(body)
  });
  return res.json();
}

// ── UI helpers ────────────────────────────────────────────────────

function setState(section, msg) {
  document.getElementById(`${section}-state`).textContent = msg;
  document.getElementById(`${section}-state`).classList.remove('hidden');
  document.getElementById(`${section}-wrap`).classList.add('hidden');
}

function showContent(section) {
  document.getElementById(`${section}-state`).classList.add('hidden');
  document.getElementById(`${section}-wrap`).classList.remove('hidden');
}

function esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}
