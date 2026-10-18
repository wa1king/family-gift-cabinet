import { TAG_GROUPS, createDemoState, filterItems, giveItem, undoGift, validateState, upsertItem } from './model.js';

const KEY = 'little-gift-cabinet-v1';
const BACKUP_KEY = KEY + '-before-import';
const $ = (selector, root = document) => root.querySelector(selector);
const main = $('#main');
const sheet = $('#sheet');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => ({ pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/></svg>', search:'<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>' })[name] || '';
const arts = ['magnet-travel','magnet-city','magnet-flower','toy-green','toy-pink','toy-cocoa'];
const artFor = item => item.photo || `./assets/${arts.includes(item.art) ? item.art : item.category === '拉布布' ? 'toy-green' : 'magnet-travel'}.svg`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let state, storageError = '', lastStored = null, pendingImport = null, editorDraft = null, editorBase = null;
let view = 'pick';
let filters = { search:'', category:'', tags:{ interest:[], occasion:[], value:[] }, includeEmpty:false };
let cabinetSearch = '', cabinetCategory = '', includeEmpty = false;
let toastTimer;
let photoRequest = 0;
let pendingReset = '';

try {
  lastStored = localStorage.getItem(KEY);
  state = lastStored ? validateState(JSON.parse(lastStored)) : createDemoState();
} catch {
  state = createDemoState();
  storageError = '本机保存的数据暂时无法读取。为保护原数据，已暂停日常保存；可在右上角先导出原始数据，再导入有效备份恢复。当前仅展示示例。';
}

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
}

function save(next, { backup = false, allowRecovery = false } = {}) {
  if (storageError && !allowRecovery) throw new Error('请先导出原始数据，再从右上角导入有效备份恢复；原数据没有被覆盖。');
  const clean = validateState(next);
  const serialized = JSON.stringify(clean);
  let raw, previousBackup;
  try {
    raw = localStorage.getItem(KEY);
    if (backup) previousBackup = localStorage.getItem(BACKUP_KEY);
  } catch { throw new Error('本机存储暂时不可用，此次修改尚未保存。请先导出备份。'); }
  if (raw !== lastStored) throw new Error('另一个窗口更新了清单，请关闭当前窗口后重新打开再试。');
  let backupWritten = false;
  try {
    if (backup) {
      // Preserve the exact original bytes, including unreadable data, before replacement.
      localStorage.setItem(BACKUP_KEY, raw === null ? JSON.stringify(state) : raw);
      backupWritten = true;
    }
    localStorage.setItem(KEY, serialized);
  } catch {
    let rollbackFailed = false;
    if (backupWritten) {
      try {
        if (previousBackup === null) localStorage.removeItem(BACKUP_KEY);
        else localStorage.setItem(BACKUP_KEY, previousBackup);
      } catch { rollbackFailed = true; }
    }
    throw new Error(rollbackFailed
      ? '此次清单修改尚未保存，但恢复原备份时遇到问题。请先导出当前清单和导入前的数据。'
      : '本机存储空间不足或不可用，请先导出备份，或减少照片后重试。此次修改尚未保存。');
  }
  lastStored = serialized; state = clean; storageError = ''; render();
}

function selectedCount() { return TAG_GROUPS.reduce((n,g) => n + filters.tags[g.id].length, 0); }
function availableTags(group) { return [...new Set([...group.options, ...state.items.flatMap(i => i.tags[group.id] || []), ...(editorDraft?.tags[group.id] || [])])]; }
function chip(group, value, active, context = 'filter') {
  return `<button type="button" class="chip${active ? ' selected' : ''}" data-action="${context}-tag" data-group="${group}" data-tag="${esc(value)}" aria-pressed="${active}">${esc(value)}</button>`;
}
function cards(items) {
  return `<div class="gift-grid">${items.map(i => `<article class="gift-card"><button class="card-hit" data-action="detail" data-id="${esc(i.id)}" aria-label="查看${esc(i.name)}，剩余${i.quantity}${esc(i.unit)}"><div class="card-art"><img src="${esc(artFor(i))}" alt="${esc(i.name)}${i.photo ? '' : '示意插画'}" loading="lazy"><span class="quantity-badge">${i.quantity ? `${i.quantity} ${esc(i.unit)}` : '已送完'}</span></div><div class="card-content"><h3>${esc(i.name)}</h3><p class="card-location">${icon('pin')}${esc(i.location || '未填写位置')}</p><div class="card-tags">${[...(i.tags.interest || []),...(i.tags.occasion || [])].slice(0,2).map(t=>`<span class="mini-tag">${esc(t)}</span>`).join('')}</div></div></button></article>`).join('')}</div>`;
}

function empty(title, description, action, label) {
  return `<div class="empty-state"><div class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9H7.5a3 3 0 1 1 3-3L12 9Zm0 0h4.5a3 3 0 1 0-3-3L12 9Z"/></svg></div><h3>${title}</h3><p>${description}</p><button class="primary" data-action="${action}">${label}</button></div>`;
}
const notice = () => '<p class="demo-notice">示例物品 · 数据仅保存在当前设备</p>';
function picker() {
  const matches = filterItems(state.items,filters);
  return `<section class="intro"><h1>挑礼物</h1><p>按朋友的喜好和场合筛选</p></section>
    <section class="filter-panel" aria-label="按标签挑选礼物"><div class="section-heading"><h2>筛选标签</h2><span class="micro">可多选</span></div>${TAG_GROUPS.map(g => `<div class="filter-group"><div class="group-label">${esc(g.id==='value'?'分量':g.label)}</div><div class="chips">${availableTags(g).map(t=>chip(g.id,t,filters.tags[g.id].includes(t))).join('')}</div></div>`).join('')}<div class="filter-footer"><span class="filter-help">同组任选其一，不同组同时满足</span><button class="text-button" data-action="clear-filters">清空 · 看全部</button></div></section>
    <div class="result-heading"><h2>${selectedCount() ? '筛选结果' : '可送礼物'}<span class="count">${matches.length} 款</span></h2></div>
    ${matches.length ? cards(matches) : empty('没有符合条件的物品','可以取消部分标签，或清空筛选查看全部。','clear-filters','查看全部物品')}${notice()}`;
}

function cabinet() {
  const matches = filterItems(state.items,{ search:cabinetSearch, category:cabinetCategory, includeEmpty });
  const total = state.items.reduce((n,i)=>n+i.quantity,0);
  return `<section class="view-intro"><h1>礼物柜</h1><p>管理可送物品和剩余数量</p><div class="stats-bar"><div class="stat"><b>${state.items.filter(i=>i.quantity>0).length}</b><span>款可送物品</span></div><div class="stat"><b>${total}</b><span>件物品待送出</span></div><div class="stat"><b>${state.history.reduce((n,h)=>n+h.quantity,0)}</b><span>件已送出</span></div></div></section><label class="search-box" style="display:block">${icon('search')}<input type="search" id="cabinet-search" value="${esc(cabinetSearch)}" placeholder="找名称、款式或存放位置" aria-label="搜索物品"></label><div class="category-row" aria-label="按物品类别筛选">${['','冰箱贴','拉布布','其他'].map(c=>`<button class="chip${cabinetCategory===c?' selected':''}" data-action="category" data-category="${c}" aria-pressed="${cabinetCategory===c}">${c || '全部类别'}</button>`).join('')}</div><label class="check-row"><input type="checkbox" id="include-empty" ${includeEmpty?'checked':''}>也看看已经送完的物品</label><div id="cabinet-results">${cabinetResults(matches)}</div>${notice()}`;
}
function cabinetResults(matches) {
  return `<div class="result-heading"><h2>物品<span class="count">${matches.length} 款</span></h2><span class="saved-indicator">仅本机保存</span></div>${matches.length ? cards(matches) : empty('这里暂时没有物品','可以换个关键词，<br>或者先收录一件家里的小心意。','add','收录一件物品')}`;
}
function history() {
  return `<section class="view-intro"><h1>送出记录</h1><p>查看收礼人、日期和数量</p></section>${state.history.length ? `<div class="history-list">${[...state.history].reverse().map(h=>{const i=state.items.find(i=>i.id===h.itemId);return `<article class="history-card"><img src="${esc(artFor(i || {}))}" alt="${esc(h.itemName)}"><div class="record"><h3>${esc(h.itemName)} × ${h.quantity}</h3><p>送给 ${esc(h.recipient)}${h.note?`<br><span class="record-note">${esc(h.note)}</span>`:''}</p><div class="record-footer"><time datetime="${esc(h.date)}">${esc(h.date)}</time><button class="text-button" data-action="undo" data-id="${esc(h.id)}">撤销，放回柜子</button></div></div></article>`;}).join('')}</div>` : empty('还没有送出记录','在物品详情中记录送出后，会显示在这里。','go-pick','挑礼物')}`;
}
function render() {
  main.innerHTML = (storageError ? `<div class="page-error">${esc(storageError)}</div>`:'') + (view==='pick' ? picker() : view==='cabinet' ? cabinet() : history());
  document.querySelectorAll('[data-view]').forEach(b=>{ const on = b.dataset.view===view; b.classList.toggle('active',on); if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current'); });
}
function openSheet(title, body, { formId = '', saveId = '' } = {}) {
  const header = formId
    ? `<div class="sheet-head form-head"><button type="button" class="sheet-cancel" data-action="close">取消</button><h2 id="sheet-title">${esc(title)}</h2><button type="submit" class="sheet-save" form="${formId}"${saveId?` id="${saveId}"`:''}>保存</button></div>`
    : `<div class="sheet-head"><h2 id="sheet-title">${esc(title)}</h2><button class="close-button" data-action="close" aria-label="关闭">×</button></div>`;
  $('#sheet-content').innerHTML = `${header}<div class="sheet-body">${body}</div>`;
  if(!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
}
function clearSheetState() { editorDraft=null; editorBase=null; pendingImport=null; pendingReset=''; photoRequest+=1; }
function closeSheet() { sheet.close(); clearSheetState(); }
function fieldError(message) { const el = $('#form-error',sheet); if(el){el.textContent=message;el.classList.add('visible');el.scrollIntoView({block:'nearest'});}else toast(message); }
function detail(id) {
  const i = state.items.find(i=>i.id===id); if(!i)return;
  editorDraft=null;
  openSheet('物品详情',`<img class="detail-image" src="${esc(artFor(i))}" alt="${esc(i.name)}${i.photo?'':'示意插画'}"><p class="detail-category">${esc(i.category)}${i.photo?'':' · 示例插画'}</p><h3 class="detail-name">${esc(i.name)}</h3><dl class="detail-meta"><div><dt>剩余数量</dt><dd>${i.quantity} ${esc(i.unit)}</dd></div><div><dt>放在哪里</dt><dd>${esc(i.location || '未填写')}</dd></div><div><dt>包装状态</dt><dd>${esc(i.condition || '未填写')}</dd></div><div><dt>心意分量</dt><dd>${esc(i.tags.value.join('、') || '未填写')}</dd></div></dl>${TAG_GROUPS.filter(g=>g.id!=='value').map(g=>`<div class="detail-group"><h3>${esc(g.label)}</h3><div class="chips">${i.tags[g.id].length?i.tags[g.id].map(t=>`<span class="chip">${esc(t)}</span>`).join(''):'<span class="micro">还没加标签</span>'}</div></div>`).join('')}${i.notes?`<div class="detail-group"><h3>备注</h3><p>${esc(i.notes)}</p></div>`:''}<div class="button-row"><button class="secondary" data-action="edit" data-id="${esc(i.id)}">编辑物品</button><button class="primary" data-action="give" data-id="${esc(i.id)}" ${i.quantity===0?'disabled':''}>${i.quantity===0?'已经送完':'记录送出'}</button></div>`);
}
function tagEditor(group) {
  return `<div class="form-tags" data-tag-editor="${group.id}"><span class="form-group-title">${esc(group.label)}</span><div class="chips" id="editor-tags-${group.id}">${availableTags(group).map(t=>chip(group.id,t,editorDraft.tags[group.id].includes(t),'editor')).join('')}</div><div class="custom-tag"><input id="custom-${group.id}" maxlength="24" placeholder="写一个自己的标签" aria-label="添加${esc(group.label)}标签"><button type="button" data-action="custom-tag" data-group="${group.id}">添加</button></div></div>`;
}
function photoPicker(item) {
  return `<div class="photo-uploader"><img id="photo-preview" class="photo-thumb" src="${esc(artFor(item))}" alt="物品照片预览"><div class="photo-copy"><p class="photo-title">${item.photo?'更换物品照片':'添加物品照片'}</p><p id="photo-status" role="status" aria-live="polite">可拍照或从相册选择</p></div><div class="photo-actions" role="group" aria-label="选择照片来源"><button type="button" class="photo-source" data-action="photo-camera" aria-controls="item-photo-camera"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 5 6 8H3v12h18V8h-3l-2-3Z"/><circle cx="12" cy="13" r="3.5"/></svg><span>拍照</span></button><button type="button" class="photo-source" data-action="photo-album" aria-controls="item-photo-album"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg><span>从相册选择</span></button></div><input type="file" id="item-photo-camera" accept="image/*" capture="environment" hidden tabindex="-1"><input type="file" id="item-photo-album" accept="image/*" hidden tabindex="-1"></div>`;
}
function editItem(id) {
  const existing = state.items.find(i=>i.id===id);
  editorDraft = existing ? structuredClone(existing) : {id:uid(),name:'',category:'冰箱贴',quantity:1,unit:'个',location:'',condition:'',notes:'',photo:null,art:'magnet-travel',tags:{interest:[],occasion:[],value:[]},createdAt:new Date().toISOString()};
  editorBase = existing ? JSON.stringify(existing) : null;
  const i=editorDraft;
  openSheet(existing?'编辑物品':'添加物品',`<form id="item-form"><div id="form-error" class="inline-error" role="alert"></div>${photoPicker(i)}<label class="field"><span>名称 *</span><input name="name" value="${esc(i.name)}" placeholder="例如：旅行带回的海边冰箱贴" maxlength="80" required></label><label class="field"><span>物品类别</span><select name="category">${['冰箱贴','拉布布','其他'].map(c=>`<option ${i.category===c?'selected':''}>${c}</option>`).join('')}</select></label><div class="form-columns"><label class="field"><span>可送数量 *</span><input type="number" inputmode="numeric" min="0" max="9999" step="1" name="quantity" value="${i.quantity}" required></label><label class="field"><span>单位</span><input name="unit" maxlength="10" value="${esc(i.unit)}" placeholder="个 / 盒 / 套" required></label></div><label class="field"><span>存放位置</span><input name="location" maxlength="80" value="${esc(i.location)}" placeholder="例如：书房柜子第二层"></label><label class="field"><span>包装状态</span><input name="condition" maxlength="60" value="${esc(i.condition)}" placeholder="例如：未拆封 / 只有本体"></label>${TAG_GROUPS.map(tagEditor).join('')}<label class="field"><span>备注</span><textarea name="notes" maxlength="800" placeholder="款式、来源，或者其他需要记住的事">${esc(i.notes)}</textarea></label></form>`, {formId:'item-form',saveId:'save-item'});
}
function giveForm(id) {
  const i=state.items.find(i=>i.id===id); if(!i || i.quantity===0)return;
  editorDraft=null;
  openSheet('记录送出',`<form id="give-form" data-id="${esc(i.id)}"><div id="form-error" class="inline-error" role="alert"></div><div class="gift-summary"><img src="${esc(artFor(i))}" alt="${esc(i.name)}"><div><h3>${esc(i.name)}</h3><p>柜子里还剩 ${i.quantity} ${esc(i.unit)}</p></div></div><label class="field"><span>收礼人 *</span><input name="recipient" maxlength="60" placeholder="写个名字或称呼就好" required></label><div class="form-columns"><label class="field"><span>送出数量 *</span><input type="number" inputmode="numeric" name="quantity" min="1" max="${i.quantity}" step="1" value="1" required></label><label class="field"><span>送出日期 *</span><input type="date" name="date" value="${today()}" required></label></div><label class="field"><span>备注</span><textarea name="note" maxlength="800" placeholder="例如：生日见面时带给她"></textarea></label><div class="tip-box">保存后会扣除送出的数量。记错了，可以在“送出记录”里撤销并放回柜子。</div></form>`, {formId:'give-form'});
}
function download(content,name) {
  const url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function settings() {
  editorDraft=null; pendingImport=null;
  let backupRaw=null, validBackup=false;
  try {
    backupRaw=localStorage.getItem(BACKUP_KEY);
    if(backupRaw!==null)try{validateState(JSON.parse(backupRaw));validBackup=true;}catch{}
  }catch{}
  const backupControls=backupRaw===null?'':validBackup
    ? '<button class="secondary full" data-action="restore">恢复上一次替换前的清单</button>'
    : '<div class="tip-box">导入前的原始数据已保留，但暂时无法直接读取。可以导出保存，之后再检查。<button class="secondary full" data-action="export-backup-raw">导出导入前的原始数据</button></div>';
  openSheet('设置与备份',`<div class="tip-box"><strong>试用版</strong><br>内置物品与图片都是示例；毛绒挂件图片为原创示意插画，并非商品实拍。</div><div class="settings-section"><h3>先筛选，再逛逛</h3><p>在“挑礼物”里选喜好、场合和心意分量。同一组内满足任一标签即可，不同组需同时满足。没找到合适的，点“清空 · 看全部”。物品标签可以在编辑时增删。</p></div><div class="settings-section"><h3>数据现在存在哪里？</h3><p>物品、照片和送出记录只保存在当前浏览器。两台安卓手机暂不同步。清理浏览器数据、更换设备或预览地址，都不会自动带走这份清单；可以先导出备份。</p></div><div class="settings-section"><h3>备份与迁移</h3><p>导出文件包含物品照片和送出记录。导入会替换当前清单，并保留导入前的数据供恢复。${storageError?'当前原始数据暂时无法读取；请先导出保存，再导入有效备份恢复。':''}</p><div class="button-row"><button class="primary" data-action="export">导出备份</button>${storageError?'<button class="secondary" data-action="export-raw">导出原始数据</button>':''}</div><label class="field" style="margin-top:14px"><span>选择备份文件导入</span><input type="file" id="import-file" accept=".json,application/json"></label>${backupControls}</div><div class="settings-section"><h3>接下来的完整版本</h3><p>重点是两个人共用一份清单、同步照片与数量、避免重复送出。是否需要朋友喜好档案，等实际试用后再决定。</p></div>`);
  $('.sheet-body',sheet).insertAdjacentHTML('beforeend','<div class="settings-section"><h3>准备好试一试？</h3><p>可以从空柜子收录自己的物品，也可以重新载入示例。替换前会自动保留当前清单。</p><div class="button-row"><button class="secondary" data-action="start-empty">从空柜子开始</button><button class="secondary" data-action="reload-demo">重新载入示例</button></div></div>');
}
function resetConfirmation(mode) {
  pendingReset=mode;
  openSheet(mode==='empty'?'从自己的礼物开始':'重新看看示例',`<div id="form-error" class="inline-error" role="alert"></div><div class="tip-box">${mode==='empty'?'将创建一个空的礼物柜，方便收录你们自己的物品。':'将重新载入最初的 8 款示例物品。'}当前清单会保留为上一次备份，可在右上角恢复；更早的替换备份会被更新。</div><div class="button-row"><button class="secondary" data-action="settings">先不替换</button><button class="primary" data-action="confirm-reset">确认${mode==='empty'?'创建空柜子':'载入示例'}</button></div>`);
}
function confirmImport(imported) {
  pendingImport=imported;
  const replacement=storageError
    ? '当前本机数据无法读取。确认后，将用这份有效备份替换原损坏数据；原始内容会原样留存，可在“设置与备份”里导出，不会被示例数据替代。'
    : `导入后会替换当前的 ${state.items.length} 款物品和 ${state.history.length} 条记录。当前数据会先留存一份，可在“设置与备份”里恢复。`;
  openSheet('导入前确认一下',`<div id="form-error" class="inline-error" role="alert"></div><div class="import-summary">这份备份里有 ${imported.items.length} 款物品、${imported.history.length} 条送出记录。</div><div class="settings-section"><p>${replacement}</p></div><div class="button-row"><button class="secondary" data-action="settings">先不导入</button><button class="primary" data-action="confirm-import">${storageError?'确认替换并恢复':'确认导入'}</button></div>`);
}

document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.view){view=b.dataset.view;render();window.scrollTo({top:0,behavior:'instant'});return;}
  const action=b.dataset.action;if(!action)return;
  try {
    if(action==='filter-tag') {const list=filters.tags[b.dataset.group];const at=list.indexOf(b.dataset.tag);at<0?list.push(b.dataset.tag):list.splice(at,1);render();}
    if(action==='clear-filters'){filters={search:'',category:'',tags:{interest:[],occasion:[],value:[]},includeEmpty:false};view='pick';render();toast('已清空筛选，看看所有可送物品');}
    if(action==='detail')detail(b.dataset.id);
    if(action==='edit')editItem(b.dataset.id);
    if(action==='add')editItem();
    if(action==='give')giveForm(b.dataset.id);
    if(action==='photo-camera' || action==='photo-album'){
      const input=$(action==='photo-camera'?'#item-photo-camera':'#item-photo-album',sheet);
      if(input && editorDraft){input.value='';input.click();}
    }
    if(action==='close')closeSheet();
    if(action==='category'){cabinetCategory=b.dataset.category;render();}
    if(action==='go-pick'){view='pick';render();window.scrollTo({top:0,behavior:'instant'});}
    if(action==='settings')settings();
    if(action==='start-empty')resetConfirmation('empty');
    if(action==='reload-demo')resetConfirmation('demo');
    if(action==='confirm-reset'){
      if(!pendingReset)return;
      const next=pendingReset==='empty'?{schemaVersion:1,items:[],history:[]}:createDemoState();
      filters={search:'',category:'',tags:{interest:[],occasion:[],value:[]},includeEmpty:false};cabinetSearch='';cabinetCategory='';view='pick';
      save(next,{backup:true,allowRecovery:true});closeSheet();window.scrollTo({top:0,behavior:'instant'});toast('礼物柜已就绪，原清单可以在右上角恢复');
    }
    if(action==='editor-tag') {const list=editorDraft.tags[b.dataset.group];const at=list.indexOf(b.dataset.tag);at<0?list.push(b.dataset.tag):list.splice(at,1);refreshTagGroup(b.dataset.group);}
    if(action==='custom-tag')addCustomTag(b.dataset.group);
    if(action==='undo'){save(undoGift(state,b.dataset.id));toast('已撤销这次送出，数量已放回柜子');}
    if(action==='export'){download(JSON.stringify(state,null,2),`小心意-礼物柜备份-${today()}.json`);toast('备份已导出，照片和送出记录也在里面');}
    if(action==='export-raw'){download(lastStored || '',`小心意-原始数据-${today()}.json`);}
    if(action==='export-backup-raw'){
      const raw=localStorage.getItem(BACKUP_KEY);if(raw===null)throw new Error('导入前的数据已不存在。');
      download(raw,`小心意-导入前原始数据-${today()}.json`);
    }
    if(action==='confirm-import'){
      if(!pendingImport)return;
      save(pendingImport,{backup:true,allowRecovery:true});closeSheet();toast('清单已导入，原始数据已留存备份');
    }
    if(action==='restore'){
      const backup=validateState(JSON.parse(localStorage.getItem(BACKUP_KEY)));
      save(backup,{backup:true,allowRecovery:true});settings();toast('已恢复，原来的本机数据已留存备份');
    }
  }catch(error){fieldError(error.message || '操作没有完成，请稍后再试。');}
});
function refreshTagGroup(id){ const group=TAG_GROUPS.find(g=>g.id===id);$(`#editor-tags-${id}`).innerHTML=availableTags(group).map(t=>chip(id,t,editorDraft.tags[id].includes(t),'editor')).join(''); }
function addCustomTag(id){const input=$(`#custom-${id}`);const value=input.value.trim();if(!value)return;if(editorDraft.tags[id].length>=30){fieldError('每组最多保留 30 个标签。');return;}if(!editorDraft.tags[id].includes(value))editorDraft.tags[id].push(value);input.value='';refreshTagGroup(id);}
document.addEventListener('input',event=>{if(event.target.id==='cabinet-search'){cabinetSearch=event.target.value;$('#cabinet-results').innerHTML=cabinetResults(filterItems(state.items,{search:cabinetSearch,category:cabinetCategory,includeEmpty}));}});
document.addEventListener('keydown',event=>{if(event.key==='Enter' && event.target.id.startsWith('custom-')){event.preventDefault();addCustomTag(event.target.id.replace('custom-',''));}});
document.addEventListener('change',async event=>{
  if(event.target.id==='include-empty'){includeEmpty=event.target.checked;render();}
  if(event.target.name==='category' && editorDraft && !editorBase){editorDraft.art=event.target.value==='拉布布'?'toy-green':'magnet-travel';if(!editorDraft.photo)$('#photo-preview').src=artFor(editorDraft);}
  if(event.target.id==='item-photo-camera' || event.target.id==='item-photo-album'){
    const input=event.target;const file=input.files[0];const button=$('#save-item');
    if(!file || !button || !editorDraft || !sheet.open)return;
    const request=++photoRequest;const draftRef=editorDraft;
    const active=()=>request===photoRequest && editorDraft===draftRef && sheet.open && input.isConnected && button.isConnected;
    button.disabled=true;
    $('#photo-status',sheet).textContent='正在准备照片…';
    $('#form-error',sheet).classList.remove('visible');
    try{
      if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('请选择 JPG、PNG 或 WebP 照片。');
      if(file.size>20*1024*1024)throw new Error('这张照片超过 20MB，请选一张小一点的。');
      const photo=await compressPhoto(file);
      if(!active())return;
      editorDraft.photo=photo;$('#photo-preview').src=photo;$('#photo-status',sheet).textContent='照片已选好，可以继续填写';toast('照片已选好');
    }catch(error){if(active()){$('#photo-status',sheet).textContent='这张照片没有选好，请重试';fieldError(error.message);}}finally{if(active())button.disabled=false;}
  }
  if(event.target.id==='import-file'){
    const input=event.target;const file=input.files[0];if(!file)return;
    const active=()=>sheet.open && input.isConnected && input.files[0]===file;
    try{
      if(file.size>40*1024*1024)throw new Error('备份文件超过 40MB，暂不支持导入。');
      const text=await file.text();if(!active())return;
      confirmImport(validateState(JSON.parse(text)));
    }catch(error){if(active()){toast(`未导入：${error instanceof SyntaxError?'这不是有效的备份文件':error.message}`);input.value='';}}
  }
});
async function compressPhoto(file){
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;await image.decode();
    const scale=Math.min(1,1000/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d');context.fillStyle='#f8f6f0';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    const result=canvas.toDataURL('image/jpeg',.8);if(result.length>1600000)throw new Error('照片压缩后仍然较大，请换一张试试。');return result;
  }catch(error){throw new Error(error.message?.includes('压缩')?error.message:'照片读取失败，请换一张照片。');}finally{URL.revokeObjectURL(url);}
}
document.addEventListener('submit',event=>{
  if(!['item-form','give-form'].includes(event.target.id))return;
  event.preventDefault();
  try{
    const form=event.target;const values=Object.fromEntries(new FormData(form));
    if(form.id==='item-form'){
      if($('#save-item').disabled)return;
      const current=state.items.find(i=>i.id===editorDraft.id);
      if(editorBase && JSON.stringify(current)!==editorBase)throw new Error('这个物品已在另一个窗口修改，请重新打开后编辑。');
      const item={...editorDraft,...values,quantity:Number(values.quantity)};
      save(upsertItem(state,item));closeSheet();toast('物品已保存');
    }else{
      save(giveItem(state,{itemId:form.dataset.id,quantity:Number(values.quantity),recipient:values.recipient,note:values.note,date:values.date}));
      closeSheet();toast('已记录送出，数量已更新');
    }
  }catch(error){fieldError(error.message || '保存没有完成，请检查填写内容。');}
});
$('.brand').addEventListener('click',event=>{event.preventDefault();view='pick';render();window.scrollTo({top:0,behavior:'instant'});});
sheet.addEventListener('click',event=>{if(event.target===sheet){const rect=sheet.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeSheet();}});
sheet.addEventListener('close',()=>{if(!sheet.open)clearSheetState();});
window.addEventListener('storage',event=>{
  if(event.key!==KEY)return;
  try{const updated=event.newValue?validateState(JSON.parse(event.newValue)):createDemoState();state=updated;lastStored=event.newValue;storageError='';render();toast('同一设备的另一个窗口更新了清单');}
  catch{lastStored=event.newValue;storageError='其他窗口保存的数据暂时无法读取，已暂停日常保存。请先导出原始数据，再导入有效备份恢复。';render();toast('本机数据暂时无法读取，请先导出原始数据。');}
});
render();
