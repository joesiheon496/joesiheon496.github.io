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
  initState, optimizerStep, quadGradA, KINDS, DEFAULT_STARTS,
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

/** bestEta 는 무거우므로 (kind, κ, θ) 로 캐시한다. 스펙 §3-2 */
const etaCache = new Map();
function tableRow(kind, kappa, thetaDeg) {
  const key = `${kind}|${kappa}|${thetaDeg}`;
  if (etaCache.has(key)) return etaCache.get(key);
  const A = rotatedHessian(kappa, (thetaDeg * Math.PI) / 180);
  const opts = kind === 'momentum' ? { beta: betaFor(kappa) } : {};
  const r = bestEta({ kind, A, ...opts });
  etaCache.set(key, r);
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

  function contourPoints(A, c, theta) {
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
    const eta = tableRow(kind, vals.kappa, vals.theta).eta;

    // ⚠️ 별도의 clear 호출은 없다. drawGrid 가 ctx.clearRect 를 먼저 한다 (core.js).
    drawGrid(ctx, view, colors);

    // ⚠️ themeColors() 가 주는 키는 bg·fg·muted·grid·accent·accent2 뿐이다.
    // `faint` 같은 키는 없다. 등고선은 muted, GD 대조 궤적은 accent2, 선택한 방법은 accent.
    for (const c of [0.15, 0.6, 1.35, 2.4, 3.75]) {
      drawPolygon(ctx, view, contourPoints(A, c, theta), { stroke: colors.muted, width: 1 });
    }

    // GD 궤적을 항상 대조로 함께 그린다 — 비교가 그림 안에서 끝난다.
    if (kind !== 'gd') {
      const refEta = tableRow('gd', vals.kappa, vals.theta).eta;
      const ref = optPath({ kind: 'gd', A, start, steps: vals.steps, eta: refEta });
      drawPath(ctx, view, ref.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
        { color: colors.accent2, width: 1.5 });
    }

    const path = optPath({ kind, A, start, steps: vals.steps, eta, ...opts })
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    drawPath(ctx, view, path, { color: colors.accent, width: 2 });
    drawHandles(ctx, view, [start, [0, 0]], colors);

    // ── readout ──
    const rows = KINDS.map((k) => {
      const r = tableRow(k, vals.kappa, vals.theta);
      const cell = r.reached ? r.iters.toFixed(1) : '미도달';
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
        시작점 드래그는 그려지는 궤적에만 영향을 준다.
      </div>`;

    root.querySelector('.mv-hint').textContent =
      'θ 를 0° 에서 45° 로 밀어보세요. GD·모멘텀 칸은 그대로인데 AdaGrad·RMSProp 칸만 폭증합니다.';
  }

  // ⚠️ view.resize() 를 먼저 부르지 않으면 캔버스가 1×1 로 남아 아무것도 그려지지 않는다.
  // 기존 다섯 데모가 모두 이 세 줄로 끝난다 — 그대로 따른다.
  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
