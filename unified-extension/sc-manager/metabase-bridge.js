/**
 * metabase-bridge.js
 * 
 * Runs ON Metabase pages to fetch data without CORS restrictions.
 * Acts as a bridge between the SC Manager dashboard and Metabase API.
 */

console.log('[Metabase Bridge] Loaded on', window.location.href);

// Listen for fetch requests from SC Manager dashboard
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  if (message.type === 'FETCH_METABASE_FROM_PAGE') {
    console.log('[Metabase Bridge] Fetching:', message.endpoint);
    
    (async () => {
      try {
        const response = await fetch(message.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include' // Use existing Metabase session cookies
        });
        
        if (!response.ok) {
          console.error('[Metabase Bridge] HTTP error:', response.status);
          sendResponse({ 
            success: false, 
            error: `HTTP ${response.status}` 
          });
          return;
        }
        
        const data = await response.json();
        
        console.log('[Metabase Bridge] Success! Rows:', data.data?.rows?.length);
        
        sendResponse({
          success: true,
          rows: data.data?.rows || [],
          columns: data.data?.cols || [],
          timestamp: Date.now()
        });
        
      } catch (err) {
        console.error('[Metabase Bridge] Fetch failed:', err);
        sendResponse({ 
          success: false, 
          error: err.message 
        });
      }
    })();
    
    return true; // Keep message channel open for async response
  }
});

console.log('[Metabase Bridge] Ready to receive requests');