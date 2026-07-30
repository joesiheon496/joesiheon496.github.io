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
import { olsClosed, olsKappa } from './optimize.js';
import { olsOffDiagonal, olsOptPath } from './adaptive.js';

const WORLD = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };

const LABEL = { gd: '경사하강법', rmsprop: 'RMSProp', adam: 'Adam' };
const CHOICES = ['gd', 'rmsprop', 'adam'];

// ⚠️ 오른쪽 치우침 배치. 대칭으로 두면 토글이 아무것도 하지 않는다 (스펙 §3-3).
const INITIAL = [[0.5, 0.2], [1.0, 0.6], [1.5, 0.9], [2.0, 1.4], [2.5, 1.7], [3.0, 2.2]];

const SLIDERS = [
  { key: 'steps', label: '반복', min: 0, max: 400, step: 1, value: 80, fmt: (v) => v.toFixed(0) },
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
    const kNow = olsKappa(pts);
    const dist = Math.hypot(now[0] - closed[0], now[1] - closed[1]);

    // 스펙 §5 — 세 방법의 반복수를 중심화 ON/OFF 로 나란히 놓아 배율을 보여준다.
    // 여기서는 회전이 없으므로 bestEta 가 아니라 고정 OLS_ETA(olsOptPath 의 기본값)로
    // 재고, 그 사실을 라벨에 밝힌다.
    const reach = (k, c) => {
      const sol = olsClosed(pts);
      const p = olsOptPath({ points: pts, steps: 400, kind: k, center: c });
      const d0 = Math.hypot(sol[0], sol[1]) || 1;
      for (let i = 1; i < p.length; i++) {
        if (Math.hypot(p[i][0] - sol[0], p[i][1] - sol[1]) <= 1e-3 * d0) return String(i);
      }
      return '미도달';
    };
    const cmp = CHOICES.map((k) =>
      `<tr><td>${LABEL[k]}</td><td style="text-align:right">${reach(k, false)}</td>`
      + `<td style="text-align:right">${reach(k, true)}</td></tr>`).join('');

    root.querySelector('.mv-matrix-host').innerHTML = '';
    root.querySelector('.mv-readout').innerHTML = `
      <div>XᵀX 무관항 2Σx = <b>${off.toFixed(2)}</b>${center ? ' → 중심화하면 0' : ''}</div>
      <div>σ₁ = ${kNow.s1.toPrecision(4)}, σ₂ = ${kNow.s2.toPrecision(4)}</div>
      <div>κ = (σ₁/σ₂)² = <b>${kNow.kappa.toPrecision(4)}</b></div>
      <div>${LABEL[kind]} ${vals.steps} 회 · 닫힌 해와의 거리 ${dist.toExponential(2)}</div>
      <table class="mv-table"><thead><tr>
        <th>방법</th><th style="text-align:right">중심화 OFF</th><th style="text-align:right">ON</th>
      </tr></thead><tbody>${cmp}</tbody></table>
      <div style="opacity:.7;font-size:.85em">
        표는 이 점 배치에서 1e-3 에 도달한 반복수다 (상한 400, 방법별 고정 η).
        거리는 중심화 여부와 무관하게 원 좌표에서 잰다.
        회색 선(닫힌 해)은 토글에 움직이지 않는다.
      </div>`;

    root.querySelector('.mv-hint').textContent =
      '점을 오른쪽 끝에 뭉쳐보세요. 무관항이 커지면 RMSProp 이 GD 보다도 느려집니다. '
      + 'x 중심화를 켜면 무관항이 0 이 되고 RMSProp 이 즉시 따라붙습니다.';
  }

  // ⚠️ view.resize() 를 먼저 부르지 않으면 캔버스가 1×1 로 남아 아무것도 그려지지 않는다.
  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
