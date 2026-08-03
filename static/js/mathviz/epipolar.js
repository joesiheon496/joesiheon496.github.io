// 에피폴라 기하. DOM 접근 없음 — 브라우저와 Node 양쪽에서 돈다.
//
// 6편 규약을 그대로 쓴다 (camera.js): 3-벡터는 [x,y,z], 행렬은 중첩 배열 행 우선,
// 카메라는 { K, R, t } 이고 R 의 행이 [오른쪽, 아래, 시선] 이다.
//
// ⚠️ F 와 E 는 **스케일이 자유롭다.** 비교와 테스트는 전부 스케일·부호 무관으로
// 해야 한다 — matDiffUpToScale 을 쓴다. 스펙 §3-4

import {
  matMul, matVec, transpose, inv3, cross, dot, normalize, scale, sub,
} from './camera.js';

// ---------- 대칭 고유분해 ----------

/**
 * 대칭행렬의 야코비 고유분해. n×n 어디든 돈다 (8점 알고리즘이 9×9 를 쓴다).
 *
 * → { values, vectors } — vectors 는 **열**이 고유벡터다 (vectors[행][열]).
 * 고윳값 순서는 정렬돼 있지 않다. 최소를 원하면 smallestEigVec 를 쓴다.
 *
 * 2편이 SVD 를 AᵀA 의 고유분해로 소개했는데, 여기서 그 방법을 그대로 쓴다.
 */
export function jacobiEig(Ain, sweeps = 200) {
  const n = Ain.length;
  const A = Ain.map((row) => [...row]);
  const V = Array.from({ length: n }, (_, i) => (
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  ));

  for (let s = 0; s < sweeps; s++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] ** 2;
    if (off < 1e-32) break;

    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const sn = t * c;
      for (let k = 0; k < n; k++) {
        const a = A[k][p], b = A[k][q];
        A[k][p] = c * a - sn * b; A[k][q] = sn * a + c * b;
      }
      for (let k = 0; k < n; k++) {
        const a = A[p][k], b = A[q][k];
        A[p][k] = c * a - sn * b; A[q][k] = sn * a + c * b;
      }
      for (let k = 0; k < n; k++) {
        const a = V[k][p], b = V[k][q];
        V[k][p] = c * a - sn * b; V[k][q] = sn * a + c * b;
      }
    }
  }
  return { values: A.map((row, i) => row[i]), vectors: V };
}

/** 가장 작은 고윳값의 고유벡터. AᵀA 에 걸면 A 의 널공간 방향이다. */
export function smallestEigVec(M) {
  const { values, vectors } = jacobiEig(M);
  let k = 0;
  for (let i = 1; i < values.length; i++) if (values[i] < values[k]) k = i;
  return vectors.map((row) => row[k]);
}

/**
 * 3×3 SVD. FᵀF 의 고유분해로 만든다 (2편과 같은 방법).
 * → { U, S, V } — S 는 **내림차순** 배열, U·diag(S)·Vᵀ = F.
 *
 * ⚠️ σ 가 0 인 열은 F·v/σ 로 만들 수 없어 외적으로 채운다. F 는 rank 2 라
 * 세 번째 열이 항상 그 경우다.
 */
export function svd3(F) {
  const { values, vectors } = jacobiEig(matMul(transpose(F), F));
  const idx = [0, 1, 2].sort((a, b) => values[b] - values[a]);
  const V = [0, 1, 2].map((r) => idx.map((c) => vectors[r][c]));
  const S = idx.map((i) => Math.sqrt(Math.max(0, values[i])));
  const U = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];

  const col = (M, c) => [M[0][c], M[1][c], M[2][c]];
  for (let c = 0; c < 3; c++) {
    if (S[c] <= 1e-12) continue;
    const uc = scale(matVec(F, col(V, c)), 1 / S[c]);
    for (let r = 0; r < 3; r++) U[r][c] = uc[r];
  }
  // 채우지 못한 열은 앞선 두 열의 외적으로 정규직교를 완성한다
  if (S[2] <= 1e-12) {
    const u3 = normalize(cross(col(U, 0), col(U, 1)));
    for (let r = 0; r < 3; r++) U[r][2] = u3[r];
  }
  if (S[1] <= 1e-12) {
    const u2 = normalize(cross(col(U, 2), col(U, 0)));
    for (let r = 0; r < 3; r++) U[r][1] = u2[r];
  }
  return { U, S, V };
}

// ---------- 스케일 무관 비교 ----------

export const frobenius = (M) => Math.sqrt(M.flat().reduce((s, v) => s + v * v, 0));

/** Frobenius 노름 1 로 맞춘다. F·E 는 스케일이 자유롭기 때문이다. */
export function normalizeMatrix(M) {
  const f = frobenius(M);
  return M.map((row) => row.map((v) => v / f));
}

/**
 * 스케일과 부호를 무시한 행렬 거리. F 를 정답과 비교할 때 쓴다.
 *
 * ⚠️ 이 지표로 Hartley 정규화의 효과를 재면 "효과 없음" 이 나온다 — 잡음이
 * 지배하는 구간에서 성분 차이는 기하적 의미가 없다. 정규화 효과는
 * symmetricEpipolarDistance 로 재야 한다. 스펙 §3-1
 */
export function matDiffUpToScale(A, B) {
  const a = normalizeMatrix(A).flat();
  const b = normalizeMatrix(B).flat();
  const plus = Math.hypot(...a.map((v, i) => v - b[i]));
  const minus = Math.hypot(...a.map((v, i) => v + b[i]));
  return Math.min(plus, minus);
}

// ---------- 상대 자세 → E → F ----------

/** t 의 외적 행렬 [t]ₓ. [t]ₓ v = t × v */
export const skew = (t) => [
  [0, -t[2], t[1]],
  [t[2], 0, -t[0]],
  [-t[1], t[0], 0],
];

/**
 * 카메라 1 좌표계에서 본 카메라 2 의 자세.
 * X₂ = R X₁ + t 를 만족하는 { R, t }.
 */
export function relativePose(cam1, cam2) {
  const R = matMul(cam2.R, transpose(cam1.R));
  return { R, t: sub(cam2.t, matVec(R, cam1.t)) };
}

/** Essential 행렬 E = [t]ₓ R. 정규화 좌표계의 에피폴라 제약을 담는다. */
export function essentialFromCameras(cam1, cam2) {
  const { R, t } = relativePose(cam1, cam2);
  return matMul(skew(t), R);
}

/**
 * Fundamental 행렬 F = K₂⁻ᵀ E K₁⁻¹.
 *
 * 🔑 이것이 "카메라 두 대가 같은 점을 봤다" 를 적은 행렬이다: x₂ᵀ F x₁ = 0.
 * K 를 알면 E 로, 모르면 F 로 말한다.
 */
export function fundamentalFromCameras(cam1, cam2) {
  const E = essentialFromCameras(cam1, cam2);
  return matMul(transpose(inv3(cam2.K)), matMul(E, inv3(cam1.K)));
}

// ---------- 에피폴 ----------

/**
 * 두 이미지의 에피폴. e₁ 은 F 의 널공간, e₂ 는 Fᵀ 의 널공간이다.
 *
 * 🔑 6편 매듭: 에피폴은 **다른 카메라 중심의 이미지**다. e₂ 는 카메라 1 의 광심을
 * 카메라 2 로 투영한 것과 같다. 6편의 "소실점은 방향이 정한다" 와 같은 종류의
 * 사실이다 — 이번엔 점 하나(광심)가 상대 이미지에 찍힌 것이다.
 *
 * ⚠️ 6편 vanishingPoint 와 같은 규약으로 동차 h 를 **항상** 반환한다. 두 카메라의
 * 광축이 평행하고 이동이 상면에 평행하면 에피폴이 무한으로 가고 (u,v) 는 NaN 이다.
 */
export function epipoles(F) {
  const mk = (h) => {
    const ref = Math.max(Math.abs(h[0]), Math.abs(h[1]), 1);
    const atInfinity = Math.abs(h[2]) <= 1e-12 * ref;
    return { h, atInfinity, u: h[0] / h[2], v: h[1] / h[2] };
  };
  return {
    e1: mk(smallestEigVec(matMul(transpose(F), F))),
    e2: mk(smallestEigVec(matMul(F, transpose(F)))),
  };
}

/**
 * 이미지 1 의 점 x₁ 이 이미지 2 에 만드는 에피폴라 직선 l₂ = F x₁.
 * 직선은 동차 (a,b,c) 이고 a·u + b·v + c = 0 이다.
 */
export const epipolarLineInSecond = (F, [u, v]) => matVec(F, [u, v, 1]);

/** 반대 방향: 이미지 2 의 점이 이미지 1 에 만드는 직선 l₁ = Fᵀ x₂. */
export const epipolarLineInFirst = (F, [u, v]) => matVec(transpose(F), [u, v, 1]);

/** 점에서 동차 직선까지의 화소 거리. */
export function pointLineDistance(l, [u, v]) {
  return Math.abs(l[0] * u + l[1] * v + l[2]) / Math.hypot(l[0], l[1]);
}

/**
 * 대응쌍의 대칭 에피폴라 거리 (화소). 기하 오차의 표준 지표다.
 *
 * 🔑 Hartley 정규화의 효과는 **이 지표로만** 보인다. 행렬 성분 차이로 재면
 * 잡음 구간에서 차이가 사라진다. 스펙 §2-7, §3-1
 */
export function symmetricEpipolarDistance(F, pairs) {
  let sum = 0;
  for (const [x1, x2] of pairs) {
    const l2 = epipolarLineInSecond(F, x1);
    const l1 = epipolarLineInFirst(F, x2);
    sum += pointLineDistance(l2, x2) + pointLineDistance(l1, x1);
  }
  return sum / (2 * pairs.length);
}

// ---------- 8점 알고리즘 (2편 매듭) ----------

/**
 * Hartley 정규화 행렬. 무게중심을 원점으로 옮기고 평균거리를 √2 로 맞춘다.
 *
 * 🔑 이것이 고치는 것은 **조건수**다. 화소 좌표를 그대로 쓰면 A 의 성분이
 * u·v ≈ 10⁵ 부터 1 까지 다섯 자리를 걸쳐서 cond(A) 가 1.3e5 까지 오른다.
 * 정규화하면 57 로 내려간다 (2320배). 스펙 §2-6
 */
export function normalizingTransform(pts) {
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p[0], 0) / n;
  const cy = pts.reduce((s, p) => s + p[1], 0) / n;
  const d = pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / n;
  const s = Math.SQRT2 / (d || 1);
  return [[s, 0, -s * cx], [0, s, -s * cy], [0, 0, 1]];
}

const applyH = (T, [u, v]) => {
  const r = matVec(T, [u, v, 1]);
  return [r[0] / r[2], r[1] / r[2]];
};

/** 대응쌍에서 8점 알고리즘의 계수행렬 A 를 만든다. 행마다 x₂ᵀFx₁ = 0 한 개. */
export function eightPointMatrix(pairs) {
  return pairs.map(([[x1, y1], [x2, y2]]) => [
    x2 * x1, x2 * y1, x2,
    y2 * x1, y2 * y1, y2,
    x1, y1, 1,
  ]);
}

/** A 의 조건수. 널공간 방향(최소)을 제외한 σ_max/σ_min 이다. */
export function conditionNumber(pairs) {
  const A = eightPointMatrix(pairs);
  const AtA = Array.from({ length: 9 }, (_, i) => (
    Array.from({ length: 9 }, (_, j) => A.reduce((s, r) => s + r[i] * r[j], 0))
  ));
  const v = jacobiEig(AtA).values.map(Math.abs).sort((a, b) => b - a);
  return Math.sqrt(v[0] / Math.max(v[7], 1e-300));
}

/**
 * 대응점에서 F 를 푼다. 🔑 2편 매듭: **SVD 의 최소 특이벡터**가 답이다.
 *
 * 대응 하나가 x₂ᵀFx₁ = 0 이라는 선형식 하나를 준다. F 는 성분 9개인데 스케일이
 * 자유롭기 때문에 자유도가 8 이고, 그래서 대응 8개면 결정된다. 식이 여덟 개인
 * 9-미지수 동차계의 해가 곧 A 의 널공간이고, 잡음이 있으면 널공간이 비므로
 * **AᵀA 의 최소 고유벡터**를 취한다 — 그게 최소제곱해다.
 *
 * @param normalized Hartley 정규화 여부. 껐다 켜며 비교하는 것이 데모 2 의 요점이다.
 * @param enforceRank2 σ3 을 0 으로 눌러 rank 2 를 강제한다.
 *
 * ⚠️ **강제가 정확도를 개선하지는 않는다.** 처음 이 주석에 "끄면 에피폴이 정의되지
 * 않는다" 고 적었는데 실측으로 뒤집혔다 — 잡음 5수준 × 40회에서 끈 쪽이 전부 같거나
 * 약간 낫다 (σ=0.5 에서 에피폴 오차 6.30 대 6.53 px). 강제는 σ₃/σ₁ 을 1000배
 * 줄이는 일만 확실히 한다 (1.7e-8 → 3.3e-11). 강제하는 이유는 정확도가 아니라
 * (1) 유효한 F 의 정의가 det F = 0 이라는 것, (2) 8편의 E 분해가 요구하는 것이다.
 * 스펙 §2-8, §3-6
 */
export function fundamentalFromPairs(pairs, { normalized = true, enforceRank2 = true } = {}) {
  let p = pairs, T1 = null, T2 = null;
  if (normalized) {
    T1 = normalizingTransform(pairs.map((q) => q[0]));
    T2 = normalizingTransform(pairs.map((q) => q[1]));
    p = pairs.map(([a, b]) => [applyH(T1, a), applyH(T2, b)]);
  }

  const A = eightPointMatrix(p);
  const AtA = Array.from({ length: 9 }, (_, i) => (
    Array.from({ length: 9 }, (_, j) => A.reduce((s, r) => s + r[i] * r[j], 0))
  ));
  const f = smallestEigVec(AtA);
  let F = [[f[0], f[1], f[2]], [f[3], f[4], f[5]], [f[6], f[7], f[8]]];

  if (enforceRank2) {
    const { U, S, V } = svd3(F);
    const D = [[S[0], 0, 0], [0, S[1], 0], [0, 0, 0]];
    F = matMul(U, matMul(D, transpose(V)));
  }
  // 정규화 좌표계에서 푼 F 를 원래 화소 좌표로 되돌린다
  if (normalized) F = matMul(transpose(T2), matMul(F, T1));
  return normalizeMatrix(F);
}
