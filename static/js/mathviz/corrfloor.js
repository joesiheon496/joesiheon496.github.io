// static/js/mathviz/corrfloor.js
// 데모 2 — 같이 틀리는 오차는 평균으로 못 지운다.
//
// 왼쪽은 시행 24행 — 행마다 센서 N 개의 읽기(점)와 그 평균(적 눈금), 참값은 0 의
// 세로선이다. ρ 를 올리면 **행 전체가 통째로** 밀리는 것이 보인다 — 그것이 공통인자다.
// 오른쪽은 log–log 의 sd(평균) 대 N — 독립의 −½ 직선에서 떨어져 √ρ 바닥(녹 점선)에
// 붙는다 (스펙 §2-C).
//
// 색 (규약 §4-1): 실측이 적(행 평균 · 오른쪽 곡선), 닫힌형 이론이 청,
// 독립 1/√N 이 muted 점선, 바닥 √ρ 가 녹 점선. 센서 읽기는 muted.

import {
  themeColors, onThemeChange, createView, drawGrid, drawPath,
  makeSliders,
} from './core.js';
import { corrTrials, corrMeanSd, sdOf } from './expectation.js';

const ROWS = 24;
const ROWS_SEED = 7;
const N_GRID = [1, 3, 10, 30, 100, 300, 1000];
const TRIALS = 400;                    // 오른쪽 곡선의 시행 수 — 표(4000)보다 작다
const CURVE_SEED = 43;                 // 스펙 §2-C 와 같은 시드

const ROWS_WORLD = { xmin: -3, xmax: 3, ymin: -0.5, ymax: ROWS - 0.5 };
const LOG_WORLD = { xmin: 0, xmax: 3, ymin: -2, ymax: 0.3 };   // log10 N, log10 sd

export function init(root) {
  const canvases = root.querySelectorAll('canvas');
  if (canvases.length < 2) throw new Error('corrfloor 는 panes="2" 가 필요하다');
  const [rowsCanvas, logCanvas] = canvases;
  const rowsCtx = rowsCanvas.getContext('2d');
  const logCtx = logCanvas.getContext('2d');
  const rowsView = createView(rowsCanvas, ROWS_WORLD);
  const logView = createView(logCanvas, LOG_WORLD);

  const readout = root.querySelector('.mv-readout');
  const hint = root.querySelector('.mv-hint');

  let vals = { rho: 0.1, N: 10 };

  makeSliders(root.querySelector('.mv-sliders'), [
    { key: 'rho', label: 'ρ (센서끼리 상관)', min: 0, max: 0.5, step: 0.01, value: 0.1 },
    { key: 'N', label: 'N (센서 수, 왼쪽)', min: 2, max: 50, step: 1, value: 10, fmt: (v) => v.toFixed(0) },
  ], (v) => { vals = v; draw(); });

  function draw() {
    const c = themeColors();

    // ── 왼쪽: 시행 24행 ──
    const { w: rw, h: rh } = rowsView.size;
    rowsCtx.clearRect(0, 0, rw, rh);
    const trials = corrTrials({ rho: vals.rho, N: vals.N, trials: ROWS, seed: ROWS_SEED });

    // 참값 0 의 세로선
    drawPath(rowsCtx, rowsView, [[0, -0.5], [0, ROWS - 0.5]], { color: c.fg, width: 1.5 });

    trials.forEach((tr, row) => {
      rowsCtx.fillStyle = c.muted;
      rowsCtx.globalAlpha = 0.55;
      for (const x of tr.readings) {
        if (Math.abs(x) > 3) continue;
        const [px, py] = rowsView.toPixel([x, row]);
        rowsCtx.beginPath(); rowsCtx.arc(px, py, 2, 0, Math.PI * 2); rowsCtx.fill();
      }
      rowsCtx.globalAlpha = 1;
      // 행 평균 — 적 세로 눈금
      drawPath(rowsCtx, rowsView, [[tr.mean, row - 0.38], [tr.mean, row + 0.38]],
        { color: c.accent2, width: 2.5 });
    });

    // ── 오른쪽: sd(평균) 대 N ──
    drawGrid(logCtx, logView, c);
    const lg = Math.log10;

    // 독립 1/√N (muted 점선)과 바닥 √ρ (녹 점선)
    logCtx.setLineDash([5, 5]);
    drawPath(logCtx, logView, [[0, 0], [3, -1.5]], { color: c.muted, width: 1.5 });
    if (vals.rho > 0) {
      const floor = lg(Math.sqrt(vals.rho));
      drawPath(logCtx, logView, [[0, floor], [3, floor]], { color: c.accent3, width: 2 });
    }
    logCtx.setLineDash([]);

    // 닫힌형 (청)
    drawPath(logCtx, logView,
      N_GRID.map((N) => [lg(N), lg(corrMeanSd(vals.rho, N))]),
      { color: c.accent, width: 2 });

    // 실측 (적) — 스펙 §2-C 와 같은 시드, 시행만 400
    const measured = N_GRID.map((N) => {
      const ms = corrTrials({ rho: vals.rho, N, trials: TRIALS, seed: CURVE_SEED }).map((t) => t.mean);
      return { N, sd: sdOf(ms) };
    });
    drawPath(logCtx, logView, measured.map((r) => [lg(r.N), lg(Math.max(r.sd, 1e-4))]),
      { color: c.accent2, width: 2.5 });
    for (const r of measured) {
      const [px, py] = logView.toPixel([lg(r.N), lg(Math.max(r.sd, 1e-4))]);
      logCtx.fillStyle = c.accent2;
      logCtx.beginPath(); logCtx.arc(px, py, 3, 0, Math.PI * 2); logCtx.fill();
    }

    // ── readout ──
    const f4 = (x) => x.toFixed(4);
    const at1000 = measured[measured.length - 1];
    const floor = Math.sqrt(vals.rho);
    readout.innerHTML = `
      <div>sd(평균), N=1000 — 실측 <b style="color:${c.accent2}">${f4(at1000.sd)}</b>
        &nbsp;·&nbsp; 닫힌형 √(1/N+(1−1/N)ρ) = <b style="color:${c.accent}">${f4(corrMeanSd(vals.rho, 1000))}</b></div>
      <div>독립이라면 1/√1000 = <b>0.0316</b>
        &nbsp;·&nbsp; 바닥 √ρ = <b style="color:${c.accent3}">${vals.rho > 0 ? f4(floor) : '0 (독립)'}</b></div>
      <div>${vals.rho > 0
    ? `센서를 아무리 늘려도 <b>${f4(floor)}</b> 아래로 못 내려간다 — ρ=${vals.rho.toFixed(2)} 는
      N ≈ ${Math.max(2, Math.round(1 / vals.rho))} 부터 상관이 지배한다.`
    : '독립(ρ=0)이면 곡선이 −½ 직선을 끝까지 따른다.'}</div>
      <div style="opacity:.7;font-size:.85em">글의 표(§2-C)는 시행 4000, 여기는 ${TRIALS}
        이라 셋째 자리가 흔들린다. 표의 값은 테스트가 고정한다.</div>`;

    hint.textContent =
      'ρ=0 에서 왼쪽 행 평균(적 눈금)들이 참값 0 에 붙어 있습니다. ρ 를 올리면 행마다 '
      + '점 무리가 통째로 밀리고 — 그 행에서는 어느 센서도 그걸 모릅니다 — 평균이 같이 '
      + '밀립니다. 오른쪽 적 곡선이 녹 점선(바닥)에 붙는 것이 그 값입니다.';
  }

  const redraw = () => { rowsView.resize(); logView.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
