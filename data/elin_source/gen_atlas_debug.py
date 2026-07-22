#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 atlas-debug.html —— 同 tile 值、多图集并列裁切，人工目视判断某 obj 的贴图
到底属于哪张图集。tile 值不变，只换图集。
点击某图集格子即标记"正确图集"，可一键导出确认结果 JSON。

图集纳入原则（assets/elin 中）：
  - 等格精灵图集全部纳入：核心(objs/objs_S/objs_L/objs_SS/blocks) +
    雪变体(objs_snow/objs_S_snow/objs_L_snow/blocks_snow) + 遮罩(objs_C/objs_CL/objs_CLL) +
    地板(floors/floors_snow)。
  - 排除：roofs(非等格，屋顶样式由 roofStyles 决定，纹理1152x2000 无法整除，cell 源码无)；
    shadows/world/fov/bird1(工具/世界贴图，非 obj 图集)。
  - 遮罩(objs_C/CL/CLL)是运行时着色遮罩(灰度剪影)，不是精灵来源，但同 objs 网格，
    纳入供对照，UI 标"(遮罩)"。
"""
import json, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ASSET = os.path.join(HERE, '..', '..', 'assets', 'elin')
OUT = os.path.join(HERE, '..', '..', 'atlas-debug.html')

# (key, png, cellW, cellH, group, label)
# group: core / snow / mask / floor
# cell 尺寸 = 游戏权威值（解析 resources.assets 的 RenderData→MeshPass→ProceduralMesh.tiling，
# cell = 纹理尺寸 / tiling；见 render_atlas_truth.json）。
ATLAS_LIST = [
    ('objs',        'objs.png',        64, 64, 'core',  'objs'),
    ('objs_S',      'objs_S.png',      32, 32, 'core',  'objs_S'),
    ('objs_L',      'objs_L.png',      80, 64, 'core',  'objs_L'),        # 游戏真值 80x64（原 80x32 错误）
    ('objs_SS',     'objs_SS.png',     32, 32, 'core',  'objs_SS(未用)'), # 游戏无 pass 引用，legacy 猜测
    ('blocks',      'blocks.png',      64, 64, 'core',  'blocks'),
    ('roofs',       'roofs.png',       96, 80, 'core',  'roofs'),         # 游戏真值 96x80（原缺失）
    ('objs_snow',   'objs_snow.png',   64, 64, 'snow',  'objs_snow'),
    ('objs_S_snow', 'objs_S_snow.png', 32, 32, 'snow',  'objs_S_snow'),
    ('objs_L_snow', 'objs_L_snow.png', 80, 64, 'snow',  'objs_L_snow'),  # 同 objs_L 80x64
    ('blocks_snow', 'blocks_snow.png', 64, 64, 'snow',  'blocks_snow'),
    ('objs_C',      'objs_C.png',      128,128, 'chara', 'objs_C(角色)'),  # pass chara 128x128
    ('objs_CL',     'objs_CL.png',     128,256, 'chara', 'objs_CL(角色)'), # pass charaL 128x256（charaLW 变体 256x256）
    ('objs_CLL',    'objs_CLL.png',    256,256, 'chara', 'objs_CLL(角色)'),# pass charaLL 256x256（原 32x32 错误）
    ('floors',      'floors.png',      64, 48, 'floor', 'floors'),
    ('floors_snow', 'floors_snow.png', 64, 48, 'floor', 'floors_snow'),
]

# 实际尺寸（仅用于 out-of-range 检测，从文件读）
def file_dims(png):
    im = Image.open(os.path.join(ASSET, png)).convert('RGBA')
    return im.size[0], im.size[1]

ATLAS_INFO = {}
for key, png, cw, ch, grp, label in ATLAS_LIST:
    w, h = file_dims(png)
    ATLAS_INFO[key] = {'png': png, 'cw': cw, 'ch': ch, 'cols': w // cw, 'rows': h // ch,
                       'group': grp, 'label': label}

RENDER_TO_ATLAS = {
    'obj': 'objs', 'obj wheat': 'objs',
    'obj_LV': 'objs_S', 'obj_S': 'objs_S', 'obj_S flat': 'objs_S', 'obj_S fish': 'objs_S',
    'floor_obj': 'objs_S', 'roof': 'objs_S', 'support': 'objs_S',
    'block mount': 'blocks', 'block': 'blocks',
    'obj road': 'objs', 'obj road chasm': 'objs', 'ramp': 'objs',
    'obj flat': 'objs_L', 'obj tall': 'objs_L',
}

def transparent_at(key, tile):
    a = ATLAS_INFO[key]
    col, row = tile % 100, tile // 100
    if row >= a['rows'] or col >= a['cols']:
        return True
    im = Image.open(os.path.join(ASSET, a['png'])).convert('RGBA')
    x, y = col * a['cw'], row * a['ch']
    if x + a['cw'] > im.size[0] or y + a['ch'] > im.size[1]:
        return True
    px = im.crop((x, y, x + a['cw'], y + a['ch'])).getdata()
    return sum(1 for r, g, b, al in px if al > 8) == 0

src = json.load(open(os.path.join(HERE, 'sources.json'), encoding='utf-8'))['SourceBlock']['Obj']['byId']
final = json.load(open(os.path.join(HERE, 'obj_id_rect.json'), encoding='utf-8'))['OBJ_ID_RECT']

recs = []
for sid, v in src.items():
    tiles = v.get('tiles') or []
    tile = None
    for t in tiles:
        if isinstance(t, int):
            if t >= 0:
                tile = t
                break
            elif tile is None:
                tile = -t
    if tile is None:
        continue
    rd = v.get('_idRenderData')
    guess = RENDER_TO_ATLAS.get(rd)
    cur = final.get(sid, {})
    risk = 'ok'
    if guess != cur.get('tex'):
        risk = 'med'
    if guess and transparent_at(guess, tile):
        risk = 'high'
    recs.append({
        'id': int(sid),
        'name': v.get('name') or v.get('name_JP'),
        '_idRenderData': rd,
        'tile': tile,
        'guess': guess,
        'cur': cur.get('tex'),
        'risk': risk,
    })
recs.sort(key=lambda r: r['id'])

DATA_JS = json.dumps(recs, ensure_ascii=False)
ATLAS_JS = json.dumps(ATLAS_INFO, ensure_ascii=False)
GROUPS_JS = json.dumps([g for g in ['core', 'snow', 'mask', 'floor']])

html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Elin obj 图集判定调试工具</title>
<style>
  :root { --bg:#0f1115; --card:#1a1d24; --line:#2a2f3a; --txt:#e6e6e6; --mut:#8a93a6; --hl:#4da3ff; --ok:#3fb950; --warn:#f0883e; --bad:#f85149; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--txt); font:14px/1.5 system-ui,"Segoe UI",sans-serif; }
  header { position:sticky; top:0; z-index:10; background:#14171d; border-bottom:1px solid var(--line); padding:10px 16px; }
  header h1 { margin:0 0 6px; font-size:16px; }
  .bar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .bar input[type=text]{ background:#0c0e12; border:1px solid var(--line); color:var(--txt); padding:6px 9px; border-radius:6px; min-width:200px; }
  .bar label{ color:var(--mut); display:flex; gap:5px; align-items:center; }
  .bar button{ background:var(--hl); border:0; color:#04121f; font-weight:600; padding:6px 12px; border-radius:6px; cursor:pointer; }
  .bar .count{ color:var(--mut); margin-left:auto; }
  .chips{ display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
  .chip{ font-size:12px; padding:3px 10px; border-radius:20px; border:1px solid var(--line); color:var(--mut); cursor:pointer; user-select:none; }
  .chip.on{ background:var(--hl); color:#04121f; border-color:var(--hl); font-weight:600; }
  .legend{ color:var(--mut); font-size:12px; padding:6px 16px 0; }
  .legend b.hl{ color:var(--hl); } .legend b.warn{ color:var(--warn); } .legend b.bad{ color:var(--bad); }
  #list{ padding:14px 16px 60px; display:grid; gap:12px; grid-template-columns:repeat(auto-fill,minmax(460px,1fr)); }
  .card{ background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px; }
  .card.high{ border-color:var(--bad); }
  .hd{ display:flex; align-items:baseline; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
  .hd .nm{ font-weight:700; font-size:15px; }
  .hd .id{ color:var(--mut); font-size:12px; }
  .hd .rd{ color:var(--mut); font-size:12px; }
  .hd .tag{ font-size:11px; padding:1px 7px; border-radius:20px; }
  .tag.high{ background:rgba(248,81,73,.18); color:var(--bad); }
  .tag.med{ background:rgba(240,136,62,.18); color:var(--warn); }
  .tag.ok{ background:rgba(63,185,80,.15); color:var(--ok); }
  .cells{ display:flex; gap:8px; flex-wrap:wrap; overflow-x:auto; padding-bottom:4px; }
  .acell{ text-align:center; flex:0 0 auto; }
  .acell .cap{ font-size:11px; color:var(--mut); margin-bottom:3px; white-space:nowrap; }
  .acell .cap b{ color:var(--txt); }
  .acell .cap .cs{ font-size:10px; color:var(--mut); margin-left:6px; font-weight:400; }
  .crop{ border:2px solid var(--line); border-radius:6px; background-color:#000; background-repeat:no-repeat; cursor:pointer; position:relative; }
  .acell.pick .crop{ border-color:var(--ok); box-shadow:0 0 0 2px rgba(63,185,80,.35); }
  .acell.cur .cap b{ color:var(--hl); }
  .acell.cur .crop{ outline:2px dashed var(--hl); outline-offset:1px; }
  .acell.oor .crop::after{ content:"超出范围"; position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:10px; color:var(--bad); background:rgba(0,0,0,.55); }
  .acell .row{ font-size:10px; color:var(--mut); margin-top:2px; }
  #export{ position:fixed; left:50%; bottom:18px; transform:translateX(-50%); background:var(--ok); color:#04121f; font-weight:700; border:0; padding:10px 20px; border-radius:30px; cursor:pointer; box-shadow:0 4px 16px rgba(0,0,0,.4); display:none; }
  #result{ display:none; position:fixed; inset:0; background:rgba(0,0,0,.7); z-index:50; padding:40px; }
  #result pre{ background:#0c0e12; border:1px solid var(--line); border-radius:8px; padding:16px; color:var(--txt); height:100%; overflow:auto; }
  #result .x{ position:absolute; top:20px; right:30px; color:#fff; font-size:22px; cursor:pointer; }
  .empty{ color:var(--mut); padding:30px; text-align:center; }
</style>
</head>
<body>
<header>
  <h1>Elin obj 图集判定调试工具</h1>
  <div class="bar">
    <input id="q" type="text" placeholder="搜索 id / 名称 / _idRenderData …">
    <label><input id="onlyRisk" type="checkbox" checked> 仅显示可疑</label>
    <label>每格 <input id="cell" type="number" value="72" min="36" max="180" style="width:58px"> px</label>
    <button id="exportBtn">导出确认结果</button>
    <span class="count" id="cnt"></span>
  </div>
  <div class="chips" id="chips"></div>
</header>
<div class="legend">
  同 <b class="hl">tile 值</b> 不变，各图集裁同一 (行,列) 格子。看哪个图集里的精灵名字对得上，点那格标记为「正确图集」。
  <b class="bad">红框</b>=前缀约定图集落空(真实可疑)；<b class="warn">橙标</b>=约定图集≠当前加载；蓝虚线=当前 H5 实际加载图集。
  遮罩图集(objs_C/CL/CLL)显示灰度剪影仅供对照。roofs/shadows/world/fov/bird1 非等格 obj 图集，已排除。
</div>
<div id="list"></div>
<button id="export">导出确认结果</button>
<div id="result"><span class="x" onclick="document.getElementById('result').style.display='none'">×</span><pre id="resultTxt"></pre></div>

<script>
const OBJS = __DATA__;
const ATLAS = __ATLAS__;
const GROUPS = __GROUPS__;
const GROUP_LABEL = {core:'核心', snow:'雪变体', mask:'遮罩', floor:'地板'};
const ON_GROUPS = new Set(GROUPS); // 默认全开

function atlasKeys(){
  return Object.keys(ATLAS).filter(k => ON_GROUPS.has(ATLAS[k].group));
}
function decodeCell(key, tile){
  const a = ATLAS[key];
  const col = tile % 100, row = Math.floor(tile/100);
  const oor = (row >= a.rows) || (col >= a.cols);
  return { col, row, oor };
}
function cellHTML(o, key, size){
  const a = ATLAS[key];
  const {col,row,oor} = decodeCell(key, o.tile);
  const bgw = a.cols*size, bgh = a.rows*size;
  const bx = -col*size, by = -row*size;
  const isCur = (o.cur === key);
  const isPick = (o._pick === key);
  const cls = ['acell'] + (oor?' oor':'') + (isCur?' cur':'') + (isPick?' pick':'');
  const tag = isCur ? ' (当前)' : '';
  return `<div class="${cls}" data-atlas="${key}" title="${a.label} cell=${a.cw}x${a.ch} 行${row}列${col} tile=${o.tile}">
    <div class="cap"><b>${a.label}${tag}</b><span class="cs">${a.cw}×${a.ch}</span></div>
    <div class="crop" style="width:${size}px;height:${size}px;background-image:url('assets/elin/${a.png}');background-size:${bgw}px ${bgh}px;background-position:${bx}px ${by}px;"></div>
    <div class="row">行${row} 列${col}</div>
  </div>`;
}
function cardHTML(o, size){
  const tagMap = {high:'真实可疑', med:'约定≠当前', ok:'一致'};
  const cells = atlasKeys().map(k=>cellHTML(o,k,size)).join('');
  return `<div class="card ${o.risk}" data-id="${o.id}" data-name="${(o.name||'').toLowerCase()}" data-rd="${(o._idRenderData||'').toLowerCase()}">
    <div class="hd">
      <span class="nm">${o.name||('id'+o.id)}</span>
      <span class="id">#${o.id}</span>
      <span class="rd">${o._idRenderData}</span>
      <span class="tag ${o.risk}">${tagMap[o.risk]}</span>
      <span class="id">tile=${o.tile}</span>
    </div>
    <div class="cells">${cells}</div>
  </div>`;
}
function renderChips(){
  const el = document.getElementById('chips');
  el.innerHTML = GROUPS.map(g=>`<span class="chip ${ON_GROUPS.has(g)?'on':''}" data-g="${g}">${GROUP_LABEL[g]}</span>`).join('');
}
function render(){
  const size = parseInt(document.getElementById('cell').value)||72;
  const q = document.getElementById('q').value.trim().toLowerCase();
  const onlyRisk = document.getElementById('onlyRisk').checked;
  const list = document.getElementById('list');
  const vis = OBJS.filter(o=>{
    if(onlyRisk && o.risk==='ok') return false;
    if(q){ return ((''+o.id)===q) || (o.name&&o.name.toLowerCase().includes(q)) || (o._idRenderData&&o._idRenderData.toLowerCase().includes(q)); }
    return true;
  });
  list.innerHTML = vis.length ? vis.map(o=>cardHTML(o,size)).join('') : '<div class="empty">无匹配</div>';
  document.getElementById('cnt').textContent = `显示 ${vis.length} / ${OBJS.length}`;
}
document.getElementById('chips').addEventListener('click', e=>{
  const c = e.target.closest('.chip'); if(!c) return;
  const g = c.dataset.g;
  if(ON_GROUPS.has(g)) ON_GROUPS.delete(g); else ON_GROUPS.add(g);
  renderChips(); render();
});
document.getElementById('list').addEventListener('click', e=>{
  const crop = e.target.closest('.acell .crop');
  if(!crop) return;
  const acell = crop.closest('.acell');
  const card = crop.closest('.card');
  const id = +card.dataset.id;
  const atlas = acell.dataset.atlas;
  const o = OBJS.find(x=>x.id===id);
  if(o._pick === atlas){ o._pick = undefined; }
  else { o._pick = atlas; }
  render();
  syncExport();
});
function syncExport(){
  const picks = OBJS.filter(o=>o._pick);
  document.getElementById('export').style.display = picks.length? 'block':'none';
}
function doExport(){
  const picks = OBJS.filter(o=>o._pick).map(o=>({id:o.id, name:o.name, _idRenderData:o._idRenderData, tile:o.tile, confirmedAtlas:o._pick, prevAtlas:o.cur}));
  const txt = JSON.stringify(picks, null, 2);
  document.getElementById('resultTxt').textContent = txt;
  document.getElementById('result').style.display = 'block';
  const blob = new Blob([txt], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'obj_atlas_confirm.json';
  a.click();
}
document.getElementById('exportBtn').addEventListener('click', doExport);
document.getElementById('export').addEventListener('click', doExport);
document.getElementById('q').addEventListener('input', render);
document.getElementById('onlyRisk').addEventListener('change', render);
document.getElementById('cell').addEventListener('input', render);
renderChips();
render();
</script>
</body>
</html>
'''

html = html.replace('__DATA__', DATA_JS).replace('__ATLAS__', ATLAS_JS).replace('__GROUPS__', GROUPS_JS)
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(html)
print('wrote', OUT, '| objs:', len(recs), '| high-risk:', sum(1 for r in recs if r['risk']=='high'), '| atlases:', len(ATLAS_LIST))
