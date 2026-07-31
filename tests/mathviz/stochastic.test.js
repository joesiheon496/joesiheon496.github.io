// tests/mathviz/stochastic.test.js
// 5편 스펙 §6 의 성질을 고정한다. 기대값은 전부 스펙 §2 의 실측표에서 왔다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32, gaussPair, symEigVec2, rotatedHessian,
  NOISE_KINDS, makeComponents, componentCovariance,
  SCHEDULES, scheduleBudget,
  noiseBall, predictedBall, sgdPath, sgdStepsToTolAvg, DEFAULT_SEEDS,
  olsHessian, olsNoiseCov, residualSpread, olsSgdPath, olsNoiseBall, ballFromPath,
  FIT_POINTS, olsKappa, olsClosed,
} from '../../static/js/mathviz/stochastic.js';

const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const avgBall = (mk, seeds = DEFAULT_SEEDS) => {
  const rs = seeds.map(mk).filter(Boolean);
  assert.ok(rs.length > 0, '모든 시드가 발산했다');
  const m = (k) => rs.reduce((t, r) => t + r[k], 0) / rs.length;
  return { rms: m('rms'), stdSteep: m('stdSteep'), stdFlat: m('stdFlat'), ratio: m('ratio') };
};

// ---------------------------------------------------------------- 1. 난수

test('mulberry32: 같은 시드는 같은 수열, 다른 시드는 다른 수열', () => {
  const a = Array.from({ length: 5 }, mulberry32(42));
  const b = Array.from({ length: 5 }, mulberry32(42));
  const c = Array.from({ length: 5 }, mulberry32(43));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('mulberry32: 값이 [0,1) 안에 있다', () => {
  const rnd = mulberry32(7);
  for (let i = 0; i < 2000; i++) {
    const v = rnd();
    assert.ok(v >= 0 && v < 1, `범위 밖: ${v}`);
  }
});

test('gaussPair: 표본 평균 0, 분산 1 근방', () => {
  const rnd = mulberry32(11);
  const xs = [];
  for (let i = 0; i < 20000; i++) xs.push(...gaussPair(rnd));
  const m = xs.reduce((t, v) => t + v, 0) / xs.length;
  const v = xs.reduce((t, x) => t + (x - m) ** 2, 0) / xs.length;
  assert.ok(Math.abs(m) < 0.02, `평균 ${m}`);
  assert.ok(Math.abs(v - 1) < 0.05, `분산 ${v}`);
});

// ---------------------------------------------------------------- 2. 고유분해

test('symEigVec2: 고유벡터가 정규직교이고 A v = λ v 를 만족한다', () => {
  for (const theta of [0.1, 0.5, 1.2]) {
    const A = rotatedHessian(30, theta);
    const { l1, l2, v1, v2 } = symEigVec2(A);
    assert.ok(Math.abs(Math.hypot(...v1) - 1) < 1e-12);
    assert.ok(Math.abs(v1[0] * v2[0] + v1[1] * v2[1]) < 1e-12);
    for (const [v, l] of [[v1, l1], [v2, l2]]) {
      const Av = [A[0][0] * v[0] + A[0][1] * v[1], A[1][0] * v[0] + A[1][1] * v[1]];
      assert.ok(Math.abs(Av[0] - l * v[0]) < 1e-10);
      assert.ok(Math.abs(Av[1] - l * v[1]) < 1e-10);
    }
  }
});

test('symEigVec2: 비대각이 0 이면 v1 이 큰 축이다 (스펙 §3-3 — 이 분기가 없으면 v1=[0,0])', () => {
  const A = rotatedHessian(30, 0);         // diag(1, 30) — y 가 급한 축
  const { l1, v1 } = symEigVec2(A);
  assert.ok(Math.abs(l1 - 30) < 1e-12, `l1=${l1}`);
  assert.ok(Math.abs(Math.abs(v1[1]) - 1) < 1e-12, `v1=${v1}`);
  assert.ok(Math.hypot(...v1) > 0.5, 'v1 이 영벡터가 됐다');
});

// ---------------------------------------------------------------- 3. 성분

test('makeComponents: 표본 평균이 정확히 0 이다', () => {
  for (const noise of NOISE_KINDS) {
    const comps = makeComponents({ A: rotatedHessian(30, 0.3), n: 200, noise, seed: 5 });
    const mx = comps.reduce((t, [x]) => t + x, 0) / comps.length;
    const my = comps.reduce((t, [, y]) => t + y, 0) / comps.length;
    assert.ok(Math.abs(mx) < 1e-12, `${noise} mx=${mx}`);
    assert.ok(Math.abs(my) < 1e-12, `${noise} my=${my}`);
  }
});

test('makeComponents: Σ_b 가 목표값과 정확히 일치한다 (스펙 §2-0, §3-2)', () => {
  const kappa = 30;
  const A = rotatedHessian(kappa, 0);
  const cases = {
    iso: [[1, 0], [0, 1]],
    hess: [[1, 0], [0, kappa]],
    hess2: [[1, 0], [0, kappa * kappa]],
  };
  for (const [noise, want] of Object.entries(cases)) {
    const S = componentCovariance(makeComponents({ A, n: 200, s: 1, noise, seed: 99 }));
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        assert.ok(Math.abs(S[i][j] - want[i][j]) < 1e-9,
          `${noise} Σ[${i}][${j}] = ${S[i][j]}, 기대 ${want[i][j]}`);
      }
    }
  }
});

test('makeComponents: 홀수 n 과 모르는 noise 는 던진다', () => {
  const A = rotatedHessian(10, 0);
  assert.throws(() => makeComponents({ A, n: 201, noise: 'iso' }), /짝수/);
  assert.throws(() => makeComponents({ A, n: 200, noise: 'nope' }), /모르는 noise/);
});

// ---------------------------------------------------------------- 4. 공

test('noiseBall: 공이 실재한다 — 반복을 늘려도 0 으로 안 간다', () => {
  const A = rotatedHessian(10, 0);
  const comps = makeComponents({ A, n: 200, noise: 'iso', seed: 99 });
  const short = avgBall((seed) => noiseBall({ A, comps, eta: 0.01, steps: 20000, seed }));
  const long = avgBall((seed) => noiseBall({ A, comps, eta: 0.01, steps: 160000, seed }));
  assert.ok(short.rms > 0.05, `짧게 ${short.rms}`);
  assert.ok(rel(long.rms, short.rms) < 0.1,
    `반복을 8배 늘렸는데 RMS 가 변했다: ${short.rms} → ${long.rms}`);
});

test('noiseBall: RMS ∝ √η — RMS/√η 가 작은 η 에서 상수다 (스펙 §2-1)', () => {
  const A = rotatedHessian(10, 0);
  const comps = makeComponents({ A, n: 200, noise: 'iso', seed: 99 });
  const vals = [0.002, 0.005, 0.01].map((eta) => {
    const r = avgBall((seed) => noiseBall({ A, comps, eta, steps: 120000, seed }));
    return r.rms / Math.sqrt(eta);
  });
  for (const v of vals) assert.ok(rel(v, 0.73) < 0.02, `RMS/√η = ${v}`);
});

test('noiseBall: 큰 η 에서는 √η 법칙이 샌다 (스펙 §2-1 — 정확식이 필요한 이유)', () => {
  const A = rotatedHessian(10, 0);
  const comps = makeComponents({ A, n: 200, noise: 'iso', seed: 99 });
  const small = avgBall((seed) => noiseBall({ A, comps, eta: 0.002, steps: 120000, seed }));
  const big = avgBall((seed) => noiseBall({ A, comps, eta: 0.1, steps: 120000, seed }));
  const ratio = (big.rms / Math.sqrt(0.1)) / (small.rms / Math.sqrt(0.002));
  assert.ok(ratio > 1.05, `η=0.1 에서 새야 한다. 비 ${ratio}`);
});

test('predictedBall: 예측이 실측과 5% 안쪽이다 (스펙 §2-1 예측 열)', () => {
  const A = rotatedHessian(10, 0);
  const comps = makeComponents({ A, n: 200, noise: 'iso', seed: 99 });
  const Sigma = componentCovariance(comps);
  for (const eta of [0.002, 0.01, 0.05, 0.1]) {
    const r = avgBall((seed) => noiseBall({ A, comps, eta, steps: 120000, seed }));
    const p = predictedBall({ A, Sigma, eta });
    assert.ok(rel(r.rms, p.rms) < 0.05, `η=${eta}: 실측 ${r.rms} 예측 ${p.rms}`);
  }
});

test('noiseBall: 크기는 η/B 가 정한다 (스펙 §2-2)', () => {
  const A = rotatedHessian(10, 0);
  const comps = makeComponents({ A, n: 200, noise: 'iso', seed: 99 });
  const base = avgBall((seed) => noiseBall({ A, comps, eta: 0.01, B: 1, steps: 120000, seed }));
  for (const [eta, B] of [[0.02, 2], [0.04, 4]]) {
    const r = avgBall((seed) => noiseBall({ A, comps, eta, B, steps: 120000, seed }));
    assert.ok(rel(r.rms, base.rms) < 0.03,
      `η/B 가 같은데 갈렸다: (${eta},${B}) → ${r.rms} vs ${base.rms}`);
  }
});

test('noiseBall: η/B 를 4배 키우면 RMS 가 2배가 된다', () => {
  const A = rotatedHessian(10, 0);
  const comps = makeComponents({ A, n: 200, noise: 'iso', seed: 99 });
  const lo = avgBall((seed) => noiseBall({ A, comps, eta: 0.04, B: 16, steps: 120000, seed }));
  const hi = avgBall((seed) => noiseBall({ A, comps, eta: 0.04, B: 4, steps: 120000, seed }));
  assert.ok(rel(hi.rms / lo.rms, 2) < 0.1, `비 ${hi.rms / lo.rms}`);
});

// ------------------------------------------------- 5. 🔑 모양은 노이즈가 정한다

test('🔑 공의 모양은 손실이 아니라 노이즈의 출처가 정한다 (스펙 §2-3)', () => {
  for (const kappa of [10, 30, 100]) {
    const A = rotatedHessian(kappa, 0);
    const want = {
      iso: 1 / Math.sqrt(kappa),
      hess: 1,
      hess2: Math.sqrt(kappa),
    };
    for (const [noise, expect] of Object.entries(want)) {
      const comps = makeComponents({ A, n: 200, noise, seed: 99 });
      const r = avgBall((seed) => noiseBall({ A, comps, eta: 0.002, steps: 160000, seed }));
      assert.ok(rel(r.ratio, expect) < 0.06,
        `κ=${kappa} ${noise}: 비 ${r.ratio}, 기대 ${expect}`);
    }
  }
});

test('🔑 Σ ∝ A 면 공이 원이다 — 손실 등고선은 √κ 로 납작한데도', () => {
  const kappa = 100;
  const A = rotatedHessian(kappa, 0);
  const comps = makeComponents({ A, n: 200, noise: 'hess', seed: 99 });
  const r = avgBall((seed) => noiseBall({ A, comps, eta: 0.002, steps: 160000, seed }));
  assert.ok(Math.abs(r.ratio - 1) < 0.1, `비 ${r.ratio} — 원이 아니다`);
  // 같은 A 위에서 손실의 반축비는 1/√κ = 0.1 이다. 공과 10배 다르다.
  assert.ok(r.ratio / (1 / Math.sqrt(kappa)) > 5, '공과 손실이 같은 모양으로 나왔다');
});

test('🔑 θ 를 돌려도 모양 비가 불변이다 (스펙 §2-3b — §3-3 회귀)', () => {
  const kappa = 30;
  const ratios = [0, 15, 30, 45].map((deg) => {
    const A = rotatedHessian(kappa, (deg * Math.PI) / 180);
    const comps = makeComponents({ A, n: 200, noise: 'hess2', seed: 99 });
    return avgBall((seed) => noiseBall({ A, comps, eta: 0.002, steps: 160000, seed })).ratio;
  });
  for (const r of ratios) {
    assert.ok(rel(r, ratios[0]) < 0.01, `θ 로 비가 변했다: ${ratios}`);
  }
  assert.ok(rel(ratios[0], Math.sqrt(kappa)) < 0.06, `비 ${ratios[0]}`);
});

test('손실 바닥: 등방 노이즈에서 κ 와 무관하다 (스펙 §2-4)', () => {
  const eta = 0.002;
  const losses = [10, 30, 100].map((kappa) => {
    const A = rotatedHessian(kappa, 0);
    const comps = makeComponents({ A, n: 200, noise: 'iso', seed: 99 });
    const { l1, l2 } = symEigVec2(A);
    const r = avgBall((seed) => noiseBall({ A, comps, eta, steps: 160000, seed }));
    return 0.5 * (l1 * r.stdSteep ** 2 + l2 * r.stdFlat ** 2);
  });
  for (const L of losses) assert.ok(rel(L, losses[0]) < 0.08, `E[L] 이 κ 로 변했다: ${losses}`);
});

test('손실 바닥: Σ ∝ A 에서는 tr(A) = 1+κ 에 비례한다 (스펙 §2-4)', () => {
  const eta = 0.002;
  const ks = [10, 30, 100];
  const perTrace = ks.map((kappa) => {
    const A = rotatedHessian(kappa, 0);
    const comps = makeComponents({ A, n: 200, noise: 'hess', seed: 99 });
    const { l1, l2 } = symEigVec2(A);
    const r = avgBall((seed) => noiseBall({ A, comps, eta, steps: 160000, seed }));
    return (0.5 * (l1 * r.stdSteep ** 2 + l2 * r.stdFlat ** 2)) / (eta * (1 + kappa));
  });
  for (const v of perTrace) assert.ok(rel(v, perTrace[0]) < 0.1, `E[L]/(η·trA): ${perTrace}`);
});

// ---------------------------------------------------------------- 6. 스케줄

test('scheduleBudget: 1/k 의 Ση_k 는 로그로만 자라 ln(1/tol) 에 못 닿는다 (스펙 §2-6)', () => {
  const inv = scheduleBudget('inv', 0.05, 400000);
  assert.ok(rel(inv, 0.67) < 0.05, `Ση_k = ${inv}`);
  assert.ok(inv < Math.log(1 / 1e-2), `${inv} 가 ln(100)=4.61 보다 작아야 한다`);
  // 0.05 를 40만 번 더한 값은 부동소수점 누적 때문에 정확히 20000 이 아니다 (스펙 §3-8c)
  assert.ok(rel(scheduleBudget('const', 0.05, 400000), 20000) < 1e-9);
});

test('scheduleBudget: 모르는 스케줄은 던진다', () => {
  assert.throws(() => scheduleBudget('nope', 0.1, 10), /모르는 schedule/);
  assert.throws(() => sgdPath({
    A: rotatedHessian(10, 0), comps: [[0, 0], [0, 0]], start: [1, 1], steps: 1, eta: 0.1, schedule: 'nope',
  }), /모르는 schedule/);
});

test('1/k 스케줄은 목표에 도달하지 못한다 — 버그가 아니다 (스펙 §3-6)', () => {
  const A = rotatedHessian(10, 0);
  const comps = makeComponents({ A, n: 200, noise: 'hess', seed: 99 });
  const r = sgdStepsToTolAvg({
    A, comps, start: [2.5, 0.7], eta: 0.05, tol: 1e-2, maxIters: 400000, schedule: 'inv',
  });
  assert.equal(r.reached, false, `도달해버렸다: ${r.iters}`);
});

test('느슨한 목표에서는 상수 η 가 감쇠보다 빠르다 (스펙 §2-6)', () => {
  const A = rotatedHessian(10, 0);
  const comps = makeComponents({ A, n: 200, noise: 'hess', seed: 99 });
  const base = { A, comps, start: [2.5, 0.7], eta: 0.05, maxIters: 400000, tol: 1e-2 };
  const c = sgdStepsToTolAvg({ ...base, schedule: 'const' });
  const g = sgdStepsToTolAvg({ ...base, schedule: 'gentle' });
  assert.ok(rel(c.iters, 124) < 0.05, `상수 ${c.iters} — 스펙 §2-6 의 124`);
  assert.ok(c.iters < g.iters, `상수 ${c.iters} 가 gentle ${g.iters} 보다 빨라야 한다`);
});

test('조인 목표에서는 완만한 감쇠가 상수를 크게 이긴다 (스펙 §2-6)', () => {
  const A = rotatedHessian(10, 0);
  const comps = makeComponents({ A, n: 200, noise: 'hess', seed: 99 });
  const base = { A, comps, start: [2.5, 0.7], eta: 0.05, maxIters: 2000000, tol: 5e-4 };
  const c = sgdStepsToTolAvg({ ...base, schedule: 'const' });
  const g = sgdStepsToTolAvg({ ...base, schedule: 'gentle' });
  assert.ok(g.iters * 5 < c.iters, `gentle ${g.iters} 가 상수 ${c.iters} 의 1/5 보다 작아야 한다`);
});

// ---------------------------------------------------------------- 7. 반복평균

test('반복평균을 0 부터 켜면 크게 느려진다 — 전이구간 오염 (스펙 §2-7)', () => {
  const A = rotatedHessian(10, 0);
  const comps = makeComponents({ A, n: 200, noise: 'hess', seed: 99 });
  const base = { A, comps, start: [2.5, 0.7], eta: 0.05, maxIters: 400000, tol: 1e-2, schedule: 'const' };
  const plain = sgdStepsToTolAvg({ ...base });
  const all = sgdStepsToTolAvg({ ...base, avgFrom: 0 });
  assert.ok(all.iters > plain.iters * 5,
    `평균 ${all.iters} 이 생궤적 ${plain.iters} 의 5배는 넘어야 한다`);
});

test('반복평균은 전이구간을 지나 켜면 조인 목표에서 이긴다 (스펙 §2-7)', () => {
  const A = rotatedHessian(10, 0);
  const comps = makeComponents({ A, n: 200, noise: 'hess', seed: 99 });
  const base = { A, comps, start: [2.5, 0.7], eta: 0.05, maxIters: 2000000, tol: 2e-3, schedule: 'const' };
  const plain = sgdStepsToTolAvg({ ...base });
  const tail = sgdStepsToTolAvg({ ...base, avgFrom: 200 });
  assert.ok(tail.iters < plain.iters, `꼬리평균 ${tail.iters} vs 생궤적 ${plain.iters}`);
});

test('느슨한 목표에서 avgFrom 이 크면 평균이 켜지기도 전에 끝난다 (스펙 §3-7 함정)', () => {
  const A = rotatedHessian(10, 0);
  const comps = makeComponents({ A, n: 200, noise: 'hess', seed: 99 });
  const base = { A, comps, start: [2.5, 0.7], eta: 0.05, maxIters: 400000, tol: 1e-2, schedule: 'const' };
  const plain = sgdStepsToTolAvg({ ...base });
  const late = sgdStepsToTolAvg({ ...base, avgFrom: 1000 });
  assert.equal(late.iters, plain.iters,
    '도달이 avgFrom 보다 이르면 두 값이 같아야 한다 — 평균이 이긴 것이 아니다');
});

test('ballFromPath: 같은 궤적에서 noiseBall 과 같은 통계를 준다 (화면·숫자 일치)', () => {
  const A = rotatedHessian(30, 0.4);
  const comps = makeComponents({ A, n: 200, noise: 'hess2', seed: 99 });
  // 같은 시드·같은 설정이면 sgdPath 의 궤적이 noiseBall 이 도는 궤적과 같다
  const { path } = sgdPath({ A, comps, start: [0, 0], steps: 40000, eta: 0.002, seed: 7 });
  const fromPath = ballFromPath(A, path, { burnFrac: 0.5 });
  const direct = noiseBall({ A, comps, eta: 0.002, steps: 40000, seed: 7, start: [0, 0] });
  assert.ok(rel(fromPath.ratio, direct.ratio) < 0.02,
    `비: path ${fromPath.ratio} vs noiseBall ${direct.ratio}`);
  assert.ok(rel(fromPath.rms, direct.rms) < 0.02, `RMS: ${fromPath.rms} vs ${direct.rms}`);
});

test('ballFromPath: target 을 주면 그 점 기준으로 잰다 (OLS 는 닫힌 해)', () => {
  const A = olsHessian(FIT_POINTS);
  const path = olsSgdPath({ points: FIT_POINTS, steps: 20000, eta: 0.002, seed: 2 });
  const atClosed = ballFromPath(A, path, { burnFrac: 0.5, target: olsClosed(FIT_POINTS) });
  const atOrigin = ballFromPath(A, path, { burnFrac: 0.5, target: [0, 0] });
  // 닫힌 해 기준 RMS 는 작고, 원점 기준은 닫힌 해까지의 거리만큼 크다
  assert.ok(atClosed.rms < 0.05, `닫힌 해 기준 ${atClosed.rms}`);
  assert.ok(atOrigin.rms > 0.3, `원점 기준 ${atOrigin.rms}`);
});

test('ballFromPath: 표본이 없으면 null 이다', () => {
  const A = rotatedHessian(10, 0);
  assert.equal(ballFromPath(A, [[1, 1]], { burnFrac: 1 }), null);
});

test('sgdPath: avgFrom 이전에는 평균 궤적이 생궤적과 같다', () => {
  const A = rotatedHessian(10, 0);
  const comps = makeComponents({ A, n: 200, noise: 'iso', seed: 3 });
  const { path, avg } = sgdPath({ A, comps, start: [2, 1], steps: 50, eta: 0.05, seed: 1, avgFrom: 20 });
  assert.equal(path.length, avg.length);
  for (let i = 0; i <= 20; i++) assert.deepEqual(avg[i], path[i]);
  assert.notDeepEqual(avg[50], path[50]);
});

// ---------------------------------------------------------------- 8. 예산과 문턱

test('같은 기울기 예산에서 B 는 일을 안 한다 (스펙 §2-8)', () => {
  const A = rotatedHessian(10, 0);
  const comps = makeComponents({ A, n: 200, noise: 'hess', seed: 99 });
  const run = (B) => {
    const steps = Math.floor(20000 / B);
    return avgBall((seed) => noiseBall({
      A, comps, eta: 0.01 * B, B, steps, burn: Math.floor(steps * 0.8), seed,
    })).rms;
  };
  const one = run(1);
  for (const B of [2, 5]) {
    assert.ok(rel(run(B), one) < 0.12, `B=${B} 가 B=1 과 갈렸다`);
  }
});

test('예산 중립성은 3편의 발산 문턱 2/λmax 에서 깨진다 (스펙 §2-8)', () => {
  const kappa = 10;
  const A = rotatedHessian(kappa, 0);
  const comps = makeComponents({ A, n: 200, noise: 'hess', seed: 99 });
  // 문턱 근방은 시드 분산이 크다. 한 시드로 판정하면 안 된다 (스펙 §3-8b)
  const run = (B) => {
    const steps = Math.floor(20000 / B);
    const rs = DEFAULT_SEEDS
      .map((seed) => noiseBall({ A, comps, eta: 0.01 * B, B, steps, burn: Math.floor(steps * 0.8), seed }))
      .filter(Boolean);
    if (rs.length === 0) return Infinity;
    return rs.reduce((t, r) => t + r.rms, 0) / rs.length;
  };
  assert.ok(run(5) < 0.15, `B=5 (문턱의 0.25배) 는 멀쩡해야 한다: ${run(5)}`);
  assert.ok(run(20) > 1, `B=20 은 η 가 정확히 문턱 2/κ=0.2 이라 무너져야 한다: ${run(20)}`);
  assert.ok(run(25) > run(20), 'B=25 는 문턱을 넘어 더 나빠야 한다');
});

test('🚨 정확히 문턱이면 정상상태가 아니라 RMS ∝ √k 로 자란다 (스펙 §2-8b — 3편 갱신)', () => {
  const kappa = 10;
  const A = rotatedHessian(kappa, 0);
  const comps = makeComponents({ A, n: 200, noise: 'hess', seed: 99 });
  const at = (frac, steps) => {
    const rs = DEFAULT_SEEDS
      .map((seed) => noiseBall({
        A, comps, eta: (2 / kappa) * frac, B: 1, steps, burn: Math.floor(steps * 0.9), seed,
      }))
      .filter(Boolean);
    if (rs.length === 0) return Infinity;
    return rs.reduce((t, r) => t + r.rms, 0) / rs.length;
  };
  // 문턱 아래는 스텝수를 64배 늘려도 정상상태다
  const below = [at(0.9, 1000), at(0.9, 64000)];
  assert.ok(rel(below[1], below[0]) < 0.1, `문턱 아래는 정상상태여야 한다: ${below}`);

  // 정확히 문턱이면 자란다. 16배 스텝이면 √16 = 4 배 근방
  const on = [at(1.0, 1000), at(1.0, 16000)];
  assert.ok(on[1] / on[0] > 2.5 && on[1] / on[0] < 6,
    `√16=4 근방으로 자라야 한다: ${on[0]} → ${on[1]} (배율 ${on[1] / on[0]})`);

  // 문턱을 넘으면 지수 발산 — 비교가 무의미할 만큼 크다
  assert.ok(at(1.01, 1000) > 1e6, '문턱을 넘으면 지수로 터져야 한다');
});

// ---------------------------------------------------------------- 9. 실데이터

test('olsHessian: 비대각이 2Σx = 21 이고 κ = 29.45 다 (3·4편 연속성)', () => {
  const A = olsHessian(FIT_POINTS);
  assert.ok(Math.abs(A[0][1] - 21) < 1e-12, `비대각 ${A[0][1]}`);
  const { kappa, s1, s2 } = olsKappa(FIT_POINTS);
  assert.ok(rel(kappa, 29.454) < 1e-3, `κ = ${kappa}`);
  // 3편의 제곱 항등식
  assert.ok(rel((s1 / s2) ** 2, kappa) < 1e-9, `(σ₁/σ₂)² = ${(s1 / s2) ** 2} vs κ = ${kappa}`);
});

test('residualSpread: 여섯 점의 잔차는 등분산이 아니다 (스펙 §2-9)', () => {
  const r = residualSpread(FIT_POINTS);
  assert.ok(r.ratio > 20, `잔차² 비 ${r.ratio} — 등분산이면 1 이어야 한다`);
});

test('olsNoiseCov: Σ 가 A 에 거의 비례하지만 정확히는 아니다 (스펙 §2-9)', () => {
  const A = olsHessian(FIT_POINTS);
  const S = olsNoiseCov(FIT_POINTS);
  const ratios = [S[0][0] / A[0][0], S[0][1] / A[0][1], S[1][1] / A[1][1]];
  const mn = Math.min(...ratios);
  const mx = Math.max(...ratios);
  assert.ok(mx / mn < 1.2, `거의 비례해야 한다: ${ratios}`);
  assert.ok(mx / mn > 1.03, `정확히 비례하면 이 글의 논지가 없다: ${ratios}`);
});

test('olsNoiseBall: 공의 비가 1.47 이고 예측이 5% 안쪽이다 (스펙 §2-9)', () => {
  const A = olsHessian(FIT_POINTS);
  const S = olsNoiseCov(FIT_POINTS);
  const r = avgBall((seed) => olsNoiseBall({ points: FIT_POINTS, eta: 0.002, steps: 160000, seed }));
  const p = predictedBall({ A, Sigma: S, eta: 0.002 });
  assert.ok(rel(r.ratio, 1.471) < 0.05, `실측 비 ${r.ratio}`);
  assert.ok(rel(r.ratio, p.ratio) < 0.05, `실측 ${r.ratio} 예측 ${p.ratio}`);
  // 원도 아니고 손실 모양(√κ = 5.43)도 아니다
  assert.ok(r.ratio > 1.2 && r.ratio < 2.5, `${r.ratio} 는 1 도 5.43 도 아니어야 한다`);
});

test('실데이터에서도 η/B 붕괴가 성립한다 (스펙 §2-9)', () => {
  const base = avgBall((seed) => olsNoiseBall({ points: FIT_POINTS, eta: 0.001, B: 1, steps: 160000, seed }));
  for (const [eta, B] of [[0.002, 2], [0.004, 4]]) {
    const r = avgBall((seed) => olsNoiseBall({ points: FIT_POINTS, eta, B, steps: 160000, seed }));
    assert.ok(rel(r.rms, base.rms) < 0.08, `(${eta},${B}) → ${r.rms} vs ${base.rms}`);
  }
});

test('중심화는 κ 를 낮추지만 공의 모양은 안 바꾼다 (스펙 §2-9 — 4편의 한계)', () => {
  const cen = FIT_POINTS.map(([x, y]) => [x - 1.75, y]);
  assert.ok(Math.abs(olsHessian(cen)[0][1]) < 1e-12, '중심화하면 비대각이 0 이어야 한다');
  assert.ok(olsKappa(cen).kappa < 2, `중심화 κ = ${olsKappa(cen).kappa}`);
  const raw = avgBall((seed) => olsNoiseBall({ points: FIT_POINTS, eta: 0.002, steps: 160000, seed }));
  const c = avgBall((seed) => olsNoiseBall({ points: cen, eta: 0.002, steps: 160000, seed }));
  assert.ok(rel(c.ratio, raw.ratio) < 0.08,
    `공의 비가 중심화로 바뀌었다: ${raw.ratio} → ${c.ratio}`);
});

test('olsSgdPath: center 여부와 무관하게 원 좌표를 돌려준다 (3편 §3-4 규약)', () => {
  const raw = olsSgdPath({ points: FIT_POINTS, steps: 4000, eta: 0.002, seed: 1 });
  const cen = olsSgdPath({ points: FIT_POINTS, steps: 4000, eta: 0.002, seed: 1, center: true });
  const [a, b] = olsClosed(FIT_POINTS);
  for (const p of [raw, cen]) {
    const last = p[p.length - 1];
    assert.ok(Math.hypot(last[0] - a, last[1] - b) < 0.2,
      `원 좌표의 닫힌 해 [${a},${b}] 근방이어야 한다: ${last}`);
  }
  assert.equal(raw.length, 4001);
});

test('olsSgdPath: B 를 키우면 닫힌 해에 더 가까이 앉는다', () => {
  const [a, b] = olsClosed(FIT_POINTS);
  const dist = (B) => {
    const p = olsSgdPath({ points: FIT_POINTS, steps: 6000, eta: 0.002, B, seed: 4 });
    let s = 0;
    for (let i = 3000; i < p.length; i++) s += Math.hypot(p[i][0] - a, p[i][1] - b);
    return s / (p.length - 3000);
  };
  assert.ok(dist(6) < dist(1), `B=6 이 B=1 보다 가까워야 한다: ${dist(6)} vs ${dist(1)}`);
});
