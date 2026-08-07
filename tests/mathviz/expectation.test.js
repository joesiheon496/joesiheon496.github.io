// tests/mathviz/expectation.test.js
// 11편 스펙 §2 의 실측표를 고정한다. 시드가 같으므로 값은 결정적이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDist, meanOf, sdOf, medianOf, runningMean, estimatorSpread,
  corrTrials, corrMeanSd, DIST_KINDS,
} from '../../static/js/mathviz/expectation.js';
import { mulberry32, gaussPair } from '../../static/js/mathviz/stochastic.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);

/** 스펙 §2-A 의 측정 — 한 스트림으로 N 을 차례로 돈다. 순서가 값의 일부다. */
function sqrtNRatios(kind) {
  const dist = makeDist(kind, 41);
  const out = {};
  for (const N of [1, 10, 100, 1000]) {
    const means = new Array(4000);
    for (let t = 0; t < 4000; t++) {
      let s = 0;
      for (let i = 0; i < N; i++) s += dist.draw();
      means[t] = s / N;
    }
    out[N] = (sdOf(means) * Math.sqrt(N)) / dist.sigma;
  }
  return out;
}

test('§2-A: √N 법칙은 분포 모양과 무관하다 (시드 41)', () => {
  const u = sqrtNRatios('uniform');
  near(u[1000], 1.0066, 5e-4, '균등 N=1000');
  const g = sqrtNRatios('gauss');
  near(g[100], 1.0154, 5e-4, '가우시안 N=100');
  const e = sqrtNRatios('exp');
  near(e[1], 0.9551, 5e-4, '지수 N=1');
  // 12개 전부 1 에서 5% 안쪽 — "√N 은 가우시안의 성질이 아니다"
  for (const r of [...Object.values(u), ...Object.values(g), ...Object.values(e)]) {
    assert.ok(Math.abs(r - 1) < 0.05, `비 ${r}`);
  }
});

test('§2-B: Var(X+Y) = 2+2ρ (N=1e6, 시드 42)', () => {
  const varSum = (rho) => {
    const rnd = mulberry32(42);
    const q = Math.sqrt(1 - rho * rho);
    const sums = new Array(1e6);
    for (let i = 0; i < 1e6; i++) {
      const [z1, z2] = gaussPair(rnd);
      sums[i] = z1 + (rho * z1 + q * z2);
    }
    return sdOf(sums) ** 2;
  };
  near(varSum(0), 2.0035, 5e-4, 'ρ=0');
  near(varSum(0.9), 3.8059, 5e-4, 'ρ=0.9');
});

test('§2-C: 상관 ρ=0.1 이면 sd(평균)가 √ρ 바닥에 붙는다 (시드 43)', () => {
  const sdAt = (N) => sdOf(corrTrials({ rho: 0.1, N, trials: 4000, seed: 43 }).map((t) => t.mean));
  near(sdAt(10), 0.4500, 5e-4, 'N=10');
  near(sdAt(1000), 0.3157, 5e-4, 'N=1000');   // 독립이라면 0.0316 — 10배
  near(corrMeanSd(0.1, 1000), 0.3176, 5e-5, '닫힌형');
  near(Math.sqrt(0.1), 0.3162, 5e-5, '바닥 √ρ');
});

test('§2-D: 분모 N 은 분산을 (N−1)/N 배로 잰다 (시행 2e5, 시드 44)', () => {
  const biasAt = (N) => {
    const dist = makeDist('gauss', 44);
    let sumN = 0;
    let sumN1 = 0;
    const T = 2e5;
    for (let t = 0; t < T; t++) {
      const xs = new Array(N);
      for (let i = 0; i < N; i++) xs[i] = dist.draw();
      const m = meanOf(xs);
      let ss = 0;
      for (const x of xs) ss += (x - m) ** 2;
      sumN += ss / N;
      sumN1 += ss / (N - 1);
    }
    return { byN: sumN / T, byN1: sumN1 / T };
  };
  const b2 = biasAt(2);
  near(b2.byN, 0.4986, 5e-4, 'N=2, 분모 N');     // 절반이다
  near(b2.byN1, 0.9972, 5e-4, 'N=2, 분모 N−1');
  const b10 = biasAt(10);
  near(b10.byN, 0.9002, 5e-4, 'N=10, 분모 N');
  near(b10.byN1, 1.0002, 5e-4, 'N=10, 분모 N−1');
});

test('§2-E: 코시의 평균은 N=1000 에서도 안 좋아지고 중앙값은 √N 로 준다 (시드 45)', () => {
  near(estimatorSpread(makeDist('cauchy', 45), 10, 2000, 'mean'), 0.9904, 5e-4, '평균 N=10');
  near(estimatorSpread(makeDist('cauchy', 45), 1000, 2000, 'mean'), 1.0057, 5e-4, '평균 N=1000');
  near(estimatorSpread(makeDist('cauchy', 45), 10, 2000, 'median'), 0.3378, 5e-4, '중앙값 N=10');
  near(estimatorSpread(makeDist('cauchy', 45), 1000, 2000, 'median'), 0.0338, 5e-4, '중앙값 N=1000');
  near((0.6745 * Math.PI) / (2 * Math.sqrt(1000)), 0.0335, 5e-5, '중앙값 이론');
});

test('§2-F: 가우시안에서는 평균이 중앙값보다 1.24배 낫다 (N=1000, 시드 46)', () => {
  const dist = makeDist('gauss', 46);
  const meanEst = new Array(4000);
  const medEst = new Array(4000);
  for (let t = 0; t < 4000; t++) {
    const xs = new Array(1000);
    for (let i = 0; i < 1000; i++) xs[i] = dist.draw();
    meanEst[t] = meanOf(xs);
    medEst[t] = medianOf(xs);
  }
  near(sdOf(meanEst), 0.03171, 5e-5, 'sd(평균)');
  near(sdOf(medEst), 0.03918, 5e-5, 'sd(중앙값)');
  near(sdOf(medEst) / sdOf(meanEst), 1.2356, 5e-4, '비');
});

// ------------------------------------------------- 도구

test('makeDist: 네 분포 모두 평균이 0 근방이고, σ 있는 셋은 sd 가 σ 근방이다', () => {
  for (const kind of DIST_KINDS) {
    const dist = makeDist(kind, 9);
    const xs = Array.from({ length: 5e4 }, () => dist.draw());
    if (Number.isFinite(dist.sigma)) {
      near(meanOf(xs), 0, 0.02, `${kind} 평균`);
      near(sdOf(xs), dist.sigma, dist.sigma * 0.03, `${kind} sd`);
    } else {
      near(medianOf(xs), 0, 0.02, `${kind} 중앙값`);   // 코시는 평균 대신 중앙값
    }
  }
});

test('runningMean: n 번째 값이 처음 n 개의 평균이고, 같은 시드면 같은 궤적이다', () => {
  const a = runningMean(makeDist('uniform', 3), 50);
  const dist = makeDist('uniform', 3);
  const xs = Array.from({ length: 50 }, () => dist.draw());
  near(a[0], xs[0], 1e-12, '첫 값');
  near(a[49], meanOf(xs), 1e-12, '마지막 값');
  assert.deepEqual(a, runningMean(makeDist('uniform', 3), 50));
});

test('medianOf: 짝수 길이는 가운데 둘의 평균, 원본을 바꾸지 않는다', () => {
  const a = [3, 1, 2, 4];
  assert.equal(medianOf(a), 2.5);
  assert.deepEqual(a, [3, 1, 2, 4]);
  assert.equal(medianOf([5, 1, 9]), 5);
});
