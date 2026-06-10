/**
 * db-sync.js — IndexedDB sync layer for Confidence Book
 * Include this in every HTML page: <script src="/db-sync.js"></script>
 * 
 * Provides global `CB` object with:
 *   CB.init()          — call on page load
 *   CB.getFeed()       — returns filtered + sorted confidences from IDB
 *   CB.getConf(id)     — returns single confidence with responses
 *   CB.getProfile()    — returns current user profile
 *   CB.getNotifs()     — returns notifications
 *   CB.sync()          — manual sync trigger
 *   CB.onUpdate(fn)    — register callback when data changes
 */

const CB = (() => {
  const DB_NAME = 'confidence-book';
  const DB_VERSION = 1;
  const SYNC_KEY = 'cb_last_sync';
  const USER_KEY = 'confidenceBookUserID';

  let db = null;
  let updateListeners = [];

  // ── IndexedDB setup ──────────────────────────────────────────────────────
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('confidences')) {
          const s = d.createObjectStore('confidences', { keyPath: 'id' });
          s.createIndex('emotion', 'emotion', { unique: false });
          s.createIndex('created_at', 'created_at', { unique: false });
          s.createIndex('expires_at', 'expires_at', { unique: false });
        }
        if (!d.objectStoreNames.contains('reactions')) {
          d.createObjectStore('reactions', { keyPath: 'id' });
        }
        if (!d.objectStoreNames.contains('responses')) {
          d.createObjectStore('responses', { keyPath: 'id' });
        }
        if (!d.objectStoreNames.contains('notifications')) {
          d.createObjectStore('notifications', { keyPath: 'id' });
        }
        if (!d.objectStoreNames.contains('meta')) {
          d.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!d.objectStoreNames.contains('profile')) {
          d.createObjectStore('profile', { keyPath: 'key' });
        }
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(stores, mode = 'readonly') {
    return db.transaction(stores, mode);
  }

  function storeGet(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = tx(storeName).objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function storeGetAll(storeName) {
    return new Promise((resolve, reject) => {
      const req = tx(storeName).objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function storePut(storeName, value) {
    return new Promise((resolve, reject) => {
      const t = tx(storeName, 'readwrite');
      const req = t.objectStore(storeName).put(value);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function storePutMany(storeName, items) {
    return new Promise((resolve, reject) => {
      const t = tx(storeName, 'readwrite');
      const store = t.objectStore(storeName);
      items.forEach(item => store.put(item));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  function storeDelete(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = tx(storeName, 'readwrite').objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Purge expired from IDB
  async function purgeExpired() {
    const all = await storeGetAll('confidences');
    const now = Date.now();
    const expired = all.filter(c => c.expires_at < now);
    if (expired.length > 0) {
      const t = tx('confidences', 'readwrite');
      const store = t.objectStore('confidences');
      expired.forEach(c => store.delete(c.id));
    }
  }

  // ── Sync logic ───────────────────────────────────────────────────────────
  async function fullLoad() {
    const userId = localStorage.getItem(USER_KEY);
    const url = userId ? `/api/load?t=${Date.now()}` : `/api/load?t=${Date.now()}`;
    const headers = userId ? { 'x-user-id': userId } : {};
    const res = await fetch(url, { headers });
    const data = await res.json();
    if (!data.success) throw new Error('Load failed');

    // Store everything
    if (data.feed?.length) await storePutMany('confidences', data.feed);
    if (data.reactions?.length) await storePutMany('reactions', data.reactions);
    if (data.responses?.length) await storePutMany('responses', data.responses);
    if (data.notifications?.length) await storePutMany('notifications', data.notifications);
    if (data.profile) await storePut('profile', { key: 'current', ...data.profile });

    await storePut('meta', { key: SYNC_KEY, value: data.serverTime });
    notifyListeners();
    return data;
  }

  async function deltaSync() {
    const meta = await storeGet('meta', SYNC_KEY);
    const since = meta?.value || 0;
    const userId = localStorage.getItem(USER_KEY);
    const headers = userId ? { 'x-user-id': userId } : {};

    const res = await fetch(`/api/sync?since=${since}&t=${Date.now()}`, { headers });
    const data = await res.json();
    if (!data.success) throw new Error('Sync failed');

    let changed = false;
    if (data.feed?.length) { await storePutMany('confidences', data.feed); changed = true; }
    if (data.reactions?.length) { await storePutMany('reactions', data.reactions); changed = true; }
    if (data.responses?.length) { await storePutMany('responses', data.responses); changed = true; }
    if (data.notifications?.length) { await storePutMany('notifications', data.notifications); changed = true; }

    await storePut('meta', { key: SYNC_KEY, value: data.serverTime });
    await purgeExpired();
    if (changed) notifyListeners();
    return data;
  }

  function notifyListeners() {
    updateListeners.forEach(fn => { try { fn(); } catch {} });
  }

  // ── Public API ───────────────────────────────────────────────────────────
  async function init() {
    await openDB();
    const meta = await storeGet('meta', SYNC_KEY);
    const hasCachedData = !!meta;

    if (!hasCachedData) {
      // First time — full load
      await fullLoad();
    } else {
      // Has cached data — show immediately, sync in background
      notifyListeners(); // Render from IDB right away
      setTimeout(async () => {
        try { await deltaSync(); }
        catch (e) { console.warn('Background sync failed:', e); }
      }, 300);
    }
  }

  async function sync() {
    const meta = await storeGet('meta', SYNC_KEY);
    if (!meta) return fullLoad();
    return deltaSync();
  }

  async function getFeed(emotion = 'all', page = 1, pageSize = 20) {
    let all = await storeGetAll('confidences');
    const now = Date.now();
    all = all.filter(c => c.expires_at > now);
    if (emotion && emotion !== 'all') all = all.filter(c => c.emotion === emotion);
    all.sort((a, b) => b.created_at - a.created_at);

    const total = all.length;
    const paginated = all.slice((page - 1) * pageSize, page * pageSize);

    // Attach reactions + response counts
    const allReactions = await storeGetAll('reactions');
    const allResponses = await storeGetAll('responses');
    const userId = localStorage.getItem(USER_KEY);

    const result = paginated.map(c => ({
      ...c,
      reaction_count: allReactions.filter(r => r.confidence_id === c.id).length,
      response_count: allResponses.filter(r => r.confidence_id === c.id).length,
      user_reaction: userId ? allReactions.find(r => r.confidence_id === c.id && r.user_id === userId)?.type || null : null,
    }));

    return { confidences: result, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize), hasMore: page * pageSize < total } };
  }

  async function getConf(id) {
    const conf = await storeGet('confidences', id);
    if (!conf) return null;
    const allReactions = await storeGetAll('reactions');
    const allResponses = await storeGetAll('responses');
    const userId = localStorage.getItem(USER_KEY);
    const reactions = allReactions.filter(r => r.confidence_id === id);
    const responses = allResponses.filter(r => r.confidence_id === id).sort((a, b) => a.created_at - b.created_at);
    return {
      confidence: { ...conf, user_reaction: userId ? reactions.find(r => r.user_id === userId)?.type || null : null },
      responses,
      touchedCount: new Set(reactions.map(r => r.user_id)).size,
    };
  }

  async function getProfile() {
    const p = await storeGet('profile', 'current');
    return p || null;
  }

  async function getNotifs() {
    const all = await storeGetAll('notifications');
    return all.sort((a, b) => b.created_at - a.created_at).slice(0, 30);
  }

  async function markNotifRead(id) {
    const n = await storeGet('notifications', id);
    if (n) await storePut('notifications', { ...n, read: true });
  }

  async function putConf(conf) {
    await storePut('confidences', conf);
    notifyListeners();
  }

  async function deleteConf(id) {
    await storeDelete('confidences', id);
    notifyListeners();
  }

  async function putReaction(reaction) {
    await storePut('reactions', reaction);
    notifyListeners();
  }

  async function putResponse(response) {
    await storePut('responses', response);
    notifyListeners();
  }

  async function deleteResponse(id) {
    await storeDelete('responses', id);
    notifyListeners();
  }

  async function updateProfile(profile) {
    await storePut('profile', { key: 'current', ...profile });
  }

  async function clearAll() {
    const stores = ['confidences', 'reactions', 'responses', 'notifications', 'meta', 'profile'];
    for (const s of stores) {
      const t = tx(s, 'readwrite');
      t.objectStore(s).clear();
    }
  }

  function onUpdate(fn) {
    updateListeners.push(fn);
    return () => { updateListeners = updateListeners.filter(f => f !== fn); };
  }

  return {
    init, sync, getFeed, getConf, getProfile, getNotifs,
    markNotifRead, putConf, deleteConf, putReaction, putResponse,
    deleteResponse, updateProfile, clearAll, onUpdate,
  };
})();
