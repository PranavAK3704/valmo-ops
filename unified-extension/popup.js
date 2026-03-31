// popup.js - Login handler with hub code validation

const SB_URL = 'https://wfnmltorfvaokqbzggkn.supabase.co';
const SB_KEY = 'sb_publishable_kVRokdcfNT-egywk-KbQ3g_mEs5QVGW';

const emailInput    = document.getElementById('emailInput');
const hubCodeInput  = document.getElementById('hubCodeInput');
const hubFeedback   = document.getElementById('hubFeedback');
const loginBtn      = document.getElementById('loginBtn');
const logoutBtn     = document.getElementById('logoutBtn');
const loginForm     = document.getElementById('loginForm');
const loggedInView  = document.getElementById('loggedInView');
const statusEl      = document.getElementById('status');
const userEmailEl   = document.getElementById('userEmail');
const userRoleEl    = document.getElementById('userRole');

// Resolved hub from Supabase — null until validated
let resolvedHub = null; // { hub_code, hub_name }

// ── Role detection ────────────────────────────────────────────────────────────
function detectRole(email) {
  const lower = email.toLowerCase().trim();
  if (lower.includes('_technotask@meesho.com')) return 'L1 Agent';
  return 'Captain';
}

// ── Show/hide hub code field based on role ────────────────────────────────────
emailInput.addEventListener('input', () => {
  const role = detectRole(emailInput.value.trim());
  if (role === 'Captain') {
    hubCodeInput.style.display = 'block';
  } else {
    hubCodeInput.style.display = 'none';
    clearHubFeedback();
    resolvedHub = null;
  }
});

// ── Hub code live validation (debounced 600ms) ────────────────────────────────
let hubDebounce = null;

hubCodeInput.addEventListener('input', () => {
  const raw = hubCodeInput.value.trim().toUpperCase();
  hubCodeInput.value = raw; // force uppercase in field

  clearHubFeedback();
  resolvedHub = null;

  if (raw.length < 3) return;

  clearTimeout(hubDebounce);
  hubDebounce = setTimeout(() => validateHubCode(raw), 600);
});

function clearHubFeedback() {
  hubFeedback.textContent = '';
  hubFeedback.className = 'hub-feedback';
}

function setHubFeedback(msg, state) {
  hubFeedback.textContent = msg;
  hubFeedback.className = `hub-feedback show ${state}`;
}

async function validateHubCode(code) {
  setHubFeedback('Checking hub code…', 'wait');
  try {
    const url = `${SB_URL}/rest/v1/hubs?hub_code=eq.${encodeURIComponent(code)}&active=eq.true&select=hub_code,hub_name&limit=1`;
    const res = await fetch(url, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (rows.length > 0) {
      resolvedHub = rows[0]; // { hub_code, hub_name }
      setHubFeedback(`✓ ${resolvedHub.hub_name}`, 'ok');
    } else {
      resolvedHub = null;
      setHubFeedback('Hub code not found. Check with your hub manager.', 'err');
    }
  } catch (e) {
    resolvedHub = null;
    setHubFeedback('Could not verify hub code — check your connection.', 'err');
  }
}

// ── Restore session on popup open ─────────────────────────────────────────────
chrome.storage.local.get(['userEmail', 'userRole', 'userHub', 'userHubCode'], (result) => {
  if (result.userEmail) {
    showLoggedIn(result.userEmail, result.userRole, result.userHub, result.userHubCode);
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
loginBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  if (!email || !email.includes('@')) {
    return showError('Please enter a valid email');
  }

  const role = detectRole(email);

  if (role === 'Captain') {
    if (!resolvedHub) {
      // If user hasn't typed a code yet, or hasn't waited for validation
      const raw = hubCodeInput.value.trim().toUpperCase();
      if (!raw) return showError('Please enter your hub code');
      // Force validate now
      loginBtn.disabled = true;
      loginBtn.textContent = 'Verifying…';
      await validateHubCode(raw);
      loginBtn.disabled = false;
      loginBtn.textContent = 'Login';
      if (!resolvedHub) return showError('Invalid hub code — cannot log in');
    }
  }

  const hub     = resolvedHub?.hub_name  || null;
  const hubCode = resolvedHub?.hub_code  || null;

  chrome.storage.local.set(
    { userEmail: email, userRole: role, userHub: hub, userHubCode: hubCode },
    () => {
      showLoggedIn(email, role, hub, hubCode);
      // Notify all eligible tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'USER_LOGGED_IN', email, role, hub, hubCode
          }).catch(() => {});
        });
      });
    }
  );
});

// ── Logout ────────────────────────────────────────────────────────────────────
logoutBtn.addEventListener('click', () => {
  chrome.storage.local.remove(['userEmail', 'userRole', 'userHub', 'userHubCode'], () => {
    resolvedHub = null;
    showLoggedOut();
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'USER_LOGGED_OUT' }).catch(() => {});
      });
    });
  });
});

// ── UI helpers ────────────────────────────────────────────────────────────────
function showLoggedIn(email, role, hub, hubCode) {
  loginForm.style.display  = 'none';
  loggedInView.style.display = 'block';
  statusEl.textContent = '✓ Logged in';
  statusEl.classList.add('logged-in');
  userEmailEl.textContent = email;
  userRoleEl.textContent  = hub ? `${role} · ${hub}${hubCode ? ` (${hubCode})` : ''}` : role;
}

function showLoggedOut() {
  loginForm.style.display    = 'block';
  loggedInView.style.display = 'none';
  statusEl.textContent = 'Not logged in';
  statusEl.classList.remove('logged-in');
  emailInput.value    = '';
  hubCodeInput.value  = '';
  hubCodeInput.style.display = 'none';
  clearHubFeedback();
}

function showError(msg) {
  statusEl.textContent = msg;
  statusEl.style.background = 'rgba(244, 67, 54, 0.4)';
  setTimeout(() => {
    statusEl.textContent = 'Not logged in';
    statusEl.style.background = '';
  }, 2500);
}

// Enter key on either field triggers login
emailInput.addEventListener('keypress',   (e) => { if (e.key === 'Enter') loginBtn.click(); });
hubCodeInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') loginBtn.click(); });
