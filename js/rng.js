// ===== RNG 与骰子系统 =====
// 可种子化的随机数生成器（Mulberry32）

export class RNG{
  constructor(seed=Date.now()){
    this.seed = seed >>> 0;
    this.state = this.seed;
  }
  next(){
    let t = this.state += 0x6D2B79F5;
    t = Math.imul(t ^ t>>>15, t | 1);
    t ^= t + Math.imul(t ^ t>>>7, t | 61);
    return ((t ^ t>>>14) >>> 0) / 4294967296;
  }
  // [min, max] 整数
  int(min,max){ return Math.floor(this.next()*(max-min+1))+min; }
  // [0,1)
  float(){ return this.next(); }
  // 概率
  chance(p){ return this.next() < p; }
  // 从数组随机取
  pick(arr){ return arr[Math.floor(this.next()*arr.length)]; }
  // 范围内浮点
  range(min,max){ return this.next()*(max-min)+min; }
  // 打乱数组
  shuffle(arr){
    const a = arr.slice();
    for(let i=a.length-1;i>0;i--){
      const j = Math.floor(this.next()*(i+1));
      [a[i],a[j]] = [a[j],a[i]];
    }
    return a;
  }
}

export const rng = new RNG();

// 解析骰子表达式 "XdY+Z" => {count, sides, bonus}
export function parseDice(expr){
  expr = String(expr).replace(/\s/g,'');
  const m = expr.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if(!m) return {count:1,sides:1,bonus:0};
  return {count:parseInt(m[1]),sides:parseInt(m[2]),bonus:m[3]?parseInt(m[3]):0};
}

// 掷骰子
export function rollDice(expr, r=rng){
  const d = parseDice(expr);
  let total = d.bonus;
  for(let i=0;i<d.count;i++) total += r.int(1,d.sides);
  return Math.max(0, total);
}

// 骰子表达式字符串展示
export function diceStr(expr){
  const d = parseDice(expr);
  return `${d.count}d${d.sides}${d.bonus>=0?'+':''}${d.bonus}`;
}
