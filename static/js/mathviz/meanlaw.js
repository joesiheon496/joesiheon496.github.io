// static/js/mathviz/meanlaw.js
// 데모 1 — 평균의 오차는 σ/√N 로 준다. 분포 모양과 무관하게 — 코시만 빼고.
//
// 왼쪽은 러닝 평균 궤적 5개(시드 5개), 오른쪽은 log–log 의 |오차| 중앙값 대 N 이다.
// 오른쪽이 핵심이다 — 기울기 −½ 직선이 √N 법칙이고, 분포를 코시로 바꾸면
// 평균 곡선만 **수평**이 된다 (스펙 §2-E).
//
// 색 (규약 §4-1): 평균 추정이 청, 중앙값 추정이 녹, 이론 기준선이 muted 점선.
// 왼쪽 궤적은 청, 0 기준선은 fg.
//
// ⚠️ 코시의 러닝 평균은 캔버스를 뚫는다 — 시야를 클램프하고 그 사실을 readout 에
// 적는다 (스펙 §3-5). 잘라서 그리면 "슬쩍 정상으로 보이는" 것이 더 나쁘다.

import {
  themeColors, onThemeChange, createView, drawGrid, drawPath,
  makeSliders, makeToggles, makeRadios,
} from './core.js';
import {
  makeDist, meanOf, medianOf, runningMean, DIST_KINDS, DIST_LABELS,
} from './expectation.js';

const PATH_SEEDS = [1, 2, 3, 4, 5];
const N_GRID = [1, 3, 10, 30, 100, 300, 1000];
const TRIALS = 300;                    // 오른쪽 곡선의 시행 수 — 표(4000)보다 작다
const SPREAD_SEED = 45;                // 스펙 §2-E 와 같은 시드

const RUN_WORLD = { xmin: 0, xmax: 1000, ymin: -2.5, ymax: 2.5 };
const LOG_WORLD = { xmin: 0, xmax: 3, ymin: -2, ymax: 0.3 };   // log10 N, log10 |오차|

const RADIO = {
  key: 'dist', label: '분포', value: 'gauss',
  options: DIST_KINDS.map((k) => ({ value: k, label: DIST_LABELS[k] })),
};

export function init(root) {
  const canvases = root.querySelectorAll('canvas');
  if (canvases.length < 2) throw new Error('meanlaw 는 panes="2" 가 필요하다');
  const [runCanvas, logCanvas] = canvases;
  const runCtx = runCanvas.getContext('2d');
  const logCtx = logCanvas.getContext('2d');
  const runView = createView(runCanvas, RUN_WORLD);
  const logView = createView(logCanvas, LOG_WORLD);

  const readout = root.querySelector('.mv-readout');
  const hint = root.querySelector('.mv-hint');

  let vals = { N: 1000 };
  let toggles = { median: true };
  let kind = 'gauss';

  const sliderHost = root.querySelector('.mv-sliders');
  makeSliders(sliderHost, [
    { key: 'N', label: 'N (표본 수, 궤적)', min: 100, max: 5000, step: 100, value: 1000, fmt: (v) => v.toFixed(0) },
  ], (v) => { vals = v; draw(); });
  makeToggles(sliderHost, [
    { key: 'median', label: '중앙값 추정도 보기', value: true },
  ], (v) => { toggles = v; draw(); });
  makeRadios(sliderHost, RADIO, (v) => { kind = v.dist; draw(); });

  /** 시행 TRIALS 회 · 평균/중앙값 추정을 **같은 표본**에서 재고 |오차| 중앙값을 준다. */
  function spreadCurve() {
    const dist = makeDist(kind, SPREAD_SEED);
    const rows = [];
    for (const N of N_GRID) {
      const meanErr = new Array(TRIALS);
      const medErr = new Array(TRIALS);
      for (let t = 0; t < TRIALS; t++) {
        const xs = new Array(N);
        for (let i = 0; i < N; i++) xs[i] = dist.draw();
        meanErr[t] = Math.abs(meanOf(xs));
        medErr[t] = Math.abs(medianOf(xs));
      }
      rows.push({ N, mean: medianOf(meanErr), median: medianOf(medErr) });
    }
    return rows;
  }

  function draw() {
    const c = themeColors();
    const distProto = makeDist(kind, 0);
    const sigma = distProto.sigma;

    // ── 왼쪽: 러닝 평균 궤적 ──
    RUN_WORLD.xmax = vals.N;
    const clamp = (y) => Math.max(-2.4, Math.min(2.4, y));
    drawGrid(runCtx, runView, c);
    let pierced = false;
    for (const seed of PATH_SEEDS) {
      const rm = runningMean(makeDist(kind, seed), vals.N);
      const pts = rm.map((y, i) => {
        if (Math.abs(y) > 2.4) pierced = true;
        return [i + 1, clamp(y)];
      });
      runCtx.globalAlpha = 0.75;
      drawPath(runCtx, runView, pts, { color: c.accent, width: 1.4 });
      runCtx.globalAlpha = 1;
    }
    // 참값 0 의 수평선
    drawPath(runCtx, runView, [[0, 0], [vals.N, 0]], { color: c.fg, width: 1.5 });

    // ── 오른쪽: log–log 흩어짐 곡선 ──
    const rows = spreadCurve();
    drawGrid(logCtx, logView, c);
    const toLog = (r, key) => [Math.log10(r.N), Math.log10(Math.max(r[key], 1e-4))];

    // 이론 기준선 (muted 점선): σ 있으면 0.6745σ/√N, 코시면 중앙값 이론 0.6745π/(2√N)
    logCtx.setLineDash([5, 5]);
    const ref = (N) => (Number.isFinite(sigma)
      ? (0.6745 * sigma) / Math.sqrt(N)
      : (0.6745 * Math.PI) / (2 * Math.sqrt(N)));
    drawPath(logCtx, logView,
      N_GRID.map((N) => [Math.log10(N), Math.log10(ref(N))]),
      { color: c.muted, width: 1.5 });
    logCtx.setLineDash([]);

    drawPath(logCtx, logView, rows.map((r) => toLog(r, 'mean')), { color: c.accent, width: 2.5 });
    if (toggles.median) {
      drawPath(logCtx, logView, rows.map((r) => toLog(r, 'median')), { color: c.accent3, width: 2.5 });
    }
    for (const r of rows) {
      const [px, py] = logView.toPixel(toLog(r, 'mean'));
      logCtx.fillStyle = c.accent;
      logCtx.beginPath(); logCtx.arc(px, py, 3, 0, Math.PI * 2); logCtx.fill();
    }

    // ── readout ──
    const last = rows[rows.length - 1];
    const f4 = (x) => x.toFixed(4);
    const sigmaTxt = Number.isFinite(sigma)
      ? `σ = ${sigma.toFixed(4)} &nbsp;·&nbsp; 이론 0.6745σ/√N (N=1000) = <b>${f4(ref(1000))}</b>`
      : 'σ = <b>없음</b> (분산이 발산한다) &nbsp;·&nbsp; 점선은 중앙값 이론 0.6745π/(2√N)';
    readout.innerHTML = `
      <div>분포: <b>${DIST_LABELS[kind]}</b> &nbsp;·&nbsp; ${sigmaTxt}</div>
      <div>N=1000 의 |오차| 중앙값 — 평균 추정 <b style="color:${c.accent}">${f4(last.mean)}</b>${
  toggles.median ? ` &nbsp;·&nbsp; 중앙값 추정 <b style="color:${c.accent3}">${f4(last.median)}</b>` : ''}</div>
      <div>${Number.isFinite(sigma)
    ? '오른쪽 곡선이 점선(기울기 −½)과 나란하면 √N 법칙이다.'
    : '<b>평균(청) 곡선이 수평이다</b> — 코시 N 개의 평균은 다시 같은 코시라서, 재는 만큼 그대로다.'}</div>
      ${pierced ? `<div style="opacity:.8">⚠️ 왼쪽 궤적이 시야(±2.4)를 뚫어서 잘라 그렸다 —
        잘린 구간은 화면 밖에 있다.</div>` : ''}
      <div style="opacity:.7;font-size:.85em">글의 표는 시행 4000(§2-A)·2000(§2-E), 여기는
        ${TRIALS} 이라 셋째 자리가 흔들린다. 표의 값은 테스트가 고정한다.</div>`;

    hint.textContent =
      '분포를 균등 → 가우시안 → 지수로 바꿔도 오른쪽 곡선은 같은 기울기 −½ 입니다 — '
      + '√N 은 모양의 성질이 아닙니다. 코시로 바꾸면 평균(청)만 수평이 되고 '
      + '중앙값(녹)은 계속 내려갑니다. 왼쪽 궤적도 코시에서는 안 가라앉습니다.';
  }

  const redraw = () => { runView.resize(); logView.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
