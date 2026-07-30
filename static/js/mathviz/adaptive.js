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
