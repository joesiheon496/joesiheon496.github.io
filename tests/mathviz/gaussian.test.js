// tests/mathviz/gaussian.test.js
// 10편 스펙 §2 의 실측표를 고정한다. 시드가 같으므로 값은 결정적이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  covFromParams, makeSampler, makeCorrSampler, sampleCov, axisAngleDeg,
  ellipsePoints, mahalanobis2, containment, dirVariance, projectDir,
  meanSd, conditionalParams, sliceValues, perspectiveStats, histogram, gaussPdf,
} from '../../static/js/mathviz/gaussian.js';
import {
  mulberry32, gaussPair, symEigVec2, rotatedHessian, makeComponents, sgdPath,
} from '../../static/js/mathviz/stochastic.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
const frob = (A, B) => Math.hypot(
  A[0][0] - B[0][0], A[0][1] - B[0][1], A[1][0] - B[1][0], A[1][1] - B[1][1],
);

// ------------------------------------------------- §2-A. 고유분해 왕복

test('§2-A: Σ(2, 0.5, 30°) 가 고유분해로 정확히 되돌아온다', () => {
  const S = covFromParams(2, 0.5, 30);
  near(S[0][0], 3.0625, 1e-12, 'Σ11');
  near(S[0][1], 1.6238, 5e-5, 'Σ12');
  const { l1, l2 } = symEigVec2(S);
  near(Math.sqrt(l1), 2, 1e-12, '√λ1');
  near(Math.sqrt(l2), 0.5, 1e-12, '√λ2');
  near(axisAngleDeg(S), 30, 1e-9, '주축 각');
});

test('ellipsePoints: kσ 타원 위의 점은 마할라노비스 거리가 정확히 k 다', () => {
  const S = covFromParams(2, 0.5, 30);
  for (const k of [1, 2, 3]) {
    for (const p of ellipsePoints(S, k, 16)) {
      near(Math.sqrt(mahalanobis2(S, [0, 0], p)), k, 1e-9, `k=${k}`);
    }
  }
});

// ------------------------------------------------- §2-B. 표본공분산 수렴

test('§2-B: 표본공분산 오차가 1/√N 로 준다 (N=10 대 N=1000, 시드 20개 평균)', () => {
  const S = covFromParams(2, 0.5, 30);
  const err = (N) => {
    let e = 0;
    for (let sd = 1; sd <= 20; sd++) {
      const gen = makeSampler(2, 0.5, 30, sd);
      const { cov } = sampleCov(Array.from({ length: N }, gen));
      e += frob(cov, S);
    }
    return e / 20;
  };
  near(err(10), 1.4270, 5e-4, 'N=10');     // 스펙 §2-B
  near(err(1000), 0.1755, 5e-4, 'N=1000');
});

// ------------------------------------------------- §2-C. kσ 포함률

test('§2-C: 2D 1σ 포함률은 39.36%, 68% 가 아니다 (1e6 표본, 시드 8)', () => {
  const gen = makeSampler(2, 0.5, 30, 8);
  const pts = Array.from({ length: 1e6 }, gen);
  const S = covFromParams(2, 0.5, 30);
  const [f1, f2, f3] = containment(S, [0, 0], pts);
  near(f1, 0.3936, 5e-5, 'k=1');           // 스펙 §2-C
  near(f2, 0.8641, 5e-5, 'k=2');
  near(f3, 0.9888, 5e-5, 'k=3');
  near(1 - Math.exp(-0.5), 0.3935, 5e-5, '닫힌형 k=1');
});

test('§2-C: 1D 는 68.21% (1e6 표본, 시드 7)', () => {
  const rnd = mulberry32(7);
  let c = 0;
  const N = 1e6;
  for (let i = 0; i < N / 2; i++) {
    for (const z of gaussPair(rnd)) if (Math.abs(z) <= 1) c++;
  }
  near(c / N, 0.6821, 5e-5, '1D k=1');
});

// ------------------------------------------------- §2-D. 선형변환

test('§2-D: cov(Az) = AAᵀ, 타원 반축 = A 의 특이값 (N=2e5, 시드 11)', () => {
  const A = [[1.5, 0.8], [0, 0.6]];
  const rnd = mulberry32(11);
  const pts = [];
  for (let i = 0; i < 2e5; i++) {
    const [z1, z2] = gaussPair(rnd);
    pts.push([A[0][0] * z1 + A[0][1] * z2, A[1][0] * z1 + A[1][1] * z2]);
  }
  const { cov } = sampleCov(pts);
  const AAt = [[2.89, 0.48], [0.48, 0.36]];
  near(frob(cov, AAt), 0.0029, 5e-4, '‖차‖F');   // 스펙 §2-D
  const { l1, l2 } = symEigVec2(cov);
  near(Math.sqrt(l1), 1.7251, 5e-4, '반축1');     // ↔ svd2x2(A).s1 = 1.7257
  near(Math.sqrt(l2), 0.5233, 5e-4, '반축2');
});

// ------------------------------------------------- §2-E. 조건부

test('§2-E: 조건 sd 실측이 √(1−ρ²) 와 붙는다 (ρ=0.9, w=0.1, N=2e6, 시드 21)', () => {
  const gen = makeCorrSampler(0.9, 21);
  const pts = Array.from({ length: 2e6 }, gen);
  const sel = sliceValues(pts, 1, 0.1);
  assert.equal(sel.length, 48086);               // 스펙 §2-E
  const { mean, sd } = meanSd(sel);
  near(sd, 0.4374, 5e-5, '조건 sd');
  near(mean, 0.8993, 5e-5, '조건 평균');
  near(conditionalParams(0.9, 1).sd0, 0.4359, 5e-5, '√(1−ρ²)');
  const { sd: margSd } = meanSd(pts.map((p) => p[0]));
  near(margSd, 1.0002, 5e-5, '주변 sd');
});

test('§2-E2: 슬라이스 폭이 조건 sd 를 부풀린다 (ρ=0.9, w=1, N=4e6, 시드 22)', () => {
  const gen = makeCorrSampler(0.9, 22);
  const pts = Array.from({ length: 4e6 }, gen);
  const { sd } = meanSd(sliceValues(pts, 1, 1));
  near(sd, 0.5019, 5e-5, '조건 sd (w=1)');       // 폭 0 이론 0.4359 대비 +15%
  near(conditionalParams(0.9, 1, 1).sdW, 0.5074, 5e-5, '폭 보정식');
  // w=2 에서는 균일-폭 보정이 과대예측한다 (실측 0.6276 < 보정 0.6782)
  const { sd: sd2 } = meanSd(sliceValues(pts, 1, 2));
  near(sd2, 0.6276, 5e-5, '조건 sd (w=2)');
  assert.ok(sd2 < conditionalParams(0.9, 1, 2).sdW, 'w=2 는 보정식보다 작아야 한다');
});

// ------------------------------------------------- §2-F. 원근 나눗셈

test('§2-F: 선형화가 σz/z0=0.1 까지 버티고 0.3 에서 터진다 (N=4e6, 시드 31)', () => {
  const base = { x0: 1, sx: 0.2, z0: 5, N: 4e6, seed: 31 };
  const r01 = perspectiveStats({ ...base, sz: 0.5 });
  near(r01.sd, 0.04564, 5e-6, 'sd (0.1)');       // 스펙 §2-F
  near(r01.sd / r01.linSd, 1.0205, 5e-4, '비 (0.1)');
  near(r01.skew, 0.291, 5e-4, '왜도 (0.1)');
  const r03 = perspectiveStats({ ...base, sz: 1.5 });
  near(r03.sd, 5.603, 5e-3, 'sd (0.3)');         // 시드 31 에서의 값 — 폭발의 기록
  assert.ok(r03.sd / r03.linSd > 50, '0.3 에서 선형화 대비 50배 이상');
  assert.ok(Math.abs(r03.skew) > 100, '0.3 에서 왜도 폭발');
});

// ------------------------------------------------- §2-G. 5편의 공

test('§2-G: SGD 노이즈 공의 포함률이 가우시안과 붙는다 (κ=30, η=0.005, hess)', () => {
  const A = rotatedHessian(30, 0);
  const comps = makeComponents({ A, n: 200, s: 1, noise: 'hess', seed: 99 });
  const all = [];
  for (const seed of [1, 2, 3, 4, 5]) {
    const { path } = sgdPath({ A, comps, start: [0, 0], steps: 20000, eta: 0.005, B: 1, seed });
    for (let i = Math.floor(path.length / 2); i < path.length; i++) all.push(path[i]);
  }
  assert.equal(all.length, 50005);               // 스펙 §2-G
  const { cov, mean } = sampleCov(all);
  const [f1, f2] = containment(cov, mean, all);
  near(f1, 0.3911, 5e-5, 'k=1');                 // 가우시안 39.35%
  near(f2, 0.8648, 5e-5, 'k=2');                 // 가우시안 86.47%
});

// ------------------------------------------------- 주변화 · 도구

test('주변화: 방향 투영의 표본 분산이 dᵀΣd 와 붙는다', () => {
  const gen = makeSampler(2, 0.5, 30, 3);
  const pts = Array.from({ length: 1e5 }, gen);
  const S = covFromParams(2, 0.5, 30);
  for (const phi of [0, 30, 75, 120]) {
    const { sd } = meanSd(projectDir(pts, phi));
    near(sd * sd, dirVariance(S, phi), dirVariance(S, phi) * 0.02, `φ=${phi}`);
  }
});

test('histogram: density 의 적분이 1 이고 gaussPdf 와 맞는다', () => {
  const rnd = mulberry32(5);
  const vals = [];
  for (let i = 0; i < 5e4; i++) vals.push(...gaussPair(rnd));
  const h = histogram(vals, { min: -4, max: 4, bins: 40 });
  const bw = 8 / 40;
  near(h.density.reduce((t, d) => t + d * bw, 0), 1, 1e-9, '적분');
  const mid = h.density[20];                     // [0, 0.2) 구간
  near(mid, gaussPdf(0.1, 0, 1), 0.01, '중앙 막대 대 밀도');
});
