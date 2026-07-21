// 材质程序化着色 (Procedural Material Tint)
// ============================================================
// Elin 原版中 floors.png / blocks.png 是【灰度遮罩图集】，本身没有颜色。
// 颜色由 SourceMaterial.matColor 提供（定义在 Material 表的
//   addColorMain(RRGGBBAA) / addColorAlt(...) 标签里），
// 渲染时着色器对灰度贴图做 multiply 着色：
//   final = grayscaleTex * matColor
// 见 BaseTileMap.GetColorInt / SourceMaterial.Row.matColor。
//
// 这里用同一思路：按材质 alias 提供 tint 颜色，绘制时 multiply。
// 颜色为 RGB(0-255)，绘制时会 /255 与灰度纹理相乘。
// 接近白色(>=250)视为不着色（石头/玻璃/大理石等保持灰度原貌）。
//
// 调色参考 elina-modding 材质表 + ylvapedia Dye 表（grass=黄绿, oak=红棕…）。

export const MAT_TINTS = {
  // —— 中性（不着色，灰度即最终色）——
  granite:   [255, 255, 255],
  marble:    [255, 255, 255],
  glass:     [245, 248, 252],
  slate:     [236, 239, 245],
  silver:    [232, 236, 242],
  phyllite:  [240, 240, 240],
  snow:      [255, 255, 255],
  cloud:     [240, 245, 255],
  iron:      [228, 230, 236],
  cotton:    [255, 255, 255],

  // —— 岩石/金属（轻微冷色，增加层次）——
  steel:     [200, 210, 225],
  mica:      [195, 215, 235],
  limestone: [218, 234, 245],

  // —— 植物/土壤 ——
  grass:     [165, 235, 120],   // 黄绿
  soil:      [178, 128, 78],
  soil_deep: [156, 98, 66],
  silt:      [206, 176, 126],
  mud:       [142, 102, 62],
  straw:     [226, 206, 126],
  hemp:      [216, 206, 126],
  pine:      [216, 206, 122],   // 黄木
  cedar:     [186, 126, 76],
  oak:       [226, 156, 96],    // 红棕木
  diorite:   [122, 182, 122],   // 深绿岩

  // —— 沙/冰/水 ——
  sand:      [232, 212, 156],
  ice:       [168, 216, 246],
  water:     [92, 166, 236],

  // —— 宝石/矿 ——
  rubinus:   [226, 72, 82],     // 红
  emerald:   [72, 210, 132],    // 绿
  topaz:     [246, 216, 96],    // 黄
  cobalt:    [96, 146, 236],    // 蓝
  gold:      [246, 216, 96],
  copper:    [206, 136, 96],
  meteorite: [166, 116, 206],   // 紫
  obsidian:  [72, 72, 86],      // 近黑

  // —— 熔岩 ——
  magma:     [236, 132, 66],    // 橙红
};

// 返回材质 alias 对应的 tint（RGB 数组），不着色返回 null
export function tintForMat(mat) {
  if (!mat) return null;
  const t = MAT_TINTS[mat];
  if (!t) return null;
  if (t[0] >= 250 && t[1] >= 250 && t[2] >= 250) return null;
  return t;
}

// 调试便利（与 game.js 暴露 window.MAT/GROUPS/BIOMES 一致）
if (typeof window !== 'undefined') {
  window.tintForMat = tintForMat;
  window.MAT_TINTS = MAT_TINTS;
}
