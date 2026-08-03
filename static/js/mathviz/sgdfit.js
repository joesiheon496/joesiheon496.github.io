// static/js/mathviz/sgdfit.js
// 데모 2 — 직선맞춤의 네 번째 방문.
//
// 2편은 SVD 닫힌 해, 3편은 GD + 중심화, 4편은 축별 보폭. 여기서는 **미니배치**로 푼다.
// 논지는 둘이다.
//   (1) 실데이터의 Σ 는 A 에 **거의** 비례하지만 정확히는 아니고, 그 어긋남이 공의 비를
//       1(원)이 아니라 1.47 로 만든다. 예측식이 그 값을 맞춘다.
//   (2) 중심화는 κ 를 29.5 → 1.4 로 낮추지만 **공의 모양은 안 바꾼다.** 4편의
//       "중심화 = 대각화" 는 손실에 대한 이야기이고 노이즈에는 듣지 않는다. 스펙 §2-9
//
// ⚠️ 초기 배치를 치우치게 둔다. x 가 이미 중심이면 무관항이 0 이라 토글이 아무 일도
// 하지 않는다 (4편 스펙 §3-3 과 같은 함정).

import {
  themeColors, onThemeChange, createView, drawGrid, drawPath,
  drawHandles, makeSliders, makeToggles, attachDrag,
} from './core.js';
import { olsClosed, olsKappa, centerPoints } from './optimize.js';
import {
  olsHessian, olsNoiseCov, olsSgdPath, olsNoiseBall, residualSpread,
  ballFromPath, predictedBall, symEigVec2, FIT_POINTS, DEFAULT_SEEDS,
} from './stochastic.js';

const WORLD = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
// ⚠️ 슬라이더 최댓값과 캡션의 상한이 같은 수여야 한다 (3·4편과 같은 규약).
const MAX_STEPS = 24000;

/** 데모 1 과 같은 이유로 비만 따로 잰다. 스펙 §3-11 */
const STABLE_STEPS = 20000;
const STABLE_DEBOUNCE_MS = 200;

const SLIDERS = [
  { key: 'steps', label: '반복 (그림)', min: 0, max: MAX_STEPS, step: 500, value: 8000, fmt: (v) => v.toFixed(0) },
  {
    key: 'logEta', label: 'η (학습률)', min: -3.6, max: -2.0, step: 0.05, value: -2.7,
    fmt: (v) => Math.pow(10, v).toPrecision(3),
  },
  { key: 'batch', label: 'B (배치, 전체 6)', min: 1, max: 6, step: 1, value: 1, fmt: (v) => v.toFixed(0) },
];

const TOGGLES = [
  { key: 'center', label: 'x 중심화', value: false },
  { key: 'cloud', label: '방문점', value: true },
];

const lineOf = ([a, b]) => [[-3, a * -3 + b], [3, a * 3 + b]];
const drawable = ([x, y]) => Number.isFinite(x) && Number.isFinite(y)
  && Math.abs(x) < 1e4 && Math.abs(y) < 1e4;

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = createView(canvas, WORLD);
  const pts = FIT_POINTS.map(([x, y]) => [x, y]);
  let vals = { steps: 8000, logEta: -2.7, batch: 1 };
  let toggles = { center: false, cloud: true };
  let shownStable = null;
  let pendingStable = 0;
  // 점 드래그까지 캐시 키에 들어가야 하므로 좌표를 문자열로 접는다.
  const stableKey = () => `${pts.map((p) => p.map((v) => v.toFixed(3)).join(',')).join(';')}`
    + `|${vals.logEta.toFixed(2)}|${vals.batch}|${toggles.center}`;
  const stableCache = new Map();

  function computeStable() {
    const key = stableKey();
    const hit = stableCache.get(key);
    if (hit) return hit;
    const P = toggles.center ? centerPoints(pts).points : pts;
    const eta = Math.pow(10, vals.logEta);
    const rs = DEFAULT_SEEDS
      .map((seed) => olsNoiseBall({ points: P, eta, B: vals.batch, steps: STABLE_STEPS, seed }))
      .filter(Boolean);
    const r = rs.length === 0
      ? { ratio: NaN, rms: NaN, seeds: 0 }
      : {
        ratio: rs.reduce((t, x) => t + x.ratio, 0) / rs.length,
        rms: rs.reduce((t, x) => t + x.rms, 0) / rs.length,
        seeds: rs.length,
      };
    stableCache.set(key, r);
    return r;
  }

  function scheduleStable() {
    clearTimeout(pendingStable);
    pendingStable = setTimeout(() => { pendingStable = 0; computeStable(); draw(); }, STABLE_DEBOUNCE_MS);
  }

  const sliderHost = root.querySelector('.mv-sliders');
  makeSliders(sliderHost, SLIDERS, (v) => { vals = v; draw(); });
  // ⚠️ makeSliders 가 host 를 비우므로 반드시 그 뒤에 부른다.
  makeToggles(sliderHost, TOGGLES, (v) => { toggles = v; draw(); });

  attachDrag(canvas, view, () => pts, (i, p) => { pts[i] = p; draw(); });

  function draw() {
    const colors = themeColors();
    drawGrid(ctx, view, colors);

    const eta = Math.pow(10, vals.logEta);
    const closed = olsClosed(pts);
    const path = olsSgdPath({
      points: pts, steps: vals.steps, eta, B: vals.batch, seed: 1, center: toggles.center,
    });
    const now = path[path.length - 1];

    // 공은 **닫힌 해 주변**에서 잰다. 그리고 A 도 실제로 푼 좌표계의 것을 써야 한다 —
    // 중심화를 켜면 SGD 는 중심화 좌표에서 굴러가므로, 원 좌표의 A 로 고유축을 잡으면
    // 축이 어긋나 비가 엉뚱하게 나온다.
    const solvePts = toggles.center ? centerPoints(pts).points : pts;
    const Asolve = olsHessian(solvePts);
    const Ssolve = olsNoiseCov(solvePts);
    const closedSolve = olsClosed(solvePts);
    const pathSolve = toggles.center
      ? olsSgdPath({ points: solvePts, steps: vals.steps, eta, B: vals.batch, seed: 1 })
      : path;
    const ball = ballFromPath(Asolve, pathSolve, { burnFrac: 0.5, target: closedSolve });
    const pred = predictedBall({
      A: Asolve, Sigma: Ssolve.map((r) => r.map((x) => x / vals.batch)), eta,
    });

    // y 방향 잔차 — 3·4편과 같다.
    for (const [x, y] of pts) {
      drawPath(ctx, view, [[x, y], [x, now[0] * x + now[1]]], { color: colors.muted, width: 1 });
    }

    // 방문점 — 후반 절반의 (a, b) 를 직선으로 그리면 화면이 검어진다. 대신 각 방문점의
    // 직선을 아주 흐리게 겹쳐 그려 "공" 이 직선의 흔들림으로 보이게 한다.
    if (toggles.cloud) {
      ctx.globalAlpha = 0.06;
      const from = Math.floor(path.length * 0.5);
      const stride = Math.max(1, Math.floor((path.length - from) / 250));
      for (let i = from; i < path.length; i += stride) {
        if (!drawable(path[i])) continue;
        drawPath(ctx, view, lineOf(path[i]), { color: colors.accent2, width: 1 });
      }
      ctx.globalAlpha = 1;
    }

    // 회색 선 = 닫힌 해. 중심화 토글과 무관하게 **불변**이다 (3편 §3-4).
    drawPath(ctx, view, lineOf(closed), { color: colors.muted, width: 3 });
    if (drawable(now)) drawPath(ctx, view, lineOf(now), { color: colors.accent, width: 2 });
    drawHandles(ctx, view, pts, colors);

    // ── readout ──
    const Araw = olsHessian(pts);
    const Sraw = olsNoiseCov(pts);
    const { s1, s2, kappa: rawK } = olsKappa(pts);
    const cenK = olsKappa(centerPoints(pts).points).kappa;
    const rs = residualSpread(pts);
    const fmtK = (k) => (Number.isFinite(k) ? k.toFixed(1) : '∞');
    const f3 = (x) => (Number.isFinite(x) ? x.toPrecision(3) : '—');
    const f4 = (x) => (Number.isFinite(x) ? x.toFixed(4) : '—');
    const dist = Math.hypot(now[0] - closed[0], now[1] - closed[1]);

    // Σ/A 성분비 세 개. 셋이 같으면 Σ ∝ A 이고 공이 원이다.
    const sr = [
      Sraw[0][0] / Araw[0][0], Sraw[0][1] / Araw[0][1], Sraw[1][1] / Araw[1][1],
    ].filter(Number.isFinite);
    const srSpread = sr.length === 3 ? Math.max(...sr) / Math.min(...sr) : NaN;

    // 안정된 비 (데모 1 과 같은 규약). 캐시 miss 면 디바운스로 채우고 직전 완성분을 쓴다.
    const freshStable = stableCache.get(stableKey());
    if (freshStable) shownStable = freshStable;
    else scheduleStable();
    const stable = shownStable;

    const { l2 } = symEigVec2(Asolve);
    const tauFlat = 1 / (eta * l2);
    const indep = ball ? ball.samples / (2 * tauFlat) : 0;

    root.querySelector('.mv-matrix-host').innerHTML = '';
    root.querySelector('.mv-readout').innerHTML = `
      <div>XᵀX 무관항 2Σx = <b>${Araw[0][1].toFixed(2)}</b>${toggles.center ? ' → 중심화하면 0' : ''}</div>
      <div>σ₁ = ${s1.toPrecision(4)}, σ₂ = ${s2.toPrecision(4)}
        &nbsp;·&nbsp; κ = (σ₁/σ₂)² = <b>${fmtK(rawK)}</b></div>
      <div>중심화하면 κ = ${fmtK(cenK)}
        ${Number.isFinite(rawK / cenK) ? `(<b>${(rawK / cenK).toFixed(1)}배</b>)` : ''}</div>
      <div>η = ${f3(eta)}, B = ${vals.batch} &nbsp;·&nbsp; <b>η/B = ${f3(eta / vals.batch)}</b></div>
      <div>잔차² 최대/최소 = <b>${Number.isFinite(rs.ratio) ? rs.ratio.toFixed(1) : '∞'}</b>
        &nbsp;(1 이면 등분산 → Σ ∝ A → 공이 원)</div>
      <div>Σ/A 성분비 = ${sr.map((v) => v.toPrecision(3)).join(', ')}
        &nbsp;·&nbsp; 최대/최소 <b>${Number.isFinite(srSpread) ? srSpread.toFixed(3) : '—'}</b></div>
      <div>공: RMS <b>${f4(stable ? stable.rms : NaN)}</b>
        &nbsp;·&nbsp; 예측 <b>${f4(pred ? pred.rms : NaN)}</b></div>
      <div>공의 모양 <b>비 = ${f3(stable ? stable.ratio : NaN)}</b>
        &nbsp;·&nbsp; 예측비 <b>${f3(pred ? pred.ratio : NaN)}</b></div>
      <div style="opacity:.75;font-size:.9em">위 두 줄은 시드 ${stable ? stable.seeds : 0}개
        · ${STABLE_STEPS} 스텝 평균이다${freshStable ? '' : ' <b>(갱신 중)</b>'}</div>
      <div style="opacity:.8">그린 궤적 하나만으로는 RMS ${f4(ball ? ball.rms : NaN)}
        &nbsp;· 비 ${f3(ball ? ball.ratio : NaN)}
        &nbsp;— 평평축 상관시간 ${tauFlat.toFixed(0)} 스텝, 독립표본 약 ${indep.toFixed(0)} 개</div>
      <div>${vals.steps} 회 · 닫힌 해와의 거리 ${dist.toExponential(2)}</div>
      <div style="opacity:.7;font-size:.85em">
        상한 ${MAX_STEPS} 회. 거리는 중심화 여부와 무관하게 원 좌표에서 잰다.
        회색 선(닫힌 해)은 토글에 움직이지 않는다.
        RMS 와 비 <b>둘 다</b> 시드 ${DEFAULT_SEEDS.length}개로 따로 재는 이유는 상관시간 때문이다
        — 그린 궤적 후반 절반(${ball ? ball.samples : 0} 표본)에 독립표본이
        ${indep.toFixed(0)} 개밖에 없다. 모두 실제로 푼 좌표계로 잰다.
      </div>`;

    root.querySelector('.mv-hint').textContent =
      'x 중심화 를 켜보세요. κ 는 크게 떨어지는데 공의 비는 거의 그대로입니다 — '
      + '좌표를 고쳐도 노이즈의 출처는 안 고쳐집니다. '
      + 'η 를 4배 올리고 B 도 4배 올리면 공의 크기가 제자리로 돌아옵니다(η/B).';
  }

  // 첫 렌더만 동기로 — 데모가 채워진 readout 으로 열려야 한다.
  computeStable();

  // ⚠️ view.resize() 를 먼저 부르지 않으면 캔버스가 1×1 로 남아 아무것도 그려지지 않는다.
  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
