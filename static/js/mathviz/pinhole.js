// static/js/mathviz/pinhole.js
// 데모 1 — 카메라 만지기.
//
// 왼쪽이 3D 장면(고정 관찰자 카메라), 오른쪽이 주 카메라가 보는 것.
// 존재 이유는 dolly zoom 이다 — f 를 키우며 거리를 함께 밀면 피사체는 그대로인데
// 배경만 압축된다. "f 와 거리는 다르다" 를 화면에서 분리 관측하는 유일한 방법이다.

import {
  lookAt, intrinsics, projectPoint, cameraCenter, groundFromImage,
  fovFromF, add, sub, scale, norm,
} from './camera.js';
import {
  OBS, SCENE_HOME, SCENE_WIDE, IMAGE_WORLD, IMAGE_SIZE, IMAGE_CX, IMAGE_CY, F_DEFAULT,
  GROUND_LINES, BOX_EDGES, PILLARS, PILLAR_FEET,
  drawPolys, frustumPolys, axisPoly,
} from './scene.js';
import {
  themeColors, onThemeChange, createView, drawPath, drawPolygon, drawHandles,
  makeSliders, makeToggles, attachDrag,
} from './core.js';

const CAM_HEIGHT = 1.6;
/** 기본값. (d, yaw, pitch) = (6, 0, -7.5946°) 가 eye=(0,-6,1.6), target=(0,0,0.8) 다. */
const PITCH0 = -7.5946 * Math.PI / 180;
const DIST0 = 6;

/**
 * 슬라이더 → lookAt 입력. 스펙 §4
 *   eye    = (d sin φ, -d cos φ, 1.6)
 *   target = (0, 0, 1.6 + d tan ψ)
 * 카메라가 z 축을 반경 d·높이 1.6 으로 돌고 조준점은 z 축 위에 있다.
 */
function poseFromSliders({ dist, yaw, pitch }) {
  const eye = [dist * Math.sin(yaw), -dist * Math.cos(yaw), CAM_HEIGHT];
  const target = [0, 0, CAM_HEIGHT + dist * Math.tan(pitch)];
  return { eye, target };
}

/**
 * dolly zoom. 조준점을 고정하고 eye-target 오프셋 **전체**를 f/f₀ 로 스케일한다.
 *
 * ⚠️ 거리만 ∝f 로 바꾸면 크기가 74→83px, 12% 흔들린다 (스펙 §3-3). 오프셋의
 * 높이 성분이 같이 스케일돼야 기하가 닮음이 된다 — 그래서 카메라 높이가
 * 1.6 에서 벗어난다 (f=200 에서 1.12, f=2000 에서 4.00). 그게 정상이다.
 */
function dollyPose({ eye, target }, f) {
  const k = f / F_DEFAULT;
  return { eye: add(target, scale(sub(eye, target), k)), target };
}

/**
 * dolly zoom 의 피사체 — 광축에 수직인 평판. 세로 1 m.
 *
 * ⚠️ 박스로는 안 된다. 깊이 방향 두께가 있으면 자기 안에서도 원근이 있어
 * 크기가 정확히 고정되지 않는다. 평판이면 82.6023px 로 넷째 자리까지 고정된다.
 */
function billboardPoly(cam, target) {
  const yc = cam.R[1];
  return [[add(target, scale(yc, -0.5)), add(target, scale(yc, 0.5))]];
}

export function init(root) {
  const canvases = root.querySelectorAll('canvas');
  if (canvases.length < 2) throw new Error('pinhole 은 panes="2" 가 필요하다');
  const [sceneCanvas, imageCanvas] = canvases;

  // world 는 살아있는 참조다 — 필드를 바꿔 시야를 옮긴다 (5편 noiseball 규약).
  const sceneWorld = { ...SCENE_HOME };
  const sceneView = createView(sceneCanvas, sceneWorld);
  const imageView = createView(imageCanvas, IMAGE_WORLD);

  const sliderHost = root.querySelector('.mv-sliders');
  const readout = root.querySelector('.mv-readout');
  const hint = root.querySelector('.mv-hint');

  const state = { dist: DIST0, yaw: 0, pitch: PITCH0, logF: Math.log10(F_DEFAULT), cx: IMAGE_CX };
  let toggles;

  const sliders = makeSliders(sliderHost, [
    { key: 'logF', label: 'f', min: Math.log10(200), max: Math.log10(2000), step: 0.005,
      value: state.logF, fmt: (v) => `${Math.round(10 ** v)} px` },
    { key: 'dist', label: '거리', min: 2, max: 25, step: 0.1, value: state.dist,
      fmt: (v) => `${v.toFixed(1)} m` },
    { key: 'yaw', label: 'yaw', min: -Math.PI / 3, max: Math.PI / 3, step: 0.005,
      value: state.yaw, fmt: (v) => `${(v * 180 / Math.PI).toFixed(0)}°` },
    { key: 'pitch', label: 'pitch', min: -Math.PI / 6, max: Math.PI / 9, step: 0.002,
      value: state.pitch, fmt: (v) => `${(v * 180 / Math.PI).toFixed(1)}°` },
    { key: 'cx', label: '주점 cx', min: 140, max: 340, step: 1, value: state.cx,
      fmt: (v) => `${v.toFixed(0)} px` },
  ], (v) => { Object.assign(state, v); render(); });

  toggles = makeToggles(sliderHost, [
    { key: 'dolly', label: 'dolly zoom', value: false },
    { key: 'frustum', label: '절두체 보기', value: true },
    { key: 'wide', label: '장면 축소', value: false },
  ], () => { syncDolly(); render(); });

  /**
   * dolly 가 켜지면 `거리` **와 `pitch`** 를 둘 다 잠근다.
   *
   * 거리는 f 에서 파생되므로 당연하다. pitch 를 함께 잠그는 이유는 덜 당연한데,
   * 실측으로 잡았다 — 조준점이 z 축의 `1.6 + d·tan ψ` 에 있고 dolly 가 eye 를
   * 그 조준점에서 멀어지게 스케일하므로, ψ 가 크면 카메라 높이가 터진다:
   *
   *   ψ = -30° , f=2000 → 높이 +12.0 m (절두체가 SCENE_WIDE 를 벗어난다, 13점)
   *   ψ = -7.6°, f=2000 → 높이  +4.0 m  ← 기본값, 정상
   *   ψ = +20° , f=2000 → 높이  -4.9 m  🚨 지면 아래
   *
   * 지면 아래로 내려간 카메라는 바닥을 뚫고 위를 보므로 데모가 무의미해진다.
   * 그래서 dolly 를 켤 때 pitch 를 기본값으로 **되돌리고** 잠근다. 그러면
   * f × yaw 전 범위(6×5=30 조합)에서 절두체가 프레임 안에 있고 높이가
   * 1.12 ~ 4.00 m 로 유지된다 — 전부 지면 위다. 실측 확인함.
   *
   * `f` 와 `yaw` 는 자유롭게 둔다. 평판 높이는 yaw 와 무관하게 82.6023 px 이라
   * 불변 주장이 깨지지 않는다 (30 조합 전부 같은 값).
   */
  function syncDolly() {
    const { dolly, wide } = toggles.getValues();
    if (dolly && state.pitch !== PITCH0) {
      state.pitch = PITCH0;
      sliders.setValues({ pitch: PITCH0 });
    }
    sliders.setDisabled(['dist', 'pitch'], dolly);
    // dolly 는 카메라를 거리 24 까지 미므로 자동으로 시야를 넓힌다
    const useWide = wide || dolly;
    Object.assign(sceneWorld, useWide ? SCENE_WIDE : SCENE_HOME);
  }

  function build() {
    const f = 10 ** state.logF;
    const base = poseFromSliders(state);
    const { dolly } = toggles.getValues();
    const pose = dolly ? dollyPose(base, f) : base;
    const K = intrinsics({ f, cx: state.cx, cy: IMAGE_CY });
    const cam = { K, ...lookAt({ ...pose, up: [0, 0, 1] }) };
    return { f, cam, pose };
  }

  function render() {
    const c = themeColors();
    const { f, cam, pose } = build();
    const { frustum, dolly } = toggles.getValues();

    // --- 두 패널 공통으로 그릴 것 ---
    const paint = (ctx, view, viewCam, isScene) => {
      drawPolys(ctx, view, viewCam, GROUND_LINES, { color: c.grid, width: 1 });
      drawPolys(ctx, view, viewCam, PILLARS, { color: c.accent2, width: 2.5 });
      drawPolys(ctx, view, viewCam, BOX_EDGES, { color: c.accent, width: 2 });
      if (dolly) {
        drawPolys(ctx, view, viewCam, billboardPoly(cam, pose.target),
          { color: c.fg, width: 4 });
      }
      if (isScene && frustum) {
        drawPolys(ctx, view, viewCam, frustumPolys(cam), { color: c.accent3, width: 1.5 });
        drawPolys(ctx, view, viewCam, axisPoly(cam), { color: c.accent3, width: 2.5 });
      }
    };

    for (const [canvas, view, viewCam, isScene] of [
      [sceneCanvas, sceneView, OBS, true],
      [imageCanvas, imageView, cam, false],
    ]) {
      view.resize();
      const ctx = canvas.getContext('2d');
      const { w, h } = view.size;
      ctx.clearRect(0, 0, w, h);
      paint(ctx, view, viewCam, isScene);
    }

    // --- 이미지 뷰 전용: 이미지 경계와 주점 ---
    {
      const ctx = imageCanvas.getContext('2d');
      const S = IMAGE_SIZE;
      drawPolygon(ctx, imageView, [[0, 0], [S, 0], [S, S], [0, S]],
        { stroke: c.fg, width: 1.5 });
      const k = 10;
      drawPath(ctx, imageView, [[state.cx - k, IMAGE_CY], [state.cx + k, IMAGE_CY]],
        { color: c.accent3, width: 1.5 });
      drawPath(ctx, imageView, [[state.cx, IMAGE_CY - k], [state.cx, IMAGE_CY + k]],
        { color: c.accent3, width: 1.5 });
    }

    // --- 장면 뷰 전용: 카메라 위치 손잡이 ---
    // 관찰자 이미지 좌표가 곧 장면 뷰의 world 이므로 그대로 넘긴다 (core.js drawHandles).
    {
      const ctx = sceneCanvas.getContext('2d');
      const C = cameraCenter(cam);
      const p = projectPoint(OBS, C);
      if (p.z > 0) drawHandles(ctx, sceneView, [[p.u, p.v]], c);
    }

    renderReadout(f, cam, pose);
  }

  function renderReadout(f, cam, pose) {
    const deg = (r) => (r * 180 / Math.PI).toFixed(1);
    const fov = fovFromF({ f, size: IMAGE_SIZE });
    const bb = billboardPoly(cam, pose.target)[0];
    const a = projectPoint(cam, bb[0]), b = projectPoint(cam, bb[1]);
    const bbPx = (a.z > 0 && b.z > 0) ? Math.abs(a.v - b.v) : NaN;
    const [pl, pr] = PILLAR_FEET.map((P) => projectPoint(cam, P));
    const bgPx = (pl.z > 0 && pr.z > 0) ? Math.abs(pr.u - pl.u) : NaN;
    const depths = [...BOX_EDGES.flat(), ...PILLARS.flat()]
      .map((P) => projectPoint(cam, P).z);
    const zmin = Math.min(...depths);
    const C = cameraCenter(cam);
    const num = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');

    readout.innerHTML = `
      <div>FOV <b>${deg(fov)}°</b> · f <b>${Math.round(f)} px</b></div>
      <div>카메라 (${C.map((v) => v.toFixed(2)).join(', ')}) · 거리 ${num(norm(sub(C, pose.target)))} m</div>
      <div>평판 높이 <b>${num(bbPx, 4)} px</b> · 배경폭 <b>${num(bgPx)} px</b></div>
      <div>최근접 깊이 z ${num(zmin, 3)} m ${zmin <= 0 ? '<span class="no">(뒤에 걸림 — 클리핑 동작 중)</span>' : ''}</div>`;

    hint.innerHTML = toggles.getValues().dolly
      ? 'f 를 밀어보세요. <b>평판 높이는 82.6023 px 에 붙어 있고 배경폭만 벌어집니다</b> — 그게 f 와 거리의 차이입니다. 카메라 높이가 1.6 을 벗어나는 것도 보세요.'
      : '장면 뷰의 점을 끌어 카메라를 옮겨보세요. <b>주점 cx</b> 를 밀면 이미지가 평행이동만 하고 원근은 안 바뀝니다.';
  }

  // 장면 뷰 드래그: 관찰자 이미지 점 → 지면 좌표 → (거리, yaw)
  attachDrag(sceneCanvas, sceneView, () => {
    const C = cameraCenter(build().cam);
    const p = projectPoint(OBS, C);
    return p.z > 0 ? [[p.u, p.v]] : [];
  }, (_i, worldPt) => {
    if (toggles.getValues().dolly) return;          // dolly 중에는 거리가 f 소유다
    const g = groundFromImage(OBS, worldPt);
    if (!g) return;
    const dist = Math.hypot(g[0], g[1]);
    if (dist < 1e-6) return;
    const next = sliders.clamp({ dist, yaw: Math.atan2(g[0], -g[1]) });
    Object.assign(state, next);
    sliders.setValues(next);
    render();
  });

  onThemeChange(render);
  window.addEventListener('resize', render);
  syncDolly();
  render();
}
