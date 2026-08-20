/**
 * MVL27URL - Cloudflare Workers URL Shortener
 * Custom Domain: url.mvl27.bond
 * Optimized for Edge Performance & Enhanced Security
 * Links Storage: Permanent (No Expiration)
 */

const CUSTOM_DOMAIN = 'url.mvl27.bond';
const RATE_LIMIT_REQUESTS = 50;
const RATE_LIMIT_WINDOW = 3600; // 1 hour
const MAX_URL_LENGTH = 2048; // Prevent abuse
const MAX_SLUG_LENGTH = 20;
const MAX_EXPIRATION_DAYS = 365;
const RESERVED_SLUGS = new Set(['api', 'links', 'shorten', 'favicon.ico']);
const SETTINGS_KEY = 'system:settings';
const SESSION_PREFIX = 'session:';
const SESSION_TTL = 86400;
const PASSWORD_MIN_LENGTH = 10;
const DEFAULT_SETTINGS = {
  initialized: false,
  siteName: 'MVL27URL',
  logoUrl: '',
  domain: CUSTOM_DOMAIN,
  apiEnabled: false,
  apiKey: '',
  apiKeyHash: null,
  createPasswordHash: null,
  adminUsername: '',
  adminPasswordHash: null
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https:; font-src 'self';"
};

// Helper: Generate random slug if not provided
function generateSlug() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const random = new Uint8Array(8);
  crypto.getRandomValues(random);
  let slug = '';
  for (let i = 0; i < 8; i++) {
    slug += chars[random[i] % chars.length];
  }
  return slug;
}

// Helper: Validate URL format
function isValidUrl(url) {
  try {
    if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) return false;
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

// Helper: Validate slug format
function isValidSlug(slug) {
  return typeof slug === 'string' && slug.length <= MAX_SLUG_LENGTH && /^[-a-zA-Z0-9_]+$/.test(slug) && !RESERVED_SLUGS.has(slug.toLowerCase());
}

function jsonResponse(data, status = 200, headers = {}) {
  return addSecurityHeaders(new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  }));
}

async function consumeRateLimit(namespace, request, storage) {
  const clientIP = getClientIP(request);
  const key = `ratelimit:${namespace}:${clientIP}`;
  const now = Math.floor(Date.now() / 1000);
  let info = { count: 0, resetTime: now + RATE_LIMIT_WINDOW };

  try {
    const stored = await storage.get(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Number.isInteger(parsed.count) && Number.isInteger(parsed.resetTime)) info = parsed;
    }
  } catch (error) {
    console.error('Error reading rate limit:', error);
  }

  if (now >= info.resetTime) info = { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
  if (info.count >= RATE_LIMIT_REQUESTS) {
    return { allowed: false, retryAfter: Math.max(1, info.resetTime - now) };
  }

  info.count += 1;
  await storage.put(key, JSON.stringify(info), { expirationTtl: RATE_LIMIT_WINDOW + 10 });
  return { allowed: true, retryAfter: info.resetTime - now };
}

async function listAllKeys(storage) {
  const keys = [];
  let cursor;
  do {
    const page = await storage.list(cursor ? { cursor } : undefined);
    keys.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return keys;
}

function getAdminKey(env) {
  return typeof env.API_KEY === 'string' && env.API_KEY.length >= 16 ? env.API_KEY : null;
}

function getConfiguredApiKey(settings, env) {
  return settings.apiEnabled ? (settings.apiKey || getAdminKey(env)) : null;
}

function randomBytes(size) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function hashPassword(password, salt = randomBytes(16)) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `${bytesToBase64(salt)}:${bytesToBase64(new Uint8Array(bits))}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string' || !storedHash.includes(':')) return false;
  const [salt] = storedHash.split(':');
  try {
    return (await hashPassword(password, base64ToBytes(salt))) === storedHash;
  } catch {
    return false;
  }
}

async function hashApiKey(apiKey) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
  return bytesToBase64(new Uint8Array(digest));
}

async function verifyConfiguredApiKey(request, settings, env) {
  if (!settings.apiEnabled) return false;
  const headerKey = request.headers.get('x-api-key');
  if (!headerKey) return false;
  if (settings.apiKeyHash) return (await hashApiKey(headerKey)) === settings.apiKeyHash;
  const legacyKey = getConfiguredApiKey(settings, env);
  return Boolean(legacyKey && headerKey === legacyKey);
}

async function loadSettings(storage, env) {
  try {
    const stored = await storage.get(SETTINGS_KEY);
    if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  const legacyApiKey = getAdminKey(env);
  return { ...DEFAULT_SETTINGS, apiEnabled: Boolean(legacyApiKey), apiKey: legacyApiKey || '' };
}

async function saveSettings(storage, settings) {
  await storage.put(SETTINGS_KEY, JSON.stringify(settings));
}

function getSessionToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)mvl27_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function createSession(storage, username) {
  const token = bytesToBase64(randomBytes(32)).replace(/[/+=]/g, character => ({ '/': '_', '+': '-', '=': '' }[character]));
  await storage.put(`${SESSION_PREFIX}${token}`, JSON.stringify({ username, createdAt: new Date().toISOString() }), { expirationTtl: SESSION_TTL });
  return token;
}

async function isAdminSession(request, storage) {
  const token = getSessionToken(request);
  if (!token || !/^[A-Za-z0-9_-]{20,}$/.test(token)) return false;
  try {
    return Boolean(await storage.get(`${SESSION_PREFIX}${token}`));
  } catch {
    return false;
  }
}

async function isAdmin(request, storage) {
  return isAdminSession(request, storage);
}

async function canCreateLink(request, settings, env, storage) {
  if (!settings.initialized) return false;
  if (await isAdminSession(request, storage)) return true;
  if (await verifyConfiguredApiKey(request, settings, env)) return true;
  if (settings.createPasswordHash) {
    const password = request.headers.get('x-create-password');
    return Boolean(password && await verifyPassword(password, settings.createPasswordHash));
  }
  return false;
}

function isValidDomain(domain) {
  if (typeof domain !== 'string' || domain.length > 253) return false;
  try {
    const parsed = new URL(`https://${domain}`);
    return parsed.hostname === domain && !domain.includes('/') && !domain.includes('@');
  } catch {
    return false;
  }
}

function publicSettings(settings) {
  return {
    initialized: Boolean(settings.initialized),
    siteName: settings.siteName,
    logoUrl: settings.logoUrl,
    domain: settings.domain,
    apiEnabled: Boolean(settings.apiEnabled),
    createPasswordEnabled: Boolean(settings.createPasswordHash)
  };
}

// Helper: Add security headers to response
function addSecurityHeaders(response) {
  const newHeaders = new Headers(response.headers);
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    newHeaders.set(key, value);
  });
  newHeaders.set('Access-Control-Allow-Origin', `https://${CUSTOM_DOMAIN}`);
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key, x-create-password');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

// Helper: Escape HTML entities to prevent XSS
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Helper: Get client IP for rate limiting
function getClientIP(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
}

// Helper: Check API Key
function verifyApiKey(request, apiKey) {
  const headerKey = request.headers.get('x-api-key');
  return headerKey === apiKey;
}

// Generate HTML Dashboard (Simplified)
function generateDashboard(settings = DEFAULT_SETTINGS) {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(settings.siteName)}</title>
    <style>
        * {margin:0;padding:0;box-sizing:border-box}
        body {font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
        .container {background:white;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:600px;width:100%;padding:40px}
        .header {text-align:center;margin-bottom:40px}
        .logo {margin-bottom:15px;display:flex;justify-content:center}
        .logo img {max-width:120px;height:auto}
        .title {font-size:32px;font-weight:700;color:#333;margin-bottom:8px}
        .subtitle {font-size:14px;color:#666}
        .form-group {margin-bottom:20px}
        label {display:block;margin-bottom:8px;font-weight:600;color:#333;font-size:14px}
        input {width:100%;padding:12px;border:2px solid #e0e0e0;border-radius:6px;font-size:14px;transition:all 0.3s ease}
        input:focus {outline:none;border-color:#667eea;box-shadow:0 0 0 3px rgba(102,126,234,0.1)}
        button {padding:12px 20px;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;transition:all 0.3s ease;width:100%}
        button:hover {transform:translateY(-2px);box-shadow:0 10px 20px rgba(102,126,234,0.3)}
        .result-container {background:#f5f9ff;border:2px solid #667eea;border-radius:6px;padding:20px;margin-bottom:20px;display:none}
        .result-container.show {display:block;animation:slideIn 0.3s ease}
        @keyframes slideIn {from {opacity:0;transform:translateY(-10px)} to {opacity:1;transform:translateY(0)}}
        .result-label {font-size:12px;color:#666;margin-bottom:5px;font-weight:600}
        .result-text {font-size:14px;color:#333;word-break:break-all;font-family:monospace;background:white;padding:10px;border-radius:4px;margin-bottom:10px}
        .copy-btn {background:#667eea;color:white;padding:8px 12px;border:none;border-radius:4px;font-size:12px;cursor:pointer;font-weight:600;transition:all 0.3s ease;width:auto;float:right}
        .copy-btn:hover {background:#764ba2}
        .copy-btn.copied {background:#4caf50}
        .msg {padding:12px;border-radius:6px;margin-bottom:20px;display:none;animation:slideIn 0.3s ease}
        .msg.show {display:block}
        .error {background:#fee;color:#c33;border-left:4px solid #c33}
        .success {background:#efe;color:#3c3;border-left:4px solid #3c3}
        .info {background:#f0f4ff;padding:15px;border-radius:6px;font-size:13px;color:#555;line-height:1.6}
        .info p {margin-bottom:8px}
        .info code {background:white;padding:2px 6px;border-radius:3px;font-family:monospace;color:#667eea}
        small {color:#999;font-size:12px;display:block;margin-top:5px}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo"><img src="${escapeHtml(settings.logoUrl || 'https://ih.mvl27.bond/file/1787160909533_MVL27_NoBG.png')}" alt="${escapeHtml(settings.siteName)}" onerror="this.style.display='none'"></div>
            <div class="title">${escapeHtml(settings.siteName)}</div>
            <div class="subtitle">Make your URLs shorter, smarter & faster</div>
        </div>
        
        <div id="errorMsg" class="msg error"></div>
        <div id="successMsg" class="msg success"></div>
        
        <form id="shortenForm">
            <div class="form-group">
                <label for="longUrl">URL dài *</label>
                <input type="url" id="longUrl" placeholder="https://example.com/very/long/url" required>
            </div>
            
            <div class="form-group">
                <label for="customSlug">Slug tùy chỉnh (tùy chọn)</label>
                <input type="text" id="customSlug" placeholder="ví dụ: my-link">
                <small>Chỉ chữ cái, số, gạch nối và dấu gạch dưới (tối đa 20 ký tự)</small>
            </div>

            <div class="form-group">
                <label for="createCredential">API key hoặc mật khẩu tạo link</label>
                <input type="password" id="createCredential" placeholder="Để trống nếu website cho phép công khai">
                <small id="credentialHint">Nhập API key hoặc mật khẩu tạo link do admin cấp</small>
            </div>
            
            <button type="submit">Rút gọn URL</button>
        </form>
        
        <div class="result-container" id="resultContainer">
            <div class="result-label">Link rút gọn của bạn:</div>
            <div class="result-text" id="resultLink"></div>
            <button type="button" class="copy-btn" onclick="copyToClipboard(event)">Sao chép</button>
            <div style="clear:both"></div>
        </div>
        
        <div class="info">
            <p><strong>ℹ️ Cách sử dụng:</strong></p>
            <p>1. Nhập API Key (được cấp bởi quản trị viên)</p>
            <p>2. Nhập URL dài mà bạn muốn rút gọn</p>
            <p>3. (Tùy chọn) Tạo slug tùy chỉnh</p>
            <p>4. Nhấp "Rút gọn URL"</p>
            <p><strong>Lưu trữ:</strong> Links được lưu vĩnh viễn</p>
            <p><strong>Rate Limit:</strong> 50 requests/giờ</p>
        </div>
    </div>
    
    <script>
        const form = document.getElementById('shortenForm');
        const errorMsg = document.getElementById('errorMsg');
        const successMsg = document.getElementById('successMsg');
        const resultContainer = document.getElementById('resultContainer');
        const resultLink = document.getElementById('resultLink');
        
        function showError(msg) {
            errorMsg.textContent = msg;
            errorMsg.classList.add('show');
            successMsg.classList.remove('show');
        }
        
        function showSuccess(msg) {
            successMsg.textContent = msg;
            successMsg.classList.add('show');
            errorMsg.classList.remove('show');
        }
        
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const url = document.getElementById('longUrl').value.trim();
            const slug = document.getElementById('customSlug').value.trim();
            const credential = document.getElementById('createCredential').value.trim();
            
            if (!url) {
                showError('Vui lòng nhập URL');
                return;
            }
            
            try {
              const headers = { 'Content-Type': 'application/json' };
              if (credential) {
                headers['x-api-key'] = credential;
                headers['x-create-password'] = credential;
              }
                const res = await fetch('/shorten', {
                    method: 'POST',
                headers,
                    body: JSON.stringify({ url, slug: slug || undefined })
                });
                
                const data = await res.json();
                if (!res.ok) {
                    showError(data.error || 'Lỗi');
                    return;
                }
                
                resultLink.textContent = data.shortUrl;
                resultContainer.classList.add('show');
                showSuccess('✓ URL đã rút gọn thành công!');
                form.reset();
            } catch (e) {
                showError('Lỗi: ' + e.message);
            }
        });
        
        function copyToClipboard(event) {
          const text = resultLink.textContent;
          const btn = event && event.target;
          navigator.clipboard.writeText(text).then(() => {
            if (btn) {
              const originalText = btn.textContent;
              btn.textContent = '✓ Đã sao chép!';
              btn.classList.add('copied');
              setTimeout(() => {
                btn.textContent = originalText || 'Sao chép';
                btn.classList.remove('copied');
              }, 2000);
            }
          });
        }
    </script>
</body>
</html>`;
}

// Generate Links Management Page
function generateLinksPage(settings = DEFAULT_SETTINGS) {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quản lý Links - ${escapeHtml(settings.siteName)}</title>
    <style>
        * {margin:0;padding:0;box-sizing:border-box}
        body {font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;padding:20px}
        .navbar {background:white;padding:15px 20px;box-shadow:0 2px 10px rgba(0,0,0,0.1);margin-bottom:20px;border-radius:8px;display:flex;justify-content:space-between;align-items:center}
        .navbar-brand {font-size:20px;font-weight:700;color:#667eea;display:flex;align-items:center;gap:10px}
        .navbar-brand img {max-width:30px;height:30px}
        .tabs {display:flex;gap:5px;margin-bottom:20px;flex-wrap:wrap}
        .tab-btn {padding:10px 15px;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px;background:#e0e0e0;color:#333;transition:all 0.3s ease}
        .tab-btn.active {background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white}
        .tab-btn:hover {transform:translateY(-2px)}
        .tab-content {display:none}
        .tab-content.active {display:block}
        .admin-panel {background:#f9f9f9;border:2px solid #ddd;border-radius:6px;padding:20px;margin-bottom:20px}
        .admin-stat {background:white;padding:15px;border-radius:6px;border-left:4px solid #667eea;text-align:center}
        .admin-stat-label {font-size:12px;color:#666;font-weight:600}
        .admin-stat-value {font-size:24px;font-weight:700;color:#667eea}
        .admin-actions {display:flex;gap:10px;flex-wrap:wrap}
        .admin-btn {padding:10px 15px;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;transition:all 0.2s ease}
        .admin-btn:hover {transform:translateY(-2px)}
        .navbar-back:hover {background:#764ba2;transform:translateY(-2px)}
        .container {max-width:1200px;margin:0 auto}
        .auth-panel {background:white;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3);padding:40px;margin-bottom:20px}
        .auth-title {font-size:24px;font-weight:700;color:#333;margin-bottom:20px}
        .auth-form {display:flex;gap:10px;flex-wrap:wrap}
        .auth-form input {flex:1;min-width:250px;padding:12px;border:2px solid #e0e0e0;border-radius:6px;font-size:14px;transition:all 0.3s ease}
        .auth-form input:focus {outline:none;border-color:#667eea;box-shadow:0 0 0 3px rgba(102,126,234,0.1)}
        .auth-form button {padding:12px 30px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;transition:all 0.3s ease}
        .auth-form button:hover {transform:translateY(-2px);box-shadow:0 10px 20px rgba(102,126,234,0.3)}
        .content-panel {background:white;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3);padding:30px;display:none}
        .content-panel.active {display:block}
        .content-header {display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px}
        .stats-grid {display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:20px}
        .stat-card {background:#f5f9ff;border-left:4px solid #667eea;padding:15px;border-radius:6px}
        .stat-label {font-size:12px;color:#666;font-weight:600}
        .stat-value {font-size:24px;font-weight:700;color:#667eea}
        .search-filter {margin-bottom:20px;display:flex;gap:10px;flex-wrap:wrap}
        .search-filter input {flex:1;min-width:200px;padding:10px;border:2px solid #e0e0e0;border-radius:6px;font-size:14px}
        .search-filter input:focus {outline:none;border-color:#667eea}
        .links-table {width:100%;border-collapse:collapse}
        .links-table thead {background:#f5f9ff;border-bottom:2px solid #667eea}
        .links-table th {padding:12px;text-align:left;font-weight:600;color:#333;font-size:13px}
        .links-table td {padding:12px;border-bottom:1px solid #e0e0e0;font-size:13px}
        .links-table tr:hover {background:#f9f9f9}
        .link-slug {font-family:monospace;background:#f5f5f5;padding:4px 8px;border-radius:3px;color:#667eea;font-weight:600}
        .link-url {color:#666;word-break:break-all;max-width:300px}
        .link-created {color:#999;font-size:12px}
        .link-clicks {background:#f0f0f0;padding:4px 8px;border-radius:3px;font-weight:600;color:#333}
        .actions {display:flex;gap:5px}
        .action-btn {padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;transition:all 0.2s ease;font-weight:600}
        .copy-btn {background:#667eea;color:white}
        .copy-btn:hover {background:#764ba2}
        .copy-btn.copied {background:#4caf50}
        .delete-btn {background:#ff6b6b;color:white}
        .delete-btn:hover {background:#ff5252}
        .logout-btn {background:#999;color:white}
        .logout-btn:hover {background:#777}
        .msg {padding:12px;border-radius:6px;margin-bottom:15px;display:none;animation:slideIn 0.3s ease}
        .msg.show {display:block}
        .success {background:#efe;color:#3c3;border-left:4px solid #3c3}
        .error {background:#fee;color:#c33;border-left:4px solid #c33}
        .empty-state {text-align:center;padding:40px;color:#999}
        .empty-state svg {width:64px;height:64px;margin-bottom:20px;opacity:0.3}
        @keyframes slideIn {from {opacity:0;transform:translateY(-10px)} to {opacity:1;transform:translateY(0)}}
        @media (max-width:768px) {
            .auth-form {flex-direction:column}
            .auth-form input, .auth-form button {width:100%}
            .links-table {font-size:12px}
            .links-table th, .links-table td {padding:8px}
            .link-url {max-width:150px}
        }
    </style>
</head>
<body>
    <div class="navbar">
        <div class="navbar-brand"><img src="${escapeHtml(settings.logoUrl || 'https://ih.mvl27.bond/file/1787160909533_MVL27_NoBG.png')}" alt="Logo" style="max-width:30px"> ${escapeHtml(settings.siteName)} - Quản Lý</div>
        <button class="navbar-back" onclick="goHome()">← Quay lại</button>
    </div>
    
    <div class="container">
        <!-- Auth Panel -->
        <div class="auth-panel" id="authPanel">
          <div class="auth-title" id="authTitle">🔐 Đăng nhập quản trị</div>
          <div id="setupFields" style="display:none">
            <div class="auth-form"><input type="text" id="setupUsername" placeholder="Tên tài khoản admin" autocomplete="username"><input type="password" id="setupPassword" placeholder="Mật khẩu admin (tối thiểu 10 ký tự)" autocomplete="new-password"></div>
            <div class="auth-form" style="margin-top:10px"><input type="password" id="setupCreatePassword" placeholder="Mật khẩu tạo link (tùy chọn)" autocomplete="new-password"><input type="password" id="setupApiKey" placeholder="API key (tùy chọn, tối thiểu 16 ký tự)" autocomplete="new-password"></div>
            <button onclick="completeSetup()" style="margin-top:10px">Thiết lập website</button>
          </div>
          <div id="loginFields">
            <div class="auth-form"><input type="text" id="loginUsername" placeholder="Tên tài khoản" autocomplete="username"><input type="password" id="loginPassword" placeholder="Mật khẩu" autocomplete="current-password"><button onclick="authenticate()">Đăng nhập</button></div>
          </div>
          <div id="authMessage" class="msg error"></div>
          <div style="margin-top:15px;padding-top:15px;border-top:2px solid #e0e0e0;text-align:center;font-size:12px;color:#999">Phiên quản trị được lưu bằng cookie HttpOnly và không dùng API key để đăng nhập.</div>
        </div>
        
        <!-- Content Panel -->
        <div class="content-panel" id="contentPanel">
            <div id="successMsg" class="msg success"></div>
            <div id="errorMsg" class="msg error"></div>
            
            <div class="content-header">
                <div>
                    <h2>📋 Links Management</h2>
                </div>
                <button class="navbar-back" onclick="logout()">Đăng Xuất</button>
            </div>
            
            <div class="tabs">
                <button class="tab-btn active" onclick="switchTab('links', this)">📋 Links</button>
              <button class="tab-btn" onclick="switchTab('admin', this)">⚙️ Cài đặt</button>
            </div>
            
            <!-- Links Tab -->
            <div class="tab-content active" id="tab-links">
                <div class="stat-card">
                    <div class="stat-label">Tổng Links</div>
                    <div class="stat-value" id="totalLinks">0</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Tổng Clicks</div>
                    <div class="stat-value" id="totalClicks">0</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Link Mới Nhất</div>
                    <div class="stat-value" id="latestLink">-</div>
                </div>
            </div>
            
            <div class="search-filter">
                <input type="text" id="searchInput" placeholder="🔍 Tìm kiếm theo slug hoặc URL..." onkeyup="filterLinks()">
            </div>
            
            <div id="linksContainer" style="overflow-x:auto">
                <table class="links-table">
                    <thead>
                        <tr>
                            <th>Slug</th>
                            <th>URL Gốc</th>
                            <th>Ngày Tạo</th>
                            <th>Clicks</th>
                            <th>Hành Động</th>
                        </tr>
                    </thead>
                    <tbody id="linksBody">
                    </tbody>
                </table>
            </div>
            
            <div id="emptyState" class="empty-state" style="display:none">
                <p>📭 Chưa có link nào</p>
            </div>
            </div>
            
            <!-- Admin Tab -->
            <div class="tab-content" id="tab-admin">
                <div class="admin-panel">
                    <h3 style="margin-bottom:15px">⚙️ Admin Control Panel</h3>
                    
                    <div class="stats-grid" style="margin-bottom:20px">
                        <div class="admin-stat">
                            <div class="admin-stat-label">Total Links</div>
                            <div class="admin-stat-value" id="adminTotalLinks">0</div>
                        </div>
                        <div class="admin-stat">
                            <div class="admin-stat-label">Total Clicks</div>
                            <div class="admin-stat-value" id="adminTotalClicks">0</div>
                        </div>
                        <div class="admin-stat">
                            <div class="admin-stat-label">Rate Limit</div>
                            <div class="admin-stat-value">50/hr</div>
                        </div>
                    </div>
                    
                    <div style="background:white;padding:15px;border-radius:6px;margin-bottom:15px">
                        <h4 style="margin-bottom:10px;font-size:14px">⚡ Quick Actions</h4>
                        <div class="admin-actions">
                            <button class="admin-btn" style="background:#4caf50;color:white" onclick="refreshAdminStats()">🔄 Refresh Stats</button>
                            <button class="admin-btn" style="background:#ff6b6b;color:white" onclick="confirmClearAll()">🗑️ Clear All</button>
                        </div>
                    </div>
                    
                    <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:12px;border-radius:6px;font-size:12px">
                        <strong>⚠️ Security Notice:</strong> Keep your API key safe. Never share it. Actions here affect all users.
                    </div>
                    <form id="settingsForm" style="margin-top:20px" onsubmit="saveSettings(event)">
                      <h4 style="margin-bottom:10px">Website settings</h4>
                      <input id="siteName" placeholder="Tên website" maxlength="80" style="width:100%;padding:10px;margin-bottom:8px">
                      <input id="logoUrl" placeholder="Logo URL (http/https)" style="width:100%;padding:10px;margin-bottom:8px">
                      <input id="domain" placeholder="Domain, ví dụ short.example.com" style="width:100%;padding:10px;margin-bottom:8px">
                      <label style="display:block;margin:8px 0"><input type="checkbox" id="apiEnabled"> Cho phép người khác dùng API key</label>
                      <input id="apiKey" type="password" placeholder="API key mới (để trống để giữ nguyên)" style="width:100%;padding:10px;margin-bottom:8px">
                      <input id="createPassword" type="password" placeholder="Mật khẩu tạo link mới (để trống giữ nguyên, nhập dấu - để tắt)" style="width:100%;padding:10px;margin-bottom:8px">
                      <input id="adminPassword" type="password" placeholder="Mật khẩu admin mới (để trống giữ nguyên)" style="width:100%;padding:10px;margin-bottom:8px">
                      <button type="submit" class="admin-btn" style="background:#667eea;color:white">Lưu settings</button>
                    </form>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        let allLinks = [];
        let authenticated = false;

        function escapeHtml(text) {
          const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
          };
          return String(text).replace(/[&<>"']/g, m => map[m]);
        }
        
        function switchTab(tabName, btn) {
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            
            document.getElementById('tab-' + tabName).classList.add('active');
            if (btn) btn.classList.add('active');
            
            if (tabName === 'admin') {
                refreshAdminStats();
            }
        }
        
        function refreshAdminStats() {
            const totalLinks = allLinks.length;
            const totalClicks = allLinks.reduce((sum, link) => sum + (link.clicks || 0), 0);
            document.getElementById('adminTotalLinks').textContent = totalLinks;
            document.getElementById('adminTotalClicks').textContent = totalClicks;
        }
        
        function confirmClearAll() {
            if (!confirm('⚠️ This will DELETE ALL links! Are you absolutely sure?')) return;
            if (!confirm('This action CANNOT be undone! Type DELETE to confirm.')) {
                const confirmText = prompt('Type DELETE to confirm:');
                if (confirmText !== 'DELETE') {
                    showError('Cancelled');
                    return;
                }
            }
            clearAllLinks();
        }
        
        async function clearAllLinks() {
          try {
            const res = await fetch('/api/links', {
              method: 'DELETE',
              credentials: 'same-origin'
            });
            const data = await res.json();
            if (!res.ok) {
              showError(data.error || 'Không thể xóa links');
              return;
            }
            allLinks = [];
            renderLinks();
            showSuccess('Đã xóa ' + data.deleted + ' links');
          } catch (e) {
            showError('Lỗi: ' + e.message);
          }
        }
        
        function goHome() {
            window.location.href = '/';
        }
        
        function showError(msg) {
          const errorMsg = document.getElementById('authPanel').style.display !== 'none'
            ? document.getElementById('authMessage')
            : document.getElementById('errorMsg');
            errorMsg.textContent = msg;
          errorMsg.classList.remove('success');
          errorMsg.classList.add('error');
            errorMsg.classList.add('show');
          document.getElementById('successMsg')?.classList.remove('show');
        }
        
        function showSuccess(msg) {
          const successMsg = document.getElementById('authPanel').style.display !== 'none'
            ? document.getElementById('authMessage')
            : document.getElementById('successMsg');
            successMsg.textContent = msg;
          successMsg.classList.remove('error');
          successMsg.classList.add('success');
            successMsg.classList.add('show');
          document.getElementById('errorMsg')?.classList.remove('show');
        }
        
        async function authenticate() {
            try {
            const res = await fetch('/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: document.getElementById('loginUsername').value.trim(),
                password: document.getElementById('loginPassword').value
              })
                });
                if (!res.ok) {
              showError((await res.json()).error || 'Đăng nhập thất bại');
                    return;
                }
            await openAdmin();
            } catch (e) {
                showError('Lỗi: ' + e.message);
            }
        }

        async function completeSetup() {
          try {
            const apiKey = document.getElementById('setupApiKey').value.trim();
            const res = await fetch('/api/setup', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: document.getElementById('setupUsername').value.trim(),
                password: document.getElementById('setupPassword').value,
                createPassword: document.getElementById('setupCreatePassword').value,
                apiEnabled: Boolean(apiKey), apiKey
              })
            });
            const data = await res.json();
            if (!res.ok) { showError(data.error || 'Thiết lập thất bại'); return; }
            await openAdmin();
          } catch (e) { showError('Lỗi: ' + e.message); }
        }

        async function openAdmin() {
          const res = await fetch('/api/links');
          if (!res.ok) return false;
          const data = await res.json();
          authenticated = true;
          allLinks = data.links || [];
          document.getElementById('authPanel').style.display = 'none';
          document.getElementById('contentPanel').classList.add('active');
          renderLinks();
          await loadSettings();
            return true;
        }

        async function loadSettings() {
          const res = await fetch('/api/settings');
          if (!res.ok) return;
          const data = await res.json();
          document.getElementById('siteName').value = data.siteName || '';
          document.getElementById('logoUrl').value = data.logoUrl || '';
          document.getElementById('domain').value = data.domain || '';
          document.getElementById('apiEnabled').checked = Boolean(data.apiEnabled);
        }

        async function saveSettings(event) {
          event.preventDefault();
          const body = {
            siteName: document.getElementById('siteName').value,
            logoUrl: document.getElementById('logoUrl').value,
            domain: document.getElementById('domain').value,
            apiEnabled: document.getElementById('apiEnabled').checked
          };
          const apiKey = document.getElementById('apiKey').value;
          const createPassword = document.getElementById('createPassword').value;
          const adminPassword = document.getElementById('adminPassword').value;
          if (apiKey) body.apiKey = apiKey;
          if (createPassword) body.createPassword = createPassword === '-' ? '' : createPassword;
          if (adminPassword) body.adminPassword = adminPassword;
          const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const data = await res.json();
          if (!res.ok) { showError(data.error || 'Không thể lưu settings'); return; }
          showSuccess('Đã lưu settings');
          document.getElementById('apiKey').value = '';
          document.getElementById('createPassword').value = '';
          document.getElementById('adminPassword').value = '';
        }
        
        function logout() {
          fetch('/api/auth/logout', { method: 'POST' });
          authenticated = false;
            allLinks = [];
            document.getElementById('authPanel').style.display = 'block';
            document.getElementById('contentPanel').classList.remove('active');
            document.getElementById('loginPassword').value = '';
            document.getElementById('loginUsername').focus();
        }
        
        function renderLinks() {
            const tbody = document.getElementById('linksBody');
            const emptyState = document.getElementById('emptyState');
            
            if (allLinks.length === 0) {
                tbody.innerHTML = '';
                emptyState.style.display = 'block';
                document.getElementById('totalLinks').textContent = '0';
                document.getElementById('totalClicks').textContent = '0';
                document.getElementById('latestLink').textContent = '-';
                document.getElementById('adminTotalLinks').textContent = '0';
                document.getElementById('adminTotalClicks').textContent = '0';
                return;
            }
            
            emptyState.style.display = 'none';
            
            // Update stats
            const totalClicks = allLinks.reduce((sum, link) => sum + (link.clicks || 0), 0);
            document.getElementById('totalLinks').textContent = allLinks.length;
            document.getElementById('totalClicks').textContent = totalClicks.toLocaleString();
            document.getElementById('adminTotalLinks').textContent = allLinks.length;
            document.getElementById('adminTotalClicks').textContent = totalClicks.toLocaleString();
            if (allLinks.length > 0) {
                document.getElementById('latestLink').textContent = new Date(allLinks[0].createdAt).toLocaleDateString('vi-VN');
            }
            
            tbody.innerHTML = allLinks.map(function(link, index) {
              const createdDate = new Date(link.createdAt);
              const formattedDate = createdDate.toLocaleDateString('vi-VN') + ' ' + createdDate.toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'});
              const escapedSlug = escapeHtml(link.slug);
              const escapedUrl = escapeHtml(link.originalUrl);
              return '<tr>' +
                '<td><span class="link-slug">' + escapedSlug + '</span></td>' +
                '<td><span class="link-url" title="' + escapedUrl + '">' + escapedUrl + '</span></td>' +
                '<td><span class="link-created">' + formattedDate + '</span></td>' +
                '<td><span class="link-clicks">' + (link.clicks || 0) + '</span></td>' +
                '<td><div class="actions">' +
                  '<button class="action-btn copy-btn" onclick="copyLink(\'' + link.shortUrl.replace(/'/g, "\\'") + '\', this)">📋 Copy</button>' +
                  '<button class="action-btn delete-btn" onclick="deleteLink(\'' + link.slug.replace(/'/g, "\\'") + '\')">🗑️ Xóa</button>' +
                '</div></td>' +
                '</tr>';
            }).join('');
        }
        
        function filterLinks() {
            const searchText = document.getElementById('searchInput').value.toLowerCase();
            const tbody = document.getElementById('linksBody');
            
            const filteredLinks = allLinks.filter(link => 
                link.slug.toLowerCase().includes(searchText) || 
                link.originalUrl.toLowerCase().includes(searchText)
            );
            
            if (filteredLinks.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#999">Không tìm thấy link</td></tr>';
                return;
            }
            
            const tempLinks = allLinks;
            allLinks = filteredLinks;
            renderLinks();
            allLinks = tempLinks;
        }
        
        function copyLink(url, btn) {
            navigator.clipboard.writeText(url).then(() => {
                const originalText = btn.textContent;
                btn.textContent = '✓ Đã copy';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.classList.remove('copied');
                }, 2000);
            });
        }
        
        async function deleteLink(slug) {
            if (!confirm('Bạn chắc chắn muốn xóa link này?')) return;
            
            try {
                const res = await fetch('/api/links/' + slug, {
                    method: 'DELETE',
                    credentials: 'same-origin'
                });
                
                if (!res.ok) {
                    showError('Không thể xóa link');
                    return;
                }
                
                allLinks = allLinks.filter(link => link.slug !== slug);
                renderLinks();
                showSuccess('Link đã được xóa');
            } catch (e) {
                showError('Lỗi: ' + e.message);
            }
        }
        
        async function initializeAuth() {
          const status = await fetch('/api/setup-status').then(response => response.json());
          document.getElementById('setupFields').style.display = status.initialized ? 'none' : 'block';
          document.getElementById('loginFields').style.display = status.initialized ? 'block' : 'none';
          document.getElementById('authTitle').textContent = status.initialized ? '🔐 Đăng nhập quản trị' : '🚀 Thiết lập lần đầu';
          if (!status.initialized) return;
            try { await openAdmin(); } catch {}
            document.getElementById('loginUsername').focus();
        }
        initializeAuth();
    </script>
</body>
</html>`;
}

// Generate 404 page
function generate404(settings = DEFAULT_SETTINGS) {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 - ${escapeHtml(settings.siteName)}</title>
    <style>
        * {margin:0;padding:0;box-sizing:border-box}
        body {font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
        .container {background:white;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:500px;width:100%;padding:60px 40px;text-align:center}
        .error-code {font-size:120px;font-weight:700;color:#667eea;margin-bottom:10px;line-height:1}
        .emoji {font-size:80px;margin-bottom:20px}
        .error-title {font-size:28px;font-weight:700;color:#333;margin-bottom:15px}
        .error-message {font-size:16px;color:#666;margin-bottom:30px;line-height:1.6}
        .button {display:inline-block;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:12px 30px;border-radius:6px;text-decoration:none;font-weight:600;transition:all 0.3s ease}
        .button:hover {transform:translateY(-2px);box-shadow:0 10px 20px rgba(102,126,234,0.3)}
        .brand {margin-top:40px;padding-top:20px;border-top:2px solid #e0e0e0;color:#999;font-size:12px}
    </style>
</head>
<body>
    <div class="container">
        <div style="text-align:center;margin-bottom:20px">
            <img src="${escapeHtml(settings.logoUrl || 'https://ih.mvl27.bond/file/1787160909533_MVL27_NoBG.png')}" alt="${escapeHtml(settings.siteName)}" style="max-width:80px;height:auto" onerror="this.onerror=null;this.style.display='none'">
        </div>
        <div class="emoji">😕</div>
        <div class="error-code">404</div>
        <div class="error-title">Link không tìm thấy</div>
        <div class="error-message">
            Link rút gọn bạn đang tìm không tồn tại.<br>
            Vui lòng kiểm tra lại slug.
        </div>
        <a href="/" class="button">Quay lại Dashboard</a>
        <div class="brand">${escapeHtml(settings.siteName)}</div>
    </div>
</body>
</html>`;
}

// Main request handler
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return addSecurityHeaders(new Response(null, { status: 204 }));
    }
    
    try {
      const settings = await loadSettings(env.url, env);

      // Route: GET /api/setup-status - Initial setup and public configuration
      if (pathname === '/api/setup-status' && request.method === 'GET') {
        return jsonResponse(publicSettings(settings));
      }

      // Route: POST /api/setup - One-time administrator setup
      if (pathname === '/api/setup' && request.method === 'POST') {
        if (settings.initialized) return jsonResponse({ error: 'Setup has already been completed' }, 409);
        let body;
        try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }
        const { username, password, createPassword, apiEnabled = false, apiKey = '', siteName = DEFAULT_SETTINGS.siteName, logoUrl = '', domain = CUSTOM_DOMAIN } = body || {};
        if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,40}$/.test(username)) return jsonResponse({ error: 'Username must be 3-40 characters' }, 400);
        if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) return jsonResponse({ error: `Admin password must be at least ${PASSWORD_MIN_LENGTH} characters` }, 400);
        if (createPassword !== undefined && createPassword !== '' && (typeof createPassword !== 'string' || createPassword.length < PASSWORD_MIN_LENGTH)) return jsonResponse({ error: `Create password must be empty or at least ${PASSWORD_MIN_LENGTH} characters` }, 400);
        if (apiEnabled && (typeof apiKey !== 'string' || apiKey.length < 16)) return jsonResponse({ error: 'API key must be at least 16 characters when enabled' }, 400);
        if (typeof siteName !== 'string' || siteName.trim().length < 1 || siteName.length > 80) return jsonResponse({ error: 'Invalid site name' }, 400);
        if (logoUrl && !isValidUrl(logoUrl)) return jsonResponse({ error: 'Logo URL must be a valid http/https URL' }, 400);
        if (!isValidDomain(domain)) return jsonResponse({ error: 'Invalid domain' }, 400);
        const newSettings = {
          ...DEFAULT_SETTINGS,
          initialized: true,
          siteName: siteName.trim(),
          logoUrl: logoUrl.trim(),
          domain: domain.toLowerCase(),
          apiEnabled: Boolean(apiEnabled),
          apiKey: '',
          apiKeyHash: apiEnabled ? await hashApiKey(apiKey) : null,
          adminUsername: username,
          adminPasswordHash: await hashPassword(password),
          createPasswordHash: createPassword ? await hashPassword(createPassword) : null
        };
        await saveSettings(env.url, newSettings);
        const session = await createSession(env.url, username);
        return jsonResponse({ message: 'Setup completed', settings: publicSettings(newSettings) }, 201, {
          'Set-Cookie': `mvl27_session=${encodeURIComponent(session)}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; Secure; SameSite=Strict`
        });
      }

      // Route: POST /api/auth/login - Administrator login
      if (pathname === '/api/auth/login' && request.method === 'POST') {
        if (!settings.initialized) return jsonResponse({ error: 'Complete initial setup first' }, 428);
        const loginLimit = await consumeRateLimit('admin-login', request, env.url);
        if (!loginLimit.allowed) return jsonResponse({ error: 'Too many login attempts' }, 429, { 'Retry-After': String(loginLimit.retryAfter) });
        let body;
        try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }
        if (typeof body?.username !== 'string' || typeof body?.password !== 'string' || body.username !== settings.adminUsername || !(await verifyPassword(body.password, settings.adminPasswordHash))) {
          return jsonResponse({ error: 'Invalid username or password' }, 401);
        }
        const session = await createSession(env.url, settings.adminUsername);
        return jsonResponse({ message: 'Login successful', settings: publicSettings(settings) }, 200, {
          'Set-Cookie': `mvl27_session=${encodeURIComponent(session)}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; Secure; SameSite=Strict`
        });
      }

      // Route: POST /api/auth/logout - End administrator session
      if (pathname === '/api/auth/logout' && request.method === 'POST') {
        const token = getSessionToken(request);
        if (token) await env.url.delete(`${SESSION_PREFIX}${token}`);
        return jsonResponse({ message: 'Logged out' }, 200, {
          'Set-Cookie': 'mvl27_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict'
        });
      }

      // Route: GET /api/settings - Read settings (admin only)
      if (pathname === '/api/settings' && request.method === 'GET') {
        if (!await isAdmin(request, env.url)) return jsonResponse({ error: 'Admin login required' }, 401);
        return jsonResponse({ ...publicSettings(settings), apiKeyConfigured: Boolean(settings.apiKeyHash || settings.apiKey || getAdminKey(env)) });
      }

      // Route: PUT /api/settings - Update settings (admin only)
      if (pathname === '/api/settings' && request.method === 'PUT') {
        if (!await isAdmin(request, env.url)) return jsonResponse({ error: 'Admin login required' }, 401);
        let body;
        try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }
        const next = { ...settings };
        if (body.siteName !== undefined) {
          if (typeof body.siteName !== 'string' || !body.siteName.trim() || body.siteName.length > 80) return jsonResponse({ error: 'Invalid site name' }, 400);
          next.siteName = body.siteName.trim();
        }
        if (body.logoUrl !== undefined) {
          if (body.logoUrl && !isValidUrl(body.logoUrl)) return jsonResponse({ error: 'Logo URL must be a valid http/https URL' }, 400);
          next.logoUrl = body.logoUrl.trim();
        }
        if (body.domain !== undefined) {
          if (!isValidDomain(body.domain)) return jsonResponse({ error: 'Invalid domain' }, 400);
          next.domain = body.domain.toLowerCase();
        }
        if (body.apiEnabled !== undefined) next.apiEnabled = Boolean(body.apiEnabled);
        if (body.apiKey !== undefined && body.apiKey !== '') {
          if (typeof body.apiKey !== 'string' || body.apiKey.length < 16) return jsonResponse({ error: 'API key must be at least 16 characters' }, 400);
          next.apiKey = '';
          next.apiKeyHash = await hashApiKey(body.apiKey);
        }
        if (body.createPassword !== undefined) {
          if (body.createPassword && (typeof body.createPassword !== 'string' || body.createPassword.length < PASSWORD_MIN_LENGTH)) return jsonResponse({ error: `Create password must be empty or at least ${PASSWORD_MIN_LENGTH} characters` }, 400);
          next.createPasswordHash = body.createPassword ? await hashPassword(body.createPassword) : null;
        }
        if (body.adminPassword !== undefined) {
          if (typeof body.adminPassword !== 'string' || body.adminPassword.length < PASSWORD_MIN_LENGTH) return jsonResponse({ error: `Admin password must be at least ${PASSWORD_MIN_LENGTH} characters` }, 400);
          next.adminPasswordHash = await hashPassword(body.adminPassword);
        }
        await saveSettings(env.url, next);
        return jsonResponse({ message: 'Settings saved', settings: publicSettings(next) });
      }

      // Route: GET / - Dashboard
      if (pathname === '/' && request.method === 'GET') {
        return addSecurityHeaders(new Response(generateDashboard(settings), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          status: 200
        }));
      }
      
      // Route: GET /links - Links Management Page (MUST come before /:slug)
      if (pathname === '/links' && request.method === 'GET') {
        return addSecurityHeaders(new Response(generateLinksPage(settings), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          status: 200
        }));
      }
      
      // Route: POST /shorten - Create shortened URL with API Key
      if (pathname === '/shorten' && request.method === 'POST') {
        if (!await canCreateLink(request, settings, env, env.url)) {
          return jsonResponse({ error: 'Creation is not authorized. Sign in, provide the create password, or use an enabled API key.' }, 401);
        }
        
        // Rate limiting check
        const rateLimit = await consumeRateLimit('shorten', request, env.url);
        if (!rateLimit.allowed) {
          return jsonResponse({ error: 'Rate limit exceeded. Max 50 requests per hour' }, 429, {
            'Retry-After': String(rateLimit.retryAfter)
          });
        }
        
        let body;
        try {
          body = await request.json();
        } catch {
          return addSecurityHeaders(new Response(
            JSON.stringify({ error: 'Invalid JSON' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          ));
        }
        
        const { url: longUrl, slug: customSlug, title } = body;
        
        if (!longUrl || typeof longUrl !== 'string') {
          return addSecurityHeaders(new Response(
            JSON.stringify({ error: 'URL is required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          ));
        }
        
        const normalizedUrl = longUrl.trim();
        if (!isValidUrl(normalizedUrl)) {
          return addSecurityHeaders(new Response(
            JSON.stringify({ error: 'Invalid URL format or URL too long (max 2048 chars)' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          ));
        }
        
        let slug = customSlug || generateSlug();
        if (typeof slug === 'string') slug = slug.trim();
        
        if (!isValidSlug(slug) || slug.length > MAX_SLUG_LENGTH) {
          return addSecurityHeaders(new Response(
            JSON.stringify({ error: 'Invalid slug format. Max 20 chars, alphanumeric, hyphens, underscores only' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          ));
        }
        
        if (title !== undefined && (typeof title !== 'string' || title.length > 120)) {
          return jsonResponse({ error: 'title must be a string of at most 120 characters' }, 400);
        }

        const existing = await env.url.get(slug);
        if (existing) {
          return addSecurityHeaders(new Response(
            JSON.stringify({ error: 'Slug already taken' }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }
          ));
        }
        
        try {
          const createdAt = new Date().toISOString();
          const linkData = JSON.stringify({
            url: normalizedUrl,
            created: createdAt,
            clicks: 0,
            title: title ? title.trim() : null,
            expiresAt: null
          });
          
          await env.url.put(slug, linkData);
          
          const shortUrl = `https://${settings.domain}/${slug}`;
          
          return addSecurityHeaders(new Response(
            JSON.stringify({
              slug,
              shortUrl,
              originalUrl: normalizedUrl,
              permanent: true,
              createdAt,
              expiresAt: null
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ));
        } catch (error) {
          console.error('Error creating link:', error);
          return addSecurityHeaders(new Response(
            JSON.stringify({ error: 'Failed to create shortened link' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          ));
        }
      }
      
      // Route: GET /api/stats - System Statistics
      if (pathname === '/api/stats' && request.method === 'GET') {
        if (!await isAdmin(request, env.url)) {
          return jsonResponse({ error: 'Unauthorized: admin access required' }, 401);
        }
        try {
          const keys = await listAllKeys(env.url);
          const totalLinks = keys.filter(k => !k.name.startsWith('ratelimit:')).length;
          
          return addSecurityHeaders(new Response(
            JSON.stringify({
              total_links: totalLinks,
              system_status: 'active',
              domain: settings.domain,
              storage: 'permanent',
              timestamp: new Date().toISOString()
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ));
        } catch (error) {
          console.error('Error getting stats:', error);
          return addSecurityHeaders(new Response(
            JSON.stringify({ error: 'Failed to retrieve stats' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          ));
        }
      }
      
      // Route: GET /api/links - List all shortened links
      if (pathname === '/api/links' && request.method === 'GET') {
        // Verify API Key for security
        if (!await isAdmin(request, env.url)) {
          return jsonResponse({ error: 'Unauthorized: admin access required' }, 401);
        }
        
        // Apply rate limiting
        const rateLimit = await consumeRateLimit('admin-list', request, env.url);
        if (!rateLimit.allowed) {
          return jsonResponse({ error: 'Rate limit exceeded' }, 429, {
            'Retry-After': String(rateLimit.retryAfter)
          });
        }
        
        try {
          const keys = await listAllKeys(env.url);
          const links = [];
          
          for (const key of keys) {
            // Skip rate limit entries
            if (key.name.startsWith('ratelimit:')) continue;
            
            const linkDataStr = await env.url.get(key.name);
            if (linkDataStr) {
              try {
                const linkData = JSON.parse(linkDataStr);
                links.push({
                  slug: key.name,
                  shortUrl: `https://${settings.domain}/${encodeURIComponent(key.name)}`,
                  originalUrl: linkData.url,
                  createdAt: linkData.created,
                  clicks: linkData.clicks || 0,
                  title: linkData.title || null,
                  expiresAt: linkData.expiresAt || null
                });
              } catch (e) {
                console.error('Error parsing link data:', e);
              }
            }
          }
          
          // Sort by creation date (newest first)
          links.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          
          return addSecurityHeaders(new Response(
            JSON.stringify({
              total: links.length,
              links: links,
              timestamp: new Date().toISOString()
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ));
        } catch (error) {
          console.error('Error retrieving links:', error);
          return addSecurityHeaders(new Response(
            JSON.stringify({ error: 'Failed to retrieve links' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          ));
        }
      }

      // Route: DELETE /api/links - Delete all links (admin only)
      if (pathname === '/api/links' && request.method === 'DELETE') {
        if (!await isAdmin(request, env.url)) {
          return jsonResponse({ error: 'Unauthorized: admin access required' }, 401);
        }
        const rateLimit = await consumeRateLimit('admin-delete-all', request, env.url);
        if (!rateLimit.allowed) {
          return jsonResponse({ error: 'Rate limit exceeded' }, 429, {
            'Retry-After': String(rateLimit.retryAfter)
          });
        }
        try {
          const keys = await listAllKeys(env.url);
          const linkKeys = keys.filter(key => !key.name.startsWith('ratelimit:'));
          await Promise.all(linkKeys.map(key => env.url.delete(key.name)));
          return jsonResponse({ message: 'All links deleted successfully', deleted: linkKeys.length });
        } catch (error) {
          console.error('Error deleting all links:', error);
          return jsonResponse({ error: 'Failed to delete all links' }, 500);
        }
      }
      
      // Route: DELETE /api/links/:slug - Delete link with API Key
      if (pathname.startsWith('/api/links/') && request.method === 'DELETE') {
        if (!await isAdmin(request, env.url)) {
          return jsonResponse({ error: 'Unauthorized: admin access required' }, 401);
        }
        
        // Apply rate limiting
        const rateLimit = await consumeRateLimit('admin-delete', request, env.url);
        if (!rateLimit.allowed) {
          return jsonResponse({ error: 'Rate limit exceeded' }, 429, {
            'Retry-After': String(rateLimit.retryAfter)
          });
        }
        
        const slug = decodeURIComponent(pathname.slice('/api/links/'.length));
        
        // Validate slug
        if (!isValidSlug(slug)) {
          return addSecurityHeaders(new Response(
            JSON.stringify({ error: 'Invalid slug format' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          ));
        }
        
        try {
          const existing = await env.url.get(slug);
          if (!existing) {
            return addSecurityHeaders(new Response(
              JSON.stringify({ error: 'Link not found' }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            ));
          }
          
          await env.url.delete(slug);
          
          return addSecurityHeaders(new Response(
            JSON.stringify({ message: 'Link deleted successfully', slug }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ));
        } catch (error) {
          console.error('Error deleting link:', error);
          return addSecurityHeaders(new Response(
            JSON.stringify({ error: 'Failed to delete link' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          ));
        }
      }
      
      // Route: GET /:slug - Redirect to original URL with click tracking
      if (pathname !== '/' && !pathname.startsWith('/api') && request.method === 'GET') {
        const slug = pathname.substring(1);
        
        // Validate slug format
        if (!isValidSlug(slug)) {
          return addSecurityHeaders(new Response(generate404(settings), {
            status: 404,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          }));
        }
        
        try {
          const linkDataStr = await env.url.get(slug);
          
          if (!linkDataStr) {
            return addSecurityHeaders(new Response(generate404(settings), {
              status: 404,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }));
          }
          
          const linkData = JSON.parse(linkDataStr);
          const longUrl = linkData.url;

          // Validate URL exists and is valid
          if (!longUrl || typeof longUrl !== 'string' || !isValidUrl(longUrl)) {
            return addSecurityHeaders(new Response(generate404(settings), {
              status: 404,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }));
          }
          
          // Track click asynchronously (no race condition - just increment, don't read-modify-write)
          ctx.waitUntil(
            (async () => {
              try {
                const updated = JSON.stringify({
                  url: longUrl,
                  created: linkData.created || new Date().toISOString(),
                  clicks: (linkData.clicks || 0) + 1,
                  title: linkData.title || null,
                  expiresAt: linkData.expiresAt || null
                });
                await env.url.put(slug, updated, linkData.expiresAt ? {
                  expiration: Math.floor(Date.parse(linkData.expiresAt) / 1000)
                } : undefined);
              } catch (e) {
                console.error('Error tracking click:', e);
                // Silently fail click tracking - don't block redirect
              }
            })()
          );
          
          const response = new Response(null, {
            status: 302,
            headers: { 'Location': longUrl }
          });
          return addSecurityHeaders(response);
        } catch (error) {
          console.error('Error processing redirect:', error);
          return addSecurityHeaders(new Response(generate404(settings), {
            status: 404,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          }));
        }
      }
      
      // Default: 404
      return addSecurityHeaders(new Response(generate404(settings), {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }));
      
    } catch (error) {
      console.error('Unhandled error:', error);
      return addSecurityHeaders(new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      ));
    }
  }
};
