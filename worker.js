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

function isAdmin(request, env) {
  const key = getAdminKey(env);
  return Boolean(key && verifyApiKey(request, key));
}

// Helper: Add security headers to response
function addSecurityHeaders(response) {
  const newHeaders = new Headers(response.headers);
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    newHeaders.set(key, value);
  });
  newHeaders.set('Access-Control-Allow-Origin', `https://${CUSTOM_DOMAIN}`);
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
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
function generateDashboard() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MVL27URL</title>
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
            <div class="logo"><img src="https://ih.mvl27.bond/file/1787160909533_MVL27_NoBG.png" alt="MVL27URL" onerror="this.onerror=null;this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2248%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22%3E%F0%9F%9A%80%3C/text%3E%3C/svg%3E'"></div>
            <div class="title">MVL27URL</div>
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
              <label for="expiresInDays">Thời hạn (tùy chọn)</label>
              <input type="number" id="expiresInDays" min="1" max="365" placeholder="Để trống nếu lưu vĩnh viễn">
              <small>Tự động xóa sau 1 đến 365 ngày</small>
            </div>
            
            <div class="form-group">
                <label for="apiKey">API Key *</label>
                <input type="password" id="apiKey" placeholder="Nhập API key của bạn" required>
                <small>Cần API Key để tạo link rút gọn</small>
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
            const expiresInDays = document.getElementById('expiresInDays').value;
            const apiKey = document.getElementById('apiKey').value.trim();
            
            if (!url) {
                showError('Vui lòng nhập URL');
                return;
            }
            
            if (!apiKey) {
                showError('Vui lòng nhập API Key');
                return;
            }
            
            try {
                const res = await fetch('/shorten', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey
                    },
                    body: JSON.stringify({ url, slug: slug || undefined, expiresInDays: expiresInDays || undefined })
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
function generateLinksPage() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quản lý Links - MVL27URL</title>
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
        <div class="navbar-brand"><img src="https://ih.mvl27.bond/file/1787160909533_MVL27_NoBG.png" alt="Logo" style="max-width:30px"> MVL27URL - Quản Lý</div>
        <button class="navbar-back" onclick="goHome()">← Quay lại</button>
    </div>
    
    <div class="container">
        <!-- Auth Panel -->
        <div class="auth-panel" id="authPanel">
            <div class="auth-title">🔐 Xác Thực API Key</div>
            <div class="auth-form">
                <input type="password" id="apiKeyInput" placeholder="Nhập API key của bạn" autocomplete="off" />
                <button onclick="authenticate()">Xem Links</button>
            </div>
            <div style="margin-top:15px;padding-top:15px;border-top:2px solid #e0e0e0;text-align:center;font-size:12px;color:#999">
                <strong>⚠️ Lưu ý Bảo Mật:</strong><br>
                API key được cấp bởi admin. <strong>KHÔNG chia sẻ</strong> với bất cứ ai. Chỉ nhập trên máy tính tin cậy.
            </div>
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
                <button class="tab-btn" onclick="switchTab('admin', this)">⚙️ Admin Panel</button>
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
                            <button class="admin-btn" style="background:#667eea;color:white" onclick="copyAdminApiKey(currentApiKey)">📋 Copy API Key</button>
                            <button class="admin-btn" style="background:#4caf50;color:white" onclick="refreshAdminStats()">🔄 Refresh Stats</button>
                            <button class="admin-btn" style="background:#ff6b6b;color:white" onclick="confirmClearAll()">🗑️ Clear All</button>
                        </div>
                    </div>
                    
                    <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:12px;border-radius:6px;font-size:12px">
                        <strong>⚠️ Security Notice:</strong> Keep your API key safe. Never share it. Actions here affect all users.
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        let allLinks = [];
        let currentApiKey = '';

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
        
        function copyAdminApiKey(key) {
            navigator.clipboard.writeText(key).then(() => {
                showSuccess('✓ API Key copied!');
            });
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
              headers: { 'x-api-key': currentApiKey }
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
            const errorMsg = document.getElementById('errorMsg');
            errorMsg.textContent = msg;
            errorMsg.classList.add('show');
            document.getElementById('successMsg').classList.remove('show');
        }
        
        function showSuccess(msg) {
            const successMsg = document.getElementById('successMsg');
            successMsg.textContent = msg;
            successMsg.classList.add('show');
            document.getElementById('errorMsg').classList.remove('show');
        }
        
        async function authenticate() {
            const apiKey = document.getElementById('apiKeyInput').value.trim();
            if (!apiKey) {
                showError('Vui lòng nhập API key');
                return;
            }
            
            try {
                const res = await fetch('/api/links', {
                    headers: { 'x-api-key': apiKey }
                });
                
                if (!res.ok) {
                    showError('API key không đúng');
                    return;
                }
                
                const data = await res.json();
                currentApiKey = apiKey;
                allLinks = data.links || [];
                
                document.getElementById('authPanel').style.display = 'none';
                document.getElementById('contentPanel').classList.add('active');
                renderLinks();
                refreshAdminStats();
            } catch (e) {
                showError('Lỗi: ' + e.message);
            }
        }
        
        function logout() {
            currentApiKey = '';
            allLinks = [];
            document.getElementById('authPanel').style.display = 'block';
            document.getElementById('contentPanel').classList.remove('active');
            document.getElementById('apiKeyInput').value = '';
            document.getElementById('apiKeyInput').focus();
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
                    headers: { 'x-api-key': currentApiKey }
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
        
        // Focus input on load
        document.getElementById('apiKeyInput').focus();
    </script>
</body>
</html>`;
}

// Generate 404 page
function generate404() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 - MVL27URL</title>
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
            <img src="https://ih.mvl27.bond/file/1787160909533_MVL27_NoBG.png" alt="Logo" style="max-width:80px;height:auto" onerror="this.onerror=null;this.style.display='none'">
        </div>
        <div class="emoji">😕</div>
        <div class="error-code">404</div>
        <div class="error-title">Link không tìm thấy</div>
        <div class="error-message">
            Link rút gọn bạn đang tìm không tồn tại.<br>
            Vui lòng kiểm tra lại slug.
        </div>
        <a href="/" class="button">Quay lại Dashboard</a>
        <div class="brand">MVL27URL 🚀</div>
    </div>
</body>
</html>`;
}

// Main request handler
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const apiKey = getAdminKey(env);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return addSecurityHeaders(new Response(null, { status: 204 }));
    }
    
    try {
      // Route: GET / - Dashboard
      if (pathname === '/' && request.method === 'GET') {
        return addSecurityHeaders(new Response(generateDashboard(), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          status: 200
        }));
      }
      
      // Route: GET /links - Links Management Page (MUST come before /:slug)
      if (pathname === '/links' && request.method === 'GET') {
        return addSecurityHeaders(new Response(generateLinksPage(), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          status: 200
        }));
      }
      
      // Route: POST /shorten - Create shortened URL with API Key
      if (pathname === '/shorten' && request.method === 'POST') {
        // Verify API Key
        if (!apiKey || !verifyApiKey(request, apiKey)) {
          return jsonResponse({ error: 'Unauthorized: Invalid or missing API key' }, 401);
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
        
        const { url: longUrl, slug: customSlug, expiresInDays, title } = body;
        
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
        
        const expirationDays = expiresInDays === undefined || expiresInDays === null || expiresInDays === ''
          ? null
          : Number(expiresInDays);
        if (expirationDays !== null && (!Number.isInteger(expirationDays) || expirationDays < 1 || expirationDays > MAX_EXPIRATION_DAYS)) {
          return jsonResponse({ error: `expiresInDays must be an integer from 1 to ${MAX_EXPIRATION_DAYS}` }, 400);
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
          const expiresAt = expirationDays ? new Date(Date.now() + expirationDays * 86400000).toISOString() : null;
          const linkData = JSON.stringify({
            url: normalizedUrl,
            created: createdAt,
            clicks: 0,
            title: title ? title.trim() : null,
            expiresAt
          });
          
          await env.url.put(slug, linkData, expirationDays ? { expirationTtl: expirationDays * 86400 } : undefined);
          
          const shortUrl = `https://${CUSTOM_DOMAIN}/${slug}`;
          
          return addSecurityHeaders(new Response(
            JSON.stringify({
              slug,
              shortUrl,
              originalUrl: normalizedUrl,
              permanent: true,
              createdAt,
              expiresAt
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
        if (!isAdmin(request, env)) {
          return jsonResponse({ error: 'Unauthorized: admin access required' }, 401);
        }
        try {
          const keys = await listAllKeys(env.url);
          const totalLinks = keys.filter(k => !k.name.startsWith('ratelimit:')).length;
          
          return addSecurityHeaders(new Response(
            JSON.stringify({
              total_links: totalLinks,
              system_status: 'active',
              domain: CUSTOM_DOMAIN,
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
        if (!isAdmin(request, env)) {
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
                  shortUrl: `https://${CUSTOM_DOMAIN}/${encodeURIComponent(key.name)}`,
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
        if (!isAdmin(request, env)) {
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
        if (!isAdmin(request, env)) {
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
          return addSecurityHeaders(new Response(generate404(), {
            status: 404,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          }));
        }
        
        try {
          const linkDataStr = await env.url.get(slug);
          
          if (!linkDataStr) {
            return addSecurityHeaders(new Response(generate404(), {
              status: 404,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }));
          }
          
          const linkData = JSON.parse(linkDataStr);
          const longUrl = linkData.url;

          if (linkData.expiresAt && Date.now() >= Date.parse(linkData.expiresAt)) {
            ctx.waitUntil(env.url.delete(slug));
            return addSecurityHeaders(new Response(generate404(), {
              status: 404,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }));
          }
          
          // Validate URL exists and is valid
          if (!longUrl || typeof longUrl !== 'string' || !isValidUrl(longUrl)) {
            return addSecurityHeaders(new Response(generate404(), {
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
          return addSecurityHeaders(new Response(generate404(), {
            status: 404,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          }));
        }
      }
      
      // Default: 404
      return addSecurityHeaders(new Response(generate404(), {
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
