// 삼각측량. DOM 접근 없음 — 브라우저와 Node 양쪽에서 돈다.
//
// 6·7편 규약을 그대로 쓴다 (camera.js): 3-벡터는 [x,y,z], 행렬은 중첩 배열 행 우선,
// 카메라는 { K, R, t } 이고 R 의 행이 [오른쪽, 아래, 시선] 이다.
//
// 🔑 이 글의 축: **같은 조건수가 답의 모양은 정하고 반복 횟수는 정하지 않는다.**
// - 모양: errorEllipsoid 가 σ²(JᵀJ)⁻¹ 로 오차 타원체를 예측한다. 축비 = √κ. 스펙 §2-6, §2-7
// - 반복: triangulateGN 은 κ 가 6만 배 커져도 1\~3 스텝이다. 스펙 §2-8
//
// ⚠️ κ 는 **점의 함수**다. 잡음이 흔든 초기값마다 다르므로 어디서 쟀는지 항상 명시해야
// 한다 (스펙 §3-4). 이 파일의 함수들은 전부 X 를 인자로 받아 그 자리에서 잰다.

import {
  add, sub, scale, dot, norm, normalize, matVec, transpose, matMul, inv3, det3,
  projectPoint, depthOf,
} from './camera.js';
import { jacobiEig, svd3 } from './epipolar.js';

// ---------- 광선 ----------

/**
 * 이미지 점 (u,v) 가 정하는 월드 광선. 6편이 말한 "점 하나는 광선 하나".
 * → { C: 카메라 중심, d: 정규화된 방향 }
 */
export function rayFromImage({ K, R, t }, [u, v]) {
  const C = scale(matVec(transpose(R), t), -1);
  return { C, d: normalize(matVec(transpose(R), matVec(inv3(K), [u, v, 1]))) };
}

// ---------- 세 추정량 ----------

/**
 * (a) 중점법 — 두 광선의 최단접근점을 잇는 선분의 중점. 2×2 선형계.
 *
 * gap 이 이 글의 출발점이다: 잡음이 있으면 **두 광선은 만나지 않는다.**
 * 1 px 에서 11.8 mm 어긋난다 (스펙 §2-2).
 *
 * → { X, gap, P1, P2 } · 광선이 평행하면 null
 */
export function triangulateMidpoint(cam1, cam2, x1, x2) {
  const { C: C1, d: d1 } = rayFromImage(cam1, x1);
  const { C: C2, d: d2 } = rayFromImage(cam2, x2);
  const w = sub(C2, C1);
  const a = dot(d1, d1), b = dot(d1, d2), c = dot(d2, d2);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-14) return null;
  const s = (dot(w, d1) * c - dot(w, d2) * b) / den;
  const u = (dot(w, d1) * b - dot(w, d2) * a) / den;
  const P1 = add(C1, scale(d1, s));
  const P2 = add(C2, scale(d2, u));
  return { X: scale(add(P1, P2), 0.5), gap: norm(sub(P1, P2)), P1, P2 };
}

/** P = K[R|t], 3×4. camera.js 의 cameraMatrix 와 같으나 여기서도 필요하다. */
const P34 = ({ K, R, t }) => {
  const KR = matMul(K, R), Kt = matVec(K, t);
  return KR.map((row, i) => [...row, Kt[i]]);
};

/**
 * (b) DLT — 대수적 최소자승. 4×4 AᵀA 의 **최소 고유벡터**.
 *
 * 🔑 2편의 그 기계를 세 번째로 쓴다. 2편은 흩어짐이 가장 큰 방향(2×2), 7편은 가장
 * 작은 방향(9×9), 여기서도 가장 작은 방향(4×4)이다. `smallestEigVec` 는 n×n 이라
 * 7편이 만든 것을 그대로 쓴다.
 *
 * 각 행은 u·(3행) − (1행) 형태다 — u = p₀/p₂ 를 분모를 곱해 선형화한 것이고,
 * 그래서 최소화하는 양이 화소 오차가 아니라 **깊이로 가중된** 화소 오차다.
 * 대칭 배치에서는 그 가중이 양쪽에서 같아 MLE 와 구별되지 않는다 (스펙 §2-3).
 */
export function triangulateDLT(cam1, cam2, x1, x2) {
  const P = P34(cam1), Q = P34(cam2);
  const A = [
    P[0].map((v, i) => v - x1[0] * P[2][i]),
    P[1].map((v, i) => v - x1[1] * P[2][i]),
    Q[0].map((v, i) => v - x2[0] * Q[2][i]),
    Q[1].map((v, i) => v - x2[1] * Q[2][i]),
  ];
  const AtA = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map(
    (j) => A.reduce((s, row) => s + row[i] * row[j], 0),
  ));
  const { values, vectors } = jacobiEig(AtA);
  let k = 0;
  for (let i = 1; i < 4; i++) if (values[i] < values[k]) k = i;
  const h = vectors.map((row) => row[k]);
  if (Math.abs(h[3]) < 1e-300) return null;      // 무한점 — 광선이 평행
  return { X: [h[0] / h[3], h[1] / h[3], h[2] / h[3]] };
}

// ---------- 재투영오차와 야코비안 ----------

/** 잔차 4-벡터 [Δu₁, Δv₁, Δu₂, Δv₂]. */
export function reprojResidual(cam1, cam2, x1, x2, X) {
  const a = projectPoint(cam1, X), b = projectPoint(cam2, X);
  return [a.u - x1[0], a.v - x1[1], b.u - x2[0], b.v - x2[1]];
}

/** 재투영 RMS (px). 화소 한 개당 오차로 읽히도록 √2 로 나눈다 (관측 2개/카메라). */
export const reprojRms = (cam1, cam2, x1, x2, X) => (
  Math.hypot(...reprojResidual(cam1, cam2, x1, x2, X)) / Math.sqrt(2)
);

/**
 * ∂(u,v)/∂X, 2×3. 해석 미분이다 — 수치미분을 쓰면 스텝 크기가 또 하나의
 * 자유 파라미터가 된다.
 *
 * Xc = RX + t, p = K·Xc, u = p₀/p₂ 이므로 몫의 미분으로
 *   ∂u/∂X = ((KR)₀·p₂ − p₀·(KR)₂) / p₂²
 */
export function projJacobian({ K, R, t }, X) {
  const Xc = add(matVec(R, X), t);
  const p = matVec(K, Xc);
  const w = p[2];
  const KR = matMul(K, R);
  return [
    KR[0].map((v, i) => (v * w - p[0] * KR[2][i]) / (w * w)),
    KR[1].map((v, i) => (v * w - p[1] * KR[2][i]) / (w * w)),
  ];
}

/** 두 카메라를 쌓은 4×3 야코비안. */
export const jacobian = (cam1, cam2, X) => [
  ...projJacobian(cam1, X), ...projJacobian(cam2, X),
];

/** JᵀJ — 가우스-뉴턴의 헤세 근사. 3편의 헤세와 같은 자리에 온다. */
export const normalMatrix = (J) => [0, 1, 2].map(
  (i) => [0, 1, 2].map((j) => J.reduce((s, row) => s + row[i] * row[j], 0)),
);

/** Jᵀr — 기울기. */
export const gradient = (J, r) => [0, 1, 2].map(
  (i) => J.reduce((s, row, k) => s + row[i] * r[k], 0),
);

/**
 * 3×3 선형계. 부분 피벗 가우스 소거.
 *
 * 7편처럼 SVD 최소노름 해가 필요하지는 않다 — JᵀJ 는 정칙이다 (두 광선이 평행하지
 * 않으면). 다만 거의 평행하면 κ 가 1e5 까지 가므로 피벗은 반드시 해야 한다.
 */
export function solve3(Ain, bin) {
  const A = Ain.map((row, i) => [...row, bin[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-300) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}

/**
 * (c) 재투영오차 최소화 = 가우스 잡음 하 MLE. 가우스-뉴턴.
 *
 * 🔑 **κ 가 반복 횟수를 정하지 않는다.** κ(JᵀJ) 를 1.6 에서 5e4 로 (6만 배) 키워도
 * 스텝이 1→3 이다. 같은 문제를 3편의 경사하강으로 풀면 7 → 1,050,991 회다
 * (스펙 §2-8). 곡률을 근사해 쓰기 때문이다.
 *
 * ⚠️ 잡음이 크면 **발산한다.** σ=20 px 에서 0.2%, 60 px 에서 16.8% (스펙 §2-10).
 * 감쇠(Levenberg–Marquardt)를 넣지 않았다 — 8편 범위 밖이고, 발산 자체가
 * "MLE 가 항상 최선은 아니다" 의 근거다. 부르는 쪽이 `diverged` 를 봐야 한다.
 *
 * → { X, iters, kappa, path, diverged }
 *   kappa 는 **초기값 X0 에서** 잰 κ(JᵀJ) 다 (§3-4).
 */
export function triangulateGN(cam1, cam2, x1, x2, X0, {
  maxIter = 20, tol = 1e-12, refDist = Infinity,
} = {}) {
  let X = [...X0];
  const path = [[...X]];
  const S0 = svd3(normalMatrix(jacobian(cam1, cam2, X))).S;
  const kappa = S0[0] / S0[2];
  let iters = 0;
  for (let it = 0; it < maxIter; it++) {
    const r = reprojResidual(cam1, cam2, x1, x2, X);
    const J = jacobian(cam1, cam2, X);
    const dX = solve3(normalMatrix(J), gradient(J, r).map((v) => -v));
    if (!dX || !dX.every(Number.isFinite)) break;
    X = add(X, dX);
    path.push([...X]);
    iters = it + 1;
    if (norm(dX) < tol * Math.max(1, norm(X))) break;
  }
  const diverged = !X.every(Number.isFinite) || norm(X) > 10 * refDist;
  return { X, iters, kappa, path, diverged };
}

/**
 * 같은 문제를 3편의 경사하강으로. 데모 2 의 대조군.
 *
 * η = 1/L (L = JᵀJ 최대고윳값) 로 최적 고정한다 — 3편이 2차 손실에서 쓴 그 값이다.
 * ⚠️ 브라우저에서 1e6 스텝은 못 돌린다 (스펙 §3-7). 예산만큼 돌리고 어디까지
 * 갔는지 보여주는 것이 이 함수의 용도다. 필요 스텝 수는 gdStepsPredicted 로 예측한다.
 *
 * → { X, path, eta }
 */
export function descentPath(cam1, cam2, x1, x2, X0, { steps = 200, sample = 1 } = {}) {
  const L = svd3(normalMatrix(jacobian(cam1, cam2, X0))).S[0];
  const eta = 1 / L;
  let X = [...X0];
  const path = [[...X]];
  for (let i = 1; i <= steps; i++) {
    const J = jacobian(cam1, cam2, X);
    X = sub(X, scale(gradient(J, reprojResidual(cam1, cam2, x1, x2, X)), eta));
    if (!X.every(Number.isFinite)) break;
    if (i % sample === 0 || i === steps) path.push([...X]);
  }
  return { X, path, eta };
}

/**
 * 3편의 수축률로 예측한 경사하강 반복수. **예측값이다** — 실측이 아니다.
 * 최적 η 에서 한 스텝당 (κ−1)/(κ+1) 배로 줄어든다는 3편의 결과를 그대로 쓴다.
 */
export function gdStepsPredicted(kappa, tol = 1e-3) {
  if (!(kappa > 1)) return 1;
  const rate = (kappa - 1) / (kappa + 1);
  return Math.ceil(Math.log(tol) / Math.log(rate));
}

// ---------- 오차 타원체 ----------

/**
 * 🔑 오차 타원체 = σ²(JᵀJ)⁻¹. 축 길이 σ/√λᵢ, 축 방향은 JᵀJ 의 고유벡터.
 *
 * **비율이 아니라 밀리미터가 맞는다** — 실측/예측 비가 0.998\~1.031 이고 자유
 * 파라미터가 없다 (스펙 §2-6). 그리고 최장/최단 = √κ 다 (§2-7).
 *
 * 5편과 같은 식이다. 5편은 SGD 정상분포에서 축 ∝ 1/√λᵢ 를 얻어 급한축/완만축을
 * 1/√κ 로 적었고, 여기서는 최장/최단을 √κ 로 적는다. **반대가 아니라 기준축의
 * 차이다** (§3-6).
 *
 * → { axes: 내림차순 길이 3개(m), dirs: 대응 방향, kappa, ratio }
 */
export function errorEllipsoid(cam1, cam2, X, sigma = 1) {
  const JtJ = normalMatrix(jacobian(cam1, cam2, X));
  const { values, vectors } = jacobiEig(JtJ);
  // λ 오름차순 = 축 길이 내림차순 (축 ∝ 1/√λ)
  const idx = [0, 1, 2].sort((a, b) => values[a] - values[b]);
  const axes = idx.map((i) => sigma / Math.sqrt(Math.max(values[i], 1e-300)));
  const dirs = idx.map((i) => vectors.map((row) => row[i]));
  const lam = idx.map((i) => values[i]);
  return { axes, dirs, kappa: lam[2] / lam[0], ratio: Math.sqrt(lam[2] / lam[0]) };
}

/** 광선 두 개의 사잇각 (라디안). 작아지면 κ 가 커진다 — 베이스라인의 효과. */
export function rayAngle(cam1, cam2, x1, x2) {
  const { d: d1 } = rayFromImage(cam1, x1);
  const { d: d2 } = rayFromImage(cam2, x2);
  return Math.acos(Math.max(-1, Math.min(1, dot(d1, d2))));
}

// ---------- E → R,t (한 절 분량) ----------

/**
 * Essential 행렬을 상대 자세 네 겹으로 분해한다.
 *
 * 🔑 왜 정확히 4개인가: 2(twisted pair) × 2(±t) 다. Ra 와 Rb 는 베이스라인 축
 * 기준 **180° 회전**만큼 다르고, t 는 부호를 알 수 없다 (E 가 스케일 자유라서).
 *
 * ⚠️ ‖t‖ = 1 로만 나온다 — **복원된 3D 는 스케일이 미지다.** 참 베이스라인이 4 m
 * 인 배치에서 분해는 1 을 준다 (스펙 §2-12).
 *
 * ⚠️ det(U), det(V) 가 −1 이면 반사가 섞여 회전이 아니게 된다. 마지막 열의 부호를
 * 뒤집어 det = +1 로 맞춘다. 그 이유(회전이 SO(3) 의 원소라는 것)는 9편 몫이다.
 *
 * → { S, candidates: [{ label, R, t }] }
 */
export function decomposeEssential(E) {
  const { U, S, V } = svd3(E);
  const fix = (M) => (det3(M) < 0
    ? M.map((row) => row.map((v, j) => (j === 2 ? -v : v)))
    : M);
  const Uf = fix(U), Vf = fix(V);
  const W = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];
  const Ra = matMul(matMul(Uf, W), transpose(Vf));
  const Rb = matMul(matMul(Uf, transpose(W)), transpose(Vf));
  const u3 = [Uf[0][2], Uf[1][2], Uf[2][2]];
  return {
    S,
    candidates: [
      { label: 'Rₐ, +t', R: Ra, t: u3 },
      { label: 'Rₐ, −t', R: Ra, t: scale(u3, -1) },
      { label: 'R_b, +t', R: Rb, t: u3 },
      { label: 'R_b, −t', R: Rb, t: scale(u3, -1) },
    ],
  };
}

/**
 * cheirality — 네 후보 중 점을 **두 카메라 앞**에 두는 것을 고른다.
 * 정확히 하나가 전부 통과한다 (스펙 §2-12: 5/5 대 0/5).
 *
 * cam1 은 정규화 좌표계 원점이라고 본다. pairs 는 [[x1, x2], ...] 화소 대응.
 *
 * → { best, counts } — counts[i] 가 후보 i 의 통과 개수
 */
export function chooseByCheirality(cam1, candidates, pairs) {
  const counts = candidates.map(({ R, t }) => {
    const cam2 = { K: cam1.K, R, t };
    let n = 0;
    for (const [x1, x2] of pairs) {
      const d = triangulateDLT(cam1, cam2, x1, x2);
      if (!d) continue;
      if (depthOf(cam1, d.X) > 0 && depthOf(cam2, d.X) > 0) n++;
    }
    return n;
  });
  let k = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[k]) k = i;
  return { best: candidates[k], bestIndex: k, counts };
}

// ---------- 결정론적 잡음 (데모·테스트 공용) ----------

/** mulberry32. 시드가 같으면 브라우저와 Node 가 같은 수열을 낸다. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller. 표준정규 하나. */
export function gaussian(rand) {
  const u = Math.max(rand(), 1e-12), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
