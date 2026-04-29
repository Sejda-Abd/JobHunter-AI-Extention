// ============================================================
// BACKGROUND.JS — LinkedIn Job Hunter AI Service Worker
// ============================================================

// Open popup when extension icon is clicked on non-LinkedIn pages
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.includes('linkedin.com')) {
    // Already on LinkedIn — popup handles it
    return;
  }
  // Suggest navigating to LinkedIn
  chrome.tabs.create({ url: 'https://www.linkedin.com/jobs/' });
});

// Listen for tab updates — auto-scan if enabled
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !tab.url.includes('linkedin.com/jobs')) return;

  chrome.storage.local.get('settings', (data) => {
    const settings = data.settings || {};
    if (settings.autoScan) {
      // Give the page time to render job cards
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { type: 'SCAN_JOBS' }, (resp) => {
          if (chrome.runtime.lastError) return; // tab not ready
          if (resp && resp.count > 0) {
            // Badge the icon with found count
            chrome.action.setBadgeText({ text: String(resp.count), tabId });
            chrome.action.setBadgeBackgroundColor({ color: '#6c63ff', tabId });
          }
        });
      }, 2500);
    }
  });
});

// Clear badge when navigating away
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (!tab.url || !tab.url.includes('linkedin.com/jobs')) {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  });
});

// Handle messages from content scripts or popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_BADGE_COUNT') {
    chrome.storage.local.get('jobs', (data) => {
      const jobs = data.jobs || [];
      const matched = jobs.filter(j => j.score >= 60 && j.status !== 'applied').length;
      sendResponse({ count: matched });
    });
    return true;
  }
});
