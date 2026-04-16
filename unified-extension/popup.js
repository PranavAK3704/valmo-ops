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
let resolvedHub = null; // { hub_code, hub_name, hub_type, expected_operators }

// ── Role detection ────────────────────────────────────────────────────────────
function isL1Agent(email) {
  return email.toLowerCase().includes('_technotask@meesho.com');
}

// Show/hide hub code based on email
emailInput.addEventListener('input', () => {
  if (isL1Agent(emailInput.value.trim())) {
    hubCodeInput.style.display = 'none';
    clearHubFeedback();
    resolvedHub = null;
  } else {
    hubCodeInput.style.display = 'block';
  }
});

// Hub code shown by default (for captains/operators)
hubCodeInput.style.display = 'block';

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
  document.getElementById('roleSelectorSection').style.display = 'none';
}


function setHubFeedback(msg, state) {
  hubFeedback.textContent = msg;
  hubFeedback.className = `hub-feedback show ${state}`;
}

async function validateHubCode(code) {
  setHubFeedback('Checking hub code…', 'wait');
  try {
    const url = `${SB_URL}/rest/v1/hubs?hub_code=eq.${encodeURIComponent(code)}&active=eq.true&select=hub_code,hub_name,hub_type,expected_operators&limit=1`;
    const res = await fetch(url, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (rows.length > 0) {
      resolvedHub = rows[0]; // { hub_code, hub_name, hub_type, expected_operators }
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
chrome.storage.local.get(['userEmail', 'userRole', 'userHub', 'userHubCode', 'userHubType', 'userSessionRole'], (result) => {
  if (result.userEmail) {
    showLoggedIn(result.userEmail, result.userRole, result.userHub, result.userHubCode, result.userHubType, result.userSessionRole);
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
loginBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return showError('Please enter a valid email');
  }

  // ── L1 Agent flow (no hub required) ──────────────────────────────────────────
  if (isL1Agent(email)) {
    chrome.storage.local.set(
      { userEmail: email, userRole: 'L1 Agent', userHub: '', userHubCode: '',
        userHubType: 'LM', userSessionRole: 'operator', userExpectedOperators: 1 },
      () => {
        showLoggedIn(email, 'L1 Agent', '', '', 'LM', 'operator');
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              type: 'USER_LOGGED_IN', email, role: 'L1 Agent', hub: '', hubCode: '',
              hubType: 'LM', sessionRole: 'operator', expectedOperators: 1
            }).catch(() => {});
          });
        });
      }
    );
    return;
  }

  // ── Captain / Operator flow (hub required) ────────────────────────────────────
  if (!resolvedHub) {
    const raw = hubCodeInput.value.trim().toUpperCase();
    if (!raw) return showError('Please enter your hub code');
    loginBtn.disabled = true;
    loginBtn.textContent = 'Verifying…';
    await validateHubCode(raw);
    loginBtn.disabled = false;
    loginBtn.textContent = 'Login';
    if (!resolvedHub) return showError('Invalid hub code — cannot log in');
  }

  loginBtn.disabled = true;
  loginBtn.textContent = 'Checking…';
  try {
    const memberUrl = `${SB_URL}/rest/v1/hub_members?email=eq.${encodeURIComponent(email)}&hub_code=eq.${encodeURIComponent(resolvedHub.hub_code)}&active=eq.true&select=role&limit=1`;
    const memberRes = await fetch(memberUrl, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' }
    });
    if (!memberRes.ok) throw new Error(`HTTP ${memberRes.status}`);
    const memberRows = await memberRes.json();
    if (!memberRows.length) {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Login';
      return showError('Email not registered for this hub. Contact your manager.');
    }

    const dbRole            = memberRows[0].role;
    const sessionRole       = dbRole === 'Captain' ? 'captain' : 'operator';
    const hub               = resolvedHub.hub_name;
    const hubCode           = resolvedHub.hub_code;
    const hubType           = resolvedHub.hub_type || 'LM';
    const expectedOperators = resolvedHub.expected_operators || 1;

    chrome.storage.local.set(
      { userEmail: email, userRole: dbRole, userHub: hub, userHubCode: hubCode,
        userHubType: hubType, userSessionRole: sessionRole, userExpectedOperators: expectedOperators },
      () => {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
        showLoggedIn(email, dbRole, hub, hubCode, hubType, sessionRole);
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              type: 'USER_LOGGED_IN', email, role: dbRole, hub, hubCode, hubType, sessionRole, expectedOperators
            }).catch(() => {});
          });
        });
      }
    );
  } catch (e) {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Login';
    showError('Could not verify membership — check your connection.');
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────
logoutBtn.addEventListener('click', () => {
  chrome.storage.local.remove(['userEmail', 'userRole', 'userHub', 'userHubCode', 'userHubType', 'userSessionRole', 'userExpectedOperators'], () => {
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
function showLoggedIn(email, role, hub, hubCode, _hubType, sessionRole) {
  loginForm.style.display  = 'none';
  loggedInView.style.display = 'block';
  statusEl.textContent = '✓ Logged in';
  statusEl.classList.add('logged-in');
  userEmailEl.textContent = email;
  const roleLine = sessionRole === 'operator' ? 'Operator' : role;
  userRoleEl.textContent  = hub ? `${roleLine} · ${hub}${hubCode ? ` (${hubCode})` : ''}` : roleLine;
}

function showLoggedOut() {
  loginForm.style.display    = 'block';
  loggedInView.style.display = 'none';
  statusEl.textContent = 'Not logged in';
  statusEl.classList.remove('logged-in');
  emailInput.value   = '';
  hubCodeInput.value = '';
  hubCodeInput.style.display = 'block';
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
