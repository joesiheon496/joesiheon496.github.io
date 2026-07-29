// static/js/mathviz/optimize.js
// 경사하강법의 순수 수학. 캔버스도 DOM 도 모르고, Node 로 테스트된다.
//
// 이 파일의 논지: 조건수 κ 가 반복 횟수를 정한다.
//
// 합성 이차함수는 f(x, y) = ½(x² + κy²) 를 쓴다. Hessian 이 diag(1, κ) 라서
// 조건수가 정확히 κ 이고, 슬라이더 값이 곧 κ 다 — 다른 파라미터에서 역산하지 않는다.

import { svd2x2, pseudoInverse2x2 } from './transform.js';

// ------------------------------------------------------------ 이차함수

/** f = ½(x² + κy²) 의 기울기. */
export function quadGrad(kappa, [x, y]) {
  return [x, kappa * y];
}

/** f = ½(x² + κy²) 의 값. */
export function quadLoss(kappa, [x, y]) {
  return 0.5 * (x * x + kappa * y * y);
}

/**
 * 최적 학습률 2/(λ_min + λ_max) = 2/(1+κ).
 *
 * 이 값에서 |1−η| 와 |1−ηκ| 가 정확히 같아진다. 그래서 두 축이 같은 비로 줄고,
 * 수축률이 점근값이 아니라 첫 스텝부터 정확히 (κ−1)/(κ+1) 이 된다.
 */
export function optimalEta(kappa) {
  return 2 / (1 + kappa);
}

/**
 * 발산 문턱 2/λ_max = 2/κ.
 *
 * 이 값을 **넘으면** 발산한다. 정확히 같으면 발산이 아니라 영원히 진동한다 —
 * y 성분의 배율이 |1 − ηκ| = 1 로 크기를 유지하기 때문이다.
 * 그래서 데모의 경고 판정은 `>` 여야 한다. `>=` 로 하면 진동을 발산으로 잘못 표시한다.
 */
export function divergenceEta(kappa) {
  return 2 / kappa;
}

/** 최적 학습률에서의 수축률 (κ−1)/(κ+1). 다른 학습률에서는 성립하지 않는다. */
export function contractionRate(kappa) {
  return (kappa - 1) / (kappa + 1);
}

/** 최적 모멘텀에서의 점근 수축률 (√κ−1)/(√κ+1). κ 의존성이 √κ 로 줄어든다. */
export function momentumRate(kappa) {
  const s = Math.sqrt(kappa);
  return (s - 1) / (s + 1);
}

/** heavy ball 의 최적 β = ((√κ−1)/(√κ+1))². */
export function optimalBeta(kappa) {
  return momentumRate(kappa) ** 2;
}

/** heavy ball 의 최적 학습률 4/(1+√κ)². */
export function optimalMomentumEta(kappa) {
  return 4 / (1 + Math.sqrt(kappa)) ** 2;
}

/**
 * 목표(초기 오차의 tol 배)까지 필요한 반복수. **최적 학습률을 가정한 값이다.**
 *
 * κ=1 이면 한 스텝에 정확히 최소점에 도달한다. 그때 수축률이 0 이고 log(0) = −∞ 라
 * 일반식이 0 을 주므로 따로 1 을 돌려준다.
 */
export function stepsToTarget(kappa, tol = 1e-3) {
  if (kappa <= 1 + 1e-12) return 1;
  return Math.ceil(Math.log(tol) / Math.log(contractionRate(kappa)));
}

/**
 * 경사하강법 / heavy ball 궤적. 길이 steps+1 의 점 배열.
 * beta = 0 이면 생 경사하강법이다.
 *
 * 발산하면 좌표가 Infinity 또는 NaN 이 된다. 걸러내지 않고 그대로 돌려주므로
 * 그리는 쪽에서 isFinitePoint 로 확인해야 한다 — 발산 자체가 이 데모의 볼거리다.
 */
export function gdPath({ kappa, eta, beta = 0, start, steps }) {
  let prev = [start[0], start[1]];
  let cur = [start[0], start[1]];
  const path = [[cur[0], cur[1]]];
  for (let i = 0; i < steps; i++) {
    const g = quadGrad(kappa, cur);
    const next = [
      cur[0] - eta * g[0] + beta * (cur[0] - prev[0]),
      cur[1] - eta * g[1] + beta * (cur[1] - prev[1]),
    ];
    prev = cur;
    cur = next;
    path.push([cur[0], cur[1]]);
  }
  return path;
}

export const isFinitePoint = ([x, y]) => Number.isFinite(x) && Number.isFinite(y);

/**
 * 궤적에서 목표점까지의 거리가 초기 거리의 tol 배 아래로 처음 내려간 반복수.
 * 도달하지 못하거나 발산하면 null 이다 — 호출자가 '미도달' 로 표시한다.
 *
 * 데모 1 은 target 이 최소점(원점), 데모 2 는 닫힌 해다.
 */
export function firstIndexBelow(path, tol = 1e-3, target = [0, 0]) {
  const dist = (p) => Math.hypot(p[0] - target[0], p[1] - target[1]);
  const e0 = dist(path[0]);
  if (e0 === 0) return 0;
  for (let i = 0; i < path.length; i++) {
    if (!isFinitePoint(path[i])) return null;
    if (dist(path[i]) < tol * e0) return i;
  }
  return null;
}

// ------------------------------------------------------------------ OLS
//
// 2편의 직선맞춤은 직교 회귀(수직 거리)였고 그 손실은 각도에 대해 주기적이라
// 볼록하지 않다. 위의 수축률 이론이 안 맞는다. 그래서 3편은 보통최소자승으로 바꾼다.
//
//   L(a, b) = Σ (y_i − a x_i − b)²
//
// 이러면 Hessian 이 2XᵀX 라는 **상수 행렬**이 되어 조건수가 데이터만으로 정해진다.

/** 점 배열 → 설계행렬 X = [[x, 1], …] 과 관측 y. */
export function olsDesign(points) {
  return { X: points.map(([x]) => [x, 1]), y: points.map(([, y]) => y) };
}

/** XᵀX (2×2 대칭 준양정). Hessian 은 이것의 2배다. */
function gramOf(points) {
  let xx = 0, x1 = 0, n = 0;
  for (const [x] of points) { xx += x * x; x1 += x; n += 1; }
  return [[xx, x1], [x1, n]];
}

/**
 * 설계행렬의 특이값과 Hessian 의 조건수.
 *
 * κ(XᵀX) = (σ₁/σ₂)² — 2편의 σ 가 **제곱되어** 들어오는 지점이고, 이 글의 논지다.
 *
 * XᵀX 는 대칭 준양정이라 그 SVD 가 고윳값 분해와 같다. 그래서 2편의 svd2x2 를
 * 그대로 재사용할 수 있다.
 *
 * ⚠️ svd2x2(XᵀX) 가 주는 값은 **XᵀX 의** 고윳값이고, 이는 X 의 특이값의 제곱이다.
 * 2편 데모 2 에서 공분산에 대해 똑같은 함정을 만났다. σ 로 쓸 값은 제곱근이다.
 */
export function olsKappa(points) {
  const { s1: l1, s2: l2 } = svd2x2(gramOf(points));
  return {
    s1: Math.sqrt(l1),
    s2: Math.sqrt(l2),
    kappa: l2 > 1e-300 ? l1 / l2 : Infinity,
    l1,
    l2,
  };
}

/**
 * 닫힌 해. 2편의 pseudoInverse2x2 로 (XᵀX)⁺ 를 만들어 Xᵀy 에 적용한다.
 * 의사역행렬을 쓰므로 x 가 모두 같은 퇴화 배치에서도 발산하지 않는다.
 */
export function olsClosed(points) {
  const P = pseudoInverse2x2(gramOf(points), 1e-12);
  let r0 = 0, r1 = 0;
  for (const [x, y] of points) { r0 += x * y; r1 += y; }
  return [P[0][0] * r0 + P[0][1] * r1, P[1][0] * r0 + P[1][1] * r1];
}

/** x 를 평균 0 으로 옮긴다. 답인 직선은 바뀌지 않고 조건수만 낮아진다. */
export function centerPoints(points) {
  const xbar = points.reduce((s, [x]) => s + x, 0) / points.length;
  return { points: points.map(([x, y]) => [x - xbar, y]), xbar };
}

/**
 * OLS 를 경사하강법으로 푸는 궤적. 길이 steps+1 의 [a, b] 배열.
 *
 * 학습률은 최적값을 쓴다. Hessian = 2XᵀX 이므로 고윳값이 2l 이고,
 * 2/(λ_min + λ_max) = 2/(2l₁ + 2l₂) 다. 데모 1 이 이미 학습률을 다루므로
 * 여기서는 κ 만이 변수여야 한다.
 *
 * center: true 면 x 를 중심화해 풀고 **원 좌표로 환산해서** 돌려준다:
 *   a = a′,  b = b′ − a′·x̄
 * 환산을 호출자에게 맡기면 데모마다 같은 함정을 다시 밟는다. 반환값은 항상
 * 원 좌표이므로 호출자는 center 를 신경쓰지 않고 닫힌 해와 직접 비교할 수 있다.
 */
export function olsGdPath({ points, steps, center = false }) {
  const { points: P, xbar } = center
    ? centerPoints(points)
    : { points, xbar: 0 };
  const { l1, l2 } = olsKappa(P);
  const eta = 2 / (2 * l1 + 2 * l2);

  let a = 0, b = 0;
  const out = [[a, b - a * xbar]];
  for (let i = 0; i < steps; i++) {
    let g0 = 0, g1 = 0;
    for (const [x, y] of P) {
      const r = a * x + b - y;
      g0 += 2 * r * x;
      g1 += 2 * r;
    }
    a -= eta * g0;
    b -= eta * g1;
    out.push([a, b - a * xbar]);
  }
  return out;
}
