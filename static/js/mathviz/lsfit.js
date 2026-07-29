// 데모 2 — 점 6개를 끌면 SVD 가 직선을 맞춘다 (총최소자승 = 직교 회귀).
//
// 데이터는 2×N 이다. 2×2 공분산 C = D Dᵀ 의 SVD 를 쓰면 svd2x2 를 그대로
// 재사용할 수 있다. C 는 대칭 준양정이라 SVD 가 고윳값 분해와 같고,
// 방향벡터 u1, u2 는 데이터 D 의 특이벡터와 동일하다.
//
// ⚠️ C 의 특이값은 D 의 특이값의 제곱이다. readout 에는 제곱근을 쓴다.

import { svd2x2 } from './transform.js';
import {
  themeColors, onThemeChange, createView, drawGrid,
  drawHandles, drawArrow, attachDrag,
} from './core.js';

const WORLD = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };

const INITIAL = [
  [-2.2, -1.4], [-1.3, -0.7], [-0.4, -0.2],
  [0.5, 0.4], [1.4, 0.8], [2.3, 1.5],
];

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = createView(canvas, WORLD);
  const pts = INITIAL.map((p) => [...p]);

  root.querySelector('.mv-sliders').innerHTML = '';   // 이 데모는 슬라이더가 없다

  attachDrag(canvas, view, () => pts, (i, p) => {
    pts[i] = p;
    draw();
  });

  /** 중심화한 뒤 2×2 공분산의 SVD. sigma 는 데이터 기준(제곱근 취함). */
  function fit() {
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p[0], 0) / n;
    const my = pts.reduce((s, p) => s + p[1], 0) / n;
    let cxx = 0, cxy = 0, cyy = 0;
    for (const [x, y] of pts) {
      const dx = x - mx, dy = y - my;
      cxx += dx * dx; cxy += dx * dy; cyy += dy * dy;
    }
    const { s1, s2, u1, u2 } = svd2x2([[cxx, cxy], [cxy, cyy]]);
    return {
      center: [mx, my],
      dir: u1,                 // 직선 방향
      normal: u2,              // 법선
      sig1: Math.sqrt(s1),     // 데이터의 특이값
      sig2: Math.sqrt(s2),
    };
  }

  function draw() {
    const colors = themeColors();
    const { center, dir, normal, sig1, sig2 } = fit();

    drawGrid(ctx, view, colors);

    // 맞춘 직선을 화면 끝까지 늘려 그린다
    const L = 8;
    const p0 = [center[0] - dir[0] * L, center[1] - dir[1] * L];
    const p1 = [center[0] + dir[0] * L, center[1] + dir[1] * L];
    const [ax, ay] = view.toPixel(p0);
    const [bx, by] = view.toPixel(p1);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

    // 잔차 — 각 점에서 직선에 내린 수선
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 1;
    for (const p of pts) {
      const d = (p[0] - center[0]) * normal[0] + (p[1] - center[1]) * normal[1];
      const foot = [p[0] - normal[0] * d, p[1] - normal[1] * d];
      const [fx, fy] = view.toPixel(foot);
      const [px, py] = view.toPixel(p);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(fx, fy); ctx.stroke();
    }

    // 특이벡터: 중심에서 σ 길이만큼
    drawArrow(ctx, view, center,
      [center[0] + dir[0] * sig1, center[1] + dir[1] * sig1],
      { color: colors.accent2, width: 2.5 });
    drawArrow(ctx, view, center,
      [center[0] + normal[0] * sig2, center[1] + normal[1] * sig2],
      { color: colors.accent2, width: 2.5 });

    drawHandles(ctx, view, pts, colors);

    const ratio = sig1 > 1e-12 ? sig2 / sig1 : 0;
    let verdict;
    if (ratio < 0.1) verdict = '<span class="ok">방향이 잘 정해졌다</span>';
    else if (ratio < 0.4) verdict = '방향이 어느 정도 정해졌다';
    else verdict = '<span class="no">방향이 정해지지 않는다</span>';

    root.querySelector('.mv-matrix-host').innerHTML = '';
    root.querySelector('.mv-readout').innerHTML = `
      σ₁ = <b>${sig1.toFixed(3)}</b> &nbsp; σ₂ = <b>${sig2.toFixed(3)}</b>
      &nbsp; σ₂/σ₁ = <b>${ratio.toFixed(3)}</b><br>${verdict}`;
    root.querySelector('.mv-hint').textContent =
      '점을 끌어보세요. 점들을 한 줄로 세우면 σ₂/σ₁ 이 0 에 가까워지고 직선이 잘 정해집니다. '
      + '한 곳에 뭉치면 1 에 가까워지고 어느 방향인지 알 수 없게 됩니다. '
      + '회색 선은 각 점에서 직선까지의 수직 거리입니다 — SVD 는 이 거리들의 제곱합을 최소화합니다.';
  }

  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
