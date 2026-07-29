// static/js/mathviz/optimize.js
// 경사하강법의 순수 수학. 캔버스도 DOM 도 모르고, Node 로 테스트된다.
//
// 이 파일의 논지: 조건수 κ 가 반복 횟수를 정한다.
//
// 합성 이차함수는 f(x, y) = ½(x² + κy²) 를 쓴다. Hessian 이 diag(1, κ) 라서
// 조건수가 정확히 κ 이고, 슬라이더 값이 곧 κ 다 — 다른 파라미터에서 역산하지 않는다.

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
