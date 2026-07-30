// static/js/mathviz/tilted.js
// 데모 1 — 기울어지는 등고선.
//
// 손실은 f(x) = ½xᵀAx, A = R(θ)diag(1,κ)R(θ)ᵀ. **κ 를 고정한 채 θ 만 돌려
// 정렬 효과를 분리한다** — 이것이 이 데모의 존재 이유다. 데모 2(직선맞춤)에서는
// 중심화가 무관항을 0 으로 만드는 동시에 κ 도 낮춰서 두 효과를 가를 수 없다. 스펙 §범위
//
// ⚠️ readout 표는 드래그 점이 아니라 DEFAULT_STARTS 5개 평균으로 계산한다.
// 드래그 점 하나로 표를 만들면 사용자가 우연히 고유벡터 위에 올려놓는 순간
// 표가 전부 1 이 되어 글의 논지가 화면에서 무너진다. 스펙 §3-1

import {
  themeColors, onThemeChange, createView, drawGrid, drawPolygon,
  drawPath, drawHandles, makeSliders, makeRadios, attachDrag,
} from './core.js';
import {
  rotatedHessian, diagPreconditionedKappa, optPath, bestEta, effectiveEta,
  initState, optimizerStep, quadGradA, KINDS,
} from './adaptive.js';

const WORLD = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };

const LABEL = {
  gd: '경사하강법', momentum: '모멘텀', adagrad: 'AdaGrad',
  rmsprop: 'RMSProp', adam: 'Adam',
};

const SLIDERS = [
  { key: 'kappa', label: 'κ (조건수)', min: 1, max: 100, step: 1, value: 30, fmt: (v) => v.toFixed(0) },
  { key: 'theta', label: 'θ (기울기)', min: 0, max: 90, step: 1, value: 0, fmt: (v) => `${v.toFixed(0)}°` },
  { key: 'steps', label: '반복', min: 0, max: 400, step: 1, value: 60, fmt: (v) => v.toFixed(0) },
];

// ⚠️ η 슬라이더는 두지 않는다. bestEta 가 고른 값을 쓰고 readout 에 표시한다.
// 절대 η 슬라이더로 되돌리지 말 것 — GD 발산 문턱 2/κ 가 이 데모의 κ 범위(1~100)에서
// 100배 움직여서, κ=30 에 맞춘 기본값은 κ=100 에서 발산하고 κ=1 에서는 최적의 1/30 이 된다.
// 계획서 초안이 절대값이었고 사전 측정에서 모멘텀 기본값이 미도달로 잡혔다. 스펙 §4

const RADIO = {
  key: 'kind', label: '방법', value: 'gd',
  options: KINDS.map((k) => ({ value: k, label: LABEL[k] })),
};

const betaFor = (kappa) => Math.pow((Math.sqrt(kappa) - 1) / (Math.sqrt(kappa) + 1), 2);

/** 표 계산을 미루는 시간. 슬라이더 한 칸을 지나갈 때마다 다시 재지 않을 만큼만 길다. */
const TABLE_DEBOUNCE_MS = 200;

/**
 * bestEta 는 무거우므로 (kind, κ, θ) 로 캐시한다. 스펙 §3-2
 *
 * ⚠️ 캐시만으로는 부족하다. makeSliders 는 `input` 이벤트로 붙어 있어서 드래그 중
 * **바뀌는 값마다** 콜백이 오고, 새 정수 θ 는 전부 캐시 miss 다. miss 한 번이
 * 5 시작점 × 88 η 그리드 × 최대 4000 반복 × 5 방법 = 실측 300~390 ms 의 동기 작업이다.
 * 글의 지시가 "θ 를 0° 에서 45° 로 밀어보세요" 이므로, 그대로 하면 miss 가 45 번
 * 연달아 나서 메인 스레드가 15 초쯤 멈춘다.
 *
 * 그래서 그리기를 둘로 가른다 — 격자·등고선·궤적·표 밖 readout 은 매 프레임 그리고,
 * 다섯 방법 표만 scheduleTable() 로 미룬다. 미루는 동안 표는 직전 (κ, θ) 의 값을
 * `(갱신 중)` 표시와 함께 보여준다. 표시 없이 옛 숫자를 두면 독자가 그것을 지금
 * (κ, θ) 의 값으로 읽는다. 궤적은 lastEta 로 그려서 끊기지 않는다.
 *
 * ⚠️ makeSliders 나 그 이벤트 종류를 고쳐서 해결하지 말 것 — 다른 데모 다섯 개가
 * 같은 함수에 의존한다. 완화책은 이 파일 안에 있어야 한다. 스펙 §3-2 가 요구한 것이
 * 정확히 이것이고, 캐시만 들어와 있었다. "단순화" 로 되돌리지 말 것.
 */
const etaCache = new Map();

/** 방법별로 **마지막으로 실제 쓴** η. 캐시 miss 인 (κ, θ) 에서 궤적을 그릴 때 쓴다. */
const lastEta = new Map();

const cacheKey = (kind, kappa, thetaDeg) => `${kind}|${kappa}|${thetaDeg}`;

/** 캐시에 있으면 그 행, 없으면 undefined. 절대 계산하지 않는다. */
const cachedRow = (kind, kappa, thetaDeg) => etaCache.get(cacheKey(kind, kappa, thetaDeg));

/** 비싼 쪽. 캐시에 없으면 bestEta 를 돌린다 — 디바운스된 자리와 init 에서만 부른다. */
function computeRow(kind, kappa, thetaDeg) {
  const key = cacheKey(kind, kappa, thetaDeg);
  const hit = etaCache.get(key);
  if (hit) return hit;
  const A = rotatedHessian(kappa, (thetaDeg * Math.PI) / 180);
  const opts = kind === 'momentum' ? { beta: betaFor(kappa) } : {};
  const r = bestEta({ kind, A, ...opts });
  etaCache.set(key, r);
  lastEta.set(kind, r.eta);
  return r;
}

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');   // draw() 안에서 매번 얻지 않는다 (기존 데모와 같다)
  const view = createView(canvas, WORLD);
  let start = [2.5, 0.7];   // ⚠️ |x| ≠ |y| — 스펙 §3-1
  let vals = { kappa: 30, theta: 0, steps: 60 };
  let kind = 'gd';

  const sliderHost = root.querySelector('.mv-sliders');
  makeSliders(sliderHost, SLIDERS, (v) => { vals = v; draw(); });
  // ⚠️ makeSliders 가 host 를 비우므로 반드시 그 뒤에 부른다.
  makeRadios(sliderHost, RADIO, (v) => { kind = v.kind; draw(); });

  attachDrag(canvas, view, () => [start], (i, p) => { start = p; draw(); });

  // 표에 지금 그려져 있는 마지막 **완성분**. 계산이 미뤄지는 동안 이것을 보여준다.
  let shownRows = null;
  let pendingTable = 0;

  /** 현재 (κ, θ) 의 다섯 행을 디바운스로 계산한 뒤 다시 그린다. 앞선 예약은 취소한다. */
  function scheduleTable() {
    clearTimeout(pendingTable);
    pendingTable = setTimeout(() => {
      pendingTable = 0;
      KINDS.forEach((k) => computeRow(k, vals.kappa, vals.theta));
      draw();
    }, TABLE_DEBOUNCE_MS);
  }

  /**
   * 궤적과 readout 이 쓰는 η. 캐시가 있으면 그 값이고, 없으면 그 방법에 **마지막으로
   * 쓴** η 로 그린다 — 표가 갱신되기 전에도 궤적이 끊기지 않게 하려는 것이다.
   * 아무것도 모르는 상태는 init 의 동기 계산 이전뿐이라 그때만 직접 계산한다.
   */
  function etaFor(k) {
    const hit = cachedRow(k, vals.kappa, vals.theta);
    if (hit) return hit.eta;
    const last = lastEta.get(k);
    return last !== undefined ? last : computeRow(k, vals.kappa, vals.theta).eta;
  }

  function contourPoints(c, theta) {
    // xᵀAx = 2c 의 등위선은 축정렬 타원을 θ 만큼 회전한 것이다.
    // 새 도형 코드 없이 3편의 64각형을 회전만 시킨다.
    const kappa = vals.kappa;
    const a = Math.sqrt(2 * c);
    const b = a / Math.sqrt(kappa);
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const out = [];
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      const x = a * Math.cos(t);
      const y = b * Math.sin(t);
      out.push([x * ct - y * st, x * st + y * ct]);
    }
    return out;
  }

  function draw() {
    const colors = themeColors();
    const theta = (vals.theta * Math.PI) / 180;
    const A = rotatedHessian(vals.kappa, theta);
    const opts = kind === 'momentum' ? { beta: betaFor(vals.kappa) } : {};
    // η 는 표와 궤적이 같은 값을 쓴다 — 캐시된 bestEta 결과에서 가져온다.
    // 표가 아직 안 갱신된 (κ, θ) 에서는 그 방법에 마지막으로 쓴 η 를 쓴다 (etaFor).
    const eta = etaFor(kind);

    // ⚠️ 별도의 clear 호출은 없다. drawGrid 가 ctx.clearRect 를 먼저 한다 (core.js).
    drawGrid(ctx, view, colors);

    // ⚠️ themeColors() 가 주는 키는 bg·fg·muted·grid·accent·accent2 뿐이다.
    // `faint` 같은 키는 없다. 등고선은 muted, GD 대조 궤적은 accent2, 선택한 방법은 accent.
    for (const c of [0.15, 0.6, 1.35, 2.4, 3.75]) {
      drawPolygon(ctx, view, contourPoints(c, theta), { stroke: colors.muted, width: 1 });
    }

    // 최소점(원점) 표식. ⚠️ drawHandles 로 그리지 말 것 — core.js 의 그 함수는 모든 점을
    // 똑같은 accent2 원으로 찍는데 attachDrag 는 start 하나만 노출하므로 원점이 끌 수 있는
    // 것처럼 보인다. 게다가 accent2 는 GD 대조 궤적의 색이고 모든 궤적이 원점에서 끝나서,
    // 수렴점에서 빨간 핸들이 빨간 선 위에 겹친다. 3편 descent.js 와 같은 흐린 십자다. 스펙 §4
    const [ox, oy] = view.toPixel([0, 0]);
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ox - 6, oy); ctx.lineTo(ox + 6, oy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox, oy - 6); ctx.lineTo(ox, oy + 6); ctx.stroke();

    // GD 궤적을 항상 대조로 함께 그린다 — 비교가 그림 안에서 끝난다.
    if (kind !== 'gd') {
      const ref = optPath({ kind: 'gd', A, start, steps: vals.steps, eta: etaFor('gd') });
      drawPath(ctx, view, ref.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
        { color: colors.accent2, width: 1.5 });
    }

    const path = optPath({ kind, A, start, steps: vals.steps, eta, ...opts })
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    drawPath(ctx, view, path, { color: colors.accent, width: 2 });
    // 각 스텝에 작은 원 — 지그재그의 밀도를 읽는 장치다. 3편 descent.js 와 같다. 스펙 §4
    ctx.fillStyle = colors.accent;
    for (const p of path) {
      const [px, py] = view.toPixel(p);
      ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    drawHandles(ctx, view, [start], colors);

    // ── readout ──
    // 표는 다섯 행이 모두 캐시에 있을 때만 갱신한다. 하나라도 없으면 계산을 디바운스로
    // 미루고 직전 완성분을 `(갱신 중)` 과 함께 보여준다. 스펙 §3-2
    const fresh = KINDS.map((k) => cachedRow(k, vals.kappa, vals.theta));
    const tableReady = fresh.every(Boolean);
    if (tableReady) shownRows = fresh;
    else scheduleTable();

    const shown = shownRows || fresh;
    const rows = KINDS.map((k, i) => {
      const r = shown[i];
      const cell = !r
        ? '—'
        : r.reached
          ? `<span class="ok">${r.iters.toFixed(1)}</span>`
          : '<span class="no">미도달</span>';
      const mark = k === kind ? ' ◀' : '';
      return `<tr><td>${LABEL[k]}</td><td style="text-align:right">${cell}${mark}</td></tr>`;
    }).join('');

    const kd = diagPreconditionedKappa(A);

    let effLine = '';
    if (kind === 'adagrad' || kind === 'rmsprop' || kind === 'adam') {
      let st = initState();
      let p = [start[0], start[1]];
      for (let i = 0; i < vals.steps; i++) {
        const g = quadGradA(A, p);
        if (!Number.isFinite(g[0])) break;
        const r = optimizerStep(kind, st, g, { eta, ...opts });
        st = r.state;
        p = [p[0] - r.step[0], p[1] - r.step[1]];
      }
      const [e0, e1] = effectiveEta(kind, st, { eta, ...opts });
      effLine = `<div>유효 학습률 (x, y): ${e0.toPrecision(3)}, ${e1.toPrecision(3)}</div>`;
    }

    root.querySelector('.mv-matrix-host').innerHTML = '';
    root.querySelector('.mv-readout').innerHTML = `
      <div>κ = ${vals.kappa}, θ = ${vals.theta}°, η = ${eta.toPrecision(3)} (자동 선택)</div>
      <div>대각 전처리 후 κ(D⁻¹A) = <b>${kd.toPrecision(4)}</b></div>
      ${effLine}
      <table class="mv-table"><thead>
        <tr><th>방법</th><th style="text-align:right">반복수</th></tr>
      </thead><tbody>${rows}</tbody></table>
      <div style="opacity:.7;font-size:.85em">
        표는 시작점 5개 평균 · 각 방법의 최적 η 기준이다.
        시작점 드래그는 그려지는 궤적에만 영향을 준다.${tableReady ? ''
        : ' <b>(갱신 중 — 위 표는 아직 직전 κ·θ 의 값이다)</b>'}
      </div>`;

    root.querySelector('.mv-hint').textContent =
      'θ 를 0° 에서 45° 로 밀어보세요. GD·모멘텀 칸은 그대로인데 AdaGrad·RMSProp 칸만 폭증합니다.';
  }

  // 첫 렌더만 동기로 계산한다 — 데모가 채워진 표로 열려야 한다. 여기서 lastEta 가
  // 다섯 방법 모두 채워지므로 이후 캐시 miss 에서도 궤적이 그려질 η 가 항상 있다.
  KINDS.forEach((k) => computeRow(k, vals.kappa, vals.theta));

  // ⚠️ view.resize() 를 먼저 부르지 않으면 캔버스가 1×1 로 남아 아무것도 그려지지 않는다.
  // 기존 다섯 데모가 모두 이 세 줄로 끝난다 — 그대로 따른다.
  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
