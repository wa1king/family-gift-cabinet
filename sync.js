import { validateState } from './model.js?v=20261026-github';

export class SyncStore {
  constructor(client, onChange = () => {}) {
    this.client = client;
    this.onChange = onChange;
    this.ready = false;
    this.loading = false;
    this.busy = false;
    this.revision = 0;
    this.state = null;
    this.error = '';
    this.pending = null;
    this.lastSynced = null;
    this.reading = false;
    this.generation = 0;
  }
  get enabled() { return this.client.configured; }
  get session() { return this.client.session; }
  emit() { this.onChange(this); }
  accept(result) {
    this.state = result.state ? validateState(result.state) : null;
    this.revision = result.revision;
    this.ready = Boolean(result.state);
    this.lastSynced = new Date();
    this.error = '';
  }
  async start() {
    if (!this.enabled || this.busy || this.loading) return;
    this.loading = true; this.emit();
    try {
      await this.client.restoreSession();
      if (this.session) this.accept(await this.client.load());
    } catch (error) { this.error = error.message || '云端暂时无法连接，请稍后重试。'; }
    finally { this.loading = false; this.emit(); }
  }
  async signIn(email, password) {
    this.loading = true; this.error = ''; this.emit();
    try {
      await this.client.signIn(email, password);
      this.accept(await this.client.load());
    } catch (error) {
      this.error = error.message || '连接没有完成，请重试。';
      throw error;
    } finally { this.loading = false; this.emit(); }
  }
  async signUp(email, password, redirectTo) {
    this.loading = true; this.error = ''; this.emit();
    try {
      const result = await this.client.signUp(email, password, { redirectTo });
      if (result.session) this.accept(await this.client.load());
      return result;
    } finally { this.loading = false; this.emit(); }
  }
  async signOut() {
    if (this.busy) throw new Error('请等待这次保存完成。');
    this.generation++;
    await this.client.signOut();
    this.state = null; this.ready = false; this.pending = null;
    this.revision = 0; this.error = ''; this.lastSynced = null;
    this.emit();
  }
  async pull(force = false) {
    if (!this.session || this.busy || this.loading || this.reading || this.pending) return;
    this.reading = true;
    const generation = this.generation;
    try {
      if (force || !this.ready || await this.client.checkRevision() !== this.revision) {
        const result = await this.client.load();
        if (generation === this.generation && !this.busy && !this.pending) { this.accept(result); this.emit(); }
      } else if (this.error && !this.pending) {
        this.error = ''; this.lastSynced = new Date(); this.emit();
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = error.code === 'AUTH_REQUIRED' ? '登录已过期，请重新登录。' : '暂时连不上云端，修改尚未上传。';
      this.emit();
      throw error;
    } finally { this.reading = false; }
  }
  async initialize(state) {
    if (!this.session) throw new Error('请先登录家庭账号。');
    if (this.busy) throw new Error('正在保存，请稍候。');
    const current = await this.client.load();
    if (current.state) {
      this.accept(current); this.emit();
      throw new Error('另一台设备已经创建了清单，已打开云端内容，没有覆盖。');
    }
    return this.save(state, { expectedRevision: 0, initializing: true });
  }
  async save(state, { expectedRevision = this.revision, initializing = false } = {}) {
    if (!this.session || (!this.ready && !initializing)) throw new Error('请先连接家庭礼物柜。');
    if (this.busy) throw new Error('正在保存，请稍候。');
    if (this.pending) throw new Error('上次保存结果还未确认，请先点“确认上次保存”。');
    const request = {
      state: validateState(state),
      expectedRevision,
      operationId: globalThis.crypto.randomUUID(),
    };
    return this.commit(request);
  }
  async retryPending() {
    if (!this.pending) return;
    if (this.busy) throw new Error('正在确认，请稍候。');
    return this.commit(this.pending);
  }
  async commit(request) {
    this.generation++;
    this.busy = true; this.error = ''; this.emit();
    try {
      const result = await this.client.save(request.state, request.expectedRevision, { operationId: request.operationId });
      this.accept(result); this.pending = null;
      return this.state;
    } catch (error) {
      if (error.code === 'UNCERTAIN') {
        this.pending = request;
        this.error = '保存结果尚未确认，请确认上次保存，避免重复操作。';
      } else {
        this.pending = null;
        if (error.code === 'CONFLICT') {
          try { this.accept(await this.client.load()); } catch {}
          this.error = '另一台设备更新了清单。填写内容已保留，请重新打开物品核对后再保存。';
        } else {
          this.error = error.code === 'AUTH_REQUIRED' ? '登录已过期，请重新登录。' : (error.message || '保存没有完成，请稍后重试。');
        }
      }
      const failure = new Error(this.error); failure.code = error.code;
      throw failure;
    } finally { this.busy = false; this.emit(); }
  }
}
