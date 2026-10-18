# FindIt – AI Lost & Found 🔍🎓

> A modern, full-stack campus Lost & Found platform with multi-factor AI similarity matching, real-time reports, and secure item claims.

---

## ✨ Features

- **Authentication & Security**:
  - Secure registration & login with salted PBKDF2-SHA512 password hashing.
  - Institutional Campus Single Sign-On (CAS) simulation.
  - Role & session management with Bearer tokens.
- **Smart Campus Dashboard**:
  - Live statistics: Active Reports, Campus Lost Items, Campus Found Items, Potential Matches.
  - Featured AI Match Assistant with circular match score ring.
  - Category shortcuts and recent campus activity feed.
- **AI Matching Engine**:
  - Multi-factor algorithmic similarity analysis across 6 weighted dimensions:
    - Image Similarity (40%)
    - Category Match (20%)
    - Color Alignment (15%)
    - Brand Match (10%)
    - Campus Location Proximity (10%)
    - Date Proximity (5%)
  - Side-by-side visual comparison and breakdown bars.
  - One-click Claim Match workflow with duplicate claim prevention.
- **Lost & Found Reporting**:
  - Photo upload with live client-side preview.
  - Private "My Reports" tracking isolated per student.
- **Search & Filtering**:
  - Instant search across item names, categories, brands, colors, locations, and descriptions.
  - Multi-criteria filtering by item type (Lost/Found), Category, and Campus Location.
- **Notifications & Profile**:
  - Real-time in-app notification center with unread badges.
  - Interactive student profile modal and settings management.

---
#### FindIt – Lost and Found Platform

**Live Frontend:** https://prajwalajr.github.io/FindIt/

**Backend API:** https://findit-backend-p7nm.onrender.com/

### Deployment
The frontend is hosted on GitHub Pages, and the backend API is hosted on Render.


## 🛠️ Tech Stack

- **Frontend**: HTML5, CSS3, Modular JavaScript (Vanilla ES6+)
- **Backend**: Node.js, Express.js, Multer (file uploads)
- **Database**: SQLite (Node.js native `node:sqlite`)

---

## 🚀 Getting Started

### 1. Clone & Install
```bash
git clone <YOUR_REPO_URL>
cd <REPO_FOLDER>
npm install
```

### 2. Run the Server
```bash
npm start
```
The application will be live at `http://localhost:3000`.

### 3. Demo Credentials
- **Maya Joseph**: `maya@campus.edu` / `password123`
- **Alex Chen**: `alex@campus.edu` / `password123`
- **Sarah Jenkins**: `sarah@campus.edu` / `password123`
- Or create a new account via the Sign Up form or Campus SSO button!

---

## 📄 License
MIT
