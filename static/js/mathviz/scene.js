// static/js/mathviz/scene.js
// 6편 두 데모가 공유하는 장면 정의와 그리기.
//
// 장면 뷰와 이미지 뷰는 **같은 3D 를 다른 카메라로** 두 번 그린다. 그래서 그리기
// 함수가 카메라를 인자로 받는다 — 장면 뷰도 투영이라는 것이 이 글의 논지다.

import {
  lookAt, intrinsics, projectPoint, projectPolyline, cameraCenter,
  add, sub, scale, normalize, cross, matVec, transpose, inv3,
} from './camera.js';
import { drawPath } from './core.js';

// ---------- 이미지 규격 (스펙 §2 기준 설정) ----------
export const IMAGE_SIZE = 480;
export const IMAGE_CX = 240;
export const IMAGE_CY = 240;
export const F_DEFAULT = 500;          // FOV 51.28°

/**
 * 이미지 뷰의 world. 사방 25% 여백 — 소실점이 이미지 밖에 있는 게 정상이다.
 *
 * ⚠️ ymin > ymax 다. createView 의 toPixel 이 y 를 뒤집으므로 거꾸로 줘야
 * 이미지 v 가 아래로 커진다. core.js 를 고치지 않는 방법이다. 스펙 §3-5
 */
export const IMAGE_WORLD = { xmin: -120, xmax: 600, ymin: 600, ymax: -120 };

// ---------- 관찰자 카메라 (장면 뷰) ----------
/**
 * 고정이다. 주 카메라가 움직여도 관찰자는 안 움직여서 독자가 기준을 잃지 않는다.
 * f·eye 는 지면 격자 ±8 · 박스 · 기둥 · 주 카메라를 다 담도록 실측으로 골랐다
 * (종횡비 1.04).
 */
export const OBS = {
  K: intrinsics({ f: 300, cx: IMAGE_CX, cy: IMAGE_CY }),
  ...lookAt({ eye: [5, -7, 20], target: [0, 0, 0.9], up: [0, 0, 1] }),
};

/** 기본 시야. 주 카메라 반경 6 까지 담는다. 실측 한 변 345. */
export const SCENE_HOME = { xmin: 62, xmax: 407, ymin: 449, ymax: 104 };
/** 축소 시야. dolly zoom 이 카메라를 반경 24.2 로 밀 때 쓴다. 실측 한 변 918. */
export const SCENE_WIDE = { xmin: -289, xmax: 629, ymin: 1020, ymax: 102 };

// ---------- 장면 기하 ----------
const GRID_HALF = 8;

/** 지면 격자. x·y 각 방향 1 m 간격 선들. */
export const GROUND_LINES = (() => {
  const out = [];
  for (let i = -GRID_HALF; i <= GRID_HALF; i++) {
    out.push([[i, -GRID_HALF, 0], [i, GRID_HALF, 0]]);
    out.push([[-GRID_HALF, i, 0], [GRID_HALF, i, 0]]);
  }
  return out;
})();

/** 원점의 단위 박스. z ∈ [0,1] 이라 지면에 서 있다. */
export const BOX_EDGES = (() => {
  const h = 0.5;
  const bot = [[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]];
  const top = bot.map(([x, y]) => [x, y, 1]);
  const out = [[...bot, bot[0]], [...top, top[0]]];
  for (let i = 0; i < 4; i++) out.push([bot[i], top[i]]);
  return out;
})();

/** 배경 기둥 둘. 원근 압축(dolly zoom)의 눈금 역할이다. */
export const PILLARS = [
  [[-2, 8, 0], [-2, 8, 2]],
  [[2, 8, 0], [2, 8, 2]],
];

/** 배경폭 readout 이 재는 두 점. 스펙 §2-8 */
export const PILLAR_FEET = [[-2, 8, 0], [2, 8, 0]];

// ---------- 그리기 ----------

/**
 * 3D 폴리라인들을 클리핑·투영해서 그린다.
 *
 * ⚠️ 반드시 projectPolyline 을 지난다. 깊이 ≤ 0 점을 그냥 투영하면 화면을
 * 가로지르는 선이 생긴다. 스펙 §3-7
 */
export function drawPolys(ctx, view, cam, polys, { color, width = 1.5, closed = false }) {
  for (const poly of polys) {
    for (const run of projectPolyline(cam, poly, { closed })) {
      drawPath(ctx, view, run, { color, width });
    }
  }
}

/**
 * 카메라 절두체의 3D 폴리라인. 광심에서 코너 광선 4개 + 상면 사각형.
 * length 는 광선 길이(m), size 는 이미지 한 변(화소).
 */
export function frustumPolys(cam, { size = IMAGE_SIZE, length = 1.6 } = {}) {
  const C = cameraCenter(cam);
  const Kinv = inv3(cam.K);
  const Rt = transpose(cam.R);
  const corners = [[0, 0], [size, 0], [size, size], [0, size]].map(([u, v]) => {
    const d = normalize(matVec(Rt, matVec(Kinv, [u, v, 1])));
    return add(C, scale(d, length));
  });
  const out = corners.map((p) => [C, p]);         // 코너 광선
  out.push([...corners, corners[0]]);              // 상면 사각형
  return out;
}

/** 광축 방향 짧은 화살표용 선분 — 시선이 어디를 보는지 표시한다. */
export function axisPoly(cam, length = 2.2) {
  const C = cameraCenter(cam);
  return [[C, add(C, scale(cam.R[2], length))]];
}
