/**
 * FindIt AI Lost & Found - Full Stack Campus Web Application
 * Modular, Clean Client-Side Architecture
 */

'use strict';

/* =========================================================
   1. CONFIGURATION & STATE MANAGEMENT
   ========================================================= */

const CONFIG = {
  API_BASE: 'https://findit-backend-p7nm.onrender.com/', // Relative API URL
  SESSION_STORAGE_KEY: 'findit_auth_token',
  USER_STORAGE_KEY: 'findit_auth_user'
};

const state = {
  currentUser: null,
  authToken: null,
  currentPage: 'dashboard',
  currentMatchId: null,
  searchDebounceTimer: null,
  selectedReportType: 'lost',
  cachedMatches: [],
  cachedItems: []
};

/* =========================================================
   2. API SERVICE LAYER
   ========================================================= */

const API = {
  async request(endpoint, options = {}) {
    const headers = { ...options.headers };

    if (state.authToken) {
      headers['Authorization'] = `Bearer ${state.authToken}`;
      headers['x-session-token'] = state.authToken;
    }

    // Only set Content-Type if not sending FormData
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
        ...options,
        headers
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 401 && !endpoint.startsWith('/api/auth/')) {
          AuthModule.handleUnauthorized();
        }
        throw new Error(data.error || `HTTP error ${response.status}`);
      }

      return data;
    } catch (err) {
      console.warn(`API Error [${endpoint}]:`, err.message);
      throw err;
    }
  },

  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  post(endpoint, body) {
    const isForm = body instanceof FormData;
    return this.request(endpoint, {
      method: 'POST',
      body: isForm ? body : JSON.stringify(body)
    });
  },

  put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  },

  patch(endpoint, body = {}) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
};

/* =========================================================
   3. TOAST NOTIFICATION SERVICE
   ========================================================= */

const Toast = {
  timer: null,

  show(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.className = 'toast show';
    if (type === 'error') toast.style.background = '#e95757';
    else if (type === 'success') toast.style.background = '#18a66a';
    else toast.style.background = '#282230';

    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      toast.className = 'toast';
    }, 4000);
  }
};

/* =========================================================
   4. AUTHENTICATION MODULE
   ========================================================= */

const AuthModule = {
  init() {
    this.bindEvents();
    this.checkExistingSession();
  },

  bindEvents() {
    // Switch between Login and Signup
    document.getElementById('switchToSignup')?.addEventListener('click', () => {
      this.showAuthView('signup');
    });

    document.getElementById('switchToLogin')?.addEventListener('click', () => {
      this.showAuthView('login');
    });

    // Password Show/Hide toggles
    document.querySelectorAll('.password-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const input = document.getElementById(targetId);
        if (input) {
          const isPassword = input.type === 'password';
          input.type = isPassword ? 'text' : 'password';
          btn.textContent = isPassword ? 'Hide' : 'Show';
        }
      });
    });

    // Login Form Submission
    const loginForm = document.getElementById('loginFormElement');
    loginForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleLogin();
    });

    // Signup Form Submission
    const signupForm = document.getElementById('signupFormElement');
    signupForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSignup();
    });

    // Campus SSO Modal Openers
    document.getElementById('campusLogin')?.addEventListener('click', () => {
      document.getElementById('campusModal')?.classList.add('show');
    });

    document.getElementById('campusSignupBtn')?.addEventListener('click', () => {
      document.getElementById('campusModal')?.classList.add('show');
    });

    document.getElementById('closeCampusModal')?.addEventListener('click', () => {
      document.getElementById('campusModal')?.classList.remove('show');
    });

    // Campus SSO Quick Account Chips
    document.querySelectorAll('.quick-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const email = chip.dataset.email;
        const fname = chip.dataset.fname;
        const lname = chip.dataset.lname;
        const id = chip.dataset.id;
        const input = document.getElementById('campusSsoIdentifier');
        if (input) input.value = email;
        this.performCampusLogin({ campus_email: email, campus_id: id, first_name: fname, last_name: lname });
      });
    });

    // Campus SSO Form Submit
    document.getElementById('campusSsoForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const identifier = document.getElementById('campusSsoIdentifier')?.value.trim();
      if (!identifier) {
        Toast.show('Campus account not found. Please check your email or Student ID.', 'error');
        return;
      }
      await this.performCampusLogin({ campus_email: identifier, campus_id: identifier });
    });

    // Forgot password demo
    document.getElementById('forgotPasswordBtn')?.addEventListener('click', () => {
      Toast.show('Password reset link sent to your campus email if registered.', 'info');
    });
  },

  showAuthView(view) {
    const login = document.getElementById('loginForm');
    const signup = document.getElementById('signupForm');
    if (!login || !signup) return;

    login.classList.toggle('active', view === 'login');
    signup.classList.toggle('active', view === 'signup');
  },

  async handleLogin() {
    const email = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;
    const submitBtn = document.getElementById('loginSubmitBtn');

    if (!email || !password) {
      Toast.show('Please enter your email and password.', 'error');
      return;
    }

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in...';
      }

      const res = await API.post('/api/auth/login', { email, password });
      this.setSession(res.token, res.user);
      Toast.show(`Welcome back, ${res.user.first_name}!`, 'success');
      this.enterApplication();
    } catch (err) {
      let msg = err.message || 'Invalid email or password.';
      if (msg.includes('Account does not exist') || msg.includes('Account not found') || msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('create an account') || msg.toLowerCase().includes('does not exist')) {
        msg = 'Account does not exist. Please create an account first.';
      } else if (msg.includes('Incorrect password') || msg.toLowerCase().includes('incorrect') || msg.toLowerCase().includes('password')) {
        msg = 'Incorrect password. Please try again.';
      }
      Toast.show(msg, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In →';
      }
    }
  },

  async handleSignup() {
    const first_name = document.getElementById('signupFirst')?.value.trim();
    const last_name = document.getElementById('signupLast')?.value.trim();
    const email = document.getElementById('signupEmail')?.value.trim();
    const student_id = document.getElementById('signupId')?.value.trim();
    const password = document.getElementById('signupPassword')?.value;
    const confirmPass = document.getElementById('signupConfirmPassword')?.value;
    const submitBtn = document.getElementById('signupSubmitBtn');

    if (!first_name || !last_name || !email || !student_id || !password || !confirmPass) {
      Toast.show('Please fill in all required fields.', 'error');
      return;
    }

    if (password !== confirmPass) {
      Toast.show('Passwords do not match.', 'error');
      return;
    }

    if (password.length < 6) {
      Toast.show('Password must be at least 6 characters.', 'error');
      return;
    }

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating account...';
      }

      const res = await API.post('/api/auth/signup', {
        first_name,
        last_name,
        email,
        student_id,
        password
      });

      this.setSession(res.token, res.user);
      Toast.show('Account created successfully!', 'success');
      this.enterApplication();
    } catch (err) {
      let msg = err.message || 'Could not create account.';
      if (msg.toLowerCase().includes('email') && (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('exists') || msg.toLowerCase().includes('registered'))) {
        msg = 'An account with this email already exists.';
      } else if (msg.toLowerCase().includes('student') || msg.toLowerCase().includes('id')) {
        msg = 'An account with this Student ID already exists.';
      }
      Toast.show(msg, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account →';
      }
    }
  },

  async performCampusLogin(payload) {
    const submitBtn = document.getElementById('campusSsoSubmitBtn');
    const identifier = (payload.campus_email || payload.campus_id || '').trim();

    if (!identifier) {
      Toast.show('Campus account not found. Please check your email or Student ID.', 'error');
      return;
    }

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Authenticating with Campus SSO...';
      }

      const res = await API.post('/api/auth/campus-login', payload);
      document.getElementById('campusModal')?.classList.remove('show');
      this.setSession(res.token, res.user);
      Toast.show(`Authenticated via Campus SSO as ${res.user.first_name}`, 'success');
      this.enterApplication();
    } catch (err) {
      let msg = err.message || 'Campus authentication failed.';
      if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('check your email') || msg.toLowerCase().includes('student id') || msg.toLowerCase().includes('invalid')) {
        msg = 'Campus account not found. Please check your email or Student ID.';
      }
      Toast.show(msg, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Authenticate & Continue to FindIt →';
      }
    }
  },

  setSession(token, user) {
    state.authToken = token;
    state.currentUser = user;
    localStorage.setItem(CONFIG.SESSION_STORAGE_KEY, token);
    localStorage.setItem(CONFIG.USER_STORAGE_KEY, JSON.stringify(user));
  },

  checkExistingSession() {
    const token = localStorage.getItem(CONFIG.SESSION_STORAGE_KEY);
    const userStr = localStorage.getItem(CONFIG.USER_STORAGE_KEY);

    if (token && userStr) {
      try {
        state.authToken = token;
        state.currentUser = JSON.parse(userStr);
        this.enterApplication();
        return;
      } catch (e) {
        this.clearSession();
      }
    }

    this.showAuthScreen();
  },

  clearSession() {
    state.authToken = null;
    state.currentUser = null;
    localStorage.removeItem(CONFIG.SESSION_STORAGE_KEY);
    localStorage.removeItem(CONFIG.USER_STORAGE_KEY);
  },

  handleUnauthorized() {
    this.clearSession();
    this.showAuthScreen();
    Toast.show('Session expired. Please sign in again.', 'info');
  },

  async logout() {
    try {
      await API.post('/api/auth/logout', {});
    } catch (e) {
      // ignore
    }
    this.clearSession();
    this.showAuthScreen();
    Toast.show('Signed out successfully.', 'info');
  },

  showAuthScreen() {
    const authScreen = document.getElementById('authScreen');
    if (authScreen) authScreen.classList.remove('hidden');
    document.body.classList.add('auth-active');
    this.showAuthView('login');
  },

  enterApplication() {
    const authScreen = document.getElementById('authScreen');
    if (authScreen) authScreen.classList.add('hidden');
    document.body.classList.remove('auth-active');

    // Sync UI with current user
    this.updateUserInterface();

    // Load initial dashboard data
    DashboardModule.loadDashboard();
    NotificationsModule.loadNotifications();
  },

  updateUserInterface() {
    if (!state.currentUser) return;
    const u = state.currentUser;

    // Sidebar
    const sideAvatar = document.getElementById('sidebarAvatar');
    const sideName = document.getElementById('sidebarUserName');
    const sideCampus = document.getElementById('sidebarUserCampus');
    if (sideAvatar) sideAvatar.textContent = u.avatar || (u.first_name[0] + u.last_name[0]).toUpperCase();
    if (sideName) sideName.textContent = `${u.first_name} ${u.last_name}`;
    if (sideCampus) sideCampus.textContent = `Student · ${u.campus || 'Campus'}`;

    // Topbar
    const topAvatar = document.getElementById('topAvatar');
    const topName = document.getElementById('topUserName');
    if (topAvatar) topAvatar.textContent = u.avatar || (u.first_name[0] + u.last_name[0]).toUpperCase();
    if (topName) topName.textContent = u.first_name;

    // Greeting
    const dashGreeting = document.getElementById('dashGreeting');
    if (dashGreeting) dashGreeting.textContent = `Welcome back, ${u.first_name}! 👋`;

    // Profile Modal
    const modalAvatar = document.getElementById('modalProfileAvatar');
    const modalName = document.getElementById('modalProfileName');
    const modalRole = document.getElementById('modalProfileRole');
    const modalEmail = document.getElementById('modalProfileEmail');
    const modalId = document.getElementById('modalProfileId');
    const modalCampus = document.getElementById('modalProfileCampus');

    if (modalAvatar) modalAvatar.textContent = u.avatar || (u.first_name[0] + u.last_name[0]).toUpperCase();
    if (modalName) modalName.textContent = `${u.first_name} ${u.last_name}`;
    if (modalRole) modalRole.textContent = `Student · ${u.campus || 'Central Campus'}`;
    if (modalEmail) modalEmail.textContent = u.email;
    if (modalId) modalId.textContent = u.student_id;
    if (modalCampus) modalCampus.textContent = u.campus || 'Central Campus';

    // Settings fields
    const sFirst = document.getElementById('settingsFirst');
    const sLast = document.getElementById('settingsLast');
    const sEmail = document.getElementById('settingsEmail');
    const sId = document.getElementById('settingsId');
    const sCampus = document.getElementById('settingsCampus');

    if (sFirst) sFirst.value = u.first_name;
    if (sLast) sLast.value = u.last_name;
    if (sEmail) sEmail.value = u.email;
    if (sId) sId.value = u.student_id;
    if (sCampus) sCampus.value = u.campus || 'Central Campus';
  }
};

/* =========================================================
   5. NAVIGATION & ROUTING MODULE
   ========================================================= */

const NavigationModule = {
  init() {
    this.bindEvents();
  },

  bindEvents() {
    // Nav items with data-page attribute
    document.querySelectorAll('[data-page]').forEach(el => {
      el.addEventListener('click', (e) => {
        const page = el.dataset.page;
        if (page) {
          e.preventDefault();
          this.navigateTo(page);
        }
      });
    });

    // Mobile Hamburger
    const mobileMenu = document.getElementById('mobileMenu');
    const sidebar = document.getElementById('sidebar');
    mobileMenu?.addEventListener('click', () => {
      sidebar?.classList.toggle('mobile-open');
    });

    // Close mobile sidebar on page navigation
    document.querySelectorAll('.side-nav .nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        sidebar?.classList.remove('mobile-open');
      });
    });
  },

  navigateTo(pageId) {
    state.currentPage = pageId;

    // Update active nav button
    document.querySelectorAll('.side-nav .nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === pageId);
    });

    // Update breadcrumb
    const breadcrumb = document.getElementById('breadcrumb');
    const pageLabels = {
      dashboard: 'Dashboard',
      search: 'Search',
      lost: 'Lost Items',
      found: 'Found Items',
      matches: 'AI Matches',
      'match-details': 'Match Details',
      reports: 'My Reports',
      notifications: 'Notifications',
      settings: 'Settings'
    };
    if (breadcrumb) breadcrumb.textContent = pageLabels[pageId] || 'Dashboard';

    // Switch visible section
    document.querySelectorAll('.page').forEach(sec => {
      sec.classList.remove('active');
    });
    const targetPage = document.getElementById(`page-${pageId}`);
    if (targetPage) {
      targetPage.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Trigger page-specific data load
    switch (pageId) {
      case 'dashboard':
        DashboardModule.loadDashboard();
        break;
      case 'search':
        SearchModule.executeSearch();
        break;
      case 'lost':
        ItemsModule.loadLostItems();
        break;
      case 'found':
        ItemsModule.loadFoundItems();
        break;
      case 'matches':
        MatchesModule.loadMatches();
        break;
      case 'reports':
        ReportsModule.loadMyReports();
        break;
      case 'notifications':
        NotificationsModule.loadNotifications();
        break;
    }
  }
};

/* =========================================================
   6. DASHBOARD MODULE
   ========================================================= */

const DashboardModule = {
  async loadDashboard() {
    try {
      const stats = await API.get('/api/stats');
      this.renderStats(stats);
      this.renderFeaturedMatch(stats.featuredMatch);
      this.renderCategoryCounts(stats.categoryCounts);
      this.renderRecentActivity(stats.recentItems);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    }
  },

  renderStats(stats) {
    if (!stats) return;

    // Active reports
    const activeEl = document.getElementById('statActiveReports');
    if (activeEl) activeEl.textContent = stats.userActiveReports;

    // Lost items
    const lostEl = document.getElementById('statLostCount');
    const sideLostEl = document.getElementById('sideLostCount');
    if (lostEl) lostEl.textContent = stats.lostItems;
    if (sideLostEl) sideLostEl.textContent = stats.lostItems;

    // Found items
    const foundEl = document.getElementById('statFoundCount');
    const sideFoundEl = document.getElementById('sideFoundCount');
    if (foundEl) foundEl.textContent = stats.foundItems;
    if (sideFoundEl) sideFoundEl.textContent = stats.foundItems;

    // Potential matches
    const matchEl = document.getElementById('statMatchesCount');
    const sideMatchEl = document.getElementById('sideMatchesCount');
    if (matchEl) matchEl.textContent = stats.potentialMatches;
    if (sideMatchEl) sideMatchEl.textContent = stats.potentialMatches;
  },

  renderFeaturedMatch(match) {
    const container = document.getElementById('dashFeatureMatch');
    const titleEl = document.getElementById('dashMatchTitle');
    if (!container) return;

    if (!match) {
      if (titleEl) titleEl.textContent = 'AI Match Assistant';
      container.innerHTML = `
        <div class="empty-state" style="padding: 20px;">
          <span>✦</span>
          <h3>No active match suggestions</h3>
          <p>Report an item to start automatic AI similarity scanning against campus records.</p>
        </div>
      `;
      return;
    }

    if (titleEl) {
      titleEl.textContent = `Possible match for your ${match.lost_name}`;
    }

    const defaultImg = 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=700&q=80';
    const lostImg = match.lost_img || defaultImg;
    const foundImg = match.found_img || defaultImg;

    container.innerHTML = `
      <div class="match-item">
        <div class="image-box">
          <img src="${lostImg}" alt="${escapeHTML(match.lost_name)}">
        </div>
        <div class="item-info">
          <span class="pill lost">YOUR LOST ITEM</span>
          <h3>${escapeHTML(match.lost_name)}</h3>
          <p>Reported ${formatDate(match.lost_date)} · ${escapeHTML(match.lost_loc)}</p>
          <div class="tags">
            ${match.lost_color ? `<span>${escapeHTML(match.lost_color)}</span>` : ''}
            ${match.lost_brand ? `<span>${escapeHTML(match.lost_brand)}</span>` : ''}
            <span>${escapeHTML(match.lost_cat)}</span>
          </div>
        </div>
      </div>

      <div class="match-score">
        <div class="score-ring">
          <strong>${match.score}%</strong>
          <span>Match</span>
        </div>
        <span class="confidence">${escapeHTML(match.confidence || 'High confidence')}</span>
      </div>

      <div class="match-item">
        <div class="image-box">
          <img src="${foundImg}" alt="${escapeHTML(match.found_name)}">
        </div>
        <div class="item-info">
          <span class="pill found">FOUND ITEM</span>
          <h3>${escapeHTML(match.found_name)}</h3>
          <p>Found ${formatDate(match.found_date)} · ${escapeHTML(match.found_loc)}</p>
          <div class="tags">
            ${match.found_color ? `<span>${escapeHTML(match.found_color)}</span>` : ''}
            <span>${escapeHTML(match.found_cat)}</span>
            <span>Campus</span>
          </div>
        </div>
      </div>

      <button class="outline-btn match-details" id="dashCompareBtn" data-match-id="${match.id}">Compare details</button>
    `;

    document.getElementById('dashCompareBtn')?.addEventListener('click', () => {
      MatchesModule.openMatchDetails(match.id);
    });
  },

  renderCategoryCounts(counts = {}) {
    const cats = ['Electronics', 'Bags', 'Keys', 'Wallets', 'Clothing', 'Other'];
    cats.forEach(cat => {
      const el = document.getElementById(`catCount${cat}`);
      if (el) el.textContent = `${counts[cat] || 0} items`;
    });

    // Wire category button clicks to Search page filtered by category
    document.querySelectorAll('#dashCategoryGrid .category').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.cat;
        const catFilter = document.getElementById('categoryFilter');
        if (catFilter) catFilter.value = cat;
        NavigationModule.navigateTo('search');
        SearchModule.executeSearch();
      });
    });
  },

  renderRecentActivity(items = []) {
    const container = document.getElementById('dashRecentActivity');
    if (!container) return;

    if (items.length === 0) {
      container.innerHTML = `<p style="padding: 15px; font-size: 11px; color: var(--muted);">No recent campus reports.</p>`;
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="activity" style="cursor: pointer;" data-item-id="${item.id}">
        <img src="${item.image_url || placeholderImage()}" alt="${escapeHTML(item.item_name)}">
        <div>
          <b>${escapeHTML(item.item_name)}</b>
          <small>${item.type === 'lost' ? 'Lost' : 'Found'} · ${escapeHTML(item.location)}</small>
        </div>
        <span class="pill ${item.type}">${item.type === 'lost' ? 'Lost' : 'Found'}</span>
      </div>
    `).join('');

    container.querySelectorAll('.activity').forEach(row => {
      row.addEventListener('click', () => {
        ItemsModule.openItemDetails(row.dataset.itemId);
      });
    });
  }
};

/* =========================================================
   7. SEARCH MODULE
   ========================================================= */

const SearchModule = {
  init() {
    this.bindEvents();
  },

  bindEvents() {
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchButton');
    const typeFilter = document.getElementById('typeFilter');
    const catFilter = document.getElementById('categoryFilter');
    const locFilter = document.getElementById('locationFilter');
    const resetBtn = document.getElementById('resetFiltersBtn');

    searchInput?.addEventListener('input', () => {
      clearTimeout(state.searchDebounceTimer);
      state.searchDebounceTimer = setTimeout(() => this.executeSearch(), 350);
    });

    searchBtn?.addEventListener('click', () => this.executeSearch());
    typeFilter?.addEventListener('change', () => this.executeSearch());
    catFilter?.addEventListener('change', () => this.executeSearch());
    locFilter?.addEventListener('change', () => this.executeSearch());

    resetBtn?.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (typeFilter) typeFilter.value = 'all';
      if (catFilter) catFilter.value = 'all';
      if (locFilter) locFilter.value = 'all';
      this.executeSearch();
    });
  },

  async executeSearch() {
    const q = document.getElementById('searchInput')?.value.trim() || '';
    const type = document.getElementById('typeFilter')?.value || 'all';
    const category = document.getElementById('categoryFilter')?.value || 'all';
    const location = document.getElementById('locationFilter')?.value || 'all';

    const params = new URLSearchParams();
    if (q) params.append('q', q);
    if (type !== 'all') params.append('type', type);
    if (category !== 'all') params.append('category', category);
    if (location !== 'all') params.append('location', location);

    try {
      const res = await API.get(`/api/items?${params.toString()}`);
      this.renderResults(res.items || []);
    } catch (err) {
      Toast.show('Error searching items.', 'error');
    }
  },

  renderResults(items) {
    const container = document.getElementById('searchResults');
    const countEl = document.getElementById('resultCount');
    if (!container) return;

    if (countEl) countEl.textContent = items.length;

    if (items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span>🔍</span>
          <h3>No matching items found</h3>
          <p>Try adjusting your search keywords or clearing your active filters.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="item-card">
        <div class="card-image">
          <span class="pill ${item.type}">${item.type.toUpperCase()}</span>
          <img src="${item.image_url || placeholderImage()}" alt="${escapeHTML(item.item_name)}">
        </div>
        <div class="card-body">
          <h3>${escapeHTML(item.item_name)}</h3>
          <p>${escapeHTML(item.category)}${item.color ? ` · ${escapeHTML(item.color)}` : ''}</p>
          <small>📍 ${escapeHTML(item.location)} · ${formatDate(item.date)}</small>
          <button class="card-link view-item-btn" data-item-id="${item.id}">View details →</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.view-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        ItemsModule.openItemDetails(btn.dataset.itemId);
      });
    });
  }
};

/* =========================================================
   8. ITEMS MODULE (LOST & FOUND PAGES)
   ========================================================= */

const ItemsModule = {
  init() {
    this.bindEvents();
  },

  bindEvents() {
    // Lost page filters
    document.getElementById('lostCatFilter')?.addEventListener('change', () => this.loadLostItems());
    document.getElementById('lostLocFilter')?.addEventListener('change', () => this.loadLostItems());

    // Found page filters
    document.getElementById('foundCatFilter')?.addEventListener('change', () => this.loadFoundItems());
    document.getElementById('foundLocFilter')?.addEventListener('change', () => this.loadFoundItems());

    // Item details modal close
    document.getElementById('closeItemDetailsModal')?.addEventListener('click', () => {
      document.getElementById('itemDetailsModal')?.classList.remove('show');
    });
  },

  async loadLostItems() {
    const cat = document.getElementById('lostCatFilter')?.value || 'All categories';
    const loc = document.getElementById('lostLocFilter')?.value || 'All locations';

    const params = new URLSearchParams();
    if (cat !== 'All categories') params.append('category', cat);
    if (loc !== 'All locations') params.append('location', loc);

    try {
      const res = await API.get(`/api/items/lost?${params.toString()}`);
      this.renderItemGrid('lostGrid', res.items || [], 'lost');
    } catch (err) {
      console.error('Failed to load lost items:', err);
    }
  },

  async loadFoundItems() {
    const cat = document.getElementById('foundCatFilter')?.value || 'All categories';
    const loc = document.getElementById('foundLocFilter')?.value || 'All locations';

    const params = new URLSearchParams();
    if (cat !== 'All categories') params.append('category', cat);
    if (loc !== 'All locations') params.append('location', loc);

    try {
      const res = await API.get(`/api/items/found?${params.toString()}`);
      this.renderItemGrid('foundGrid', res.items || [], 'found');
    } catch (err) {
      console.error('Failed to load found items:', err);
    }
  },

  renderItemGrid(containerId, items, type) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span>📦</span>
          <h3>No ${type} items reported</h3>
          <p>No reports currently match this filter criteria.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="item-card">
        <div class="card-image">
          <span class="pill ${item.type}">${item.type.toUpperCase()}</span>
          <img src="${item.image_url || placeholderImage()}" alt="${escapeHTML(item.item_name)}">
        </div>
        <div class="card-body">
          <h3>${escapeHTML(item.item_name)}</h3>
          <p>${escapeHTML(item.category)}${item.color ? ` · ${escapeHTML(item.color)}` : ''}</p>
          <small>📍 ${escapeHTML(item.location)} · ${formatDate(item.date)}</small>
          <button class="card-link view-item-btn" data-item-id="${item.id}">View details →</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.view-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.openItemDetails(btn.dataset.itemId);
      });
    });
  },

  async openItemDetails(itemId) {
    try {
      const res = await API.get(`/api/items/${itemId}`);
      const item = res.item;
      const modal = document.getElementById('itemDetailsModal');
      const content = document.getElementById('itemDetailContent');
      if (!modal || !content || !item) return;

      content.innerHTML = `
        <span class="eyebrow">${item.type === 'lost' ? 'LOST REPORT' : 'FOUND REPORT'}</span>
        <h2>${escapeHTML(item.item_name)}</h2>
        <p class="modal-sub">Reported by campus member on ${formatDate(item.date)}</p>

        <div class="item-detail-hero">
          <span class="pill ${item.type}">${item.type.toUpperCase()}</span>
          <img src="${item.image_url || placeholderImage()}" alt="${escapeHTML(item.item_name)}">
        </div>

        <div class="item-detail-chips">
          <div><small>Category</small><b>${escapeHTML(item.category)}</b></div>
          <div><small>Color</small><b>${escapeHTML(item.color || 'Not specified')}</b></div>
          <div><small>Brand</small><b>${escapeHTML(item.brand || 'Unknown')}</b></div>
          <div><small>Location</small><b>${escapeHTML(item.location)}</b></div>
          <div><small>Date Reported</small><b>${formatDate(item.date)}</b></div>
          <div><small>Status</small><b style="text-transform:capitalize;">${escapeHTML(item.status)}</b></div>
        </div>

        <div class="item-detail-desc">
          <strong style="display:block; font-size: 10px; margin-bottom: 4px; color: var(--muted);">REPORTER'S NOTES:</strong>
          <p>${escapeHTML(item.description || 'No additional description provided.')}</p>
        </div>

        <div class="item-detail-reporter">
          <div class="avatar">${escapeHTML(item.avatar || 'ST')}</div>
          <div>
            <b>${escapeHTML(item.first_name)} ${escapeHTML(item.last_name)}</b>
            <small style="display:block; color: var(--muted); font-size: 9px;">Campus Member · ${escapeHTML(item.campus || 'Central Campus')}</small>
          </div>
        </div>
      `;

      modal.classList.add('show');
    } catch (err) {
      Toast.show('Failed to load item details.', 'error');
    }
  }
};

/* =========================================================
   9. AI MATCHES & COMPARISON MODULE
   ========================================================= */

const MatchesModule = {
  init() {
    this.bindEvents();
  },

  bindEvents() {
    document.getElementById('howItWorksBtn')?.addEventListener('click', () => {
      Toast.show('AI Match Engine analyzes 6 multi-factor dimensions: Image, Category, Color, Brand, Location, and Date proximity.', 'info');
    });

    // Claim match button on comparison page
    document.getElementById('claimMatchBtn')?.addEventListener('click', () => {
      document.getElementById('claimModal')?.classList.add('show');
    });

    // Claim modal close
    document.getElementById('closeClaimModal')?.addEventListener('click', () => {
      document.getElementById('claimModal')?.classList.remove('show');
    });

    // Claim submit form
    document.getElementById('claimSubmitForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.submitClaim();
    });
  },

  async loadMatches() {
    try {
      const res = await API.get('/api/matches');
      state.cachedMatches = res.matches || [];
      this.renderMatchesList(state.cachedMatches);
    } catch (err) {
      console.error('Failed to load AI matches:', err);
    }
  },

  renderMatchesList(matches) {
    const container = document.getElementById('matchCards');
    const bannerTitle = document.getElementById('aiBannerTitle');
    const bannerSubtitle = document.getElementById('aiBannerSubtitle');
    if (!container) return;

    if (bannerTitle) {
      bannerTitle.textContent = `${matches.length} potential matches found`;
    }
    if (bannerSubtitle) {
      bannerSubtitle.textContent = matches.length > 0 
        ? `We found AI similarity matches for your campus reports.`
        : `No active potential matches yet. When a matching item is reported, you will be notified.`;
    }

    if (matches.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span>✦</span>
          <h3>No AI Matches Found Yet</h3>
          <p>FindIt continuously scans campus lost and found submissions. Once a matching report is identified, it will appear here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = matches.map(match => `
      <div class="ai-match-card">
        <div class="match-card-top">
          <span class="pill purple-pill">AI MATCH SUGGESTION</span>
          <span class="match-percent">${match.score}% MATCH</span>
        </div>

        <div class="match-pair">
          <div>
            <img src="${match.lost_img || placeholderImage()}" alt="${escapeHTML(match.lost_name)}">
            <span>YOUR LOST ITEM</span>
            <b>${escapeHTML(match.lost_name)}</b>
          </div>

          <div class="connector">⇄</div>

          <div>
            <img src="${match.found_img || placeholderImage()}" alt="${escapeHTML(match.found_name)}">
            <span>FOUND ITEM</span>
            <b>${escapeHTML(match.found_name)}</b>
          </div>
        </div>

        <div class="match-card-bottom">
          <span>📍 ${escapeHTML(match.found_loc)} · ${formatDate(match.found_date)}</span>
          <span>✓ ${escapeHTML(match.confidence)}</span>
          <button class="primary-btn compare-btn" data-match-id="${match.id}">Compare details →</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.compare-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.openMatchDetails(btn.dataset.matchId);
      });
    });
  },

  async openMatchDetails(matchId) {
    try {
      state.currentMatchId = matchId;
      const res = await API.get(`/api/matches/${matchId}`);
      const match = res.match;
      const alreadyClaimed = res.alreadyClaimed;

      // Populate Match Details page
      const title = document.getElementById('matchCompareHeaderTitle');
      const bigScore = document.getElementById('matchCompareBigScore');
      if (title) title.textContent = `Possible Match: ${match.lost_name}`;
      if (bigScore) bigScore.innerHTML = `${match.score}% <small>match</small>`;

      // Lost Item Card
      document.getElementById('compareLostImg').src = match.lost_img || placeholderImage();
      document.getElementById('compareLostName').textContent = match.lost_name;
      document.getElementById('compareLostLocationDate').textContent = `Reported ${formatDate(match.lost_date)} · ${match.lost_loc}`;
      document.getElementById('compareLostColor').textContent = match.lost_color || 'Black';
      document.getElementById('compareLostBrand').textContent = match.lost_brand || 'Unknown';
      document.getElementById('compareLostCategory').textContent = match.lost_cat;
      document.getElementById('compareLostDesc').textContent = match.lost_desc || 'No description provided.';

      // Found Item Card
      document.getElementById('compareFoundImg').src = match.found_img || placeholderImage();
      document.getElementById('compareFoundName').textContent = match.found_name;
      document.getElementById('compareFoundLocationDate').textContent = `Found ${formatDate(match.found_date)} · ${match.found_loc}`;
      document.getElementById('compareFoundColor').textContent = match.found_color || 'Black';
      document.getElementById('compareFoundBrand').textContent = match.found_brand || 'Unknown';
      document.getElementById('compareFoundCategory').textContent = match.found_cat;
      document.getElementById('compareFoundDesc').textContent = match.found_desc || 'No description provided.';

      // Multi-factor Progress Bars & Ring
      document.getElementById('compareRingScore').textContent = `${match.score}%`;
      document.getElementById('compareRingLabel').textContent = match.confidence;

      const setBar = (type, score) => {
        const val = score || 85;
        const text = document.getElementById(`bar${type}Score`);
        const fill = document.getElementById(`bar${type}Fill`);
        if (text) text.textContent = `${val}%`;
        if (fill) fill.style.width = `${val}%`;
      };

      setBar('Image', match.image_sim);
      setBar('Category', match.category_sim);
      setBar('Color', match.color_sim);
      setBar('Location', match.location_sim);
      setBar('Date', match.date_sim);
      setBar('Brand', match.brand_sim);

      // Claim button status
      const claimBtn = document.getElementById('claimMatchBtn');
      const actionPrompt = document.getElementById('claimActionPrompt');

      if (alreadyClaimed) {
        if (claimBtn) {
          claimBtn.disabled = true;
          claimBtn.textContent = 'Claim Submitted ✓';
          claimBtn.style.background = '#18a66a';
        }
        if (actionPrompt) actionPrompt.textContent = 'Your claim request has been submitted.';
      } else {
        if (claimBtn) {
          claimBtn.disabled = false;
          claimBtn.textContent = 'Claim Match';
          claimBtn.style.background = 'var(--purple)';
        }
        if (actionPrompt) actionPrompt.textContent = 'Does this look like your missing item?';
      }

      NavigationModule.navigateTo('match-details');
    } catch (err) {
      Toast.show('Failed to load match comparison.', 'error');
    }
  },

  async submitClaim() {
    if (!state.currentMatchId) return;

    const note = document.getElementById('claimNote')?.value.trim();
    const submitBtn = document.getElementById('confirmClaimBtn');

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting claim...';
      }

      const res = await API.post(`/api/matches/${state.currentMatchId}/claim`, { message: note });
      document.getElementById('claimModal')?.classList.remove('show');
      Toast.show(res.message || 'Your claim has been submitted.', 'success');

      // Update claim button on page
      const claimBtn = document.getElementById('claimMatchBtn');
      if (claimBtn) {
        claimBtn.disabled = true;
        claimBtn.textContent = 'Claim Submitted ✓';
        claimBtn.style.background = '#18a66a';
      }

      // Refresh notifications & stats
      NotificationsModule.loadNotifications();
      DashboardModule.loadDashboard();
    } catch (err) {
      Toast.show(err.message || 'Failed to submit claim.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Claim Request →';
      }
    }
  }
};

/* =========================================================
   10. REPORTS MODULE (REPORT FORM & MY REPORTS)
   ========================================================= */

const ReportsModule = {
  init() {
    this.bindEvents();
  },

  bindEvents() {
    // Open Report Modal Buttons
    const openBtns = [
      'openReportBtn', 'dashReportBtn', 'lostReportBtn', 
      'foundReportBtn', 'newReportBtn'
    ];
    openBtns.forEach(id => {
      document.getElementById(id)?.addEventListener('click', (e) => {
        const type = id === 'foundReportBtn' ? 'found' : 'lost';
        this.openReportModal(type);
      });
    });

    // Close Report Modal
    document.getElementById('closeReport')?.addEventListener('click', () => {
      document.getElementById('reportModal')?.classList.remove('show');
    });

    // Type Toggles (Lost vs Found)
    const toggleLost = document.getElementById('toggleLost');
    const toggleFound = document.getElementById('toggleFound');

    toggleLost?.addEventListener('click', () => {
      state.selectedReportType = 'lost';
      toggleLost.classList.add('selected');
      toggleFound?.classList.remove('selected');
    });

    toggleFound?.addEventListener('click', () => {
      state.selectedReportType = 'found';
      toggleFound.classList.add('selected');
      toggleLost?.classList.remove('selected');
    });

    // Image Upload & Preview Handler
    const fileInput = document.getElementById('itemPhoto');
    const previewWrap = document.getElementById('imgPreviewWrap');
    const previewImg = document.getElementById('imgPreview');
    const removeBtn = document.getElementById('removePreviewBtn');
    const uploadBox = document.getElementById('uploadBox');

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) {
          Toast.show('Image size exceeds 5MB limit.', 'error');
          fileInput.value = '';
          return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
          if (previewImg) previewImg.src = e.target.result;
          if (previewWrap) previewWrap.style.display = 'block';
          if (uploadBox) uploadBox.style.display = 'none';
        };
        reader.readAsDataURL(file);
      }
    });

    removeBtn?.addEventListener('click', () => {
      if (fileInput) fileInput.value = '';
      if (previewWrap) previewWrap.style.display = 'none';
      if (uploadBox) uploadBox.style.display = 'block';
    });

    // Report Form Submit
    document.getElementById('reportForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.submitReport();
    });
  },

  openReportModal(defaultType = 'lost') {
    state.selectedReportType = defaultType;
    const toggleLost = document.getElementById('toggleLost');
    const toggleFound = document.getElementById('toggleFound');

    if (defaultType === 'lost') {
      toggleLost?.classList.add('selected');
      toggleFound?.classList.remove('selected');
    } else {
      toggleFound?.classList.add('selected');
      toggleLost?.classList.remove('selected');
    }

    // Set today's date as default
    const dateInput = document.getElementById('itemDate');
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().split('T')[0];
    }

    document.getElementById('reportModal')?.classList.add('show');
  },

  async submitReport() {
    const itemName = document.getElementById('itemName')?.value.trim();
    const category = document.getElementById('itemCategory')?.value;
    const color = document.getElementById('itemColor')?.value.trim();
    const brand = document.getElementById('itemBrand')?.value.trim();
    const location = document.getElementById('itemLocation')?.value;
    const date = document.getElementById('itemDate')?.value;
    const description = document.getElementById('itemDescription')?.value.trim();
    const fileInput = document.getElementById('itemPhoto');
    const submitBtn = document.getElementById('submitReportBtn');

    if (!itemName || !category || !location || !date) {
      Toast.show('Please fill in all required fields.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('type', state.selectedReportType);
    formData.append('item_name', itemName);
    formData.append('category', category);
    formData.append('color', color);
    formData.append('brand', brand);
    formData.append('location', location);
    formData.append('date', date);
    formData.append('description', description);

    if (fileInput?.files[0]) {
      formData.append('image', fileInput.files[0]);
    }

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting report & running AI match...';
      }

      const res = await API.post('/api/items', formData);
      Toast.show(res.message || 'Report submitted successfully!', 'success');

      // Close modal and reset
      document.getElementById('reportModal')?.classList.remove('show');
      document.getElementById('reportForm')?.reset();
      document.getElementById('imgPreviewWrap').style.display = 'none';
      document.getElementById('uploadBox').style.display = 'block';

      // Refresh dashboard and redirect to My Reports
      DashboardModule.loadDashboard();
      NotificationsModule.loadNotifications();
      NavigationModule.navigateTo('reports');
    } catch (err) {
      Toast.show(err.message || 'Failed to submit report.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Report →';
      }
    }
  },

  async loadMyReports() {
    try {
      const res = await API.get('/api/items/my');
      this.renderMyReports(res.reports || [], res.stats || {});
    } catch (err) {
      console.error('Failed to load user reports:', err);
    }
  },

  renderMyReports(reports, stats) {
    // Stats pills
    document.getElementById('myStatTotal').textContent = stats.total || reports.length;
    document.getElementById('myStatLost').textContent = stats.lost || 0;
    document.getElementById('myStatMatches').textContent = stats.matches || 0;
    document.getElementById('myStatResolved').textContent = stats.resolved || 0;

    const container = document.getElementById('myReportsList');
    if (!container) return;

    if (reports.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span>📝</span>
          <h3>You haven't submitted any reports yet</h3>
          <p>Report an item you lost or found around campus to track it here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = reports.map(item => {
      const hasMatch = item.match_count > 0;
      const isResolved = item.status === 'resolved';

      return `
        <div class="report-row">
          <img src="${item.image_url || placeholderImage()}" alt="${escapeHTML(item.item_name)}">
          <div class="report-main">
            <span class="pill ${item.type}">${item.type.toUpperCase()}</span>
            <h3>${escapeHTML(item.item_name)}</h3>
            <p>Reported ${formatDate(item.date)} · ${escapeHTML(item.location)}</p>
          </div>

          ${hasMatch ? `<span class="status warning">${item.match_count} AI match${item.match_count > 1 ? 'es' : ''}</span>` : ''}
          ${isResolved ? `<span class="status success">Resolved</span>` : ''}
          ${!hasMatch && !isResolved ? `<span class="status success">Active</span>` : ''}

          ${hasMatch && item.top_match_id 
            ? `<button class="outline-btn view-match-btn" data-match-id="${item.top_match_id}">View match</button>` 
            : `<button class="outline-btn view-report-btn" data-item-id="${item.id}">View report</button>`}
        </div>
      `;
    }).join('');

    container.querySelectorAll('.view-match-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        MatchesModule.openMatchDetails(btn.dataset.matchId);
      });
    });

    container.querySelectorAll('.view-report-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        ItemsModule.openItemDetails(btn.dataset.itemId);
      });
    });
  }
};

/* =========================================================
   11. NOTIFICATIONS MODULE
   ========================================================= */

const NotificationsModule = {
  init() {
    this.bindEvents();
  },

  bindEvents() {
    document.getElementById('markAllReadBtn')?.addEventListener('click', async () => {
      await this.markAllAsRead();
    });
  },

  async loadNotifications() {
    try {
      const res = await API.get('/api/notifications');
      const list = res.notifications || [];
      const unreadCount = res.unreadCount || 0;

      // Update badges
      const sideBadge = document.getElementById('sideNotifCount');
      const notifDot = document.getElementById('notifDot');

      if (sideBadge) {
        sideBadge.textContent = unreadCount;
        sideBadge.style.display = unreadCount > 0 ? 'inline-block' : 'none';
      }
      if (notifDot) {
        notifDot.style.display = unreadCount > 0 ? 'block' : 'none';
      }

      this.renderNotificationsList(list);
    } catch (err) {
      console.warn('Failed to load notifications:', err);
    }
  },

  renderNotificationsList(notifications) {
    const container = document.getElementById('notificationsList');
    if (!container) return;

    if (notifications.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span>🔔</span>
          <h3>You're all caught up</h3>
          <p>No new updates or alerts at this time.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = notifications.map(n => {
      const icon = n.type === 'match' ? '✦' : (n.type === 'claim' ? '🛡️' : '✓');
      const bg = n.type === 'match' ? 'purple-bg' : (n.type === 'claim' ? 'yellow-bg' : 'green-bg');

      return `
        <div class="notification ${n.is_read === 0 ? 'unread' : ''}" data-id="${n.id}">
          <span class="notification-icon ${bg}">${icon}</span>
          <div>
            <b>${escapeHTML(n.title)}</b>
            <p>${escapeHTML(n.message)}</p>
            <small>${formatDate(n.created_at)}</small>
          </div>
          ${n.match_id ? `<button class="notif-action-btn" data-match-id="${n.match_id}">View match →</button>` : ''}
          ${n.item_id && !n.match_id ? `<button class="notif-item-btn" data-item-id="${n.item_id}">View item →</button>` : ''}
        </div>
      `;
    }).join('');

    // Mark as read on click
    container.querySelectorAll('.notification').forEach(row => {
      row.addEventListener('click', async () => {
        const id = row.dataset.id;
        if (row.classList.contains('unread')) {
          row.classList.remove('unread');
          await API.patch(`/api/notifications/${id}/read`);
          this.loadNotifications();
        }
      });
    });

    container.querySelectorAll('.notif-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        MatchesModule.openMatchDetails(btn.dataset.matchId);
      });
    });

    container.querySelectorAll('.notif-item-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        ItemsModule.openItemDetails(btn.dataset.itemId);
      });
    });
  },

  async markAllAsRead() {
    try {
      await API.patch('/api/notifications/read-all');
      Toast.show('All notifications marked as read.', 'success');
      this.loadNotifications();
    } catch (err) {
      Toast.show('Failed to mark notifications read.', 'error');
    }
  }
};

/* =========================================================
   12. PROFILE & SETTINGS MODULE
   ========================================================= */

const ProfileModule = {
  init() {
    this.bindEvents();
  },

  bindEvents() {
    // Open Profile Modal from Topbar or Sidebar
    document.getElementById('topProfileBtn')?.addEventListener('click', () => {
      this.openProfileModal();
    });

    document.getElementById('sidebarUserBtn')?.addEventListener('click', () => {
      this.openProfileModal();
    });

    // Close Profile Modal
    document.getElementById('closeProfileModal')?.addEventListener('click', () => {
      document.getElementById('profileModal')?.classList.remove('show');
    });

    // Profile Modal Actions
    document.getElementById('profileGoReports')?.addEventListener('click', () => {
      document.getElementById('profileModal')?.classList.remove('show');
      NavigationModule.navigateTo('reports');
    });

    document.getElementById('profileGoSettings')?.addEventListener('click', () => {
      document.getElementById('profileModal')?.classList.remove('show');
      NavigationModule.navigateTo('settings');
    });

    document.getElementById('profileSignOutBtn')?.addEventListener('click', () => {
      document.getElementById('profileModal')?.classList.remove('show');
      AuthModule.logout();
    });

    document.getElementById('settingsSignOutBtn')?.addEventListener('click', () => {
      AuthModule.logout();
    });

    // Profile Settings Update Form
    document.getElementById('profileUpdateForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const first_name = document.getElementById('settingsFirst')?.value.trim();
      const last_name = document.getElementById('settingsLast')?.value.trim();
      const campus = document.getElementById('settingsCampus')?.value;

      try {
        const res = await API.put('/api/users/me', { first_name, last_name, campus });
        state.currentUser = res.user;
        localStorage.setItem(CONFIG.USER_STORAGE_KEY, JSON.stringify(res.user));
        AuthModule.updateUserInterface();
        Toast.show('Profile updated successfully!', 'success');
      } catch (err) {
        Toast.show(err.message || 'Failed to update profile.', 'error');
      }
    });

    // Password Change Form
    document.getElementById('passwordChangeForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const new_password = document.getElementById('settingsNewPass')?.value;
      const confirm_password = document.getElementById('settingsConfirmPass')?.value;

      if (!new_password || new_password.length < 6) {
        Toast.show('Password must be at least 6 characters.', 'error');
        return;
      }
      if (new_password !== confirm_password) {
        Toast.show('New passwords do not match.', 'error');
        return;
      }

      try {
        await API.put('/api/users/me', { new_password });
        document.getElementById('settingsNewPass').value = '';
        document.getElementById('settingsConfirmPass').value = '';
        Toast.show('Password updated successfully!', 'success');
      } catch (err) {
        Toast.show(err.message || 'Failed to update password.', 'error');
      }
    });
  },

  openProfileModal() {
    AuthModule.updateUserInterface();
    document.getElementById('profileModal')?.classList.add('show');
  }
};

/* =========================================================
   13. HELPER UTILITIES
   ========================================================= */

function escapeHTML(str = '') {
  return String(str).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function formatDate(dateValue) {
  if (!dateValue) return 'Recent';
  try {
    const d = new Date(dateValue.includes('T') ? dateValue : dateValue + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return dateValue;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateValue;
  }
}

function placeholderImage() {
  return 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=700&q=80';
}

/* =========================================================
   14. APPLICATION BOOTSTRAPPER
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  AuthModule.init();
  NavigationModule.init();
  SearchModule.init();
  ItemsModule.init();
  MatchesModule.init();
  ReportsModule.init();
  NotificationsModule.init();
  ProfileModule.init();
});
