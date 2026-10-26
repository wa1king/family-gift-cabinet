import { validateState } from './model.js?v=20261026-github';

const LOGIN_KEY = 'little-gift-github-connection';
const PHOTO_PREFIX = '00000000-0000-4000-8000-000000000001/';
const fail = (message, code) => Object.assign(new Error(message), { code });
const sha = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
const validPhoto = key => new RegExp('^' + PHOTO_PREFIX + '[a-f0-9]{64}\\.(jpg|png|webp)$').test(key);

// The public configuration contains repository coordinates only. Credentials are
// supplied by the person connecting this device, never bundled with the app.
export function createGitHubClient(config, { fetcher = globalThis.fetch, temporary = globalThis.sessionStorage, persistent = globalThis.localStorage } = {}) {
  const { owner, repo, branch = 'main' } = config;
  if (![owner, repo, branch].every(v => typeof v === 'string' && /^[A-Za-z0-9_.-]+$/.test(v))) throw Error('GitHub 仓库配置无效');
  const base = `/repos/${owner}/${repo}`;
  let credentials = null, epoch = 0, repositoryId = null, lastHead = '', lastRevision = 0;
  const urls = new Map();
  function guard(version) { if (version !== epoch || !credentials) throw fail('连接已断开，请重新连接。', 'AUTH_REQUIRED'); }
  async function api(path, { method = 'GET', body, raw = false, missing = false } = {}) {
    if (!credentials) throw fail('请先连接 GitHub。', 'AUTH_REQUIRED');
    const version = epoch;
    let response;
    try {
      response = await fetcher('https://api.github.com' + path, {
        method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(45000),
        headers: { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', Authorization: 'Bearer ' + credentials.token, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { guard(version); throw fail('网络连接中断，请重试。', 'NETWORK'); }
    guard(version);
    if (response.status === 404 && missing) return null;
    if (!response.ok) {
      if (response.status === 401) throw fail('访问授权已过期或失效，请断开后重新连接。', 'AUTH_REQUIRED');
      if (response.status === 409 || response.status === 422) throw fail('另一台设备更新了清单，请重新读取后再试。', 'CONFLICT');
      if (response.status === 403 || response.status === 429) throw fail('GitHub 暂时限制了请求，或授权没有读写权限，请稍后重试并检查授权。', 'PERMISSION');
      throw fail(response.status === 404 ? '无法访问私有数据仓库，请检查授权选择的仓库。' : 'GitHub 暂时无法完成请求。', 'REMOTE');
    }
    if (raw) return response;
    return response.status === 204 ? null : response.json();
  }
  async function verifyRepository() {
    const info = await api(base);
    if (!info.private) throw fail('数据仓库必须是私有仓库，已停止连接。', 'PUBLIC_REPOSITORY');
    if (repositoryId && repositoryId !== info.id) throw fail('仓库身份发生变化，请重新连接。', 'REPOSITORY_CHANGED');
    repositoryId = info.id;
  }
  async function head() { return (await api(base + '/git/ref/heads/' + branch)).object.sha; }
  async function readAt(commit) {
    const response = await api(base + '/contents/cabinet.json?ref=' + commit, { raw: true, missing: true });
    if (!response) { lastHead = commit; lastRevision = 0; return { state: null, revision: 0, head: commit, operations: [] }; }
    const text = await response.text();
    if (text.length > 6 * 1024 * 1024) throw Error('清单过大，请先导出备份整理。');
    const envelope = JSON.parse(text);
    if (envelope.format !== 'gift-cabinet-github-v1' || !Array.isArray(envelope.operations)) throw Error('云端清单格式无法识别，未覆盖任何内容。');
    const state = validateState(envelope.state);
    lastHead = commit; lastRevision = commit;
    return { state, revision: commit, head: commit, operations: envelope.operations, updatedAt: envelope.updatedAt };
  }
  async function load() { await verifyRepository(); return readAt(await head()); }
  async function photoData(key) {
    if (!validPhoto(key)) throw Error('照片编号无效');
    const response = await api(base + '/contents/photos/' + key + '?ref=' + branch, { raw: true });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 3 * 1024 * 1024) throw Error('照片过大');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== key.split('/')[1].split('.')[0]) throw Error('照片校验失败');
    return { bytes, type: 'image/' + (key.endsWith('.jpg') ? 'jpeg' : key.split('.').at(-1)) };
  }
  async function prepare(state) {
    const clean = validateState(state), photos = new Map();
    let total = 0;
    for (const item of clean.items) {
      if (!item.photo) { if (item.photoKey && !validPhoto(item.photoKey)) throw Error('这份备份来自其他存储，请先从原应用导出包含照片的备份。'); continue; }
      const [, type, data] = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(item.photo);
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      total += bytes.length;
      if (bytes.length > 3 * 1024 * 1024 || total > 24 * 1024 * 1024) throw Error('本次照片较多，请分批添加，每张不超过 3 MB。');
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      item.photoKey = PHOTO_PREFIX + digest + '.' + (type === 'jpeg' ? 'jpg' : type); item.photo = null;
      photos.set(item.photoKey, data);
    }
    return { clean, photos };
  }
  const client = {
    configured: true,
    get session() { return credentials ? { user: { id: owner, email: owner + '/' + repo } } : null; },
    async restoreSession() {
      if (credentials) return;
      let stored;
      try { stored = JSON.parse(temporary?.getItem(LOGIN_KEY) || persistent?.getItem(LOGIN_KEY) || 'null'); } catch { return; }
      if (stored?.repository === owner + '/' + repo && typeof stored.token === 'string') { credentials = { token: stored.token }; epoch++; }
    },
    async signIn(token, remember = false) {
      credentials = { token: String(token).trim() }; epoch++; repositoryId = null;
      try {
        await verifyRepository();
        const value = JSON.stringify({ repository: owner + '/' + repo, token: credentials.token });
        temporary?.removeItem(LOGIN_KEY); persistent?.removeItem(LOGIN_KEY);
        (remember ? persistent : temporary)?.setItem(LOGIN_KEY, value);
      } catch (error) { credentials = null; epoch++; throw error; }
      return client.session;
    },
    async signOut() {
      credentials = null; epoch++; repositoryId = null;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear(); temporary?.removeItem(LOGIN_KEY); persistent?.removeItem(LOGIN_KEY);
    },
    load,
    async checkRevision() { await verifyRepository(); const current = await head(); return current === lastHead ? lastRevision : (await readAt(current)).revision; },
    async save(state, expectedRevision, { operationId = crypto.randomUUID() } = {}) {
      const version = epoch;
      const fingerprint = await sha(JSON.stringify({ state: validateState(state), expectedRevision }));
      let current = await load();
      guard(version);
      const completed = current.operations.find(op => op.id === operationId);
      if (completed) { if (completed.hash !== fingerprint) throw Error('保存编号重复，请重新打开页面。'); return current; }
      if (current.revision !== expectedRevision) throw fail('另一台设备已更新清单。', 'CONFLICT');
      const { clean, photos } = await prepare(state);
      const writeApi = (...args) => { guard(version); return api(...args); };
      const entries = [];
      for (const [key, content] of photos) {
        const blob = await writeApi(base + '/git/blobs', { method: 'POST', body: { content, encoding: 'base64' } });
        entries.push({ path: 'photos/' + key, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const envelope = { format: 'gift-cabinet-github-v1', state: clean, updatedAt: new Date().toISOString(), operations: [...current.operations, { id: operationId, hash: fingerprint }].slice(-100) };
      const content = JSON.stringify(envelope);
      if (new TextEncoder().encode(content).length > 5 * 1024 * 1024) throw Error('清单超过 5 MB，请先整理记录。');
      const parent = await writeApi(base + '/git/commits/' + current.head);
      const tree = await writeApi(base + '/git/trees', { method: 'POST', body: { base_tree: parent.tree.sha, tree: [...entries, { path: 'cabinet.json', mode: '100644', type: 'blob', content }] } });
      const commit = await writeApi(base + '/git/commits', { method: 'POST', body: { message: 'Update family gift cabinet', tree: tree.sha, parents: [current.head] } });
      guard(version);
      try {
        await api(base + '/git/refs/heads/' + branch, { method: 'PATCH', body: { sha: commit.sha, force: false } });
      } catch (error) {
        // A lost reply might mean the commit succeeded. Inspect the durable
        // operation journal before allowing another decrement or new write.
        try {
          current = await load();
          const receipt = current.operations.find(op => op.id === operationId);
          if (receipt?.hash === fingerprint) return current;
          if (current.revision !== expectedRevision) throw fail('另一台设备更新了清单。', 'CONFLICT');
        } catch (check) { if (check.code === 'CONFLICT') throw check; throw fail('保存结果尚未确认，请确认上次保存。', 'UNCERTAIN'); }
        if (error.code === 'NETWORK') throw fail('保存结果尚未确认，请确认上次保存。', 'UNCERTAIN');
        throw error;
      }
      return { state: clean, revision: commit.sha, updatedAt: envelope.updatedAt };
    },
    async previous() {
      const latest = await head();
      const commit = await api(base + '/git/commits/' + latest);
      return commit.parents?.[0] ? readAt(commit.parents[0].sha) : { state: null, revision: 0 };
    },
    async photoUrl(key) {
      if (urls.has(key)) return urls.get(key);
      const version = epoch, { bytes, type } = await photoData(key); guard(version);
      const url = URL.createObjectURL(new Blob([bytes], { type })); urls.set(key, url); return url;
    },
    async exportState(state) {
      const result = validateState(state);
      for (const item of result.items) if (item.photoKey) {
        const { bytes, type } = await photoData(item.photoKey);
        let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
        item.photo = 'data:' + type + ';base64,' + btoa(binary); item.photoKey = null;
      }
      return result;
    },
  };
  return client;
}
