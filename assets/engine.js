
(function(){
  "use strict";

  /* =========================================================
     一、时间轴
     ========================================================= */
  var CFG = window.KLINE_DATA || {};
  var Y0 = CFG.y0 || 2000, M0 = CFG.m0 || 1;
  var LAST_Y = CFG.lastY || 2026, LAST_M = CFG.lastM || 10;
  function idxOf(y, m){ return (y - Y0) * 12 + (m - M0); }
  var NUM = idxOf(LAST_Y, LAST_M) + 1;
  function ymOf(i){
    var N = i + (M0 - 1);
    return { y: Y0 + Math.floor(N / 12), m: (N % 12) + 1 };
  }

  /* =========================================================
     二、六维权重
     ========================================================= */
  var W = { edu:0.22, mind:0.22, thought:0.15, body:0.15, wea:0.13, skill:0.13 };
  var DIMS = [
    { key:"edu",     name:"学历" },
    { key:"wea",     name:"财富" },
    { key:"mind",    name:"心态" },
    { key:"skill",   name:"技能" },
    { key:"thought", name:"思想" },
    { key:"body",    name:"身体" }
  ];

  /* =========================================================
     三、锚点
     [年, 月, 学历, 财富, 心态, 技能, 思想, 身体, 标签, 事件]
     ========================================================= */
  var A = CFG.anchors || [];

  /* =========================================================
     四、插值 → 六维月度序列 → 指数
     ========================================================= */
  function mulberry32(a){
    return function(){
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var rand = mulberry32(20040201);

  var KEYS = ["edu", "wea", "mind", "skill", "thought", "body"];
  var SER = {};                 // key -> 数组
  KEYS.forEach(function(k){ SER[k] = new Array(NUM).fill(null); });
  var META = {}, EVENTS = [], anchorIdx = [], OV = {};

  A.forEach(function(row){
    var i = idxOf(row[0], row[1]);
    for (var j = 0; j < 6; j++) SER[KEYS[j]][i] = row[2 + j];
    if (row[9]){
      META[i] = { label: row[8], note: row[9] };
      EVENTS.push({ i: i, y: row[0], m: row[1], label: row[8], note: row[9] });
    }
    // 第 11 项可选：{o, h, l} 手动指定该月的开高低，用来做针形、断崖这类特殊形态
    if (row[10]) OV[i] = row[10];
    if (anchorIdx.indexOf(i) < 0) anchorIdx.push(i);
  });
  anchorIdx.sort(function(a, b){ return a - b; });

  KEYS.forEach(function(k){
    var arr = SER[k];
    for (var t = 0; t < NUM; t++){
      if (arr[t] !== null) continue;
      var p = -1, q = -1;
      for (var j = 0; j < anchorIdx.length; j++){
        if (anchorIdx[j] < t) p = anchorIdx[j];
        if (anchorIdx[j] > t && q === -1) q = anchorIdx[j];
      }
      if (p === -1){ arr[t] = arr[anchorIdx[0]]; continue; }
      if (q === -1){ arr[t] = arr[p]; continue; }
      var r = (t - p) / (q - p);
      arr[t] = arr[p] + (arr[q] - arr[p]) * r;
    }
  });

  // 财富以「千元（K）」计量，按分段线性折算成 0—100 分
  function weaScore(k){
    var P = [[0,0],[1,5],[2,9],[5,15],[10,21],[20,30],[35,40],[50,48],[75,58],[100,64],[200,74]];
    if (k <= 0) return 0;
    for (var i = 0; i < P.length - 1; i++){
      if (k >= P[i][0] && k <= P[i + 1][0]){
        var t = (k - P[i][0]) / (P[i + 1][0] - P[i][0]);
        return P[i][1] + t * (P[i + 1][1] - P[i][1]);
      }
    }
    return P[P.length - 1][1];
  }

  // 财富权重随年龄递增：少年时钱几乎不构成尺度，成年后越来越重
  function weaWeight(age){
    var t = (age - 5) / 17;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return 0.04 + 0.11 * t;
  }

  // 合成为指数
  var DATA = [];
  var REST = 0.22 + 0.22 + 0.15 + 0.15 + 0.13;   // 除财富外的五个维度原始权重之和
  for (var s = 0; s < NUM; s++){
    var mm = ymOf(s);
    var age = (mm.y - Y0) + (mm.m - M0) / 12;
    var wW = weaWeight(age);
    var rest = 1 - wW;
    var k = rest / REST;

    var wS = (CFG.weaMode === "score") ? SER.wea[s] : weaScore(SER.wea[s]);
    var score =
      SER.edu[s] * (0.22 * k) +
      SER.mind[s] * (0.22 * k) +
      SER.thought[s] * (0.15 * k) +
      SER.body[s] * (0.15 * k) +
      SER.skill[s] * (0.13 * k) +
      wS * wW;
    score += (rand() - 0.5) * 0.5;

    DATA.push({
      i: s, y: mm.y, m: mm.m,
      d: {
        edu: SER.edu[s], wea: wS, weaK: SER.wea[s],
        mind: SER.mind[s], skill: SER.skill[s],
        thought: SER.thought[s], body: SER.body[s],
        wWea: wW
      },
      c: Math.max(0.2, +score.toFixed(2)),
      meta: META[s] || null,
      override: OV[s] || null
    });
  }

  // 生成 OHLC（收盘 = 指数）
  for (var s2 = 0; s2 < NUM; s2++){
    var d0 = DATA[s2];
    var prevC = s2 > 0 ? DATA[s2 - 1].c : 0;
    var isEv = !!d0.meta;
    var gapAmp = isEv ? 0.9 : 0.35;
    var o = prevC + (rand() - 0.5) * 2 * gapAmp;
    if (s2 === 0) o = 0;
    var body = Math.abs(d0.c - o);
    var vt = 0.25 + body * 0.06 + rand() * 0.38;
    var vb = 0.25 + body * 0.06 + rand() * 0.42;
    var h = Math.max(o, d0.c) + vt * (isEv ? 1.3 : 1);
    var l = Math.min(o, d0.c) - vb * (isEv ? 1.3 : 1);
    if (l < 0) l = 0;
    d0.o = +o.toFixed(2);
    d0.h = +h.toFixed(2);
    d0.l = +l.toFixed(2);
  }

  // 应用数据里手动指定的开高低（第 11 项）
  for (var oi = 0; oi < NUM; oi++){
    var od = DATA[oi];
    if (!od || !od.override) continue;
    if (od.override.o != null) od.o = od.override.o;
    if (od.override.h != null) od.h = od.override.h;
    if (od.override.l != null) od.l = od.override.l;
  }

  // 第一根从 0 起步
  DATA[0].o = 0;
  DATA[0].l = 0;
  if (DATA[0].c < 0.2) DATA[0].c = 0.2;
  if (DATA[0].h < 0.9) DATA[0].h = 0.9;

  // EMA（指数移动平均）
  var EMA_N = (CFG.indicators && CFG.indicators.ema) || 12;
  var EMA = [];
  var eK = 2 / (EMA_N + 1);
  for (var ei = 0; ei < NUM; ei++){
    EMA[ei] = (ei === 0) ? DATA[0].c : DATA[ei].c * eK + EMA[ei - 1] * (1 - eK);
  }

  // 每根蜡烛预生成 6 个离散跳价点（模拟真实报价的来回跳动）
  var TICKS = 6;
  for (var pi = 0; pi < NUM; pi++){
    var pd = DATA[pi];
    var rp = mulberry32(90210 + pi * 131);
    var dirUp = rp() < 0.5;
    var lo2 = pd.l, hi2 = pd.h;
    var span2 = Math.max(0.15, hi2 - lo2);
    var pp = [pd.o];
    pp.push(dirUp ? hi2 : lo2);
    pp.push(lo2 + span2 * (0.25 + rp() * 0.30));
    pp.push(dirUp ? lo2 : hi2);
    pp.push(lo2 + span2 * (0.30 + rp() * 0.40));
    pp.push(pd.c);
    pd.path = pp;
  }

  // 均线（周期可配）
  var MA_N = (CFG.indicators && CFG.indicators.ma) || 12;
  var MA = DATA.map(function(_, i){
    if (i < MA_N - 1) return null;
    var sum = 0;
    for (var j = i - MA_N + 1; j <= i; j++) sum += DATA[j].c;
    return sum / MA_N;
  });

  /* =========================================================
     五、阶段
     ========================================================= */
  var STAGES = CFG.stages || [];
  STAGES.forEach(function(s){
    s.start = idxOf(s.from[0], s.from[1]);
    s.end = idxOf(s.to[0], s.to[1]);
  });

  /* =========================================================
     六、DOM
     ========================================================= */
  var cv = document.getElementById("cv");
  var ctx = cv.getContext("2d");
  var tipEl = document.getElementById("tip");
  var ohlcEl = document.getElementById("ohlc");
  var rangeSub = document.getElementById("rangeSub");
  var dimsEl = document.getElementById("dims");

  var state = {
    range:"all", hover:-1, playing:false, speed:1, progress:NUM - 1,
    follow:false, winSize:48, yLo:null, yHi:null, flash:0, shake:0, scrollPos:null
  };
  var W_ = 0, H_ = 0, LAY = null, VIEW = [];

  var CSS = getComputedStyle(document.documentElement);
  function cssv(n){ return CSS.getPropertyValue(n).trim(); }
  var UP = cssv("--up"), DOWN = cssv("--down"), LINE = cssv("--line"),
      DIM = cssv("--dim"), MA_C = cssv("--ma"), EMA_C = cssv("--ema"), GOLD = cssv("--gold");

  function visible(){
    if (state.range === "all") return { from:0, to:NUM - 1 };
    var st = STAGES.filter(function(s){ return s.key === state.range; })[0];
    return { from:st.start, to:st.end };
  }

  function fmt(v, dec){
    dec = (dec === undefined) ? 1 : dec;
    return Number(v).toLocaleString("zh-CN", { minimumFractionDigits:dec, maximumFractionDigits:dec });
  }

  /* =========================================================
     七、绘制
     ========================================================= */
  function draw(){
    if (!W_ || !H_) return;
    ctx.clearRect(0, 0, W_, H_);

    ctx.save();
    if (state.shake > 0.01){
      ctx.translate(Math.sin(performance.now() / 15) * 6 * state.shake, 0);
    }

    var vr = visible();
    var isAll = state.range === "all";
    var isFollow = state.follow;

    // 视窗：跟随模式下只显示最近 winSize 个月，右侧留 2 格空白（未来）
    var viewStart, viewSize, iFrom, iTo;
    if (isFollow){
      viewSize = state.winSize;
      viewStart = Math.max(0, state.progress - viewSize + 2);
      iFrom = Math.max(0, Math.floor(viewStart));
      iTo = Math.min(NUM - 1, Math.ceil(viewStart + viewSize));
    } else {
      viewStart = vr.from;
      viewSize = vr.to - vr.from + 1;
      iFrom = vr.from;
      iTo = vr.to;
    }

    var IND = CFG.indicators || {};
    var useSub = !!IND.sub;
    var subH = useSub ? 66 : 0;
    var subGap = useSub ? 26 : 0;

    var padL = 44, padR = 52, bandH = 26, padT = bandH + 16, padB = 30;
    var plotL = padL, plotW = Math.max(40, W_ - padL - padR);
    var plotT = padT, plotH = Math.max(120, H_ - padT - padB - subH - subGap);
    var plotB = plotT + plotH;
    var subT = plotB + subGap;

    var slot = plotW / viewSize;
    var cw = Math.max(1.8, Math.min(slot * 0.66, 42));

    function xOf(g){ return plotL + (g - viewStart + 0.5) * slot; }

    // ---- 阶段带（顶部）----
    STAGES.forEach(function(st, si){
      var a = Math.max(st.start, viewStart);
      var b = Math.min(st.end, viewStart + viewSize - 1);
      if (b < a) return;
      var x1 = Math.max(plotL, plotL + (a - viewStart) * slot);
      var x2 = Math.min(plotL + plotW, plotL + (b - viewStart + 1) * slot);
      if (x2 - x1 < 2) return;

      ctx.fillStyle = (si % 2 === 0) ? "rgba(255,255,255,.045)" : "rgba(255,255,255,.018)";
      ctx.fillRect(x1, 4, x2 - x1, bandH - 4);

      if (x2 - x1 > 14){
        ctx.font = "11px -apple-system,'PingFang SC',sans-serif";
        ctx.fillStyle = "rgba(190,200,215,.72)";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(st.name, (x1 + x2) / 2, 4 + (bandH - 4) / 2);
      }
    });
    ctx.beginPath();
    ctx.strokeStyle = "rgba(43,53,72,.9)"; ctx.lineWidth = 1;
    ctx.moveTo(plotL, bandH + 2.5); ctx.lineTo(plotL + plotW, bandH + 2.5); ctx.stroke();

    // ---- Y 轴范围：只看窗口内「已发生」的部分 ----
    var yTo = isFollow ? Math.min(iTo, Math.floor(state.progress)) : iTo;
    var rawLo = Infinity, rawHi = 0;
    for (var gy = iFrom; gy <= yTo; gy++){
      var dy = DATA[gy];
      if (!dy) continue;
      if (dy.h > rawHi) rawHi = dy.h;
      if (dy.l < rawLo) rawLo = dy.l;
      if (MA[gy] != null){
        if (MA[gy] > rawHi) rawHi = MA[gy];
        if (MA[gy] < rawLo) rawLo = MA[gy];
      }
    }
    if (rawLo === Infinity) rawLo = 0;
    if (rawHi <= 0) rawHi = 1;
    if (rawHi - rawLo < 8) rawHi = rawLo + 8;

    function niceNum(r){
      var exp = Math.floor(Math.log(r) / Math.LN10);
      var f = r / Math.pow(10, exp), nf;
      if (f < 1.5) nf = 1; else if (f < 3) nf = 2; else if (f < 7) nf = 5; else nf = 10;
      return nf * Math.pow(10, exp);
    }
    var stepY = niceNum(Math.max(1, rawHi - rawLo) / 5);
    var tLo = Math.floor((rawLo - stepY * 0.15) / stepY) * stepY;
    if (tLo < 0) tLo = 0;
    var tHi = Math.ceil((rawHi + stepY * 0.15) / stepY) * stepY;

    var lo, hi;
    if (isAll && !isFollow){
      lo = 0;
      hi = Math.max(tHi, stepY * 2);
    } else {
      lo = tLo; hi = tHi;
    }

    // 跟随模式：Y 轴平滑过渡，不硬跳
    if (isFollow){
      if (state.yLo == null){ state.yLo = lo; state.yHi = hi; }
      else {
        state.yLo += (lo - state.yLo) * 0.15;
        state.yHi += (hi - state.yHi) * 0.15;
        lo = state.yLo; hi = state.yHi;
      }
    } else {
      state.yLo = null; state.yHi = null;
    }

    function yOf(v){ return plotB - (v - lo) / (hi - lo) * plotH; }

    // ---- 横向网格 ----
    ctx.font = "11px ui-monospace, Consolas, monospace";
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    var decY = stepY >= 1 ? 0 : (stepY >= 0.1 ? 1 : 2);
    var nTick = Math.round((tHi - tLo) / stepY);
    for (var g = 0; g <= nTick; g++){
      var val = tLo + stepY * g;
      var gy = yOf(val);
      if (gy < plotT - 1 || gy > plotB + 1) continue;
      var gy2 = Math.round(gy) + .5;
      ctx.beginPath();
      ctx.strokeStyle = "rgba(35,43,58,.62)"; ctx.lineWidth = 1;
      ctx.moveTo(plotL, gy2); ctx.lineTo(plotL + plotW, gy2); ctx.stroke();
      ctx.fillStyle = DIM;
      ctx.fillText(val.toFixed(decY), plotL - 10, gy2);
    }

    // ---- 蜡烛 ----
    // 正在成形的那一根：从开盘出发，先探高点、再探低点、最后收在收盘
    var curG = Math.floor(state.progress);
    var subP = state.progress - curG;
    var growing = (isFollow && curG < NUM - 1) ? { g: curG, sub: subP, price: null } : null;

    for (var gc = iFrom; gc <= iTo; gc++){
      if (isFollow && gc > state.progress) continue;
      var d = DATA[gc];
      if (!d) continue;
      var cx = xOf(gc);
      if (cx < plotL - 4 || cx > plotL + plotW + 4) continue;
      var xc = Math.round(cx) + .5;
      var bw = Math.max(1.8, cw);

      if (growing && gc === growing.g){
        var pp2 = d.path || [d.o, d.h, d.l, d.c];
        // Catmull-Rom 样条：方向与速度都连续，走起来是流动的
        var fpos = growing.sub * (pp2.length - 1);
        var i0 = Math.floor(fpos);
        if (i0 > pp2.length - 2) i0 = pp2.length - 2;
        var tt = fpos - i0;
        var p0 = pp2[Math.max(0, i0 - 1)];
        var p1 = pp2[i0];
        var p2 = pp2[i0 + 1];
        var p3 = pp2[Math.min(pp2.length - 1, i0 + 2)];
        var t2 = tt * tt, t3 = t2 * tt;
        var cur = 0.5 * ((2 * p1) + (-p0 + p2) * tt +
                         (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                         (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
        if (cur < d.l) cur = d.l;
        if (cur > d.h) cur = d.h;

        var hiS = cur, loS = cur;
        for (var qi = 0; qi <= i0; qi++){
          if (pp2[qi] > hiS) hiS = pp2[qi];
          if (pp2[qi] < loS) loS = pp2[qi];
        }
        growing.price = cur;

        var gcol = d.c >= d.o ? UP : DOWN;
        ctx.beginPath();
        ctx.strokeStyle = gcol; ctx.lineWidth = 1;
        ctx.moveTo(xc, yOf(hiS));
        ctx.lineTo(xc, yOf(loS));
        ctx.stroke();

        var gy1 = yOf(Math.max(d.o, cur));
        var gy2 = yOf(Math.min(d.o, cur));
        ctx.fillStyle = gcol;
        ctx.fillRect(cx - bw / 2, gy1, bw, Math.max(1.2, gy2 - gy1));
        continue;
      }

      var rise = d.c >= d.o;
      var col = rise ? UP : DOWN;

      ctx.beginPath();
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.moveTo(xc, yOf(d.h));
      ctx.lineTo(xc, yOf(d.l));
      ctx.stroke();

      var y1 = yOf(Math.max(d.o, d.c));
      var y2 = yOf(Math.min(d.o, d.c));
      var bh = Math.max(1.2, y2 - y1);
      ctx.fillStyle = col;
      ctx.fillRect(cx - bw / 2, y1, bw, bh);
    }

    // ---- 均线 ----
    ctx.beginPath();
    ctx.strokeStyle = MA_C; ctx.lineWidth = 1.6;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    var started = false;
    for (var q = iFrom; q <= iTo; q++){
      if (isFollow && q > state.progress) break;
      if (MA[q] == null) continue;
      var px = xOf(q), py = yOf(MA[q]);
      if (!started){ ctx.moveTo(px, py); started = true; }
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // ---- EMA 线（虚线）----
    if (CFG.indicators && CFG.indicators.ema){
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = EMA_C;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      var est = false;
      for (var qe = iFrom; qe <= iTo; qe++){
        if (isFollow && qe > state.progress) break;
        var pex = xOf(qe), pey = yOf(EMA[qe]);
        if (!est){ ctx.moveTo(pex, pey); est = true; }
        else ctx.lineTo(pex, pey);
      }
      ctx.stroke();
      ctx.restore();
    }

    // ---- 当前值 ----
    var lastG = isFollow ? Math.min(NUM - 1, Math.floor(state.progress)) : iTo;
    var last = DATA[lastG];
    var prevC = lastG > 0 ? DATA[lastG - 1].c : last.o;
    var lastCol = last.c >= prevC ? UP : DOWN;
    var lv = Math.round(yOf(last.c)) + .5;

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = lastCol; ctx.globalAlpha = .45; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(plotL, lv); ctx.lineTo(plotL + plotW + 3, lv); ctx.stroke();
    ctx.restore();

    var tag = fmt(last.c, 1);
    ctx.font = "600 11px ui-monospace, Consolas, monospace";
    var tw = ctx.measureText(tag).width + 13;
    ctx.fillStyle = lastCol;
    roundRect(plotL + plotW + 5, lv - 9, Math.min(tw, padR - 6), 18, 4);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(tag, plotL + plotW + 11, lv + .5);

    // ---- 事件标注 ----
    if (isFollow || !isAll){
      var marks = EVENTS.filter(function(ev){
        if (ev.i < viewStart - 1 || ev.i > viewStart + viewSize) return false;
        if (isFollow && ev.i > state.progress) return false;
        return true;
      });
      var rowUsed = [];
      marks.forEach(function(ev){
        var d = DATA[ev.i];
        var cx2 = xOf(ev.i);
        if (cx2 < plotL + 8 || cx2 > plotL + plotW - 8) return;
        var baseY = yOf(d.h) - 9;
        var row = 0;
        while (row < 3 && rowUsed.some(function(r){ return r.row === row && Math.abs(r.x - cx2) < 62; })) row++;
        rowUsed.push({ row: row, x: cx2 });
        var py2 = baseY - row * 16;

        ctx.strokeStyle = "rgba(240,185,11,.42)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx2, yOf(d.h) - 2);
        ctx.lineTo(cx2, py2 + 4);
        ctx.stroke();

        var label = ev.label;
        ctx.font = "600 10.5px -apple-system,'PingFang SC',sans-serif";
        var w2 = ctx.measureText(label).width;
        var bx = Math.max(plotL + w2 / 2 + 2, Math.min(plotL + plotW - w2 / 2 - 2, cx2));
        ctx.fillStyle = "rgba(240,185,11,.13)";
        roundRect(bx - w2 / 2 - 5, py2 - 10, w2 + 10, 15, 4);
        ctx.fillStyle = "rgba(240,185,11,.9)";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(label, bx, py2 - 2);
      });
    }

    // ---- 回放光标 ----
    if (isFollow){
      var gp = (growing && growing.price != null) ? growing.price : DATA[lastG].c;
      var pcx = xOf(state.progress), pcy = yOf(gp);
      ctx.save();
      ctx.strokeStyle = "rgba(240,185,11,.55)"; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(Math.round(pcx) + .5, plotT);
      ctx.lineTo(Math.round(pcx) + .5, plotB);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(pcx, pcy, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = "#f0b90b"; ctx.fill();
      ctx.beginPath(); ctx.arc(pcx, pcy, 7.5, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(240,185,11,.3)"; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.restore();
    }

    // ---- 副图：月度变动 ----
    if (useSub){
      var zeroY = subT + subH / 2;

      ctx.beginPath();
      ctx.strokeStyle = "rgba(43,53,72,.95)"; ctx.lineWidth = 1;
      ctx.moveTo(plotL, Math.round(subT) + .5);
      ctx.lineTo(plotL + plotW, Math.round(subT) + .5);
      ctx.stroke();

      var maxAbs = 0.2;
      for (var gs = Math.max(1, iFrom); gs <= iTo; gs++){
        if (isFollow && gs > state.progress) break;
        var av = Math.abs(DATA[gs].c - DATA[gs - 1].c);
        if (av > maxAbs) maxAbs = av;
      }

      ctx.beginPath();
      ctx.strokeStyle = "rgba(43,53,72,.75)"; ctx.lineWidth = 1;
      ctx.moveTo(plotL, Math.round(zeroY) + .5);
      ctx.lineTo(plotL + plotW, Math.round(zeroY) + .5);
      ctx.stroke();

      var sbw = Math.max(1.6, Math.min(slot * 0.66, 42));
      for (var gb = Math.max(1, iFrom); gb <= iTo; gb++){
        if (isFollow && gb > state.progress) continue;
        var bx = xOf(gb);
        if (bx < plotL - 4 || bx > plotL + plotW + 4) continue;
        var chg = DATA[gb].c - DATA[gb - 1].c;
        var hh2 = Math.sqrt(Math.abs(chg) / maxAbs) * (subH / 2 - 6);
        if (hh2 < 1.2) hh2 = 1.2;
        ctx.fillStyle = chg >= 0 ? "rgba(255,77,94,.6)" : "rgba(38,194,129,.6)";
        if (chg >= 0) ctx.fillRect(bx - sbw / 2, zeroY - hh2, sbw, hh2);
        else ctx.fillRect(bx - sbw / 2, zeroY, sbw, hh2);
      }

      ctx.font = "9.5px ui-monospace, Consolas, monospace";
      ctx.fillStyle = DIM;
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText("月度", plotL - 10, subT + 9);
      ctx.fillText("0", plotL - 10, zeroY);
    }

    // ---- X 轴 ----
    var axisY = useSub ? subT + subH + 10 : plotB + 9;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.font = "10.5px ui-monospace, Consolas, monospace";
    ctx.fillStyle = DIM;

    if (isAll && !isFollow){
      var lastYearDrawn = null, firstX = null;
      for (var yv = iFrom; yv <= iTo; yv++){
        if (DATA[yv].m !== 1) continue;
        var gx = Math.round(xOf(yv)) + .5;
        ctx.beginPath();
        ctx.strokeStyle = "rgba(35,43,58,.28)"; ctx.lineWidth = 1;
        ctx.moveTo(gx, plotT); ctx.lineTo(gx, plotB); ctx.stroke();
        if (DATA[yv].y % 2 === 0){
          if (firstX === null) firstX = gx;
          ctx.fillText(String(DATA[yv].y), gx, axisY);
          lastYearDrawn = String(DATA[yv].y);
        }
      }
      ctx.textAlign = "left";
      if (firstX === null || firstX - plotL > 46){
        ctx.fillText(String(DATA[0].y), plotL + 2, axisY);
      }
      if (String(DATA[NUM - 1].y) !== lastYearDrawn){
        ctx.textAlign = "right";
        ctx.fillText(String(DATA[NUM - 1].y), plotL + plotW, axisY);
      }
    } else {
      var stepX = viewSize <= 12 ? 1 : (viewSize <= 24 ? 3 : 6);
      for (var gx2 = iFrom; gx2 <= iTo; gx2++){
        if (gx2 % stepX !== 0) continue;
        if (isFollow && gx2 > state.progress) continue;
        var dd2 = DATA[gx2];
        if (!dd2) continue;
        var xx = xOf(gx2);
        if (xx < plotL + 12 || xx > plotL + plotW - 6) continue;

        ctx.beginPath();
        ctx.strokeStyle = "rgba(35,43,58,.26)"; ctx.lineWidth = 1;
        ctx.moveTo(Math.round(xx) + .5, plotT);
        ctx.lineTo(Math.round(xx) + .5, plotB);
        ctx.stroke();

        ctx.fillStyle = DIM;
        ctx.fillText(String(dd2.y).slice(2) + "/" + String(dd2.m).padStart(2, "0"), xx, axisY);
      }
    }

    // ---- hover 十字 ----
    if (state.hover >= 0 && state.hover < NUM && !state.playing){
      var hx = xOf(state.hover);
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "rgba(139,148,167,.7)"; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(hx) + .5, plotT);
      ctx.lineTo(Math.round(hx) + .5, plotB);
      ctx.stroke();
      ctx.restore();
    }

    LAY = { plotL:plotL, plotW:plotW, slot:slot, viewStart:viewStart, plotT:plotT, plotB:plotB };

    var focusG = state.hover >= 0 ? state.hover : lastG;
    updateOHLC(focusG);
    updateDims(focusG);

    ctx.restore();

    if (state.flash > 0.01){
      ctx.fillStyle = "rgba(255,58,78," + (state.flash * 0.16).toFixed(3) + ")";
      ctx.fillRect(0, 0, W_, H_);
    }
  }

  function roundRect(x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* =========================================================
     八、信息条 + 六维
     ========================================================= */
  var _lastOHLC = -2;
  function updateOHLC(idx){
    if (idx === _lastOHLC) return;
    _lastOHLC = idx;
    var d = DATA[idx];
    if (!d) return;
    var prev = idx > 0 ? DATA[idx - 1].c : d.o;
    var diff = d.c - prev;
    var pct = prev > 0.01 ? diff / prev * 100 : 0;
    var cls = diff >= 0 ? "up" : "down";
    var arrow = diff >= 0 ? "▲" : "▼";

    ohlcEl.innerHTML =
      '<span class="d">' + d.y + "-" + String(d.m).padStart(2, "0") + '</span>' +
      '<span>开<b>' + fmt(d.o) + '</b></span>' +
      '<span>高<b class="up">' + fmt(d.h) + '</b></span>' +
      '<span>低<b class="down">' + fmt(d.l) + '</b></span>' +
      '<span>收<b class="' + cls + '">' + fmt(d.c) + '</b></span>' +
      (prev > 0.5 ? '<span>月度<b class="' + cls + '">' + arrow + " " + (diff >= 0 ? "+" : "") + diff.toFixed(1) + '</b></span>' : '') +
      (d.meta ? '<span class="dimc">· ' + d.meta.label + '</span>' : '');
  }

  var _lastDims = -2;
  function updateDims(idx){
    if (idx === _lastDims) return;
    _lastDims = idx;
    var d = DATA[idx];
    if (!d || !dimsEl) return;
    var vals = DIMS.map(function(dm){
      return { key:dm.key, name:dm.name, v:d.d[dm.key] };
    });
    var sorted = vals.slice().sort(function(a, b){ return b.v - a.v; });
    var maxKey = sorted[0].key, minKey = sorted[sorted.length - 1].key;

    dimsEl.innerHTML = vals.map(function(v){
      var cls = v.key === maxKey ? "hot" : (v.key === minKey ? "cold" : "");
      var txt;
      if (v.key === "wea" && CFG.weaMode !== "score"){
        txt = (d.d.weaK >= 10 ? Math.round(d.d.weaK) : d.d.weaK.toFixed(1)) + "K";
      } else {
        txt = String(Math.round(v.v));
      }
      return '<div class="dim ' + cls + '">' +
        '<div class="dn"><span>' + v.name + '</span><b>' + txt + '</b></div>' +
        '<div class="db"><i style="width:' + Math.max(2, Math.min(100, v.v)) + '%"></i></div>' +
      '</div>';
    }).join("");
  }

  /* =========================================================
     九、交互
     ========================================================= */
  function hitIndex(mx){
    if (!LAY) return -1;
    if (mx < LAY.plotL || mx > LAY.plotL + LAY.plotW) return -1;
    var g = Math.floor((mx - LAY.plotL) / LAY.slot + LAY.viewStart);
    return Math.max(0, Math.min(NUM - 1, g));
  }

  function onMove(cx, cy){
    if (state.playing) return;
    var r = cv.getBoundingClientRect();
    var mx = cx - r.left, my = cy - r.top;
    var i = hitIndex(mx);
    if (state.follow && i > state.progress) i = Math.floor(state.progress);
    if (i !== state.hover){ state.hover = i; draw(); }
    if (i < 0){ tipEl.style.opacity = 0; return; }

    var d = DATA[i];
    var prev = i > 0 ? DATA[i - 1].c : d.o;
    var diff = d.c - prev;
    var pct = prev > 0.01 ? diff / prev * 100 : 0;
    var cls = diff >= 0 ? "up" : "down";

    var html =
      '<div class="h">' + d.y + " 年 " + d.m + " 月" + '</div>' +
      '<div class="row"><span>指数</span><b>' + fmt(d.c) + '</b></div>' +
      '<div class="row"><span>本月</span><b class="' + cls + '">' + (diff >= 0 ? "+" : "") + diff.toFixed(1) + (prev > 0.5 ? " (" + (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%)" : "") + '</b></div>' +
      '<div class="row"><span>学历 / 心态</span><b>' + Math.round(d.d.edu) + " / " + Math.round(d.d.mind) + '</b></div>' +
      '<div class="row"><span>思想 / 身体</span><b>' + Math.round(d.d.thought) + " / " + Math.round(d.d.body) + '</b></div>' +
      '<div class="row"><span>技能 / 财富</span><b>' + Math.round(d.d.skill) + " / " +
        (CFG.weaMode === "score" ? Math.round(d.d.wea) : fmt(d.d.weaK, 1) + "K") + '</b></div>';

    if (d.meta) html += '<div class="note"><b style="color:#f0b90b">' + d.meta.label + '</b>　' + d.meta.note + '</div>';
    tipEl.innerHTML = html;

    var tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    var lx = mx + 16;
    if (lx + tw > W_ - 4) lx = mx - tw - 16;
    if (lx < 2) lx = 2;
    var ly = Math.min(Math.max(my - th / 2, 4), H_ - th - 4);
    tipEl.style.left = lx + "px";
    tipEl.style.top = ly + "px";
    tipEl.style.opacity = 1;
  }

  cv.addEventListener("mousemove", function(e){ onMove(e.clientX, e.clientY); });
  cv.addEventListener("touchstart", function(e){
    if (e.touches && e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive:true });
  cv.addEventListener("touchmove", function(e){
    if (e.touches && e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive:true });
  cv.addEventListener("mouseleave", function(){
    state.hover = -1;
    tipEl.style.opacity = 0;
    draw();
  });
  cv.addEventListener("click", function(){
    if (state.playing){ userTouched = true; pause(); }
  });

  document.getElementById("tabs").addEventListener("click", function(e){
    var b = e.target.closest(".tab");
    if (!b) return;
    userTouched = true;
    [].forEach.call(this.querySelectorAll(".tab"), function(x){ x.classList.remove("on"); });
    b.classList.add("on");
    state.range = b.dataset.r;
    state.hover = -1;
    tipEl.style.opacity = 0;
    resetPlayback();
    updateSub();
    draw();
  });

  /* =========================================================
     十、回放
     ========================================================= */
  var playBtn = document.getElementById("playBtn");
  var playIco = document.getElementById("playIco");
  var scrub = document.getElementById("scrub");
  var pmeta = document.getElementById("pmeta");
  var capEl = document.getElementById("caption");
  var capDate = document.getElementById("capDate");
  var capTitle = document.getElementById("capTitle");
  var heroNum = document.getElementById("heroNum");
  var heroChg = document.getElementById("heroChg");

  var BASE_SEC = 68;
  var rafId = null, lastT = 0, capTimer = null, lastCapIdx = -100;
  var userTouched = false;
  var lastShown = -1;

  scrub.max = String(NUM - 1);

  function updateHero(d){
    if (!heroNum) return;
    heroNum.innerHTML = fmt(d.c, 1) + '<small>人生指数</small>';
    var prevYear = DATA[Math.max(0, d.i - 12)];
    var yoy = prevYear && prevYear.c > 0.5 ? (d.c - prevYear.c) / prevYear.c * 100 : 0;
    heroChg.innerHTML = (d.i > 11 && prevYear.c > 0.5)
      ? '<span class="' + (yoy >= 0 ? "up" : "down") + '">' + (yoy >= 0 ? "▲ +" : "▼ ") + yoy.toFixed(1) + '%</span> <span class="dimc">较一年前</span>'
      : '<span class="dimc">出生时 = 0</span>';
  }

  function setMeta(idx){
    var d = DATA[idx];
    if (!d) return;
    pmeta.textContent = d.y + " 年 " + d.m + " 月" + (idx === NUM - 1 ? " · 现在" : "");
    scrub.value = String(idx);
    var pct = (idx / (NUM - 1)) * 100;
    scrub.style.background = "linear-gradient(90deg,#3b82f6 " + pct.toFixed(2) + "%,#232b3a " + pct.toFixed(2) + "%)";
    updateHero(d);

    if (state.follow){
      var ws = Math.max(0, state.progress - state.winSize + 2);
      var we = Math.min(NUM - 1, Math.floor(ws + state.winSize - 1));
      var aa = DATA[Math.floor(ws)], bb = DATA[we];
      var pz = function(x){ return String(x).padStart(2, "0"); };
      if (aa && bb){
        rangeSub.textContent = aa.y + "-" + pz(aa.m) + " — " + bb.y + "-" + pz(bb.m) +
          " · 回放 · " + Math.round(state.winSize / 12) + " 年视窗";
      }
    }
  }

  function showCaption(idx){
    var d = DATA[idx];
    if (!d || !d.meta) return;
    var pc = idx > 0 ? DATA[idx - 1].c : d.o;
    var chg = pc > 0.5 ? (d.c - pc) / pc * 100 : 0;
    capDate.textContent = d.y + " 年 " + d.m + " 月";
    capTitle.textContent = d.meta.label;
    capEl.className = "caption show " + (chg < 0 ? "down" : "up") +
      (Math.abs(chg) > 12 ? " big" : "");
    if (capTimer) clearTimeout(capTimer);
    capTimer = setTimeout(function(){ capEl.classList.remove("show"); }, chg < -12 ? 2200 : 1700);
  }

  function tick(t){
    if (!state.playing) return;
    if (!lastT) lastT = t;
    var dt = (t - lastT) / 1000;
    lastT = t;
    if (dt > 0.25) dt = 0.25;

    state.progress += dt * ((NUM - 1) / BASE_SEC) * state.speed;
    if (state.progress >= NUM - 1){
      state.progress = NUM - 1;
      setMeta(NUM - 1);
      draw();
      finish();
      return;
    }

    var idx = Math.floor(state.progress);
    if (idx !== lastShown){
      var prevShown = lastShown;
      lastShown = idx;
      setMeta(idx);
      var evIdx = -1;
      for (var k = prevShown + 1; k <= idx; k++){
        if (DATA[k] && DATA[k].meta) evIdx = k;
      }
      if (evIdx >= 0 && evIdx !== lastCapIdx){ lastCapIdx = evIdx; showCaption(evIdx); }

      // 单月暴跌：画面冲击
      var pcv = idx > 0 ? DATA[idx - 1].c : DATA[idx].o;
      var chg = pcv > 0.5 ? (DATA[idx].c - pcv) / pcv * 100 : 0;
      if (chg < -12){
        state.flash = 1;
        state.shake = 1;
      }
    }
    draw();
    state.flash *= 0.90;
    state.shake *= 0.86;
    rafId = requestAnimationFrame(tick);
  }

  function ensureAll(){
    if (state.range === "all") return;
    [].forEach.call(document.querySelectorAll("#tabs .tab"), function(x){
      if (x.dataset.r === "all") x.classList.add("on"); else x.classList.remove("on");
    });
    state.range = "all";
    updateSub();
  }

  function play(){
    ensureAll();
    if (state.progress >= NUM - 1) state.progress = 0;
    state.follow = true;
    state.yLo = null; state.yHi = null;
    state.scrollPos = null;
    lastShown = Math.floor(state.progress) - 1;
    state.hover = -1;
    tipEl.style.opacity = 0;
    state.playing = true;
    playIco.textContent = "❚❚";
    lastT = 0; lastCapIdx = -100;
    setMeta(Math.floor(state.progress));
    draw();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function pause(){
    state.playing = false;
    state.flash = 0;
    state.shake = 0;
    playIco.textContent = "▶";
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function finish(){
    state.playing = false;
    playIco.textContent = "▶";
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    capDate.textContent = "2026 年 10 月";
    capTitle.textContent = "现在 · " + fmt(DATA[NUM - 1].c, 1);
    capEl.className = "caption show up";
    if (capTimer) clearTimeout(capTimer);
    capTimer = setTimeout(function(){ capEl.classList.remove("show"); }, 2400);
  }

  function resetPlayback(){
    pause();
    state.progress = NUM - 1;
    state.follow = false;
    state.yLo = null; state.yHi = null;
    lastShown = -1;
    setMeta(NUM - 1);
  }

  playBtn.addEventListener("click", function(){
    userTouched = true;
    if (state.playing) pause(); else play();
  });

  scrub.addEventListener("input", function(){
    userTouched = true;
    pause();
    ensureAll();
    var idx = parseInt(this.value, 10) || 0;
    state.progress = idx;
    state.follow = true;
    state.scrollPos = null;
    lastShown = idx;
    setMeta(idx);
    draw();
  });

  [].forEach.call(document.querySelectorAll(".sp"), function(b){
    b.addEventListener("click", function(){
      [].forEach.call(document.querySelectorAll(".sp"), function(x){ x.classList.remove("on"); });
      b.classList.add("on");
      state.speed = parseFloat(b.dataset.sp) || 1;
    });
  });

  function updateSub(){
    var vr = visible();
    var a = DATA[vr.from], b = DATA[vr.to];
    var p2 = function(x){ return String(x).padStart(2, "0"); };
    rangeSub.textContent = a.y + "-" + p2(a.m) + " — " + b.y + "-" + p2(b.m) + " · " + (vr.to - vr.from + 1) + " 个月";
  }

  /* =========================================================
     十一、统计 & 卡片
     ========================================================= */
  function renderStats(){
    var maxV = -1, maxD = DATA[0], minV = 1e9, minD = DATA[0];
    DATA.forEach(function(d){
      if (d.c > maxV){ maxV = d.c; maxD = d; }
      if (d.c < minV){ minV = d.c; minD = d; }
    });

    // 最大回撤
    var peak = DATA[0].c, dd = 0, ddFrom = DATA[0], ddTo = DATA[0], peakD = DATA[0];
    DATA.forEach(function(d){
      if (d.c > peak){ peak = d.c; peakD = d; }
      var cur = (d.c - peak) / peak;
      if (cur < dd){ dd = cur; ddFrom = peakD; ddTo = d; }
    });

    var cur = DATA[NUM - 1].c;
    document.getElementById("stCur").textContent = fmt(cur);
    document.getElementById("stMax").textContent = fmt(maxV);
    document.getElementById("stMaxD").textContent = maxD.y + "." + String(maxD.m).padStart(2, "0") + (maxD.i === NUM - 1 ? " · 现在" : "");
    document.getElementById("stDD").textContent = (dd * 100).toFixed(1) + "%";
    document.getElementById("stDDD").textContent = ddFrom.y + "." + String(ddFrom.m).padStart(2, "0") + " → " + ddTo.y + "." + String(ddTo.m).padStart(2, "0");

    var endD = DATA[NUM - 1];
    var tenIdx = idxOf(endD.y - 10, endD.m);
    var ten = (tenIdx >= 0 && DATA[tenIdx]) ? DATA[tenIdx] : DATA[Math.max(0, NUM - 121)];
    var g = ten && ten.c > 0.5 ? (cur - ten.c) / ten.c * 100 : 0;
    document.getElementById("st10").textContent = (g >= 0 ? "+" : "") + g.toFixed(0) + "%";
    document.getElementById("st10D").textContent = ten.y + "." + String(ten.m).padStart(2, "0") + " 的 " + fmt(ten.c) + " → 现在";
  }

  function renderEvents(){
    var box = document.getElementById("events");
    var html = "";
    EVENTS.forEach(function(ev){
      var d = DATA[ev.i];
      var prev = ev.i > 0 ? DATA[ev.i - 1].c : d.o;
      var diff = ev.i > 0 ? (d.c - prev) : 0;
      var pct = prev > 0.5 ? diff / prev * 100 : 0;
      var cls = diff > 0.3 ? "up" : (diff < -0.3 ? "" : "flat");
      var pctTxt = (ev.i === 0) ? "起点" : (diff >= 0 ? "+" : "") + pct.toFixed(1) + "%";
      html += '<div class="ev ' + cls + '">' +
        '<div class="t"><span>' + d.y + "." + String(d.m).padStart(2, "0") + '　' + ev.label + '</span>' +
        '<span class="idx ' + (diff >= 0 ? "up" : "down") + '">' + fmt(d.c) +
        ' <span style="font-size:11px;color:#7c8598">' + pctTxt + '</span></span></div>' +
        '<div class="n">' + ev.note + '</div>' +
      '</div>';
    });
    box.innerHTML = html;
    document.getElementById("evCount").textContent = "共 " + EVENTS.length + " 个";
  }

  /* =========================================================
     十二、尺寸
     ========================================================= */
  function resize(){
    var box = cv.parentElement;
    var w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = w + "px";
    cv.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W_ = w; H_ = h;
    draw();
  }

  if (window.ResizeObserver){
    new ResizeObserver(resize).observe(cv.parentElement);
  } else {
    window.addEventListener("resize", resize);
  }

  if (CFG.title){
    document.title = CFG.title;
    var h1el = document.querySelector("h1");
    if (h1el) h1el.textContent = CFG.title;
  }

  // 页脚说明随数据模式变化
  var footEl = document.getElementById("footText");
  if (footEl){
    footEl.textContent = CFG.weaMode === "score"
      ? "指数 = 学历 + 心态 + 思想 + 身体 + 技能 + 财富 的加权合成，出生记为 0。其中五项比例固定，唯独财富的权重随年龄从 4% 升到 15%——少年时钱不构成尺度，越往后越重。财富以 0—100 的相对分数计。"
      : "指数 = 学历 + 心态 + 思想 + 身体 + 技能 + 财富 的加权合成，出生记为 0。其中五项比例固定，唯独财富的权重随年龄从 4% 升到 15%——少年时钱不构成尺度，越往后越重。财富以千元（K）计，按分段曲线折算成分数。";
  }

  // 图例按启用的指标生成
  var legendEl = document.querySelector(".legend");
  if (legendEl){
    var lh = '<span><i style="background:var(--up)"></i>上行</span>' +
             '<span><i style="background:var(--down)"></i>回落</span>' +
             '<span><i style="background:var(--ma)"></i>MA' + (CFG.indicators && CFG.indicators.ma || 12) + '</span>';
    if (CFG.indicators && CFG.indicators.ema){
      lh += '<span><i style="background:var(--ema)"></i>EMA' + (CFG.indicators.ema || 15) + '</span>';
    }
    if (CFG.indicators && CFG.indicators.sub){
      lh += '<span><i style="background:#5d667a"></i>月度变动</span>';
    }
    legendEl.innerHTML = lh;
  }

  // 档位按钮按数据里的阶段自动生成
  var tabsEl = document.getElementById("tabs");
  if (tabsEl){
    var th = '<button class="tab on" data-r="all">全景</button>';
    STAGES.forEach(function(stg){
      th += '<button class="tab" data-r="' + stg.key + '">' + stg.name + '</button>';
    });
    tabsEl.innerHTML = th;
  }

  updateSub();
  renderStats();
  renderEvents();
  resize();
  setMeta(state.follow ? Math.floor(state.progress) : NUM - 1);

  // 默认静态展示完整曲线；点 ▶ 才开始回放
})();
