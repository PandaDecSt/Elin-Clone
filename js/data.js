// ===== 游戏数据层 — 数据驱动设计 =====
// 所有种族/职业/物品/怪物/技能/法术均为配置数据，便于扩展

// ---------- 主属性定义 ----------
export const ATTRS = ['力量','魔力','意志','灵巧','感知','学习','魅力','速度'];

// ---------- 种族数据 ----------
export const RACES = {
  yerles: {
    id:'yerles', name:'耶尔勒斯', style:'工业射手',
    life:100, mana:100, speed:100,
    attrs:{力量:12,魔力:9,意志:10,灵巧:12,感知:11,学习:14,魅力:10,速度:100},
    trait:'快速学习者：特长经验需求 -20%，训练师白金币打折',
    color:'#5b8fb9',
  },
  fairy: {
    id:'fairy', name:'妖精', style:'玻璃大炮',
    life:35, mana:130, speed:180,
    attrs:{力量:5,魔力:18,意志:14,灵巧:16,感知:15,学习:12,魅力:14,速度:180},
    trait:'微小躯体：+50 闪避(DV)，永久浮空，但不能装备 >1.0s 的物品',
    color:'#e07ab8', dvBonus:50, weightLimit:1.0,
  },
  eulderna: {
    id:'eulderna', name:'欧尔德纳', style:'法力纽带',
    life:100, mana:120, speed:100,
    attrs:{力量:10,魔力:16,意志:15,灵巧:10,感知:11,学习:12,魅力:11,速度:100},
    trait:'法力纽带：法力溢出伤害 -66%；法术精准：AoE 不误伤队友',
    color:'#9b6ad6',
  },
  juere: {
    id:'juere', name:'尤雷', style:'游牧生存',
    life:100, mana:100, speed:110,
    attrs:{力量:11,魔力:10,意志:11,灵巧:13,感知:12,学习:10,魅力:12,速度:110},
    trait:'高效摄食：食物属性收益 +30%；旅行厨师：获得"现做现吃"状态',
    color:'#c9a23a', foodBonus:0.3,
  },
  hillfolk: {
    id:'hillfolk', name:'山民', style:'矮壮战士',
    life:120, mana:90, speed:80,
    attrs:{力量:16,魔力:8,意志:14,灵巧:9,感知:10,学习:10,魅力:9,速度:80},
    trait:'蜂蜜之血：醉酒时获得战斗加成',
    color:'#b5763a',
  },
  mutant: {
    id:'mutant', name:'变异者', style:'不可预测',
    life:100, mana:100, speed:100,
    attrs:{力量:11,魔力:11,意志:11,灵巧:11,感知:11,学习:11,魅力:11,速度:100},
    trait:'升级时随机获得新身体部位（多手臂/多戒指槽等）',
    color:'#6abf6a',
  },
};

// ---------- 职业数据 ----------
export const CLASSES = {
  warrior: {
    id:'warrior', name:'战士',
    desc:'武器精通与命中率加成',
    attrs:{力量:3,魔力:0,意志:1,灵巧:2,感知:1,学习:0,魅力:0,速度:0},
    skills:{长剑:4,格斗:3,战术:2,双刀流:1},
    gear:['dagger','leather_armor','bread'],
    gold:80,
  },
  mage: {
    id:'mage', name:'法师',
    desc:'施法与各法术学派初始加成',
    attrs:{力量:0,魔力:4,意志:2,灵巧:1,感知:1,学习:2,魅力:0,速度:0},
    skills:{施法:4,冥想:3,魔力控制:2},
    spells:['fire_bolt','heal_minor'],
    gear:['staff','robe','bread'],
    gold:60,
  },
  thief: {
    id:'thief', name:'盗贼',
    desc:'+30 幸运（影响掉落品质和暴击率）',
    attrs:{力量:1,魔力:0,意志:0,灵巧:4,感知:2,学习:1,魅力:1,速度:1},
    skills:{短剑:4,偷窃:3,开锁:3,灵巧:2},
    gear:['dagger','cloak','lockpick','bread'],
    gold:120, luck:30,
  },
  gunner: {
    id:'gunner', name:'枪手',
    desc:'远程命中率与枪械专精加成',
    attrs:{力量:1,魔力:0,意志:1,灵巧:3,感知:4,学习:1,魅力:0,速度:1},
    skills:{枪械:4,灵巧:2,感知:2},
    gear:['pistol','leather_armor','bullet','bread'],
    gold:90,
  },
  farmer: {
    id:'farmer', name:'农民',
    desc:'种植与采集专精',
    attrs:{力量:2,魔力:0,意志:2,灵巧:2,感知:1,学习:1,魅力:1,速度:1},
    skills:{种植:4,采集:3,烹饪:2,体力:2},
    gear:['hoe','straw_hat','seed','bread'],
    gold:100,
  },
  executioner: {
    id:'executioner', name:'处刑人',
    desc:'法力之体——可将伤害转移至法力池',
    attrs:{力量:3,魔力:2,意志:2,灵巧:1,感知:0,学习:1,魅力:0,速度:0},
    skills:{长剑:3,施法:2,魔力控制:3,战术:1},
    spells:['fire_bolt'],
    gear:['dagger','leather_armor','bread'],
    gold:70, manaBody:true,
  },
};

// ---------- 技能数据 ----------
export const SKILLS = {
  // 战斗系
  长剑:{cat:'战斗',icon:'⚔',desc:'提升剑类武器伤害与命中率'},
  短剑:{cat:'战斗',icon:'🗡',desc:'提升匕首类武器伤害与暴击'},
  弓:{cat:'战斗',icon:'🏹',desc:'提升弓类武器远程伤害'},
  枪械:{cat:'战斗',icon:'🔫',desc:'提升枪械远程伤害与命中率'},
  格斗:{cat:'战斗',icon:'👊',desc:'提升徒手伤害'},
  战术:{cat:'战斗',icon:'⚔',desc:'提升近战整体表现'},
  双刀流:{cat:'战斗',icon:'⚔',desc:'双持武器时的副手命中率'},
  // 魔法系
  施法:{cat:'魔法',icon:'✨',desc:'提升法术威力与成功率'},
  冥想:{cat:'魔法',icon:'🧘',desc:'提升 MP 恢复速度'},
  魔力控制:{cat:'魔法',icon:'💠',desc:'降低法力溢出伤害'},
  // 生活系
  种植:{cat:'生活',icon:'🌱',desc:'种植作物成功率与品质'},
  烹饪:{cat:'生活',icon:'🍳',desc:'料理品质'},
  采集:{cat:'生活',icon:'🌿',desc:'野外采集获得率'},
  开锁:{cat:'生活',icon:'🗝',desc:'开启上锁宝箱'},
  // 社交系
  偷窃:{cat:'社交',icon:'🤏',desc:'偷窃物品成功率'},
  // 生存系
  旅行:{cat:'生存',icon:'🥾',desc:'旅行效率'},
  寻路:{cat:'生存',icon:'🧭',desc:'探索视野'},
  体力:{cat:'生存',icon:'💪',desc:'体力上限与恢复'},
  灵巧:{cat:'生存',icon:'🎯',desc:'命中率与闪避'},
  感知:{cat:'生存',icon:'👁',desc:'视野范围与暴击'},
};

// ---------- 法术数据 ----------
export const SPELLS = {
  fire_bolt:{id:'fire_bolt',name:'火焰箭',icon:'🔥',ele:'火',mp:6,power:'3d6',desc:'射出火焰箭造成火元素伤害',range:5,radius:0},
  ice_bolt:{id:'ice_bolt',name:'寒冰箭',icon:'❄',ele:'冰',mp:6,power:'3d6',desc:'射出寒冰箭造成冰元素伤害',range:5,radius:0},
  lightning:{id:'lightning',name:'闪电',icon:'⚡',ele:'雷',mp:8,power:'4d5',desc:'召唤闪电造成雷元素伤害',range:5,radius:0},
  fire_ball:{id:'fire_ball',name:'火球术',icon:'🔥',ele:'火',mp:14,power:'4d6',desc:'爆炸火球，范围伤害',range:5,radius:1},
  heal_minor:{id:'heal_minor',name:'微愈术',icon:'💚',ele:'自然',mp:5,power:'3d4',desc:'恢复少量 HP',range:0,radius:0,heal:true},
  heal:{id:'heal',name:'治疗术',icon:'💚',ele:'自然',mp:10,power:'5d6',desc:'恢复较多 HP',range:0,radius:0,heal:true},
};

// ---------- 元素抗性 ----------
export const ELEMENTS = ['火','冰','雷','暗','自然'];

// ---------- 物品数据 ----------
// quality: normal/good/high/miracle/god
export const ITEMS = {
  // 武器
  dagger:{id:'dagger',name:'匕首',icon:'🗡',type:'weapon',slot:'武器',weight:0.4,dice:'2d4',bonus:0,quality:'normal',pv:0,dv:0,price:20},
  sword:{id:'sword',name:'长剑',icon:'⚔',type:'weapon',slot:'武器',weight:1.2,dice:'3d5',bonus:1,quality:'normal',pv:0,dv:0,price:80},
  longsword:{id:'longsword',name:'双手剑',icon:'⚔',type:'weapon',slot:'武器',weight:2.5,dice:'4d6',bonus:2,quality:'normal',pv:0,dv:0,price:200,twoHanded:true},
  staff:{id:'staff',name:'法杖',icon:'🪄',type:'weapon',slot:'武器',weight:1.0,dice:'1d6',bonus:0,quality:'normal',pv:0,dv:0,price:40,castBonus:2},
  bow:{id:'bow',name:'短弓',icon:'🏹',type:'weapon',slot:'武器',weight:1.0,dice:'2d6',bonus:0,quality:'normal',pv:0,dv:0,price:70,ranged:true,ammo:'arrow'},
  pistol:{id:'pistol',name:'手枪',icon:'🔫',type:'weapon',slot:'武器',weight:0.8,dice:'3d4',bonus:1,quality:'normal',pv:0,dv:0,price:150,ranged:true,ammo:'bullet'},
  hoe:{id:'hoe',name:'锄头',icon:'⛏',type:'weapon',slot:'武器',weight:1.5,dice:'2d3',bonus:0,quality:'normal',pv:0,dv:0,price:15},
  // 防具
  leather_armor:{id:'leather_armor',name:'皮甲',icon:'🦺',type:'armor',slot:'身体',weight:1.5,pv:3,dv:-2,quality:'normal',price:60},
  robe:{id:'robe',name:'法袍',icon:'👘',type:'armor',slot:'身体',weight:0.5,pv:1,dv:2,quality:'normal',price:40,castBonus:1},
  cloak:{id:'cloak',name:'斗篷',icon:'🧥',type:'armor',slot:'披风',weight:0.6,pv:1,dv:3,quality:'normal',price:50},
  straw_hat:{id:'straw_hat',name:'草帽',icon:'👒',type:'armor',slot:'头部',weight:0.2,pv:1,dv:1,quality:'normal',price:15},
  shield:{id:'shield',name:'圆盾',icon:'🛡',type:'armor',slot:'盾牌',weight:1.2,pv:4,dv:-3,quality:'normal',price:70},
  // 消耗品
  bread:{id:'bread',name:'面包',icon:'🍞',type:'food',weight:0.3,food:30,price:5},
  ration:{id:'ration',name:'干粮',icon:'🍙',type:'food',weight:0.4,food:50,price:10},
  apple:{id:'apple',name:'苹果',icon:'🍎',type:'food',weight:0.2,food:15,price:3,attr:'魅力'},
  meat:{id:'meat',name:'烤肉',icon:'🍖',type:'food',weight:0.4,food:45,price:12,attr:'力量'},
  potion_heal:{id:'potion_heal',name:'治疗药水',icon:'🧪',type:'potion',weight:0.3,use:'heal',power:'4d6',price:40},
  potion_heal_l:{id:'potion_heal_l',name:'强效治疗药水',icon:'🧪',type:'potion',weight:0.3,use:'heal',power:'8d6',price:120},
  potion_cure:{id:'potion_cure',name:'解毒药',icon:'🧪',type:'potion',weight:0.3,use:'cure',price:30},
  // 弹药
  arrow:{id:'arrow',name:'箭矢',icon:'➶',type:'ammo',ammo:'arrow',weight:0.1,price:2,stack:99},
  bullet:{id:'bullet',name:'子弹',icon:'•',type:'ammo',ammo:'bullet',weight:0.1,price:3,stack:99},
  // 工具
  lockpick:{id:'lockpick',name:'开锁器',icon:'🗝',type:'tool',weight:0.1,price:15},
  torch:{id:'torch',name:'火把',icon:'🔥',type:'tool',weight:0.3,price:8,light:3},
  // 材料
  seed:{id:'seed',name:'种子',icon:'🌱',type:'material',weight:0.05,price:2},
  herb:{id:'herb',name:'草药',icon:'🌿',type:'material',weight:0.1,price:5},
  ore:{id:'ore',name:'矿石',icon:'🪨',type:'material',weight:0.5,price:8},
  // 宝箱
  chest:{id:'chest',name:'宝箱',icon:'📦',type:'container',weight:5,price:0,locked:true},
  // 货币
  platinum:{id:'platinum',name:'白金币',icon:'⚪',type:'currency',weight:0,price:0,stack:99},
};

// ---------- 怪物数据 ----------
export const MONSTERS = {
  slime:{id:'slime',name:'史莱姆',icon:'🟢',color:'#5fcf60',hp:12,mp:0,speed:70,dv:5,pv:0,dice:'1d4',bonus:0,xp:4,lvl:1,attrs:{力量:6,魔力:1,意志:5,灵巧:5,感知:6,学习:1,魅力:1,速度:70},drops:[{id:'herb',chance:0.3}],aggr:false},
  bat:{id:'bat',name:'蝙蝠',icon:'🦇',color:'#6a5a7a',hp:8,mp:0,speed:150,dv:18,pv:0,dice:'1d3',bonus:0,xp:3,lvl:1,attrs:{力量:4,魔力:1,意志:3,灵巧:12,感知:10,学习:1,魅力:1,速度:150},drops:[],aggr:true,attacks:'吸血'},
  rat:{id:'rat',name:'巨鼠',icon:'🐀',color:'#8a6a4a',hp:14,mp:0,speed:110,dv:10,pv:1,dice:'1d4',bonus:1,xp:5,lvl:2,attrs:{力量:8,魔力:1,意志:5,灵巧:10,感知:8,学习:2,魅力:1,速度:110},drops:[{id:'meat',chance:0.4}],aggr:true},
  goblin:{id:'goblin',name:'哥布林',icon:'👺',color:'#5a8a4a',hp:22,mp:0,speed:100,dv:8,pv:2,dice:'2d4',bonus:1,xp:9,lvl:3,attrs:{力量:11,魔力:3,意志:7,灵巧:10,感知:9,学习:5,魅力:5,速度:100},drops:[{id:'dagger',chance:0.2},{id:'gold',chance:0.6,min:5,max:20}],aggr:true,equipable:'dagger'},
  kobold:{id:'kobold',name:'狗头人',icon:'🐕',color:'#9a7a3a',hp:18,mp:0,speed:120,dv:12,pv:1,dice:'1d6',bonus:1,xp:7,lvl:2,attrs:{力量:9,魔力:2,意志:6,灵巧:13,感知:9,学习:4,魅力:3,速度:120},drops:[{id:'arrow',chance:0.3,count:3}],aggr:true},
  orc:{id:'orc',name:'兽人',icon:'👹',color:'#4a7a4a',hp:35,mp:0,speed:90,dv:6,pv:4,dice:'2d6',bonus:2,xp:16,lvl:5,attrs:{力量:16,魔力:2,意志:8,灵巧:9,感知:8,学习:5,魅力:5,速度:90},drops:[{id:'sword',chance:0.15},{id:'gold',chance:0.7,min:15,max:40}],aggr:true,equipable:'sword'},
  zombie:{id:'zombie',name:'僵尸',icon:'🧟',color:'#6a7a5a',hp:30,mp:0,speed:60,dv:2,pv:3,dice:'1d8',bonus:1,xp:12,lvl:4,attrs:{力量:14,魔力:0,意志:20,灵巧:5,感知:5,学习:1,魅力:1,速度:60},drops:[{id:'meat',chance:0.3}],aggr:true,resist:{暗:50}},
  ghost:{id:'ghost',name:'幽灵',icon:'👻',color:'#aaccdd',hp:20,mp:10,speed:100,dv:20,pv:0,dice:'1d6',bonus:0,xp:14,lvl:4,attrs:{力量:6,魔力:12,意志:10,灵巧:12,感知:10,学习:5,魅力:3,速度:100},drops:[{id:'potion_heal',chance:0.2}],aggr:true,resist:{暗:50,自然:25},floats:true,attacks:'冰冷触碰'},
  imp:{id:'imp',name:'小恶魔',icon:'😈',color:'#c94a4a',hp:25,mp:20,speed:110,dv:14,pv:1,dice:'1d5',bonus:1,xp:18,lvl:5,attrs:{力量:8,魔力:15,意志:10,灵巧:12,感知:11,学习:8,魅力:8,速度:110},drops:[{id:'potion_heal',chance:0.15},{id:'gold',chance:0.5,min:10,max:30}],aggr:true,spells:['fire_bolt'],resist:{火:50}},
  // Boss
  troll:{id:'troll',name:'洞穴巨魔',icon:'🧌',color:'#5a6a4a',hp:80,mp:0,speed:80,dv:8,pv:6,dice:'3d6',bonus:3,xp:60,lvl:8,boss:true,attrs:{力量:24,魔力:3,意志:14,灵巧:8,感知:8,学习:5,魅力:3,速度:80},drops:[{id:'chest',chance:1},{id:'platinum',chance:1,count:2},{id:'gold',chance:1,min:80,max:150}],aggr:true,regen:5},
  dragon:{id:'dragon',name:'幼龙',icon:'🐲',color:'#c97a2a',hp:120,mp:30,speed:100,dv:12,pv:8,dice:'4d6',bonus:4,xp:120,lvl:12,boss:true,attrs:{力量:30,魔力:18,意志:16,灵巧:12,感知:14,学习:10,魅力:8,速度:100},drops:[{id:'chest',chance:1},{id:'platinum',chance:1,count:3},{id:'longsword',chance:0.4},{id:'gold',chance:1,min:150,max:300}],aggr:true,spells:['fire_ball'],resist:{火:75}},
};

// ---------- 瓦片类型 ----------
export const TILES = {
  grass:        {id:'grass',        name:'草地',    solid:false,base:'#3a6a35',top:'#4a8a45',walkable:true,  tex:'grass'},
  grass_dark:   {id:'grass_dark',   name:'深草地',  solid:false,base:'#2a5a28',top:'#3a7a32',walkable:true,  tex:'grass'},
  floor:        {id:'floor',        name:'地板',    solid:false,base:'#5a4a35',top:'#6a5a45',walkable:true,  tex:'floor'},
  floor_dark:   {id:'floor_dark',   name:'暗地板',  solid:false,base:'#3a3025',top:'#4a4035',walkable:true,  tex:'floor'},
  dirt:         {id:'dirt',         name:'泥土',    solid:false,base:'#4a3a25',top:'#5a4a30',walkable:true,  tex:'floor'},
  stone_path:   {id:'stone_path',   name:'石板路',  solid:false,base:'#4a4a4a',top:'#6a6a6a',walkable:true,  tex:'floor'},
  moss:         {id:'moss',         name:'苔藓',    solid:false,base:'#3a5a30',top:'#4a6a38',walkable:true,  tex:'grass'},
  wall:         {id:'wall',         name:'墙壁',    solid:true, base:'#3a3530',top:'#5a5048',walkable:false, height:1, tex:'wall'},
  wall_mossy:   {id:'wall_mossy',   name:'苔墙',    solid:true, base:'#2a3a28',top:'#4a5a40',walkable:false, height:1, tex:'wall'},
  door:         {id:'door',         name:'门',      solid:false,base:'#6a4a25',top:'#8a6a35',walkable:true},
  water:        {id:'water',        name:'水面',    solid:true, base:'#2a4a6a',top:'#3a6a8a',walkable:false, water:true},
  water_deep:   {id:'water_deep',   name:'深水',    solid:true, base:'#1a3a5a',top:'#2a5a7a',walkable:false, water:true, deep:true},
  sand:         {id:'sand',         name:'沙地',    solid:false,base:'#7a6a45',top:'#8a7a55',walkable:true},
  stairs_dn:    {id:'stairs_dn',    name:'下行楼梯',solid:false,base:'#3a3530',top:'#7a6a55',walkable:true},
  stairs_up:    {id:'stairs_up',    name:'上行楼梯',solid:false,base:'#3a3530',top:'#7a6a55',walkable:true},
  rubble:       {id:'rubble',       name:'碎石',    solid:false,base:'#45413a',top:'#5a554a',walkable:true},
  altar:        {id:'altar',        name:'祭坛',    solid:false,base:'#4a3a5a',top:'#7a6a9a',walkable:true},
  chest_tile:   {id:'chest_tile',   name:'宝箱',    solid:false,base:'#5a4a35',top:'#8a6a35',walkable:true},
};

// ---------- 方块类型（可堆叠，高度无限制）----------
// h: 高度系数 (1.0=完整方块32px, 0.5=半方块16px, 0.75=栅栏24px)
// solid: 是否阻挡移动和视线
// atlas/r/c: blocks.png图集中的位置 (64px tiles)
export const BLOCK_TYPES = {
  // 完整方块
  stone_wall:    { id:'stone_wall',    atlas:'blocks', r:1, c:0,  h:1.0, solid:true,  name:'石墙' },
  brick_wall:    { id:'brick_wall',    atlas:'blocks', r:1, c:5,  h:1.0, solid:true,  name:'砖墙' },
  dark_wall:     { id:'dark_wall',     atlas:'blocks', r:1, c:25, h:1.0, solid:true,  name:'暗石墙' },
  cobble_wall:   { id:'cobble_wall',   atlas:'blocks', r:2, c:6,  h:1.0, solid:true,  name:'鹅卵石墙' },
  mossy_wall:    { id:'mossy_wall',    atlas:'blocks', r:2, c:7,  h:1.0, solid:true,  name:'苔石墙' },
  dark_stone:    { id:'dark_stone',    atlas:'blocks', r:2, c:16, h:1.0, solid:true,  name:'深石墙' },
  sand_wall:     { id:'sand_wall',     atlas:'blocks', r:1, c:23, h:1.0, solid:true,  name:'砂岩墙' },
  wood_wall:     { id:'wood_wall',     atlas:'blocks', r:0, c:13, h:1.0, solid:true,  name:'木墙' },
  smooth_stone:  { id:'smooth_stone',  atlas:'blocks', r:1, c:3,  h:1.0, solid:true,  name:'光滑石墙' },
  // 半方块
  stone_half:    { id:'stone_half',    atlas:'blocks', r:10,c:0,  h:0.5, solid:true,  name:'半石墙' },
  wood_half:     { id:'wood_half',     atlas:'blocks', r:2, c:30, h:0.5, solid:true,  name:'半木墙' },
  // 栅栏 (非实体，可穿越但遮挡视线)
  wood_fence:    { id:'wood_fence',    atlas:'blocks', r:4, c:0,  h:0.75, solid:false, name:'木栅栏' },
  stone_fence:   { id:'stone_fence',   atlas:'blocks', r:4, c:3,  h:0.75, solid:false, name:'石栅栏' },
  iron_bars:     { id:'iron_bars',     atlas:'blocks', r:6, c:0,  h:0.75, solid:false, name:'铁栏杆' },
};

// ---------- 地板贴图映射 (floors.png, 64×48px cells) ----------
export const FLOOR_ATLAS = {
  // cell 64×48
  floor:      { atlas:'floors', r:1,  c:0  },  // 石地板 (灰)
  floor_dark: { atlas:'floors', r:8,  c:12 },  // 暗石板 (深灰)
  dirt:       { atlas:'floors', r:12, c:12 },  // 泥土 (棕)
  stone_path: { atlas:'floors', r:3,  c:0  },  // 石板路 (浅灰)
  sand:       { atlas:'floors', r:13, c:0  },  // 沙地 (浅棕)
  cobble:     { atlas:'floors', r:6,  c:4  },  // 鹅卵石 (浅灰)
  wood:       { atlas:'floors', r:6,  c:0  },  // 木板 (灰)
};

// ---------- 草地贴图映射 (floors.png, 64×48px cells, 灰度tile + 程序上色) ----------
// 草地tile为灰度明暗信息, 运行时按群系颜色程序上色: newRGB = L/255 * colorRGB
// r=1(第2行): 地面草群系   r=3(第4行): 地牢草群系
export const GRASS_ATLAS = {
  grass:      { atlas:'floors', r:1, c:0, color:[120, 178, 82] },  // 地面草 — 淡鲜绿
  grass_dark: { atlas:'floors', r:3, c:0, color:[72, 122, 56] },   // 地牢草 — 淡暗绿
  moss:       { atlas:'floors', r:3, c:0, color:[92, 142, 66] },   // 苔藓 — 淡黄绿
};

// ---------- 暗影贴图映射 (shadows.png, 128×128px cells) ----------
// 用于不可见/已探索区域的暗化覆盖, 软边菱形自然覆盖完整tile(含草叶上部)
// r=3,c=1: 第4行第2列, 菱形刚好重合单格地板
export const SHADOW_ATLAS = {
  floor: { atlas:'shadows', r:1, c:3 },
};

// ---- 装饰物定义 ----
// atlas: 图集名, sx/sy: 图集坐标, sw/sh: 精灵尺寸
// minS/maxS: 缩放范围, light: 是否发光
export const DECOR_TYPES = {
  grass_tuft:   {id:'grass_tuft',   atlas:'objs',  sx:146, sy:6,   sw:15, sh:13, minS:0.6, maxS:1.2},
  grass_tall:   {id:'grass_tall',   atlas:'objs',  sx:332, sy:6,   sw:34, sh:53, minS:0.8, maxS:1.5},
  flower_red:   {id:'flower_red',   atlas:'objs',  sx:163, sy:16,  sw:16, sh:15, minS:0.5, maxS:0.8},
  flower_yellow:{id:'flower_yellow',atlas:'objs',  sx:136, sy:23,  sw:16, sh:16, minS:0.5, maxS:0.8},
  flower_white: {id:'flower_white', atlas:'objs',  sx:166, sy:5,   sw:12, sh:11, minS:0.5, maxS:0.8},
  mushroom:     {id:'mushroom',     atlas:'objs',  sx:155, sy:31,  sw:18, sh:14, minS:0.4, maxS:0.7},
  pebble:       {id:'pebble',       atlas:'objs',  sx:279, sy:32,  sw:9,  sh:12, minS:0.3, maxS:0.6},
  crack:        {id:'crack',        atlas:'objs',  sx:288, sy:42,  sw:12, sh:8,  minS:0.5, maxS:1.0},
  vine:         {id:'vine',         atlas:'objs',  sx:91,  sy:19,  sw:20, sh:13, minS:0.6, maxS:1.0},
  torch:        {id:'torch',        atlas:'objs',  sx:3854,sy:36,  sw:12, sh:13, minS:0.8, maxS:1.0, light:true},
  crystal:      {id:'crystal',      atlas:'objs',  sx:3238,sy:36,  sw:8,  sh:8,  minS:0.5, maxS:0.9, light:true},
  bone:         {id:'bone',         atlas:'objs',  sx:3214,sy:42,  sw:8,  sh:8,  minS:0.4, maxS:0.8},
  puddle:       {id:'puddle',       atlas:'objs',  sx:4010,sy:28,  sw:18, sh:20, minS:0.5, maxS:1.0},
};

// ---------- 神明数据 ----------
export const GODS = {
  opatos:{id:'opatos',name:'奥帕托斯',domain:'大地',bonus:'受到的所有伤害 -10%',gift:'矿石、尸体',color:'#8a7a5a'},
  kumiromi:{id:'kumiromi',name:'库米罗米',domain:'丰收',bonus:'腐烂食物偶尔生成种子',gift:'种子、蔬果',color:'#6abf6a'},
  itzpalt:{id:'itzpalt',name:'伊茨帕尔特',domain:'元素',bonus:'元素抗性、法术强化',gift:'法术书、法杖',color:'#4a9fc9'},
  mani:{id:'mani',name:'马尼',domain:'机械',bonus:'感知+灵巧、拆除陷阱',gift:'枪械、机械',color:'#9a9a9a'},
  lulwy:{id:'lulwy',name:'露薇',domain:'风',bonus:'速度加成',gift:'—',color:'#aaccdd'},
  ehekatl:{id:'ehekatl',name:'埃卡特尔',domain:'幸运',bonus:'幸运值大幅提升',gift:'鱼',color:'#c9a23a'},
  jure:{id:'jure',name:'茱尔',domain:'治愈',bonus:'生命回复、治疗强化',gift:'矿石、宝石',color:'#e0aacc'},
};

// ---------- 天气 ----------
export const WEATHER = ['晴','阴','雨','雷暴','以太之风'];

// ---------- 季节系统 ----------
export const SEASONS = {
  spring: {
    id: 'spring', name: '春', icon: '🌸',
    temps: [15, 25],  // 温度范围
    weatherWeights: { '晴': 30, '阴': 25, '雨': 30, '雷暴': 10, '以太之风': 5 },
    growthMod: 1.2,  // 作物生长速度加成
    fishingMod: 1.0,
    desc: '万物复苏的季节',
  },
  summer: {
    id: 'summer', name: '夏', icon: '☀️',
    temps: [25, 35],
    weatherWeights: { '晴': 40, '阴': 20, '雨': 15, '雷暴': 20, '以太之风': 5 },
    growthMod: 1.5,
    fishingMod: 1.2,
    desc: '炎热的季节',
  },
  autumn: {
    id: 'autumn', name: '秋', icon: '🍂',
    temps: [10, 20],
    weatherWeights: { '晴': 25, '阴': 30, '雨': 25, '雷暴': 10, '以太之风': 10 },
    growthMod: 0.8,
    fishingMod: 0.9,
    desc: '收获的季节',
  },
  winter: {
    id: 'winter', name: '冬', icon: '❄️',
    temps: [-5, 10],
    weatherWeights: { '晴': 20, '阴': 30, '雨': 25, '雷暴': 5, '以太之风': 20 },
    growthMod: 0.3,
    fishingMod: 0.7,
    desc: '寒冷的季节',
  },
};

// 根据天数获取季节（每30天一季）
export function getSeason(day){
  const cycle = Math.floor((day - 1) / 30) % 4;
  const seasons = ['spring', 'summer', 'autumn', 'winter'];
  return SEASONS[seasons[cycle]];
}

// 根据天气获取效果
export const WEATHER_EFFECTS = {
  '晴': { moveCost: 1.0, visibility: 1.0, morale: 5, desc: '晴朗' },
  '阴': { moveCost: 1.0, visibility: 0.9, morale: 0, desc: '阴天' },
  '雨': { moveCost: 1.2, visibility: 0.7, morale: -5, desc: '下雨' },
  '雷暴': { moveCost: 1.5, visibility: 0.5, morale: -15, desc: '雷暴' },
  '以太之风': { moveCost: 1.0, visibility: 0.3, morale: -10, magicResist: -20, desc: '以太之风' },
};

// ---------- 品质名称 ----------
export const QUALITY = {
  normal:{name:'',cls:'',mult:1.0},
  good:{name:'良好',cls:'quality-good',mult:1.2},
  high:{name:'高品质',cls:'quality-high',mult:1.5},
  miracle:{name:'奇迹',cls:'quality-mira',mult:2.0},
  god:{name:'神器',cls:'quality-god',mult:3.0},
};
export const QUALITY_LIST = ['normal','good','high','miracle','god'];

// ---------- 附魔词条 ----------
export const ENCHANTS = [
  {id:'str',name:'力量',attr:'力量',min:1,max:4},
  {id:'dex',name:'灵巧',attr:'灵巧',min:1,max:4},
  {id:'spd',name:'速度',attr:'速度',min:2,max:8},
  {id:'hp',name:'生命',attr:'life',min:5,max:20},
  {id:'mp',name:'法力',attr:'mana',min:5,max:20},
  {id:'dv',name:'闪避',attr:'dv',min:2,max:8},
  {id:'pv',name:'护甲',attr:'pv',min:2,max:8},
  {id:'fire_r',name:'火抗',resist:'火',min:5,max:20},
  {id:'ice_r',name:'冰抗',resist:'冰',min:5,max:20},
  {id:'crit',name:'暴击',attr:'crit',min:3,max:10},
];
