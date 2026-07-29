// 캔버스 · 입력 · 표시. 수학은 transform.js 에 있다.
//
// 색은 PaperMod 의 CSS 변수에서 읽는다. 하드코딩하면 한쪽 테마에서 안 보인다.
// 실측한 변수: --theme(배경) --primary(글자) --secondary(흐린 글자) --border(선)

export function themeColors() {
  const s = getComputedStyle(document.body);
  const pick = (v, fb) => (s.getPropertyValue(v).trim() || fb);
  return {
    bg:      pick('--theme', '#fff'),
    fg:      pick('--primary', '#222'),
    muted:   pick('--secondary', '#888'),
    grid:    pick('--border', '#ddd'),
    accent:  '#4c72b0',
    accent2: '#c44e52',
  };
}

/**
 * PaperMod 는 <html> 의 data-theme 속성을 바꾼다 (:root[data-theme=dark]).
 * <body> 의 class 가 아니므로 감시 대상은 documentElement 다.
 */
export function onThemeChange(cb) {
  new MutationObserver(cb).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme'],
  });
  // data-theme="auto" 일 때는 OS 설정이 실제 테마를 결정한다.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', cb);
}

export function createView(canvas, world) {
  const st = { w: 1, h: 1, dpr: 1 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    st.dpr = window.devicePixelRatio || 1;
    st.w = rect.width;
    st.h = rect.width;                    // 정사각 유지
    canvas.style.height = `${st.h}px`;
    canvas.width = Math.round(st.w * st.dpr);
    canvas.height = Math.round(st.h * st.dpr);
    canvas.getContext('2d').setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
  }

  const sx = () => st.w / (world.xmax - world.xmin);
  const sy = () => st.h / (world.ymax - world.ymin);

  return {
    resize,
    get size() { return { w: st.w, h: st.h }; },
    world,
    toPixel: ([x, y]) => [
      (x - world.xmin) * sx(),
      st.h - (y - world.ymin) * sy(),      // y 축 뒤집기
    ],
    toWorld: ([px, py]) => [
      px / sx() + world.xmin,
      (st.h - py) / sy() + world.ymin,
    ],
  };
}

export function drawGrid(ctx, view, colors) {
  const { w, h } = view.size;
  const { xmin, xmax, ymin, ymax } = view.world;
  ctx.clearRect(0, 0, w, h);

  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.grid;
  for (let x = Math.ceil(xmin); x <= xmax; x++) {
    const [px] = view.toPixel([x, 0]);
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
  }
  for (let y = Math.ceil(ymin); y <= ymax; y++) {
    const [, py] = view.toPixel([0, y]);
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
  }

  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1.5;
  const [ox, oy] = view.toPixel([0, 0]);
  ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(w, oy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, h); ctx.stroke();
}

export function drawPolygon(ctx, view, pts, { stroke, fill, width = 2, firstEdge }) {
  const px = pts.map((p) => view.toPixel(p));
  ctx.beginPath();
  px.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }

  // 방향 표시: 첫 변만 다른 색. 반사와 회전을 구분하려면 필요하다.
  if (firstEdge) {
    ctx.beginPath();
    ctx.moveTo(px[0][0], px[0][1]);
    ctx.lineTo(px[1][0], px[1][1]);
    ctx.strokeStyle = firstEdge;
    ctx.lineWidth = width + 2;
    ctx.stroke();
  }
}

export function drawHandles(ctx, view, pts, colors) {
  pts.forEach((p) => {
    const [x, y] = view.toPixel(p);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = colors.accent2;
    ctx.fill();
    ctx.strokeStyle = colors.bg;
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

export function makeSliders(el, defs, onInput) {
  el.innerHTML = '';
  const rows = {};

  function getValues() {
    const v = {};
    for (const k in rows) v[k] = parseFloat(rows[k].input.value);
    return v;
  }

  defs.forEach((d) => {
    const row = document.createElement('div');
    row.className = 'mv-slider';
    const label = document.createElement('label');
    label.textContent = d.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = d.min; input.max = d.max; input.step = d.step; input.value = d.value;
    const out = document.createElement('span');
    out.className = 'mv-val';
    const fmt = d.fmt || ((v) => v.toFixed(2));
    out.textContent = fmt(d.value);
    input.addEventListener('input', () => {
      out.textContent = fmt(parseFloat(input.value));
      onInput(getValues());
    });
    row.append(label, input, out);
    el.appendChild(row);
    rows[d.key] = { input, out, fmt, min: d.min, max: d.max };
  });

  function setValues(obj) {
    for (const k in obj) {
      if (!rows[k]) continue;
      rows[k].input.value = obj[k];
      // 슬라이더가 범위를 넘는 값을 클램프하므로, 표시는 클램프된 실제 값으로 한다.
      rows[k].out.textContent = rows[k].fmt(parseFloat(rows[k].input.value));
    }
  }

  /** 드래그로 역산한 값이 슬라이더 범위를 넘지 않게 자른다. */
  function clamp(obj) {
    const out = { ...obj };
    for (const k in rows) {
      if (!(k in out)) continue;
      out[k] = Math.min(rows[k].max, Math.max(rows[k].min, out[k]));
    }
    return out;
  }

  return { setValues, getValues, clamp };
}

export function attachDrag(canvas, view, getPoints, onDrag) {
  let active = -1;

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  canvas.addEventListener('pointerdown', (e) => {
    const [px, py] = local(e);
    let best = -1, bestD = 14;            // 14px 안쪽만 잡는다
    getPoints().forEach((p, i) => {
      const [hx, hy] = view.toPixel(p);
      const d = Math.hypot(hx - px, hy - py);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) {
      active = best;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (active < 0) return;
    onDrag(active, view.toWorld(local(e)));
    e.preventDefault();
  });

  const end = (e) => {
    if (active < 0) return;
    active = -1;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

export function renderMatrix(el, M) {
  const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const cell = (v, isId) =>
    `<span class="mv-cell${isId ? '' : ' mv-changed'}">${v.toFixed(3)}</span>`;
  el.innerHTML = `<div class="mv-matrix">${
    M.map((row, i) => row.map(
      (v, j) => cell(v, Math.abs(v - I[i][j]) < 1e-6),
    ).join('')).join('')
  }</div>`;
}

/** 월드좌표 from → to 화살표. head 는 머리 길이(픽셀). */
export function drawArrow(ctx, view, from, to, { color, width = 2, head = 9 }) {
  const [x0, y0] = view.toPixel(from);
  const [x1, y1] = view.toPixel(to);
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;                       // 너무 짧으면 그리지 않는다 (σ = 0)

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();

  const ux = dx / len, uy = dy / len;
  const h = Math.min(head, len * 0.5);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - h * ux - h * 0.45 * uy, y1 - h * uy + h * 0.45 * ux);
  ctx.lineTo(x1 - h * ux + h * 0.45 * uy, y1 - h * uy - h * 0.45 * ux);
  ctx.closePath();
  ctx.fill();
}
