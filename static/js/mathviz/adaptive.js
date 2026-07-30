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
