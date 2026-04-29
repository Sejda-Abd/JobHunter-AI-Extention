// ============================================================
// CONTENT.JS — LinkedIn Job Hunter AI
// Injected into linkedin.com/jobs/* pages
// ============================================================

(function () {
  'use strict';

  let profile = null;
  let settings = {};

  // Load profile + settings on init
  chrome.storage.local.get(['profile', 'settings'], (data) => {
    profile = data.profile || null;
    settings = data.settings || {};
    if (settings.autoScan && profile) {
      setTimeout(() => scanJobs(), 2000);
    }
    checkPendingApply();
  });

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'SCAN_JOBS') {
      chrome.storage.local.get(['profile', 'settings'], (data) => {
        profile = data.profile || null;
        settings = data.settings || {};
        const count = scanJobs();
        sendResponse({ count });
      });
      return true; // async
    }
    if (msg.type === 'PROFILE_UPDATED') {
      profile = msg.profile;
    }
  });

  // ============================================================
  // SCAN JOBS — parse job cards on the current page
  // ============================================================
  function scanJobs() {
    if (!profile) return 0;

    // LinkedIn job card selectors (works for /jobs/search and /jobs/collections)
    const cardSelectors = [
      '.jobs-search__results-list li',
      '.scaffold-layout__list li',
      '.jobs-job-board-list__item',
      '[data-occludable-job-id]',
    ];

    let cards = [];
    for (const sel of cardSelectors) {
      cards = Array.from(document.querySelectorAll(sel));
      if (cards.length > 0) break;
    }

    if (cards.length === 0) {
      console.warn('[JobHunter] No job cards found. Try scrolling first.');
      return 0;
    }

    const parsed = cards.map(parseJobCard).filter(Boolean);
    const scored = parsed.map(job => scoreJob(job, profile));

    chrome.storage.local.get('jobs', (data) => {
      const existing = data.jobs || [];
      const existingIds = new Set(existing.map(j => j.id));

      const newJobs = scored.filter(j => !existingIds.has(j.id));
      const merged = [...existing, ...newJobs];

      chrome.storage.local.set({ jobs: merged });
    });

    // Highlight if enabled
    if (settings.highlight !== false) {
      highlightCards(cards, scored);
    }

    return scored.length;
  }

  // ============================================================
  // PARSE — extract data from a single job card DOM element
  // ============================================================
  function parseJobCard(card) {
    try {
      // Job ID
      const jobId =
        card.dataset.occludableJobId ||
        card.querySelector('[data-job-id]')?.dataset.jobId ||
        card.querySelector('a[href*="/jobs/view/"]')?.href.match(/\/jobs\/view\/(\d+)/)?.[1] ||
        null;

      // Title
      const title =
        card.querySelector('.job-card-list__title, .jobs-unified-top-card__job-title, [class*="job-card-container__link"], a[class*="JobTitle"]')?.innerText?.trim() ||
        card.querySelector('strong')?.innerText?.trim() ||
        card.querySelector('h3')?.innerText?.trim() || '';

      // Company
      const company =
        card.querySelector('.job-card-container__primary-description, .job-card-container__company-name, [class*="subtitle"]')?.innerText?.trim() ||
        card.querySelector('h4')?.innerText?.trim() || '';

      // Location
      const location =
        card.querySelector('.job-card-container__metadata-item, [class*="location"]')?.innerText?.trim() || '';

      // URL
      const anchor = card.querySelector('a[href*="/jobs/view/"]');
      const url = anchor ? (anchor.href.split('?')[0]) : window.location.href;

      // Description snippet (if visible in card)
      const desc = card.querySelector('[class*="description"], [class*="snippet"]')?.innerText?.trim() || '';

      // Easy Apply badge
      const easyApply = !!card.querySelector('[aria-label*="Easy Apply"], .job-card-container__apply-method');

      if (!title) return null;

      return {
        id: jobId || slugify(title + company),
        title,
        company,
        location,
        url,
        desc,
        easyApply,
      };
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  // SCORE — match job against user profile (0–100)
  // ============================================================
  function scoreJob(job, prof) {
    if (!prof) return { ...job, score: 0, matchedSkills: [] };

    const haystack = [job.title, job.company, job.desc, job.location]
      .join(' ').toLowerCase();

    const userSkills = (prof.skills || []).map(s => s.toLowerCase());
    const userTitle = (prof.jobTitle || '').toLowerCase();

    let score = 0;
    const matchedSkills = [];

    // Title match (up to 40 pts)
    const titleWords = userTitle.split(/\s+/).filter(Boolean);
    const jobTitleLower = job.title.toLowerCase();
    let titleHits = titleWords.filter(w => jobTitleLower.includes(w)).length;
    score += Math.min(40, (titleHits / Math.max(titleWords.length, 1)) * 40);

    // Skills match (up to 50 pts)
    const skillScore = userSkills.length > 0 ? 50 / userSkills.length : 0;
    userSkills.forEach(skill => {
      if (haystack.includes(skill)) {
        score += skillScore;
        matchedSkills.push(skill);
      }
    });

    // Experience level match (up to 10 pts)
    const expKeywords = {
      entry: ['entry', 'junior', 'jr', 'graduate', 'intern'],
      mid: ['mid', 'intermediate', '3+ years', '2+ years'],
      senior: ['senior', 'sr.', 'lead', '5+ years', '6+ years'],
      staff: ['staff', 'principal', 'architect', '8+ years', '10+'],
      manager: ['manager', 'director', 'head of', 'vp'],
    };
    const expLevel = prof.expLevel || '';
    if (expLevel && expKeywords[expLevel]) {
      const hit = expKeywords[expLevel].some(kw => haystack.includes(kw));
      if (hit) score += 10;
    }

    // Easy Apply bonus
    if (job.easyApply) score = Math.min(100, score + 5);

    return {
      ...job,
      score: Math.round(Math.min(100, Math.max(0, score))),
      matchedSkills,
    };
  }

  // ============================================================
  // HIGHLIGHT — visually mark job cards on page
  // ============================================================
  function highlightCards(cards, scored) {
    const scoreMap = {};
    scored.forEach(j => { scoreMap[j.id] = j; });

    cards.forEach(card => {
      const jobId =
        card.dataset.occludableJobId ||
        card.querySelector('[data-job-id]')?.dataset.jobId ||
        card.querySelector('a[href*="/jobs/view/"]')?.href.match(/\/jobs\/view\/(\d+)/)?.[1];

      const job = jobId ? scoreMap[jobId] : null;
      if (!job) return;

      // Remove old badge
      card.querySelector('.jh-badge')?.remove();

      const badge = document.createElement('div');
      badge.className = 'jh-badge';
      badge.dataset.score = job.score;
      badge.innerHTML = `<span class="jh-score">${job.score}%</span>${job.easyApply ? '<span class="jh-easy">⚡ Easy</span>' : ''}`;

      // Position badge inside card
      const anchor = card.querySelector('a[href*="/jobs/view/"]');
      if (anchor) {
        anchor.style.position = 'relative';
        anchor.appendChild(badge);
      }
    });
  }

  // ============================================================
  // AUTO-FILL Easy Apply form
  // ============================================================
  function checkPendingApply() {
    chrome.storage.local.get(['pendingApply', 'profile'], (data) => {
      if (!data.pendingApply) return;
      const { autoFill } = data.pendingApply;
      chrome.storage.local.remove('pendingApply');

      if (!autoFill) return;

      // Wait for Easy Apply modal to open
      waitForElement('.jobs-easy-apply-modal, .jobs-apply-button', 5000, () => {
        // Click Easy Apply button if present
        const applyBtn = document.querySelector('.jobs-apply-button--top-card, [aria-label="Easy Apply"]');
        if (applyBtn) applyBtn.click();

        // Wait for the form
        waitForElement('.jobs-easy-apply-content', 5000, () => {
          fillEasyApplyForm(data.profile || {});
        });
      });
    });
  }

  function fillEasyApplyForm(prof) {
    // Fill phone number
    fillInput('input[id*="phoneNumber"], input[name*="phone"]', prof.phone || '');

    // Fill email
    fillInput('input[type="email"]', prof.email || '');

    // Fill first / last name
    fillInput('input[id*="firstName"], input[name*="firstName"]', prof.firstName || '');
    fillInput('input[id*="lastName"], input[name*="lastName"]', prof.lastName || '');

    // Fill years of experience
    fillInput('input[id*="yearsOfExperience"], input[name*="years"]', prof.yearsExp || '');

    // Select experience level in dropdowns
    trySelectOption('select[id*="experienceLevel"]', prof.expLevel);

    // Fill cover letter textarea if present
    const coverTextarea = document.querySelector('textarea[id*="coverLetter"], textarea[name*="cover"]');
    if (coverTextarea && prof.coverLetter) {
      const filledCover = fillTemplate(prof.coverLetter, {
        jobTitle: getPageJobTitle(),
        company: getPageCompany(),
        skills: (prof.skills || []).slice(0, 3).join(', '),
        years: prof.yearsExp || '3',
      });
      setNativeValue(coverTextarea, filledCover);
    }

    showInPageNotice('✅ JobHunter AI filled your form! Review and click Submit.');
  }

  // ============================================================
  // HELPERS
  // ============================================================
  function fillInput(selector, value) {
    if (!value) return;
    const el = document.querySelector(selector);
    if (el) setNativeValue(el, value);
  }

  function setNativeValue(el, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function trySelectOption(selector, value) {
    if (!value) return;
    const sel = document.querySelector(selector);
    if (!sel) return;
    const opts = Array.from(sel.options);
    const match = opts.find(o => o.value.toLowerCase().includes(value.toLowerCase()) || o.text.toLowerCase().includes(value.toLowerCase()));
    if (match) {
      setNativeValue(sel, match.value);
    }
  }

  function fillTemplate(template, vars) {
    return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] || '');
  }

  function getPageJobTitle() {
    return document.querySelector('.job-details-jobs-unified-top-card__job-title, h1')?.innerText?.trim() || '';
  }

  function getPageCompany() {
    return document.querySelector('.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name')?.innerText?.trim() || '';
  }

  function waitForElement(selector, timeout, cb) {
    const el = document.querySelector(selector);
    if (el) { cb(el); return; }
    const start = Date.now();
    const iv = setInterval(() => {
      const found = document.querySelector(selector);
      if (found) { clearInterval(iv); cb(found); }
      else if (Date.now() - start > timeout) clearInterval(iv);
    }, 400);
  }

  function showInPageNotice(msg) {
    let notice = document.getElementById('jh-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'jh-notice';
      document.body.appendChild(notice);
    }
    notice.textContent = msg;
    notice.classList.add('jh-notice-show');
    setTimeout(() => notice.classList.remove('jh-notice-show'), 4000);
  }

  function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 60);
  }

})();
