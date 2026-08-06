// static/js/mathviz/condslice.js
// 데모 2 — 자르면(조건부) 분산이 준다.
//
// 왼쪽은 상관 ρ 인 결합분포와 x₂≈c 슬라이스 띠, 오른쪽은 x₁ 의 주변분포(청 곡선)와
// 슬라이스 안 표본의 히스토그램(적)·폭 0 이론 곡선(녹)이다. 주변 sd 는 1 로 그대로인데
// 조건 sd 가 √(1−ρ²) 로 주는 것(스펙 §2-E)이 이 데모의 주장이다.
//
// 색 (규약 §4-1): 주변(전체)이 청, 조건(슬라이스 표본·히스토그램)이 적,
// 조건부 이론 곡선이 녹, 슬라이스 띠는 회색(grid) 채움.
//
// ⚠️ w 를 키우면 실측 sd 가 √(1−ρ²) 에서 떠오른다 — 데모의 결함이 아니라
// 유한 폭의 성질이고(스펙 §2-E2), readout 이 폭 보정식을 병기한다 (스펙 §3-3).

import {
  themeColors, onThemeChange, createView, drawGrid, drawPolygon, drawPath,
  makeSliders,
} from './core.js';
import {
  ellipsePoints, makeCorrSampler, sliceValues, meanSd, conditionalParams,
  histogram, gaussPdf,
} from './gaussian.js';

const JOINT_WORLD = { xmin: -4, xmax: 4, ymin: -4, ymax: 4 };
const HIST_WORLD = { xmin: -4, xmax: 4, ymin: 0, ymax: 1 };
const SEED = 21;                      // 스펙 §2-E 와 같은 시드
const BINS = 40;
const DRAW_MAX = 4000;                // 산점도에 찍는 최대 점 수 — 그 이상은 죽이 된다

const SLIDERS = [
  { key: 'rho', label: 'ρ (상관)', min: -0.99, max: 0.99, step: 0.01, value: 0.9 },
  { key: 'c', label: 'c (자르는 위치)', min: -2, max: 2, step: 0.05, value: 1 },
  { key: 'w', label: 'w (슬라이스 폭)', min: 0.05, max: 2, step: 0.05, value: 0.1 },
  { key: 'logN', label: 'N (표본 수)', min: 3, max: 5.5, step: 0.1, value: 5, fmt: (v) => `${Math.round(10 ** v)}` },
];

export function init(root) {
  const canvases = root.querySelectorAll('canvas');
  if (canvases.length < 2) throw new Error('condslice 는 panes="2" 가 필요하다');
  const [jointCanvas, histCanvas] = canvases;
  const jointCtx = jointCanvas.getContext('2d');
  const histCtx = histCanvas.getContext('2d');
  const jointView = createView(jointCanvas, JOINT_WORLD);
  const histView = createView(histCanvas, HIST_WORLD);

  const readout = root.querySelector('.mv-readout');
  const hint = root.querySelector('.mv-hint');

  let vals = { rho: 0.9, c: 1, w: 0.1, logN: 5 };

  makeSliders(root.querySelector('.mv-sliders'), SLIDERS, (v) => { vals = v; draw(); });

  function draw() {
    const c = themeColors();
    const N = Math.round(10 ** vals.logN);
    const gen = makeCorrSampler(vals.rho, SEED);
    const pts = Array.from({ length: N }, gen);
    const sel = sliceValues(pts, vals.c, vals.w);
    const cond = meanSd(sel);
    const marg = meanSd(pts.map((p) => p[0]));
    const theory = conditionalParams(vals.rho, vals.c, vals.w);
    const Sigma = [[1, vals.rho], [vals.rho, 1]];

    // ── 왼쪽: 결합분포 + 슬라이스 띠 ──
    drawGrid(jointCtx, jointView, c);

    // 슬라이스 띠 |x₂−c| < w/2 — x₂ 가 세로축이다
    const [, yTop] = jointView.toPixel([0, vals.c + vals.w / 2]);
    const [, yBot] = jointView.toPixel([0, vals.c - vals.w / 2]);
    const { w: jw } = jointView.size;
    jointCtx.fillStyle = c.grid;
    jointCtx.globalAlpha = 0.45;
    jointCtx.fillRect(0, yTop, jw, Math.max(yBot - yTop, 2));
    jointCtx.globalAlpha = 1;

    // 표본 — 띠 밖은 muted, 안은 적
    const step = Math.max(1, Math.floor(N / DRAW_MAX));
    for (let i = 0; i < N; i += step) {
      const [x1, x2] = pts[i];
      const inBand = Math.abs(x2 - vals.c) < vals.w / 2;
      jointCtx.fillStyle = inBand ? c.accent2 : c.muted;
      jointCtx.globalAlpha = inBand ? 0.85 : 0.3;
      const [px, py] = jointView.toPixel([x1, x2]);
      jointCtx.beginPath(); jointCtx.arc(px, py, 1.6, 0, Math.PI * 2); jointCtx.fill();
    }
    jointCtx.globalAlpha = 1;

    // 결합분포의 1·2σ 타원 (청)
    for (const k of [1, 2]) {
      drawPolygon(jointCtx, jointView, ellipsePoints(Sigma, k),
        { stroke: c.accent, width: k === 1 ? 2.5 : 1.5 });
    }

    // 조건 평균의 자리 ρc — 띠 위의 세로 눈금 (적)
    drawPath(jointCtx, jointView,
      [[theory.mean, vals.c - vals.w / 2 - 0.25], [theory.mean, vals.c + vals.w / 2 + 0.25]],
      { color: c.accent2, width: 2 });

    // ── 오른쪽: 주변(청) 대 조건(적 히스토그램 + 녹 이론) ──
    const peak = gaussPdf(0, 0, Math.max(theory.sd0, 0.05));
    HIST_WORLD.ymax = Math.max(peak, gaussPdf(0, 0, 1)) * 1.15;

    const { w: hw, h: hh } = histView.size;
    histCtx.clearRect(0, 0, hw, hh);

    if (cond.n >= 2) {
      const h = histogram(sel, { min: -4, max: 4, bins: BINS });
      const bw = 8 / BINS;
      histCtx.fillStyle = c.accent2;
      histCtx.globalAlpha = 0.55;
      h.density.forEach((den, i) => {
        const [x0, y0] = histView.toPixel([h.edges[i], den]);
        const [x1, y1] = histView.toPixel([h.edges[i] + bw, 0]);
        histCtx.fillRect(x0, y0, x1 - x0, y1 - y0);
      });
      histCtx.globalAlpha = 1;
    }

    const curveOf = (mu, sd) => {
      const out = [];
      for (let i = 0; i <= 160; i++) {
        const x = -4 + (8 * i) / 160;
        out.push([x, gaussPdf(x, mu, sd)]);
      }
      return out;
    };
    drawPath(histCtx, histView, curveOf(0, 1), { color: c.accent, width: 2 });
    drawPath(histCtx, histView, curveOf(theory.mean, theory.sd0), { color: c.accent3, width: 2.5 });

    histCtx.strokeStyle = c.muted;
    histCtx.lineWidth = 1;
    const [, baseY] = histView.toPixel([0, 0]);
    histCtx.beginPath(); histCtx.moveTo(0, baseY); histCtx.lineTo(hw, baseY); histCtx.stroke();

    // ── readout ──
    const f4 = (x) => (Number.isFinite(x) ? x.toFixed(4) : '—');
    readout.innerHTML = `
      <div>주변 sd 실측 = <b>${f4(marg.sd)}</b> (이론 1 — ρ 와 무관)</div>
      <div>조건 sd 실측 = <b>${f4(cond.sd)}</b>
        &nbsp;·&nbsp; 폭 0 이론 √(1−ρ²) = <b>${f4(theory.sd0)}</b>
        &nbsp;·&nbsp; 폭 보정 = ${f4(theory.sdW)}</div>
      <div>조건 평균 실측 = ${f4(cond.mean)} &nbsp;·&nbsp; 이론 ρc = ${f4(theory.mean)}</div>
      <div>슬라이스 표본 <b>${cond.n}</b> / ${N}</div>
      <div style="opacity:.7;font-size:.85em">글의 표(0.4374 등)는 N=2×10⁶ 에서 잰 값이고
        테스트가 고정한다. 폭 보정식 √((1−ρ²)+ρ²w²/12) 은 w≤1 에서만 맞는다 — w=2 로
        밀면 실측이 보정식보다 낮아진다 (§2-E2).</div>`;

    hint.textContent =
      'ρ 를 0 → 0.99 로 밀어보세요. 주변 sd(청 곡선)는 1 그대로인데 조건 sd(적 히스토그램)가 '
      + '√(1−ρ²) 로 좁아집니다 — 아는 것이 분산을 줄입니다. c 를 움직이면 조건 평균이 '
      + 'ρc 를 따라가고, w 를 키우면 실측 sd 가 이론에서 떠오릅니다 — 그건 버그가 아니라 폭의 값입니다.';
  }

  const redraw = () => { jointView.resize(); histView.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
