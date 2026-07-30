// static/js/mathviz/adaptive.js
// 4편 — 축별 보폭(적응적 학습률)의 순수 수학.
//
// 축 문장: **축별 보폭은 축이 좌표축과 맞을 때만 κ 를 지운다.**
// θ=45° 에서 A 의 대각 성분이 같아져 대각 전처리가 항등행렬의 스칼라 곱이 되고,
// κ(D⁻¹A) = κ(A) 로 조건수가 전혀 바뀌지 않는다. 스펙 §2-5.
//
// ⚠️ 이 축 문장을 Adam 에까지 적용하지 말 것. Adam 은 β₁ 때문에 이 상을 벗어난다.
// 스펙 §2-2 와 §글의 축의 경고를 볼 것.

/** A = R(θ) diag(1, κ) R(θ)ᵀ. 대칭이라 [[a,b],[b,c]] 꼴이다. */
export function rotatedHessian(kappa, theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const off = (1 - kappa) * c * s;
  return [
    [c * c + kappa * s * s, off],
    [off, s * s + kappa * c * c],
  ];
}

/** ½xᵀAx 의 기울기 = A·p. */
export function quadGradA(A, [x, y]) {
  return [A[0][0] * x + A[0][1] * y, A[1][0] * x + A[1][1] * y];
}

/** 2×2 대칭행렬의 고윳값 [큰 것, 작은 것]. */
export function symEig2(A) {
  const tr = A[0][0] + A[1][1];
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  const r = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  return [tr / 2 + r, tr / 2 - r];
}

/**
 * 대각 전처리 D = diag(A₁₁, A₂₂) 를 적용한 뒤의 조건수 κ(D⁻¹A).
 *
 * 이것이 축 문장의 계량이다. θ=0° 면 D = A 라 1 이 나오고, θ=45° 면 A₁₁ = A₂₂ 라
 * D 가 항등행렬의 스칼라 곱이어서 κ(A) 가 그대로 나온다.
 *
 * D⁻¹A 는 대칭이 아니지만, D 가 양정이므로 D^(−1/2) A D^(−1/2) 와 같은 고윳값을 가진다.
 * 후자는 대칭이라 symEig2 로 정확히 풀린다 — 그래서 비대칭 고윳값 코드가 필요 없다.
 */
export function diagPreconditionedKappa(A) {
  const d0 = Math.sqrt(A[0][0]);
  const d1 = Math.sqrt(A[1][1]);
  const M = [
    [A[0][0] / (d0 * d0), A[0][1] / (d0 * d1)],
    [A[1][0] / (d1 * d0), A[1][1] / (d1 * d1)],
  ];
  const [l1, l2] = symEig2(M);
  return l2 > 1e-300 ? l1 / l2 : Infinity;
}

export const KINDS = ['gd', 'momentum', 'adagrad', 'rmsprop', 'adam'];

/** 옵티마이저 상태. m = 1차 모멘트, v = Adam 2차 모멘트, s = AdaGrad/RMSProp 누적, t = 스텝 수. */
export function initState() {
  return { m: [0, 0], v: [0, 0], s: [0, 0], t: 0 };
}

/**
 * 한 스텝의 보폭과 갱신된 상태. 상태는 불변으로 다룬다 (새 객체를 돌려준다).
 *
 * ⚠️ 'rmsprop' 과 'adam' 은 분리된 구현이다. 'adam' 에 β₁=0 을 넣어 RMSProp 을 대신하지
 * 않는다 — Adam 은 v 에 편향 보정을 하고 RMSProp 은 하지 않아서, 같은 β₂ 라도 초기 거동과
 * 반복수가 다르다 (κ=100·θ=45° 에서 424.4 회 대 330.8 회). 스펙 §3-4
 */
export function optimizerStep(kind, state, g, opts = {}) {
  const {
    eta = 0.1, beta = 0.9, beta1 = 0.9, beta2 = 0.999, eps = 1e-8,
    biasCorrect = true,
  } = opts;
  const t = state.t + 1;
  let { m, v, s } = state;
  let step;

  if (kind === 'gd') {
    step = [eta * g[0], eta * g[1]];
  } else if (kind === 'momentum') {
    v = [beta * v[0] + g[0], beta * v[1] + g[1]];
    step = [eta * v[0], eta * v[1]];
  } else if (kind === 'adagrad') {
    s = [s[0] + g[0] * g[0], s[1] + g[1] * g[1]];
    step = [eta * g[0] / (Math.sqrt(s[0]) + eps), eta * g[1] / (Math.sqrt(s[1]) + eps)];
  } else if (kind === 'rmsprop') {
    s = [
      beta2 * s[0] + (1 - beta2) * g[0] * g[0],
      beta2 * s[1] + (1 - beta2) * g[1] * g[1],
    ];
    step = [eta * g[0] / (Math.sqrt(s[0]) + eps), eta * g[1] / (Math.sqrt(s[1]) + eps)];
  } else if (kind === 'adam') {
    m = [beta1 * m[0] + (1 - beta1) * g[0], beta1 * m[1] + (1 - beta1) * g[1]];
    v = [
      beta2 * v[0] + (1 - beta2) * g[0] * g[0],
      beta2 * v[1] + (1 - beta2) * g[1] * g[1],
    ];
    const c1 = biasCorrect ? 1 - Math.pow(beta1, t) : 1;
    const c2 = biasCorrect ? 1 - Math.pow(beta2, t) : 1;
    const mh = [m[0] / c1, m[1] / c1];
    const vh = [v[0] / c2, v[1] / c2];
    step = [
      eta * mh[0] / (Math.sqrt(vh[0]) + eps),
      eta * mh[1] / (Math.sqrt(vh[1]) + eps),
    ];
  } else {
    throw new Error(`optimizerStep: 모르는 kind ${kind}`);
  }

  return { step, state: { m, v, s, t } };
}

/**
 * readout 용 — 현재 상태에서의 축별 유효 학습률.
 *
 * AdaGrad 를 고르고 반복을 끝까지 밀면 이 숫자가 줄어드는 것이 보여야 한다.
 * 그것이 RMSProp 이 존재하는 이유이고, 데모에서 안 보이는 것을 글에서 주장하면
 * 독자가 확인할 수 없다. 스펙 §3-5
 *
 * Adam 은 **편향 보정 후의 v̂** 를 기준으로 한다. 보정 전 값을 찍으면 초기 몇 스텝이
 * 실제 보폭과 어긋난 숫자로 보인다. t=0 이면 보정 분모가 0 이므로 η 를 그대로 돌려준다.
 */
export function effectiveEta(kind, state, opts = {}) {
  const { eta = 0.1, beta2 = 0.999, eps = 1e-8, biasCorrect = true } = opts;
  if (kind === 'adagrad' || kind === 'rmsprop') {
    return [eta / (Math.sqrt(state.s[0]) + eps), eta / (Math.sqrt(state.s[1]) + eps)];
  }
  if (kind === 'adam') {
    if (state.t === 0) return [eta, eta];
    const c2 = biasCorrect ? 1 - Math.pow(beta2, state.t) : 1;
    return [
      eta / (Math.sqrt(state.v[0] / c2) + eps),
      eta / (Math.sqrt(state.v[1] / c2) + eps),
    ];
  }
  return [eta, eta];
}

/** ½xᵀAx 위의 궤적. 길이 steps+1. 발산해 유한하지 않게 되면 그 자리에서 끊는다. */
export function optPath({ kind, A, start, steps, eta, ...opts }) {
  let p = [start[0], start[1]];
  let st = initState();
  const out = [[p[0], p[1]]];
  for (let i = 0; i < steps; i++) {
    const g = quadGradA(A, p);
    if (!Number.isFinite(g[0]) || !Number.isFinite(g[1])) break;
    const r = optimizerStep(kind, st, g, { eta, ...opts });
    st = r.state;
    p = [p[0] - r.step[0], p[1] - r.step[1]];
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) break;
    out.push([p[0], p[1]]);
  }
  return out;
}

/**
 * 반복수를 재는 기준 시작점 다섯 개.
 *
 * ⚠️ |x| = |y| 인 점을 넣지 말 것. θ=45° 에서 그 점이 정확히 A 의 고유벡터가 되어
 * 최적 η 하나로 원점에 착지하고, 다섯 방법의 반복수가 모두 1 로 나온다. 스펙 §3-1
 */
export const DEFAULT_STARTS = [
  [2.5, 0.7], [1.8, -1.2], [0.4, 2.2], [-2.1, 1.5], [-0.9, -2.4],
];

/**
 * 데모 2(OLS)의 고정 학습률. 스펙 §2-3b 에서 실측한 값이다.
 *
 * ⚠️ 데모 1 과 공유하지 않는다. 회전 이차함수의 RMSProp 최적 η 는 2.51 인데 OLS 에서는
 * 0.05 로 **50배** 다르다. 한 상수를 양쪽에 쓰면 한쪽이 반드시 망가진다.
 * ⚠️ Adam 에 0.1 을 쓰지 말 것. 치우침 배치에서 중심화 OFF 72 회가 ON 120 회보다 빨라져
 * 글이 주장하는 것과 반대되는 표가 화면에 뜬다. 0.05 에서는 179 → 121 로 정상이다.
 *
 * GD·모멘텀은 최적값 2/(λ_min+λ_max) 를 자동 계산하므로 여기 없다.
 */
export const OLS_ETA = {
  rmsprop: 0.05,
  adam: 0.05,
};

/** 한 시작점에서 목표에 도달하는 반복수. 미도달이면 maxIters. */
export function stepsToTolOne({ kind, A, start, eta, tol = 1e-3, maxIters = 4000, ...opts }) {
  let p = [start[0], start[1]];
  const d0 = Math.hypot(p[0], p[1]);
  let st = initState();
  for (let t = 1; t <= maxIters; t++) {
    const g = quadGradA(A, p);
    if (!Number.isFinite(g[0]) || !Number.isFinite(g[1])) return maxIters;
    const r = optimizerStep(kind, st, g, { eta, ...opts });
    st = r.state;
    p = [p[0] - r.step[0], p[1] - r.step[1]];
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return maxIters;
    if (Math.hypot(p[0], p[1]) <= tol * d0) return t;
  }
  return maxIters;
}

/**
 * 시작점들의 평균 반복수.
 *
 * 미도달을 null 로 돌려주지 않는 이유: bestEta 가 η 를 고를 때 "미도달한 η 들" 사이의
 * 우열을 가릴 수 없게 되어 탐색이 성립하지 않는다. maxIters 로 세어 평균에 넣고,
 * 도달 여부는 reached 로 따로 알린다. 데모는 reached 가 false 면 `미도달` 을 표시한다.
 */
export function stepsToTol({
  kind, A, starts = DEFAULT_STARTS, eta, tol = 1e-3, maxIters = 4000, ...opts
}) {
  let sum = 0;
  let reached = true;
  for (const s of starts) {
    const n = stepsToTolOne({ kind, A, start: s, eta, tol, maxIters, ...opts });
    if (n >= maxIters) reached = false;
    sum += n;
  }
  return { iters: sum / starts.length, reached };
}

/**
 * 시작점들의 **평균** 반복수를 최소화하는 η.
 *
 * ⚠️ 시작점마다 따로 고르면 "그 점에 정확히 착지하는 η" 를 찾아내 반복수가 인공적으로
 * 1 이 된다 (§3-1 과 같은 뿌리). 반드시 평균에 대해 고른다.
 *
 * 그리드 기본값은 스펙 §2 의 측정과 같다. 바꾸면 §2 의 표와 테스트 기대값이 함께 흔들린다.
 */
export function bestEta({
  kind, A, starts = DEFAULT_STARTS, tol = 1e-3, maxIters = 4000,
  kMin = -6, kMax = 1, kStep = 0.08, ...opts
}) {
  let best = { eta: Math.pow(10, kMin), iters: Infinity, reached: false };
  for (let k = kMin; k <= kMax + 1e-12; k += kStep) {
    const eta = Math.pow(10, k);
    const r = stepsToTol({ kind, A, starts, eta, tol, maxIters, ...opts });
    if (r.iters < best.iters) best = { eta, iters: r.iters, reached: r.reached };
  }
  return best;
}
