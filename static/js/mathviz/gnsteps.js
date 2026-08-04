// static/js/mathviz/gnsteps.js
// 데모 2 — κ 는 반복 횟수를 정하지 않는다.
//
// 왼쪽은 한 문제의 **수렴 곡선**(스텝 대 오차, 로그 y), 오른쪽은 κ 를 쓸어가며 본
// **κ 대 스텝 수**(로그-로그)다. 오른쪽이 이 데모의 핵심이다 — 3편의 "κ 가 반복수를
// 정한다" 가 경사하강 곡선에서는 기울기 1 로 재현되고, 가우스-뉴턴 곡선에서는
// 평평하다.
//
// ⚠️ 경사하강의 필요 스텝 수는 **예측값**이다 (3편의 수축률 공식). 브라우저에서
// 1e6 스텝을 돌릴 수 없다 — 스펙 §3-7. 실제로 돌리는 것은 예산만큼이고, 그 결과는
// 왼쪽 곡선에 그린다.

import {
  lookAt, intrinsics, projectPoint, cameraCenter,
  add, sub, scale, norm, normalize,
} from './camera.js';
import {
  triangulateMidpoint, triangulateDLT, triangulateGN, descentPath,
  gdStepsPredicted, errorEllipsoid, makeRng, gaussian,
} from './triangulate.js';
import { F_DEFAULT, IMAGE_CX, IMAGE_CY } from './scene.js';
import {
  themeColors, onThemeChange, createView, drawPath,
  makeSliders, makeRadios,
} from './core.js';

const K = intrinsics({ f: F_DEFAULT, cx: IMAGE_CX, cy: IMAGE_CY });
const UP = [0, 0, 1];
const TARGET = [0, 0, 0.8];
/** 베이스라인 고정 4 m — 이 데모는 거리로만 κ 를 움직인다. */
const BASELINE = 4;
const SEED = 77;
/** 오른쪽 스윕에 쓰는 거리들. κ 를 1.6 에서 5e4 까지 덮는다. */
const SWEEP = [4, 8, 16, 32, 64, 128, 256, 512];

function stereo(B) {
  return {
    cam1: { K, ...lookAt({ eye: [-B / 2, -6, 1.6], target: TARGET, up: UP }) },
    cam2: { K, ...lookAt({ eye: [B / 2, -6, 1.6], target: TARGET, up: UP }) },
  };
}
function pointAt(cam1, cam2, dist) {
  const mid = scale(add(cameraCenter(cam1), cameraCenter(cam2)), 0.5);
  return add(mid, scale(normalize(sub(TARGET, mid)), dist));
}
/** 시드 고정 대응쌍 하나. 같은 슬라이더 값이면 같은 그림이 나온다. */
function noisyPair(cam1, cam2, X, sigma) {
  const rand = makeRng(SEED);
  const a = projectPoint(cam1, X), b = projectPoint(cam2, X);
  return [
    [a.u + sigma * gaussian(rand), a.v + sigma * gaussian(rand)],
    [b.u + sigma * gaussian(rand), b.v + sigma * gaussian(rand)],
  ];
}

export function init(root) {
  const canvases = root.querySelectorAll('canvas');
  if (canvases.length < 2) throw new Error('gnsteps 는 panes="2" 가 필요하다');
  const [curveCanvas, sweepCanvas] = canvases;

  const curveWorld = { xmin: 0, xmax: 200, ymin: -14, ymax: 2 };
  const sweepWorld = { xmin: 0, xmax: 5, ymin: 0, ymax: 6 };
  const curveView = createView(curveCanvas, curveWorld);
  const sweepView = createView(sweepCanvas, sweepWorld);

  const sliderHost = root.querySelector('.mv-sliders');
  const readout = root.querySelector('.mv-readout');
  const hint = root.querySelector('.mv-hint');

  const state = { dist: 32, sigma: 1, budget: 200, start: 'mid' };

  makeSliders(sliderHost, [
    { key: 'dist', label: '점까지 거리', min: 4, max: 512, step: 4, value: 32,
      fmt: (v) => `${v.toFixed(0)} m` },
    { key: 'sigma', label: '화소 잡음 σ', min: 0.2, max: 10, step: 0.2, value: 1,
      fmt: (v) => `${v.toFixed(1)} px` },
    { key: 'budget', label: '경사하강 예산', min: 20, max: 1000, step: 20, value: 200,
      fmt: (v) => `${v.toFixed(0)} 스텝` },
  ], (v) => { Object.assign(state, v); render(); });

  makeRadios(sliderHost, {
    key: 'start',
    label: '초기값',
    value: 'mid',
    options: [{ value: 'mid', label: '중점법' }, { value: 'dlt', label: 'DLT' }],
  }, (v) => { Object.assign(state, v); render(); });

  /** 한 문제를 두 방법으로 푼다. → 스텝별 오차 배열 둘. */
  function solveBoth(cam1, cam2, X, sigma, budget) {
    const [x1, x2] = noisyPair(cam1, cam2, X, sigma);
    const m = triangulateMidpoint(cam1, cam2, x1, x2);
    const d = triangulateDLT(cam1, cam2, x1, x2);
    if (!m || !d) return null;
    const X0 = state.start === 'mid' ? m.X : d.X;
    // 수렴한 해를 기준으로 잡는다 — 참 점이 아니라 **그 잡음의 최적해**여야
    // 두 방법의 비교가 공정하다
    const star = triangulateGN(cam1, cam2, x1, x2, X0, { maxIter: 80 }).X;
    const gn = triangulateGN(cam1, cam2, x1, x2, X0, { maxIter: 12 });
    const gd = descentPath(cam1, cam2, x1, x2, X0, { steps: budget, sample: 1 });
    const err = (path) => path.map((P) => Math.max(norm(sub(P, star)), 1e-15));
    return {
      star,
      gnErr: err(gn.path),
      gdErr: err(gd.path),
      gnIters: gn.iters,
      kappa: gn.kappa,
      eta: gd.eta,
    };
  }

  /** 로그 y 축 곡선. pts 는 [스텝, 오차]. */
  function plotLog(ctx, view, errs, color, width) {
    const pts = errs.map((e, i) => [i, Math.log10(e)]);
    drawPath(ctx, view, pts, { color, width });
  }

  function axisLabels(ctx, view, xTicks, yTicks, c, fmtX, fmtY) {
    ctx.fillStyle = c.muted;
    ctx.font = '11px system-ui, sans-serif';
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    const { w, h } = view.size;
    for (const x of xTicks) {
      const [px] = view.toPixel([x, 0]);
      if (px < 0 || px > w) continue;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
      ctx.fillText(fmtX(x), px + 3, h - 4);
    }
    for (const y of yTicks) {
      const [, py] = view.toPixel([0, y]);
      if (py < 0 || py > h) continue;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
      ctx.fillText(fmtY(y), 3, py - 3);
    }
  }

  function render() {
    const c = themeColors();
    const { cam1, cam2 } = stereo(BASELINE);
    const X = pointAt(cam1, cam2, state.dist);
    const sol = solveBoth(cam1, cam2, X, state.sigma, state.budget);
    if (!sol) return;

    // ---------- 왼쪽: 수렴 곡선 ----------
    curveView.resize();
    const ctx = curveCanvas.getContext('2d');
    const { w, h } = curveView.size;
    ctx.clearRect(0, 0, w, h);
    curveWorld.xmin = 0;
    curveWorld.xmax = state.budget;
    const lo = Math.min(...sol.gnErr.map(Math.log10), ...sol.gdErr.map(Math.log10));
    const hi = Math.max(...sol.gnErr.map(Math.log10), ...sol.gdErr.map(Math.log10));
    curveWorld.ymin = Math.floor(lo) - 0.5;
    curveWorld.ymax = Math.ceil(hi) + 0.5;
    const step = Math.max(1, Math.round(state.budget / 5));
    axisLabels(
      ctx, curveView,
      Array.from({ length: 6 }, (_, i) => i * step),
      Array.from(
        { length: Math.ceil(curveWorld.ymax - curveWorld.ymin) + 1 },
        (_, i) => Math.ceil(curveWorld.ymin) + i,
      ),
      c, (x) => `${x}`, (y) => `1e${y}`,
    );
    plotLog(ctx, curveView, sol.gdErr, c.accent, 2);      // 경사하강 — 청
    plotLog(ctx, curveView, sol.gnErr, c.accent2, 2.5);   // 가우스-뉴턴 — 적
    // GN 이 멈춘 지점에 점을 찍는다
    {
      const i = sol.gnErr.length - 1;
      const [px, py] = curveView.toPixel([i, Math.log10(sol.gnErr[i])]);
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = c.accent2; ctx.fill();
    }

    // ---------- 오른쪽: κ 대 스텝 수 (로그-로그) ----------
    sweepView.resize();
    const sctx = sweepCanvas.getContext('2d');
    const ss = sweepView.size;
    sctx.clearRect(0, 0, ss.w, ss.h);
    const rows = SWEEP.map((dist) => {
      const Y = pointAt(cam1, cam2, dist);
      const s = solveBoth(cam1, cam2, Y, state.sigma, 1);
      if (!s) return null;
      return {
        dist,
        kappa: s.kappa,
        gn: Math.max(s.gnIters, 1),
        gdPred: gdStepsPredicted(s.kappa),
      };
    }).filter(Boolean);
    sweepWorld.xmin = 0;
    sweepWorld.xmax = Math.ceil(Math.max(...rows.map((r) => Math.log10(r.kappa)))) + 0.3;
    sweepWorld.ymin = -0.3;
    sweepWorld.ymax = Math.ceil(Math.max(...rows.map((r) => Math.log10(r.gdPred)))) + 0.3;
    axisLabels(
      sctx, sweepView,
      Array.from({ length: 7 }, (_, i) => i),
      Array.from({ length: 8 }, (_, i) => i),
      c, (x) => `κ 1e${x}`, (y) => `1e${y}`,
    );
    drawPath(sctx, sweepView, rows.map((r) => [Math.log10(r.kappa), Math.log10(r.gdPred)]),
      { color: c.accent, width: 2 });
    drawPath(sctx, sweepView, rows.map((r) => [Math.log10(r.kappa), Math.log10(r.gn)]),
      { color: c.accent2, width: 2.5 });
    for (const r of rows) {
      for (const [val, color] of [[r.gdPred, c.accent], [r.gn, c.accent2]]) {
        const [px, py] = sweepView.toPixel([Math.log10(r.kappa), Math.log10(val)]);
        sctx.beginPath(); sctx.arc(px, py, 2.6, 0, Math.PI * 2);
        sctx.fillStyle = color; sctx.fill();
      }
    }
    // 현재 거리 표시
    {
      const [px] = sweepView.toPixel([Math.log10(sol.kappa), 0]);
      sctx.strokeStyle = c.fg; sctx.lineWidth = 1; sctx.setLineDash([3, 3]);
      sctx.beginPath(); sctx.moveTo(px, 0); sctx.lineTo(px, ss.h); sctx.stroke();
      sctx.setLineDash([]);
    }

    renderReadout(cam1, cam2, X, sol);
  }

  function renderReadout(cam1, cam2, X, sol) {
    const gdFinal = sol.gdErr[sol.gdErr.length - 1];
    const gnFinal = sol.gnErr[sol.gnErr.length - 1];
    const { ratio } = errorEllipsoid(cam1, cam2, X, state.sigma);
    const pred = gdStepsPredicted(sol.kappa);
    readout.innerHTML = `
      <div>κ(JᵀJ) = <b>${sol.kappa.toExponential(2)}</b> · √κ = ${ratio.toFixed(1)}
        <span class="mv-note">(초기값 자리에서 잼)</span></div>
      <div><span class="no">■</span> 가우스-뉴턴 <b>${sol.gnIters} 스텝</b>에
        오차 <b>${gnFinal.toExponential(1)} m</b></div>
      <div><span class="hi">■</span> 경사하강 <b>${state.budget} 스텝</b>에
        오차 <b>${gdFinal.toExponential(1)} m</b>
        ${gdFinal / gnFinal > 100 ? `<span class="no">— ${(gdFinal / gnFinal).toExponential(0)}배 뒤처짐</span>` : ''}</div>
      <div>경사하강 필요 스텝 <b>${pred.toLocaleString()}</b>
        <span class="mv-note">— 3편 수축률 공식의 <b>예측값</b>이다 (실측 아님)</span></div>
      <div>η = ${sol.eta.toExponential(2)} (1/L 로 최적 고정)</div>`;

    hint.innerHTML = `<code>점까지 거리</code>를 512 m 까지 밀어보세요. 오른쪽에서
      <b>파란 선(경사하강)</b>은 기울기 1 로 올라가고
      <b>빨간 선(가우스-뉴턴)</b>은 <b>평평합니다</b>.
      3편의 "κ 가 반복 횟수를 정한다" 는 곡률을 안 쓰는 방법에서만 참입니다.`;
  }

  onThemeChange(render);
  window.addEventListener('resize', render);
  render();
}
