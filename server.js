const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const { db, hashPassword, verifyPassword } = require('./db');
const { runMatchingForItem } = require('./aiMatcher');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `item_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, and WEBP images are allowed'));
    }
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend and uploads
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(__dirname));

// Session helper
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  db.prepare(`
    INSERT INTO sessions (token, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(token, userId, expiresAt);
  return token;
}

// Auth Middleware
function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization || req.headers['x-session-token'];
  let token = null;

  if (authHeader) {
    token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  const session = db.prepare(`
    SELECT s.token, s.expires_at, u.* 
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
  `).get(token);

  if (!session) {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }

  req.user = {
    id: session.id,
    first_name: session.first_name,
    last_name: session.last_name,
    email: session.email,
    student_id: session.student_id,
    campus: session.campus,
    avatar: session.avatar
  };
  req.token = token;
  next();
}

// Optional Auth (for public search queries where logged-in context adds extra stats)
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || req.headers['x-session-token'];
  let token = null;
  if (authHeader) {
    token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  }
  if (token) {
    const session = db.prepare(`
      SELECT s.token, u.* 
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
    `).get(token);
    if (session) {
      req.user = {
        id: session.id,
        first_name: session.first_name,
        last_name: session.last_name,
        email: session.email,
        student_id: session.student_id,
        campus: session.campus,
        avatar: session.avatar
      };
    }
  }
  next();
}

/* =========================================================
   AUTHENTICATION ROUTES
   ========================================================= */

// POST /api/auth/signup
app.post('/api/auth/signup', (req, res) => {
  try {
    const { first_name, last_name, email, student_id, password } = req.body;

    if (!first_name || !last_name || !email || !student_id || !password) {
      return res.status(400).json({ error: 'Please fill in all required fields.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanId = student_id.trim();

    if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    // Check duplicate email
    const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existingEmail) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Check duplicate student ID
    const existingId = db.prepare('SELECT id FROM users WHERE student_id = ?').get(cleanId);
    if (existingId) {
      return res.status(409).json({ error: 'An account with this Student ID already exists.' });
    }

    const { hash, salt } = hashPassword(password);
    const avatar = (first_name[0] + last_name[0]).toUpperCase();

    const insert = db.prepare(`
      INSERT INTO users (first_name, last_name, email, student_id, password_hash, salt, campus, avatar)
      VALUES (?, ?, ?, ?, ?, ?, 'Central Campus', ?)
    `);

    const result = insert.run(first_name.trim(), last_name.trim(), cleanEmail, cleanId, hash, salt, avatar);
    const userId = result.lastInsertRowid;
    const token = createSession(userId);

    // Welcome notification
    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (?, 'Welcome to FindIt', 'Your campus lost & found account is active. Report lost items or help return found ones!', 'welcome')
    `).run(userId);

    const user = {
      id: userId,
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      email: cleanEmail,
      student_id: cleanId,
      campus: 'Central Campus',
      avatar
    };

    return res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      token,
      user
    });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please enter your email and password.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    if (!user) {
      return res.status(401).json({ error: 'Account does not exist. Please create an account first.' });
    }

    const isValid = verifyPassword(password, user.password_hash, user.salt);
    if (!isValid) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    const token = createSession(user.id);

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        student_id: user.student_id,
        campus: user.campus,
        avatar: user.avatar
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error during login.' });
  }
});

// POST /api/auth/campus-login (Simulated Campus SSO)
app.post('/api/auth/campus-login', (req, res) => {
  try {
    const { campus_id, campus_email, first_name, last_name } = req.body;

    const identifier = (campus_email || campus_id || '').toLowerCase().trim();
    if (!identifier) {
      return res.status(400).json({ error: 'Invalid campus credentials. Please check your details.' });
    }

    const isEmail = identifier.includes('@') && identifier.includes('.');
    const isStudentId = /^stu-\d+/i.test(identifier) || /^[a-z0-9_-]{3,20}$/i.test(identifier);
    if (!isEmail && !isStudentId) {
      return res.status(400).json({ error: 'Invalid campus credentials. Please check your details.' });
    }

    // Try finding existing user by email or student ID
    let user = db.prepare(`
      SELECT * FROM users WHERE lower(email) = ? OR lower(student_id) = ?
    `).get(identifier, identifier);

    if (!user) {
      return res.status(404).json({ error: 'Campus account not found. Please check your email or Student ID.' });
    }

    const token = createSession(user.id);

    return res.json({
      success: true,
      message: 'Authenticated via Campus Single Sign-On.',
      token,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        student_id: user.student_id,
        campus: user.campus,
        avatar: user.avatar
      }
    });
  } catch (err) {
    console.error('Campus login error:', err);
    return res.status(500).json({ error: 'Campus authentication failed.' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', authenticateUser, (req, res) => {
  try {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
    return res.json({ success: true, message: 'Signed out successfully.' });
  } catch (err) {
    return res.status(500).json({ error: 'Error during logout.' });
  }
});

/* =========================================================
   USER PROFILE ROUTES
   ========================================================= */

// GET /api/users/me
app.get('/api/users/me', authenticateUser, (req, res) => {
  return res.json({ user: req.user });
});

// PUT /api/users/me
app.put('/api/users/me', authenticateUser, (req, res) => {
  try {
    const { first_name, last_name, campus, new_password } = req.body;

    let avatar = req.user.avatar;
    if (first_name && last_name) {
      avatar = (first_name[0] + last_name[0]).toUpperCase();
    }

    db.prepare(`
      UPDATE users 
      SET first_name = COALESCE(?, first_name),
          last_name = COALESCE(?, last_name),
          campus = COALESCE(?, campus),
          avatar = COALESCE(?, avatar),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(first_name || null, last_name || null, campus || null, avatar, req.user.id);

    if (new_password && new_password.length >= 6) {
      const { hash, salt } = hashPassword(new_password);
      db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?')
        .run(hash, salt, req.user.id);
    }

    const updated = db.prepare('SELECT id, first_name, last_name, email, student_id, campus, avatar FROM users WHERE id = ?')
      .get(req.user.id);

    return res.json({ success: true, user: updated });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
});

/* =========================================================
   DASHBOARD STATS ROUTE
   ========================================================= */

// GET /api/stats
app.get('/api/stats', optionalAuth, (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;

    const lostCount = db.prepare(`SELECT COUNT(*) as c FROM items WHERE type = 'lost'`).get().c;
    const foundCount = db.prepare(`SELECT COUNT(*) as c FROM items WHERE type = 'found'`).get().c;

    let userActiveReports = 0;
    let potentialMatches = 0;

    if (userId) {
      userActiveReports = db.prepare(`
        SELECT COUNT(*) as c FROM items WHERE user_id = ? AND status IN ('active', 'matched')
      `).get(userId).c;

      potentialMatches = db.prepare(`
        SELECT COUNT(DISTINCT m.id) as c 
        FROM matches m
        JOIN items l ON m.lost_item_id = l.id
        JOIN items f ON m.found_item_id = f.id
        WHERE (l.user_id = ? OR f.user_id = ?) AND m.status = 'pending'
      `).get(userId, userId).c;
    }

    // Category breakdown counts
    const categories = ['Electronics', 'Bags', 'Keys', 'Wallets', 'Clothing', 'Other'];
    const categoryCounts = {};
    for (const cat of categories) {
      const count = db.prepare('SELECT COUNT(*) as c FROM items WHERE category = ?').get(cat).c;
      categoryCounts[cat] = count;
    }

    // Featured match for current user (or general top match)
    let featuredMatch = null;
    if (userId) {
      featuredMatch = db.prepare(`
        SELECT m.*, 
               l.item_name as lost_name, l.category as lost_cat, l.brand as lost_brand, 
               l.color as lost_color, l.location as lost_loc, l.date as lost_date, 
               l.description as lost_desc, l.image_url as lost_img,
               f.item_name as found_name, f.category as found_cat, f.brand as found_brand, 
               f.color as found_color, f.location as found_loc, f.date as found_date, 
               f.description as found_desc, f.image_url as found_img
        FROM matches m
        JOIN items l ON m.lost_item_id = l.id
        JOIN items f ON m.found_item_id = f.id
        WHERE (l.user_id = ? OR f.user_id = ?)
        ORDER BY m.score DESC, m.created_at DESC
        LIMIT 1
      `).get(userId, userId);
    }

    // If no user match found, get default top match for display
    if (!featuredMatch) {
      featuredMatch = db.prepare(`
        SELECT m.*, 
               l.item_name as lost_name, l.category as lost_cat, l.brand as lost_brand, 
               l.color as lost_color, l.location as lost_loc, l.date as lost_date, 
               l.description as lost_desc, l.image_url as lost_img,
               f.item_name as found_name, f.category as found_cat, f.brand as found_brand, 
               f.color as found_color, f.location as found_loc, f.date as found_date, 
               f.description as found_desc, f.image_url as found_img
        FROM matches m
        JOIN items l ON m.lost_item_id = l.id
        JOIN items f ON m.found_item_id = f.id
        ORDER BY m.score DESC
        LIMIT 1
      `).get();
    }

    // Recent items
    const recentItems = db.prepare(`
      SELECT id, type, item_name, location, date, image_url, category 
      FROM items 
      ORDER BY created_at DESC 
      LIMIT 4
    `).all();

    return res.json({
      userActiveReports,
      lostItems: lostCount,
      foundItems: foundCount,
      potentialMatches,
      categoryCounts,
      featuredMatch,
      recentItems
    });
  } catch (err) {
    console.error('Stats error:', err);
    return res.status(500).json({ error: 'Failed to retrieve statistics.' });
  }
});

/* =========================================================
   ITEMS / REPORTS ROUTES
   ========================================================= */

// GET /api/items (Search & filter)
app.get('/api/items', (req, res) => {
  try {
    const { q, type, category, location, sort } = req.query;

    let query = `
      SELECT i.*, u.first_name, u.last_name, u.avatar
      FROM items i
      JOIN users u ON i.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (type && type !== 'all') {
      query += ' AND i.type = ?';
      params.push(type);
    }

    if (category && category !== 'all' && category !== 'All categories') {
      query += ' AND i.category = ?';
      params.push(category);
    }

    if (location && location !== 'Any location' && location !== 'All locations') {
      query += ' AND i.location LIKE ?';
      params.push(`%${location}%`);
    }

    if (q && q.trim()) {
      query += ` AND (
        i.item_name LIKE ? OR 
        i.category LIKE ? OR 
        i.brand LIKE ? OR 
        i.color LIKE ? OR 
        i.location LIKE ? OR 
        i.description LIKE ?
      )`;
      const searchTerm = `%${q.trim()}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Sorting
    if (sort === 'oldest') {
      query += ' ORDER BY i.created_at ASC';
    } else {
      query += ' ORDER BY i.created_at DESC';
    }

    const items = db.prepare(query).all(...params);
    return res.json({ items, count: items.length });
  } catch (err) {
    console.error('Items search error:', err);
    return res.status(500).json({ error: 'Failed to search items.' });
  }
});

// GET /api/items/lost
app.get('/api/items/lost', (req, res) => {
  try {
    const { category, location } = req.query;
    let query = `SELECT * FROM items WHERE type = 'lost'`;
    const params = [];

    if (category && category !== 'All categories') {
      query += ' AND category = ?';
      params.push(category);
    }
    if (location && location !== 'All locations') {
      query += ' AND location LIKE ?';
      params.push(`%${location}%`);
    }
    query += ' ORDER BY created_at DESC';

    const items = db.prepare(query).all(...params);
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve lost items.' });
  }
});

// GET /api/items/found
app.get('/api/items/found', (req, res) => {
  try {
    const { category, location } = req.query;
    let query = `SELECT * FROM items WHERE type = 'found'`;
    const params = [];

    if (category && category !== 'All categories') {
      query += ' AND category = ?';
      params.push(category);
    }
    if (location && location !== 'All locations') {
      query += ' AND location LIKE ?';
      params.push(`%${location}%`);
    }
    query += ' ORDER BY created_at DESC';

    const items = db.prepare(query).all(...params);
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve found items.' });
  }
});

// GET /api/items/my (Only logged-in user's reports)
app.get('/api/items/my', authenticateUser, (req, res) => {
  try {
    const reports = db.prepare(`
      SELECT i.*, 
             (SELECT COUNT(*) FROM matches m WHERE (m.lost_item_id = i.id OR m.found_item_id = i.id)) as match_count,
             (SELECT id FROM matches m WHERE (m.lost_item_id = i.id OR m.found_item_id = i.id) ORDER BY score DESC LIMIT 1) as top_match_id
      FROM items i 
      WHERE i.user_id = ? 
      ORDER BY i.created_at DESC
    `).all(req.user.id);

    const stats = {
      total: reports.length,
      lost: reports.filter(r => r.type === 'lost').length,
      found: reports.filter(r => r.type === 'found').length,
      matches: reports.reduce((acc, r) => acc + (r.match_count > 0 ? 1 : 0), 0),
      resolved: reports.filter(r => r.status === 'resolved').length
    };

    return res.json({ reports, stats });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve your reports.' });
  }
});

// GET /api/items/:id
app.get('/api/items/:id', (req, res) => {
  try {
    const item = db.prepare(`
      SELECT i.*, u.first_name, u.last_name, u.avatar, u.campus
      FROM items i
      JOIN users u ON i.user_id = u.id
      WHERE i.id = ?
    `).get(req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'Item not found.' });
    }

    return res.json({ item });
  } catch (err) {
    return res.status(500).json({ error: 'Error retrieving item.' });
  }
});

// POST /api/items (Create new report)
app.post('/api/items', authenticateUser, upload.single('image'), (req, res) => {
  try {
    const { type, item_name, category, brand, color, location, date, description } = req.body;

    if (!item_name || !category || !location || !date) {
      return res.status(400).json({ error: 'Item name, category, location, and date are required.' });
    }

    const reportType = type === 'found' ? 'found' : 'lost';
    let imageUrl = null;

    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    } else if (req.body.image_url) {
      imageUrl = req.body.image_url;
    } else {
      // High-quality category placeholder
      const categoryFallbacks = {
        Bags: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=700&q=80',
        Electronics: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=700&q=80',
        Clothing: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=700&q=80',
        Wallets: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=700&q=80',
        Keys: 'https://images.unsplash.com/photo-1582139329536-e7284fece509?auto=format&fit=crop&w=700&q=80',
        Other: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=700&q=80'
      };
      imageUrl = categoryFallbacks[category] || categoryFallbacks.Other;
    }

    const insert = db.prepare(`
      INSERT INTO items (
        user_id, type, item_name, category, brand, color, 
        location, date, description, image_url, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `);

    const result = insert.run(
      req.user.id,
      reportType,
      item_name.trim(),
      category.trim(),
      (brand || '').trim(),
      (color || '').trim(),
      location.trim(),
      date.trim(),
      (description || '').trim(),
      imageUrl
    );

    const newItemId = result.lastInsertRowid;
    const newItem = db.prepare('SELECT * FROM items WHERE id = ?').get(newItemId);

    // Run AI Matching Engine
    const matchesFound = runMatchingForItem(newItem, db);

    // Add confirmation notification
    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type, item_id)
      VALUES (?, 'Report submitted successfully', ?, 'report', ?)
    `).run(
      req.user.id,
      `Your ${reportType} report for "${item_name}" has been registered. FindIt is actively searching for potential matches.`,
      newItemId
    );

    return res.status(201).json({
      success: true,
      message: 'Report submitted successfully.',
      item: newItem,
      matchesGenerated: matchesFound.length
    });
  } catch (err) {
    console.error('Create item error:', err);
    return res.status(500).json({ error: 'Failed to create report.' });
  }
});

// DELETE /api/items/:id
app.delete('/api/items/:id', authenticateUser, (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Item not found.' });
    }
    if (item.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You do not have permission to delete this report.' });
    }

    db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
    return res.json({ success: true, message: 'Report deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete report.' });
  }
});

/* =========================================================
   AI MATCHES ROUTES
   ========================================================= */

// GET /api/matches (User's relevant matches)
app.get('/api/matches', authenticateUser, (req, res) => {
  try {
    const matches = db.prepare(`
      SELECT m.*,
             l.item_name as lost_name, l.category as lost_cat, l.brand as lost_brand, 
             l.color as lost_color, l.location as lost_loc, l.date as lost_date, 
             l.description as lost_desc, l.image_url as lost_img, l.user_id as lost_user_id,
             f.item_name as found_name, f.category as found_cat, f.brand as found_brand, 
             f.color as found_color, f.location as found_loc, f.date as found_date, 
             f.description as found_desc, f.image_url as found_img, f.user_id as found_user_id
      FROM matches m
      JOIN items l ON m.lost_item_id = l.id
      JOIN items f ON m.found_item_id = f.id
      WHERE l.user_id = ? OR f.user_id = ?
      ORDER BY m.score DESC, m.created_at DESC
    `).all(req.user.id, req.user.id);

    return res.json({ matches, count: matches.length });
  } catch (err) {
    console.error('Get matches error:', err);
    return res.status(500).json({ error: 'Failed to retrieve AI matches.' });
  }
});

// GET /api/matches/:id (Detailed match comparison)
app.get('/api/matches/:id', authenticateUser, (req, res) => {
  try {
    const match = db.prepare(`
      SELECT m.*,
             l.id as lost_id, l.item_name as lost_name, l.category as lost_cat, l.brand as lost_brand, 
             l.color as lost_color, l.location as lost_loc, l.date as lost_date, 
             l.description as lost_desc, l.image_url as lost_img, l.user_id as lost_user_id,
             f.id as found_id, f.item_name as found_name, f.category as found_cat, f.brand as found_brand, 
             f.color as found_color, f.location as found_loc, f.date as found_date, 
             f.description as found_desc, f.image_url as found_img, f.user_id as found_user_id
      FROM matches m
      JOIN items l ON m.lost_item_id = l.id
      JOIN items f ON m.found_item_id = f.id
      WHERE m.id = ?
    `).get(req.params.id);

    if (!match) {
      return res.status(404).json({ error: 'Match record not found.' });
    }

    // Check if current user already claimed this match
    const existingClaim = db.prepare(`
      SELECT * FROM claims WHERE match_id = ? AND claimant_id = ?
    `).get(match.id, req.user.id);

    return res.json({
      match,
      alreadyClaimed: Boolean(existingClaim),
      claimDetails: existingClaim || null
    });
  } catch (err) {
    console.error('Get match details error:', err);
    return res.status(500).json({ error: 'Failed to retrieve match details.' });
  }
});

// POST /api/matches/:id/claim (Claim match)
app.post('/api/matches/:id/claim', authenticateUser, (req, res) => {
  try {
    const matchId = req.params.id;
    const { message } = req.body;

    const match = db.prepare(`
      SELECT m.*, l.user_id as lost_user_id, f.user_id as found_user_id, 
             l.item_name as lost_name, f.item_name as found_name
      FROM matches m
      JOIN items l ON m.lost_item_id = l.id
      JOIN items f ON m.found_item_id = f.id
      WHERE m.id = ?
    `).get(matchId);

    if (!match) {
      return res.status(404).json({ error: 'Match not found.' });
    }

    // Check duplicate claim
    const existingClaim = db.prepare(`
      SELECT id FROM claims WHERE match_id = ? AND claimant_id = ?
    `).get(matchId, req.user.id);

    if (existingClaim) {
      return res.status(409).json({ error: 'You have already submitted a claim for this match.' });
    }

    // Determine the counterparty (owner or finder)
    const counterpartyId = req.user.id === match.lost_user_id ? match.found_user_id : match.lost_user_id;

    // Create claim record
    db.prepare(`
      INSERT INTO claims (match_id, claimant_id, owner_id, message, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(matchId, req.user.id, counterpartyId, message || 'Campus match claim submitted.');

    // Update match status
    db.prepare(`UPDATE matches SET status = 'claimed' WHERE id = ?`).run(matchId);

    // Notify the other party
    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type, match_id)
      VALUES (?, 'Match Claim Received', ?, 'claim', ?)
    `).run(
      counterpartyId,
      `${req.user.first_name} ${req.user.last_name} has claimed the match for "${match.found_name}". Check your reports to coordinate return.`,
      matchId
    );

    // Notify claimant
    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type, match_id)
      VALUES (?, 'Claim Submitted', ?, 'claim', ?)
    `).run(
      req.user.id,
      `Your claim request for "${match.lost_name}" has been forwarded to the reporter. You will be notified once coordinated.`,
      matchId
    );

    return res.json({
      success: true,
      message: 'Your match claim request has been submitted successfully.'
    });
  } catch (err) {
    console.error('Claim error:', err);
    return res.status(500).json({ error: 'Failed to submit claim request.' });
  }
});

/* =========================================================
   NOTIFICATIONS ROUTES
   ========================================================= */

// GET /api/notifications
app.get('/api/notifications', authenticateUser, (req, res) => {
  try {
    const notifications = db.prepare(`
      SELECT * FROM notifications 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 30
    `).all(req.user.id);

    const unreadCount = notifications.filter(n => n.is_read === 0).length;

    return res.json({ notifications, unreadCount });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve notifications.' });
  }
});

// PATCH /api/notifications/:id/read
app.patch('/api/notifications/:id/read', authenticateUser, (req, res) => {
  try {
    db.prepare(`
      UPDATE notifications SET is_read = 1 
      WHERE id = ? AND user_id = ?
    `).run(req.params.id, req.user.id);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update notification.' });
  }
});

// PATCH /api/notifications/read-all
app.patch('/api/notifications/read-all', authenticateUser, (req, res) => {
  try {
    db.prepare(`
      UPDATE notifications SET is_read = 1 
      WHERE user_id = ?
    `).run(req.user.id);

    return res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to mark all as read.' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `File upload error: ${err.message}` });
  }
  return res.status(500).json({ error: err.message || 'Internal server error.' });
});

// Start listening
app.listen(PORT, () => {
  console.log(`FindIt AI Lost & Found server running at http://localhost:${PORT}`);
});
