// ============================================================
// POPUP.JS — LinkedIn Job Hunter AI
// ============================================================

// --- TAB SWITCHING ---
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'jobs') renderJobs();
  });
});

// --- NOTIFICATION ---
function notify(msg, type = 'success') {
  const el = document.getElementById('notif');
  el.textContent = (type === 'success' ? '✅ ' : type === 'error' ? '❌ ' : 'ℹ️ ') + msg;
  el.className = `notif show ${type}`;
  setTimeout(() => el.classList.remove('show'), 2800);
}

// --- RESUME UPLOAD ---
const uploadZone = document.getElementById('uploadZone');
const resumeFileInput = document.getElementById('resumeFile');
const fileBadge = document.getElementById('fileBadge');
const fileNameEl = document.getElementById('fileName');
const fileRm = document.getElementById('fileRm');

resumeFileInput.addEventListener('change', () => {
  const file = resumeFileInput.files[0];
  if (file) handleResumeFile(file);
});

uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleResumeFile(file);
});

function handleResumeFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const data = e.target.result;
    chrome.storage.local.set({
      resumeName: file.name,
      resumeData: data,
      resumeType: file.type
    }, () => {
      fileNameEl.textContent = file.name;
      fileBadge.style.display = 'flex';
      notify('Resume saved!');
    });
  };
  reader.readAsDataURL(file);
}

fileRm.addEventListener('click', () => {
  chrome.storage.local.remove(['resumeName', 'resumeData', 'resumeType'], () => {
    fileBadge.style.display = 'none';
    resumeFileInput.value = '';
    notify('Resume removed', 'info');
  });
});

// --- SKILLS TAGS ---
let skills = [];

function renderSkillTags() {
  const container = document.getElementById('skillsTags');
  container.innerHTML = '';
  skills.forEach((skill, i) => {
    const tag = document.createElement('div');
    tag.className = 'skill-tag';
    tag.innerHTML = `${skill} <span class="rm" data-i="${i}">✕</span>`;
    tag.querySelector('.rm').addEventListener('click', () => {
      skills.splice(i, 1);
      renderSkillTags();
    });
    container.appendChild(tag);
  });
}

document.getElementById('skillInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const val = e.target.value.trim().replace(/,$/, '');
    if (val && !skills.includes(val)) {
      skills.push(val);
      renderSkillTags();
    }
    e.target.value = '';
  }
});

// --- SAVE PROFILE ---
document.getElementById('saveProfile').addEventListener('click', () => {
  const profile = {
    jobTitle: document.getElementById('jobTitle').value.trim(),
    skills,
    expLevel: document.getElementById('expLevel').value,
    coverLetter: document.getElementById('coverLetter').value.trim(),
  };
  if (!profile.jobTitle) { notify('Please enter a job title', 'error'); return; }
  chrome.storage.local.set({ profile }, () => {
    notify('Profile saved!');
    // Notify content script
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0] && tabs[0].url.includes('linkedin.com')) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'PROFILE_UPDATED', profile });
      }
    });
  });
});

// --- LOAD PROFILE ---
function loadProfile() {
  chrome.storage.local.get(['profile', 'resumeName'], (data) => {
    if (data.profile) {
      document.getElementById('jobTitle').value = data.profile.jobTitle || '';
      skills = data.profile.skills || [];
      document.getElementById('expLevel').value = data.profile.expLevel || '';
      document.getElementById('coverLetter').value = data.profile.coverLetter || '';
      renderSkillTags();
    }
    if (data.resumeName) {
      fileNameEl.textContent = data.resumeName;
      fileBadge.style.display = 'flex';
    }
  });
}

// --- JOBS TAB ---
function renderJobs() {
  chrome.storage.local.get(['jobs', 'settings'], (data) => {
    const jobs = data.jobs || [];
    const settings = data.settings || {};
    const minMatch = parseInt(settings.minMatch) || 0;
    const skipApplied = settings.skipApplied !== false;

    const filtered = jobs.filter(j => {
      if (skipApplied && j.status === 'applied') return false;
      return j.score >= minMatch;
    });

    // Stats
    document.getElementById('stat-found').textContent = jobs.length;
    document.getElementById('stat-matched').textContent = jobs.filter(j => j.score >= 60).length;
    document.getElementById('stat-applied').textContent = jobs.filter(j => j.status === 'applied').length;

    const container = document.getElementById('jobsContainer');
    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <div class="empty-text">No matched jobs yet.<br>Go to LinkedIn jobs and click <strong>Scan Page</strong>.</div>
        </div>`;
      return;
    }

    // Sort by score desc
    filtered.sort((a, b) => b.score - a.score);

    container.innerHTML = `<div class="job-list" id="jobList"></div>`;
    const list = document.getElementById('jobList');

    filtered.forEach(job => {
      const card = document.createElement('div');
      const scoreClass = job.score >= 75 ? 'match-high' : job.score >= 50 ? 'match-mid' : 'match-low';
      const isApplied = job.status === 'applied';
      const isSkipped = job.status === 'skipped';
      card.className = `job-card ${isApplied ? 'applied' : ''} ${isSkipped ? 'skipped' : ''}`;
      card.innerHTML = `
        <div class="job-top">
          <div>
            <div class="job-title">${escHtml(job.title)}</div>
            <div class="job-company">${escHtml(job.company)} · ${escHtml(job.location || 'Remote')}</div>
          </div>
          <div class="match-badge ${scoreClass}">${job.score}%</div>
        </div>
        <div class="job-bottom">
          <div class="job-tags">
            ${(job.matchedSkills || []).slice(0, 3).map(s => `<div class="job-tag">${escHtml(s)}</div>`).join('')}
          </div>
          <div class="job-actions">
            ${isApplied
              ? '<span class="applied-label">✓ APPLIED</span>'
              : `<button class="action-btn apply-btn" data-id="${job.id}">Apply</button>
                 <button class="action-btn skip-btn" data-id="${job.id}">Skip</button>`
            }
          </div>
        </div>`;
      list.appendChild(card);
    });

    // Apply button handlers
    list.querySelectorAll('.apply-btn').forEach(btn => {
      btn.addEventListener('click', () => applyToJob(btn.dataset.id));
    });
    list.querySelectorAll('.skip-btn').forEach(btn => {
      btn.addEventListener('click', () => skipJob(btn.dataset.id));
    });
  });
}

function applyToJob(jobId) {
  chrome.storage.local.get('jobs', (data) => {
    const jobs = data.jobs || [];
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;

    // Open job and trigger auto-apply in content script
    chrome.tabs.create({ url: job.url }, (tab) => {
      chrome.storage.local.get('settings', (s) => {
        const autoFill = (s.settings || {}).autoFill !== false;
        // Content script will handle Easy Apply detection
        chrome.storage.local.set({
          pendingApply: { jobId, autoFill }
        });
      });
    });

    // Mark as applied
    job.status = 'applied';
    chrome.storage.local.set({ jobs }, () => renderJobs());
  });
}

function skipJob(jobId) {
  chrome.storage.local.get('jobs', (data) => {
    const jobs = data.jobs || [];
    const job = jobs.find(j => j.id === jobId);
    if (job) { job.status = 'skipped'; }
    chrome.storage.local.set({ jobs }, () => renderJobs());
  });
}

// --- SCAN BUTTON ---
document.getElementById('scanBtn').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url || !isLinkedInJobsUrl(tab.url)) {
      notify('Open a LinkedIn jobs page first (linkedin.com/jobs)', 'error');
      return;
    }
    document.getElementById('scanBtn').textContent = '⏳ Scanning...';
    document.getElementById('scanBtn').disabled = true;

    runScan(tab.id, tab.url, (resp, err) => {
      document.getElementById('scanBtn').textContent = '🔍 Scan Page';
      document.getElementById('scanBtn').disabled = false;

      if (err) {
        notify('Could not connect to page. Refresh LinkedIn jobs and try again.', 'error');
        return;
      }

      if (resp && resp.count !== undefined) {
        notify(`Found ${resp.count} matching jobs!`);
        renderJobs();
      }
    });
  });
});

document.getElementById('clearBtn').addEventListener('click', () => {
  chrome.storage.local.set({ jobs: [] }, () => { renderJobs(); notify('Cleared!', 'info'); });
});

// --- SETTINGS ---
const toggleIds = ['autoscan', 'highlight', 'autofill', 'skiapplied'];
const toggleMap = { autoscan: 'autoScan', highlight: 'highlight', autofill: 'autoFill', skiapplied: 'skipApplied' };
const toggleDefaults = { autoScan: false, highlight: true, autoFill: true, skipApplied: true };

function loadSettings() {
  chrome.storage.local.get('settings', (data) => {
    const s = Object.assign({}, toggleDefaults, data.settings || {});
    toggleIds.forEach(id => {
      const el = document.getElementById('toggle-' + id);
      el.classList.toggle('on', !!s[toggleMap[id]]);
    });
    document.getElementById('minMatch').value = s.minMatch || 50;
  });
}

toggleIds.forEach(id => {
  document.getElementById('toggle-' + id).addEventListener('click', function () {
    this.classList.toggle('on');
  });
});

document.getElementById('saveSettings').addEventListener('click', () => {
  const settings = {};
  toggleIds.forEach(id => {
    settings[toggleMap[id]] = document.getElementById('toggle-' + id).classList.contains('on');
  });
  settings.minMatch = parseInt(document.getElementById('minMatch').value) || 50;
  chrome.storage.local.set({ settings }, () => notify('Settings saved!'));
});

// --- UTILS ---
function isLinkedInJobsUrl(url) {
  return /^https:\/\/www\.linkedin\.com\/jobs(?:\/|\?|$)/i.test(String(url || ''));
}

function runScan(tabId, tabUrl, done) {
  chrome.tabs.sendMessage(tabId, { type: 'SCAN_JOBS' }, (resp) => {
    if (!chrome.runtime.lastError) {
      done(resp, null);
      return;
    }

    // Fallback for tabs where content script has not been attached yet.
    if (!isLinkedInJobsUrl(tabUrl)) {
      done(null, chrome.runtime.lastError);
      return;
    }

    chrome.scripting.insertCSS({
      target: { tabId },
      files: ['src/content.css']
    }, () => {
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content.js']
      }, () => {
        if (chrome.runtime.lastError) {
          done(null, chrome.runtime.lastError);
          return;
        }

        chrome.tabs.sendMessage(tabId, { type: 'SCAN_JOBS' }, (retryResp) => {
          done(retryResp, chrome.runtime.lastError || null);
        });
      });
    });
  });
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// --- INIT ---
loadProfile();
loadSettings();
