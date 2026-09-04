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
  } else {
    document.getElementById('inp-url').value = window.location.origin.startsWith('http') ? window.location.origin : 'http://localhost:4000';
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
  if (name === 'settings') loadSettings();
}

// ── Users ─────────────────────────────────────────────────────────

async function loadUsers() {
  setState('users', 'Loading users…');
  try {
    // Also load payment settings to get platform default withdrawal fee
    try {
      const sRes = await fetch(`${API}/settings/payment`);
      if (sRes.ok) {
        const sData = await sRes.json();
        window.defaultWithdrawalFee = sData.withdrawal_fee != null ? Number(sData.withdrawal_fee) : 0;
      }
    } catch {}

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
    tbody.innerHTML = '<tr><td colspan="14" class="empty-cell">No users registered yet.</td></tr>';
  } else {
    tbody.innerHTML = users.map(u => {
      const approvedLabel = u.withdrawal_approved ? 'Approved' : 'Locked';
      const approvedClass = u.withdrawal_approved ? 'badge-approved' : 'badge-locked';
      const toggleLabel   = u.withdrawal_approved ? 'Revoke' : 'Approve';
      const toggleClass   = u.withdrawal_approved ? 'btn-act-danger' : 'btn-act-approve';

      const invStatus = u.investment_status || '—';
      const invStatusClass = invStatus === 'active' ? 'badge-approved' : invStatus === 'pending' ? 'badge-pending' : 'badge-locked';
      const invActivateLabel = invStatus === 'pending' ? 'Activate' : invStatus === 'active' ? 'Deactivate' : 'Activate';
      const invActivateClass = invStatus === 'active' ? 'btn-act-danger' : 'btn-act-approve';
      const nextStatus = invStatus === 'active' ? 'inactive' : 'active';

      const feeReq = u.fee_required != null ? Number(u.fee_required) : Number(window.defaultWithdrawalFee || 0);
      const feePaid = Number(u.fee_paid || 0);
      const feeRem = Math.max(0, feeReq - feePaid);
      const feeRemColor = feeRem > 0 ? 'color: #f87171;' : 'color: var(--profit);';

      return `<tr>
        <td>
          <div class="investor-cell">
            <span class="investor-name">${esc(u.full_name)}</span>
            <span class="investor-email">${esc(u.email)}</span>
          </div>
        </td>
        <td class="amount">$${Number(u.balance_usd).toFixed(2)}</td>
        <td class="amount amount-profit">+$${Number(u.profit_usd).toFixed(2)}</td>
        <td><span class="badge badge-plan">${esc(u.plan || '—')}</span></td>
        <td class="amount">${u.investment_amount ? '$' + Number(u.investment_amount).toFixed(2) : '—'}</td>
        <td class="cell-muted">${esc(u.payment_method || '—')}</td>
        <td>
          <span class="badge ${invStatusClass}">${invStatus}</span>
        </td>
        <td class="cell-muted">${u.tax_percent}%</td>
        <td class="amount">$${feeReq.toFixed(2)}</td>
        <td class="amount" style="color: var(--profit);">$${feePaid.toFixed(2)}</td>
        <td class="amount" style="${feeRemColor}">$${feeRem.toFixed(2)}</td>
        <td><span class="badge ${approvedClass}">${approvedLabel}</span></td>
        <td>
          <div class="actions">
            <button class="btn-act btn-act-edit" onclick="openBalanceModal('${u.id}','${esc(u.full_name)}',${u.balance_usd},${u.profit_usd})">Balance</button>
            <button class="btn-act btn-act-edit" onclick="openPlanModal('${u.id}','${esc(u.full_name)}','${esc(u.plan || '')}')">Plan</button>
            <button class="btn-act btn-act-edit" onclick="openTaxModal('${u.id}','${esc(u.full_name)}',${u.tax_percent})">Tax</button>
            <button class="btn-act btn-act-fee" onclick="openFeeModal('${u.id}','${esc(u.full_name)}',${u.fee_required != null ? u.fee_required : 'null'},${u.fee_paid || 0},${u.withdrawal_approved})">💳 Fee & Unlock</button>
            <button class="btn-act ${invActivateClass}" onclick="toggleInvestmentStatus('${u.id}','${nextStatus}')">${invActivateLabel}</button>
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

async function toggleInvestmentStatus(id, newStatus) {
  await apiPatch(`/admin/users/${id}/investment-status`, { investment_status: newStatus });
  loadUsers();
}

// ── Withdrawals ───────────────────────────────────────────────────

window.withdrawalRequestsMap = {};

const REASON_PRESETS = {
  instant: {
    label: '⚡ Instant / Dispatched',
    subject: 'Withdrawal Processed & Dispatched',
    text: 'Your withdrawal request has been approved and successfully dispatched to your address.'
  },
  delay_blockchain: {
    label: '⏳ Blockchain Delay (1–3h)',
    subject: 'Withdrawal In Transit - Network Confirmation Delay',
    text: 'Your withdrawal has been approved and broadcasted to the blockchain. Due to current high network gas congestion, it may take 1–3 hours for block confirmations to reflect in your destination wallet.'
  },
  delay_bank: {
    label: '🏦 Banking Clearing (24–48h)',
    subject: 'Withdrawal Initiated - Banking Clearing Window',
    text: 'Your payout transfer has been initiated. International bank wire routing and intermediary clearance typically take 24–48 business hours to reflect in your bank account.'
  },
  security_hold: {
    label: '🛡️ Multi-Sig Clearance',
    subject: 'Withdrawal Approved - Security Processing',
    text: 'Your withdrawal has passed initial review and is undergoing final multi-signature cold storage clearance. Funds will reflect in your account shortly.'
  },
  verification: {
    label: '📋 Regulatory / Compliance',
    subject: 'Withdrawal Status - Processing Clearance',
    text: 'Your withdrawal is being processed pending final identity and regulatory clearance check.'
  },
  custom: {
    label: '✏️ Custom Note',
    subject: 'Withdrawal Status Update',
    text: ''
  }
};

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
  window.withdrawalRequestsMap = {};
  const tbody = document.getElementById('withdrawals-body');
  if (requests.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No withdrawal requests yet.</td></tr>';
  } else {
    tbody.innerHTML = requests.map(r => {
      window.withdrawalRequestsMap[r.id] = r;
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
                <button class="btn-act btn-act-approve" onclick="openWithdrawalModal('${r.id}','approved')">Approve & Notify</button>
                <button class="btn-act btn-act-danger"  onclick="openWithdrawalModal('${r.id}','rejected')">Reject</button>
               </div>`
            : `<div class="actions">
                <button class="btn-act btn-act-fee" onclick="openWithdrawalModal('${r.id}','${r.status}',true)">✉️ Notify User</button>
               </div>`
          }
        </td>
      </tr>`;
    }).join('');
  }
  showContent('withdrawals');
}

function openWithdrawalModal(id, targetStatus, isNotifyOnly = false) {
  const req = window.withdrawalRequestsMap[id];
  if (!req) return;

  const user = req.users || {};
  const userName = user.full_name || 'Investor';
  const userEmail = user.email || '—';
  const amount = Number(req.amount_usd).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const isApproved = targetStatus === 'approved';

  const defaultPreset = isApproved ? 'delay_blockchain' : 'custom';
  const initialPresetData = REASON_PRESETS[defaultPreset] || REASON_PRESETS.instant;

  const title = isNotifyOnly
    ? `Send Withdrawal Notice — ${userName}`
    : `${isApproved ? 'Approve' : 'Reject'} Withdrawal — ${userName}`;

  const presetChipsHtml = Object.entries(REASON_PRESETS).map(([key, p]) => {
    const isActive = key === defaultPreset;
    return `<button type="button" class="preset-chip ${isActive ? 'active' : ''}" onclick="applyReasonPreset('${key}')">${p.label}</button>`;
  }).join('');

  setModal(title, `
    <div class="modal-info-box">
      <div class="modal-info-row">
        <span class="modal-info-label">Investor:</span>
        <span class="modal-info-val">${esc(userName)} (${esc(userEmail)})</span>
      </div>
      <div class="modal-info-row">
        <span class="modal-info-label">Amount:</span>
        <span class="modal-info-val highlight">${amount}</span>
      </div>
      <div class="modal-info-row">
        <span class="modal-info-label">Destination:</span>
        <span class="modal-info-val" style="font-family: monospace; font-size: 11px;">${esc(req.wallet_address)}</span>
      </div>
      ${!isNotifyOnly ? `
        <div class="modal-info-row">
          <span class="modal-info-label">Action:</span>
          <span class="modal-info-val"><span class="badge badge-${targetStatus}">${targetStatus.toUpperCase()}</span></span>
        </div>
      ` : ''}
    </div>

    <label class="toggle-field">
      <input type="checkbox" id="w-send-email" checked onchange="toggleEmailFields()" />
      <span style="font-weight: 500; font-size: 13px; color: var(--text);">Send Email Notification to ${esc(userEmail)}</span>
    </label>

    <div id="w-email-fields">
      <div class="field">
        <label>Email Subject</label>
        <input type="text" id="w-subject" value="${esc(initialPresetData.subject)}" placeholder="e.g. Withdrawal Processed & Dispatched" />
      </div>

      <div class="field">
        <label>Delivery Status / Reason Funds Haven't Landed Yet</label>
        <div class="presets-grid" id="presets-container">
          ${presetChipsHtml}
        </div>
        <textarea id="w-reason" placeholder="Explain delivery timeline, blockchain confirmation delays, banking clearing windows, or verification steps...">${esc(initialPresetData.text)}</textarea>
        <span class="modal-hint" style="margin-top: 4px; margin-bottom: 0;">This explanation will be prominently highlighted in the receiver's email.</span>
      </div>

      <div class="field">
        <label>Transaction Reference / Hash (Optional)</label>
        <input type="text" id="w-txhash" placeholder="e.g. 0x8a92f7... or TXN-49219" />
      </div>

      <div class="field">
        <label>Additional Note for User (Optional)</label>
        <textarea id="w-custom-note" style="min-height: 60px;" placeholder="Any extra instructions, support links, or comments..."></textarea>
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn-primary" id="w-submit-btn" onclick="submitWithdrawalModal('${id}', '${targetStatus}', ${Boolean(isNotifyOnly)})">
        ${isNotifyOnly ? '✉️ Send Notification Email' : `Confirm ${isApproved ? 'Approval' : 'Rejection'} & Send Email`}
      </button>
      ${!isNotifyOnly ? `
        <button class="btn-secondary" onclick="submitWithdrawalWithoutEmail('${id}', '${targetStatus}')">
          ${isApproved ? 'Approve' : 'Reject'} Only
        </button>
      ` : ''}
    </div>
  `);
}

function applyReasonPreset(presetKey) {
  const preset = REASON_PRESETS[presetKey];
  if (!preset) return;

  const reasonEl = document.getElementById('w-reason');
  const subjectEl = document.getElementById('w-subject');

  if (reasonEl) reasonEl.value = preset.text;
  if (subjectEl && preset.subject) subjectEl.value = preset.subject;

  // Update active chip UI
  const chips = document.querySelectorAll('#presets-container .preset-chip');
  chips.forEach(chip => {
    if (chip.textContent.trim() === preset.label.trim()) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

function toggleEmailFields() {
  const isChecked = document.getElementById('w-send-email').checked;
  const fields = document.getElementById('w-email-fields');
  const submitBtn = document.getElementById('w-submit-btn');

  if (fields) {
    fields.style.opacity = isChecked ? '1' : '0.4';
    fields.style.pointerEvents = isChecked ? 'auto' : 'none';
  }
}

async function submitWithdrawalModal(id, targetStatus, isNotifyOnly) {
  const submitBtn = document.getElementById('w-submit-btn');
  const sendEmail = document.getElementById('w-send-email') ? document.getElementById('w-send-email').checked : false;
  const subject = document.getElementById('w-subject') ? document.getElementById('w-subject').value.trim() : '';
  const delay_reason = document.getElementById('w-reason') ? document.getElementById('w-reason').value.trim() : '';
  const tx_hash = document.getElementById('w-txhash') ? document.getElementById('w-txhash').value.trim() : '';
  const custom_message = document.getElementById('w-custom-note') ? document.getElementById('w-custom-note').value.trim() : '';

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing & Sending…';
  }

  try {
    if (isNotifyOnly) {
      const result = await apiPost(`/admin/withdrawals/${id}/notify`, {
        subject,
        delay_reason,
        tx_hash,
        custom_message,
        status: targetStatus,
      });

      if (result.error) {
        alert(`❌ Failed to send email: ${result.error}`);
      } else {
        alert('✅ Email notification sent to investor!');
      }
    } else {
      const result = await apiPatch(`/admin/withdrawals/${id}`, {
        status: targetStatus,
        send_email: sendEmail,
        subject,
        delay_reason,
        tx_hash,
        custom_message,
      });

      if (result.error) {
        alert(`❌ Failed to update withdrawal: ${result.error}`);
      } else {
        if (sendEmail && !result.email_sent && result.email_error) {
          alert(`⚠️ Withdrawal updated to ${targetStatus}, but email failed: ${result.email_error}`);
        }
      }
    }
  } catch (err) {
    alert('❌ Request failed. Please check backend connection.');
  } finally {
    closeModal();
    loadWithdrawals();
  }
}

async function submitWithdrawalWithoutEmail(id, targetStatus) {
  closeModal();
  await resolveW(id, targetStatus);
}

async function resolveW(id, status) {
  await apiPatch(`/admin/withdrawals/${id}`, { status, send_email: false });
  loadWithdrawals();
}

// ── Settings ──────────────────────────────────────────────────────

async function loadSettings() {
  setState('settings', 'Loading settings…');
  try {
    const res = await fetch(`${API}/settings/payment`, {
      headers: { 'x-admin-secret': SECRET }
    });
    if (!res.ok) throw new Error();
    const data = await res.json();

    document.getElementById('s-withdrawal-fee').value        = data.withdrawal_fee != null ? data.withdrawal_fee : 0;
    document.getElementById('s-crypto-network').value        = data.crypto_network || '';
    document.getElementById('s-crypto-wallet').value         = data.crypto_wallet || '';
    document.getElementById('s-bank-name').value             = data.bank_name || '';
    document.getElementById('s-bank-account-name').value     = data.bank_account_name || '';
    document.getElementById('s-bank-account-number').value   = data.bank_account_number || '';
    document.getElementById('s-bank-routing').value          = data.bank_routing || '';
    document.getElementById('s-bank-swift').value            = data.bank_swift || '';

    showContent('settings');
  } catch {
    setState('settings', 'Failed to load settings. Try refreshing.');
  }
}

async function saveSettings() {
  const alertEl = document.getElementById('settings-alert');
  alertEl.className = 'hidden';

  const body = {
    withdrawal_fee:      parseFloat(document.getElementById('s-withdrawal-fee').value) || 0,
    crypto_network:      document.getElementById('s-crypto-network').value.trim(),
    crypto_wallet:       document.getElementById('s-crypto-wallet').value.trim(),
    bank_name:           document.getElementById('s-bank-name').value.trim(),
    bank_account_name:   document.getElementById('s-bank-account-name').value.trim(),
    bank_account_number: document.getElementById('s-bank-account-number').value.trim(),
    bank_routing:        document.getElementById('s-bank-routing').value.trim(),
    bank_swift:          document.getElementById('s-bank-swift').value.trim(),
  };

  try {
    const res = await fetch(`${API}/admin/settings/payment`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': SECRET },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Save failed');
    alertEl.textContent = '✅ Payment settings saved successfully!';
    alertEl.className = 'alert alert-success';
  } catch {
    alertEl.textContent = '❌ Failed to save settings. Please try again.';
    alertEl.className = 'alert alert-error';
  }
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

function openPlanModal(id, name, plan) {
  setModal(`Set Plan — ${name}`, `
    <div class="field"><label>Plan Name</label>
      <input type="text" id="m-plan" value="${esc(plan)}" placeholder="e.g. Starter, Growth, Elite" /></div>
    <button class="btn-primary" onclick="savePlan('${id}')">Save Changes</button>
  `);
}

async function savePlan(id) {
  const plan = document.getElementById('m-plan').value.trim();
  await apiPatch(`/admin/users/${id}/plan`, { plan });
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

function openFeeModal(id, name, feeRequired, feePaid, withdrawalApproved) {
  const defaultFee = window.defaultWithdrawalFee != null ? Number(window.defaultWithdrawalFee) : 0;
  const currentReq = feeRequired != null ? Number(feeRequired) : defaultFee;
  const currentPaid = Number(feePaid || 0);
  const currentRem = Math.max(0, currentReq - currentPaid);
  const pct = currentReq > 0 ? Math.min(100, Math.max(0, (currentPaid / currentReq) * 100)) : 100;
  const isPaid = currentRem <= 0;
  const isApproved = Boolean(withdrawalApproved);

  setModal(`Edit Withdrawal Fee & Lock Status — ${name}`, `
    <div class="field">
      <label>Fee Needed to Pay (Total Fee Required)</label>
      <input type="number" id="m-fee-req" value="${currentReq}" min="0" step="0.01" oninput="recalcFeeModal()" />
      <span class="modal-hint" style="margin-top: 4px; margin-bottom: 0;">Fee for this user (Platform default: $${defaultFee.toFixed(2)})</span>
    </div>

    <div class="field">
      <label>Fee Paid (Amount Already Paid)</label>
      <input type="number" id="m-fee-paid" value="${currentPaid}" min="0" step="0.01" oninput="recalcFeeModal()" />
    </div>

    <div class="field">
      <label>Remaining Balance Needed</label>
      <input type="number" id="m-fee-rem" value="${currentRem.toFixed(2)}" min="0" step="0.01" oninput="recalcFeeFromRem()" />
      <span class="modal-hint" style="margin-top: 4px; margin-bottom: 0;">Adjusting remaining balance automatically updates the Fee Paid above.</span>
    </div>

    <div class="field" style="margin-top: 12px; background: rgba(255,255,255,0.02); padding: 12px; border-radius: 8px; border: 1px solid var(--border);">
      <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; margin-bottom: 0;">
        <input type="checkbox" id="m-approved" ${isApproved ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;" />
        <span style="font-weight: 600; color: var(--text);">Admin Withdrawal Permission (Approved)</span>
      </label>
      <span class="modal-hint" style="margin-top: 6px; margin-bottom: 0; display: block;">Withdrawals unlock only if fee is paid in full AND withdrawal is approved.</span>
    </div>

    <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 10px; padding: 14px; margin: 16px 0;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 12px;">
        <span style="color: var(--text-dim); font-weight: 500;">Client Dashboard Status:</span>
        <strong id="m-preview-status" style="color: ${isPaid ? 'var(--profit)' : '#f87171'};">
          ${isPaid ? '✅ Paid in Full' : '🔒 Locked (' + pct.toFixed(0) + '% Paid)'}
        </strong>
      </div>
      <div style="width: 100%; height: 8px; background: rgba(255,255,255,0.08); border-radius: 99px; overflow: hidden;">
        <div id="m-preview-fill" style="height: 100%; width: ${pct}%; background: ${isPaid ? 'var(--profit)' : 'linear-gradient(90deg, var(--accent), var(--accent-b))'}; transition: width 0.3s ease;"></div>
      </div>
    </div>

    <div style="display: flex; gap: 8px; margin-bottom: 20px;">
      <button type="button" class="btn-act btn-act-approve" style="flex: 1; padding: 9px;" onclick="setQuickFee('paid')">🔓 Set Paid & Unlock</button>
      <button type="button" class="btn-act btn-act-danger" style="flex: 1; padding: 9px;" onclick="setQuickFee('zero')">🔒 Lock & Reset Fee</button>
    </div>

    <button class="btn-primary" onclick="saveFee('${id}')">Save Changes</button>
  `);
}

function recalcFeeModal() {
  const req = parseFloat(document.getElementById('m-fee-req').value) || 0;
  const paid = parseFloat(document.getElementById('m-fee-paid').value) || 0;
  const rem = Math.max(0, req - paid);
  document.getElementById('m-fee-rem').value = rem.toFixed(2);
  updateFeePreview(req, paid, rem);
}

function recalcFeeFromRem() {
  const req = parseFloat(document.getElementById('m-fee-req').value) || 0;
  const rem = parseFloat(document.getElementById('m-fee-rem').value) || 0;
  const paid = Math.max(0, req - rem);
  document.getElementById('m-fee-paid').value = paid.toFixed(2);
  updateFeePreview(req, paid, rem);
}

function setQuickFee(action) {
  const req = parseFloat(document.getElementById('m-fee-req').value) || 0;
  const appCheck = document.getElementById('m-approved');
  if (action === 'paid') {
    document.getElementById('m-fee-paid').value = req.toFixed(2);
    document.getElementById('m-fee-rem').value = '0.00';
    if (appCheck) appCheck.checked = true;
    updateFeePreview(req, req, 0);
  } else {
    document.getElementById('m-fee-paid').value = '0.00';
    document.getElementById('m-fee-rem').value = req.toFixed(2);
    if (appCheck) appCheck.checked = false;
    updateFeePreview(req, 0, req);
  }
}

function updateFeePreview(req, paid, rem) {
  const pct = req > 0 ? Math.min(100, Math.max(0, (paid / req) * 100)) : 100;
  const isPaid = rem <= 0 || req === 0;
  const statusEl = document.getElementById('m-preview-status');
  const fillEl = document.getElementById('m-preview-fill');
  if (statusEl) {
    statusEl.innerHTML = isPaid ? '✅ Paid in Full' : `🔒 Locked (${pct.toFixed(0)}% Paid)`;
    statusEl.style.color = isPaid ? 'var(--profit)' : '#f87171';
  }
  if (fillEl) {
    fillEl.style.width = `${pct}%`;
    fillEl.style.background = isPaid ? 'var(--profit)' : 'linear-gradient(90deg, var(--accent), var(--accent-b))';
  }
}

async function saveFee(id) {
  const fee_required = parseFloat(document.getElementById('m-fee-req').value) || 0;
  const fee_paid = parseFloat(document.getElementById('m-fee-paid').value) || 0;
  const withdrawal_approved = document.getElementById('m-approved') ? document.getElementById('m-approved').checked : false;
  await apiPatch(`/admin/users/${id}/fee`, { fee_required, fee_paid, withdrawal_approved });
  closeModal();
  loadUsers();
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

async function apiPost(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
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
