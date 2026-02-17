// popup.js - Unified login handler

const emailInput = document.getElementById('emailInput');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const loginForm = document.getElementById('loginForm');
const loggedInView = document.getElementById('loggedInView');
const status = document.getElementById('status');
const userEmail = document.getElementById('userEmail');
const userRole = document.getElementById('userRole');

// Role detection based on email pattern
function detectRole(email) {
  const lower = email.toLowerCase().trim();
  
  // L1 Agents: *_technotask@meesho.com
  if (lower.includes('_technotask@meesho.com')) {
    return 'L1 Agent';
  }
  
  // SC Managers: *@meesho.com (but not _technotask)
  if (lower.endsWith('@meesho.com')) {
    return 'SC Manager';
  }
  
  // Captains: everything else (personal emails)
  return 'Captain';
}

// Check login state on popup open
chrome.storage.local.get(['userEmail', 'userRole'], (result) => {
  if (result.userEmail) {
    showLoggedIn(result.userEmail, result.userRole);
  }
});

// Login
loginBtn.addEventListener('click', () => {
  const email = emailInput.value.trim();
  
  if (!email || !email.includes('@')) {
    status.textContent = 'Please enter a valid email';
    status.style.background = 'rgba(244, 67, 54, 0.4)';
    setTimeout(() => {
      status.textContent = 'Not logged in';
      status.style.background = 'rgba(255,255,255,0.1)';
    }, 2000);
    return;
  }
  
  const role = detectRole(email);
  
  chrome.storage.local.set({ userEmail: email, userRole: role }, () => {
    showLoggedIn(email, role);
    
    // Notify all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'USER_LOGGED_IN',
          email: email,
          role: role
        }).catch(() => {});
      });
    });
  });
});

// Logout
logoutBtn.addEventListener('click', () => {
  chrome.storage.local.remove(['userEmail', 'userRole'], () => {
    showLoggedOut();
    
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'USER_LOGGED_OUT'
        }).catch(() => {});
      });
    });
  });
});

// UI helpers
function showLoggedIn(email, role) {
  loginForm.style.display = 'none';
  loggedInView.style.display = 'block';
  status.textContent = '✓ Logged in';
  status.classList.add('logged-in');
  userEmail.textContent = email;
  userRole.textContent = role;
}

function showLoggedOut() {
  loginForm.style.display = 'block';
  loggedInView.style.display = 'none';
  status.textContent = 'Not logged in';
  status.classList.remove('logged-in');
  emailInput.value = '';
}

// Enter key
emailInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') loginBtn.click();
});
