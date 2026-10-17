export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      });
    }

    const corsHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    };

    const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: corsHeaders });
    const jsonError = (msg, status = 400) => jsonResponse({ error: msg }, status);

    const encoder = new TextEncoder();
    const FIREBASE_URL = (env.FIREBASE_DB_URL || 'https://campus-trees-6ce96-default-rtdb.asia-southeast1.firebasedatabase.app').replace(/\/+$/, '');
    const JWT_TTL = 7 * 24 * 60 * 60; // 7 天

    // ---------- JWT 签名 / 校验 ----------
    const base64UrlToBytes = (value) => {
      const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    };

    const signJWT = async (payload) => {
      const secret = env.JWT_SECRET;
      if (!secret) throw new Error('未配置 JWT_SECRET');
      const now = Math.floor(Date.now() / 1000);
      const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const body = btoa(JSON.stringify({ ...payload, iat: now, exp: now + JWT_TTL }));
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`));
      const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));
      return `${header}.${body}.${signature}`;
    };

    const verifyJWT = async (token) => {
      const secret = env.JWT_SECRET;
      if (!secret || !token) return false;
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      const [header, body, signature] = parts;
      try {
        const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        const valid = await crypto.subtle.verify('HMAC', key, base64UrlToBytes(signature), encoder.encode(`${header}.${body}`));
        if (!valid) return false;
        const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body)));
        return payload.role === 'admin'
          && typeof payload.exp === 'number'
          && payload.exp > Math.floor(Date.now() / 1000);
      } catch (err) {
        return false;
      }
    };

    const getBearerToken = (request) => {
      const auth = request.headers.get('Authorization') || '';
      return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    };

    // ---------- GitHub 图片删除(上传/管理接口共用) ----------
    const deleteImageFromGitHub = async (imageUrl, token) => {
      const match = String(imageUrl || '').match(/cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^/]+)@([^/]+)\/(.+)/);
      if (!match) throw Object.assign(new Error('无法解析路径'), { status: 400 });
      if (!token) throw new Error('未配置 GITHUB_TOKEN');

      const [, owner, repo, branch, path] = match;
      const headers = { 'Authorization': `token ${token}`, 'User-Agent': 'TreeMap-Pages' };

      const getRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, { headers });
      if (!getRes.ok) throw new Error('获取文件信息失败');
      const fileInfo = await getRes.json();

      const delRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Delete: ${path}`, sha: fileInfo.sha, branch })
      });
      if (!delRes.ok) {
        let message = '删除文件失败';
        try {
          const err = await delRes.json();
          if (err && err.message) message = err.message;
        } catch (e) { /* 忽略非 JSON 错误体 */ }
        throw new Error(message);
      }
    };

    // ---------- 1. 管理员登录 ----------
    if (url.pathname === '/api/auth') {
      if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
      try {
        const { password } = await request.json();
        if (!password) return jsonError('缺少 password');
        if (password !== env.ADMIN_PASSWORD) return jsonError('密码错误', 401);

        const token = await signJWT({ role: 'admin' });
        return jsonResponse({ token });
      } catch (err) {
        return jsonError(err.message || '请求解析失败');
      }
    }

    // ---------- 2. 管理接口(需 JWT) ----------
    if (url.pathname === '/api/admin/update') {
      if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
      if (!(await verifyJWT(getBearerToken(request)))) return jsonError('未授权', 401);

      try {
        const { treeId, updates } = await request.json();
        if (!treeId || typeof treeId !== 'string') return jsonError('缺少 treeId');
        if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return jsonError('缺少 updates');

        const res = await fetch(`${FIREBASE_URL}/trees/${encodeURIComponent(treeId)}.json`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          return jsonError(`Firebase 更新失败(${res.status})${detail ? ': ' + detail.slice(0, 200) : ''}`, 502);
        }
        return jsonResponse({ success: true });
      } catch (err) {
        return jsonError(err.message || '请求解析失败');
      }
    }

    if (url.pathname === '/api/admin/delete') {
      if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
      if (!(await verifyJWT(getBearerToken(request)))) return jsonError('未授权', 401);

      try {
        const { treeId, imageUrls } = await request.json();
        if (!treeId || typeof treeId !== 'string') return jsonError('缺少 treeId');

        const warnings = [];
        if (Array.isArray(imageUrls) && imageUrls.length > 0) {
          if (!env.GITHUB_TOKEN) {
            warnings.push('未配置 GITHUB_TOKEN,图片未删除');
          } else {
            for (const imageUrl of imageUrls) {
              try {
                await deleteImageFromGitHub(imageUrl, env.GITHUB_TOKEN);
              } catch (err) {
                warnings.push(`${imageUrl}: ${err.message}`);
              }
            }
          }
        }

        const res = await fetch(`${FIREBASE_URL}/trees/${encodeURIComponent(treeId)}.json`, { method: 'DELETE' });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          return jsonError(`Firebase 删除失败(${res.status})${detail ? ': ' + detail.slice(0, 200) : ''}`, 502);
        }
        return jsonResponse({ success: true, warnings });
      } catch (err) {
        return jsonError(err.message || '请求解析失败');
      }
    }

    // ---------- 3. 图片上传 / 删除 ----------
    if (url.pathname === '/api/upload') {
      if (request.method === 'GET') {
        return jsonResponse({ status: 'ok' });
      }

      if (request.method === 'DELETE') {
        try {
          const { imageUrl } = await request.json();
          if (!imageUrl) return jsonError('缺少 imageUrl');
          await deleteImageFromGitHub(imageUrl, env.GITHUB_TOKEN);
          return jsonResponse({ success: true });
        } catch (err) {
          return jsonError(err.message || '删除失败', err.status || 500);
        }
      }

      if (request.method === 'POST') {
        try {
          const { fileName, fileContent } = await request.json();
          if (!fileName || !fileContent) {
            return jsonError('缺少 fileName 或 fileContent');
          }

          const token = env.GITHUB_TOKEN;
          if (!token) return jsonError('未配置 GITHUB_TOKEN', 500);

          const OWNER = 'Ha2eS1onn';
          const REPO = 'campus-tree-images';
          const BRANCH = 'main';

          const now = new Date();
          const datePath = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;
          const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
          const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
          const path = `trees/${datePath}/${uniqueId}_${safeName}`;

          const githubRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
            method: 'PUT',
            headers: {
              'Authorization': `token ${token}`,
              'Content-Type': 'application/json',
              'User-Agent': 'TreeMap-Pages'
            },
            body: JSON.stringify({ message: `Upload: ${path}`, content: fileContent, branch: BRANCH })
          });

          if (!githubRes.ok) {
            const err = await githubRes.json();
            return jsonResponse({ error: err.message || 'GitHub上传失败' }, githubRes.status);
          }

          const cdnUrl = `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${BRANCH}/${path}`;
          return jsonResponse({ cdnUrl });
        } catch (err) {
          return jsonError(err.message || '服务器错误', 500);
        }
      }

      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405, headers: { ...corsHeaders, 'Allow': 'POST, DELETE, OPTIONS' }
      });
    }

    // 非 API 请求，回退到静态资源
    return env.ASSETS.fetch(request);
  }
};
