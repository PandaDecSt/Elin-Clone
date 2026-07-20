// ===== UI 模块：角色创建 / HUD / 背包面板 / 角色面板 / 消息日志 =====

import { RACES, CLASSES, ATTRS, SKILLS, SPELLS, QUALITY, GODS, getSeason } from './data.js';
import { itemName, qualityName, qualityClass } from './item.js';

export class UI{
  constructor(){
    this.ccSelectedRace = null;
    this.ccSelectedClass = null;
    this.onPanelClose = null;
    // 设置状态
    this.settings = {
      fogGradient: true,
      vignette: true,
      topGradient: true,
      bottomGradient: true,
      colorGrading: true,
      autoPickup: true,
      showHelp: true,
      dmgPopups: true
    };
    this._settingsListeners = [];
  }

  // ========== 角色创建 ==========
  initCharCreate(onStart){
    const raceList = document.getElementById('race-list');
    const classList = document.getElementById('class-list');
    const nameInput = document.getElementById('char-name');
    const startBtn = document.getElementById('start-btn');

    raceList.innerHTML = '';
    classList.innerHTML = '';

    for(const id in RACES){
      const r = RACES[id];
      const card = el('div','cc-card');
      card.innerHTML = `
        <div class="cc-name">${r.name}</div>
        <div class="cc-style">${r.style}</div>
        <div class="cc-stats"><span>生命 ${r.life}</span><span>法力 ${r.mana}</span><span>速度 ${r.speed}</span></div>
        <div class="cc-trait">${r.trait}</div>`;
      card.onclick = ()=>{
        this.ccSelectedRace = id;
        raceList.querySelectorAll('.cc-card').forEach(c=>c.classList.remove('selected'));
        card.classList.add('selected');
        this.updateCCPreview();
        this.checkStartReady(startBtn);
      };
      raceList.appendChild(card);
    }

    for(const id in CLASSES){
      const c = CLASSES[id];
      const card = el('div','cc-card');
      card.innerHTML = `
        <div class="cc-name">${c.name}</div>
        <div class="cc-style">${c.desc}</div>
        <div class="cc-trait">金币 ${c.gold||50}${c.luck?' · 幸运+'+c.luck:''}</div>`;
      card.onclick = ()=>{
        this.ccSelectedClass = id;
        classList.querySelectorAll('.cc-card').forEach(c=>c.classList.remove('selected'));
        card.classList.add('selected');
        this.updateCCPreview();
        this.checkStartReady(startBtn);
      };
      classList.appendChild(card);
    }

    nameInput.oninput = ()=>{ this.updateCCPreview(); this.checkStartReady(startBtn); };
    nameInput.value = '冒险者';

    startBtn.onclick = ()=>{
      const name = nameInput.value.trim() || '冒险者';
      onStart({raceId:this.ccSelectedRace, classId:this.ccSelectedClass, name});
    };

    // 默认选中第一个
    raceList.firstChild?.click();
    classList.firstChild?.click();
  }

  updateCCPreview(){
    const preview = document.getElementById('cc-preview');
    if(!this.ccSelectedRace || !this.ccSelectedClass){ preview.innerHTML='<span style="color:#8a93a6">请选择种族与职业</span>'; return; }
    const r = RACES[this.ccSelectedRace];
    const c = CLASSES[this.ccSelectedClass];
    let html = '<h3>种族特性</h3>';
    html += `<div class="pr-row"><span class="pr-label">种族</span><span class="pr-val">${r.name}（${r.style}）</span></div>`;
    html += `<div class="pr-row"><span class="pr-label">生命/法力/速度</span><span class="pr-val">${r.life} / ${r.mana} / ${r.speed}</span></div>`;
    html += `<div class="pr-row"><span class="pr-label">特性</span><span class="pr-val" style="font-size:11px">${r.trait}</span></div>`;
    html += '<h3>主属性（含职业加成）</h3>';
    for(const a of ATTRS){
      let v = r.attrs[a] || 0;
      if(c.attrs[a]) v += c.attrs[a];
      if(a==='速度') v = r.speed + (c.attrs['速度']||0);
      html += `<div class="pr-row"><span class="pr-label">${a}</span><span class="pr-val">${v}</span></div>`;
    }
    html += '<h3>职业</h3>';
    html += `<div class="pr-row"><span class="pr-label">职业</span><span class="pr-val">${c.name}</span></div>`;
    html += `<div class="pr-row"><span class="pr-label">初始技能</span><span class="pr-val" style="font-size:11px">${Object.keys(c.skills||{}).map(k=>k+'+'+c.skills[k]).join(' · ')||'无'}</span></div>`;
    if(c.spells) html += `<div class="pr-row"><span class="pr-label">初始法术</span><span class="pr-val" style="font-size:11px">${c.spells.map(s=>SPELLS[s].name).join(' · ')}</span></div>`;
    html += `<div class="pr-row"><span class="pr-label">初始金币</span><span class="pr-val">${c.gold||50}</span></div>`;
    preview.innerHTML = html;
  }

  checkStartReady(btn){
    btn.disabled = !(this.ccSelectedRace && this.ccSelectedClass);
  }

  hideCharCreate(){ document.getElementById('char-create').classList.add('hidden'); }
  showHUD(){ document.getElementById('hud').classList.remove('hidden'); }

  // ========== HUD 更新 ==========
  updateHUD(player, gs){
    if(!player) return;
    setBar('hp', player.hp, player.maxHp);
    setBar('mp', player.mp, player.maxMp);
    setBar('st', player.stamina, player.maxStamina);
    setBar('food', player.food, 100);
    // 状态效果
    const se = document.getElementById('status-effects');
    se.innerHTML = '';
    for(const s of player.statusEffects){
      const ic = el('span', 'status-icon ' + (s.bad?'bad':'good'));
      ic.textContent = `${s.name} Lv${s.level>0?s.level:''} ${s.dur}t`;
      se.appendChild(ic);
    }
    // 角色简报
    const cb = document.getElementById('char-brief');
    cb.innerHTML = `${player.name} · ${RACES[player.race]?.name||''} ${CLASSES[player.class]?.name||''} · Lv.${player.level} | 力${player.getAttr('力量')} 魔${player.getAttr('魔力')} 灵巧${player.getAttr('灵巧')} 感知${player.getAttr('感知')} | DV${player.dv} PV${player.pv} 命中${Math.floor(player.hit||0)} 暴击${Math.floor(player.crit||0)}%`;

    // 顶部信息
    if(gs){
      const hour = Math.floor(gs.hour || 8);
      const min = Math.floor((gs.hour * 60) % 60);
      const timeStr = `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
      let phaseIcon = '☀️';
      if(hour < 5 || hour >= 20) phaseIcon = '🌙';
      else if(hour < 8) phaseIcon = '🌅';
      else if(hour >= 17) phaseIcon = '🌇';
      const season = getSeason(gs.day);
      document.getElementById('date-info').textContent = `${season.icon}${season.name} · 第 ${gs.day} 天 · ${phaseIcon} ${timeStr} · ${gs.weather}`;
      document.getElementById('location-info').textContent = gs.mapName || '';
      document.getElementById('depth-info').textContent = gs.depth!=null ? `危险度: ${gs.depth}` : '危险度: --';
    }
    // 快捷栏（法术）
    this.updateHotbar(player);
  }

  updateHotbar(player){
    const hb = document.getElementById('hotbar');
    hb.innerHTML = '';
    const spellIds = Object.keys(player.spells||{});
    let keyIdx = 1;
    for(const sid of spellIds.slice(0,8)){
      const sp = SPELLS[sid];
      if(!sp) continue;
      const slot = el('div','slot');
      const count = player.spells[sid].stock;
      slot.innerHTML = `<span class="slot-key">${keyIdx}</span><span class="slot-icon">${sp.icon}</span><span class="slot-count">${count}</span>`;
      slot.title = `${sp.name} (MP ${sp.mp}) - ${sp.desc}`;
      slot.onclick = ()=>{ this._spellCastCb && this._spellCastCb(sid); };
      if(count <= 0) slot.style.opacity = 0.4;
      hb.appendChild(slot);
      keyIdx++;
    }
  }

  setSpellCastCallback(cb){ this._spellCastCb = cb; }

  // ========== 消息日志 ==========
  log(text, type='info'){
    const ml = document.getElementById('message-log');
    const m = el('div', 'msg ' + type);
    m.textContent = text;
    ml.appendChild(m);
    while(ml.children.length > 8) ml.removeChild(ml.firstChild);
    // 旧的变淡
    Array.from(ml.children).forEach((c,i)=>{
      if(i < ml.children.length-1) c.classList.add('fade');
    });
    ml.scrollTop = ml.scrollHeight;
  }

  // ========== 通用面板 ==========
  showPanel(html){
    const ov = document.getElementById('panel-overlay');
    document.getElementById('panel-content').innerHTML = html;
    ov.classList.remove('hidden');
  }
  hidePanel(){
    document.getElementById('panel-overlay').classList.add('hidden');
    if(this.onPanelClose){ this.onPanelClose(); this.onPanelClose=null; }
  }
  isPanelOpen(){ return !document.getElementById('panel-overlay').classList.contains('hidden'); }

  // ========== 背包面板 ==========
  showInventory(player, actions){
    const tabs = ['全部','武器','防具','消耗','材料','其他'];
    let html = `<button class="btn-close" onclick="document.getElementById('panel-overlay').classList.add('hidden')">关闭 (Esc)</button>`;
    html += `<h2>背包 — ${player.inventory.length} 件 · ${player.gold} 金币 · ${countPlatinum(player)} 白金币</h2>`;
    html += `<div class="tab-bar" id="inv-tabs">${tabs.map((t,i)=>`<div class="tab ${i===0?'active':''}" data-tab="${i}">${t}</div>`).join('')}</div>`;
    html += `<div class="inv-grid" id="inv-grid"></div>`;
    html += `<h2 style="margin-top:16px">装备</h2><div id="equip-slots"></div>`;
    this.showPanel(html);
    this._renderInvItems(player, 0, actions);
    // tab 切换
    document.getElementById('inv-tabs').onclick = (e)=>{
      const t = e.target.closest('.tab');
      if(!t) return;
      document.querySelectorAll('#inv-tabs .tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      this._renderInvItems(player, parseInt(t.dataset.tab), actions);
    };
    this._renderEquip(player, actions);
  }

  _renderInvItems(player, tabIdx, actions){
    const grid = document.getElementById('inv-grid');
    const filter = ['all','weapon','armor','potion','material','other'][tabIdx];
    grid.innerHTML = '';
    let items = player.inventory.filter(it=>{
      if(filter==='all') return true;
      if(filter==='weapon') return it.type==='weapon';
      if(filter==='armor') return it.type==='armor';
      if(filter==='potion') return it.type==='potion' || it.type==='food';
      if(filter==='material') return it.type==='material' || it.type==='ammo';
      return !['weapon','armor','potion','food','material','ammo'].includes(it.type);
    });
    // 合并可堆叠
    if(items.length === 0){ grid.innerHTML = '<div style="color:#8a93a6;font-size:12px;grid-column:1/-1">空空如也</div>'; return; }
    for(const item of items){
      const cls = qualityClass(item.quality);
      const sub = itemSubInfo(item);
      const node = el('div','inv-item');
      node.innerHTML = `<span class="ii-icon">${item.icon||'❓'}</span><div class="ii-info"><div class="ii-name ${cls}">${itemName(item)}</div><div class="ii-sub">${sub}</div></div>`;
      node.onclick = ()=>this._showItemMenu(player, item, node, actions);
      grid.appendChild(node);
    }
  }

  _showItemMenu(player, item, anchor, actions){
    this._closeContextMenu();
    const menu = el('div','context-menu');
    const rect = anchor.getBoundingClientRect();
    const panelRect = document.getElementById('panel-content').getBoundingClientRect();
    menu.style.left = (rect.left - panelRect.left) + 'px';
    menu.style.top = (rect.bottom - panelRect.top + 2) + 'px';
    const opts = [];
    if(item.type==='weapon' || item.type==='armor') opts.push({label:'装备', fn:()=>actions.equip(item)});
    if(item.type==='food') opts.push({label:'食用', fn:()=>actions.use(item)});
    if(item.type==='potion') opts.push({label:'使用', fn:()=>actions.use(item)});
    if(item.type==='tool') opts.push({label:'使用', fn:()=>actions.use(item)});
    if(item.type==='ammo') opts.push({label:'装填', fn:()=>actions.use(item)});
    opts.push({label:'丢弃', fn:()=>actions.drop(item)});
    opts.push({label:'取消', fn:()=>{}});
    for(const o of opts){
      const mi = el('div','cm-item');
      mi.textContent = o.label;
      mi.onclick = ()=>{ o.fn(); this._closeContextMenu(); };
      menu.appendChild(mi);
    }
    document.getElementById('panel-content').appendChild(menu);
    this._currentMenu = menu;
  }
  _closeContextMenu(){ if(this._currentMenu){ this._currentMenu.remove(); this._currentMenu=null; } }

  _renderEquip(player, actions){
    const div = document.getElementById('equip-slots');
    const slots = ['武器','身体','头部','披风','盾牌','项链','弹药'];
    let html = '';
    for(const s of slots){
      const it = player.equipment[s];
      const cls = it?qualityClass(it.quality):'';
      html += `<span class="equip-slot ${cls}" data-slot="${s}" style="cursor:pointer">${s}: ${it?itemName(it):'空'}</span> `;
    }
    // 戒指
    html += `<span class="equip-slot" style="cursor:pointer">戒指: ${player.equipment['戒指']?.length||0}</span>`;
    div.innerHTML = html;
    div.querySelectorAll('.equip-slot').forEach(n=>{
      n.onclick = ()=>{
        const slot = n.dataset.slot;
        if(slot && player.equipment[slot]) actions.unequip(slot);
      };
    });
  }

  // ========== 角色面板 ==========
  showCharacterSheet(player){
    let html = `<button class="btn-close" onclick="document.getElementById('panel-overlay').classList.add('hidden')">关闭 (Esc)</button>`;
    html += `<h2>${player.name} — ${RACES[player.race]?.name||''} ${CLASSES[player.class]?.name||''}</h2>`;
    html += `<table class="stat-table"><tbody>`;
    row('等级', player.level); row('经验', `${player.xp} / ${player.xpNext}`);
    row('HP', `${Math.floor(player.hp)} / ${player.maxHp}`);
    row('MP', `${Math.floor(player.mp)} / ${player.maxMp}`);
    row('体力', `${Math.floor(player.stamina)} / ${player.maxStamina}`);
    row('饱食度', Math.floor(player.food));
    row('速度', player.speed);
    row('DV 闪避', player.dv); row('PV 护甲', player.pv);
    row('命中率', Math.floor(player.hit||0)); row('暴击率', Math.floor(player.crit||0)+'%');
    row('幸运', player.luck||0); row('善恶值', player.karma);
    row('金币', player.gold); row('白金币', countPlatinum(player));
    if(player.faith) row('信仰', `${GODS[player.faith]?.name||player.faith} (虔诚 ${player.piety})`);
    html += '</tbody></table>';
    html += '<h3 style="color:#e0b34a;margin-top:12px">主属性</h3><table class="stat-table"><tbody>';
    for(const a of ATTRS) row(a, player.getAttr(a));
    html += '</tbody></table>';
    // 技能
    html += '<h3 style="color:#e0b34a;margin-top:12px">技能</h3><table class="stat-table"><tbody>';
    const sk = Object.keys(player.skills||{});
    if(sk.length===0) html += '<tr><td style="color:#8a93a6">无技能</td></tr>';
    for(const k of sk){
      const s = player.skills[k];
      const info = SKILLS[k];
      html += `<tr><td class="st-name">${info?info.icon:''} ${k} <span style="color:#8a93a6;font-size:10px">(${info?info.cat:''})</span></td><td class="st-val">Lv${s.level} (${s.xp.toFixed(0)}/${(s.level+1)*50}) 潜力${s.potential}</td></tr>`;
    }
    html += '</tbody></table>';
    // 法术
    const sps = Object.keys(player.spells||{});
    if(sps.length){
      html += '<h3 style="color:#e0b34a;margin-top:12px">法术</h3><table class="stat-table"><tbody>';
      for(const sid of sps){
        const sp = SPELLS[sid]; const s = player.spells[sid];
        html += `<tr><td class="st-name">${sp.icon} ${sp.name} <span style="color:#8a93a6;font-size:10px">(${sp.ele} MP${sp.mp})</span></td><td class="st-val">剩余 ${s.stock} 次</td></tr>`;
      }
      html += '</tbody></table>';
    }
    // 抗性
    html += '<h3 style="color:#e0b34a;margin-top:12px">元素抗性</h3><table class="stat-table"><tbody>';
    for(const e of ['火','冰','雷','暗','自然']) row(e+'抗', player.getResist(e)+'%');
    html += '</tbody></table>';
    this.showPanel(html);

    function row(label, val){
      html += `<tr><td class="st-name">${label}</td><td class="st-val">${val}</td></tr>`;
    }
  }

  // ========== 死亡画面 ==========
  showGameOver(player, onRespawn, onRestart){
    document.getElementById('go-title').textContent = '你死了';
    document.getElementById('go-desc').textContent = `${player.name} 在 Lv.${player.level} 时陨落，共击杀 ${player.killCount||0} 个敌人，存活 ${player.turnsAlive||0} 回合。`;
    const stats = document.getElementById('go-stats');
    stats.innerHTML = `
      死亡惩罚：部分属性经验减少，损失 10% 金币<br>
      当前金币：${player.gold} → ${Math.floor(player.gold*0.9)}<br>
      死亡次数：${(player.deaths||0)+1}`;
    document.getElementById('game-over').classList.remove('hidden');
    document.getElementById('respawn-btn').onclick = onRespawn;
    document.getElementById('restart-btn').onclick = onRestart;
  }
  hideGameOver(){ document.getElementById('game-over').classList.add('hidden'); }

  // ========== 设置面板 ==========
  initSettings(){
    this._loadSettings();
    const panel = document.getElementById('settings-panel');
    const btn = document.getElementById('settings-btn');
    const closeBtn = document.getElementById('settings-close');

    btn.onclick = ()=> this.toggleSettings();
    closeBtn.onclick = ()=> this.hideSettings();

    // 点击面板外部关闭
    document.addEventListener('click', (e)=>{
      if(!panel.classList.contains('hidden') && 
         !panel.contains(e.target) && 
         !btn.contains(e.target)){
        this.hideSettings();
      }
    });

    // 绑定开关事件
    const toggleMap = {
      'set-fog-gradient': 'fogGradient',
      'set-vignette': 'vignette',
      'set-top-gradient': 'topGradient',
      'set-bottom-gradient': 'bottomGradient',
      'set-color-grading': 'colorGrading',
      'set-auto-pickup': 'autoPickup',
      'set-show-help': 'showHelp',
      'set-dmg-popups': 'dmgPopups'
    };
    for(const [id, key] of Object.entries(toggleMap)){
      const el = document.getElementById(id);
      if(!el) continue;
      el.checked = this.settings[key];
      el.addEventListener('change', ()=>{
        this.settings[key] = el.checked;
        this._saveSettings();
        this._notifySettingsChange(key, el.checked);
      });
    }
  }

  toggleSettings(){
    if(document.getElementById('settings-panel').classList.contains('hidden')){
      this.showSettings();
    } else {
      this.hideSettings();
    }
  }

  showSettings(){
    document.getElementById('settings-panel').classList.remove('hidden');
  }

  hideSettings(){
    document.getElementById('settings-panel').classList.add('hidden');
  }

  isSettingsOpen(){
    return !document.getElementById('settings-panel').classList.contains('hidden');
  }

  onSettingsChange(cb){
    this._settingsListeners.push(cb);
  }

  _notifySettingsChange(key, value){
    for(const cb of this._settingsListeners) cb(key, value);
  }

  _loadSettings(){
    try {
      const saved = localStorage.getItem('elin_settings');
      if(saved){
        const obj = JSON.parse(saved);
        for(const k in this.settings){
          if(k in obj) this.settings[k] = obj[k];
        }
      }
    } catch(e){}
  }

  _saveSettings(){
    try {
      localStorage.setItem('elin_settings', JSON.stringify(this.settings));
    } catch(e){}
  }
}

// ---- 辅助 ----
function el(tag, cls){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  return e;
}
function setBar(id, val, max){
  const bar = document.getElementById(id+'-bar');
  const txt = document.getElementById(id+'-text');
  if(bar) bar.style.width = Math.max(0, Math.min(100, (val/max)*100)) + '%';
  if(txt) txt.textContent = `${Math.floor(val)} / ${Math.floor(max)}`;
}
function countPlatinum(player){
  const p = player.inventory.find(it=>it.id==='platinum');
  return p ? (p._count||1) : 0;
}
function itemSubInfo(item){
  let parts = [];
  if(item.type==='weapon') parts.push(`${item.dice||''}+${item.bonus||0}`);
  if(item.type==='armor') parts.push(`PV${item.pv||0} DV${item.dv||0}`);
  if(item.food) parts.push(`饱食+${item.food}`);
  if(item.use) parts.push(item.use==='heal'?'治疗':item.use==='cure'?'解毒':'使用');
  if(item.weight) parts.push(`${item.weight}s`);
  if(qualityName(item.quality)) parts.push(qualityName(item.quality));
  if(item.enchants && item.enchants.length) parts.push(item.enchants.map(e=>`${e.name}+${e.val}`).join(' '));
  return parts.join(' · ');
}
