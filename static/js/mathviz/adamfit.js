// static/js/mathviz/adamfit.js
// 데모 2 — 3편 직선맞춤의 세 번째 방문.
//
// 2편은 SVD 닫힌 해로, 3편은 GD 와 중심화로 풀었다. 여기서는 축별 보폭으로 풀고,
// **3편의 중심화 토글이 실은 Hessian 을 대각화하는 작업이었음**을 보인다.
// XᵀX 의 무관항 2Σx 가 0 이 되는 것이 이 글의 언어로 "축이 맞았다" 다.
//
// ⚠️ 이 데모만으로는 축 문장을 주장할 수 없다. 중심화는 무관항을 0 으로 만드는 동시에
// κ 도 낮추기 때문이다(29.5 → 1.4). 정렬 효과를 분리하는 것은 데모 1 이다. 스펙 §범위
// ⚠️ 초기 배치를 치우치게 둔다. x 가 이미 중심이면 무관항이 0 이라 토글이 아무 일도
// 하지 않는다. 스펙 §3-3

import {
  themeColors, onThemeChange, createView, drawGrid, drawPath,
  drawHandles, makeSliders, makeToggles, makeRadios, attachDrag,
} from './core.js';
import { olsClosed, olsKappa, centerPoints } from './optimize.js';
import { olsOffDiagonal, olsOptPath } from './adaptive.js';

const WORLD = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
// 반복 상한. ⚠️ 슬라이더 최댓값·reach() 의 상한·표 캡션의 "상한 400" 이 같은 수여야 한다.
// 세 자리에 400 을 따로 적어두면 캡션이 조용히 동작과 어긋난다. 3편 gdfit.js 와 같은 규약이다.
const MAX_STEPS = 400;

const LABEL = { gd: '경사하강법', rmsprop: 'RMSProp', adam: 'Adam' };
const CHOICES = ['gd', 'rmsprop', 'adam'];

// ⚠️ 오른쪽 치우침 배치. 대칭으로 두면 토글이 아무것도 하지 않는다 (스펙 §3-3).
const INITIAL = [[0.5, 0.2], [1.0, 0.6], [1.5, 0.9], [2.0, 1.4], [2.5, 1.7], [3.0, 2.2]];

const SLIDERS = [
  { key: 'steps', label: '반복', min: 0, max: MAX_STEPS, step: 1, value: 80, fmt: (v) => v.toFixed(0) },
];
const TOGGLES = [{ key: 'center', label: 'x 중심화', value: false }];
const RADIO = {
  key: 'kind', label: '방법', value: 'gd',
  options: CHOICES.map((k) => ({ value: k, label: LABEL[k] })),
};

const lineOf = ([a, b]) => [[-3, a * -3 + b], [3, a * 3 + b]];

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');   // draw() 안에서 매번 얻지 않는다
  const view = createView(canvas, WORLD);
  const pts = INITIAL.map(([x, y]) => [x, y]);
  let vals = { steps: 80 };
  let center = false;
  let kind = 'gd';

  const sliderHost = root.querySelector('.mv-sliders');
  makeSliders(sliderHost, SLIDERS, (v) => { vals = v; draw(); });
  // ⚠️ makeSliders 가 host 를 비우므로 아래 둘은 반드시 그 뒤에 부른다.
  makeToggles(sliderHost, TOGGLES, (v) => { center = v.center; draw(); });
  makeRadios(sliderHost, RADIO, (v) => { kind = v.kind; draw(); });

  attachDrag(canvas, view, () => pts, (i, p) => { pts[i] = p; draw(); });

  function draw() {
    const colors = themeColors();
    // ⚠️ 별도의 clear 호출은 없다. drawGrid 가 ctx.clearRect 를 먼저 한다 (core.js).
    drawGrid(ctx, view, colors);

    const closed = olsClosed(pts);
    const path = olsOptPath({ points: pts, steps: vals.steps, kind, center });
    const now = path[path.length - 1];

    // y 방향 잔차 — 3편과 같다. 2편은 수직 거리였고, 그 차이가 목적함수 변경을 눈으로 보여준다.
    // ⚠️ colors.grid(--border) 로 그으면 drawGrid 의 격자와 색도 두께도 같아져 데이터로
    // 안 읽힌다. 3편 gdfit.js 와 같은 colors.muted 를 쓴다. `faint` 같은 키는 없다.
    for (const [x, y] of pts) {
      drawPath(ctx, view, [[x, y], [x, now[0] * x + now[1]]], { color: colors.muted, width: 1 });
    }

    // 회색 선 = 닫힌 해. 중심화 토글과 무관하게 **불변**이다 (3편 §3-4).
    drawPath(ctx, view, lineOf(closed), { color: colors.muted, width: 3 });
    drawPath(ctx, view, lineOf(now), { color: colors.accent, width: 2 });
    drawHandles(ctx, view, pts, colors);

    const off = olsOffDiagonal(pts);
    // ⚠️ κ 를 원 배치에서만 재면 중심화 토글에 readout 이 꿈쩍하지 않는다. 글은 이 데모
    // 바로 아래에서 "중심화를 켜면 κ 가 29.5 에서 1.4 로 떨어진다" 고 말하는데, 독자가 그
    // 토글을 켜도 화면의 κ 가 29.45 에 그대로 있으면 글과 화면 중 하나를 틀린 것으로 읽는다.
    // 3편 gdfit.js 처럼 두 값을 배율과 함께 나란히 찍어 그 전이가 화면에 보이게 한다. 스펙 §8-6
    const { s1, s2, kappa: rawK } = olsKappa(pts);
    const cenK = olsKappa(centerPoints(pts).points).kappa;
    // κ 는 3편과 같은 소수 한 자리로 찍는다 — 글이 인용하는 29.5 / 1.4 와 자리를 맞춘다.
    const fmtK = (k) => (Number.isFinite(k) ? k.toFixed(1) : '∞');
    const dist = Math.hypot(now[0] - closed[0], now[1] - closed[1]);

    // 스펙 §5 — 세 방법의 반복수를 중심화 ON/OFF 로 나란히 놓아 배율을 보여준다.
    // 여기서는 회전이 없으므로 bestEta 가 아니라 고정 OLS_ETA(olsOptPath 의 기본값)로
    // 재고, 그 사실을 라벨에 밝힌다.
    const reach = (k, c) => {
      const sol = olsClosed(pts);
      const p = olsOptPath({ points: pts, steps: MAX_STEPS, kind: k, center: c });
      const d0 = Math.hypot(sol[0], sol[1]) || 1;
      for (let i = 1; i < p.length; i++) {
        if (Math.hypot(p[i][0] - sol[0], p[i][1] - sol[1]) <= 1e-3 * d0) {
          return `<span class="ok">${i}</span>`;
        }
      }
      return '<span class="no">미도달</span>';
    };
    const cmp = CHOICES.map((k) =>
      `<tr><td>${LABEL[k]}</td><td style="text-align:right">${reach(k, false)}</td>`
      + `<td style="text-align:right">${reach(k, true)}</td></tr>`).join('');

    root.querySelector('.mv-matrix-host').innerHTML = '';
    root.querySelector('.mv-readout').innerHTML = `
      <div>XᵀX 무관항 2Σx = <b>${off.toFixed(2)}</b>${center ? ' → 중심화하면 0' : ''}</div>
      <div>σ₁ = ${s1.toPrecision(4)}, σ₂ = ${s2.toPrecision(4)}</div>
      <div>κ = (σ₁/σ₂)² = <b>${fmtK(rawK)}</b></div>
      <div>중심화 없이 κ = ${fmtK(rawK)} &nbsp;·&nbsp; 중심화하면 κ = ${fmtK(cenK)}
        ${Number.isFinite(rawK / cenK) ? `(<b>${(rawK / cenK).toFixed(1)}배</b>)` : ''}</div>
      <div>${LABEL[kind]} ${vals.steps} 회 · 닫힌 해와의 거리 ${dist.toExponential(2)}</div>
      <table class="mv-table"><thead><tr>
        <th>방법</th><th style="text-align:right">중심화 OFF</th><th style="text-align:right">ON</th>
      </tr></thead><tbody>${cmp}</tbody></table>
      <div style="opacity:.7;font-size:.85em">
        표는 이 점 배치에서 1e-3 에 도달한 반복수다 (상한 ${MAX_STEPS}, 방법별 고정 η).
        거리는 중심화 여부와 무관하게 원 좌표에서 잰다.
        회색 선(닫힌 해)은 토글에 움직이지 않는다.
      </div>`;

    // ⚠️ 힌트로 "점을 오른쪽 끝에 뭉쳐 RMSProp 과 GD 를 비교해보라" 고 하지 말 것.
    // κ 가 100 을 넘어가면 중심화 OFF 열 세 칸이 전부 상한에 걸려 `미도달` 이 되어 비교할
    // 숫자 자체가 화면에 없고, 초기 배치에서는 110 대 102 로 참이지만 눈에 띄지 않는다.
    // 중심화 ON/OFF 대비는 전 구간에서 성립하므로 그쪽을 앞세운다.
    root.querySelector('.mv-hint').textContent =
      'x 중심화 를 켜보세요. 무관항이 0 으로 떨어지고 RMSProp 이 곧바로 따라붙는데, '
      + '점을 오른쪽 끝으로 뭉칠수록 중심화 OFF 열이 상한에 걸려 그 격차가 더 벌어집니다. '
      + 'Adam 은 축이 안 맞아도 덜 망가지는 대신, 축을 맞춰줘도 가장 조금만 빨라집니다.';
  }

  // ⚠️ view.resize() 를 먼저 부르지 않으면 캔버스가 1×1 로 남아 아무것도 그려지지 않는다.
  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
