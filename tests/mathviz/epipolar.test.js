import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lookAt, intrinsics, projectPoint, cameraCenter, matMul, matVec, transpose, dot,
} from '../../static/js/mathviz/camera.js';
import {
  jacobiEig, smallestEigVec, svd3, skew, relativePose,
  essentialFromCameras, fundamentalFromCameras, epipoles,
  epipolarLineInSecond, epipolarLineInFirst, pointLineDistance,
  normalizeMatrix, frobenius, matDiffUpToScale,
} from '../../static/js/mathviz/epipolar.js';

const TOL = 1e-9;
const close = (a, b, tol = TOL, msg) => assert.ok(
  Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a} (허용 ${tol})`,
);
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// 스펙 §2 기준 설정 — 6편의 K 를 그대로 쓴다
const K = intrinsics({ f: 500, cx: 240, cy: 240 });
const UP = [0, 0, 1];
const TARGET = [0, 0, 0.8];
/** 좌우 스테레오 — 베이스라인 4 m, 에피폴이 화면 밖 */
const STEREO = () => [
  { K, ...lookAt({ eye: [-2, -6, 1.6], target: TARGET, up: UP }) },
  { K, ...lookAt({ eye: [2, -6, 1.6], target: TARGET, up: UP }) },
];
/** 전진 + 약간 좌우 — 데모 기본값, 에피폴 둘 다 화면 안 (스펙 §2-4) */
const FORWARD = () => [
  { K, ...lookAt({ eye: [-0.5, -8, 1.6], target: TARGET, up: UP }) },
  { K, ...lookAt({ eye: [0.5, -4, 1.6], target: TARGET, up: UP }) },
];
const PTS = [
  [0, 0, 0], [0.5, 0.5, 1], [-0.5, -0.5, 0], [3, 2, 0], [-3, 4, 0],
  [1, -1, 0.5], [2, 5, 1.5], [-2, 1, 2], [0.3, 0.7, 0], [4, -1, 0.2],
];
const correspond = (c1, c2, pts = PTS) => pts.map((X) => {
  const a = projectPoint(c1, X), b = projectPoint(c2, X);
  return [[a.u, a.v], [b.u, b.v]];
});

test('jacobiEig: 대칭행렬을 재구성한다 (V diag(λ) Vᵀ = A)', () => {
  const A = [[4, 1, -2], [1, 3, 0.5], [-2, 0.5, 6]];
  const { values, vectors } = jacobiEig(A);
  const D = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? values[i] : 0)));
  const back = matMul(vectors, matMul(D, transpose(vectors)));
  back.forEach((row, i) => row.forEach((v, j) => close(v, A[i][j], 1e-10, `[${i}][${j}]`)));
  // 고유벡터는 정규직교여야 한다
  const P = matMul(transpose(vectors), vectors);
  P.forEach((row, i) => row.forEach((v, j) => close(v, I3[i][j], 1e-10, `직교 [${i}][${j}]`)));
});

test('jacobiEig: 9×9 에서도 돈다 (8점 알고리즘이 이 크기를 쓴다)', () => {
  // 무작위 대신 재현 가능한 대칭행렬을 만든다
  const B = Array.from({ length: 9 }, (_, i) => (
    Array.from({ length: 9 }, (_, j) => Math.sin(i * 3 + j * 7) + (i === j ? 5 : 0))
  ));
  const A = B.map((row, i) => row.map((v, j) => (v + B[j][i]) / 2));
  const { values, vectors } = jacobiEig(A);
  assert.equal(values.length, 9);
  const D = values.map((l, i) => values.map((_, j) => (i === j ? l : 0)));
  const back = matMul(vectors, matMul(D, transpose(vectors)));
  back.forEach((row, i) => row.forEach((v, j) => close(v, A[i][j], 1e-9, `[${i}][${j}]`)));
});

test('smallestEigVec: AᵀA 의 널공간을 찾는다', () => {
  // 알려진 널공간을 가진 A: 세 번째 열이 앞 두 열의 합
  const A = [[1, 2, 3], [0, 1, 1], [2, 1, 3], [1, 1, 2]];
  const AtA = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (
    A.reduce((s, r) => s + r[i] * r[j], 0)
  )));
  const v = smallestEigVec(AtA);
  // A·v ≈ 0
  for (const row of A) close(dot(row, v), 0, 1e-9, 'A·v');
});

test('svd3: U diag(S) Vᵀ 가 원본을 재구성하고 S 가 내림차순이다', () => {
  const M = [[3, 1, 0.5], [-1, 2, 1], [0.5, 0, 1.5]];
  const { U, S, V } = svd3(M);
  assert.ok(S[0] >= S[1] && S[1] >= S[2], `내림차순이어야 한다: ${S}`);
  const D = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? S[i] : 0)));
  const back = matMul(U, matMul(D, transpose(V)));
  back.forEach((row, i) => row.forEach((v, j) => close(v, M[i][j], 1e-9, `[${i}][${j}]`)));
});

test('skew: [t]ₓ v = t × v 이고 [t]ₓ t = 0', () => {
  const t = [1, -2, 3], v = [0.5, 1, -1];
  const viaSkew = matVec(skew(t), v);
  const viaCross = [
    t[1] * v[2] - t[2] * v[1], t[2] * v[0] - t[0] * v[2], t[0] * v[1] - t[1] * v[0],
  ];
  viaSkew.forEach((x, i) => close(x, viaCross[i], TOL, `성분 ${i}`));
  matVec(skew(t), t).forEach((x, i) => close(x, 0, TOL, `[t]ₓt 성분 ${i}`));
});

test('relativePose: X₂ = R X₁ + t 가 실제 카메라 좌표를 맞춘다', () => {
  const [c1, c2] = STEREO();
  const { R, t } = relativePose(c1, c2);
  for (const X of PTS) {
    const X1 = matVec(c1.R, X).map((v, i) => v + c1.t[i]);
    const X2 = matVec(c2.R, X).map((v, i) => v + c2.t[i]);
    const pred = matVec(R, X1).map((v, i) => v + t[i]);
    pred.forEach((v, i) => close(v, X2[i], 1e-9, `점 ${X} 성분 ${i}`));
  }
});

test('🔑 에피폴라 제약 x₂ᵀ F x₁ = 0 (스펙 §2-1)', () => {
  const [c1, c2] = STEREO();
  const F = fundamentalFromCameras(c1, c2);
  let worst = 0;
  for (const [x1, x2] of correspond(c1, c2)) {
    worst = Math.max(worst, Math.abs(dot([...x2, 1], matVec(F, [...x1, 1]))));
  }
  assert.ok(worst < 1e-12, `최대 잔차 ${worst.toExponential(3)} (실측 4.441e-16)`);

  // 전진 배치에서도 같다
  const [f1, f2] = FORWARD();
  const Ff = fundamentalFromCameras(f1, f2);
  for (const [x1, x2] of correspond(f1, f2)) {
    close(dot([...x2, 1], matVec(Ff, [...x1, 1])), 0, 1e-12, '전진 배치');
  }
});

test('🔑 F 는 rank 2 다 — det = 0, σ3 = 0 (스펙 §2-2)', () => {
  for (const [c1, c2] of [STEREO(), FORWARD()].map((p) => p)) {
    const F = fundamentalFromCameras(c1, c2);
    const { S } = svd3(F);
    assert.ok(S[0] > 0, 'σ1 > 0');
    assert.ok(S[1] > 0, 'σ2 > 0 — rank 1 이 아니다');
    close(S[2] / S[0], 0, 1e-12, 'σ3/σ1');
  }
  // 스테레오 배치의 실측 특이값 (스펙 §2-2)
  const F = fundamentalFromCameras(...STEREO());
  const { S } = svd3(normalizeMatrix(F));
  close(S[1] / S[0], 3.14e-4, 1e-6, 'σ2/σ1 실측');
});

test('🔑 에피폴은 다른 카메라의 이미지다 — 6편 매듭 (스펙 §2-3)', () => {
  const [c1, c2] = STEREO();
  const F = fundamentalFromCameras(c1, c2);
  const { e1, e2 } = epipoles(F);

  // e1 은 카메라 2 의 광심을 카메라 1 에 투영한 것
  const p1 = projectPoint(c1, cameraCenter(c2));
  const p2 = projectPoint(c2, cameraCenter(c1));
  assert.equal(e1.atInfinity, false);
  assert.equal(e2.atInfinity, false);
  close(e1.u, p1.u, 1e-6, 'e1.u');
  close(e1.v, p1.v, 1e-6, 'e1.v');
  close(e2.u, p2.u, 1e-6, 'e2.u');
  close(e2.v, p2.v, 1e-6, 'e2.v');

  // 스펙 §2-3 의 실측값
  close(e1.u, 1751.9524, 1e-3, 'e1 실측 u');
  close(e1.v, 176.7544, 1e-3, 'e1 실측 v');
  close(e2.u, -1271.9524, 1e-3, 'e2 실측 u');
  close(e2.v, 176.7544, 1e-3, 'e2 실측 v');
});

test('에피폴라 직선은 전부 에피폴을 지난다 (스펙 §2-3)', () => {
  const [c1, c2] = STEREO();
  const F = fundamentalFromCameras(c1, c2);
  const { e1, e2 } = epipoles(F);
  let worst = 0;
  for (const [x1, x2] of correspond(c1, c2)) {
    worst = Math.max(
      worst,
      pointLineDistance(epipolarLineInSecond(F, x1), [e2.u, e2.v]),
      pointLineDistance(epipolarLineInFirst(F, x2), [e1.u, e1.v]),
    );
  }
  assert.ok(worst < 1e-6, `에피폴에서 벗어난 최대 거리 ${worst.toExponential(2)} px (실측 1.01e-9)`);
});

test('🔑 배치가 에피폴을 화면 안에 넣는다 — 데모 기본값 근거 (스펙 §2-4)', () => {
  const SIZE = 480;
  const inImage = (e) => !e.atInfinity && e.u >= 0 && e.u <= SIZE && e.v >= 0 && e.v <= SIZE;

  // 좌우 스테레오는 둘 다 화면 밖
  const s = epipoles(fundamentalFromCameras(...STEREO()));
  assert.equal(inImage(s.e1), false, '스테레오 e1 은 화면 밖이어야 한다');
  assert.equal(inImage(s.e2), false, '스테레오 e2 은 화면 밖이어야 한다');

  // 전진 + 약간 좌우는 둘 다 화면 안 — 그래서 이걸 기본값으로 쓴다
  const f = epipoles(fundamentalFromCameras(...FORWARD()));
  assert.ok(inImage(f.e1), `전진 e1 이 화면 안이어야 한다: (${f.e1.u}, ${f.e1.v})`);
  assert.ok(inImage(f.e2), `전진 e2 이 화면 안이어야 한다: (${f.e2.u}, ${f.e2.v})`);
  close(f.e1.u, 333, 1, '전진 e1 실측 u');
  close(f.e1.v, 190, 1, '전진 e1 실측 v');
  close(f.e2.u, 437, 1, '전진 e2 실측 u');
  close(f.e2.v, 141, 1, '전진 e2 실측 v');
});

test('E 와 F 의 관계, 그리고 스케일 무관 비교', () => {
  const [c1, c2] = STEREO();
  const E = essentialFromCameras(c1, c2);
  const F = fundamentalFromCameras(c1, c2);
  // E 도 rank 2
  close(svd3(E).S[2] / svd3(E).S[0], 0, 1e-12, 'E 의 σ3/σ1');
  // 스케일을 곱해도 같은 행렬로 취급된다
  const scaled = F.map((row) => row.map((v) => v * -7.3));
  close(matDiffUpToScale(F, scaled), 0, 1e-12, 'cF 는 F 와 같다');
  close(frobenius(normalizeMatrix(F)), 1, TOL, 'Frobenius 정규화');
  // 다른 행렬은 0 이 아니다 — 지표가 무의미하지 않은지 확인
  assert.ok(matDiffUpToScale(F, E) > 1e-3, 'F 와 E 는 다른 행렬이다');
});

// ---------- 8점 알고리즘 ----------

import {
  fundamentalFromPairs, conditionNumber, normalizingTransform,
  eightPointMatrix, symmetricEpipolarDistance,
} from '../../static/js/mathviz/epipolar.js';

/** 시드 난수 — Math.random 을 쓰지 않는다 (5편부터의 규약). */
function makeNoise(seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  return () => {
    const u = 1 - rnd(), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}
const jitter = (pairs, sigma, g) => pairs.map(([a, b]) => [
  [a[0] + g() * sigma, a[1] + g() * sigma],
  [b[0] + g() * sigma, b[1] + g() * sigma],
]);
/** 잡음 대응 8개로 F 를 풀고, 깨끗한 대응 전부로 기하 오차를 잰다. */
function meanGeoErr(corr, sigma, normalized, runs = 30, seed = 7) {
  const g = makeNoise(seed);
  let sum = 0;
  for (let k = 0; k < runs; k++) {
    const F = fundamentalFromPairs(jitter(corr.slice(0, 8), sigma, g), { normalized });
    sum += symmetricEpipolarDistance(F, corr);
  }
  return sum / runs;
}

test('🔑 8점 알고리즘 = SVD 최소 특이벡터 — 2편 매듭 (스펙 §2-5)', () => {
  const [c1, c2] = FORWARD();
  const Ftrue = fundamentalFromCameras(c1, c2);
  const corr = correspond(c1, c2);
  for (const normalized of [true, false]) {
    const Fhat = fundamentalFromPairs(corr.slice(0, 8), { normalized });
    const d = matDiffUpToScale(Fhat, Ftrue);
    assert.ok(d < 1e-10, `${normalized ? '정규화 O' : '정규화 X'} 오차 ${d.toExponential(3)}`);
  }
  // 대응 8개가 A 의 행 8개를 만든다 — 자유도 8 과 같다
  assert.equal(eightPointMatrix(corr.slice(0, 8)).length, 8);
  assert.equal(eightPointMatrix(corr.slice(0, 8))[0].length, 9);
});

test('🔑 정규화가 고치는 것은 조건수다 (스펙 §2-6)', () => {
  const [c1, c2] = FORWARD();
  const eight = correspond(c1, c2).slice(0, 8);
  const T1 = normalizingTransform(eight.map((q) => q[0]));
  const T2 = normalizingTransform(eight.map((q) => q[1]));
  const ap = (T, [u, v]) => {
    const r = matVec(T, [u, v, 1]); return [r[0] / r[2], r[1] / r[2]];
  };
  const eightN = eight.map(([a, b]) => [ap(T1, a), ap(T2, b)]);

  const raw = conditionNumber(eight), nrm = conditionNumber(eightN);
  close(raw, 1.322e5, 1e4, 'cond(A) 정규화 X 실측');
  close(nrm, 5.708e1, 5, 'cond(A) 정규화 O 실측');
  assert.ok(raw / nrm > 1000, `개선 배율 ${(raw / nrm).toExponential(2)} (실측 2320배)`);

  // 정규화된 점들은 무게중심이 원점, 평균거리가 √2
  const cx = eightN.reduce((s, q) => s + q[0][0], 0) / 8;
  const cy = eightN.reduce((s, q) => s + q[0][1], 0) / 8;
  close(cx, 0, 1e-9, '무게중심 x');
  close(cy, 0, 1e-9, '무게중심 y');
  const md = eightN.reduce((s, q) => s + Math.hypot(q[0][0], q[0][1]), 0) / 8;
  close(md, Math.SQRT2, 1e-9, '평균거리');
});

test('🚨 정규화의 정확도 이득은 배치가 정한다 (스펙 §2-7)', () => {
  // 교과서는 "무조건 정규화" 로 뭉갠다. 실측하면 배치에 따라 1.2배에서 5배까지 다르다.
  const fw = correspond(...FORWARD());
  const st = correspond(...STEREO());

  const fwN = meanGeoErr(fw, 0.5, true), fwU = meanGeoErr(fw, 0.5, false);
  const stN = meanGeoErr(st, 0.5, true), stU = meanGeoErr(st, 0.5, false);
  const fwRatio = fwU / fwN, stRatio = stU / stN;

  assert.ok(fwRatio > 1.05 && fwRatio < 1.6,
    `전진 배치 배율 ${fwRatio.toFixed(2)}× (실측 1.20×)`);
  assert.ok(stRatio > 3 && stRatio < 8,
    `좌우 스테레오 배율 ${stRatio.toFixed(2)}× (실측 5.22×)`);
  assert.ok(stRatio > fwRatio * 2,
    `스테레오 이득이 전진보다 훨씬 커야 한다 (${stRatio.toFixed(2)} vs ${fwRatio.toFixed(2)})`);

  // 정규화한 쪽은 두 배치에서 비슷하게 좋다 — 나빠지는 건 정규화 안 한 쪽이다
  assert.ok(stN < fwN * 2, `정규화하면 배치에 덜 민감하다 (${stN.toFixed(3)} vs ${fwN.toFixed(3)})`);
  assert.ok(stU > fwU * 3, `정규화를 끄면 스테레오가 크게 나빠진다 (${stU.toFixed(3)} vs ${fwU.toFixed(3)})`);
});

test('🚨 rank 2 강제는 정확도를 개선하지 않는다 — 실측 (스펙 §2-8)', () => {
  // 교과서는 rank 2 강제를 정확도 개선처럼 말한다. 실측하면 아니다.
  // 모든 잡음 수준·두 배치에서 강제하지 않은 쪽이 **같거나 약간 낫다.**
  // 강제하는 이유는 정확도가 아니라 유효한 F 의 정의(det F = 0)이고,
  // E 에서 R,t 를 분해하는 8편이 그것을 요구하기 때문이다.
  const corr = correspond(...FORWARD());
  const g = makeNoise(7);
  const noisy = jitter(corr.slice(0, 8), 0.5, g);

  const withR2 = fundamentalFromPairs(noisy, { enforceRank2: true });
  const without = fundamentalFromPairs(noisy, { enforceRank2: false });

  // 강제하면 σ3 가 1000배쯤 작아진다 — 그 일은 확실히 한다
  const rOn = svd3(withR2).S[2] / svd3(withR2).S[0];
  const rOff = svd3(without).S[2] / svd3(without).S[0];
  assert.ok(rOn < 1e-9, `강제하면 σ3/σ1 가 작다 (${rOn.toExponential(2)}, 실측 3.3e-11)`);
  assert.ok(rOff > rOn * 100, `강제 안 하면 훨씬 크다 (${rOff.toExponential(2)}, 실측 1.7e-8)`);

  // ⚠️ 그런데 σ3 를 0 으로 눌러도 정확히 0 이 되지는 않는다 — 정규화 좌표계에서
  // 누른 뒤 F = T₂ᵀ F T₁ 로 되돌리면 부동소수 오차가 6e-11 쯤 남는다. 버그가 아니다.
  assert.ok(rOn > 0, 'σ3 가 정확히 0 은 아니다 (역정규화의 부동소수 오차)');

  // 🚨 정확도는 개선되지 않는다. 강제한 쪽이 더 낫다고 단정하면 실측과 어긋난다.
  const eTrue = epipoles(fundamentalFromCameras(...FORWARD()));
  const dist = (F) => {
    const e = epipoles(F);
    return Math.hypot(e.e1.u - eTrue.e1.u, e.e1.v - eTrue.e1.v);
  };
  assert.ok(dist(without) <= dist(withR2) * 1.1,
    `강제 안 한 쪽이 같거나 낫다 (강제 ${dist(withR2).toFixed(2)} vs 미강제 ${dist(without).toFixed(2)} px)`);
  assert.ok(symmetricEpipolarDistance(without, corr) <= symmetricEpipolarDistance(withR2, corr) * 1.1,
    '기하 오차도 강제 안 한 쪽이 같거나 낫다');
});

test('🚨 에피폴이 화면 밖이면 위치 추정이 불안정하다 (스펙 §2-9)', () => {
  // 데모 기본값을 전진 배치로 두는 두 번째 이유. 같은 잡음 0.5px 에서
  // 전진(에피폴 화면 안)은 오차 6.5px, 스테레오(에피폴 u=1752)는 수천 px 다.
  const est = (cams, seed) => {
    const [c1, c2] = cams;
    const corr = correspond(c1, c2);
    const eTrue = epipoles(fundamentalFromCameras(c1, c2));
    const g = makeNoise(seed);
    let sum = 0;
    const R = 20;
    for (let k = 0; k < R; k++) {
      const e = epipoles(fundamentalFromPairs(jitter(corr.slice(0, 8), 0.5, g)));
      sum += Math.hypot(e.e1.u - eTrue.e1.u, e.e1.v - eTrue.e1.v);
    }
    return sum / R;
  };
  const fw = est(FORWARD(), 7);
  const st = est(STEREO(), 7);
  assert.ok(fw < 40, `전진 배치는 안정적이다 (${fw.toFixed(1)} px, 실측 6.5)`);
  assert.ok(st > fw * 20, `스테레오는 훨씬 불안정하다 (${st.toFixed(0)} px vs ${fw.toFixed(1)} px)`);
});
