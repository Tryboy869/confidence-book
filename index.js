import { Octokit } from '@octokit/rest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// ─── Config ───────────────────────────────────────────────────────────────────
const [REPO_OWNER, REPO_NAME] = (process.env.GITHUB_REPO || '').split('/');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const JWT_SECRET = process.env.JWT_SECRET || 'cb-secret-2024';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const LIMITS = {
  FREE_POSTS_PER_WEEK: 3,
  FREE_COMMENTS_PER_WEEK: 3,
  FREE_MAX_EDITS: 3,
  FREE_EXPIRY_DAYS: 14,
  PREMIUM_POSTS_PER_WEEK: 10,
  PREMIUM_EXPIRY_DAYS: 90,
  CONTENT_MIN: 10,
  CONTENT_MAX: 5000,
  SECRET_PHRASE_MIN: 6,
};

const GROQ_MODELS = [
  'llama-3.1-8b-instant',
  'gemma2-9b-it',
  'llama-3.3-70b-versatile',
  'llama3-8b-8192',
];

const WEEKLY_PROMPTS = [
  { fr: "Qu'est-ce qui t'a surpris cette semaine ?", en: "What surprised you this week?" },
  { fr: "Y a-t-il quelque chose que tu portes seul·e depuis trop longtemps ?", en: "Is there something you've been carrying alone too long?" },
  { fr: "Quel moment a demandé le plus de courage ?", en: "What moment required the most courage?" },
  { fr: "Si tu pouvais changer une chose, ce serait quoi ?", en: "If you could change one thing, what would it be?" },
  { fr: "Qu'est-ce qui te pèse en ce moment ?", en: "What's weighing on you right now?" },
  { fr: "Comment tu vas, vraiment ?", en: "How are you, really?" },
  { fr: "Qu'est-ce que tu aurais voulu entendre ?", en: "What would you have wanted to hear?" },
  { fr: "Y a-t-il une douleur ancienne qui refait surface ?", en: "Is there an old pain resurfacing?" },
  { fr: "Qu'est-ce qui t'empêche de te sentir en paix ?", en: "What's preventing you from feeling at peace?" },
  { fr: "Si tu écrivais à toi-même dans 1 an, que dirais-tu ?", en: "If you wrote to yourself in 1 year, what would you say?" },
  { fr: "Qu'as-tu appris sur toi récemment ?", en: "What have you learned about yourself recently?" },
  { fr: "Quelle est ta fierté de cette semaine ?", en: "What are you most proud of this week?" },
];

// ─── In-memory cache ──────────────────────────────────────────────────────────
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { cache.delete(key); return null; }
  return entry.value;
}

function cacheSet(key, value, ttlMs = 120000) {
  cache.set(key, { value, expires: Date.now() + ttlMs });
}

function cacheInvalidate(pattern) {
  for (const key of cache.keys()) {
    if (key.includes(pattern)) cache.delete(key);
  }
}

// ─── GitHub helpers ───────────────────────────────────────────────────────────
async function ghRead(path) {
  const cacheKey = `gh:${path}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await octokit.repos.getContent({ owner: REPO_OWNER, repo: REPO_NAME, path });
    const content = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
    const result = { data: content, sha: data.sha };
    cacheSet(cacheKey, result, 60000);
    return result;
  } catch (e) {
    if (e.status === 404) return { data: null, sha: null };
    throw e;
  }
}

async function ghWrite(path, content, sha, message) {
  const encoded = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
  try {
    await octokit.repos.createOrUpdateFileContents({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path,
      message: message || `db: update ${path}`,
      content: encoded,
      ...(sha ? { sha } : {}),
    });
    // Invalidate cache for this path
    cacheInvalidate(path);
  } catch (e) {
    // Retry once with fresh SHA if conflict
    if (e.status === 409) {
      const fresh = await octokit.repos.getContent({ owner: REPO_OWNER, repo: REPO_NAME, path });
      await octokit.repos.createOrUpdateFileContents({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path,
        message: message || `db: update ${path}`,
        content: encoded,
        sha: fresh.data.sha,
      });
      cacheInvalidate(path);
    } else throw e;
  }
}

// Default structures
const defaultUser = (id, phraseHash) => ({
  id,
  secret_phrase_hash: phraseHash,
  created_at: Date.now(),
  last_active: Date.now(),
  premium: false,
  premium_type: null,
  premium_end: null,
  settings: { theme: 'dark', avatar: 'moon', language: 'en' },
});

const defaultUserData = () => ({
  confidences: [],
  notifications: [],
  subscriptions: [],
});

// ─── User file paths ──────────────────────────────────────────────────────────
const paths = {
  usersIndex: 'db/users-index.json',
  userProfile: (id) => `db/users/${id}/profile.json`,
  userData: (id) => `db/users/${id}/data.json`,
  publicFeed: 'db/public/feed.json',
  publicReactions: 'db/public/reactions.json',
  publicResponses: 'db/public/responses.json',
};

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function generateId() {
  return `CB_${crypto.randomBytes(4).toString('hex')}`;
}

async function hashPhrase(phrase) {
  return bcrypt.hash(phrase, 10);
}

async function verifyPhrase(phrase, hash) {
  return bcrypt.compare(phrase, hash);
}

function verifyAdmin(key) {
  if (!key || !ADMIN_KEY) return false;
  if (key.length !== ADMIN_KEY.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(ADMIN_KEY)); }
  catch { return false; }
}

// ─── Moderation ───────────────────────────────────────────────────────────────
async function moderateContent(content) {
  const prompt = `Moderation system for anonymous emotional support platform.
ACCEPT: sadness, anger, fear, loneliness, suicidal thoughts (cry for help), trauma, grief.
WARNING+APPROVE: explicit suicide method, self-harm intent.
REJECT: violence toward others, hate speech, spam, explicit sexual (EXCEPT trauma disclosure), personal info.
Content: """${content.substring(0, 800)}"""
Respond ONLY with JSON (no markdown):
{"approved":true/false,"warning":false,"reason":"short reason","offending_passage":null,"suggestion":null}`;

  for (const model of GROQ_MODELS) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 200 }),
      });
      if (!res.ok) continue;
      const d = await res.json();
      const text = d.choices[0].message.content.replace(/```json|```/g, '').trim();
      return JSON.parse(text);
    } catch { continue; }
  }
  return { approved: true, warning: false, reason: 'fail-open', offending_passage: null, suggestion: null };
}

// ─── Weekly check helpers ─────────────────────────────────────────────────────
function countThisWeek(items, userId) {
  const weekAgo = Date.now() - 7 * 86400000;
  return items.filter(i => i.user_id === userId && i.created_at > weekAgo).length;
}

function getNextWeekReset() {
  return new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

function getWeeklyPrompt() {
  const week = Math.floor(Date.now() / (7 * 86400000));
  return WEEKLY_PROMPTS[week % WEEKLY_PROMPTS.length];
}

// ─── Expiry cleanup ───────────────────────────────────────────────────────────
async function cleanExpired() {
  try {
    const feed = await ghRead(paths.publicFeed);
    if (!feed.data) return;
    const now = Date.now();
    const active = (feed.data.confidences || []).filter(c => c.expires_at > now);
    if (active.length < (feed.data.confidences || []).length) {
      await ghWrite(paths.publicFeed, { ...feed.data, confidences: active }, feed.sha, 'db: cleanup expired');
    }
  } catch {}
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-user-id,x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.url.replace(/\?.*$/, '');
  const method = req.method;
  const body = req.body || {};
  const headers = req.headers;
  const query = req.query || {};
  const userId = headers['x-user-id'];

  const json = (data, code = 200) => res.status(code).json(data);
  const err = (msg, code = 400) => res.status(code).json({ success: false, message: msg });

  // Run cleanup ~5% of requests
  if (Math.random() < 0.05) cleanExpired().catch(() => {});

  try {

    // ── Health ──────────────────────────────────────────────────────────────
    if (url === '/api/health' && method === 'GET') {
      return json({ success: true, status: 'healthy', ts: Date.now() });
    }

    // ── Weekly prompt ───────────────────────────────────────────────────────
    if (url === '/api/prompt' && method === 'GET') {
      return json({ success: true, prompt: getWeeklyPrompt() });
    }

    // ── SYNC endpoint (IndexedDB delta sync) ────────────────────────────────
    // Called on user return: fetch only what changed since last_sync
    if (url === '/api/sync' && method === 'GET') {
      const since = parseInt(query.since) || 0;
      const [feedData, reactionsData, responsesData] = await Promise.all([
        ghRead(paths.publicFeed),
        ghRead(paths.publicReactions),
        ghRead(paths.publicResponses),
      ]);
      const now = Date.now();
      const feed = (feedData.data?.confidences || []).filter(c => c.expires_at > now && c.created_at > since);
      const reactions = (reactionsData.data?.reactions || []).filter(r => r.created_at > since);
      const responses = (responsesData.data?.responses || []).filter(r => r.created_at > since);

      // User-specific notifications
      let notifications = [];
      if (userId) {
        try {
          const ud = await ghRead(paths.userData(userId));
          notifications = (ud.data?.notifications || []).filter(n => n.created_at > since);
        } catch {}
      }

      return json({ success: true, since, feed, reactions, responses, notifications, serverTime: now });
    }

    // ── FULL LOAD (first login) ─────────────────────────────────────────────
    if (url === '/api/load' && method === 'GET') {
      const [feedData, reactionsData, responsesData] = await Promise.all([
        ghRead(paths.publicFeed),
        ghRead(paths.publicReactions),
        ghRead(paths.publicResponses),
      ]);
      const now = Date.now();
      const feed = (feedData.data?.confidences || []).filter(c => c.expires_at > now);
      const reactions = reactionsData.data?.reactions || [];
      const responses = responsesData.data?.responses || [];

      let userNotifications = [];
      let userProfile = null;
      if (userId) {
        try {
          const [prof, ud] = await Promise.all([
            ghRead(paths.userProfile(userId)),
            ghRead(paths.userData(userId)),
          ]);
          userProfile = prof.data;
          userNotifications = ud.data?.notifications || [];
        } catch {}
      }

      return json({ success: true, feed, reactions, responses, notifications: userNotifications, profile: userProfile, serverTime: now });
    }

    // ── AUTH ────────────────────────────────────────────────────────────────
    if (url === '/api/auth/create' && method === 'POST') {
      const phrase = (body.secretPhrase || '').trim();
      if (phrase.length < LIMITS.SECRET_PHRASE_MIN) return err(`Secret phrase must be at least ${LIMITS.SECRET_PHRASE_MIN} characters`);

      const newId = generateId();
      const hash = await hashPhrase(phrase);
      const profile = defaultUser(newId, hash);
      const data = defaultUserData();

      // Add to index
      const idx = await ghRead(paths.usersIndex);
      const index = idx.data || { users: [] };
      index.users.push({ id: newId, created_at: Date.now() });
      await Promise.all([
        ghWrite(paths.usersIndex, index, idx.sha, `db: new user ${newId}`),
        ghWrite(paths.userProfile(newId), profile, null, `db: create profile ${newId}`),
        ghWrite(paths.userData(newId), data, null, `db: create data ${newId}`),
      ]);

      return json({ success: true, userId: newId });
    }

    if (url === '/api/auth/verify' && method === 'POST') {
      const input = (body.input || '').trim();
      if (!input) return err('Missing input');

      // Direct ID login
      if (input.startsWith('CB_')) {
        const prof = await ghRead(paths.userProfile(input));
        if (prof.data) {
          // Update last active
          prof.data.last_active = Date.now();
          ghWrite(paths.userProfile(input), prof.data, prof.sha, `db: last_active ${input}`).catch(() => {});
          return json({ success: true, userId: input });
        }
        return err('Invalid ID or secret phrase');
      }

      // Phrase login — scan all users
      if (input.length < LIMITS.SECRET_PHRASE_MIN) return err('Invalid ID or secret phrase');
      const idx = await ghRead(paths.usersIndex);
      const users = idx.data?.users || [];
      for (const u of users) {
        const prof = await ghRead(paths.userProfile(u.id));
        if (!prof.data) continue;
        const match = await verifyPhrase(input, prof.data.secret_phrase_hash);
        if (match) {
          prof.data.last_active = Date.now();
          ghWrite(paths.userProfile(u.id), prof.data, prof.sha, `db: last_active ${u.id}`).catch(() => {});
          return json({ success: true, userId: u.id });
        }
      }
      return err('Invalid ID or secret phrase');
    }

    // ── PROFILE ─────────────────────────────────────────────────────────────
    if (url === '/api/profile' && method === 'GET') {
      if (!userId) return err('Unauthorized', 401);
      const [prof, ud, feedData, reactionsData, responsesData] = await Promise.all([
        ghRead(paths.userProfile(userId)),
        ghRead(paths.userData(userId)),
        ghRead(paths.publicFeed),
        ghRead(paths.publicReactions),
        ghRead(paths.publicResponses),
      ]);
      if (!prof.data) return err('User not found', 404);

      const allConf = (feedData.data?.confidences || []).filter(c => c.user_id === userId);
      const allReactions = reactionsData.data?.reactions || [];
      const allResponses = responsesData.data?.responses || [];
      const now = Date.now();

      const weekAgo = now - 7 * 86400000;
      const postsThisWeek = allConf.filter(c => c.created_at > weekAgo).length;
      const commentsThisWeek = allResponses.filter(r => r.user_id === userId && r.created_at > weekAgo).length;
      const isPremium = prof.data.premium === true;

      const reactionsReceived = allReactions.filter(r => allConf.some(c => c.id === r.confidence_id)).length;
      const responsesReceived = allResponses.filter(r => allConf.some(c => c.id === r.confidence_id)).length;

      const postLimit = isPremium ? LIMITS.PREMIUM_POSTS_PER_WEEK : LIMITS.FREE_POSTS_PER_WEEK;

      return json({
        success: true,
        profile: {
          ...prof.data,
          stats: { confidencesCount: allConf.length, reactionsReceived, responsesReceived },
          limits: {
            postsThisWeek, postLimitPerWeek: postLimit,
            canPost: isPremium ? postsThisWeek < 10 : postsThisWeek < 3,
            commentsThisWeek,
            commentLimitPerWeek: isPremium ? 999 : LIMITS.FREE_COMMENTS_PER_WEEK,
            canComment: isPremium || commentsThisWeek < LIMITS.FREE_COMMENTS_PER_WEEK,
            commentsLeft: isPremium ? 999 : Math.max(0, LIMITS.FREE_COMMENTS_PER_WEEK - commentsThisWeek),
            nextPostReset: getNextWeekReset(),
          },
          confidences: allConf,
          subscriptions: ud.data?.subscriptions || [],
        },
      });
    }

    // ── SETTINGS ────────────────────────────────────────────────────────────
    if (url === '/api/settings' && method === 'PUT') {
      if (!userId) return err('Unauthorized', 401);
      const prof = await ghRead(paths.userProfile(userId));
      if (!prof.data) return err('User not found', 404);
      prof.data.settings = { ...prof.data.settings, ...body };
      await ghWrite(paths.userProfile(userId), prof.data, prof.sha, `db: settings ${userId}`);
      return json({ success: true });
    }

    // ── ACCOUNT DELETE ──────────────────────────────────────────────────────
    if (url === '/api/account' && method === 'DELETE') {
      if (!userId) return err('Unauthorized', 401);

      // Remove from index
      const idx = await ghRead(paths.usersIndex);
      if (idx.data) {
        idx.data.users = idx.data.users.filter(u => u.id !== userId);
        await ghWrite(paths.usersIndex, idx.data, idx.sha, `db: delete user ${userId}`);
      }

      // Remove user's confidences from feed
      const feed = await ghRead(paths.publicFeed);
      if (feed.data) {
        feed.data.confidences = feed.data.confidences.filter(c => c.user_id !== userId);
        await ghWrite(paths.publicFeed, feed.data, feed.sha, `db: purge user ${userId}`);
      }
      return json({ success: true });
    }

    // ── SUBSCRIPTIONS ────────────────────────────────────────────────────────
    if (url === '/api/subscriptions' && method === 'GET') {
      if (!userId) return err('Unauthorized', 401);
      const ud = await ghRead(paths.userData(userId));
      return json({ success: true, subscriptions: ud.data?.subscriptions || [] });
    }

    if (url === '/api/subscriptions/toggle' && method === 'POST') {
      if (!userId) return err('Unauthorized', 401);
      const { emotion } = body;
      if (!emotion) return err('Missing emotion');
      const ud = await ghRead(paths.userData(userId));
      const data = ud.data || defaultUserData();
      const subs = data.subscriptions || [];
      const idx = subs.indexOf(emotion);
      let action;
      if (idx > -1) { subs.splice(idx, 1); action = 'unsubscribed'; }
      else { subs.push(emotion); action = 'subscribed'; }
      data.subscriptions = subs;
      await ghWrite(paths.userData(userId), data, ud.sha, `db: subscription ${userId}`);
      return json({ success: true, action, emotion });
    }

    // ── NOTIFICATIONS ────────────────────────────────────────────────────────
    if (url === '/api/notifications' && method === 'GET') {
      if (!userId) return err('Unauthorized', 401);
      const ud = await ghRead(paths.userData(userId));
      const notifs = (ud.data?.notifications || []).slice(0, 30).reverse();
      const unreadCount = notifs.filter(n => !n.read).length;
      return json({ success: true, notifications: notifs, unreadCount });
    }

    if (url === '/api/notifications/read' && method === 'POST') {
      if (!userId) return err('Unauthorized', 401);
      const ud = await ghRead(paths.userData(userId));
      if (!ud.data) return json({ success: true });
      ud.data.notifications = (ud.data.notifications || []).map(n => ({ ...n, read: true }));
      await ghWrite(paths.userData(userId), ud.data, ud.sha, `db: notifs read ${userId}`);
      return json({ success: true });
    }

    // ── CONFIDENCES LIST ─────────────────────────────────────────────────────
    if (url === '/api/confidences' && method === 'GET') {
      const chapter = query.chapter;
      const page = parseInt(query.page) || 1;
      const pageSize = parseInt(query.pageSize) || 20;

      const feedData = await ghRead(paths.publicFeed);
      const now = Date.now();
      let confs = (feedData.data?.confidences || []).filter(c => c.expires_at > now);
      if (chapter && chapter !== 'all') confs = confs.filter(c => c.emotion === chapter);
      confs.sort((a, b) => b.created_at - a.created_at);

      // Attach user reaction if logged in
      let userReactions = {};
      if (userId) {
        const rd = await ghRead(paths.publicReactions);
        (rd.data?.reactions || []).filter(r => r.user_id === userId).forEach(r => { userReactions[r.confidence_id] = r.type; });
      }

      const total = confs.length;
      const paginated = confs.slice((page - 1) * pageSize, page * pageSize).map(c => ({
        ...c,
        user_reaction: userReactions[c.id] || null,
      }));

      return json({
        success: true,
        confidences: paginated,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize), hasMore: page * pageSize < total },
      });
    }

    // ── CONFIDENCE CREATE ────────────────────────────────────────────────────
    if (url === '/api/confidences' && method === 'POST') {
      if (!userId) return err('Unauthorized', 401);
      const content = (body.content || '').trim();
      if (content.length < LIMITS.CONTENT_MIN) return err(`Minimum ${LIMITS.CONTENT_MIN} characters`);
      if (content.length > LIMITS.CONTENT_MAX) return err(`Maximum ${LIMITS.CONTENT_MAX} characters`);

      const prof = await ghRead(paths.userProfile(userId));
      if (!prof.data) return err('User not found', 404);
      const isPremium = prof.data.premium === true;

      // Check weekly limit
      const feedData = await ghRead(paths.publicFeed);
      const allConf = feedData.data?.confidences || [];
      const weekAgo = Date.now() - 7 * 86400000;
      const postsThisWeek = allConf.filter(c => c.user_id === userId && c.created_at > weekAgo).length;
      const postLimit = isPremium ? LIMITS.PREMIUM_POSTS_PER_WEEK : LIMITS.FREE_POSTS_PER_WEEK;
      if (postsThisWeek >= postLimit) {
        return json({ success: false, limitType: 'weekly_post', message: `You've reached ${postLimit} posts this week. Next reset: ${getNextWeekReset()}.` });
      }

      // Moderation
      const mod = await moderateContent(content);
      if (!mod.approved) {
        return json({ success: false, limitType: 'moderation', message: 'Your content was not published.', reason: mod.reason, offending_passage: mod.offending_passage, suggestion: mod.suggestion });
      }

      const confId = `conf_${crypto.randomBytes(4).toString('hex')}`;
      const now = Date.now();
      const expiryDays = isPremium ? LIMITS.PREMIUM_EXPIRY_DAYS : LIMITS.FREE_EXPIRY_DAYS;
      const newConf = {
        id: confId,
        user_id: userId,
        content,
        emotion: body.emotion || 'espoir',
        edit_count: 0,
        reaction_count: 0,
        response_count: 0,
        created_at: now,
        expires_at: now + expiryDays * 86400000,
      };

      const feed = feedData.data || { confidences: [] };
      feed.confidences.push(newConf);
      await ghWrite(paths.publicFeed, feed, feedData.sha, `db: new confidence ${confId}`);

      // Notify subscribers
      const ud = await ghRead(paths.userData(userId));
      const subs = ud.data?.subscriptions || [];
      // (Notifications to other subscribers would require reading all user data — skip for perf, keep simple)

      cacheInvalidate('public/feed');
      return json({ success: true, confidenceId: confId, warning: mod.warning });
    }

    // ── CONFIDENCE GET by ID ─────────────────────────────────────────────────
    const confIdMatch = url.match(/^\/api\/confidences\/([^/]+)$/);
    if (confIdMatch) {
      const confId = confIdMatch[1];

      if (method === 'GET') {
        const [feedData, reactionsData, responsesData] = await Promise.all([
          ghRead(paths.publicFeed),
          ghRead(paths.publicReactions),
          ghRead(paths.publicResponses),
        ]);
        const conf = (feedData.data?.confidences || []).find(c => c.id === confId);
        if (!conf) return err('Not found', 404);
        const reactions = (reactionsData.data?.reactions || []).filter(r => r.confidence_id === confId);
        const responses = (responsesData.data?.responses || []).filter(r => r.confidence_id === confId).sort((a, b) => a.created_at - b.created_at);
        const userReaction = userId ? reactions.find(r => r.user_id === userId)?.type || null : null;
        return json({ success: true, confidence: { ...conf, user_reaction: userReaction }, responses, touchedCount: new Set(reactions.map(r => r.user_id)).size });
      }

      if (method === 'PUT') {
        if (!userId) return err('Unauthorized', 401);
        const content = (body.content || '').trim();
        if (content.length < LIMITS.CONTENT_MIN) return err(`Minimum ${LIMITS.CONTENT_MIN} characters`);

        const feedData = await ghRead(paths.publicFeed);
        const confIdx = (feedData.data?.confidences || []).findIndex(c => c.id === confId && c.user_id === userId);
        if (confIdx === -1) return err('Not authorized', 403);

        const conf = feedData.data.confidences[confIdx];
        const prof = await ghRead(paths.userProfile(userId));
        const isPremium = prof.data?.premium === true;

        if (!isPremium && conf.edit_count >= LIMITS.FREE_MAX_EDITS) {
          return json({ success: false, limitType: 'edit_limit', message: `Maximum ${LIMITS.FREE_MAX_EDITS} edits reached.` });
        }

        const mod = await moderateContent(content);
        if (!mod.approved) {
          return json({ success: false, limitType: 'moderation', message: 'Your edit was not saved.', reason: mod.reason, offending_passage: mod.offending_passage, suggestion: mod.suggestion });
        }

        feedData.data.confidences[confIdx] = { ...conf, content, emotion: body.emotion || conf.emotion, edit_count: conf.edit_count + 1 };
        await ghWrite(paths.publicFeed, feedData.data, feedData.sha, `db: edit ${confId}`);
        cacheInvalidate('public/feed');
        return json({ success: true, warning: mod.warning, editsRemaining: isPremium ? 999 : LIMITS.FREE_MAX_EDITS - (conf.edit_count + 1) });
      }

      if (method === 'DELETE') {
        if (!userId) return err('Unauthorized', 401);
        const feedData = await ghRead(paths.publicFeed);
        const conf = (feedData.data?.confidences || []).find(c => c.id === confId);
        if (!conf || conf.user_id !== userId) return err('Not authorized', 403);
        feedData.data.confidences = feedData.data.confidences.filter(c => c.id !== confId);
        await ghWrite(paths.publicFeed, feedData.data, feedData.sha, `db: delete ${confId}`);

        // Also remove related reactions and responses
        const [rd, rpd] = await Promise.all([ghRead(paths.publicReactions), ghRead(paths.publicResponses)]);
        if (rd.data) {
          rd.data.reactions = rd.data.reactions.filter(r => r.confidence_id !== confId);
          ghWrite(paths.publicReactions, rd.data, rd.sha, `db: cleanup reactions ${confId}`).catch(() => {});
        }
        if (rpd.data) {
          rpd.data.responses = rpd.data.responses.filter(r => r.confidence_id !== confId);
          ghWrite(paths.publicResponses, rpd.data, rpd.sha, `db: cleanup responses ${confId}`).catch(() => {});
        }
        cacheInvalidate('public/');
        return json({ success: true });
      }
    }

    // ── REACTIONS ────────────────────────────────────────────────────────────
    if (url === '/api/reactions' && method === 'POST') {
      if (!userId) return err('Unauthorized', 401);
      const { confidenceId, type } = body;
      if (!confidenceId || !type) return err('Missing fields');

      const rd = await ghRead(paths.publicReactions);
      const data = rd.data || { reactions: [] };
      const existing = data.reactions.findIndex(r => r.confidence_id === confidenceId && r.user_id === userId);
      let action;

      if (existing > -1) {
        if (data.reactions[existing].type === type) { data.reactions.splice(existing, 1); action = 'removed'; }
        else { data.reactions[existing].type = type; action = 'updated'; }
      } else {
        data.reactions.push({ id: `react_${crypto.randomBytes(3).toString('hex')}`, confidence_id: confidenceId, user_id: userId, type, created_at: Date.now() });
        action = 'added';
      }

      // Update reaction_count in feed
      const feedData = await ghRead(paths.publicFeed);
      const confIdx = (feedData.data?.confidences || []).findIndex(c => c.id === confidenceId);
      if (confIdx > -1) {
        feedData.data.confidences[confIdx].reaction_count = data.reactions.filter(r => r.confidence_id === confidenceId).length;
        ghWrite(paths.publicFeed, feedData.data, feedData.sha, `db: reaction count ${confidenceId}`).catch(() => {});
      }

      await ghWrite(paths.publicReactions, data, rd.sha, `db: reaction ${action} ${confidenceId}`);
      cacheInvalidate('public/reactions');
      return json({ success: true, action });
    }

    // ── RESPONSE REACTIONS ───────────────────────────────────────────────────
    if (url === '/api/response-reactions' && method === 'POST') {
      if (!userId) return err('Unauthorized', 401);
      const { responseId, type } = body;
      if (!responseId || !type) return err('Missing fields');

      const rpd = await ghRead(paths.publicResponses);
      const data = rpd.data || { responses: [] };
      const respIdx = data.responses.findIndex(r => r.id === responseId);
      if (respIdx === -1) return err('Response not found', 404);

      const rr = data.responses[respIdx].reactions || [];
      const existing = rr.findIndex(r => r.user_id === userId);
      let action;
      if (existing > -1) {
        if (rr[existing].type === type) { rr.splice(existing, 1); action = 'removed'; }
        else { rr[existing].type = type; action = 'updated'; }
      } else {
        rr.push({ user_id: userId, type, created_at: Date.now() });
        action = 'added';
      }
      data.responses[respIdx].reactions = rr;
      await ghWrite(paths.publicResponses, data, rpd.sha, `db: resp-reaction ${responseId}`);
      cacheInvalidate('public/responses');
      return json({ success: true, action });
    }

    // ── RESPONSES (comments) ─────────────────────────────────────────────────
    if (url === '/api/responses' && method === 'POST') {
      if (!userId) return err('Unauthorized', 401);
      const content = (body.content || '').trim();
      if (content.length < LIMITS.CONTENT_MIN) return err(`Minimum ${LIMITS.CONTENT_MIN} characters`);
      if (content.length > LIMITS.CONTENT_MAX) return err(`Maximum ${LIMITS.CONTENT_MAX} characters`);

      const prof = await ghRead(paths.userProfile(userId));
      if (!prof.data) return err('User not found', 404);
      const isPremium = prof.data.premium === true;

      // Comment limit
      if (!isPremium) {
        const rpd = await ghRead(paths.publicResponses);
        const weekAgo = Date.now() - 7 * 86400000;
        const commentsThisWeek = (rpd.data?.responses || []).filter(r => r.user_id === userId && r.created_at > weekAgo).length;
        if (commentsThisWeek >= LIMITS.FREE_COMMENTS_PER_WEEK) {
          return json({ success: false, limitType: 'weekly_comment', message: `You've reached your ${LIMITS.FREE_COMMENTS_PER_WEEK} comments limit. Resets ${getNextWeekReset()}.` });
        }
      }

      const mod = await moderateContent(content);
      if (!mod.approved) {
        return json({ success: false, limitType: 'moderation', message: 'Your reply was not sent.', reason: mod.reason, offending_passage: mod.offending_passage, suggestion: mod.suggestion });
      }

      const AVATARS = ['moon', 'sun', 'leaf', 'flower', 'butterfly', 'wave', 'sparkles', 'star'];
      const avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
      const respId = `resp_${crypto.randomBytes(4).toString('hex')}`;
      const now = Date.now();
      const newResp = { id: respId, confidence_id: body.confidenceId, user_id: userId, content, avatar, reactions: [], created_at: now };

      const rpd = await ghRead(paths.publicResponses);
      const data = rpd.data || { responses: [] };
      data.responses.push(newResp);
      await ghWrite(paths.publicResponses, data, rpd.sha, `db: new response ${respId}`);

      // Update response_count in feed
      const feedData = await ghRead(paths.publicFeed);
      const confIdx = (feedData.data?.confidences || []).findIndex(c => c.id === body.confidenceId);
      if (confIdx > -1) {
        feedData.data.confidences[confIdx].response_count = data.responses.filter(r => r.confidence_id === body.confidenceId).length;
        ghWrite(paths.publicFeed, feedData.data, feedData.sha, `db: response count ${body.confidenceId}`).catch(() => {});
      }

      // Notify confidence author
      try {
        const confAuthorId = (feedData.data?.confidences || []).find(c => c.id === body.confidenceId)?.user_id;
        if (confAuthorId && confAuthorId !== userId) {
          const authorUd = await ghRead(paths.userData(confAuthorId));
          if (authorUd.data) {
            authorUd.data.notifications = authorUd.data.notifications || [];
            authorUd.data.notifications.push({ id: `notif_${crypto.randomBytes(3).toString('hex')}`, type: 'new_response', message: 'Someone responded to your confidence with kindness', related_id: body.confidenceId, read: false, created_at: now });
            ghWrite(paths.userData(confAuthorId), authorUd.data, authorUd.sha, `db: notify ${confAuthorId}`).catch(() => {});
          }
        }
      } catch {}

      cacheInvalidate('public/responses');
      const commentsLeft = isPremium ? 999 : Math.max(0, LIMITS.FREE_COMMENTS_PER_WEEK - (await ghRead(paths.publicResponses).then(d => (d.data?.responses || []).filter(r => r.user_id === userId && r.created_at > Date.now() - 7 * 86400000).length).catch(() => 0)));
      return json({ success: true, responseId: respId, commentsLeft });
    }

    // ── RESPONSE DELETE ──────────────────────────────────────────────────────
    const respDeleteMatch = url.match(/^\/api\/responses\/([^/]+)$/);
    if (respDeleteMatch && method === 'DELETE') {
      if (!userId) return err('Unauthorized', 401);
      const respId = respDeleteMatch[1];
      const rpd = await ghRead(paths.publicResponses);
      const resp = (rpd.data?.responses || []).find(r => r.id === respId);
      if (!resp || resp.user_id !== userId) return err('Not authorized', 403);
      rpd.data.responses = rpd.data.responses.filter(r => r.id !== respId);
      await ghWrite(paths.publicResponses, rpd.data, rpd.sha, `db: delete response ${respId}`);
      cacheInvalidate('public/responses');
      return json({ success: true });
    }

    // ── ADMIN ────────────────────────────────────────────────────────────────
    if (url.startsWith('/api/admin')) {
      if (!verifyAdmin(headers['x-admin-key'])) return err('Unauthorized', 403);

      if (url === '/api/admin/stats' && method === 'GET') {
        const [idx, feedData, rpd, rrd] = await Promise.all([
          ghRead(paths.usersIndex),
          ghRead(paths.publicFeed),
          ghRead(paths.publicResponses),
          ghRead(paths.publicReactions),
        ]);
        const users = idx.data?.users || [];
        const confs = (feedData.data?.confidences || []).filter(c => c.expires_at > Date.now());
        const now = Date.now();
        const dayAgo = now - 86400000;
        const weekAgo = now - 7 * 86400000;
        return json({ success: true, stats: {
          users: { total: users.length, newToday: users.filter(u => u.created_at > dayAgo).length, newThisWeek: users.filter(u => u.created_at > weekAgo).length },
          confidences: { active: confs.length, newToday: confs.filter(c => c.created_at > dayAgo).length },
          responses: { total: (rpd.data?.responses || []).length },
          reactions: { total: (rrd.data?.reactions || []).length },
          topEmotions: Object.entries(confs.reduce((acc, c) => { acc[c.emotion] = (acc[c.emotion] || 0) + 1; return acc; }, {})).map(([emotion, count]) => ({ emotion, count })).sort((a, b) => b.count - a.count),
        }});
      }

      if (url === '/api/admin/users' && method === 'GET') {
        const idx = await ghRead(paths.usersIndex);
        const users = idx.data?.users || [];
        const profiles = await Promise.all(users.slice(0, 50).map(u => ghRead(paths.userProfile(u.id))));
        return json({ success: true, users: profiles.map(p => p.data).filter(Boolean).map(p => ({
          id: p.id, created_at: p.created_at, last_active: p.last_active,
          premium: p.premium, premium_type: p.premium_type, premium_end: p.premium_end,
        })) });
      }

      if (url === '/api/admin/users/search' && method === 'GET') {
        const searchId = query.id;
        if (!searchId) return err('Missing id');
        const prof = await ghRead(paths.userProfile(searchId));
        if (!prof.data) return err('User not found', 404);
        return json({ success: true, user: { id: prof.data.id, created_at: prof.data.created_at, last_active: prof.data.last_active, premium: prof.data.premium, premium_type: prof.data.premium_type, premium_end: prof.data.premium_end } });
      }

      if (url === '/api/admin/premium/activate' && method === 'POST') {
        const { userId: targetId, type } = body;
        if (!targetId) return err('Missing userId');
        const prof = await ghRead(paths.userProfile(targetId));
        if (!prof.data) return err('User not found', 404);
        const durationMs = type === 'yearly' ? 365 * 86400000 : 90 * 86400000;
        prof.data.premium = true;
        prof.data.premium_type = type || 'quarterly';
        prof.data.premium_end = Date.now() + durationMs;
        await ghWrite(paths.userProfile(targetId), prof.data, prof.sha, `db: premium activate ${targetId}`);

        // Notify user
        const ud = await ghRead(paths.userData(targetId));
        if (ud.data) {
          ud.data.notifications = ud.data.notifications || [];
          ud.data.notifications.push({ id: `notif_${crypto.randomBytes(3).toString('hex')}`, type: 'premium_activated', message: `🎉 Your Premium ${type || 'quarterly'} subscription is now active!`, read: false, created_at: Date.now() });
          ghWrite(paths.userData(targetId), ud.data, ud.sha, `db: notify premium ${targetId}`).catch(() => {});
        }
        return json({ success: true, message: `Premium activated for ${targetId}` });
      }

      if (url === '/api/admin/premium/deactivate' && method === 'POST') {
        const { userId: targetId } = body;
        if (!targetId) return err('Missing userId');
        const prof = await ghRead(paths.userProfile(targetId));
        if (!prof.data) return err('User not found', 404);
        prof.data.premium = false;
        prof.data.premium_type = null;
        prof.data.premium_end = null;
        await ghWrite(paths.userProfile(targetId), prof.data, prof.sha, `db: premium deactivate ${targetId}`);
        return json({ success: true });
      }
    }

    return res.status(404).json({ success: false, message: 'Route not found' });

  } catch (e) {
    console.error('Handler error:', e);
    return res.status(500).json({ success: false, message: e.message });
  }
}
