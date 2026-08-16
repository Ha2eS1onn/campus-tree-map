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
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    const corsHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    };

    const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: corsHeaders });
    const jsonError = (msg, status = 400) => jsonResponse({ error: msg }, status);

    // ---------- JWT 签名 ----------
    const signJWT = async (payload) => {
      const secret = env.JWT_SECRET;
      if (!secret) throw new Error('未配置 JWT_SECRET');
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const body = btoa(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }));
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`));
      const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));
      return `${header}.${body}.${signature}`;
    };

    // ---------- 1. 管理员登录 ----------
    if (url.pathname === '/api/auth') {
      if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
      const { password } = await request.json();
      if (!password) return jsonError('缺少 password');
      if (password !== env.ADMIN_PASSWORD) return jsonError('密码错误', 401);
      
      const token = await signJWT({ role: 'admin' });
      return jsonResponse({ token });
    }

    // ---------- 2. 原有图片上传 ----------
    if (url.pathname === '/api/upload') {
      if (request.method === 'GET') {
        return new Response(JSON.stringify({ status: 'ok' }), { headers: corsHeaders });
      }

      if (request.method === 'DELETE') {
        try {
          const { imageUrl } = await request.json();
          if (!imageUrl) return new Response(JSON.stringify({ error: '缺少 imageUrl' }), { status: 400, headers: corsHeaders });

          const match = imageUrl.match(/cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^/]+)@([^/]+)\/(.+)/);
          if (!match) return new Response(JSON.stringify({ error: '无法解析路径' }), { status: 400, headers: corsHeaders });

          const [, owner, repo, branch, path] = match;
          const token = env.GITHUB_TOKEN;

          const getRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, {
            headers: { 'Authorization': `token ${token}`, 'User-Agent': 'TreeMap-Pages' }
          });
          if (!getRes.ok) throw new Error('获取文件信息失败');
          const fileInfo = await getRes.json();

          const delRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `token ${token}`,
              'Content-Type': 'application/json',
              'User-Agent': 'TreeMap-Pages'
            },
            body: JSON.stringify({ message: `Delete: ${path}`, sha: fileInfo.sha, branch })
          });

          if (!delRes.ok) {
            const err = await delRes.json();
            throw new Error(err.message);
          }
          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

      if (request.method === 'POST') {
        try {
          const { fileName, fileContent } = await request.json();
          if (!fileName || !fileContent) {
            return new Response(JSON.stringify({ error: '缺少 fileName 或 fileContent' }), { status: 400, headers: corsHeaders });
          }

          const token = env.GITHUB_TOKEN;
          if (!token) return new Response(JSON.stringify({ error: '未配置 GITHUB_TOKEN' }), { status: 500, headers: corsHeaders });

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
            return new Response(JSON.stringify({ error: err.message || 'GitHub上传失败' }), { status: githubRes.status, headers: corsHeaders });
          }

          const cdnUrl = `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${BRANCH}/${path}`;
          return new Response(JSON.stringify({ cdnUrl }), { status: 200, headers: corsHeaders });

        } catch (err) {
          return new Response(JSON.stringify({ error: err.message || '服务器错误' }), { status: 500, headers: corsHeaders });
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