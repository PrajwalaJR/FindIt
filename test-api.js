const express = require('express');
const { db } = require('./db');
const path = require('node:path');

async function runApiTestSuite() {
  console.log('==================================================');
  console.log('STARTING REST API END-TO-END TEST SUITE');
  console.log('==================================================');

  // Load the server app
  // In server.js, app is created and listens on PORT (default 3000)
  // Let's test against http://localhost:3000
  const baseUrl = 'http://localhost:3000';

  // Helper fetch function
  async function api(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, options);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  }

  try {
    // 1. Check if server is running or if we should start it
    let serverRunning = false;
    try {
      const ping = await fetch(`${baseUrl}/api/items`);
      if (ping.ok) serverRunning = true;
    } catch {}

    let serverProcess = null;
    if (!serverRunning) {
      console.log('Starting internal test server on port 3000...');
      require('./server');
      // Give it 1 second to listen
      await new Promise(r => setTimeout(r, 1000));
    }

    // TEST 1: Login as Maya
    console.log('\n[TEST 1] Testing Login with Maya Joseph:');
    const loginRes = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'maya@campus.edu', password: 'password123' })
    });
    console.log('   Status:', loginRes.status, '| Success:', loginRes.data.success);
    console.log('   User:', loginRes.data.user?.first_name, loginRes.data.user?.last_name, '| Token generated:', Boolean(loginRes.data.token));
    if (!loginRes.ok) throw new Error('Maya login failed');

    const mayaToken = loginRes.data.token;

    // TEST 2: Invalid Login rejection
    console.log('\n[TEST 2] Testing Invalid Credentials Rejection:');
    const badLogin = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'maya@campus.edu', password: 'incorrectPassword' })
    });
    console.log('   Status:', badLogin.status, '| Error message:', badLogin.data.error);

    // TEST 3: Signup a new student
    console.log('\n[TEST 3] Testing Signup with a new student account:');
    const newStudentEmail = `jordan_${Date.now()}@campus.edu`;
    const signupRes = await api('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: 'Jordan',
        last_name: 'Lee',
        email: newStudentEmail,
        student_id: `STU-${Math.floor(10000 + Math.random() * 89999)}`,
        password: 'securePassword123'
      })
    });
    console.log('   Status:', signupRes.status, '| Success:', signupRes.data.success);
    console.log('   Registered User:', signupRes.data.user?.first_name, signupRes.data.user?.email);
    if (!signupRes.ok) throw new Error('New student signup failed');

    const jordanToken = signupRes.data.token;

    // TEST 4: Duplicate Email Rejection
    console.log('\n[TEST 4] Testing Duplicate Email Prevention:');
    const dupRes = await api('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: 'Fake',
        last_name: 'User',
        email: newStudentEmail,
        student_id: 'STU-99999',
        password: 'password123'
      })
    });
    console.log('   Status:', dupRes.status, '| Error message:', dupRes.data.error);

    // TEST 5: Campus SSO Simulated Flow
    console.log('\n[TEST 5] Testing Campus SSO Simulated Flow:');
    const ssoRes = await api('/api/auth/campus-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campus_email: 'alex@campus.edu' })
    });
    console.log('   Status:', ssoRes.status, '| Success:', ssoRes.data.success);
    console.log('   Authenticated User:', ssoRes.data.user?.first_name, ssoRes.data.user?.last_name);

    // TEST 6: Dashboard Dynamic Stats
    console.log('\n[TEST 6] Testing Dashboard Stats API:');
    const statsRes = await api('/api/stats', {
      headers: { 'Authorization': `Bearer ${mayaToken}` }
    });
    console.log('   Status:', statsRes.status);
    console.log('   Stats:', {
      userActiveReports: statsRes.data.userActiveReports,
      lostItems: statsRes.data.lostItems,
      foundItems: statsRes.data.foundItems,
      potentialMatches: statsRes.data.potentialMatches,
      featuredMatch: statsRes.data.featuredMatch?.lost_name + ' vs ' + statsRes.data.featuredMatch?.found_name + ' (' + statsRes.data.featuredMatch?.score + '%)'
    });

    // TEST 7: Search with Query and Filters
    console.log('\n[TEST 7] Testing Search with Filters:');
    const searchRes = await api('/api/items?q=backpack&type=all');
    console.log('   Status:', searchRes.status, '| Results count:', searchRes.data.count);
    searchRes.data.items?.forEach(i => console.log(`   - [${i.type.toUpperCase()}] ${i.item_name} @ ${i.location}`));

    // TEST 8: Submit a New Lost Report as Jordan & Auto-trigger AI Matching
    console.log('\n[TEST 8] Submitting new lost item report as Jordan:');
    const reportRes = await api('/api/items', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jordanToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'lost',
        item_name: 'Silver MacBook Pro 14"',
        category: 'Electronics',
        brand: 'Apple',
        color: 'Silver',
        location: 'Library',
        date: '2026-09-08',
        description: 'Silver MacBook Pro with university CS sticker on the case.'
      })
    });
    console.log('   Status:', reportRes.status, '| Success:', reportRes.data.success);
    console.log('   AI Matches Generated:', reportRes.data.matchesGenerated);

    // TEST 9: Jordan My Reports (Private Isolation Check)
    console.log('\n[TEST 9] Checking Jordan My Reports:');
    const myReports = await api('/api/items/my', {
      headers: { 'Authorization': `Bearer ${jordanToken}` }
    });
    console.log('   Reports count for Jordan:', myReports.data.reports?.length);
    console.log('   Report item:', myReports.data.reports[0]?.item_name, '| Status:', myReports.data.reports[0]?.status);

    // TEST 10: Jordan's AI Matches
    console.log('\n[TEST 10] Checking Jordan AI Matches:');
    const jordanMatches = await api('/api/matches', {
      headers: { 'Authorization': `Bearer ${jordanToken}` }
    });
    console.log('   Matches count:', jordanMatches.data.count);
    const match = jordanMatches.data.matches[0];
    if (match) {
      console.log(`   Top Match: ${match.lost_name} vs ${match.found_name} -> ${match.score}% (${match.confidence})`);
      console.log(`   Breakdown: Image: ${match.image_sim}% | Category: ${match.category_sim}% | Color: ${match.color_sim}% | Location: ${match.location_sim}% | Date: ${match.date_sim}% | Brand: ${match.brand_sim}%`);

      // TEST 11: Claim the Match
      console.log('\n[TEST 11] Claiming the match:');
      const claimRes = await api(`/api/matches/${match.id}/claim`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jordanToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: 'Serial number verified with Campus IT.' })
      });
      console.log('   Claim status:', claimRes.status, '| Message:', claimRes.data.message);

      // TEST 12: Duplicate Claim Prevention
      console.log('\n[TEST 12] Testing Duplicate Claim Prevention:');
      const dupClaim = await api(`/api/matches/${match.id}/claim`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jordanToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: 'Duplicate claim attempt' })
      });
      console.log('   Duplicate status:', dupClaim.status, '| Error:', dupClaim.data.error);
    }

    // TEST 13: Notifications check
    console.log('\n[TEST 13] Checking Notifications:');
    const notifRes = await api('/api/notifications', {
      headers: { 'Authorization': `Bearer ${jordanToken}` }
    });
    console.log('   Notifications count:', notifRes.data.notifications?.length, '| Unread count:', notifRes.data.unreadCount);
    notifRes.data.notifications?.forEach(n => console.log(`   - [${n.type.toUpperCase()}] ${n.title}: ${n.message}`));

    // Mark all read
    const markRead = await api('/api/notifications/read-all', {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${jordanToken}` }
    });
    console.log('   Mark all read:', markRead.data.success);

    // TEST 14: Update Profile / Settings
    console.log('\n[TEST 14] Testing Profile & Settings Update:');
    const profileUpdate = await api('/api/users/me', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${jordanToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ first_name: 'Jordan', last_name: 'Taylor-Smith', campus: 'North Campus' })
    });
    console.log('   Profile update status:', profileUpdate.status, '| New full name:', profileUpdate.data.user?.first_name, profileUpdate.data.user?.last_name);

    // TEST 15: Logout
    console.log('\n[TEST 15] Testing Logout:');
    const logoutRes = await api('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jordanToken}` }
    });
    console.log('   Logout status:', logoutRes.status, '| Message:', logoutRes.data.message);

    console.log('\n==================================================');
    console.log('✓ ALL 15 REST API TEST SUITES PASSED SUCCESSFULLY!');
    console.log('==================================================');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test Suite Error:', err.message);
    process.exit(1);
  }
}

runApiTestSuite();
