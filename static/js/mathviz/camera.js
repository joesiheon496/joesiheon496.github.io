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
