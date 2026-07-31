// static/js/mathviz/stochastic.js
import { rotatedHessian, quadGradA, symEig2 } from './adaptive.js';
import { olsClosed, olsKappa, centerPoints } from './optimize.js';

// 5편 — 미니배치 노이즈의 순수 수학.
//
// 축 문장: **SGD 는 점이 아니라 공으로 수렴하고, 그 공의 크기는 η/B 가 정한다.**
//
// 그리고 이 글의 발견: **공의 모양은 손실이 아니라 노이즈의 출처가 정한다.**
// 손실 등고선의 반축비는 1/√κ 로 고정인데, 같은 A 위에서 노이즈 공분산만 바꾸면
// 공의 급한축/평평축 표준편차 비가 1/√κ · 1 · √κ 로 전 구간을 훑는다. 스펙 §2-3.
//
// ⚠️ 이 파일의 모든 무작위성은 **시드에서 나온다.** Math.random 을 쓰지 말 것.
// 데모의 궤적이 매 프레임 달라지면 슬라이더를 움직였을 때 무엇이 바뀐 것인지
// 구별할 수 없고, node:test 로 숫자를 고정할 수도 없다. 스펙 §3-1.

// ---------------------------------------------------------------------------
// 재현 가능한 난수
// ---------------------------------------------------------------------------

/**
 * mulberry32 — 32비트 상태의 작은 PRNG. [0,1) 을 돌려주는 함수를 만든다.
 *
 * 왜 직접 넣는가: 데모 JS 의 외부 의존성이 0 이어야 한다(스펙 §8-11). 그리고 시드가
 * 같으면 브라우저와 Node 에서 **같은 수열**이 나와야 테스트가 글의 숫자를 고정할 수 있다.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller. 표준정규 두 개를 한 번에 돌려준다. */
export function gaussPair(rnd) {
  let u = 0;
  while (u === 0) u = rnd();
  const v = rnd();
  const r = Math.sqrt(-2 * Math.log(u));
  return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
}

// ---------------------------------------------------------------------------
// 2×2 고유분해 — 공의 모양을 재려면 고유축이 필요하다
// ---------------------------------------------------------------------------

/**
 * 대칭 2×2 의 고윳값과 정규직교 고유벡터. l1 ≥ l2 이고 v1 이 **급한 축**이다.
 *
 * adaptive.js 의 symEig2 는 고윳값만 준다. 공의 모양은 고유축에 투영해야 나오므로
 * 벡터가 필요하다. 비대각이 0 이면 좌표축이 곧 고유축이고, 그때 큰 쪽을 v1 으로 잡는다
 * — 이 분기를 빼면 θ=0° 에서 v1 이 [0,0] 이 되어 모든 투영이 0 이 된다.
 */
export function symEigVec2(A) {
  const [l1, l2] = symEig2(A);
  const b = A[0][1];
  let v1;
  if (Math.abs(b) > 1e-14) {
    v1 = [l1 - A[1][1], b];
  } else {
    v1 = A[0][0] >= A[1][1] ? [1, 0] : [0, 1];
  }
  const n1 = Math.hypot(v1[0], v1[1]);
  v1 = [v1[0] / n1, v1[1] / n1];
  return { l1, l2, v1, v2: [-v1[1], v1[0]] };
}

// ---------------------------------------------------------------------------
// 유한합 이차문제 — 미니배치를 이야기하려면 성분이 있어야 한다
// ---------------------------------------------------------------------------

export const NOISE_KINDS = ['iso', 'hess', 'hess2'];

/**
 * 노이즈 출처별 라벨. 데모의 라디오와 글의 표가 같은 말을 쓰게 한다.
 */
export const NOISE_LABELS = {
  iso: '등방 (Σ ∝ I)',
  hess: '손실형 (Σ ∝ A)',
  hess2: '급한축 편중 (Σ ∝ A²)',
};

/**
 * 성분 이차함수 n 개를 만든다.
 *
 *   L_i(w) = ½wᵀAw − b_iᵀw,   mean(b_i) = 0   →   L(w) = ½wᵀAw,  w* = 0
 *   ∇L_i(w) = Aw − b_i
 *
 * 즉 **모든 성분이 같은 곡률 A 를 갖고 최소점만 서로 다르다.** 그래서 전체 손실은
 * 3·4편이 쓴 것과 정확히 같은 ½wᵀAw 이고, 미니배치가 만드는 것은 **기울기의 흔들림뿐**이다.
 * 곡률까지 흔들리게 만들면 노이즈 효과와 곡률 효과가 섞여 이 글의 논지를 잴 수 없다.
 *
 * 배치 B 의 기울기 노이즈 공분산은 Σ_b/B 이므로, b_i 의 공분산을 골라 노이즈의
 * **출처**를 바꿀 수 있다. 이것이 §2-3 의 실험 장치다.
 *   iso   : Σ_b = s²I    → 공이 평평한 축으로 길다 (비 1/√κ)
 *   hess  : Σ_b = s²A    → 공이 원에 가깝다 (비 ≈ 1)
 *   hess2 : Σ_b = s²A²   → 공이 급한 축으로 길다 (비 √κ)
 *
 * ⚠️ 표본공분산을 **정확히** 목표값으로 맞춘다(평균 0 · 백색화 · Gram–Schmidt).
 * 정규난수를 그대로 쓰면 n=400 에서도 Σ_b/A 의 대각비가 0.969 대 1.032 로 갈리고,
 * 그 3% 가 공의 모양 비에 그대로 실려서 "비 = 1" 주장을 흐린다. 스펙 §3-2.
 */
export function makeComponents({ A, n = 200, s = 1, noise = 'iso', seed = 1 }) {
  if (!NOISE_KINDS.includes(noise)) {
    throw new Error(`makeComponents: 모르는 noise ${noise}`);
  }
  if (n % 2 !== 0) throw new Error('makeComponents: n 은 짝수여야 한다 (±쌍으로 평균을 0 으로 만든다)');
  const rnd = mulberry32(seed);
  const { l1, l2, v1, v2 } = symEigVec2(A);

  // ±쌍으로 뽑아 평균을 정확히 0 으로
  const raw = [];
  for (let i = 0; i < n / 2; i++) {
    const [g1, g2] = gaussPair(rnd);
    raw.push([g1, g2]);
    raw.push([-g1, -g2]);
  }

  // 백색화: 1축 정규화 → 2축에서 1축 성분 제거 → 2축 정규화.
  // 결과의 표본공분산은 정확히 항등행렬이다.
  let s0 = 0;
  for (const [x] of raw) s0 += x * x;
  s0 = Math.sqrt(s0 / raw.length);
  let s01 = 0;
  for (const [x, y] of raw) s01 += (x / s0) * y;
  s01 /= raw.length;
  const mid = raw.map(([x, y]) => [x / s0, y - s01 * (x / s0)]);
  let s1 = 0;
  for (const [, y] of mid) s1 += y * y;
  s1 = Math.sqrt(s1 / mid.length);
  const u = mid.map(([x, y]) => [x, y / s1]);

  const scale = noise === 'iso' ? [1, 1]
    : noise === 'hess' ? [Math.sqrt(l1), Math.sqrt(l2)]
      : [l1, l2];

  return u.map(([c1, c2]) => {
    const a1 = s * scale[0] * c1;
    const a2 = s * scale[1] * c2;
    return [a1 * v1[0] + a2 * v2[0], a1 * v1[1] + a2 * v2[1]];
  });
}

/** 성분들의 표본공분산 Σ_b. 테스트가 makeComponents 의 의도를 확인하는 데 쓴다. */
export function componentCovariance(comps) {
  const n = comps.length;
  const S = [[0, 0], [0, 0]];
  for (const [x, y] of comps) {
    S[0][0] += x * x; S[0][1] += x * y;
    S[1][0] += y * x; S[1][1] += y * y;
  }
  return S.map((row) => row.map((v) => v / n));
}

// ---------------------------------------------------------------------------
// 학습률 스케줄
// ---------------------------------------------------------------------------

/**
 * 스케줄 이름 → (k, eta0) ↦ η_k. k 는 0 부터 센다.
 *
 * ⚠️ `inv` (η₀/(1+k)) 는 교과서에 늘 나오지만 **이 글의 목표에는 도달하지 못한다.**
 * 결정론적 진행량이 Σₖ η_k ≈ η₀·ln K 로 로그밖에 자라지 않아서, 초기 거리를 건너기도
 * 전에 보폭이 죽는다. 400k 스텝에서도 미도달이다. 스펙 §2-5 — 이것은 버그가 아니라
 * 글이 보여주려는 결과이므로 상한을 올려 "고치지" 말 것.
 */
export const SCHEDULES = {
  const: (k, eta0) => eta0,
  inv: (k, eta0) => eta0 / (1 + k),
  invsqrt: (k, eta0) => eta0 / Math.sqrt(1 + k),
  gentle: (k, eta0) => eta0 / (1 + k / 500),
  step: (k, eta0) => eta0 * Math.pow(0.5, Math.floor(k / 2000)),
};

export const SCHEDULE_LABELS = {
  const: '상수 η₀',
  inv: 'η₀/(1+k)',
  invsqrt: 'η₀/√(1+k)',
  gentle: 'η₀/(1+k/500)',
  step: '계단 (2000마다 ½)',
};

// ---------------------------------------------------------------------------
// SGD
// ---------------------------------------------------------------------------

/**
 * 미니배치 기울기. 복원추출로 B 개를 뽑는다.
 *
 * 복원추출을 쓰는 이유는 공분산이 정확히 Σ_b/B 가 되어 §2-2 의 η/B 법칙을 흐리지
 * 않기 때문이다. 비복원추출은 유한모집단 보정 (n−B)/(n−1) 이 붙어서 B 가 n 에
 * 가까워질 때 법칙이 어긋난다 — 그 어긋남이 노이즈 때문인지 보정 때문인지
 * 화면에서 구별할 수 없다.
 */
export function batchGradient(A, comps, w, B, rnd) {
  let bx = 0;
  let by = 0;
  const n = comps.length;
  for (let j = 0; j < B; j++) {
    const i = Math.floor(rnd() * n) % n;
    bx += comps[i][0];
    by += comps[i][1];
  }
  const g = quadGradA(A, w);
  return [g[0] - bx / B, g[1] - by / B];
}

/**
 * SGD 궤적. 길이 steps+1. 발산하면 그 자리에서 끊는다 (3편 gdPath 와 같은 규약이 아니라
 * 4편 optPath 쪽 — 발산한 좌표를 그리려 하면 캔버스 변환이 NaN 으로 오염된다).
 *
 * avgFrom 이 숫자면 그 스텝 **이후**의 반복평균도 함께 돌려준다(Polyak–Ruppert).
 */
export function sgdPath({
  A, comps, start, steps, eta, B = 1, seed = 1, schedule = 'const', avgFrom = null,
}) {
  const sch = SCHEDULES[schedule];
  if (!sch) throw new Error(`sgdPath: 모르는 schedule ${schedule}`);
  const rnd = mulberry32(seed);
  let w = [start[0], start[1]];
  const path = [[w[0], w[1]]];
  const avg = [[w[0], w[1]]];
  let ax = 0;
  let ay = 0;
  let acnt = 0;
  for (let k = 0; k < steps; k++) {
    const g = batchGradient(A, comps, w, B, rnd);
    const e = sch(k, eta);
    w = [w[0] - e * g[0], w[1] - e * g[1]];
    if (!Number.isFinite(w[0]) || !Number.isFinite(w[1])) break;
    path.push([w[0], w[1]]);
    if (avgFrom !== null && k + 1 > avgFrom) {
      ax += w[0]; ay += w[1]; acnt++;
      avg.push([ax / acnt, ay / acnt]);
    } else {
      avg.push([w[0], w[1]]);
    }
  }
  return { path, avg };
}

/**
 * 정상상태의 공. burn 스텝을 버리고 나머지로 RMS 거리와 **고유축별** 표준편차를 잰다.
 *
 * 고유축에 투영하는 것이 핵심이다. x·y 좌표로 재면 θ≠0° 에서 두 축이 섞여
 * 모양 비가 1 쪽으로 눌린다 — 공의 모양을 재는 게 아니라 좌표계를 재는 셈이 된다.
 *
 * 돌려주는 ratio 는 **급한축/평평축**이다. 손실 등고선의 반축비 1/√κ 와 같은 방향으로
 * 읽으라고 이 순서로 고정한다.
 */
export function noiseBall({
  A, comps, eta, B = 1, steps = 60000, burn = null, seed = 1, start = [0, 0],
}) {
  const b = burn === null ? Math.floor(steps / 2) : burn;
  const rnd = mulberry32(seed);
  const { v1, v2 } = symEigVec2(A);
  let w = [start[0], start[1]];
  let s2 = 0;
  let sa = 0;
  let sb = 0;
  let cnt = 0;
  for (let k = 0; k < steps; k++) {
    const g = batchGradient(A, comps, w, B, rnd);
    w = [w[0] - eta * g[0], w[1] - eta * g[1]];
    if (!Number.isFinite(w[0]) || !Number.isFinite(w[1])) return null;
    if (k >= b) {
      s2 += w[0] * w[0] + w[1] * w[1];
      const pa = w[0] * v1[0] + w[1] * v1[1];
      const pb = w[0] * v2[0] + w[1] * v2[1];
      sa += pa * pa; sb += pb * pb; cnt++;
    }
  }
  if (cnt === 0) return null;
  const stdSteep = Math.sqrt(sa / cnt);
  const stdFlat = Math.sqrt(sb / cnt);
  return {
    rms: Math.sqrt(s2 / cnt),
    stdSteep,
    stdFlat,
    ratio: stdFlat > 0 ? stdSteep / stdFlat : Infinity,
  };
}

/**
 * **이미 그린 궤적**에서 공의 통계를 뽑는다. burnFrac 앞부분(전이구간)은 버린다.
 *
 * 데모가 이 함수를 쓰는 이유: noiseBall 을 따로 부르면 화면에 그린 점과 readout 의
 * 숫자가 **다른 표본**에서 나온다. 독자가 산포를 보며 비를 읽는데 그 둘이 다른 난수열이면
 * 눈으로 확인이 안 된다. 같은 path 에서 계산해야 화면과 숫자가 일치한다.
 *
 * ⚠️ target 은 최소점이다. 기본값 [0,0] 은 데모 1 용이고, OLS 는 닫힌 해를 넘겨야 한다.
 */
export function ballFromPath(A, path, { burnFrac = 0.5, target = [0, 0] } = {}) {
  const from = Math.floor(path.length * burnFrac);
  const { v1, v2 } = symEigVec2(A);
  let s2 = 0;
  let sa = 0;
  let sb = 0;
  let cnt = 0;
  for (let i = from; i < path.length; i++) {
    const dx = path[i][0] - target[0];
    const dy = path[i][1] - target[1];
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
    s2 += dx * dx + dy * dy;
    const pa = dx * v1[0] + dy * v1[1];
    const pb = dx * v2[0] + dy * v2[1];
    sa += pa * pa; sb += pb * pb; cnt++;
  }
  if (cnt === 0) return null;
  const stdSteep = Math.sqrt(sa / cnt);
  const stdFlat = Math.sqrt(sb / cnt);
  return {
    rms: Math.sqrt(s2 / cnt),
    stdSteep,
    stdFlat,
    ratio: stdFlat > 0 ? stdSteep / stdFlat : Infinity,
    samples: cnt,
  };
}

/**
 * 정상상태 분산의 **예측값**. 노이즈가 A 의 고유축과 정렬돼 있을 때 축별로 정확하다.
 *
 *   c_i = η σ_i² / (λ_i (2 − η λ_i))
 *
 * w_{k+1} = (I−ηA)w_k − ηξ_k 의 정상 공분산을 축별로 풀면 나온다. η→0 에서
 * ησ_i²/(2λ_i) 로 가지만, 이 글은 η 를 꽤 크게도 쓰므로 **분모의 (2−ηλ) 를 남긴다.**
 * 그 항이 없으면 η=0.03·κ=30 에서 예측이 실측과 눈에 보이게 갈린다.
 *
 * ⚠️ 노이즈가 A 의 고유축과 정렬되지 않으면 축이 서로 결합해 이 식이 정확하지 않다.
 * 실데이터(데모 2)가 정확히 그 경우다 — 그쪽은 σ_i² 를 **투영해서** 넣고 근사로 쓴다.
 */
export function predictedBall({ A, Sigma, eta }) {
  const { l1, l2, v1, v2 } = symEigVec2(A);
  const proj = (v) => (
    v[0] * (Sigma[0][0] * v[0] + Sigma[0][1] * v[1])
    + v[1] * (Sigma[1][0] * v[0] + Sigma[1][1] * v[1])
  );
  const s1 = proj(v1);
  const s2 = proj(v2);
  const varOf = (sig, lam) => (eta * sig) / (lam * (2 - eta * lam));
  const c1 = varOf(s1, l1);
  const c2 = varOf(s2, l2);
  if (!(c1 > 0) || !(c2 > 0)) return null;
  return {
    rms: Math.sqrt(c1 + c2),
    stdSteep: Math.sqrt(c1),
    stdFlat: Math.sqrt(c2),
    ratio: Math.sqrt(c1 / c2),
  };
}

/**
 * 목표(초기 거리의 tol 배)에 도달한 반복수. 미도달이면 maxIters.
 *
 * avgFrom 을 주면 **반복평균 쪽 좌표로** 판정한다. 평균을 0 부터 켜면 전이구간이
 * 평균에 그대로 들어가 오히려 느려지는데, 그것이 §2-6 의 결과다.
 */
export function sgdStepsToTol({
  A, comps, start, eta, B = 1, tol = 1e-2, maxIters = 400000, seed = 1,
  schedule = 'const', avgFrom = null,
}) {
  const sch = SCHEDULES[schedule];
  if (!sch) throw new Error(`sgdStepsToTol: 모르는 schedule ${schedule}`);
  const rnd = mulberry32(seed);
  const d0 = Math.hypot(start[0], start[1]);
  let w = [start[0], start[1]];
  let ax = 0;
  let ay = 0;
  let acnt = 0;
  for (let k = 1; k <= maxIters; k++) {
    const g = batchGradient(A, comps, w, B, rnd);
    const e = sch(k - 1, eta);
    w = [w[0] - e * g[0], w[1] - e * g[1]];
    if (!Number.isFinite(w[0]) || !Number.isFinite(w[1])) return maxIters;
    let probe = w;
    if (avgFrom !== null && k > avgFrom) {
      ax += w[0]; ay += w[1]; acnt++;
      probe = [ax / acnt, ay / acnt];
    }
    if (Math.hypot(probe[0], probe[1]) <= tol * d0) return k;
  }
  return maxIters;
}

/** 시드 여러 개의 평균 반복수. 한 시드의 운을 결론으로 쓰지 않기 위해. */
export const DEFAULT_SEEDS = [1, 2, 3, 4, 5];

export function sgdStepsToTolAvg({ seeds = DEFAULT_SEEDS, ...opts }) {
  let sum = 0;
  let reached = true;
  for (const seed of seeds) {
    const n = sgdStepsToTol({ ...opts, seed });
    if (n >= (opts.maxIters ?? 400000)) reached = false;
    sum += n;
  }
  return { iters: sum / seeds.length, reached };
}

/**
 * 스케줄의 결정론적 진행량 Σₖ η_k. `inv` 가 왜 미도달인지 숫자로 보여주는 자다.
 *
 * 노이즈가 없다면 평평한 축(λ=1)이 tol 까지 줄기 위해 Σηₖ ≳ ln(1/tol) 이 필요하다.
 * `inv` 는 이 값이 로그로만 자라서 400k 스텝에서도 그 문턱에 못 닿는다.
 */
export function scheduleBudget(schedule, eta0, steps) {
  const sch = SCHEDULES[schedule];
  if (!sch) throw new Error(`scheduleBudget: 모르는 schedule ${schedule}`);
  let sum = 0;
  for (let k = 0; k < steps; k++) sum += sch(k, eta0);
  return sum;
}

// ---------------------------------------------------------------------------
// 실데이터 — 3·4편의 그 여섯 점을 미니배치로 푼다
// ---------------------------------------------------------------------------

/**
 * OLS 의 Hessian A = 2XᵀX. 3·4편과 **같은 규약**(합, 1/n 아님)이다.
 * 4편이 인용한 비대각 2Σx = 21 과 κ = 29.5 가 이 규약에서 나온다. 바꾸면 두 글이 어긋난다.
 */
export function olsHessian(points) {
  let sxx = 0;
  let sx = 0;
  for (const [x] of points) { sxx += x * x; sx += x; }
  return [[2 * sxx, 2 * sx], [2 * sx, 2 * points.length]];
}

/**
 * 닫힌 해에서의 미니배치 기울기 공분산 Σ (배치 1 기준).
 *
 * 한 점의 기울기는 gᵢ = 2rᵢ[xᵢ, 1] 이고, 전체 기울기의 불편추정량은 n·mean(gᵢ) 다.
 * 배치 1 의 공분산은 n²·Var(gᵢ) = n·Σᵢ gᵢgᵢᵀ − (Σgᵢ)(Σgᵢ)ᵀ 이고, 닫힌 해에서
 * Σgᵢ = 0 이므로 두 번째 항이 사라진다.
 *
 * 잔차가 등분산이면 Σ = 2σ²·A 가 되어 A 에 정확히 비례하고, 그때 공이 원이 된다.
 * **실데이터에서는 등분산이 아니다** — 그것이 데모 2 가 보여주는 것이다.
 */
export function olsNoiseCov(points) {
  const [a, b] = olsClosed(points);
  const n = points.length;
  const S = [[0, 0], [0, 0]];
  for (const [x, y] of points) {
    const r = a * x + b - y;
    const gx = 2 * r * x;
    const gy = 2 * r;
    S[0][0] += gx * gx; S[0][1] += gx * gy;
    S[1][0] += gy * gx; S[1][1] += gy * gy;
  }
  return S.map((row) => row.map((v) => v * n));
}

/** 잔차의 제곱이 얼마나 고르지 않은가 — Σ ∝ A 가 깨지는 정도의 눈금. */
export function residualSpread(points) {
  const [a, b] = olsClosed(points);
  const r2 = points.map(([x, y]) => (a * x + b - y) ** 2);
  const mn = Math.min(...r2);
  const mx = Math.max(...r2);
  return { min: mn, max: mx, ratio: mn > 0 ? mx / mn : Infinity };
}

/**
 * OLS 를 미니배치 SGD 로 푸는 궤적. 4편 olsOptPath 와 같은 규약 —
 * 반환값은 **항상 원 좌표** [a, b] 다.
 *
 * 배치 기울기는 n·mean(배치의 gᵢ) 로 만들어 전체 기울기의 불편추정량이 되게 한다.
 * (1/B)Σ 만 쓰면 기울기가 n 배 작아져 같은 η 에서 3·4편과 보폭이 달라진다.
 */
export function olsSgdPath({
  points, steps, eta, B = 1, seed = 1, center = false, schedule = 'const',
}) {
  const sch = SCHEDULES[schedule];
  if (!sch) throw new Error(`olsSgdPath: 모르는 schedule ${schedule}`);
  const { points: P, xbar } = center ? centerPoints(points) : { points, xbar: 0 };
  const n = P.length;
  const rnd = mulberry32(seed);
  let a = 0;
  let b = 0;
  const out = [[a, b - a * xbar]];
  for (let k = 0; k < steps; k++) {
    let g0 = 0;
    let g1 = 0;
    for (let j = 0; j < B; j++) {
      const i = Math.floor(rnd() * n) % n;
      const [x, y] = P[i];
      const r = a * x + b - y;
      g0 += 2 * r * x;
      g1 += 2 * r;
    }
    const e = sch(k, eta);
    a -= e * (n / B) * g0;
    b -= e * (n / B) * g1;
    if (!Number.isFinite(a) || !Number.isFinite(b)) break;
    out.push([a, b - a * xbar]);
  }
  return out;
}

/**
 * 닫힌 해 주변에서 OLS 미니배치의 공을 잰다. 반환 규약은 noiseBall 과 같다.
 * 출발점을 닫힌 해로 두어 전이구간 없이 정상상태만 재는 것이 핵심이다.
 */
export function olsNoiseBall({
  points, eta, B = 1, steps = 120000, burn = null, seed = 1,
}) {
  const bn = burn === null ? Math.floor(steps / 2) : burn;
  const A = olsHessian(points);
  const { v1, v2 } = symEigVec2(A);
  const [a0, b0] = olsClosed(points);
  const n = points.length;
  const rnd = mulberry32(seed);
  let a = a0;
  let b = b0;
  let s2 = 0;
  let sa = 0;
  let sb = 0;
  let cnt = 0;
  for (let k = 0; k < steps; k++) {
    let g0 = 0;
    let g1 = 0;
    for (let j = 0; j < B; j++) {
      const i = Math.floor(rnd() * n) % n;
      const [x, y] = points[i];
      const r = a * x + b - y;
      g0 += 2 * r * x;
      g1 += 2 * r;
    }
    a -= eta * (n / B) * g0;
    b -= eta * (n / B) * g1;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (k >= bn) {
      const dx = a - a0;
      const dy = b - b0;
      s2 += dx * dx + dy * dy;
      const pa = dx * v1[0] + dy * v1[1];
      const pb = dx * v2[0] + dy * v2[1];
      sa += pa * pa; sb += pb * pb; cnt++;
    }
  }
  if (cnt === 0) return null;
  const stdSteep = Math.sqrt(sa / cnt);
  const stdFlat = Math.sqrt(sb / cnt);
  return {
    rms: Math.sqrt(s2 / cnt),
    stdSteep,
    stdFlat,
    ratio: stdFlat > 0 ? stdSteep / stdFlat : Infinity,
  };
}

/** 데모 2·글의 기준 배치. 3·4편과 x 가 같아야 κ = 29.5 가 이어진다. */
export const FIT_POINTS = [
  [0.5, 0.35], [1.0, 0.62], [1.5, 0.71], [2.0, 1.05], [2.5, 1.15], [3.0, 1.45],
];

export { rotatedHessian, olsKappa, olsClosed };
