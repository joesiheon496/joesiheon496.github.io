// 데모 1 — 행렬 원소 4개를 주면 원이 타원으로 변한다.
// 단계 슬라이더 t 가 회전 → 스케일 → 회전 을 하나씩 보여준다.

import { svd2x2, svdRotationForm, pseudoInverse2x2 } from './transform.js';
import {
  themeColors, onThemeChange, createView, drawGrid, drawPolygon,
  drawArrow, makeSliders, renderMatrix,
} from './core.js';

const WORLD = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
const TRUNC_TOL = 0.05;          // 절단 의사역행렬 임계값

// 단위원을 64각형으로 근사한다. 새 도형 코드가 필요 없다.
const CIRCLE = Array.from({ length: 64 }, (_, i) => {
  const a = (i / 64) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
});

const DEFS = [
  { key: 'a', label: 'a', min: -2, max: 2, step: 0.01, value: 1.2 },
  { key: 'b', label: 'b', min: -2, max: 2, step: 0.01, value: 0.8 },
  { key: 'c', label: 'c', min: -2, max: 2, step: 0.01, value: -0.3 },
  { key: 'd', label: 'd', min: -2, max: 2, step: 0.01, value: 1.0 },
  { key: 't', label: '단계', min: 0, max: 3, step: 0.01, value: 3,
    fmt: (v) => v.toFixed(2) },
];

const rot = (th) => [[Math.cos(th), -Math.sin(th)], [Math.sin(th), Math.cos(th)]];
const mul = (X, Y) => [
  [X[0][0] * Y[0][0] + X[0][1] * Y[1][0], X[0][0] * Y[0][1] + X[0][1] * Y[1][1]],
  [X[1][0] * Y[0][0] + X[1][1] * Y[1][0], X[1][0] * Y[0][1] + X[1][1] * Y[1][1]],
];
const trp = (X) => [[X[0][0], X[1][0]], [X[0][1], X[1][1]]];

/** 단계 t 에서의 2×2 행렬. t = 3 이면 A 와 정확히 같다. */
function stageMatrix(A, t) {
  const { s1, s2signed, thetaU, thetaV } = svdRotationForm(A);

  // 1구간: Vᵀ 회전을 0 에서 전체로 보간
  let M = trp(rot(thetaV * Math.min(1, t)));

  // 2구간: 스케일을 1 에서 σ 로 보간. σ2 가 음수면 여기서 도형이 뒤집힌다.
  if (t > 1) {
    const b = Math.min(1, t - 1);
    M = mul([[1 + b * (s1 - 1), 0], [0, 1 + b * (s2signed - 1)]], M);
  }

  // 3구간: U 회전을 0 에서 전체로 보간
  if (t > 2) {
    M = mul(rot(thetaU * Math.min(1, t - 2)), M);
  }
  return M;
}

const applyLin = (M, [x, y]) => [M[0][0] * x + M[0][1] * y, M[1][0] * x + M[1][1] * y];

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = createView(canvas, WORLD);
  const state = { a: 1.2, b: 0.8, c: -0.3, d: 1.0, t: 3 };

  makeSliders(root.querySelector('.mv-sliders'), DEFS, (v) => {
    Object.assign(state, v);
    draw();
  });

  const matrixA = () => [[state.a, state.b], [state.c, state.d]];

  function draw() {
    const colors = themeColors();
    const A = matrixA();
    const M = stageMatrix(A, state.t);
    const { s1, s2, u1, u2, v1, v2 } = svd2x2(A);

    drawGrid(ctx, view, colors);

    // 입력 단위원 (흐림) + 입력 쪽 특이벡터
    drawPolygon(ctx, view, CIRCLE, { stroke: colors.muted, width: 1.2 });
    drawArrow(ctx, view, [0, 0], v1, { color: colors.muted, width: 1.5 });
    drawArrow(ctx, view, [0, 0], v2, { color: colors.muted, width: 1.5 });

    // 현재 단계의 도형
    drawPolygon(ctx, view, CIRCLE.map((p) => applyLin(M, p)),
      { stroke: colors.accent, fill: `${colors.accent}22`, width: 2 });

    // 출력 쪽 특이벡터 (길이가 σ) — t = 3 일 때 타원의 두 반축이다
    if (state.t > 2.99) {
      drawArrow(ctx, view, [0, 0], [u1[0] * s1, u1[1] * s1],
        { color: colors.accent2, width: 2.5 });
      drawArrow(ctx, view, [0, 0], [u2[0] * s2, u2[1] * s2],
        { color: colors.accent2, width: 2.5 });
    }

    renderMatrix(root.querySelector('.mv-matrix-host'),
      [[M[0][0], M[0][1], 0], [M[1][0], M[1][1], 0], [0, 0, 1]]);

    const cond = s2 > 1e-12 ? (s1 / s2).toFixed(2) : '∞';
    const conformal = Math.abs(s1 - s2) < 1e-9;
    const inv = pseudoInverse2x2(A, 1e-12);
    const trunc = pseudoInverse2x2(A, TRUNC_TOL);
    const norm = (P) => Math.max(...P.flat().map(Math.abs));
    const { s2signed } = svdRotationForm(A);

    root.querySelector('.mv-readout').innerHTML = `
      σ₁ = <b>${s1.toFixed(3)}</b> &nbsp; σ₂ = <b>${s2.toFixed(3)}</b>
      &nbsp; 조건수 σ₁/σ₂ = <b>${cond}</b><br>
      각도 보존 ${conformal
    ? '<span class="ok">예</span> (σ₁ = σ₂)'
    : '<span class="no">아니오</span>'}
      ${s2signed < 0 ? '&nbsp; · <span class="no">뒤집힘 (det &lt; 0)</span>' : ''}<br>
      A⁻¹ 최대 원소 <b>${s2 > 1e-12 ? norm(inv).toFixed(1) : '발산'}</b>
      &nbsp; 절단 A⁺ (σ ≤ ${TRUNC_TOL}) 최대 원소 <b>${norm(trunc).toFixed(1)}</b>`;

    root.querySelector('.mv-hint').textContent = state.t > 2.99
      ? 'a·b·c·d 를 아무 값으로나 놓아보세요. 빨간 화살표 두 개가 타원의 반축이고 '
        + '그 길이가 σ₁, σ₂ 입니다. σ₂ 를 0 에 가깝게 만들면 타원이 선분으로 붕괴합니다.'
      : '단계 슬라이더: 0→1 회전(Vᵀ), 1→2 축 방향 스케일(Σ), 2→3 회전(U). '
        + '3 에서의 결과가 A 를 한 번 곱한 것과 같습니다.';
  }

  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
