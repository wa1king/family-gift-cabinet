import { TAG_GROUPS, createDemoState, filterItems, giveItem, undoGift, validateState, upsertItem, addTag, renameTag, removeTag, addCategory } from './model.js?v=20261018-mobile';

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
let state, storageError = '', lastStored = null, pendingImport = null, editorDraft = null, editorBase = null, editorCatalogBase = null;
let view = 'cabinet';
const emptyTags = () => Object.fromEntries(TAG_GROUPS.map(g=>[g.id,[]]));
const emptyFilters = () => ({ search:'', category:'', tags:emptyTags(), includeEmpty:false });
let filters = emptyFilters();
let activeFilter = '', editorCategories = [];
let toastTimer;
let photoRequest = 0;
let pendingReset = '';
let tagUndo = null;

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
  lastStored = serialized; state = clean; storageError = '';
  render();
}

function selectedCount() { return TAG_GROUPS.reduce((n,g) => n + filters.tags[g.id].length, 0); }
function availableTags(group) { return [...new Set([...state.tagCatalog[group.id], ...(editorDraft?.tags[group.id] || [])])]; }
function chip(group, value, active, context = 'filter') {
  return `<button type="button" class="chip${active ? ' selected' : ''}" data-action="${context}-tag" data-group="${group}" data-tag="${esc(value)}" aria-pressed="${active}">${esc(value)}</button>`;
}
function cards(items) {
  return `<div class="gift-grid">${items.map(i => `<article class="gift-card"><button class="card-hit" data-action="detail" data-id="${esc(i.id)}" aria-label="查看${esc(i.name)}，剩余${i.quantity}"><div class="card-art"><img src="${esc(artFor(i))}" alt="${esc(i.name)}${i.photo ? '' : '示意插画'}" loading="lazy"><span class="quantity-badge">${i.quantity ? `${i.quantity}` : '已送完'}</span></div><div class="card-content"><h3>${esc(i.name)}</h3><p class="card-location">${icon('pin')}${esc(i.location || '未填写位置')}</p><div class="card-tags">${TAG_GROUPS.flatMap(g=>i.tags[g.id]).slice(0,2).map(t=>`<span class="mini-tag">${esc(t)}</span>`).join('')}</div></div></button></article>`).join('')}</div>`;
}

function empty(title, description, action, label) {
  return `<div class="empty-state"><div class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9H7.5a3 3 0 1 1 3-3L12 9Zm0 0h4.5a3 3 0 1 0-3-3L12 9Z"/></svg></div><h3>${title}</h3><p>${description}</p><button class="primary" data-action="${action}">${label}</button></div>`;
}
const notice = () => '<p class="demo-notice">示例物品 · 数据仅保存在当前设备</p>';
const chevron = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
function hasFilters() { return Boolean(filters.search || filters.category || selectedCount() || filters.includeEmpty); }
function filteredItems() { return filterItems(state.items,filters); }
function resultCount(matches) { return filters.includeEmpty ? matches.length+' 款物品' : matches.length+' 款可送'; }
function cabinet() {
  const matches=filteredItems();
  return `<section class="cabinet-heading"><h1>礼物柜</h1><span class="micro" id="result-count">${resultCount(matches)}</span><button class="text-button" id="clear-all" data-action="clear-filters" ${hasFilters()?'':'hidden'}>清空</button></section>
    <label class="cabinet-search">${icon('search')}<input type="search" id="cabinet-search" value="${esc(filters.search)}" placeholder="搜索物品" aria-label="搜索物品"></label>
    <div class="filter-bar" aria-label="筛选礼物"><button class="filter-trigger${filters.category || filters.includeEmpty?' is-active':''}" data-action="open-category-filter" aria-label="物品类别筛选，当前${esc(filters.category || '全部类别')}" aria-expanded="${activeFilter==='category'}"><span>${esc(filters.category || '类别')}</span>${chevron}</button>${TAG_GROUPS.map(g=>`<button class="filter-trigger${filters.tags[g.id].length?' is-active':''}" data-action="open-filter" data-group="${g.id}" aria-label="${esc(g.label)}筛选，${filters.tags[g.id].length?'已选'+filters.tags[g.id].length+'项':'不限'}" aria-expanded="${activeFilter===g.id}"><span>${esc(g.label)}</span>${filters.tags[g.id].length?`<small>${filters.tags[g.id].length}</small>`:''}${chevron}</button>`).join('')}</div>
    <div class="cabinet-results" id="cabinet-results">${cabinetResults(matches)}</div>${notice()}`;
}
function cabinetResults(matches) {
  return `${matches.length?cards(matches):hasFilters()?empty('没有符合条件的物品','试试调整筛选条件，或查看全部物品。','clear-filters','查看全部'):empty('礼物柜还是空的','把家里适合送人的物品收录进来。','add','添加物品')}`;
}
function openFilter(groupId) {
  const group=TAG_GROUPS.find(g=>g.id===groupId);if(!group)return;
  activeFilter=groupId;editorDraft=null;render();
  openSheet(group.label+'筛选',`<div class="filter-options chips">${state.tagCatalog[groupId].length?state.tagCatalog[groupId].map(t=>chip(groupId,t,filters.tags[groupId].includes(t))).join(''):'<p class="micro">还没有标签，可以在管理中添加。</p>'}</div><p class="filter-note">可多选，同组满足任意一项即可。</p><div class="filter-sheet-footer"><button class="text-button" data-action="clear-group-filter" data-group="${groupId}">不限${esc(group.label)}</button><button class="primary" data-action="close" id="filter-done">查看 ${filteredItems().length} 款</button></div><button class="text-button full" data-action="manage-tags">管理标签</button>`);
}
function openCategoryFilter() {
  activeFilter='category';editorDraft=null;render();
  openSheet('类别筛选',`<div class="category-options">${['',...state.categories].map(c=>`<button class="filter-category-option" data-action="category" data-category="${esc(c)}" aria-pressed="${filters.category===c}"><span>${esc(c || '全部类别')}</span><span aria-hidden="true">${filters.category===c?'✓':''}</span></button>`).join('')}</div><label class="inventory-toggle"><input type="checkbox" id="include-empty" ${filters.includeEmpty?'checked':''}>显示已送完的物品</label><button class="primary full" data-action="close">完成</button>`);
}
function history() {
  return `<section class="view-intro"><h1>送出记录</h1><p>查看收礼人、日期和数量</p></section>${state.history.length ? `<div class="history-list">${[...state.history].reverse().map(h=>{const i=state.items.find(i=>i.id===h.itemId);return `<article class="history-card"><img src="${esc(artFor(i || {}))}" alt="${esc(h.itemName)}"><div class="record"><h3>${esc(h.itemName)} × ${h.quantity}</h3><p>送给 ${esc(h.recipient)}${h.note?`<br><span class="record-note">${esc(h.note)}</span>`:''}</p><div class="record-footer"><time datetime="${esc(h.date)}">${esc(h.date)}</time><button class="text-button" data-action="undo" data-id="${esc(h.id)}">撤销，放回柜子</button></div></div></article>`;}).join('')}</div>` : empty('还没有送出记录','在物品详情中记录送出后，会显示在这里。','go-pick','查看礼物柜')}`;
}
function render() {
  TAG_GROUPS.forEach(g=>{filters.tags[g.id]=filters.tags[g.id].filter(t=>state.tagCatalog[g.id].includes(t));});
  main.innerHTML = (storageError ? `<div class="page-error">${esc(storageError)}</div>`:'') + (view==='cabinet' ? cabinet() : history());
  document.querySelectorAll('[data-view]').forEach(b=>{ const on = b.dataset.view===view; b.classList.toggle('active',on); if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current'); });
}
function openSheet(title, body, { formId = '', saveId = '', cancelAction = 'close' } = {}) {
  const header = formId
    ? `<div class="sheet-head form-head"><button type="button" class="sheet-cancel" data-action="${cancelAction}">取消</button><h2 id="sheet-title">${esc(title)}</h2><button type="submit" class="sheet-save" form="${formId}"${saveId?` id="${saveId}"`:''}>保存</button></div>`
    : `<div class="sheet-head"><h2 id="sheet-title">${esc(title)}</h2><button class="close-button" data-action="close" aria-label="关闭">×</button></div>`;
  $('#sheet-content').innerHTML = `${header}<div class="sheet-body">${body}</div>`;
  if(!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
}
function clearSheetState() { editorDraft=null; editorBase=null; editorCatalogBase=null; pendingImport=null; pendingReset=''; activeFilter=''; editorCategories=[]; photoRequest+=1; }
function closeSheet() { const filtering=Boolean(activeFilter);sheet.close();clearSheetState();if(filtering)render(); }
function fieldError(message) { const el = $('#form-error',sheet); if(el){el.textContent=message;el.classList.add('visible');el.scrollIntoView({block:'nearest'});}else toast(message); }
function detail(id) {
  const i = state.items.find(i=>i.id===id); if(!i)return;
  editorDraft=null;
  openSheet('物品详情',`<img class="detail-image" src="${esc(artFor(i))}" alt="${esc(i.name)}${i.photo?'':'示意插画'}"><p class="detail-category">${esc(i.category)}${i.photo?'':' · 示例插画'}</p><h3 class="detail-name">${esc(i.name)}</h3><dl class="detail-meta"><div><dt>剩余数量</dt><dd>${i.quantity}</dd></div><div><dt>放在哪里</dt><dd>${esc(i.location || '未填写')}</dd></div><div><dt>包装状态</dt><dd>${esc(i.condition || '未填写')}</dd></div><div><dt>价值</dt><dd>${esc(i.tags.value.join('、') || '未填写')}</dd></div></dl>${TAG_GROUPS.filter(g=>g.id!=='value').map(g=>`<div class="detail-group"><h3>${esc(g.label)}</h3><div class="chips">${i.tags[g.id].length?i.tags[g.id].map(t=>`<span class="chip">${esc(t)}</span>`).join(''):'<span class="micro">还没加标签</span>'}</div></div>`).join('')}${i.notes?`<div class="detail-group"><h3>备注</h3><p>${esc(i.notes)}</p></div>`:''}<div class="button-row"><button class="secondary" data-action="edit" data-id="${esc(i.id)}">编辑物品</button><button class="primary" data-action="give" data-id="${esc(i.id)}" ${i.quantity===0?'disabled':''}>${i.quantity===0?'已经送完':'记录送出'}</button></div>`);
}
function tagEditor(group) {
  return `<div class="form-tags" data-tag-editor="${group.id}"><div class="tag-group-head"><span class="form-group-title">${esc(group.label)}</span><button type="button" class="add-inline" data-action="show-inline" data-target="custom-row-${group.id}" aria-expanded="false">＋ 新增</button></div><div class="chips" id="editor-tags-${group.id}">${availableTags(group).map(t=>chip(group.id,t,editorDraft.tags[group.id].includes(t),'editor')).join('')}</div><div class="inline-create" id="custom-row-${group.id}" hidden><input id="custom-${group.id}" maxlength="40" placeholder="新标签名称" aria-label="添加${esc(group.label)}标签"><button type="button" class="add-inline" data-action="custom-tag" data-group="${group.id}">确认</button><button type="button" class="add-inline" data-action="hide-inline" data-target="custom-row-${group.id}">取消</button></div></div>`;
}
function tagUsage(group, tag) { return state.items.filter(item=>item.tags[group].includes(tag)).length; }
function manageTags() {
  editorDraft=null;activeFilter='';render();
  openSheet('管理标签',`<div id="form-error" class="inline-error" role="alert"></div><p class="tag-manager-help">改名会同步到所有物品；删除标签会同时从物品中移除。</p>${tagUndo?`<div class="tag-undo" role="status"><span>${esc(tagUndo.message)}</span><button class="text-button" data-action="undo-tag-change">撤销</button></div>`:''}${TAG_GROUPS.map(g=>`<section class="tag-manager-group" aria-label="管理${esc(g.label)}标签"><div class="tag-group-head"><h3>${esc(g.label)}</h3><button type="button" class="add-inline" data-action="show-inline" data-target="tag-add-${g.id}" aria-expanded="false">＋ 新增</button></div><div class="tag-list">${state.tagCatalog[g.id].length?state.tagCatalog[g.id].map(tag=>`<div class="tag-row"><div class="tag-row-copy"><span>${esc(tag)}</span><small>${tagUsage(g.id,tag)} 款物品</small></div><button class="text-button" data-action="rename-tag" data-group="${g.id}" data-tag="${esc(tag)}" aria-label="修改${esc(g.label)}标签：${esc(tag)}">修改</button><button class="text-button danger-text" data-action="delete-tag" data-group="${g.id}" data-tag="${esc(tag)}" aria-label="删除${esc(g.label)}标签：${esc(tag)}">删除</button></div>`).join(''):'<p class="tag-list-empty">还没有标签，点“新增”添加</p>'}</div><form class="tag-add-form" id="tag-add-${g.id}" data-group="${g.id}" hidden><input name="tag" maxlength="40" placeholder="新标签名称" aria-label="新增${esc(g.label)}标签" required><button class="add-inline" type="submit">确认</button><button class="add-inline" type="button" data-action="hide-inline" data-target="tag-add-${g.id}">取消</button></form></section>`).join('')}`);
}
function saveTagChange(next, message, {group, oldTag, newTag} = {}) {
  const before=state;
  const wasSelected=group && filters.tags[group].includes(oldTag);
  save(next);
  if(wasSelected && newTag){filters.tags[group].push(newTag);render();}
  tagUndo={before,after:JSON.stringify(state),message};
  manageTags();
}
function renameTagForm(group, tag) {
  const definition=TAG_GROUPS.find(g=>g.id===group);
  if(!definition || !state.tagCatalog[group].includes(tag))throw new Error('这个标签已经不存在，请重新打开管理标签。');
  openSheet('修改标签',`<form id="rename-tag-form" data-group="${group}" data-tag="${esc(tag)}"><div id="form-error" class="inline-error" role="alert"></div><label class="field"><span>${esc(definition.label)}标签</span><input name="tag" value="${esc(tag)}" maxlength="40" required></label><p class="tag-manager-help">保存后，${tagUsage(group,tag)} 款物品上的这个标签也会更新。</p></form>`,{formId:'rename-tag-form',cancelAction:'manage-tags'});
}
function deleteTagConfirmation(group, tag) {
  const definition=TAG_GROUPS.find(g=>g.id===group);
  if(!definition || !state.tagCatalog[group].includes(tag))throw new Error('这个标签已经不存在，请重新打开管理标签。');
  openSheet('删除标签',`<div id="form-error" class="inline-error" role="alert"></div><p class="tag-delete-title">删除“${esc(tag)}”？</p><p class="tag-manager-help">将从${esc(definition.label)}选项和 ${tagUsage(group,tag)} 款物品中移除这个标签。物品、照片、数量和送出记录都会保留。</p><div class="button-row"><button class="secondary" data-action="manage-tags">保留标签</button><button class="danger-button" data-action="confirm-delete-tag" data-group="${group}" data-tag="${esc(tag)}">删除标签</button></div>`);
}
function photoPicker(item) {
  return `<div class="photo-uploader"><img id="photo-preview" class="photo-thumb" src="${esc(artFor(item))}" alt="物品照片预览"><div class="photo-copy"><p class="photo-title">${item.photo?'更换物品照片':'添加物品照片'}</p><p id="photo-status" role="status" aria-live="polite">可拍照或从相册选择</p></div><div class="photo-actions" role="group" aria-label="选择照片来源"><button type="button" class="photo-source" data-action="photo-camera" aria-controls="item-photo-camera"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 5 6 8H3v12h18V8h-3l-2-3Z"/><circle cx="12" cy="13" r="3.5"/></svg><span>拍照</span></button><button type="button" class="photo-source" data-action="photo-album" aria-controls="item-photo-album"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg><span>从相册选择</span></button></div><input type="file" id="item-photo-camera" accept="image/*" capture="environment" hidden tabindex="-1"><input type="file" id="item-photo-album" accept="image/*" hidden tabindex="-1"></div>`;
}
function editItem(id) {
  const existing=state.items.find(i=>i.id===id);
  editorCategories=[...state.categories];
  editorDraft=existing?structuredClone(existing):{id:uid(),name:'',category:editorCategories[0] || '其他',quantity:1,location:'',condition:'',notes:'',photo:null,art:'magnet-travel',tags:emptyTags(),createdAt:new Date().toISOString()};
  if(!editorCategories.includes(editorDraft.category))editorCategories.push(editorDraft.category);
  editorBase=existing?JSON.stringify(existing):null;
  editorCatalogBase=structuredClone(state.tagCatalog);
  const i=editorDraft;
  openSheet(existing?'编辑物品':'添加物品',`<form id="item-form"><div id="form-error" class="inline-error" role="alert"></div>${photoPicker(i)}
    <label class="field"><span>名称 *</span><input name="name" value="${esc(i.name)}" placeholder="物品名称" maxlength="80" required></label>
    <div class="field"><span id="category-label">物品类别</span><div class="category-picker"><select name="category" aria-labelledby="category-label">${categoryOptions(i.category)}</select><button type="button" class="add-inline" data-action="show-inline" data-target="new-category-row" aria-expanded="false">＋ 新增</button></div><div class="inline-create" id="new-category-row" hidden><input id="new-category" maxlength="40" placeholder="新类别名称" aria-label="新类别名称"><button type="button" class="add-inline" data-action="confirm-category">确认</button><button type="button" class="add-inline" data-action="hide-inline" data-target="new-category-row">取消</button></div></div>
    <label class="field"><span>可送数量 *</span><input type="number" inputmode="numeric" min="0" max="9999" step="1" name="quantity" value="${i.quantity}" required></label>
    <label class="field"><span>存放位置</span><input name="location" maxlength="80" value="${esc(i.location)}" placeholder="例如：书房柜子第二层"></label>
    <label class="field"><span>包装状态</span><input name="condition" maxlength="60" value="${esc(i.condition)}" placeholder="例如：未拆封 / 只有本体"></label>
    <p class="tag-editor-help">点选适合的标签，再点一次即可取消。</p>${TAG_GROUPS.map(tagEditor).join('')}
    <label class="field"><span>备注</span><textarea name="notes" maxlength="4000" placeholder="款式、来源，或者其他需要记住的事">${esc(i.notes)}</textarea></label></form>`,{formId:'item-form',saveId:'save-item'});
}
function categoryOptions(selected) { return editorCategories.map(c=>`<option value="${esc(c)}"${selected===c?' selected':''}>${esc(c)}</option>`).join(''); }
function inlineCreate(id,visible) {
  const row=document.getElementById(id);if(!row)return;
  row.hidden=!visible;
  document.querySelectorAll('[data-action="show-inline"]').forEach(button=>{if(button.dataset.target===id)button.setAttribute('aria-expanded',String(visible));});
  const input=$('input',row);if(input){if(visible)input.focus();else input.value='';}
}
function confirmCategory() {
  const input=$('#new-category');const name=input.value.trim();
  if(!name)throw new Error('请填写类别名称');
  if(name.length>40)throw new Error('类别名称最多 40 个字符');
  if(!editorCategories.includes(name))editorCategories.push(name);
  editorDraft.category=name;
  $('[name="category"]',sheet).innerHTML=categoryOptions(name);
  if(!editorBase){editorDraft.art=name==='拉布布'?'toy-green':'magnet-travel';if(!editorDraft.photo)$('#photo-preview').src=artFor(editorDraft);}
  inlineCreate('new-category-row',false);toast('已选择“'+name+'”，保存物品时一起保存');
}
function giveForm(id) {
  const i=state.items.find(i=>i.id===id); if(!i || i.quantity===0)return;
  editorDraft=null;
  openSheet('记录送出',`<form id="give-form" data-id="${esc(i.id)}"><div id="form-error" class="inline-error" role="alert"></div><div class="gift-summary"><img src="${esc(artFor(i))}" alt="${esc(i.name)}"><div><h3>${esc(i.name)}</h3><p>柜子里还剩 ${i.quantity}</p></div></div><label class="field"><span>收礼人 *</span><input name="recipient" maxlength="60" placeholder="写个名字或称呼就好" required></label><div class="form-columns"><label class="field"><span>送出数量 *</span><input type="number" inputmode="numeric" name="quantity" min="1" max="${i.quantity}" step="1" value="1" required></label><label class="field"><span>送出日期 *</span><input type="date" name="date" value="${today()}" required></label></div><label class="field"><span>备注</span><textarea name="note" maxlength="800" placeholder="例如：生日见面时带给她"></textarea></label><div class="tip-box">保存后会扣除送出的数量。记错了，可以在“送出记录”里撤销并放回柜子。</div></form>`, {formId:'give-form'});
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
  openSheet('设置与备份',`<div class="tip-box"><strong>试用版</strong><br>内置物品与图片都是示例；毛绒挂件图片为原创示意插画，并非商品实拍。</div><div class="settings-section"><h3>先筛选，再逛逛</h3><p>在礼物柜上方点开场景、关系或价值，选择筛选条件。同一组内满足任一标签即可，不同组需同时满足。没找到合适的，点“清空筛选”。编辑物品时，再点一次已选标签即可从这件物品移除。</p></div><div class="settings-section"><h3>整理标签</h3><p>新增、修改或删除场景、关系和价值标签。旧版“场合”归入“场景”，“喜好”标签保留在物品备注中。</p><button class="secondary full" data-action="manage-tags">管理标签</button></div><div class="settings-section"><h3>数据现在存在哪里？</h3><p>物品、照片和送出记录只保存在当前浏览器。两台安卓手机暂不同步。清理浏览器数据、更换设备或预览地址，都不会自动带走这份清单；可以先导出备份。</p></div><div class="settings-section"><h3>备份与迁移</h3><p>导出文件包含物品照片和送出记录。导入会替换当前清单，并保留导入前的数据供恢复。${storageError?'当前原始数据暂时无法读取；请先导出保存，再导入有效备份恢复。':''}</p><div class="button-row"><button class="primary" data-action="export">导出备份</button>${storageError?'<button class="secondary" data-action="export-raw">导出原始数据</button>':''}</div><label class="field" style="margin-top:14px"><span>选择备份文件导入</span><input type="file" id="import-file" accept=".json,application/json"></label>${backupControls}</div><div class="settings-section"><h3>接下来的完整版本</h3><p>重点是两个人共用一份清单、同步照片与数量、避免重复送出。是否需要朋友喜好档案，等实际试用后再决定。</p></div>`);
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
    if(action==='filter-tag') {const list=filters.tags[b.dataset.group];const at=list.indexOf(b.dataset.tag);at<0?list.push(b.dataset.tag):list.splice(at,1);render();const selected=list.includes(b.dataset.tag);b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));const done=$('#filter-done');if(done)done.textContent='查看 '+filteredItems().length+' 款';}
    if(action==='clear-filters'){filters=emptyFilters();view='cabinet';render();toast('已清空筛选');}
    if(action==='open-filter')openFilter(b.dataset.group);
    if(action==='open-category-filter')openCategoryFilter();
    if(action==='clear-group-filter'){filters.tags[b.dataset.group]=[];render();openFilter(b.dataset.group);}
    if(action==='show-inline')inlineCreate(b.dataset.target,true);
    if(action==='hide-inline')inlineCreate(b.dataset.target,false);
    if(action==='confirm-category')confirmCategory();
    if(action==='detail')detail(b.dataset.id);
    if(action==='edit')editItem(b.dataset.id);
    if(action==='add')editItem();
    if(action==='give')giveForm(b.dataset.id);
    if(action==='photo-camera' || action==='photo-album'){
      const input=$(action==='photo-camera'?'#item-photo-camera':'#item-photo-album',sheet);
      if(input && editorDraft){input.value='';input.click();}
    }
    if(action==='close')closeSheet();
    if(action==='category'){filters.category=b.dataset.category;render();closeSheet();}
    if(action==='go-pick'){view='cabinet';render();window.scrollTo({top:0,behavior:'instant'});}
    if(action==='settings')settings();
    if(action==='manage-tags')manageTags();
    if(action==='rename-tag')renameTagForm(b.dataset.group,b.dataset.tag);
    if(action==='delete-tag')deleteTagConfirmation(b.dataset.group,b.dataset.tag);
    if(action==='confirm-delete-tag')saveTagChange(removeTag(state,b.dataset.group,b.dataset.tag),`已删除“${b.dataset.tag}”`);
    if(action==='undo-tag-change'){
      if(!tagUndo)return;
      if(JSON.stringify(state)!==tagUndo.after){tagUndo=null;manageTags();throw new Error('清单已有其他更新，无法撤销这次标签修改。');}
      save(tagUndo.before);tagUndo=null;manageTags();toast('已撤销标签修改');
    }
    if(action==='start-empty')resetConfirmation('empty');
    if(action==='reload-demo')resetConfirmation('demo');
    if(action==='confirm-reset'){
      if(!pendingReset)return;
      const next=pendingReset==='empty'?{...createDemoState(),items:[],history:[]}:createDemoState();
      filters=emptyFilters();view='cabinet';
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
function addCustomTag(id){
  const input=$('#custom-'+id),value=input.value.trim();
  if(!value)throw new Error('请填写标签名称');
  if(!editorDraft.tags[id].includes(value)){
    if(editorDraft.tags[id].length>=30)throw new Error('每组最多保留 30 个标签');
    editorDraft.tags[id].push(value);
  }
  inlineCreate('custom-row-'+id,false);refreshTagGroup(id);
}

document.addEventListener('input',event=>{if(event.target.id==='cabinet-search'){filters.search=event.target.value;const matches=filteredItems();$('#cabinet-results').innerHTML=cabinetResults(matches);$('#result-count').textContent=resultCount(matches);$('#clear-all').hidden=!hasFilters();}});
document.addEventListener('keydown',event=>{if(event.key!=='Enter')return;if(event.target.id.startsWith('custom-')){event.preventDefault();try{addCustomTag(event.target.id.replace('custom-',''));}catch(error){fieldError(error.message);}}if(event.target.id==='new-category'){event.preventDefault();try{confirmCategory();}catch(error){fieldError(error.message);}}});
document.addEventListener('change',async event=>{
  if(event.target.id==='include-empty'){filters.includeEmpty=event.target.checked;render();}
  if(event.target.name==='category' && editorDraft){editorDraft.category=event.target.value;if(!editorBase){editorDraft.art=event.target.value==='拉布布'?'toy-green':'magnet-travel';if(!editorDraft.photo)$('#photo-preview').src=artFor(editorDraft);}}
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
  if(!['item-form','give-form','rename-tag-form'].includes(event.target.id) && !event.target.matches('.tag-add-form'))return;
  event.preventDefault();
  try{
    const form=event.target;
    if(form.id==='item-form'){
      if(!$('#new-category-row').hidden && $('#new-category').value.trim())confirmCategory();
      TAG_GROUPS.forEach(g=>{if(!$(`#custom-row-${g.id}`).hidden && $(`#custom-${g.id}`).value.trim())addCustomTag(g.id);});
    }
    const values=Object.fromEntries(new FormData(form));
    if(form.matches('.tag-add-form')){
      saveTagChange(addTag(state,form.dataset.group,values.tag),`已添加“${String(values.tag).trim()}”`);
    }else if(form.id==='rename-tag-form'){
      const group=form.dataset.group,oldTag=form.dataset.tag,newTag=String(values.tag).trim();
      if(newTag===oldTag){manageTags();return;}
      saveTagChange(renameTag(state,group,oldTag,newTag),`已改名为“${newTag}”`,{group,oldTag,newTag});
    }else if(form.id==='item-form'){
      if($('#save-item').disabled)return;
      if(TAG_GROUPS.some(g=>editorDraft.tags[g.id].some(tag=>editorCatalogBase[g.id].includes(tag) && !state.tagCatalog[g.id].includes(tag))))throw new Error('选中的标签已在另一个窗口修改或删除，请重新打开物品后再编辑。');
      const current=state.items.find(i=>i.id===editorDraft.id);
      if(editorBase && JSON.stringify(current)!==editorBase)throw new Error('这个物品已在另一个窗口修改，请重新打开后编辑。');
      const item={...editorDraft,...values,quantity:Number(values.quantity)};
      let next=state;for(const category of editorCategories)if(!next.categories.includes(category))next=addCategory(next,category);
      save(upsertItem(next,item));closeSheet();toast('物品已保存');
    }else{
      save(giveItem(state,{itemId:form.dataset.id,quantity:Number(values.quantity),recipient:values.recipient,note:values.note,date:values.date}));
      closeSheet();toast('已记录送出，数量已更新');
    }
  }catch(error){fieldError(error.message || '保存没有完成，请检查填写内容。');}
});
$('.brand').addEventListener('click',event=>{event.preventDefault();view='cabinet';render();window.scrollTo({top:0,behavior:'instant'});});
sheet.addEventListener('click',event=>{if(event.target===sheet){const rect=sheet.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeSheet();}});
sheet.addEventListener('close',()=>{if(!sheet.open){const filtering=Boolean(activeFilter);clearSheetState();if(filtering)render();}});
window.addEventListener('storage',event=>{
  if(event.key!==KEY)return;
  try{const updated=event.newValue?validateState(JSON.parse(event.newValue)):createDemoState();state=updated;lastStored=event.newValue;storageError='';render();toast('同一设备的另一个窗口更新了清单');}
  catch{lastStored=event.newValue;storageError='其他窗口保存的数据暂时无法读取，已暂停日常保存。请先导出原始数据，再导入有效备份恢复。';render();toast('本机数据暂时无法读取，请先导出原始数据。');}
});
render();
