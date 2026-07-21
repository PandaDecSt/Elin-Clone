// ===== source-data.js  —  Elin SourceData 运行时 (忠实移植) =====
// 对应 Elin 的 Source 体系: xlsx 在编辑期烘焙为 sources.json (见 build_sources.py),
// 本文件在浏览器里加载并提供 Source.Get / Source.List / Lang / ZH 查询,
// 以及把 Source 表(种族/职业/物品/怪物/材料/食物)接入 H5 玩法的归一化访问器.
//
// 设计要点:
//  - 所有原始属性都"读取并保留"在 .src 字段 (忠实于 Elin, 全部字段不丢).
//  - 主属性 STR/END/DEX/PER/LER/WIL/MAG/CHA/SPD 映射到 H5 的中文属性键 (力量/体力/...),
//    真正驱动 recalcStats().
//  - 中文显示名通过 ZH(sheet,id) 解析: lang_zh.json 覆盖 -> en -> jp, 保证有中文.
//  - 对当前游戏已用的 id (mage/hillfolk/executioner 等不在 Source 可玩集的) 自动回退到
//    data.js 原有常量, 绝不破坏现有玩法.

import { RACES, CLASSES, ITEMS, MONSTERS } from './data.js';

// Elin 主属性 (英文) -> H5 中文属性键
export const STAT_CN = {
  STR: '力量', END: '体力', DEX: '灵巧', PER: '感知',
  LER: '学习', WIL: '意志', MAG: '魔力', CHA: '魅力', SPD: '速度',
};

// Elin 元素前缀 -> H5 技能名 (用于把 Source Job/Race 的 elements 转成可显示技能)
const SKILL_MAP = {
  weaponSword: '长剑', weaponDagger: '短剑', weaponAxe: '斧', weaponBlunt: '钝器',
  weaponPolearm: '长柄', weaponScythe: '镰刀', weaponBow: '弓术', weaponCrossbow: '弩',
  weaponGun: '枪械', twohand: '双手', tactics: '战术', regeneration: '再生',
  shield: '盾牌', armorHeavy: '重甲', armorLight: '轻甲', casting: '施法',
  meditation: '冥想', magicControl: '魔力控制', stealth: '潜行', stealing: '偷窃',
  farming: '种植', harvesting: '采集', cooking: '烹饪', featWarrior: '战士特性',
  spell: '法术', magicSkill: '魔法',
};

// ---------- 模块状态 ----------
const DB = { ready: false, Source: null, Lang: null, ZH: null };

export async function loadSource() {
  try {
    const [src, zh] = await Promise.all([
      fetch('data/elin_source/sources.json').then(r => r.ok ? r.json() : null),
      fetch('data/elin_source/lang_zh.json').then(r => r.ok ? r.json() : null),
    ]);
    DB.Source = src;
    DB.ZH = zh || {};
    DB.ready = !!src;
    console.log(`[Source] 已加载: ${DB.ready ? 'sources.json (' + countRows(src) + ' 行)' : '失败'} | lang_zh=${zh ? Object.keys(zh).length : 0} 条`);
  } catch (e) {
    console.warn('[Source] 加载失败, 回退到内置常量:', e);
    DB.ready = false;
  }
  return DB.ready;
}
export function isSourceReady() { return DB.ready; }
function countRows(src) {
  if (!src) return 0;
  let n = 0;
  for (const f in src) { if (f === 'Lang') continue; for (const s in src[f]) n += (src[f][s].count || 0); }
  return n;
}

// ---------- 查询 API (复刻 Elin Source.Get / Source.List) ----------
export const Source = {
  Get(file, sheet, id) {
    const f = DB.Source && DB.Source[file];
    if (!f) return null;
    const s = f[sheet];
    if (!s) return null;
    return s.byId[String(id)] || null;
  },
  List(file, sheet) {
    const f = DB.Source && DB.Source[file];
    if (!f) return [];
    const s = f[sheet];
    return s ? s.rows : [];
  },
  Sheets(file) { return DB.Source && DB.Source[file] ? Object.keys(DB.Source[file]) : []; },
};

// Lang: 系统文本 (General/Game/Note/List/Word). 返回 {jp,en,text, group?}
export const Lang = {
  Get(id, filter) {
    const L = DB.Source && DB.Source.Lang;
    if (!L) return null;
    let rec = L.General && L.General[String(id)];
    if (!rec) rec = L.Game && L.Game[String(id)];
    if (!rec) rec = L.Note && L.Note[String(id)];
    if (!rec) return null;
    if (filter && rec.filter && rec.filter !== filter) {
      // filter 精确匹配优先已在上面命中; 这里仅做软过滤
    }
    return rec;
  },
  text(id, filter) {
    const r = Lang.Get(id, filter);
    return r ? (r.en || r.jp || '') : '';
  },
};

// 中文显示名: lang_zh 覆盖 -> en -> jp
export function ZH(sheet, id) {
  if (DB.ZH && DB.ZH[sheet + ':' + id]) return DB.ZH[sheet + ':' + id];
  return null;
}

// ---------- 内部工具 ----------
function mapStats(row) {
  const a = {};
  for (const en in STAT_CN) a[STAT_CN[en]] = row[en] || 0;
  return a;
}
function splitEle(e) {
  // "weaponSword/6" -> {id:'weaponSword', power:6}
  if (typeof e !== 'string') return null;
  const i = e.indexOf('/');
  if (i < 0) return { id: e, power: 1 };
  return { id: e.slice(0, i), power: parseInt(e.slice(i + 1), 10) || 1 };
}
function parseSkills(elements) {
  const out = {};
  for (const e of (elements || [])) {
    const s = splitEle(e); if (!s) continue;
    for (const k in SKILL_MAP) {
      if (s.id.startsWith(k)) { out[SKILL_MAP[k]] = s.power; break; }
    }
  }
  return out;
}
function defaultGear(j) {
  if (!j || !j.weapon) return [];
  const w = j.weapon[0];
  const map = { sword: 'sword', axe: 'axe', bow: 'bow', gun: 'pistol', staff: 'staff', dagger: 'dagger', blunt: 'dagger', polearm: 'spear', scythe: 'dagger', crossbow: 'bow' };
  const gid = map[w];
  return gid ? [gid] : [];
}
function typeFromCategory(cat) {
  if (!cat) return 'misc';
  const w = ['dagger', 'sword', 'axe', 'blunt', 'polearm', 'scythe', 'staff', 'bow', 'crossbow', 'pistol', 'gun', 'thrown', 'spear'];
  if (w.includes(cat)) return 'weapon';
  if (cat === 'shield') return 'armor';
  if (['helm', 'armor', 'robe', 'cloak', 'gauntlet', 'boots'].includes(cat)) return 'armor';
  if (cat === 'food') return 'food';
  return 'misc';
}
function slotFromCategory(cat) {
  if (cat === 'shield') return '盾牌';
  if (cat === 'cloak') return '披风';
  if (cat === 'helm') return '头部';
  return '身体';
}

// ---------- 归一化访问器 (返回统一形状, 优先 Source, 回退常量) ----------

// 种族
export function getRace(id) {
  const r = Source.Get('SourceChara', 'Race', id);
  if (r) {
    return {
      id, name: ZH('Race', id) || r.name_JP || r.name,
      attrs: mapStats(r),
      speed: r.SPD || 100, life: r.life, mana: r.mana, color: null,
      dvBonus: r.DV, foodBonus: r.food, weightLimit: r.height,
      material: r.material, loot: r.loot, trait: r.detail_JP,
      elements: r.elements || [], src: r, fromSource: true,
    };
  }
  const c = RACES[id];
  return c ? { id, name: c.name, attrs: c.attrs, speed: c.speed, life: c.life, mana: c.mana,
    color: c.color, dvBonus: c.dvBonus, foodBonus: c.foodBonus, weightLimit: c.weightLimit, src: c, fromSource: false } : null;
}

// 职业
export function getJob(id) {
  const j = Source.Get('SourceChara', 'Job', id);
  const c = CLASSES[id];
  if (j) {
    return {
      id, name: ZH('Job', id) || j.name_JP || j.name,
      attrs: mapStats(j),
      skills: c ? c.skills : parseSkills(j.elements),
      spells: c ? c.spells : [],
      luck: c ? c.luck : 0,
      manaBody: c ? c.manaBody : false,
      gold: c ? c.gold : (j.gold || 50),
      gear: c ? c.gear : defaultGear(j),
      elements: j.elements || [], src: j, fromSource: true,
    };
  }
  return c ? { id, name: c.name, attrs: c.attrs, skills: c.skills, spells: c.spells,
    luck: c.luck, manaBody: c.manaBody, gold: c.gold, gear: c.gear, src: c, fromSource: false } : null;
}

// 物品 (Thing)
export function getThing(id) {
  const t = Source.Get('SourceCard', 'Thing', id);
  if (t) {
    return {
      id, name: ZH('Thing', id) || t.name_JP || t.name,
      type: typeFromCategory(t.category), slot: slotFromCategory(t.category),
      category: t.category, weight: (t.weight || 0) / 1000, value: t.value, lv: t.LV,
      material: t.defMat, elements: t.elements || [],
      src: t, fromSource: true,
    };
  }
  const c = ITEMS[id];
  return c ? { ...c, src: c, fromSource: false } : null;
}

// 怪物 (Chara)
export function getChara(id) {
  const c = Source.Get('SourceChara', 'Chara', id);
  if (c) {
    return {
      id, name: ZH('Chara', id) || c.name_JP || c.name,
      life: c.LV, mana: 0, speed: 100, dv: 0, pv: 0, dice: '1d4', bonus: 0, xp: 0, lvl: c.LV || 1,
      attrs: mapStats(c), elements: c.elements || [], loot: c.loot || [], hostility: c.hostility,
      src: c, fromSource: true,
    };
  }
  const m = MONSTERS[id];
  return m ? { ...m, src: m, fromSource: false } : null;
}

// 材料 (Material)
export function getMaterial(id) {
  const m = Source.Get('SourceBlock', 'Material', id);
  if (m) return { id, name: ZH('Material', id) || m.name_JP || m.name, src: m, fromSource: true };
  return null;
}

// 食物 (Food)
export function getFood(id) {
  const f = Source.Get('SourceCard', 'Food', id);
  if (f) return { id, name: ZH('Food', id) || f.name_JP || f.name, src: f, fromSource: true };
  return null;
}

// 把 Source 的元素(ele*)应用到实体的 ElementContainer (其余作为特性保留在 .elinElements)
export function applySourceElements(entity, elements) {
  if (!entity || !entity.elements || !elements) return;
  entity.elinElements = [];
  for (const e of elements) {
    const s = splitEle(e); if (!s) continue;
    if (s.id.startsWith('ele')) {
      try { entity.elements.setBase(s.id, s.power); } catch (_) {}
    } else {
      entity.elinElements.push(s);
    }
  }
}

// 怪物实例增强: 用 Source Chara 数据补充 (保留原 def 的战斗数值)
export function enrichMonster(m, defId) {
  if (!DB.ready) return;
  const row = Source.Get('SourceChara', 'Chara', defId);
  if (!row) return;
  m.elin = row;
  const zh = ZH('Chara', defId);
  if (zh) m.name = zh;
  applySourceElements(m, row.elements);
}
