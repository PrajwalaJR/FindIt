const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'findit.sqlite');
const db = new DatabaseSync(dbPath);

// Enable WAL mode for better concurrency
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    student_id TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    campus TEXT DEFAULT 'Central Campus',
    avatar TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('lost', 'found')),
    item_name TEXT NOT NULL,
    category TEXT NOT NULL,
    brand TEXT,
    color TEXT,
    location TEXT NOT NULL,
    date TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'matched', 'claimed', 'resolved')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lost_item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    found_item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    confidence TEXT NOT NULL,
    image_sim INTEGER DEFAULT 90,
    category_sim INTEGER DEFAULT 100,
    color_sim INTEGER DEFAULT 95,
    brand_sim INTEGER DEFAULT 80,
    location_sim INTEGER DEFAULT 85,
    date_sim INTEGER DEFAULT 90,
    reason TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'claimed', 'resolved')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(lost_item_id, found_item_id)
  );

  CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    claimant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(match_id, claimant_id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL,
    match_id INTEGER,
    item_id INTEGER,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Password Utilities
function hashPassword(password, existingSalt = null) {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const check = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return check === hash;
}

// Seed initial demo data if database is fresh
function seedDatabase() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount > 0) return;

  console.log('Seeding initial FindIt demo data...');

  // 1. Seed Users
  const mayaPass = hashPassword('password123');
  const alexPass = hashPassword('password123');
  const sarahPass = hashPassword('password123');

  const insertUser = db.prepare(`
    INSERT INTO users (first_name, last_name, email, student_id, password_hash, salt, campus, avatar)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run('Maya', 'Joseph', 'maya@campus.edu', 'STU-88214', mayaPass.hash, mayaPass.salt, 'Central Campus', 'MJ');
  insertUser.run('Alex', 'Chen', 'alex@campus.edu', 'STU-77402', alexPass.hash, alexPass.salt, 'North Campus', 'AC');
  insertUser.run('Sarah', 'Jenkins', 'sarah@campus.edu', 'STU-65190', sarahPass.hash, sarahPass.salt, 'Central Campus', 'SJ');

  // 2. Seed Items
  const insertItem = db.prepare(`
    INSERT INTO items (user_id, type, item_name, category, brand, color, location, date, description, image_url, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Maya's Lost Backpack (ID 1)
  insertItem.run(
    1, 'lost', 'Black Herschel Backpack', 'Bags', 'Herschel', 'Black',
    'Library / 2nd Floor', '2026-09-07',
    'Black Herschel backpack with a small campus sticker on front pocket and spiral notebook inside.',
    'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=700&q=80',
    'matched'
  );

  // Alex's Found Daypack (ID 2)
  insertItem.run(
    2, 'found', 'Black Canvas Daypack', 'Bags', 'Unknown', 'Black',
    'Student Center', '2026-09-08',
    'Black canvas daypack found near the student center seating area. Clean condition.',
    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=700&q=80',
    'active'
  );

  // Sarah's Found MacBook (ID 3)
  insertItem.run(
    3, 'found', 'Silver MacBook Pro', 'Electronics', 'Apple', 'Silver',
    'Library', '2026-09-08',
    'Silver laptop found at the library help desk.',
    'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=700&q=80',
    'active'
  );

  // Maya's Lost Hoodie (ID 4)
  insertItem.run(
    1, 'lost', 'Blue Campus Hoodie', 'Clothing', 'Campus', 'Blue',
    'Gym', '2026-09-06',
    'Blue pullover hoodie with campus athletics logo.',
    'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=700&q=80',
    'active'
  );

  // Alex's Found Wallet (ID 5)
  insertItem.run(
    2, 'found', 'Brown Leather Wallet', 'Wallets', 'Unknown', 'Brown',
    'Cafeteria', '2026-09-05',
    'Brown bi-fold leather wallet found near the cafeteria cashier.',
    'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=700&q=80',
    'resolved'
  );

  // Maya's Lost AirPods Case (ID 6)
  insertItem.run(
    1, 'lost', 'AirPods Pro Case', 'Electronics', 'Apple', 'White',
    'Library', '2026-09-04',
    'White AirPods Pro case with a small scratch on the lid.',
    'https://images.unsplash.com/photo-1606220945770-b5b6c2c55bf1?auto=format&fit=crop&w=700&q=80',
    'active'
  );

  // Found Watch/Ring (ID 7)
  insertItem.run(
    3, 'found', 'Minimalist Watch', 'Other', 'Unknown', 'White',
    'Library', '2026-09-09',
    'Minimalist watch with white strap and round dial found in study carrel.',
    'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=700&q=80',
    'active'
  );

  // Lost Hydro Flask (ID 8)
  insertItem.run(
    2, 'lost', 'Hydro Flask Water Bottle', 'Other', 'Hydro Flask', 'Yellow',
    'Gym', '2026-09-08',
    'Bright yellow Hydro Flask bottle with climbing stickers.',
    'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=700&q=80',
    'active'
  );

  // 3. Seed Matches
  const insertMatch = db.prepare(`
    INSERT INTO matches (lost_item_id, found_item_id, score, confidence, image_sim, category_sim, color_sim, brand_sim, location_sim, date_sim, reason, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertMatch.run(
    1, 2, 94, 'High confidence',
    97, 100, 100, 85, 82, 91,
    'Strong image, category, color and time/location similarity.',
    'pending'
  );

  // 4. Seed Notifications for Maya (User 1)
  const insertNotification = db.prepare(`
    INSERT INTO notifications (user_id, title, message, type, match_id, item_id, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
  `);

  insertNotification.run(
    1, 'New AI match found',
    'Your Black Herschel Backpack has a 94% potential match.',
    'match', 1, 1, 0, '-10 minutes'
  );

  insertNotification.run(
    1, 'Found item reported',
    'A black backpack was found at the Student Center.',
    'item', null, 2, 0, '-1 hour'
  );

  insertNotification.run(
    1, 'Report reminder',
    'Add more details to improve your AI match accuracy.',
    'reminder', null, 1, 1, '-1 day'
  );

  console.log('Database seeded successfully.');
}

seedDatabase();

module.exports = {
  db,
  hashPassword,
  verifyPassword
};
