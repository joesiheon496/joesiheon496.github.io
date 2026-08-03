// static/js/mathviz/noiseball.js
// 데모 1 — 노이즈 공.
//
// f(w) = ½wᵀAw 를 미니배치 SGD 로 굴린다. **노이즈의 출처를 손으로 고르는 것**이 이
// 데모의 존재 이유다. 실데이터에서는 Σ 를 고를 수 없으므로 "공의 모양은 노이즈가 정한다"
// 는 문장은 여기서만 분리 관측된다. 스펙 §두 데모의 역할 분담
//
// ⚠️ readout 의 통계는 **화면에 그린 그 궤적**에서 뽑는다(ballFromPath). noiseBall 을
// 따로 부르면 산포와 숫자가 다른 난수열에서 나와, 독자가 눈으로 비를 확인할 수 없다.

import {
  themeColors, onThemeChange, createView, drawGrid, drawPolygon,
  drawPath, drawHandles, makeSliders, makeToggles, makeRadios, attachDrag,
} from './core.js';
import {
  rotatedHessian, symEigVec2, makeComponents, componentCovariance,
  sgdPath, ballFromPath, predictedBall, noiseBall, NOISE_KINDS, NOISE_LABELS,
  DEFAULT_SEEDS,
} from './stochastic.js';

// ⚠️ 확대 토글이 이 객체의 **필드를 바꾼다.** createView 가 world 를 살아있는 참조로
// 읽으므로(core.js 의 sx()/toPixel 이 매번 world.xmax 를 본다) core.js 를 고치지 않고
// 시야를 바꿀 수 있다. 새 view 를 만들면 attachDrag 가 옛 view 를 붙들고 있어 어긋난다.
const WORLD = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
const HOME = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };

const N_COMPONENTS = 200;   // 성분 개수. 짝수여야 한다 (makeComponents 가 ±쌍으로 만든다)
const SEED = 1;

/**
 * 안정된 비를 재는 설정. 스펙 §3-11.
 *
 * ⚠️ 모양 비는 **한 궤적으로는 못 잰다.** SGD 궤적은 자기상관이 심해서 평평축의
 * 상관시간이 1/(η·λ_min) 스텝이다 — κ=30, η=0.005 에서 200 스텝당 독립표본 하나다.
 * 시드 1 · 8000 스텝의 iso 비가 실측에서 0.152 \~ 0.260 사이를 오갔다(점근값 0.183).
 * RMS 는 빨리 수렴하지만 비는 아니다. 그래서 비만 시드 5개 · 2만 스텝으로 따로 잰다.
 */
const STABLE_STEPS = 20000;
/** 비싼 계산을 미루는 시간. 4편 tilted.js 와 같은 규약이다. */
const STABLE_DEBOUNCE_MS = 200;

// η 는 로그 슬라이더다. 값은 log₁₀η 이고 fmt 가 실제 η 를 보여준다.
// 상단 0.2 는 κ=10 의 발산 문턱과 정확히 같다 — 문턱을 화면에서 만날 수 있어야 한다.
// 기본값 −2.3(η≈0.005)은 점근 영역이다. −1.7(0.02)로 두면 κ=30 에서 η/문턱이 0.3 이라
// 비가 점근값보다 눈에 띄게 부풀어(hess2 에서 5.48 대신 6.5) 표와 화면이 어긋난다.
const SLIDERS = [
  { key: 'kappa', label: 'κ (조건수)', min: 1, max: 100, step: 1, value: 30, fmt: (v) => v.toFixed(0) },
  { key: 'theta', label: 'θ (기울기)', min: 0, max: 45, step: 1, value: 0, fmt: (v) => `${v.toFixed(0)}°` },
  {
    key: 'logEta', label: 'η (학습률)', min: -2.7, max: -0.7, step: 0.05, value: -2.3,
    fmt: (v) => Math.pow(10, v).toPrecision(3),
  },
  { key: 'batch', label: 'B (배치)', min: 1, max: 16, step: 1, value: 1, fmt: (v) => v.toFixed(0) },
  { key: 'steps', label: '반복 (그림)', min: 500, max: 24000, step: 500, value: 8000, fmt: (v) => v.toFixed(0) },
];

const TOGGLES = [
  { key: 'contour', label: '등고선', value: true },
  { key: 'cloud', label: '방문점', value: true },
  { key: 'zoom', label: '공에 확대', value: false },
];

const RADIO = {
  key: 'noise', label: '노이즈 출처', value: 'hess',
  options: NOISE_KINDS.map((k) => ({ value: k, label: NOISE_LABELS[k] })),
};

/** 그리기용 안전 범위. 발산한 좌표를 그대로 넘기면 캔버스가 무의미한 값으로 오염된다. */
const drawable = ([x, y]) => Number.isFinite(x) && Number.isFinite(y)
  && Math.abs(x) < 1e4 && Math.abs(y) < 1e4;

/**
 * 시드 5개 · STABLE_STEPS 스텝의 평균 비. 비싸므로 (κ,θ,η,B,noise) 로 캐시한다.
 * 캐시 miss 에서는 절대 계산하지 않는다 — 호출자가 디바운스로만 채운다.
 */
const stableCache = new Map();
const stableKey = (v, noise) => `${v.kappa}|${v.theta}|${v.logEta.toFixed(2)}|${v.batch}|${noise}`;

function computeStable(v, noise) {
  const key = stableKey(v, noise);
  const hit = stableCache.get(key);
  if (hit) return hit;
  const A = rotatedHessian(v.kappa, (v.theta * Math.PI) / 180);
  const comps = makeComponents({ A, n: N_COMPONENTS, s: 1, noise, seed: 99 });
  const eta = Math.pow(10, v.logEta);
  const rs = DEFAULT_SEEDS
    .map((seed) => noiseBall({
      A, comps, eta, B: v.batch, steps: STABLE_STEPS, seed, start: [0, 0],
    }))
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

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = createView(canvas, WORLD);
  let start = [2.5, 0.7];
  let vals = {
    kappa: 30, theta: 0, logEta: -2.3, batch: 1, steps: 8000,
  };
  let toggles = { contour: true, cloud: true, zoom: false };
  let noise = 'hess';
  let shownStable = null;
  let pendingStable = 0;

  /** 안정된 비를 디바운스로 계산한 뒤 다시 그린다. 앞선 예약은 취소한다. */
  function scheduleStable() {
    clearTimeout(pendingStable);
    pendingStable = setTimeout(() => {
      pendingStable = 0;
      computeStable(vals, noise);
      draw();
    }, STABLE_DEBOUNCE_MS);
  }

  const sliderHost = root.querySelector('.mv-sliders');
  makeSliders(sliderHost, SLIDERS, (v) => { vals = v; draw(); });
  // ⚠️ makeSliders 가 host 를 비우므로 아래 둘은 반드시 그 뒤에 부른다.
  makeToggles(sliderHost, TOGGLES, (v) => { toggles = v; draw(); });
  makeRadios(sliderHost, RADIO, (v) => { noise = v.noise; draw(); });

  attachDrag(canvas, view, () => [start], (i, p) => { start = p; draw(); });

  /** 등위선 xᵀAx = 2c. 4편 tilted.js 와 같은 방식 — 축정렬 타원을 θ 만큼 돌린다. */
  function contourPoints(c, theta) {
    const a = Math.sqrt(2 * c);
    const b = a / Math.sqrt(vals.kappa);
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const out = [];
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      const x = a * Math.cos(t);
      const y = b * Math.sin(t);
      out.push([x * ct - y * st, x * st + y * ct]);
    }
    return out;
  }

  function draw() {
    const colors = themeColors();
    const theta = (vals.theta * Math.PI) / 180;
    const eta = Math.pow(10, vals.logEta);
    const A = rotatedHessian(vals.kappa, theta);
    const { l1, l2, v1, v2 } = symEigVec2(A);
    const comps = makeComponents({
      A, n: N_COMPONENTS, s: 1, noise, seed: 99,
    });
    const Sigma = componentCovariance(comps);

    const { path } = sgdPath({
      A, comps, start, steps: vals.steps, eta, B: vals.batch, seed: SEED,
    });
    const ball = ballFromPath(A, path, { burnFrac: 0.5 });
    const pred = predictedBall({ A, Sigma: Sigma.map((r) => r.map((x) => x / vals.batch)), eta });

    // 시야. 확대는 예측 RMS 에 맞춘다 — 실측에 맞추면 발산 중에 시야가 따라 커져서
    // "터지고 있다" 는 사실이 화면에서 사라진다.
    const span = toggles.zoom && pred && Number.isFinite(pred.rms)
      ? Math.max(pred.rms * 3.5, 1e-4)
      : null;
    if (span) {
      WORLD.xmin = -span; WORLD.xmax = span;
      WORLD.ymin = -span; WORLD.ymax = span;
    } else {
      Object.assign(WORLD, HOME);
    }

    drawGrid(ctx, view, colors);

    if (toggles.contour) {
      // 확대했을 때 ±3 스케일의 등고선을 그리면 캔버스를 덮어버린다. 시야에 맞춰 고른다.
      const unit = span ? span * span : 1;
      for (const m of [0.04, 0.15, 0.35, 0.65, 1.0]) {
        drawPolygon(ctx, view, contourPoints(m * unit, theta), { stroke: colors.muted, width: 1 });
      }
    }

    // 고유축 두 개. 공이 "평평한 축으로 길다" 를 눈으로 읽으려면 축이 보여야 한다.
    const R = (WORLD.xmax - WORLD.xmin);
    for (const v of [v1, v2]) {
      drawPath(ctx, view, [[-v[0] * R, -v[1] * R], [v[0] * R, v[1] * R]],
        { color: colors.grid, width: 1 });
    }

    // 방문점 — 전이구간을 지난 후반 절반만. 이것이 "공" 이다.
    if (toggles.cloud && ball) {
      const from = Math.floor(path.length * 0.5);
      ctx.fillStyle = colors.accent2;
      ctx.globalAlpha = 0.35;
      for (let i = from; i < path.length; i++) {
        if (!drawable(path[i])) continue;
        const [px, py] = view.toPixel(path[i]);
        ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 궤적. 전이구간이 보여야 "공으로 들어간다" 가 읽힌다.
    drawPath(ctx, view, path.filter(drawable), { color: colors.accent, width: 1.2 });

    // 최소점 십자 (4편과 같은 규약 — drawHandles 로 그리지 않는다)
    const [ox, oy] = view.toPixel([0, 0]);
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ox - 6, oy); ctx.lineTo(ox + 6, oy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox, oy - 6); ctx.lineTo(ox, oy + 6); ctx.stroke();

    if (!span) drawHandles(ctx, view, [start], colors);

    // ── readout ──
    const thr = 2 / l1;                 // 3편의 발산 문턱 2/λmax
    const ratioToThr = eta / thr;
    // 3편은 "정확히 문턱이면 영원히 진동" 이라고 했다. 노이즈가 있으면 그게 아니라
    // 분산이 매 스텝 쌓여 RMS ∝ √k 로 자란다. 스펙 §2-8b
    const verdict = ratioToThr > 1.005
      ? '<span class="no">발산 (지수)</span>'
      : ratioToThr > 0.995
        ? '<span class="no">문턱 — 정상상태가 아니다. RMS 가 √k 로 자란다</span>'
        : '<span class="ok">공 (정상상태)</span>';

    const f3 = (x) => (Number.isFinite(x) ? x.toPrecision(3) : '—');
    const f4 = (x) => (Number.isFinite(x) ? x.toFixed(4) : '—');
    const refIso = 1 / Math.sqrt(vals.kappa);
    const refHess2 = Math.sqrt(vals.kappa);

    // 안정된 비. 캐시에 있으면 쓰고, 없으면 디바운스로 채우며 직전 완성분을 보여준다.
    const freshStable = stableCache.get(stableKey(vals, noise));
    if (freshStable) shownStable = freshStable;
    else scheduleStable();
    const stable = shownStable;

    // 평평축의 상관시간. 비가 왜 흔들리는지를 숫자로 보여준다 (스펙 §3-11).
    const tauFlat = 1 / (eta * l2);
    const indep = ball ? ball.samples / (2 * tauFlat) : 0;

    root.querySelector('.mv-matrix-host').innerHTML = '';
    root.querySelector('.mv-readout').innerHTML = `
      <div>κ = ${vals.kappa}, θ = ${vals.theta}°, η = ${f3(eta)}, B = ${vals.batch}
        &nbsp;·&nbsp; <b>η/B = ${f3(eta / vals.batch)}</b></div>
      <div>발산 문턱 2/λ<sub>max</sub> = ${f3(thr)} &nbsp;·&nbsp; η/문턱 = ${ratioToThr.toFixed(3)}
        &nbsp;→&nbsp; ${verdict}</div>
      <div>RMS‖w‖ <b>${f4(stable ? stable.rms : NaN)}</b>
        &nbsp;·&nbsp; 예측 <b>${f4(pred ? pred.rms : NaN)}</b></div>
      <div>공의 모양 <b>비 = ${f3(stable ? stable.ratio : NaN)}</b>
        &nbsp;·&nbsp; 예측비 <b>${f3(pred ? pred.ratio : NaN)}</b></div>
      <div style="opacity:.75;font-size:.9em">위 두 줄은 시드 ${stable ? stable.seeds : 0}개
        · ${STABLE_STEPS} 스텝 평균이다${freshStable ? '' : ' <b>(갱신 중)</b>'}</div>
      <div style="opacity:.8">그린 궤적 하나만으로는 RMS ${f4(ball ? ball.rms : NaN)}
        &nbsp;· 비 ${f3(ball ? ball.ratio : NaN)}
        (급한축 σ ${f4(ball ? ball.stdSteep : NaN)} / 평평축 σ ${f4(ball ? ball.stdFlat : NaN)})
        &nbsp;— 독립표본 약 ${indep.toFixed(0)} 개뿐이라 흔들린다</div>
      <table class="mv-table"><thead>
        <tr><th>노이즈 출처</th><th style="text-align:right">이 κ 에서의 점근 비</th></tr>
      </thead><tbody>
        <tr><td>등방 Σ∝I</td><td style="text-align:right">1/√κ = ${refIso.toFixed(3)}</td></tr>
        <tr><td>손실형 Σ∝A</td><td style="text-align:right">1 (원)</td></tr>
        <tr><td>급한축 편중 Σ∝A²</td><td style="text-align:right">√κ = ${refHess2.toFixed(3)}</td></tr>
      </tbody></table>
      <div style="opacity:.7;font-size:.85em">
        RMS 와 비 <b>둘 다</b> 시드 ${DEFAULT_SEEDS.length}개로 따로 재는 이유는 평평축의 상관시간이
        1/(η·λ<sub>min</sub>) = <b>${tauFlat.toFixed(0)} 스텝</b>이라, 그린 궤적의 후반 절반
        (${ball ? ball.samples : 0} 표본)에 독립표본이 ${indep.toFixed(0)} 개밖에 없기 때문이다.
        <b>반복 (그림)</b> 슬라이더는 그려지는 궤적만 바꾸고 위 숫자는 바꾸지 않는다.
        손실 등고선의 반축비는 언제나 1/√κ = ${refIso.toFixed(3)} 인데,
        공의 비는 노이즈 출처를 바꾸면 위 표의 세 값으로 옮겨간다.
      </div>`;

    root.querySelector('.mv-hint').textContent =
      '노이즈 출처 세 개를 차례로 눌러보세요. κ 와 등고선은 그대로인데 공의 비만 '
      + `${refIso.toFixed(2)} → 1 → ${refHess2.toFixed(2)} 로 옮겨갑니다. `
      + '공에 확대 를 켜면 모양이 보이고, θ 를 돌려도 비는 안 바뀝니다.';
  }

  // 첫 렌더만 동기로 계산한다 — 데모가 채워진 readout 으로 열려야 한다 (4편과 같은 규약).
  computeStable(vals, noise);

  // ⚠️ view.resize() 를 먼저 부르지 않으면 캔버스가 1×1 로 남아 아무것도 그려지지 않는다.
  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
