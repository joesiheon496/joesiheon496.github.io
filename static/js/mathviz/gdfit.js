// static/js/mathviz/gdfit.js
// 데모 2 — 2편의 직선맞춤을 경사하강법으로 다시 푼다.
//
// 회색 선은 닫힌 해(2편의 의사역행렬), 진한 선은 현재 반복수에서의 GD 해다.
// 목적함수는 2편의 직교 회귀가 아니라 보통최소자승이다 — 그래야 볼록 이차함수가 되고
// 데모 1 의 수축률 이론이 그대로 적용된다. 잔차를 **세로** 선분으로 그려서
// 2편의 수직 거리와 다르다는 것을 눈으로 보이게 한다.
//
// x 중심화 토글은 답을 바꾸지 않는다 — 회색 선은 꿈쩍하지 않고 진한 선만 빨라진다.
// 그것이 이 데모의 요점이다.

import {
  olsKappa, olsClosed, olsGdPath, centerPoints, firstIndexBelow,
} from './optimize.js';
import {
  themeColors, onThemeChange, createView, drawGrid,
  drawHandles, attachDrag, makeSliders, makeToggles,
} from './core.js';

const WORLD = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
const MAX_STEPS = 400;      // 스펙 §3-3

// 스펙 §2 의 "오른쪽 치우침" 배치 (원본 κ ≈ 29.5, 중심화 후 ≈ 1.37).
// 토글의 효과가 첫 화면에서 바로 보이도록 이 계열로 시작한다.
const INITIAL = [
  [0.5, 0.55], [1.0, 1.20], [1.5, 1.40],
  [2.0, 1.95], [2.5, 2.15], [3.0, 2.75],
];

const SLIDERS = [
  { key: 'steps', label: '반복', min: 0, max: MAX_STEPS, step: 1, value: 30,
    fmt: (v) => String(Math.round(v)) },
];

const TOGGLES = [{ key: 'center', label: 'x 중심화', value: false }];

/** y = a x + b 를 화면 폭 전체에 그린다. */
function drawLine(ctx, view, [a, b], color, width) {
  const x0 = WORLD.xmin, x1 = WORLD.xmax;
  const [px0, py0] = view.toPixel([x0, a * x0 + b]);
  const [px1, py1] = view.toPixel([x1, a * x1 + b]);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(px1, py1); ctx.stroke();
}

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = createView(canvas, WORLD);
  const pts = INITIAL.map((p) => [...p]);
  const state = { steps: 30, center: false };

  const sliderHost = root.querySelector('.mv-sliders');
  makeSliders(sliderHost, SLIDERS, (v) => {
    Object.assign(state, v);
    draw();
  });
  // ⚠️ makeSliders 가 host 를 비우므로 반드시 그 뒤에 부른다.
  makeToggles(sliderHost, TOGGLES, (v) => {
    Object.assign(state, v);
    draw();
  });

  attachDrag(canvas, view, () => pts, (i, p) => {
    pts[i] = p;
    draw();
  });

  function draw() {
    const colors = themeColors();
    const steps = Math.round(state.steps);

    const closed = olsClosed(pts);
    const path = olsGdPath({ points: pts, steps, center: state.center });
    const current = path[path.length - 1];

    const { s1, s2, kappa: rawK } = olsKappa(pts);
    const cenK = olsKappa(centerPoints(pts).points).kappa;

    drawGrid(ctx, view, colors);

    // 닫힌 해 — 중심화 토글과 무관하게 불변이다
    drawLine(ctx, view, closed, colors.muted, 3);
    // 현재 GD 해
    drawLine(ctx, view, current, colors.accent, 2);

    // y 방향 잔차 (2편은 수직 거리였다 — 이 차이가 목적함수 변경이다)
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    for (const [x, y] of pts) {
      const [px, py] = view.toPixel([x, y]);
      const [, fy] = view.toPixel([x, current[0] * x + current[1]]);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, fy); ctx.stroke();
    }

    drawHandles(ctx, view, pts, colors);
    root.querySelector('.mv-matrix-host').innerHTML = '';

    // ---- readout
    const gap = Math.hypot(current[0] - closed[0], current[1] - closed[1]);
    const full = olsGdPath({ points: pts, steps: MAX_STEPS, center: state.center });
    const reached = firstIndexBelow(full, 1e-3, closed);
    const activeK = state.center ? cenK : rawK;

    const fmtK = (k) => (Number.isFinite(k) ? k.toFixed(1) : '∞');
    root.querySelector('.mv-readout').innerHTML = `
      σ₁ = <b>${s1.toFixed(3)}</b> &nbsp; σ₂ = <b>${s2.toFixed(3)}</b>
      &nbsp; <b>κ = (σ₁/σ₂)² = ${fmtK(rawK)}</b><br>
      중심화 없이 κ = ${fmtK(rawK)} &nbsp;·&nbsp; 중심화하면 κ = ${fmtK(cenK)}
      ${Number.isFinite(rawK / cenK) ? `(<b>${(rawK / cenK).toFixed(1)}배</b>)` : ''}<br>
      현재 ${steps}회 · 닫힌 해와의 거리 <b>${gap.toExponential(1)}</b><br>
      ${reached === null
        ? `<span class="no">미도달</span> — κ = ${fmtK(activeK)} 에서는`
          + ` ${MAX_STEPS}회로도 목표에 못 간다`
        : `<span class="ok">${reached}회면 도달</span>`}`;

    root.querySelector('.mv-hint').textContent =
      '회색 선이 닫힌 해(2편의 의사역행렬), 진한 선이 현재 반복수의 경사하강법 해입니다. '
      + '점을 오른쪽으로 몰면 κ 가 뛰고 진한 선이 뒤처집니다. x 중심화 를 켜면 '
      + '회색 선은 그대로인데 진한 선만 즉시 따라붙습니다 — 같은 답인데 '
      + '반복 횟수만 줄어드는 것입니다. 회색 세로선은 y 방향 잔차이고, '
      + '2편의 수직 거리와 다릅니다.';
  }

  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
