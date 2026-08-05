// 회전군 SO(3). DOM 접근 없음 — 브라우저와 Node 양쪽에서 돈다.
//
// 6\~8편 규약을 그대로 쓴다 (camera.js): 3-벡터는 [x,y,z], 행렬은 중첩 배열 행 우선.
//
// 🔑 이 글의 축: **짐벌락은 버그가 아니라 대가고, 좌표계를 바꾸면 자리를 옮긴다.**
// - 오일러 ZYX 는 **순방향**에서 치른다: κ = √((1+sin p)/(1−sin p)) → ∞  (eulerKappa)
// - 회전벡터는 순방향이 멀쩡하다: κ = θ/(2 sin(θ/2)) ≤ π/2  (expKappa)
//   대신 **역방향**에서 치른다: logSO3 가 θ=π 에서 무너진다 (logSO3Safe 가 필요한 이유)
//
// ⚠️ 오일러 규약은 **ZYX (yaw-pitch-roll) 하나만** 쓴다. 12가지가 있고 짐벌락 위치가
// 다르다. R = Rz(yaw)·Ry(pitch)·Rx(roll) 이고 짐벌락은 pitch = ±90° 다. 스펙 §3-2

import {
  add, sub, scale, dot, norm, normalize, matVec, transpose, matMul, det3,
  rotX, rotY, rotZ,
} from './camera.js';
import { svd3, skew, frobenius } from './epipolar.js';

export const I3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// ---------- 행렬 잡동사니 ----------

export const madd = (A, B) => A.map((row, i) => row.map((v, j) => v + B[i][j]));
export const msub = (A, B) => A.map((row, i) => row.map((v, j) => v - B[i][j]));
export const mscale = (A, s) => A.map((row) => row.map((v) => v * s));
export const trace = (A) => A[0][0] + A[1][1] + A[2][2];

/** 직교 이탈 ‖RᵀR − I‖_F. 회전이면 0 이다. */
export const orthError = (R) => frobenius(msub(matMul(transpose(R), R), I3()));

/**
 * 두 회전 사이의 각 (라디안). tr(ABᵀ) = 1 + 2cos θ
 *
 * ⚠️ **두 회전이 거의 같을 때는 이 지표를 믿지 말 것.** `acos` 의 도함수가 인자 ±1
 * 에서 발산하므로 δθ ≈ √(2·δc) 로 증폭된다. δc \~ 2.2e-16 이면 **δθ \~ 1.2e-6°** 이고,
 * 실측 왕복 오차 최대 2.4e-6° 가 정확히 그 바닥이다. 즉 이 함수의 분해능이
 * **1e-6° 수준**이고 그 아래를 재려면 matDistance 를 써야 한다 (Frobenius 는 1e-15).
 * 스펙 §3-11
 */
export function angleBetween(A, B) {
  const c = (trace(matMul(A, transpose(B))) - 1) / 2;
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

/**
 * 두 행렬의 Frobenius 거리. **왕복·항등 검사는 이것으로 한다** — angleBetween 과 달리
 * acos 증폭이 없어 1e-15 까지 분해한다.
 */
export const matDistance = (A, B) => frobenius(msub(A, B));

/** so(3) → R³. skew 의 역. */
export const vee = (S) => [
  (S[2][1] - S[1][2]) / 2, (S[0][2] - S[2][0]) / 2, (S[1][0] - S[0][1]) / 2,
];

// ---------- 오일러 ZYX ----------

/** [yaw, pitch, roll] → R = Rz·Ry·Rx */
export const eulerToR = ([yaw, pitch, roll]) => matMul(
  rotZ(yaw), matMul(rotY(pitch), rotX(roll)),
);

/**
 * R → [yaw, pitch, roll]. **pitch ∈ (−90°, 90°) 를 가정한다.**
 * pitch = ±90° 에서는 yaw 와 roll 이 분리되지 않아 정의되지 않는다 — 그것이 짐벌락이다.
 */
export function rToEuler(R) {
  const pitch = Math.asin(Math.max(-1, Math.min(1, -R[2][0])));
  return [Math.atan2(R[1][0], R[0][0]), pitch, Math.atan2(R[2][1], R[2][2])];
}

/**
 * 🔑 오일러 좌표계의 조건수 — **닫힌형**.
 *
 * 공간 야코비안 J (ω = J·θ̇) 의 세 열은 단위벡터 e_z, Rz·e_y, Rz·Ry·e_x 이고,
 * 두 번째가 나머지 둘과 직교한다. Gram 행렬의 고윳값이 1, 1±sin p 이므로
 *
 *   σ(J) = 1, √(1+sin p), √(1−sin p)      κ = √((1+sin p)/(1−sin p))      det J = cos p
 *
 * 점근형은 **2/cos p** 다 — 1−sin p ≈ cos²p/2 이므로. ⚠️ 계수 2 를 빠뜨리지 말 것
 * (스펙 §3-3: 초안이 1/cos p 로 예측해 실측 비가 정확히 2.000 이었다).
 */
export function eulerKappa(pitch) {
  const s = Math.abs(Math.sin(pitch));
  if (1 - s <= 0) return Infinity;
  return Math.sqrt((1 + s) / (1 - s));
}
/** 오일러 야코비안의 행렬식 = cos(pitch). 0 이 되는 곳이 짐벌락이다. */
export const eulerJacDet = (pitch) => Math.cos(pitch);

/**
 * 오일러 공간 야코비안을 실제로 세운다 (닫힌형 검증용, 그리고 데모 readout).
 * 열 = vee(∂R/∂θᵢ · Rᵀ), 수치미분.
 */
export function eulerJacobian(ang, h = 1e-6) {
  const R = eulerToR(ang);
  const cols = [0, 1, 2].map((i) => {
    const ap = [...ang], am = [...ang];
    ap[i] += h; am[i] -= h;
    const dR = mscale(msub(eulerToR(ap), eulerToR(am)), 1 / (2 * h));
    return vee(matMul(dR, transpose(R)));
  });
  return [0, 1, 2].map((r) => cols.map((c) => c[r]));
}

/**
 * 자유도 상실 지표. pitch=±90° 에서 yaw 를 d 만큼 늘린 것과 roll 을 d 만큼 줄인 것이
 * **같은 회전**이 된다 — 실측 정확히 0.000e+0° (스펙 §2-3).
 * → 두 회전 사이의 각 (라디안). 0 이면 자유도를 잃었다.
 */
export function dofCollapse([yaw, pitch, roll], d = 0.1) {
  return angleBetween(
    eulerToR([yaw + d, pitch, roll]),
    eulerToR([yaw, pitch, roll - d]),
  );
}

// ---------- 지수사상 / 로그 ----------

/** 로드리게스. 회전벡터 w (축×각) → R. */
export function expSO3(w) {
  const th = norm(w);
  if (th < 1e-12) return I3();
  const K = skew(scale(w, 1 / th));
  return madd(
    madd(I3(), mscale(K, Math.sin(th))),
    mscale(matMul(K, K), 1 - Math.cos(th)),
  );
}

/**
 * 🔑 지수사상의 조건수 — **닫힌형**. κ = θ / (2 sin(θ/2)).
 *
 * σ(J) = 1 과 2sin(θ/2)/θ (중복) 이므로 det J = (2 sin(θ/2)/θ)².
 * **θ=π 에서 κ = π/2 = 1.5708 로 유계다** — 즉 회전벡터에는 짐벌락이 없다.
 * 오일러의 1.146e+4(pitch 89.99°)와 대비되는 이 글의 핵심 수치다. 스펙 §2-4
 */
export function expKappa(theta) {
  const t = Math.abs(theta);
  if (t < 1e-9) return 1;
  return t / (2 * Math.sin(t / 2));
}
export const expJacDet = (theta) => {
  const t = Math.abs(theta);
  if (t < 1e-9) return 1;
  return ((2 * Math.sin(t / 2)) / t) ** 2;
};

/**
 * 순진한 log — 반대칭부를 2sin θ 로 나눈다. **θ=π 에서 무너진다.**
 *
 * ⚠️ 실측: 179.999° 에서 θ 오차 5.84e-6, **180° 에서 θ 오차 11.5 rad · 축 오차 5.49°**.
 * 그리고 축 오차는 179.999° 까지 0.0000° 다 — **θ 만 틀리므로 "회전이 조금 작게
 * 나오는" 형태로 조용히 나타난다** (스펙 §3-5). 글에서 대조군으로만 쓴다.
 */
export function logSO3Naive(R) {
  const th = Math.acos(Math.max(-1, Math.min(1, (trace(R) - 1) / 2)));
  if (th < 1e-8) return [0, 0, 0];
  const v = [R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]];
  return scale(v, th / (2 * Math.sin(th)));
}

/**
 * 안전한 log. θ→π 에서 (R+I)/2 = aaᵀ 로 축을 뽑는다 — sin θ 로 나누지 않는다.
 * 실측 180° 에서 오차 0. 이것이 회전벡터가 치르는 대가의 정체다.
 */
export function logSO3(R) {
  const th = Math.acos(Math.max(-1, Math.min(1, (trace(R) - 1) / 2)));
  if (th < 1e-8) return [0, 0, 0];
  if (Math.PI - th > 1e-4) {
    const v = [R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]];
    return scale(v, th / (2 * Math.sin(th)));
  }
  const A = mscale(madd(R, I3()), 0.5);      // = aaᵀ
  let k = 0;
  for (let i = 1; i < 3; i++) if (A[i][i] > A[k][k]) k = i;
  return scale(normalize([A[0][k], A[1][k], A[2][k]]), th);
}

// ---------- Procrustes: 가장 가까운 회전 ----------

/**
 * 🔑 임의 행렬에서 가장 가까운 회전. 2편의 SVD 를 **네 번째로** 쓴다
 * (2편 최대방향 2×2 → 7편 최소 9×9 → 8편 최소 4×4 → 9편 직교화 3×3).
 *
 * M = UΣVᵀ 에서 R = U·diag(1,1,det(UVᵀ))·Vᵀ.
 * ⚠️ **마지막 부호를 고치지 않으면 det = −1 인 반사가 나온다** — 8편이 E 를 분해할 때
 * 손으로 고쳤던 그것이다. det=±1 은 O(3) 의 두 연결성분이고 연속으로 못 건넌다
 * (스펙 §2-7: 선형보간하면 t=0.5 에서 det=0 을 지난다).
 */
export function nearestRotation(M) {
  const { U, V } = svd3(M);
  const d = det3(matMul(U, transpose(V)));
  const Sig = [[1, 0, 0], [0, 1, 0], [0, 0, d < 0 ? -1 : 1]];
  return matMul(U, matMul(Sig, transpose(V)));
}

/**
 * 회전들의 평균. mode 로 방법을 고른다.
 * - `'raw'`   산술평균 — **회전이 아니다.** σ=15° 에서 det 0.857 (스펙 §2-2)
 * - `'proj'`  산술평균을 SVD 로 투영 — σ ≤ 15° 에서 Karcher 와 사실상 같다
 * - `'karcher'` 접공간 평균 반복
 *
 * ⚠️ "Karcher 를 써야 한다" 고 쓰지 말 것. 실측에서 투영이 σ ≤ 15° 에서 Karcher 와
 * 같고 σ=90° 에서는 **더 낫다**. 문제는 투영하지 않은 행렬을 쓰는 것이다 (스펙 §3-4).
 */
export function meanRotation(Rs, mode = 'proj', { iters = 50, tol = 1e-14 } = {}) {
  if (!Rs.length) return null;
  if (mode === 'karcher') {
    let K = Rs[0];
    for (let it = 0; it < iters; it++) {
      let w = [0, 0, 0];
      for (const R of Rs) w = add(w, logSO3(matMul(R, transpose(K))));
      w = scale(w, 1 / Rs.length);
      K = matMul(expSO3(w), K);
      if (norm(w) < tol) break;
    }
    return K;
  }
  let A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const R of Rs) A = madd(A, R);
  A = mscale(A, 1 / Rs.length);
  return mode === 'raw' ? A : nearestRotation(A);
}

// ---------- 쿼터니언 ----------

/** R → [w,x,y,z]. 대각합이 음수인 경우를 나눠 처리한다 (수치 안정). */
export function quatFromR(R) {
  const t = trace(R);
  let q;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    q = [s / 4, (R[2][1] - R[1][2]) / s, (R[0][2] - R[2][0]) / s, (R[1][0] - R[0][1]) / s];
  } else if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) {
    const s = Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]) * 2;
    q = [(R[2][1] - R[1][2]) / s, s / 4, (R[0][1] + R[1][0]) / s, (R[0][2] + R[2][0]) / s];
  } else if (R[1][1] > R[2][2]) {
    const s = Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]) * 2;
    q = [(R[0][2] - R[2][0]) / s, (R[0][1] + R[1][0]) / s, s / 4, (R[1][2] + R[2][1]) / s];
  } else {
    const s = Math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]) * 2;
    q = [(R[1][0] - R[0][1]) / s, (R[0][2] + R[2][0]) / s, (R[1][2] + R[2][1]) / s, s / 4];
  }
  const n = Math.hypot(...q);
  return q.map((v) => v / n);
}

export function rFromQuat([w, x, y, z]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

/**
 * SLERP. `align` 이 이중덮개 처리다.
 *
 * ⚠️ q 와 −q 는 **같은 회전**이다 (각 차이 0.000000°). 부호를 맞추지 않으면 긴 길로
 * 간다 — Δ=90° 에서 **270°** (스펙 §2-6).
 */
export function slerp(q0, q1, t, { align = true } = {}) {
  let d = q0.reduce((s, v, i) => s + v * q1[i], 0);
  let q = [...q1];
  if (align && d < 0) { q = q1.map((v) => -v); d = -d; }
  d = Math.max(-1, Math.min(1, d));
  const th = Math.acos(d);
  if (th < 1e-9) {
    const lin = q0.map((v, i) => v + t * (q[i] - v));
    const n = Math.hypot(...lin);
    return lin.map((v) => v / n);
  }
  const s0 = Math.sin((1 - t) * th) / Math.sin(th);
  const s1 = Math.sin(t * th) / Math.sin(th);
  return q0.map((v, i) => s0 * v + s1 * q[i]);
}

// ---------- 보간 세 방법 ----------

/**
 * 🔑 R0 → R1 을 steps+1 개 자세로 잇는다. mode 별로 **다른 방식으로** 틀린다:
 *
 * - `'euler'`  오일러 각 선형보간 → **경로가 틀리다.** 총길이가 측지선을 초과한다
 *              (Δ=150° 에서 232° 대 150°)
 * - `'matrix'` 행렬 선형보간 + SVD 투영 → **경로는 맞고 속도가 틀리다.** 총길이는
 *              측지선과 정확히 같은데 균일성이 Δ=179° 에서 **700배**
 * - `'slerp'`  → 둘 다 맞다. 균일성 1.0000, 총길이 = 측지선
 *
 * 스펙 §2-6. ⚠️ 초안 가설("행렬투영이 다른 경로를 준다")은 틀렸다 — 경로는 같다.
 */
export function interpolate(R0, R1, steps, mode, { align = true } = {}) {
  const ts = Array.from({ length: steps + 1 }, (_, i) => i / steps);
  if (mode === 'euler') {
    const e0 = rToEuler(R0), e1 = rToEuler(R1);
    return ts.map((t) => eulerToR(e0.map((v, k) => v + t * (e1[k] - v))));
  }
  if (mode === 'matrix') {
    return ts.map((t) => nearestRotation(madd(mscale(R0, 1 - t), mscale(R1, t))));
  }
  const q0 = quatFromR(R0), q1 = quatFromR(R1);
  return ts.map((t) => rFromQuat(slerp(q0, q1, t, { align })));
}

/**
 * 경로 지표. **경로와 속도를 따로 봐야** 세 방법이 갈린다 (스펙 §3-6).
 * → { total, geodesic, excess, uniformity, steps }
 */
export function pathMetrics(path) {
  const steps = [];
  for (let i = 1; i < path.length; i++) steps.push(angleBetween(path[i - 1], path[i]));
  const total = steps.reduce((s, v) => s + v, 0);
  const geodesic = angleBetween(path[0], path[path.length - 1]);
  const mx = Math.max(...steps), mn = Math.min(...steps);
  return {
    total,
    geodesic,
    excess: total - geodesic,
    uniformity: mn > 0 ? mx / mn : Infinity,
    steps,
  };
}

// ---------- 결정론적 잡음 (8편과 같은 것) ----------

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
export function gaussian(rand) {
  const u = Math.max(rand(), 1e-12), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
/** 접공간에서 σ (라디안) 만큼 흩뜨린 회전. */
export const perturb = (R, sigma, rand) => matMul(
  expSO3([gaussian(rand), gaussian(rand), gaussian(rand)].map((v) => v * sigma)), R,
);
