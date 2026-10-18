// Shared, dependency-free data rules for the family gift cabinet.
export const TAG_GROUPS = Object.freeze([
  Object.freeze({ id: 'scene', label: '场景', options: Object.freeze(['生日', '见面小礼', '伴手礼', '感谢']) }),
  Object.freeze({ id: 'relationship', label: '关系', options: Object.freeze(['朋友', '家人', '同事', '长辈']) }),
  Object.freeze({ id: 'value', label: '价值', options: Object.freeze(['小份心意', '精致礼物', '特别心意']) }),
]);

export const LIMITS = Object.freeze({ items: 5000, history: 20000, quantity: 9999, photoCharacters: 2800000, notes: 4000, catalogTagsPerGroup: 5000 });
const CATEGORIES = ['冰箱贴', '拉布布', '其他'];
const ART = ['magnet-travel', 'magnet-city', 'magnet-flower', 'toy-green', 'toy-pink', 'toy-cocoa'];
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
let idSequence = 0;

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label}包含不支持的对象类型`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || UNSAFE_KEYS.has(key)) throw new Error(`${label}包含不安全的字段`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor.get || descriptor.set) throw new Error(`${label}不能包含动态属性`);
    if (['function', 'symbol', 'bigint'].includes(typeof descriptor.value)) throw new Error(`${label}包含不支持的数据类型`);
  }
  return value;
}

function list(value, label, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error(`${label}必须是数组`);
  if (value.length > maximum) throw new Error(`${label}超过上限 ${maximum}`);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set) throw new Error(`${label}包含无效元素`);
  }
  return value;
}

function string(value, label, { maximum = 200, required = false, fallback = '' } = {}) {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'string') throw new Error(`${label}必须是文字`);
  const trimmed = result.trim();
  if (required && !trimmed) throw new Error(`请填写${label}`);
  if (trimmed.length > maximum) throw new Error(`${label}最多 ${maximum} 个字符`);
  return trimmed;
}

function count(value, label, minimum = 0) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > LIMITS.quantity) {
    throw new Error(`${label}必须是 ${minimum}—${LIMITS.quantity} 的整数`);
  }
  return value === 0 ? 0 : value;
}

function choice(value, options, label, fallback) {
  const result = value === undefined ? fallback : value;
  if (!options.includes(result)) throw new Error(`${label}无效`);
  return result;
}

function tagList(value, label, maximum = 30) {
  const selected = list(value === undefined ? [] : value, `${label}标签`, maximum);
  return [...new Set(Array.from(selected, tag => string(tag, `${label}标签`, { maximum: 40, required: true })))];
}

function tags(value = {}) {
  record(value, '标签');
  return Object.fromEntries(TAG_GROUPS.map(({ id, label }) => [id, tagList(value[id], label)]));
}

function tagCatalog(value = {}) {
  record(value, '标签目录');
  return Object.fromEntries(TAG_GROUPS.map(({ id, label }) => [id, tagList(value[id], label, LIMITS.catalogTagsPerGroup)]));
}

function addItemTagsToCatalog(catalog, items) {
  for (const { id, label } of TAG_GROUPS) {
    const values = new Set(catalog[id]);
    for (const item of items) for (const tag of item.tags[id]) values.add(tag);
    if (values.size > LIMITS.catalogTagsPerGroup) throw new Error(`${label}标签超过上限 ${LIMITS.catalogTagsPerGroup}`);
    catalog[id] = [...values];
  }
  return catalog;
}

function groupFor(groupId) {
  const group = TAG_GROUPS.find(({ id }) => id === groupId);
  if (!group) throw new Error('标签分类无效');
  return group;
}

function normalizedTag(value, group) {
  return string(value, `${group.label}标签`, { maximum: 40, required: true });
}

function migrateV1Item(value) {
  record(value, '物品');
  const previousTags = value.tags === undefined ? {} : record(value.tags, '标签');
  const interests = tagList(previousTags.interest, '原喜好');
  const previousNotes = string(value.notes, '备注', { maximum: LIMITS.notes });
  const notes = interests.length ? `${previousNotes}${previousNotes ? '\n\n' : ''}原喜好标签：${interests.join('、')}` : previousNotes;
  return normalizeItem({
    ...value,
    notes,
    tags: { scene: previousTags.occasion, relationship: [], value: previousTags.value },
  });
}

function photo(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > LIMITS.photoCharacters) throw new Error('照片无效或过大，请使用较小的图片');
  const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[1].length % 4 !== 0) throw new Error('照片仅支持本地 JPEG、PNG 或 WebP 图片');
  return value;
}

function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期格式应为 YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('日期无效');
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`${label}无效`);
  }
  day(value.slice(0, 10));
  const time = new Date(value);
  if (!Number.isFinite(time.getTime()) || Number(value.slice(11, 13)) > 23) throw new Error(`${label}无效`);
  return time.toISOString();
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function identifier(prefix, usedIds) {
  let result;
  do {
    const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${(++idSequence).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    result = `${prefix}-${suffix}`;
  } while (usedIds.has(result));
  return result;
}

function normalizeItem(value) {
  record(value, '物品');
  const category = choice(value.category, CATEGORIES, '物品类别', '其他');
  return {
    id: string(value.id, '物品编号', { required: true, maximum: 120 }),
    name: string(value.name, '物品名称', { required: true, maximum: 80 }),
    category,
    quantity: count(value.quantity, '物品数量'),
    unit: string(value.unit, '单位', { required: true, maximum: 12, fallback: '件' }),
    location: string(value.location, '存放位置', { maximum: 120 }),
    condition: string(value.condition, '包装与成色', { maximum: 80 }),
    notes: string(value.notes, '备注', { maximum: LIMITS.notes }),
    photo: photo(value.photo),
    art: choice(value.art, ART, '示意图类型', category === '拉布布' ? 'toy-green' : 'magnet-travel'),
    tags: tags(value.tags),
    createdAt: timestamp(value.createdAt, '录入时间'),
  };
}

function normalizeHistory(value) {
  record(value, '送出记录');
  return {
    id: string(value.id, '记录编号', { required: true, maximum: 120 }),
    itemId: string(value.itemId, '关联物品编号', { required: true, maximum: 120 }),
    itemName: string(value.itemName, '送出时物品名称', { required: true, maximum: 80 }),
    quantity: count(value.quantity, '送出数量', 1),
    unit: string(value.unit, '单位', { required: true, maximum: 12, fallback: '件' }),
    recipient: string(value.recipient, '收礼人', { required: true, maximum: 100 }),
    note: string(value.note, '送出备注', { maximum: 1000 }),
    date: day(value.date),
    createdAt: timestamp(value.createdAt, '记录时间'),
  };
}

/** Validate an imported snapshot and return a fresh, allow-listed copy. */
export function validateState(value) {
  record(value, '备份');
  if (![1, 2].includes(value.schemaVersion)) throw new Error('备份版本不支持，请使用本应用导出的文件');
  const isLegacy = value.schemaVersion === 1;
  const items = Array.from(list(value.items, '物品列表', LIMITS.items), isLegacy ? migrateV1Item : normalizeItem);
  const history = Array.from(list(value.history, '送出记录', LIMITS.history), normalizeHistory);
  const itemIds = new Set(items.map(item => item.id));
  const allIds = new Set([...itemIds, ...history.map(entry => entry.id)]);
  if (itemIds.size !== items.length || allIds.size !== items.length + history.length) throw new Error('备份中存在重复编号');
  for (const entry of history) {
    if (!itemIds.has(entry.itemId)) throw new Error(`送出记录“${entry.itemName}”关联的物品不存在`);
  }
  const catalog = isLegacy
    ? Object.fromEntries(TAG_GROUPS.map(({ id, options }) => [id, [...options]]))
    : tagCatalog(value.tagCatalog);
  return { schemaVersion: 2, tagCatalog: addItemTagsToCatalog(catalog, items), items, history };
}

/** Add an available label without assigning it to any item. */
export function addTag(state, groupId, tag) {
  const group = groupFor(groupId);
  const label = normalizedTag(tag, group);
  const next = validateState(state);
  if (next.tagCatalog[group.id].includes(label)) throw new Error('这个标签已经存在');
  if (next.tagCatalog[group.id].length >= LIMITS.catalogTagsPerGroup) throw new Error(`${group.label}标签已达上限`);
  next.tagCatalog[group.id].push(label);
  return next;
}

/** Rename a catalog label and all of its item assignments together. */
export function renameTag(state, groupId, oldTag, newTag) {
  const group = groupFor(groupId);
  const previous = normalizedTag(oldTag, group);
  const replacement = normalizedTag(newTag, group);
  const next = validateState(state);
  const index = next.tagCatalog[group.id].indexOf(previous);
  if (index < 0) throw new Error('找不到这个标签');
  if (previous === replacement) throw new Error('新标签与原标签相同');
  if (next.tagCatalog[group.id].includes(replacement)) throw new Error('这个标签已经存在');
  next.tagCatalog[group.id][index] = replacement;
  for (const item of next.items) item.tags[group.id] = item.tags[group.id].map(tag => tag === previous ? replacement : tag);
  return next;
}

/** Remove a catalog label and its assignments while preserving the items. */
export function removeTag(state, groupId, tag) {
  const group = groupFor(groupId);
  const label = normalizedTag(tag, group);
  const next = validateState(state);
  if (!next.tagCatalog[group.id].includes(label)) throw new Error('找不到这个标签');
  next.tagCatalog[group.id] = next.tagCatalog[group.id].filter(value => value !== label);
  for (const item of next.items) item.tags[group.id] = item.tags[group.id].filter(value => value !== label);
  return next;
}

/** Same-group tags use OR; selections in different groups use AND. */
export function filterItems(items, { search = '', category = '', tags: selectedTags = {}, includeEmpty = false } = {}) {
  const query = String(search).trim().toLocaleLowerCase();
  return items.filter(item => {
    if (!includeEmpty && item.quantity <= 0) return false;
    if (category && item.category !== category) return false;
    if (query && ![item.name, item.location, item.notes, item.category].join(' ').toLocaleLowerCase().includes(query)) return false;
    return TAG_GROUPS.every(({ id }) => {
      const selected = selectedTags[id] ?? [];
      return selected.length === 0 || selected.some(tag => (item.tags[id] ?? []).includes(tag));
    });
  });
}

/** Add a new item or patch one existing item without changing the input state. */
export function upsertItem(state, item) {
  const next = validateState(state);
  record(item, '物品');
  const usedIds = new Set([...next.items, ...next.history].map(entry => entry.id));
  const itemId = item.id === undefined ? identifier('item', usedIds) : string(item.id, '物品编号', { required: true, maximum: 120 });
  const index = next.items.findIndex(entry => entry.id === itemId);
  if (index < 0 && usedIds.has(itemId)) throw new Error('物品编号与已有记录重复');
  if (index < 0 && next.items.length >= LIMITS.items) throw new Error('物品数量已达上限');
  const previous = index < 0 ? { id: itemId, quantity: 1, createdAt: new Date().toISOString() } : next.items[index];
  const normalized = normalizeItem({ ...previous, ...item, id: itemId, createdAt: previous.createdAt });
  if (index < 0) next.items.push(normalized);
  else next.items[index] = normalized;
  addItemTagsToCatalog(next.tagCatalog, [normalized]);
  return next;
}

/** Record a gift, including gifts that use up the last available unit. */
export function giveItem(state, { itemId, quantity, recipient, note = '', date = today() }) {
  const next = validateState(state);
  const item = next.items.find(entry => entry.id === itemId);
  if (!item) throw new Error('找不到这件物品');
  count(quantity, '送出数量', 1);
  if (quantity > item.quantity) throw new Error(`库存不足，目前还剩 ${item.quantity} ${item.unit}`);
  if (next.history.length >= LIMITS.history) throw new Error('送出记录已达上限');
  const entry = normalizeHistory({
    id: identifier('gift', new Set([...next.items, ...next.history].map(value => value.id))),
    itemId: item.id, itemName: item.name, quantity, unit: item.unit, recipient, note, date,
    createdAt: new Date().toISOString(),
  });
  item.quantity -= quantity;
  next.history.push(entry);
  return next;
}

/** Undo only the requested gift and restore its original quantity. */
export function undoGift(state, historyId) {
  const next = validateState(state);
  const index = next.history.findIndex(entry => entry.id === historyId);
  if (index < 0) throw new Error('找不到这条送出记录');
  const entry = next.history[index];
  const item = next.items.find(value => value.id === entry.itemId);
  if (!item) throw new Error('原物品已删除，无法恢复库存');
  count(item.quantity + entry.quantity, '恢复后的物品数量');
  item.quantity += entry.quantity;
  next.history.splice(index, 1);
  return next;
}

export function createDemoState() {
  const createdAt = '2026-10-18T00:00:00.000Z';
  const definitions = [
    { id: 'demo-kyoto', name: '京都鸟居冰箱贴', category: '冰箱贴', quantity: 3, unit: '枚', location: '玄关柜 · 旅行纪念盒', condition: '全新，有独立小袋', notes: '旅行时带回的小纪念，适合喜欢逛城市、收集纪念品的朋友。', art: 'magnet-travel', tags: { scene: ['伴手礼', '见面小礼'], relationship: ['朋友', '同事'], value: ['小份心意'] } },
    { id: 'demo-shanghai', name: '上海城市冰箱贴', category: '冰箱贴', quantity: 2, unit: '枚', location: '玄关柜 · 旅行纪念盒', condition: '全新，纸卡包装', notes: '一份轻巧的城市纪念，可以随手带去见朋友。', art: 'magnet-city', tags: { scene: ['见面小礼', '伴手礼'], relationship: ['朋友', '同事'], value: ['小份心意'] } },
    { id: 'demo-flower', name: '小雏菊冰箱贴', category: '冰箱贴', quantity: 1, unit: '枚', location: '书房 · 第二层抽屉', condition: '全新，独立纸盒', notes: '柔和的小花造型，适合喜欢可爱小物的朋友。', art: 'magnet-flower', tags: { scene: ['感谢', '见面小礼'], relationship: ['朋友', '家人'], value: ['小份心意'] } },
    { id: 'demo-seaside', name: '海边旅行冰箱贴', category: '冰箱贴', quantity: 4, unit: '枚', location: '玄关柜 · 旅行纪念盒', condition: '全新，有独立小袋', notes: '带有海边度假气息的小礼物。', art: 'magnet-travel', tags: { scene: ['伴手礼', '见面小礼'], relationship: ['朋友', '家人', '同事'], value: ['小份心意'] } },
    { id: 'demo-night', name: '城市夜景冰箱贴套装', category: '冰箱贴', quantity: 1, unit: '套', location: '书房 · 礼物收纳盒', condition: '全新，礼盒未拆封', notes: '一套可以一起摆放的城市夜景，适合认真准备的小礼物。', art: 'magnet-city', tags: { scene: ['生日', '感谢'], relationship: ['朋友', '长辈'], value: ['精致礼物'] } },
    { id: 'demo-green', name: '森林绿拉布布', category: '拉布布', quantity: 1, unit: '只', location: '书房 · 展示柜下层', condition: '未拆封，包装完整', notes: '适合喜欢潮玩和绿色系的朋友。', art: 'toy-green', tags: { scene: ['生日', '感谢'], relationship: ['朋友', '家人'], value: ['特别心意'] } },
    { id: 'demo-pink', name: '樱花粉拉布布', category: '拉布布', quantity: 2, unit: '只', location: '书房 · 礼物收纳盒', condition: '全新，盒装', notes: '温柔的粉色，适合喜欢可爱挂件的朋友。', art: 'toy-pink', tags: { scene: ['生日', '见面小礼'], relationship: ['朋友', '家人'], value: ['精致礼物'] } },
    { id: 'demo-cocoa', name: '可可拉布布', category: '拉布布', quantity: 1, unit: '只', location: '书房 · 展示柜下层', condition: '已拆盒，未使用，包装保留', notes: '送之前可以先确认朋友是否介意拆盒。', art: 'toy-cocoa', tags: { scene: ['生日', '感谢'], relationship: ['朋友', '同事'], value: ['精致礼物'] } },
  ];
  return validateState({
    schemaVersion: 2,
    tagCatalog: Object.fromEntries(TAG_GROUPS.map(({ id, options }) => [id, [...options]])),
    items: definitions.map(item => ({ ...item, photo: null, createdAt })),
    history: [],
  });
}
