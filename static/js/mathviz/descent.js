// static/js/mathviz/descent.js
// 데모 1 — 등고선 위의 경사하강법.
//
// 손실은 f(x, y) = ½(x² + κy²). Hessian 이 diag(1, κ) 라 조건수가 정확히 κ 이고
// 슬라이더 값이 곧 κ 다.
//
// 학습률은 절대값이 아니라 **발산 문턱에 대한 비율** r 로 준다. 문턱 2/κ 는 κ 에 따라
// 2.0 에서 0.033 까지 60배 움직여서 절대 슬라이더 하나로는 두 끝을 담을 수 없다.
// 비율로 주면 문턱이 항상 r = 1 에 오고, 정확히 1 로 맞춰 "영원히 진동" 을 볼 수 있다.
// ⚠️ 모멘텀을 켜면 그 한계가 r = 1 이 아니라 r = 1+β 로 올라간다. draw() 의 rLimit 참고.

import {
  gdPath, optimalEta, divergenceEta, contractionRate,
  momentumRate, optimalBeta, optimalMomentumEta,
  stepsToTarget, firstIndexBelow, isFinitePoint,
} from './optimize.js';
import {
  themeColors, onThemeChange, createView, drawGrid, drawPolygon,
  drawPath, drawHandles, makeSliders, makeToggles, attachDrag,
} from './core.js';

const WORLD = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
const OUTER_X = 2.6;        // 가장 바깥 등고선의 x 반축 — 어떤 κ 에서도 화면에 들어온다
const LEVEL_Q = 0.72;       // 등고선 간 반축 비
const LEVELS = 5;
const MAX_STEPS = 300;      // 스펙 §3-3: κ 가 크면 안 끝나는 게 정상이다

// 단위원 64각형. 축마다 반축을 곱하면 등고선이 된다.
const UNIT = Array.from({ length: 64 }, (_, i) => {
  const a = (i / 64) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
});

const SLIDERS = [
  { key: 'kappa', label: 'κ', min: 1, max: 60, step: 0.5, value: 12,
    fmt: (v) => v.toFixed(1) },
  { key: 'ratio', label: 'η/문턱', min: 0.05, max: 1.3, step: 0.01, value: 0.9,
    fmt: (v) => v.toFixed(2) },
  { key: 'steps', label: '반복', min: 0, max: MAX_STEPS, step: 1, value: 60,
    fmt: (v) => String(Math.round(v)) },
  // β 기본값 0.6: κ∈[1,60] 전 구간에서 생 GD 이하 반복수를 준다(실측). 0.9 는 이 κ 범위에
  // 대해 너무 커서 모멘텀이 오히려 느려진다 — κ=12 에서 42회 → 114회.
  { key: 'beta', label: 'β', min: 0, max: 0.95, step: 0.01, value: 0.6,
    fmt: (v) => v.toFixed(2) },
];

const TOGGLES = [{ key: 'momentum', label: '모멘텀', value: false }];

/** 그 κ 에서 화면에 맞는 기본 시작점. 바깥 등고선 위의 60° 지점. */
const defaultStart = (kappa) => [
  OUTER_X * Math.cos(Math.PI / 3),
  (OUTER_X / Math.sqrt(kappa)) * Math.sin(Math.PI / 3),
];

/** 반축 a 인 등고선(64각형). f = ½a² 인 등위선이다. */
const contour = (a, kappa) =>
  UNIT.map(([c, s]) => [a * c, (a / Math.sqrt(kappa)) * s]);

/**
 * 궤적에서 실측한 **직전 한 스텝의** 비. 마지막 유의미한 두 스텝의 노름 비다.
 *
 * ⚠️ 한 스텝의 비이므로 모멘텀에서는 1 을 넘을 수 있다 — 근이 복소수면 비가 스텝마다
 * 진동하고, 수렴하는 궤적에서도 어떤 한 스텝은 늘어난다(κ=12, β=0.95 에서 3.2 까지).
 * readout 라벨을 '수축률' 이라고 쓰면 안 되는 이유다.
 */
function measuredRate(path) {
  const n = (p) => Math.hypot(p[0], p[1]);
  for (let i = path.length - 1; i >= 1; i--) {
    if (!isFinitePoint(path[i]) || !isFinitePoint(path[i - 1])) continue;
    const cur = n(path[i]), prev = n(path[i - 1]);
    if (prev > 1e-12 && cur > 1e-14) return cur / prev;
  }
  return null;
}

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = createView(canvas, WORLD);

  // steps 기본값 60: κ=12 에서 stepsToTarget = 42 다. 40 으로 두면 최적 학습률에서도
  // 목표에 못 닿아 첫 화면이 '미도달' 로 뜬다.
  const state = { kappa: 12, ratio: 0.9, steps: 60, beta: 0.6, momentum: false };
  let start = defaultStart(state.kappa);

  const sliderHost = root.querySelector('.mv-sliders');
  makeSliders(sliderHost, SLIDERS, (v) => {
    if (v.kappa !== state.kappa) {
      // κ 가 바뀌면 시작점의 y 를 같은 등고선 위에 남긴다. 그러지 않으면
      // κ 를 키울 때 시작점이 등고선 바깥으로 튀어 화면을 벗어난다.
      start = [start[0], start[1] * Math.sqrt(state.kappa / v.kappa)];
    }
    Object.assign(state, v);
    draw();
  });
  // ⚠️ makeSliders 가 host 를 비우므로 반드시 그 뒤에 부른다.
  makeToggles(sliderHost, TOGGLES, (v) => {
    Object.assign(state, v);
    draw();
  });

  attachDrag(canvas, view, () => [start], (_, p) => {
    start = p;
    draw();
  });

  function draw() {
    const colors = themeColors();
    const { kappa, ratio } = state;
    const steps = Math.round(state.steps);
    const threshold = divergenceEta(kappa);
    const eta = ratio * threshold;
    const beta = state.momentum ? state.beta : 0;
    // heavy ball 의 안정 조건은 η < 2(1+β)/λ_max, 즉 비율로 쓰면 r < 1+β 다.
    // r = 1+β 에서는 y 축 특성다항식이 z² + (1+β)z + β = (z+1)(z+β) 로 인수분해되어
    // 근이 −1 과 −β 다 — 크기가 정확히 1 인 근이 있으니 생 GD 와 같은 '영원히 진동' 이다.
    // β = 0 이면 1 이 되어 생 GD 의 판정(문턱 2/κ)과 정확히 같다.
    const rLimit = 1 + beta;

    drawGrid(ctx, view, colors);

    // 등고선 — 바깥에서 안으로 등비로 좁힌다
    for (let j = 0; j < LEVELS; j++) {
      drawPolygon(ctx, view, contour(OUTER_X * LEVEL_Q ** j, kappa),
        { stroke: colors.grid, width: 1.2 });
    }

    // 최소점
    const [ox, oy] = view.toPixel([0, 0]);
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ox - 6, oy); ctx.lineTo(ox + 6, oy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox, oy - 6); ctx.lineTo(ox, oy + 6); ctx.stroke();

    const path = gdPath({ kappa, eta, beta, start, steps });
    const finite = path.filter(isFinitePoint);
    const diverged = finite.length < path.length
      || finite.some((p) => Math.abs(p[0]) > 1e6 || Math.abs(p[1]) > 1e6);

    drawPath(ctx, view, finite, { color: colors.accent, width: 2 });
    ctx.fillStyle = colors.accent;
    for (const p of finite) {
      const [px, py] = view.toPixel(p);
      ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill();
    }

    drawHandles(ctx, view, [start], colors);
    root.querySelector('.mv-matrix-host').innerHTML = '';

    // ---- readout
    // 최적 η 에 해당하는 비율. optimize.js 의 두 값을 합성한다 — 여기서 κ/(1+κ) 로 다시
    // 유도하면 최적화 수식이 표현 계층으로 새어나온다.
    const optRatio = optimalEta(kappa) / threshold;
    const rate = contractionRate(kappa);
    const predSteps = stepsToTarget(kappa);
    const measured = measuredRate(path);
    const reached = firstIndexBelow(path, 1e-3);

    // 모멘텀이 켜지면 한계가 문턱이 아니라 (1+β)·문턱 이므로 부르는 이름도 바꾼다.
    const limit = beta > 0
      ? { over: '발산 한계를', at: '발산 한계다' }
      : { over: '문턱을', at: '문턱이다' };

    let verdict;
    if (ratio > rLimit) {
      verdict = `<span class="no">발산 — 학습률이 ${limit.over} 넘었다</span>`;
    } else if (Math.abs(ratio - rLimit) < 1e-9) {
      verdict = `<span class="no">영원히 진동 — 정확히 ${limit.at} (발산은 아니다)</span>`;
    } else if (reached === null) {
      verdict = `<span class="no">미도달</span> — ${steps}회로는 목표에 못 간다`;
    } else {
      verdict = `<span class="ok">${reached}회에 도달</span>`;
    }

    const kappaOne = kappa <= 1 + 1e-9;
    root.querySelector('.mv-readout').innerHTML = `
      κ = <b>${kappa.toFixed(1)}</b>
      &nbsp; η = <b>${eta.toFixed(4)}</b>
      &nbsp; 문턱 = ${threshold.toFixed(4)}${beta > 0
        ? ` → 모멘텀 발산 한계 ${(rLimit * threshold).toFixed(4)}`
          + ` (η/문턱 = 1+β = ${rLimit.toFixed(2)})`
        : ''}
      &nbsp; 최적 = ${optimalEta(kappa).toFixed(4)} (비율 ${optRatio.toFixed(2)})<br>
      <b>최적 η 기준</b> 수축률 ${kappaOne ? '—' : rate.toFixed(4)}
      · 예상 ${kappaOne ? '한 번에 도달' : `${predSteps}회`}<br>
      직전 스텝의 실측 비 <b>${
        diverged ? '발산' : measured === null ? '—' : measured.toFixed(4)}</b><br>
      ${verdict}
      ${state.momentum && !kappaOne
        ? `<br>모멘텀 이론 수축률 <b>${momentumRate(kappa).toFixed(4)}</b>`
          + ` (생 GD ${rate.toFixed(4)}) · 최적 β = ${optimalBeta(kappa).toFixed(2)}`
          + ` · 짝 η/문턱 = ${(optimalMomentumEta(kappa) / threshold).toFixed(2)}`
        : ''}`;

    root.querySelector('.mv-hint').textContent = state.momentum
      ? 'readout 의 최적 β 와 짝 η/문턱 을 함께 맞춰보세요. 이론 수축률은 그 (β, η) 짝에서만 '
      + '나옵니다 — β 만 올리면 오히려 느려집니다. 짝을 맞추면 지그재그가 사라지는 게 아니라 '
      + '같은 지그재그가 훨씬 빨리 좁아지고, κ 의존성이 κ 에서 √κ 로 줄어듭니다.'
      : 'κ 를 키우면 등고선이 납작해지고 궤적이 지그재그가 됩니다. η/문턱 을 1 로 밀면 '
      + '진동이 멈추지 않고, 1 을 넘으면 터집니다. 점을 끌어 시작 위치를 바꿀 수 있습니다. '
      + '수축률은 최적 학습률에서의 값이라 η 를 움직여도 바뀌지 않습니다.';
  }

  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
