import { rigid, applyAll, preservation, UNIT_SQUARE } from './transform.js';
import {
  themeColors, onThemeChange, createView, drawGrid, drawPolygon,
  drawHandles, makeSliders, attachDrag, renderMatrix,
} from './core.js';

const WORLD = { xmin: -2, xmax: 2, ymin: -2, ymax: 2 };

const RIGID_DEFS = [
  { key: 'theta', label: 'θ', min: -180, max: 180, step: 1, value: 30,
    fmt: (v) => `${v.toFixed(0)}°` },
  { key: 'tx', label: 'tx', min: -2, max: 2, step: 0.01, value: 0 },
  { key: 'ty', label: 'ty', min: -2, max: 2, step: 0.01, value: 0 },
];

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = createView(canvas, WORLD);

  const state = { theta: 30, tx: 0, ty: 0 };

  const sliders = makeSliders(root.querySelector('.mv-sliders'), RIGID_DEFS, (v) => {
    Object.assign(state, v);
    draw();
  });

  const matrix = () => rigid({
    theta: state.theta * Math.PI / 180, tx: state.tx, ty: state.ty,
  });

  // 드래그 핸들: [0] 평행이동, [1] 회전
  const handles = () => applyAll(matrix(), UNIT_SQUARE).slice(0, 2);

  attachDrag(canvas, view, handles, (i, p) => {
    if (i === 0) {
      state.tx = p[0]; state.ty = p[1];
    } else {
      const dx = p[0] - state.tx, dy = p[1] - state.ty;
      state.theta = Math.atan2(dy, dx) * 180 / Math.PI;
    }
    Object.assign(state, sliders.clamp(state));
    sliders.setValues(state);
    draw();
  });

  function draw() {
    const colors = themeColors();
    const M = matrix();
    drawGrid(ctx, view, colors);
    drawPolygon(ctx, view, UNIT_SQUARE, { stroke: colors.muted, width: 1.5 });
    drawPolygon(ctx, view, applyAll(M, UNIT_SQUARE),
      { stroke: colors.accent, fill: `${colors.accent}22`, firstEdge: colors.accent2 });
    drawHandles(ctx, view, handles(), colors);
    renderMatrix(root.querySelector('.mv-matrix-host'), M);

    const p = preservation(M);
    const mark = (ok) => (ok ? '<span class="ok">보존</span>' : '<span class="no">깨짐</span>');
    root.querySelector('.mv-readout').innerHTML = `
      길이 ${mark(p.keepsLength)} &nbsp; 각도 ${mark(p.keepsAngle)} &nbsp;
      평행 ${mark(p.keepsParallel)}<br>
      변 길이비 ${p.lengthRatio.toFixed(3)} · 사잇각 ${p.angleDeg.toFixed(1)}°`;
    root.querySelector('.mv-hint').textContent =
      '빨간 점을 끌어보세요 — 왼쪽 아래는 평행이동, 오른쪽 아래는 회전입니다.';
  }

  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
