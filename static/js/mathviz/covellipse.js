// static/js/mathviz/covellipse.js
// 데모 1 — 공분산은 타원이다.
//
// 왼쪽은 N(0,Σ) 표본 산점도와 1·2·3σ 타원, 오른쪽은 방향 φ 로 투영(주변화)한
// 히스토그램이다. readout 의 포함률이 핵심이다 — 1σ 안에 39% 뿐이라는 것(스펙 §2-C)을
// 그린 표본에서 직접 센다.
//
// 색 (규약 §4-1): 이론이 청(참 타원 · 예측 곡선), 표본이 적(표본 타원),
// 투영이 녹(방향선 · 히스토그램). 표본점은 muted.
//
// N 을 내리면 표본 타원(적)의 축이 흔들린다 — 그것이 §2-B 의 시연이다 (스펙 §3-4).

import {
  themeColors, onThemeChange, createView, drawGrid, drawPolygon, drawPath,
  makeSliders, makeToggles,
} from './core.js';
import {
  covFromParams, makeSampler, sampleCov, axisAngleDeg, ellipsePoints,
  containment, dirVariance, projectDir, meanSd, histogram, gaussPdf,
} from './gaussian.js';
import { symEigVec2 } from './stochastic.js';

const SCATTER_WORLD = { xmin: -6.5, xmax: 6.5, ymin: -6.5, ymax: 6.5 };
// 히스토그램 창은 render 가 매번 예측 sd 에 맞춘다 — createView 가 world 를
// 살아있는 참조로 읽는 것(noiseball 과 같은 수법)을 쓴다.
const HIST_WORLD = { xmin: -7, xmax: 7, ymin: 0, ymax: 1 };
const SEED = 8;                       // 스펙 §2-C 와 같은 시드
const BINS = 40;

const SLIDERS = [
  { key: 's1', label: 'σ1 (주축)', min: 0.2, max: 3, step: 0.05, value: 2 },
  { key: 's2', label: 'σ2 (부축)', min: 0.2, max: 3, step: 0.05, value: 0.5 },
  { key: 'theta', label: 'θ (기울기)', min: 0, max: 180, step: 1, value: 30, fmt: (v) => `${v.toFixed(0)}°` },
  { key: 'phi', label: 'φ (투영 방향)', min: 0, max: 180, step: 1, value: 0, fmt: (v) => `${v.toFixed(0)}°` },
  // 표본 타원의 흔들림(§2-B)을 보려면 N=10 까지 내려가야 하고, 포함률이 39% 에
  // 붙는 것을 보려면 수천은 필요하다. 그래서 로그 슬라이더다. 기본 1000 (스펙 §3-4).
  { key: 'logN', label: 'N (표본 수)', min: 1, max: 4.3, step: 0.1, value: 3, fmt: (v) => `${Math.round(10 ** v)}` },
];

const TOGGLES = [
  { key: 'sampleEllipse', label: '표본 타원 (1σ)', value: true },
  { key: 'axes', label: '고유축', value: true },
];

export function init(root) {
  const canvases = root.querySelectorAll('canvas');
  if (canvases.length < 2) throw new Error('covellipse 는 panes="2" 가 필요하다');
  const [scatterCanvas, histCanvas] = canvases;
  const scatterCtx = scatterCanvas.getContext('2d');
  const histCtx = histCanvas.getContext('2d');
  const scatterView = createView(scatterCanvas, SCATTER_WORLD);
  const histView = createView(histCanvas, HIST_WORLD);

  const readout = root.querySelector('.mv-readout');
  const hint = root.querySelector('.mv-hint');

  let vals = { s1: 2, s2: 0.5, theta: 30, phi: 0, logN: 3 };
  let toggles = { sampleEllipse: true, axes: true };

  const sliderHost = root.querySelector('.mv-sliders');
  makeSliders(sliderHost, SLIDERS, (v) => { vals = v; draw(); });
  makeToggles(sliderHost, TOGGLES, (v) => { toggles = v; draw(); });

  function draw() {
    const c = themeColors();
    const N = Math.round(10 ** vals.logN);
    const Sigma = covFromParams(vals.s1, vals.s2, vals.theta);
    const gen = makeSampler(vals.s1, vals.s2, vals.theta, SEED);
    const pts = Array.from({ length: N }, gen);
    const { mean, cov } = sampleCov(pts);
    const fracs = containment(Sigma, [0, 0], pts);

    // ── 왼쪽: 산점도 + 타원 ──
    drawGrid(scatterCtx, scatterView, c);

    scatterCtx.fillStyle = c.muted;
    scatterCtx.globalAlpha = 0.4;
    for (const p of pts) {
      const [px, py] = scatterView.toPixel(p);
      scatterCtx.beginPath(); scatterCtx.arc(px, py, 1.6, 0, Math.PI * 2); scatterCtx.fill();
    }
    scatterCtx.globalAlpha = 1;

    if (toggles.axes) {
      const { l1, l2, v1, v2 } = symEigVec2(Sigma);
      const pairs = [[v1, Math.sqrt(l1)], [v2, Math.sqrt(l2)]];
      for (const [v, s] of pairs) {
        drawPath(scatterCtx, scatterView,
          [[-v[0] * s * 3.4, -v[1] * s * 3.4], [v[0] * s * 3.4, v[1] * s * 3.4]],
          { color: c.grid, width: 1.5 });
      }
    }

    for (const k of [1, 2, 3]) {
      drawPolygon(scatterCtx, scatterView, ellipsePoints(Sigma, k),
        { stroke: c.accent, width: k === 1 ? 2.5 : 1.5 });
    }

    if (toggles.sampleEllipse && N >= 3) {
      const shifted = ellipsePoints(cov, 1).map(([x, y]) => [x + mean[0], y + mean[1]]);
      drawPolygon(scatterCtx, scatterView, shifted, { stroke: c.accent2, width: 2 });
    }

    // 투영 방향선 (녹, 점선)
    const t = (vals.phi * Math.PI) / 180;
    const d = [Math.cos(t), Math.sin(t)];
    scatterCtx.setLineDash([6, 5]);
    drawPath(scatterCtx, scatterView, [[-d[0] * 9, -d[1] * 9], [d[0] * 9, d[1] * 9]],
      { color: c.accent3, width: 2 });
    scatterCtx.setLineDash([]);

    // ── 오른쪽: 방향 φ 의 주변화 히스토그램 ──
    const predSd = Math.sqrt(dirVariance(Sigma, vals.phi));
    const proj = projectDir(pts, vals.phi);
    const span = Math.max(predSd * 3.8, 0.8);
    HIST_WORLD.xmin = -span; HIST_WORLD.xmax = span;
    const h = histogram(proj, { min: -span, max: span, bins: BINS });
    const peak = gaussPdf(0, 0, predSd);
    HIST_WORLD.ymax = Math.max(peak, ...h.density) * 1.15;
    HIST_WORLD.ymin = 0;

    const { w: hw, h: hh } = histView.size;
    histCtx.clearRect(0, 0, hw, hh);
    histCtx.fillStyle = c.accent3;
    histCtx.globalAlpha = 0.55;
    const bw = (2 * span) / BINS;
    h.density.forEach((den, i) => {
      const [x0, y0] = histView.toPixel([h.edges[i], den]);
      const [x1, y1] = histView.toPixel([h.edges[i] + bw, 0]);
      histCtx.fillRect(x0, y0, x1 - x0, y1 - y0);
    });
    histCtx.globalAlpha = 1;

    // 예측 곡선 N(0, dᵀΣd) — 청. 표본에서 얻은 게 아니라 참 Σ 에서 계산한 값이다.
    const curve = [];
    for (let i = 0; i <= 120; i++) {
      const x = -span + (2 * span * i) / 120;
      curve.push([x, gaussPdf(x, 0, predSd)]);
    }
    drawPath(histCtx, histView, curve, { color: c.accent, width: 2.5 });

    // 기준선
    histCtx.strokeStyle = c.muted;
    histCtx.lineWidth = 1;
    const [, baseY] = histView.toPixel([0, 0]);
    histCtx.beginPath(); histCtx.moveTo(0, baseY); histCtx.lineTo(hw, baseY); histCtx.stroke();

    // ── readout ──
    const m3 = (M) => `[[${M[0][0].toFixed(3)}, ${M[0][1].toFixed(3)}], [·, ${M[1][1].toFixed(3)}]]`;
    let angErr = axisAngleDeg(cov) - axisAngleDeg(Sigma);
    while (angErr > 90) angErr -= 180;
    while (angErr < -90) angErr += 180;
    const frobErr = Math.hypot(
      cov[0][0] - Sigma[0][0], cov[0][1] - Sigma[0][1],
      cov[1][0] - Sigma[1][0], cov[1][1] - Sigma[1][1],
    );
    const projSd = meanSd(proj).sd;
    const pct = (x) => `${(x * 100).toFixed(1)}%`;
    readout.innerHTML = `
      <div>참 Σ = ${m3(Sigma)}</div>
      <div>표본 Σ̂ = <span style="color:${c.accent2}">${m3(cov)}</span>
        &nbsp;·&nbsp; ‖Σ̂−Σ‖F = <b>${frobErr.toFixed(3)}</b>
        &nbsp;·&nbsp; 축각 오차 = <b>${Math.abs(angErr).toFixed(2)}°</b></div>
      <table class="mv-table"><thead>
        <tr><th>k</th><th style="text-align:right">타원 안 실측 (N=${N})</th>
        <th style="text-align:right">닫힌형 1−e<sup>−k²/2</sup></th>
        <th style="text-align:right">1D 라면</th></tr>
      </thead><tbody>
        <tr><td>1σ</td><td style="text-align:right"><b>${pct(fracs[0])}</b></td>
          <td style="text-align:right">39.35%</td><td style="text-align:right">68.27%</td></tr>
        <tr><td>2σ</td><td style="text-align:right">${pct(fracs[1])}</td>
          <td style="text-align:right">86.47%</td><td style="text-align:right">95.45%</td></tr>
        <tr><td>3σ</td><td style="text-align:right">${pct(fracs[2])}</td>
          <td style="text-align:right">98.89%</td><td style="text-align:right">99.73%</td></tr>
      </tbody></table>
      <div>φ=${vals.phi}° 투영: 실측 sd <b>${projSd.toFixed(4)}</b>
        &nbsp;·&nbsp; 예측 √(dᵀΣd) = <b>${predSd.toFixed(4)}</b></div>
      <div style="opacity:.7;font-size:.85em">글의 표는 N=10⁶ 에서 잰 값이고 테스트가
        고정한다. 여기 포함률은 그린 표본 ${N}개에서 그때그때 센다.</div>`;

    hint.textContent =
      'N 을 10 으로 내려보세요 — 표본 타원(적)의 축이 3° 넘게 흔들립니다. '
      + 'φ 를 돌리면 오른쪽 히스토그램의 폭이 타원의 그 방향 두께를 따라갑니다. '
      + '1σ 타원 안에는 언제나 39% 근방입니다 — 68% 는 1차원 문장입니다.';
  }

  const redraw = () => { scatterView.resize(); histView.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
