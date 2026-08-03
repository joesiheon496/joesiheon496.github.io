// 핀홀 카메라 투영. DOM 접근 없음 — 브라우저와 Node 양쪽에서 돈다.
//
// 규약 (스펙 §2 기준 설정):
//   월드   — 오른손, 지면이 Z=0, 위가 +Z
//   카메라 — +Z_cam 이 시선, x_cam 오른쪽, y_cam **아래** (OpenCV 규약)
//   3-벡터는 [x,y,z], 행렬은 중첩 배열 행 우선.

export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const scale = (v, s) => v.map((x) => x * s);
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const norm = (v) => Math.hypot(...v);
export const normalize = (v) => scale(v, 1 / norm(v));
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const matVec = (M, v) => M.map((row) => dot(row, v));
export const transpose = (M) => M[0].map((_, j) => M.map((row) => row[j]));
export const matMul = (A, B) => A.map(
  (row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)),
);

export const det3 = (M) =>
  M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
  - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
  + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);

/** 여인자 전치를 det 로 나눈다. 특이행렬은 부르는 쪽이 피한다 (K 와 R 은 항상 가역). */
export function inv3(M) {
  const d = det3(M);
  return [
    [M[1][1] * M[2][2] - M[1][2] * M[2][1], -(M[0][1] * M[2][2] - M[0][2] * M[2][1]), M[0][1] * M[1][2] - M[0][2] * M[1][1]],
    [-(M[1][0] * M[2][2] - M[1][2] * M[2][0]), M[0][0] * M[2][2] - M[0][2] * M[2][0], -(M[0][0] * M[1][2] - M[0][2] * M[1][0])],
    [M[1][0] * M[2][1] - M[1][1] * M[2][0], -(M[0][0] * M[2][1] - M[0][1] * M[2][0]), M[0][0] * M[1][1] - M[0][1] * M[1][0]],
  ].map((row) => row.map((x) => x / d));
}

export const rotX = (a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
};
export const rotY = (a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
};
export const rotZ = (a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
};

/**
 * 월드→카메라 자세. R 의 행이 카메라 축이다 — [오른쪽, 아래, 시선].
 *
 * ⚠️ xc = cross(zc, up) 이고 cross(up, zc) 가 아니다. 후자는 x 가 왼쪽을 향해
 * 좌표계가 왼손이 된다(det = -1). yc = cross(zc, xc) 로 y 는 아래를 향한다.
 */
export function lookAt({ eye, target, up }) {
  const zc = normalize(sub(target, eye));
  const xc = normalize(cross(zc, up));
  const yc = cross(zc, xc);
  const R = [xc, yc, zc];
  return { R, t: scale(matVec(R, eye), -1) };
}

/**
 * 카메라의 월드 위치. C = -Rᵀt
 *
 * ⚠️ t 는 카메라 위치가 **아니다.** eye=(0,-6,1.6) 일 때 t=(0,0.793,6.159) 다.
 */
export function cameraCenter({ R, t }) {
  return scale(matVec(transpose(R), t), -1);
}

// ---------- 내부 파라미터 ----------

/** 화소 단위 초점거리 f, 주점 (cx, cy). 종횡비와 skew 는 다루지 않는다 (6편 범위 밖). */
export const intrinsics = ({ f, cx, cy }) => [[f, 0, cx], [0, f, cy], [0, 0, 1]];

/** 화각. size 는 이미지 한 변의 화소 수. 반환은 라디안. */
export const fovFromF = ({ f, size }) => 2 * Math.atan(size / (2 * f));
export const fFromFov = ({ fov, size }) => size / (2 * Math.tan(fov / 2));

// ---------- 투영 ----------

/**
 * 월드 점 X → 이미지 (u,v) 와 카메라 깊이 z.
 *
 * ⚠️ z ≤ 0 이면 점이 카메라 뒤에 있고 u,v 는 무한을 거쳐 뒤집힌 쓰레기값이다.
 * 부르는 쪽이 z 를 보고 판단해야 한다. 선분을 그릴 때는 clipSegmentNear 를 쓴다.
 */
export function projectPoint({ K, R, t }, X) {
  const Xc = add(matVec(R, X), t);
  const p = matVec(K, Xc);
  return { u: p[0] / p[2], v: p[1] / p[2], z: Xc[2] };
}

/** P = K[R|t], 3×4. */
export function cameraMatrix({ K, R, t }) {
  const KR = matMul(K, R);
  const Kt = matVec(K, t);
  return KR.map((row, i) => [...row, Kt[i]]);
}

/**
 * 이미지 점 (u,v) 를 지면(Z=0)으로 되쏜다. 데모의 드래그가 쓴다.
 * 광선이 지면과 평행하거나 카메라 뒤에서 만나면 null.
 */
export function groundFromImage({ K, R, t }, [u, v]) {
  const C = cameraCenter({ R, t });
  const d = matVec(transpose(R), matVec(inv3(K), [u, v, 1]));
  if (Math.abs(d[2]) < 1e-12) return null;
  const s = -C[2] / d[2];
  if (s <= 0) return null;
  return add(C, scale(d, s));
}

// ---------- 근평면 클리핑 ----------

/**
 * 근평면. 이보다 얕은 깊이는 그리지 않는다.
 *
 * 왜 필요한가: 깊이 ≤ 0 인 점을 투영하면 무한을 거쳐 뒤집힌 좌표가 나온다.
 * 한 끝점만 앞인 모서리를 그냥 이으면 화면을 가로지르는 엉뚱한 선이 생긴다.
 * 카메라를 지면 격자 안으로 끌면 반드시 걸린다.
 */
export const NEAR = 1e-3;

export const depthOf = ({ R, t }, X) => add(matVec(R, X), t)[2];

/**
 * 선분을 근평면에서 자른다. 반환은 3D 끝점 — 투영은 부르는 쪽이 한다.
 * 둘 다 뒤면 null.
 */
export function clipSegmentNear(Xa, Xb, cam, near = NEAR) {
  const za = depthOf(cam, Xa), zb = depthOf(cam, Xb);
  if (za < near && zb < near) return null;
  if (za >= near && zb >= near) return { a: Xa, b: Xb };
  const s = (near - za) / (zb - za);
  const cut = add(Xa, scale(sub(Xb, Xa), s));
  return za >= near ? { a: Xa, b: cut } : { a: cut, b: Xb };
}

const same3 = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-12);

/**
 * 3D 폴리라인을 클리핑해서 투영한다. 반환은 폴리라인들의 배열 —
 * 근평면에 잘리면 조각이 여러 개 나온다.
 *
 * 데모의 모든 3D 선은 이 함수를 지나야 한다.
 */
export function projectPolyline(cam, pts, { closed = false } = {}) {
  const n = pts.length;
  const last = closed ? n : n - 1;
  const out = [];
  let run = null, runEnd = null;

  for (let i = 0; i < last; i++) {
    const seg = clipSegmentNear(pts[i], pts[(i + 1) % n], cam);
    if (!seg) { run = null; runEnd = null; continue; }
    const a = projectPoint(cam, seg.a), b = projectPoint(cam, seg.b);
    if (run && runEnd && same3(runEnd, seg.a)) {
      run.push([b.u, b.v]);
    } else {
      run = [[a.u, a.v], [b.u, b.v]];
      out.push(run);
    }
    runEnd = seg.b;
  }
  return out;
}
