// static/js/mathviz/slerppath.js
// 데모 2 — 보간 세 방법이 **서로 다른 방식으로** 틀린다.
//
// 왼쪽은 한 축 끝점이 그리는 3D 자취, 오른쪽은 스텝마다의 회전각이다.
// 오른쪽이 핵심이다 — SLERP 은 **수평선**이고 나머지는 출렁인다.
//
// 🔑 세 방법이 갈리는 방식이 다르다 (스펙 §2-6):
//   오일러 선형   경로가 틀리다  (Δ=150° 에서 총 232°)
//   행렬선형+투영 경로는 맞고 속도가 틀리다 (초과 0.000° 인데 균일성 700배)
//   SLERP        둘 다 맞다
// 그래서 **총길이와 균일성을 같이** 보여줘야 한다 (스펙 §3-6).
//
// 색 (스펙 §3-8): 오일러 accent(청) · 행렬투영 accent3(녹) · SLERP accent2(적)

import {
  add, scale, normalize, matMul, projectPoint,
} from './camera.js';
import {
  eulerToR, expSO3, interpolate, pathMetrics, quatFromR, rFromQuat, slerp,
  angleBetween,
} from './so3.js';
import { OBS, GROUND_LINES, drawPolys } from './scene.js';
import {
  themeColors, onThemeChange, createView, drawPath,
  makeSliders, makeToggles,
} from './core.js';

const D = 180 / Math.PI;
const AXIS_LEN = 2.4;
/** 시작 자세와 회전축 — 스펙 §2-6 의 실측 배치와 같게 둔다. */
const START = [0.2, 0.3, -0.1];
const AXIS = normalize([0.4, 0.8, -0.3]);
const MODES = [
  { key: 'euler', label: '오일러 선형', color: 'accent' },
  { key: 'matrix', label: '행렬선형+투영', color: 'accent3' },
  { key: 'slerp', label: 'SLERP', color: 'accent2' },
];

export function init(root) {
  const canvases = root.querySelectorAll('canvas');
  if (canvases.length < 2) throw new Error('slerppath 는 panes="2" 가 필요하다');
  const [sceneCanvas, stepCanvas] = canvases;

  const sceneWorld = { xmin: 60, xmax: 420, ymin: 430, ymax: 70 };
  const stepWorld = { xmin: 0, xmax: 10, ymin: 0, ymax: 40 };
  const sceneView = createView(sceneCanvas, sceneWorld);
  const stepView = createView(stepCanvas, stepWorld);

  const sliderHost = root.querySelector('.mv-sliders');
  const readout = root.querySelector('.mv-readout');
  const hint = root.querySelector('.mv-hint');

  const state = { delta: 150, steps: 10 };
  let toggles;

  makeSliders(sliderHost, [
    { key: 'delta', label: '두 자세 사이 각', min: 10, max: 179, step: 1, value: 150,
      fmt: (v) => `${v.toFixed(0)}°` },
    { key: 'steps', label: '스텝 수', min: 4, max: 40, step: 1, value: 10,
      fmt: (v) => `${v.toFixed(0)}` },
  ], (v) => { Object.assign(state, v); render(); });

  toggles = makeToggles(sliderHost, [
    { key: 'align', label: '쿼터니언 부호 맞추기', value: true },
    { key: 'showEuler', label: '오일러 선형 보기', value: true },
    { key: 'showMatrix', label: '행렬선형+투영 보기', value: true },
  ], render);

  const endpoints = () => {
    const R0 = eulerToR(START);
    return { R0, R1: matMul(expSO3(scale(AXIS, state.delta / D)), R0) };
  };

  /** 한 축(첫 열) 끝점이 그리는 자취. 자취가 곧 경로다. */
  const traceOf = (path) => path.map(
    (R) => add([0, 0, 0.05], scale([R[0][0], R[1][0], R[2][0]], AXIS_LEN)),
  );

  /** SLERP 만 부호 토글의 영향을 받는다 — 그것이 이중덮개 시연이다. */
  function pathFor(mode, R0, R1, align) {
    if (mode !== 'slerp') return interpolate(R0, R1, state.steps, mode);
    const q0 = quatFromR(R0);
    let q1 = quatFromR(R1);
    if (!align) q1 = q1.map((v) => -v);       // 일부러 뒤집는다 — 같은 회전이다
    return Array.from({ length: state.steps + 1 }, (_, i) => rFromQuat(
      slerp(q0, q1, i / state.steps, { align }),
    ));
  }

  function render() {
    const c = themeColors();
    const { align, showEuler, showMatrix } = toggles.getValues();
    const { R0, R1 } = endpoints();

    const active = MODES.filter((m) => (
      m.key === 'slerp' || (m.key === 'euler' ? showEuler : showMatrix)
    ));
    const paths = new Map(active.map((m) => [m.key, pathFor(m.key, R0, R1, align)]));

    // ---------- 왼쪽: 3D 자취 ----------
    sceneView.resize();
    const ctx = sceneCanvas.getContext('2d');
    const { w, h } = sceneView.size;
    ctx.clearRect(0, 0, w, h);
    drawPolys(ctx, sceneView, OBS, GROUND_LINES, { color: c.grid, width: 1 });
    // 시작·끝 트라이어드 첫 축
    for (const R of [R0, R1]) {
      const tip = add([0, 0, 0.05], scale([R[0][0], R[1][0], R[2][0]], AXIS_LEN));
      drawPolys(ctx, sceneView, OBS, [[[0, 0, 0.05], tip]], { color: c.fg, width: 2 });
    }
    // 세 자취
    for (const m of active) {
      const trace = traceOf(paths.get(m.key));
      drawPolys(ctx, sceneView, OBS, [trace], { color: c[m.color], width: m.key === 'slerp' ? 2.8 : 1.8 });
      // 스텝 위치에 점 — 속도 불균일이 점 간격으로 보인다
      for (const P of trace) {
        const p = projectDot(P);
        if (!p) continue;
        ctx.beginPath(); ctx.arc(p[0], p[1], m.key === 'slerp' ? 3 : 2.2, 0, Math.PI * 2);
        ctx.fillStyle = c[m.color]; ctx.fill();
      }
    }

    // ---------- 오른쪽: 스텝각 ----------
    stepView.resize();
    const sctx = stepCanvas.getContext('2d');
    const ss = stepView.size;
    sctx.clearRect(0, 0, ss.w, ss.h);
    const metrics = new Map(active.map((m) => [m.key, pathMetrics(paths.get(m.key))]));
    const allSteps = [...metrics.values()].flatMap((mm) => mm.steps.map((v) => v * D));
    stepWorld.xmin = 0;
    stepWorld.xmax = state.steps;
    stepWorld.ymin = 0;
    stepWorld.ymax = Math.max(...allSteps) * 1.15 + 0.5;

    sctx.font = '11px system-ui, sans-serif';
    sctx.strokeStyle = c.grid;
    sctx.lineWidth = 1;
    sctx.fillStyle = c.muted;
    const yStep = niceStep(stepWorld.ymax);
    for (let y = 0; y <= stepWorld.ymax; y += yStep) {
      const [, py] = stepView.toPixel([0, y]);
      sctx.beginPath(); sctx.moveTo(0, py); sctx.lineTo(ss.w, py); sctx.stroke();
      sctx.fillText(`${y.toFixed(y < 10 ? 1 : 0)}°`, 3, py - 3);
    }
    // 균일 속도 기준선 = 측지선 / 스텝수
    {
      const ideal = (angleBetween(R0, R1) * D) / state.steps;
      const [, py] = stepView.toPixel([0, ideal]);
      sctx.save(); sctx.setLineDash([4, 4]); sctx.strokeStyle = c.fg;
      sctx.beginPath(); sctx.moveTo(0, py); sctx.lineTo(ss.w, py); sctx.stroke();
      sctx.restore();
    }
    for (const m of active) {
      const mm = metrics.get(m.key);
      const pts = mm.steps.map((v, i) => [i + 0.5, v * D]);
      drawPath(sctx, stepView, pts, { color: c[m.color], width: m.key === 'slerp' ? 2.8 : 1.8 });
    }

    renderReadout(R0, R1, metrics, align);
  }

  /** 관찰자 카메라로 점 하나를 캔버스 좌표로. 뒤에 있으면 null. */
  function projectDot(P) {
    const q = projectPoint(OBS, P);
    return q.z > 1e-6 ? sceneView.toPixel([q.u, q.v]) : null;
  }

  const niceStep = (span) => {
    const raw = span / 5;
    const mag = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((k) => k * mag).find((v) => v >= raw) ?? mag * 10;
  };

  function renderReadout(R0, R1, metrics, align) {
    const geo = angleBetween(R0, R1) * D;
    const row = (m) => {
      const mm = metrics.get(m.key);
      if (!mm) return '';
      const excess = mm.excess * D;
      const bad = (v, t) => (v > t ? 'no' : 'ok');
      return `<div><span class="${m.color === 'accent' ? 'hi' : m.color === 'accent3' ? 'ok' : 'no'}">■</span>
        ${m.label} — 균일성 <b class="${bad(mm.uniformity, 1.05)}">${fmtU(mm.uniformity)}</b>
        · 총길이 ${(mm.total * D).toFixed(2)}°
        · 초과 <b class="${bad(Math.abs(excess), 0.05)}">${excess >= 0 ? '+' : ''}${excess.toFixed(3)}°</b></div>`;
    };
    readout.innerHTML = `
      <div>측지선 = <b>${geo.toFixed(2)}°</b> · 스텝 ${state.steps}개 ·
        균일 속도라면 스텝당 ${(geo / state.steps).toFixed(3)}°</div>
      ${MODES.map(row).join('')}
      ${align ? '' : `<div class="mv-note">부호를 뒤집었습니다 — q 와 −q 는 같은 회전인데
        SLERP 이 <b>${(360 - geo).toFixed(0)}°</b> 쪽 긴 길로 갑니다</div>`}`;

    hint.innerHTML = `오른쪽에서 <b>SLERP(적)만 수평선</b>입니다.
      <code>두 자세 사이 각</code>을 179° 로 밀면 <b>행렬선형+투영(녹)</b>의 총길이는
      측지선과 <b>정확히 같은데</b> 스텝각이 700배로 출렁입니다 — 같은 길을 고르지 않은
      속도로 갑니다. <b>오일러(청)</b>는 반대로 스텝각은 고른데 <b>총길이가 초과</b>합니다 —
      아예 다른 길입니다. <code>쿼터니언 부호 맞추기</code>를 끄면 SLERP 이 긴 쪽으로 돕니다.`;
  }

  const fmtU = (u) => (!Number.isFinite(u) ? '∞'
    : u >= 100 ? u.toExponential(2) : u.toFixed(u < 10 ? 4 : 2));

  onThemeChange(render);
  window.addEventListener('resize', render);
  render();
}
