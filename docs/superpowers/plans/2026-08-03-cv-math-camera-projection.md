# CV 수학 시리즈 6편 (카메라 투영) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3D 점이 화소가 되는 과정을 `K[R|t]` 와 나눗셈 한 번으로 설명하고, 카메라를 직접 만지는 데모와 소실점이 방향만의 함수임을 손으로 확인하는 데모, 그리고 그 둘을 설명하는 글을 만든다.

**Architecture:** 3D 렌더 엔진을 도입하지 **않는다.** 투영 자체가 3D→2D 이므로 결과를 기존 Canvas 2D 프리미티브로 그린다. 장면 뷰(3D 를 보여주는 패널)도 고정된 관찰자 카메라로 투영한 그림이라 같은 함수를 재사용한다. 순수 수학은 새 파일 `camera.js` 에 모아 Node 로 TDD 하고, 데모별 조립만 새 파일로 만든다. 하니스 확장은 세 곳(`demo.html` 의 `panes`, `mathviz.css` 의 `.mv-panes`, `core.js` 의 `setDisabled`)이며 모두 기본값이 기존 동작이다.

**Tech Stack:** Hugo 0.164 + PaperMod, 바닐라 ES 모듈 + Canvas 2D, KaTeX, Node 24 `node:test`

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-03-cv-math-camera-projection-design.md`
- 1편 스펙(매듭의 상대): `docs/superpowers/specs/2026-07-29-cv-math-transform2d-design.md`
- 브랜치는 이미 `post6-camera-projection` 이다. `main` 에서 작업하지 않는다.
- 데모 JS 의 외부 의존성은 **0**. 빌드 스텝 없음. 외부 CDN 은 KaTeX 뿐이다.
  매 글의 꼬리말이 "의존성 없는 순수 JavaScript" 를 약속한다 — three.js 나 WebGL 을 쓰지 않는다.
- 수식 구분자: 블록 `$$...$$` 와 `\[...\]`, 인라인 `\(...\)`. **인라인에 `$...$` 를 쓰지 않는다.**
  (스펙 문서는 `$...$` 로 썼지만 그건 Hugo 가 렌더하지 않는 docs 파일이다. 글 본문은 `\(...\)` 다.)
- **블록 수식 안에 `=` 를 홀로 한 줄에 두지 않는다.** Markdown 이 setext 제목 밑줄로 해석해
  passthrough 보다 먼저 블록을 쪼갠다. `=` 는 앞 줄 끝에 붙인다. 스펙 §3-10
- **본문 물결표는 `\~` 로 이스케이프한다.** goldmark 는 `~` 한 개도 strikethrough 구분자로
  받아서 한 문단에 둘 있으면 그 사이가 통째로 취소선이 된다. 4·5편에서 실제로 걸렸다.
  검증: 빌드 산출물에 `<del>` 이 0 건이어야 한다. 스펙 §3-9
- 캔버스 색은 하드코딩 금지. `themeColors()` 로 CSS 변수를 읽고 `onThemeChange` 로 재렌더한다.
- **`layouts/shortcodes/demo.html`, `static/css/mathviz.css`, `static/js/mathviz/core.js` 는
  이번에 수정한다** (Task 6). 4편 계획이 "수정하지 않는다" 고 했던 것과 다르다 — 2패널이
  필요하기 때문이다. 세 변경 모두 **기본값이 기존 동작**이어야 하고, 1\~5편 데모 6개
  (`transform2d`, `svd`, `descent`, `tilted`, `adamfit`, `noiseball`, `sgdfit`, `gdfit`, `lsfit`)
  가 회귀 없이 돌아야 한다.
- `static/js/mathviz/transform.js` 는 **수정하지 않는다.** Task 5 에서 `apply` 를 import 만 한다.
- 글 날짜를 미래로 적지 않는다. 미래면 Hugo 가 빌드에서 제외한다. 오늘은 **2026-08-03** 이다.
- Hugo 빌드에는 `go` 가 PATH 에 필요하다: `export PATH="$PATH:/c/Program Files/Go/bin"`
- 테스트는 **인자 없이** `node --test` 로 돌린다. `node --test tests/` 는 Node 24 에서
  디렉토리를 모듈로 해석해 실패한다. `npm test` 가 이미 그렇게 설정돼 있다.
- 테스트 기준선은 **118개**다. 이 계획이 끝나면 **139개**가 된다 (신규 `test()` 블록 21개).
  ⚠️ 스펙 §6 은 20개라고 적었다. 계획 중에 드래그 상호작용이 **역투영**(`groundFromImage`)을
  요구하는 것이 드러나 하나 늘었다 — 스펙이 놓친 것이고, 이 계획이 정본이다.
- 수치 허용오차는 기본 **1e-9**. 예외는 한 곳이며 이유가 있다:
  - **소실점 수렴 테스트는 0.01 px** — 직선의 먼 점이 소실점으로 가는 수렴이 \(O(1/s)\) 라
    정확히 같아지지 않는다. \(s = 10^6\) 에서 실측 6.62e-3 px. 스펙 §2-4, §3-1
- **`vanishingPoint` 는 동차 3-벡터 `h` 를 항상 반환한다.** `(u,v)` 는 유한할 때만 의미가
  있다. 지평선 검사와 그리기는 `h` 로 한다 — `(u,v)` 로 하면 `atInfinity` 에서 NaN 이다.
  스펙 §3-2
- **소실점 불변을 `vanishingPoint` 재호출로 검증하지 않는다.** 그 함수는 \(X_0\) 를 애초에
  받지 않아 이동량 0 이 자명하다. 직선들의 먼 점을 실제로 투영해야 한다. 스펙 §3-1
- **모든 3D 선분은 `projectPolyline` 을 지난다.** 깊이 ≤ 0 인 점을 그냥 투영하면 화면을
  가로지르는 선이 생긴다. 스펙 §3-7
- **이미지 좌표 뷰는 world 의 y 를 거꾸로 준다** (`ymin > ymax`). `createView` 의 `toPixel`
  이 y 를 뒤집으므로 그래야 v 가 아래로 커진다. `toWorld` 도 같이 뒤집혀 `attachDrag` 가
  맞는다. `core.js` 의 `createView` 는 고치지 않는다. 스펙 §3-5
- **`drawGrid` 를 쓰지 않는다.** 지면 격자는 3D 를 투영해 그린다. 스펙 §3-6
- 커밋은 각 Task 끝에서. 푸시는 사람이 승인할 때만.

## File Structure

| 파일 | 책임 |
|---|---|
| `static/js/mathviz/camera.js` | **신규** — 순수 수학. 3D 기본·자세·내부·투영·클리핑·소실점·평면 Homography |
| `tests/mathviz/camera.test.js` | **신규** — 위의 21개 테스트 |
| `static/js/mathviz/pinhole.js` | **신규** — 데모 1 조립 (카메라 만지기) |
| `static/js/mathviz/vanishing.js` | **신규** — 데모 2 조립 (소실점) |
| `static/js/mathviz/scene.js` | **신규** — 두 데모가 공유하는 장면 그리기 (지면 격자·박스·기둥·절두체) |
| `layouts/shortcodes/demo.html` | **수정** — `panes` 파라미터 (기본 1) |
| `static/css/mathviz.css` | **수정** — `.mv-panes` 추가 (파일 끝) |
| `static/js/mathviz/core.js` | **수정** — `makeSliders` 반환에 `setDisabled` 추가 |
| `content/posts/camera-projection/index.md` | **신규** — 글 |

`scene.js` 를 따로 두는 이유: 지면 격자·박스·기둥은 두 데모가 똑같이 그리고, 장면 뷰와
이미지 뷰가 **같은 그리기 코드를 다른 카메라로** 두 번 부른다. 데모마다 복붙하면 네 벌이 된다.

---

### Task 1: camera.js — 3D 기본과 자세

**Files:**
- Create: `static/js/mathviz/camera.js`
- Test: `tests/mathviz/camera.test.js`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `add(a,b)`, `sub(a,b)`, `scale(v,s)`, `dot(a,b)`, `norm(v)`, `normalize(v)`, `cross(a,b)` — 3-벡터는 `[x,y,z]`
  - `matMul(A,B)`, `matVec(M,v)`, `transpose(M)`, `det3(M)`, `inv3(M)` — 행렬은 중첩 배열 행 우선
  - `rotX(a)`, `rotY(a)`, `rotZ(a)` → 3×3
  - `lookAt({eye, target, up})` → `{ R, t }`  — `R` 행 = `[xc, yc, zc]`, `t = -R·eye`
  - `cameraCenter({R, t})` → `[x,y,z]` — `C = -Rᵀt`

- [ ] **Step 1: Write the failing test**

`tests/mathviz/camera.test.js` 를 만든다.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  add, sub, scale, dot, norm, normalize, cross,
  matMul, matVec, transpose, det3, inv3,
  rotX, rotY, rotZ, lookAt, cameraCenter,
} from '../../static/js/mathviz/camera.js';

const TOL = 1e-9;
const close = (a, b, tol = TOL, msg) => assert.ok(
  Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a} (허용 ${tol})`,
);
const closeVec = (a, b, tol = TOL, msg) => {
  assert.equal(a.length, b.length, `${msg ?? ''} 길이 불일치`);
  a.forEach((v, i) => close(v, b[i], tol, `${msg ?? ''} [${i}]`));
};
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
/** 정규직교 검사: M Mᵀ = I */
const isOrthonormal = (M, tol = TOL) => {
  const P = matMul(M, transpose(M));
  return P.every((row, i) => row.every((v, j) => Math.abs(v - I3[i][j]) <= tol));
};

test('matMul / matVec: 항등원과 결합법칙', () => {
  const A = [[1, 2, 3], [4, 5, 6], [7, 8, 10]];
  const B = [[2, 0, 1], [1, 3, 0], [0, 1, 4]];
  const C = [[1, 1, 0], [0, 2, 1], [3, 0, 1]];
  assert.deepEqual(matMul(A, I3), A);
  assert.deepEqual(matMul(I3, A), A);
  const v = [1, -2, 3];
  closeVec(matVec(I3, v), v, TOL, 'matVec 항등원');
  // (AB)C = A(BC)
  matMul(matMul(A, B), C).forEach((row, i) => closeVec(
    row, matMul(A, matMul(B, C))[i], TOL, '결합법칙',
  ));
  // (AB)v = A(Bv)
  closeVec(matVec(matMul(A, B), v), matVec(A, matVec(B, v)), TOL, 'matVec 결합');
});

test('rotX / rotY / rotZ 는 회전이다 — 정규직교이고 det = +1', () => {
  for (const rot of [rotX, rotY, rotZ]) {
    for (const a of [0, 0.3, -1.2, Math.PI / 2, 2.9]) {
      const R = rot(a);
      assert.ok(isOrthonormal(R), `정규직교 실패 (a=${a})`);
      close(det3(R), 1, TOL, `det (a=${a})`);
    }
  }
});

test('inv3 는 역행렬이다', () => {
  const A = [[2, 0, 1], [1, 3, 0], [0, 1, 4]];
  matMul(A, inv3(A)).forEach((row, i) => closeVec(row, I3[i], TOL, 'A·A⁻¹'));
  matMul(inv3(A), A).forEach((row, i) => closeVec(row, I3[i], TOL, 'A⁻¹·A'));
});

test('lookAt: R 은 정규직교이고 det = +1', () => {
  const cases = [
    { eye: [0, -6, 1.6], target: [0, 0, 0.8] },
    { eye: [5, -7, 20], target: [0, 0, 0.9] },
    { eye: [-3, 4, 2], target: [1, 1, 0] },
  ];
  for (const { eye, target } of cases) {
    const { R } = lookAt({ eye, target, up: [0, 0, 1] });
    assert.ok(isOrthonormal(R), `정규직교 실패 (eye=${eye})`);
    close(det3(R), 1, TOL, `det (eye=${eye})`);
  }
});

test('lookAt: 카메라 y 축은 아래를 향한다 (OpenCV 규약)', () => {
  // 규약을 코드로 못 박는다. y-down 이 아니면 이미지가 상하 반전된다.
  const up = [0, 0, 1];
  for (const eye of [[0, -6, 1.6], [5, -7, 20], [-3, 4, 2]]) {
    const { R } = lookAt({ eye, target: [0, 0, 0.8], up });
    assert.ok(dot(R[1], up) < 0, `y_cam·up = ${dot(R[1], up)} 이 음수여야 한다 (eye=${eye})`);
  }
});

test('cameraCenter 는 eye 를 복원하고, t 는 eye 가 아니다', () => {
  // 흔한 혼동: t 를 카메라 위치로 읽는 것. 스펙 §2-1
  const eye = [0, -6, 1.6];
  const cam = lookAt({ eye, target: [0, 0, 0.8], up: [0, 0, 1] });
  closeVec(cameraCenter(cam), eye, TOL, 'cameraCenter');
  closeVec(cam.t, [0, 0.7930, 6.1588], 1e-4, 't 실측값');
  assert.ok(norm(sub(cam.t, eye)) > 1, 't 와 eye 는 전혀 다른 벡터다');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module '.../camera.js'`

- [ ] **Step 3: Write minimal implementation**

`static/js/mathviz/camera.js`:

```js
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
export const cameraCenter = ({ R, t }) => scale(matVec(transpose(R), t), -1);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -20`
Expected: PASS — 신규 6개 포함 `pass 124`

- [ ] **Step 5: Commit**

```bash
git add static/js/mathviz/camera.js tests/mathviz/camera.test.js
git commit -m "feat(camera): 3D basics and camera pose

lookAt 의 xc = cross(zc, up) 순서가 중요하다. 뒤집으면 좌표계가 왼손이 되고
det = -1 이 된다. y_cam 이 아래를 향하는 OpenCV 규약도 테스트로 못 박았다 —
아니면 이미지가 상하 반전된다.

t 는 카메라 위치가 아니라는 것도 테스트에 넣었다 (eye=(0,-6,1.6) 에서
t=(0,0.793,6.159)). 흔히 혼동하는 지점이다."
```

---

### Task 2: camera.js — 내부 파라미터와 투영

**Files:**
- Modify: `static/js/mathviz/camera.js` (파일 끝에 추가)
- Test: `tests/mathviz/camera.test.js` (파일 끝에 추가)

**Interfaces:**
- Consumes: Task 1 의 `matMul`, `matVec`, `add`, `transpose`, `inv3`, `lookAt`, `cameraCenter`
- Produces:
  - `intrinsics({f, cx, cy})` → 3×3 `K`
  - `fovFromF({f, size})` → 라디안, `fFromFov({fov, size})` → 화소
  - `projectPoint({K,R,t}, X)` → `{ u, v, z }` — `z` 는 카메라 깊이. `z ≤ 0` 이면 `u,v` 는 의미 없음
  - `cameraMatrix({K,R,t})` → 3×4 `P = K[R|t]`
  - `groundFromImage({K,R,t}, [u,v])` → `[X, Y, 0]` 또는 `null`

- [ ] **Step 1: Write the failing test**

`tests/mathviz/camera.test.js` import 를 확장하고 테스트를 덧붙인다.

```js
// import 목록에 추가:
//   intrinsics, fovFromF, fFromFov, projectPoint, cameraMatrix, groundFromImage

const SIZE = 480, CX = 240, CY = 240, F0 = 500;
const K0 = () => intrinsics({ f: F0, cx: CX, cy: CY });
const BASE = () => ({ K: K0(), ...lookAt({ eye: [0, -6, 1.6], target: [0, 0, 0.8], up: [0, 0, 1] }) });
/** 카메라 좌표를 그대로 넣기 위한 항등 자세. */
const IDENT = (f = F0) => ({ K: intrinsics({ f, cx: CX, cy: CY }), R: I3, t: [0, 0, 0] });

test('projectPoint: 카메라 좌표에서 u - cx = f·X/Z 가 정확하다', () => {
  // ⚠️ 거리를 바꾸며 lookAt 을 다시 부르면 target 재조준으로 R 이 바뀌어 비가
  // 0.5 가 아니라 0.501665 가 된다. 스펙 §3-4. 그래서 R=I, t=0 으로 직접 검사한다.
  const cam = IDENT();
  for (const Z of [1, 2, 4, 8]) {
    const p = projectPoint(cam, [0.5, 0.25, Z]);
    close(p.u - CX, F0 * 0.5 / Z, TOL, `u (Z=${Z})`);
    close(p.v - CY, F0 * 0.25 / Z, TOL, `v (Z=${Z})`);
    close(p.z, Z, TOL, `z (Z=${Z})`);
  }
  // 깊이 2배 → 변위 정확히 절반
  const a = projectPoint(cam, [0.5, 0.25, 2]);
  const b = projectPoint(cam, [0.5, 0.25, 4]);
  close((b.u - CX) / (a.u - CX), 0.5, TOL, '깊이 2배');
});

test('projectPoint: f 를 2배 하면 주점 기준 변위가 2배다', () => {
  const X = [0.5, 0.25, 3];
  const one = projectPoint(IDENT(F0), X);
  const two = projectPoint(IDENT(2 * F0), X);
  close((two.u - CX) / (one.u - CX), 2, TOL, 'u 배율');
  close((two.v - CY) / (one.v - CY), 2, TOL, 'v 배율');
});

test('projectPoint: 광축 위의 점은 주점에 찍힌다', () => {
  const cam = BASE();
  const C = cameraCenter(cam);
  const zc = cam.R[2];                       // 시선 방향
  for (const s of [1, 5, 20]) {
    const p = projectPoint(cam, add(C, scale(zc, s)));
    close(p.u, CX, 1e-9, `u (s=${s})`);
    close(p.v, CY, 1e-9, `v (s=${s})`);
  }
});

test('cameraMatrix: P 의 동차 나눗셈이 projectPoint 와 같다', () => {
  const cam = BASE();
  const P = cameraMatrix(cam);
  assert.equal(P.length, 3);
  assert.equal(P[0].length, 4);
  for (const X of [[0, 0, 0], [1, 2, 0.5], [-3, 4, 2], [0.3, -1, 1]]) {
    const h = matVec(P, [...X, 1]);
    const p = projectPoint(cam, X);
    close(h[0] / h[2], p.u, TOL, 'u');
    close(h[1] / h[2], p.v, TOL, 'v');
  }
});

test('fovFromF 와 fFromFov 는 서로 역이다', () => {
  for (const f of [200, 300, 500, 800, 1600]) {
    close(fFromFov({ fov: fovFromF({ f, size: SIZE }), size: SIZE }), f, 1e-9, `f=${f}`);
  }
  for (const deg of [20, 45, 60, 90, 100]) {
    const fov = deg * Math.PI / 180;
    close(fovFromF({ f: fFromFov({ fov, size: SIZE }), size: SIZE }), fov, 1e-12, `${deg}°`);
  }
});

test('fovFromF: f = size/2 에서 FOV 가 정확히 90° 다', () => {
  close(fovFromF({ f: SIZE / 2, size: SIZE }), Math.PI / 2, 1e-15, '90도');
  // 스펙 §2-2 의 표
  const deg = (r) => r * 180 / Math.PI;
  close(deg(fovFromF({ f: 500, size: SIZE })), 51.28, 5e-3, 'f=500');
  close(deg(fovFromF({ f: 200, size: SIZE })), 100.39, 5e-3, 'f=200');
  close(deg(fovFromF({ f: 1600, size: SIZE })), 17.06, 5e-3, 'f=1600');
});

test('groundFromImage: 지면점 → 이미지 → 지면점 왕복, 지평선 위는 null', () => {
  // 데모의 드래그가 이 역투영을 쓴다 (장면 뷰 클릭 → 지면 좌표).
  const cam = { K: intrinsics({ f: 300, cx: CX, cy: CY }),
                ...lookAt({ eye: [5, -7, 20], target: [0, 0, 0.9], up: [0, 0, 1] }) };
  for (const P of [[0, 0, 0], [3, -2, 0], [-5, 4, 0], [7, 7, 0], [-8, -8, 0]]) {
    const p = projectPoint(cam, P);
    closeVec(groundFromImage(cam, [p.u, p.v]), P, 1e-9, `왕복 (${P})`);
  }
  // 지평선 위(하늘)를 클릭하면 지면과 만나지 않는다
  const level = { K: K0(), ...lookAt({ eye: [0, -6, 1.6], target: [0, 1, 1.6], up: [0, 0, 1] }) };
  assert.equal(groundFromImage(level, [CX, 10]), null, '지평선 위는 null');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `intrinsics is not a function` (또는 import 에러)

- [ ] **Step 3: Write minimal implementation**

`camera.js` 끝에 추가:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -20`
Expected: PASS — 신규 7개 포함 `pass 131`

- [ ] **Step 5: Commit**

```bash
git add static/js/mathviz/camera.js tests/mathviz/camera.test.js
git commit -m "feat(camera): intrinsics, projection, and ground unprojection

닮은삼각형 테스트는 R=I, t=0 으로 카메라 좌표를 직접 넣어 검사한다.
거리를 바꾸며 lookAt 을 다시 부르면 target 재조준으로 R 이 바뀌어 비가
0.5 가 아니라 0.501665 가 나온다 — 스펙 §3-4 의 함정이다.

groundFromImage 는 스펙에 없던 함수다. 장면 뷰에서 카메라를 끄는 드래그가
이미지 점을 지면 좌표로 되쏘는 역투영을 요구한다. 왕복 오차 7.5e-15."
```

---

### Task 3: camera.js — 근평면 클리핑

**Files:**
- Modify: `static/js/mathviz/camera.js` (파일 끝에 추가)
- Test: `tests/mathviz/camera.test.js` (파일 끝에 추가)

**Interfaces:**
- Consumes: Task 1 의 `add`, `sub`, `scale`, `matVec`, `cross`, `norm`; Task 2 의 `projectPoint`
- Produces:
  - `NEAR` = `1e-3`
  - `depthOf({R,t}, X)` → number (카메라 깊이)
  - `clipSegmentNear(Xa, Xb, {R,t}, near)` → `null` 또는 `{ a, b }` (3D 끝점)
  - `projectPolyline(cam, pts, {closed})` → `[[u,v], ...]` 폴리라인들의 배열

- [ ] **Step 1: Write the failing test**

```js
// import 에 추가: NEAR, depthOf, clipSegmentNear, projectPolyline

test('clipSegmentNear: 앞앞은 그대로, 뒤뒤는 null, 앞뒤는 근평면에서 자른다', () => {
  const cam = BASE();
  const A = [0, 2, 0.5], B = [0, -20, 0.5];
  close(depthOf(cam, A), 8.0752, 1e-4, 'za');
  close(depthOf(cam, B), -13.7318, 1e-4, 'zb');

  // 둘 다 앞
  const both = clipSegmentNear([0, 2, 0.5], [0, 4, 0.5], cam);
  assert.deepEqual(both, { a: [0, 2, 0.5], b: [0, 4, 0.5] }, '앞앞은 원본 그대로');

  // 둘 다 뒤
  assert.equal(clipSegmentNear([0, -30, 0], [0, -40, 0], cam), null, '뒤뒤는 null');

  // 앞뒤 — 자른 점의 깊이가 정확히 NEAR
  const cut = clipSegmentNear(A, B, cam);
  assert.notEqual(cut, null);
  closeVec(cut.a, A, TOL, '앞 끝점은 그대로');
  close(depthOf(cam, cut.b), NEAR, 1e-12, '자른 점 깊이');

  // 뒤앞 (순서 반대) — 자른 쪽이 a 가 된다
  const rev = clipSegmentNear(B, A, cam);
  close(depthOf(cam, rev.a), NEAR, 1e-12, '반대 순서에서 자른 점 깊이');
  closeVec(rev.b, A, TOL, '반대 순서의 앞 끝점');
});

test('clipSegmentNear: 자른 점은 원래 선분 위에 있다', () => {
  const cam = BASE();
  const A = [0, 2, 0.5], B = [0, -20, 0.5];
  const cut = clipSegmentNear(A, B, cam);
  // 공선성: (B-A) × (cut-A) = 0
  close(norm(cross(sub(B, A), sub(cut.b, A))), 0, 1e-9, '공선성');
  closeVec(cut.b, [0, -6.145658, 0.5], 1e-6, '자른 점 실측값');
});

test('projectPolyline: 근평면을 지나는 폴리라인이 조각으로 나뉜다', () => {
  const cam = BASE();
  // 앞 → 뒤 → 앞. 가운데 점이 카메라 뒤라 두 조각이 나와야 한다.
  const pts = [[0, 2, 0.5], [0, -20, 0.5], [0, 2, 1.5]];
  const runs = projectPolyline(cam, pts);
  assert.equal(runs.length, 2, '두 조각으로 나뉜다');
  for (const run of runs) {
    assert.ok(run.length >= 2, '조각마다 점이 둘 이상');
    for (const [u, v] of run) {
      assert.ok(Number.isFinite(u) && Number.isFinite(v), `유한해야 한다: ${u},${v}`);
    }
  }

  // 🔑 클리핑이 고치는 것은 좌표의 **크기**가 아니라 **방향**이다.
  //
  // 근평면에서 자른 점은 깊이가 정확히 NEAR(1e-3) 이므로 u = cx + f·Xc/Zc 에서
  // v 가 55만 px 로 커지는 것이 **정상이다.** 그 선은 실제로 이미지에서 무한을 향해
  // 물러나므로 캔버스가 알아서 자른다. 크기 상한(|v| < 1e5)을 걸면 옳은 구현이 실패한다.
  //
  // 진짜 버그는 자르지 않았을 때 뒤쪽 점이 **반대편으로 뒤집혀** 화면을 가로지르는
  // 선이 생기는 것이다. 그래서 뒤집힘을 직접 검사한다.
  const vFront = projectPoint(cam, pts[0]).v;
  const vClipped = runs[0][runs[0].length - 1][1];
  const vNaive = projectPoint(cam, pts[1]).v;
  close(vFront, 242.05, 1e-2, '앞 끝점 v');
  close(vNaive, 132.93, 1e-2, '자르지 않은 뒤쪽 점 v (뒤집힌 값)');
  assert.ok(vClipped > 1e5, `자른 점은 깊이가 NEAR 라 v 가 크다: ${vClipped}`);
  assert.ok((vClipped - vFront) * (vNaive - vFront) < 0,
    '자른 점과 자르지 않은 점은 앞 끝점 기준 반대편이어야 한다 — '
    + `그게 클리핑이 막는 버그다 (clipped ${vClipped}, naive ${vNaive})`);

  // 전부 앞이면 한 조각, 점 개수 유지
  const allFront = projectPolyline(cam, [[0, 2, 0], [1, 3, 0], [2, 4, 0]]);
  assert.equal(allFront.length, 1);
  assert.equal(allFront[0].length, 3);

  // 전부 뒤면 빈 배열
  assert.deepEqual(projectPolyline(cam, [[0, -30, 0], [1, -35, 0]]), []);

  // closed: 마지막→처음 변까지 그린다
  const sq = [[-1, 2, 0], [1, 2, 0], [1, 4, 0], [-1, 4, 0]];
  assert.equal(projectPolyline(cam, sq, { closed: true })[0].length, 5, '닫으면 점이 하나 늘어난다');
  assert.equal(projectPolyline(cam, sq)[0].length, 4, '열면 그대로');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `depthOf is not a function`

- [ ] **Step 3: Write minimal implementation**

`camera.js` 끝에 추가:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -20`
Expected: PASS — `pass 134`

- [ ] **Step 5: Commit**

```bash
git add static/js/mathviz/camera.js tests/mathviz/camera.test.js
git commit -m "feat(camera): near-plane clipping

깊이 ≤ 0 인 점을 그냥 투영하면 무한을 거쳐 뒤집힌 좌표가 나오고, 한 끝점만
앞인 모서리는 화면을 가로지르는 선이 된다. 카메라를 격자 안으로 끌면 반드시
보이는 버그다.

projectPolyline 이 조각을 나눠 돌려준다. 데모의 모든 3D 선이 이걸 지난다."
```

---

### Task 4: camera.js — 소실점과 지평선

**Files:**
- Modify: `static/js/mathviz/camera.js` (파일 끝에 추가)
- Test: `tests/mathviz/camera.test.js` (파일 끝에 추가)

**Interfaces:**
- Consumes: Task 1 의 `matMul`, `matVec`, `transpose`, `inv3`, `normalize`, `dot`, `add`, `scale`; Task 2 의 `projectPoint`
- Produces:
  - `vanishingPoint({K,R}, d)` → `{ h, atInfinity, u, v }` — `h` 는 **항상** 동차 3-벡터
  - `horizon({K,R}, n)` → 소실선 `l` (3-벡터)

- [ ] **Step 1: Write the failing test**

```js
// import 에 추가: vanishingPoint, horizon

test('vanishingPoint: X0 가 다른 평행선들의 먼 점이 한 소실점으로 모인다', () => {
  // ⚠️ vanishingPoint 를 다시 부르는 것으로 검증하면 헛검증이다 — 그 함수는
  // X0 를 애초에 받지 않아 이동량 0 이 자명하다. 스펙 §3-1.
  // 직선들의 먼 점을 실제로 투영해야 한다. 수렴은 O(1/s).
  const cam = BASE();
  const d = normalize([0.4, 1, 0]);
  const vp = vanishingPoint(cam, d);
  close(vp.u, 441.769946, 1e-5, '소실점 u');
  close(vp.v, 173.333333, 1e-5, '소실점 v');

  const OFFSETS = [[0, 0, 0], [-3, 0, 0], [2, 1, 0], [5, -2, 0], [-8, 4, 0]];
  const S = 1e6;
  for (const X0 of OFFSETS) {
    const p = projectPoint(cam, add(X0, scale(d, S)));
    close(p.u, vp.u, 0.01, `X0=${X0} 의 먼 점 u`);
    close(p.v, vp.v, 0.01, `X0=${X0} 의 먼 점 v`);
  }
  // 수렴이 실제로 1/s 인지 — s 를 100배 하면 오차가 100배 줄어야 한다
  const err = (s) => {
    const p = projectPoint(cam, add([5, -2, 0], scale(d, s)));
    return Math.hypot(p.u - vp.u, p.v - vp.v);
  };
  const ratio = err(1e4) / err(1e6);
  assert.ok(ratio > 50 && ratio < 200, `1/s 수렴이어야 한다 (비 ${ratio})`);
});

test('vanishingPoint: 상면에 평행한 방향은 무한으로 간다', () => {
  // 광축이 YZ 평면에 있으면 x 방향은 상면에 평행하다.
  const cam = BASE();
  const vp = vanishingPoint(cam, [1, 0, 0]);
  assert.equal(vp.atInfinity, true, 'atInfinity 여야 한다');
  close(vp.h[2], 0, 1e-12, 'h 의 세 번째 성분이 0');
  assert.ok(Math.abs(vp.h[0]) > 1, 'h 가 영벡터는 아니다');

  // 수평 카메라에서 광축 방향의 소실점은 주점이다
  const level = { K: K0(), ...lookAt({ eye: [0, -6, 1.6], target: [0, 1, 1.6], up: [0, 0, 1] }) };
  const fwd = vanishingPoint(level, [0, 1, 0]);
  assert.equal(fwd.atInfinity, false);
  close(fwd.u, CX, 1e-9, '주점 u');
  close(fwd.v, CY, 1e-9, '주점 v');
});

test('horizon: 지면 방향 전부가 l·h = 0 을 만족한다 (무한인 방향도)', () => {
  // ⚠️ l·(u,v,1) 로 검사하면 atInfinity 에서 NaN 이다. 스펙 §3-2.
  const cam = BASE();
  const l = horizon(cam, [0, 0, 1]);
  closeVec(l, [0, -1.9825e-3, 3.4363e-1], 1e-6, 'l 실측값');

  let sawInfinity = false;
  for (let i = 0; i < 24; i++) {
    const th = i * Math.PI / 12;
    const d = normalize([Math.cos(th), Math.sin(th), 0]);
    const vp = vanishingPoint(cam, d);
    if (vp.atInfinity) sawInfinity = true;
    // h 는 스케일이 자유롭다 — 상대 크기로 판단한다
    close(dot(l, vp.h) / norm(vp.h), 0, 1e-9, `l·h (θ=${th.toFixed(3)})`);
  }
  assert.ok(sawInfinity, 'θ 를 훑는 중에 무한인 방향이 나와야 한다 (검사가 의미 있으려면)');
});

test('horizon: 지면 방향들의 소실점 v 가 전부 같다', () => {
  // 스펙 §2-5. u 는 10320 까지 발산하는데 v 는 소수점 여섯째 자리까지 같다.
  const cam = BASE();
  const vs = [], us = [];
  for (const th of [0.05, 0.4, 0.7, 1.2, 1.571, 2.4, 3.0]) {
    const vp = vanishingPoint(cam, normalize([Math.cos(th), Math.sin(th), 0]));
    assert.equal(vp.atInfinity, false, `θ=${th} 는 유한해야 한다`);
    vs.push(vp.v); us.push(vp.u);
  }
  for (const v of vs) close(v, 173.333333, 1e-6, '전부 같은 높이');
  assert.ok(Math.max(...us) > 10000, `u 는 발산한다 (최대 ${Math.max(...us)})`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `vanishingPoint is not a function`

- [ ] **Step 3: Write minimal implementation**

`camera.js` 끝에 추가:

```js
// ---------- 소실점 ----------

/**
 * 방향 d 의 소실점. v ~ K R d
 *
 * 🔑 X0 가 없다. 직선의 **위치가 아니라 방향만** 소실점을 정한다. 그래서 평행선
 * 다발이 한 점에서 만난다. 6편의 핵심 결과다.
 *
 * ⚠️ h 를 항상 반환한다. d 가 상면에 평행하면 h[2] = 0 이고 (u,v) 는 무한이라
 * NaN 이 된다 — 지평선 검사와 그리기는 h 로 해야 한다.
 */
export function vanishingPoint({ K, R }, d) {
  const h = matVec(matMul(K, R), d);
  const scaleRef = Math.max(Math.abs(h[0]), Math.abs(h[1]), 1);
  const atInfinity = Math.abs(h[2]) <= 1e-12 * scaleRef;
  return { h, atInfinity, u: h[0] / h[2], v: h[1] / h[2] };
}

/**
 * 법선 n 인 평면의 소실선(지평선). l = K⁻ᵀ R n
 *
 * 그 평면에 놓인 모든 방향의 소실점이 이 선 위에 있다: l·h = 0.
 * 지면(n = (0,0,1))이면 지평선이다.
 */
export const horizon = ({ K, R }, n) => matVec(transpose(inv3(K)), matVec(R, n));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -20`
Expected: PASS — `pass 138`

- [ ] **Step 5: Commit**

```bash
git add static/js/mathviz/camera.js tests/mathviz/camera.test.js
git commit -m "feat(camera): vanishing points and the horizon

v ~ KRd 에 X0 가 없다는 것이 6편의 핵심이다. 검증은 vanishingPoint 재호출이
아니라 직선들의 먼 점을 실제로 투영해서 한다 — 재호출은 X0 를 안 받으므로
이동량 0 이 자명해 아무것도 검증하지 않는다.

vanishingPoint 는 동차 h 를 항상 반환한다. l·(u,v,1) 로 지평선을 검사하면
상면에 평행한 방향에서 NaN 이 된다. l·h 는 그때도 0 이다.

지면 방향들의 v 가 전부 173.333333 인 것도 고정했다 — u 는 10320 까지
발산하는데도. 그게 지평선이다."
```

---

### Task 5: camera.js — 평면 Homography (1편 매듭)

**Files:**
- Modify: `static/js/mathviz/camera.js` (파일 끝에 추가)
- Test: `tests/mathviz/camera.test.js` (파일 끝에 추가)

**Interfaces:**
- Consumes: Task 2 의 `cameraMatrix`, `projectPoint`; `transform.js` 의 `apply` (테스트에서만)
- Produces: `planeHomography({K,R,t})` → 3×3 `H` (Z=0 평면 → 이미지)

- [ ] **Step 1: Write the failing test**

```js
// import 에 추가: planeHomography
// 그리고 1편 모듈을 불러온다:
import { apply as applyH } from '../../static/js/mathviz/transform.js';

test('1편 매듭: Z=0 평면에서 3×4 가 1편의 3×3 Homography 로 접힌다', () => {
  // 스펙 §2-9. 1편의 apply() 를 그대로 불러서 맞아야 한다 —
  // 이게 "Homography 자유도 8 이 어디서 왔는가" 의 답이다.
  const cam = BASE();
  const H = planeHomography(cam);
  assert.equal(H.length, 3);
  assert.equal(H[0].length, 3);

  for (const [X, Y] of [[0, 0], [1, 0.5], [-2, 3], [4, -1.5], [0.3, 0.7]]) {
    const viaH = applyH(H, [X, Y]);
    const viaP = projectPoint(cam, [X, Y, 0]);
    close(viaH[0], viaP.u, 1e-9, `u (${X},${Y})`);
    close(viaH[1], viaP.v, 1e-9, `v (${X},${Y})`);
  }

  // 자유도 8 — 스케일이 자유롭다
  const scaled = H.map((row) => row.map((v) => v * -7.3));
  for (const [X, Y] of [[0, 0], [1, 0.5], [-2, 3]]) {
    const a = applyH(H, [X, Y]), b = applyH(scaled, [X, Y]);
    close(b[0], a[0], 1e-9, `cH u (${X},${Y})`);
    close(b[1], a[1], 1e-9, `cH v (${X},${Y})`);
  }

  // H 는 P 의 1·2·4 열이다
  const P = cameraMatrix(cam);
  for (let i = 0; i < 3; i++) {
    close(H[i][0], P[i][0], TOL, `열0 (행${i})`);
    close(H[i][1], P[i][1], TOL, `열1 (행${i})`);
    close(H[i][2], P[i][3], TOL, `열2 (행${i})`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `planeHomography is not a function`

- [ ] **Step 3: Write minimal implementation**

`camera.js` 끝에 추가:

```js
// ---------- 1편 매듭 ----------

/**
 * Z = 0 평면 → 이미지의 3×3 Homography. P = K[R|t] 의 1·2·4 열이다.
 *
 * 🔑 Z = 0 이면 P 의 세 번째 열이 곱해질 상대가 없어 죽는다. 남는 3×3 이
 * 정확히 1편의 Homography 다 — 자유도 8(스케일 자유)까지 같다. 체커보드
 * 캘리브레이션이 되는 이유가 여기 있다: 체커보드는 평면이다.
 */
export function planeHomography(cam) {
  const P = cameraMatrix(cam);
  return P.map((row) => [row[0], row[1], row[3]]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -20`
Expected: PASS — `pass 139`

- [ ] **Step 5: Commit**

```bash
git add static/js/mathviz/camera.js tests/mathviz/camera.test.js
git commit -m "feat(camera): plane homography — the knot with post 1

Z=0 이면 P 의 세 번째 열이 죽고 남는 3x3 이 1편의 Homography 다. 테스트가
1편의 transform.apply 를 직접 불러서 확인한다 — 시리즈를 가로지르는 검증이다.
실측 최대오차 0.00e+0 px.

이게 1편의 '자유도 8' 이 어디서 왔는지에 대한 답이고, 체커보드
캘리브레이션이 되는 이유다."
```

---

### Task 6: 하니스 — 2패널 지원

**Files:**
- Modify: `layouts/shortcodes/demo.html`
- Modify: `static/css/mathviz.css` (파일 끝)
- Modify: `static/js/mathviz/core.js:6-17` (`themeColors` 에 `accent3` 추가)
- Modify: `static/js/mathviz/core.js:118-169` (`makeSliders` 의 반환에 `setDisabled` 추가)

**Interfaces:**
- Consumes: 없음
- Produces:
  - shortcode: `{{< demo name="x" panes="2" >}}` 가 `.mv-panes` 안에 캔버스 2개를 만든다. `panes` 없으면 캔버스 1개 (기존과 동일한 DOM)
  - `makeSliders(...)` 반환에 `setDisabled(keys, flag)` 추가 — `keys` 는 문자열 배열
  - `themeColors()` 반환에 `accent3: '#55a868'` 추가 — 기존 6개 키는 그대로

⚠️ **색은 반드시 `themeColors()` 에서 온다.** 1\~5편 데모 어디에도 하드코딩된 색이
없다 (`grep "'#" static/js/mathviz/*.js` 가 `core.js` 외에는 비어 있다). 6편은
지면 격자·박스·기둥·절두체·지평선·두 다발을 구분해야 해서 세 번째 강조색이 필요하다.
`#55a868` 은 seaborn deep 팔레트의 세 번째 색이고 `mathviz.css` 의 `.ok` 가 이미 쓰는
값이라 톤이 맞는다.

이 태스크에는 새 단위테스트가 없다 (DOM/Hugo 템플릿이라 `node --test` 범위 밖이다).
검증은 **기존 118개 테스트 무회귀 + Hugo 빌드 + 1\~5편 데모 육안 확인**이다.

- [ ] **Step 1: 회귀 기준선을 먼저 잡는다**

```bash
npm test 2>&1 | tail -8
export PATH="$PATH:/c/Program Files/Go/bin"
hugo --gc --minify 2>&1 | tail -20
grep -c '<canvas' public/posts/sgd-noise/index.html
```
Expected: `pass 139`, 빌드 성공, `sgd-noise` 에 canvas 2개 (데모 2개 × 1패널).
이 숫자를 적어둔다 — Step 5 에서 다시 확인한다.

- [ ] **Step 2: shortcode 를 고친다**

`layouts/shortcodes/demo.html` 전체를 이렇게 바꾼다:

```html
{{/* 인터랙티브 데모 삽입. 사용법: {{< demo name="transform2d" >}}
     2패널이 필요하면: {{< demo name="pinhole" panes="2" >}}
     panes 를 안 주면 캔버스 하나 — 1~5편과 DOM 이 같다. */}}
{{ $name := .Get "name" }}
{{ $panes := int (default 1 (.Get "panes")) }}
{{ $id := printf "mv-%s-%d" $name .Ordinal }}
<link rel="stylesheet" href="{{ "css/mathviz.css" | relURL }}">
<div class="mv-demo" id="{{ $id }}">
  <div class="mv-tabs"></div>
  <div class="mv-body">
    <div class="mv-left">
      {{ if gt $panes 1 }}
      <div class="mv-panes">
        {{ range seq $panes }}<div class="mv-pane"><canvas></canvas></div>{{ end }}
      </div>
      {{ else }}
      <canvas></canvas>
      {{ end }}
    </div>
    <div class="mv-right">
      <div class="mv-sliders"></div>
      <div class="mv-matrix-host"></div>
      <div class="mv-readout"></div>
      <div class="mv-hint"></div>
    </div>
  </div>
</div>
<script type="module">
  import { init } from '{{ printf "js/mathviz/%s.js" $name | relURL }}';
  init(document.getElementById('{{ $id }}'));
</script>
```

⚠️ `panes` 를 안 준 경로는 `<canvas>` 가 `.mv-left` 의 직계 자식이라 1\~5편의
`root.querySelector('canvas')` 가 그대로 맞는다. 그 줄을 건드리지 않는 것이 요점이다.

- [ ] **Step 3: CSS 를 추가한다**

`static/css/mathviz.css` 의 `@media` 블록 **앞**에 추가:

```css
/* 2패널 데모 (6편). 패널마다 캔버스가 하나라 createView/attachDrag 를 그대로 쓴다. */
.mv-panes { display: flex; gap: .6rem; }
.mv-pane { flex: 1 1 50%; min-width: 0; }
.mv-pane-label {
  font-size: .78rem; color: var(--secondary);
  text-align: center; margin-bottom: .2rem;
}
```

그리고 기존 `@media (max-width: 720px)` 블록 **안에** 한 줄 추가:

```css
  .mv-panes { flex-direction: column; }
```

- [ ] **Step 4: `core.js` 를 고친다 — `accent3` 와 `setDisabled`**

먼저 `themeColors()` 의 반환 객체에 한 줄 추가한다 (`accent2` 다음):

```js
    accent3: '#55a868',
```

그리고 그 위 주석 블록의 "실측한 변수" 줄 아래에 한 줄 덧붙인다:

```js
// accent 세 개는 seaborn deep 팔레트다. 6편이 지면·박스·기둥·절두체·지평선을
// 구분해야 해서 세 번째가 늘었다. #55a868 은 mathviz.css 의 .ok 와 같은 값이다.
```

다음으로 `makeSliders` 안, `clamp` 정의 뒤·`return` 앞에 추가:

```js
  /**
   * 슬라이더를 비활성화한다. 6편 데모 1 의 dolly zoom 이 `거리` 를 가져갈 때 쓴다 —
   * 값이 f 에서 파생되므로 사람이 만지면 안 된다.
   */
  function setDisabled(keys, flag) {
    keys.forEach((k) => {
      if (!rows[k]) return;
      rows[k].input.disabled = !!flag;
      rows[k].input.style.opacity = flag ? 0.45 : '';
    });
  }
```

그리고 `return { setValues, getValues, clamp };` 를 이렇게 바꾼다:

```js
  return { setValues, getValues, clamp, setDisabled };
```

- [ ] **Step 5: 회귀를 확인한다**

```bash
npm test 2>&1 | tail -8
export PATH="$PATH:/c/Program Files/Go/bin"
hugo --gc --minify 2>&1 | tail -20
grep -c '<canvas' public/posts/sgd-noise/index.html
grep -c '<canvas' public/posts/2d-transform-matrix/index.html
grep -rc '<del>' public/posts/ | grep -v ':0' || echo "del 0건 OK"
```
Expected: `pass 139` (변화 없음), 빌드 성공, canvas 개수가 Step 1 과 **동일**,
`<del>` 0건.

- [ ] **Step 6: 1\~5편 데모를 브라우저에서 확인한다**

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
hugo server -D
```
`transform2d`, `svd`, `descent`/`gdfit`, `tilted`/`adamfit`, `noiseball`/`sgdfit` 를 열어
슬라이더·드래그가 전부 동작하는지 본다. 하나라도 깨지면 shortcode 의 `panes` 없는
경로가 DOM 을 바꾼 것이다.

- [ ] **Step 7: Commit**

```bash
git add layouts/shortcodes/demo.html static/css/mathviz.css static/js/mathviz/core.js
git commit -m "feat(harness): two-pane demos and slider disabling

6편 데모는 3D 장면과 이미지를 나란히 보여야 한다. createView 는 캔버스를
정사각으로 강제하고 attachDrag 는 뷰 하나에 묶여 있어서, 한 캔버스에 두
뷰포트를 넣으면 둘 다 고쳐야 하고 1~5편이 그걸 쓴다. 대신 shortcode 가
캔버스를 두 개 만들면 패널마다 뷰와 드래그가 그대로 붙는다.

panes 를 안 주면 canvas 가 .mv-left 의 직계 자식으로 남아 1~5편의
querySelector('canvas') 가 그대로 맞는다. 회귀 확인: 테스트 138개 그대로,
빌드 산출물의 canvas 개수 동일.

makeSliders 의 setDisabled 는 데모 1 의 dolly zoom 이 '거리' 를 가져갈 때 쓴다.
themeColors 의 accent3 는 6편이 지면·박스·기둥·절두체·지평선을 구분해야 해서
늘렸다 — 색 하드코딩 금지 규약을 지키려면 여기에 있어야 한다."
```

---

### Task 7: scene.js — 공유 장면 그리기

**Files:**
- Create: `static/js/mathviz/scene.js`

**Interfaces:**
- Consumes: `camera.js` 의 `projectPolyline`, `projectPoint`, `lookAt`, `intrinsics`, `cameraCenter`, `add`, `sub`, `scale`, `normalize`, `cross`; `core.js` 의 `drawPath`
- Produces:
  - `GROUND_LINES` — 지면 격자의 3D 폴리라인 배열 (x,y ∈ [−8,8], 1 m 간격)
  - `BOX_EDGES` — 박스 모서리 폴리라인 배열
  - `PILLARS` — 배경 기둥 폴리라인 배열
  - `OBS` — 고정 관찰자 카메라 `{K, R, t}` (f=300, eye=(5,−7,20), target=(0,0,0.9))
  - `SCENE_HOME` / `SCENE_WIDE` — 장면 뷰의 world 사각형
  - `IMAGE_WORLD` — 이미지 뷰의 world 사각형
  - `drawPolys(ctx, view, cam, polys, opts)` — 3D 폴리라인들을 클리핑·투영해 그린다
  - `frustumPolys(cam, {size, length})` — 카메라 절두체의 3D 폴리라인 배열
  - `IMAGE_SIZE`, `IMAGE_CX`, `IMAGE_CY`, `F_DEFAULT`

- [ ] **Step 1: Write the module**

이 태스크는 순수 그리기 조립이라 단위테스트를 붙이지 않는다 (`drawPath` 가 canvas
컨텍스트를 요구한다). 검증은 Task 8·9 의 데모가 화면에 맞게 그려지는 것이다.
다만 **상수는 전부 스펙 §2 의 실측값**이어야 한다.

`static/js/mathviz/scene.js`:

```js
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
```

- [ ] **Step 2: 모듈이 로드되는지 확인한다**

```bash
node -e "import('./static/js/mathviz/scene.js').then(m => {
  console.log('GROUND_LINES', m.GROUND_LINES.length);
  console.log('BOX_EDGES', m.BOX_EDGES.length);
  console.log('OBS.R det ok', m.OBS.R.length === 3);
}).catch(e => { console.error('FAIL', e.message); process.exit(1); })"
```
Expected: `GROUND_LINES 34`, `BOX_EDGES 6`, `OBS.R det ok true`

⚠️ `drawPath` 를 import 하지만 부르지 않으므로 Node 에서 로드된다. 실패하면
`core.js` 가 최상위에서 DOM 을 만지는 것이니 그 줄을 찾아 보고한다.

- [ ] **Step 3: Commit**

```bash
git add static/js/mathviz/scene.js
git commit -m "feat(scene): shared 3D scene definition and drawing

장면 뷰와 이미지 뷰는 같은 3D 를 다른 카메라로 두 번 그린다. 데모마다
복붙하면 네 벌이 되므로 여기 모았다.

관찰자 카메라(f=300, eye=(5,-7,20))는 지면 격자 ±8·박스·기둥·주 카메라를
다 담도록 실측으로 골랐다. 종횡비 1.04 로 정사각 캔버스에 맞는다.

이미지 좌표 world 는 ymin > ymax 다 — createView 가 y 를 뒤집으므로
거꾸로 줘야 v 가 아래로 커진다."
```

---

### Task 8: pinhole.js — 데모 1 (카메라 만지기)

**Files:**
- Create: `static/js/mathviz/pinhole.js`

**Interfaces:**
- Consumes: `camera.js` 전체, `scene.js` 전체, `core.js` 의 `themeColors`, `onThemeChange`, `createView`, `drawPath`, `drawPolygon`, `drawHandles`, `makeSliders`, `makeToggles`, `attachDrag`
- Produces: `init(root)` — shortcode 가 부른다

- [ ] **Step 1: 카메라 매개화와 dolly zoom 을 순수 함수로 분리한다**

먼저 `pinhole.js` 상단에 매개화를 쓴다. 스펙 §4 의 식이다.

```js
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
  themeColors, onThemeChange, createView, drawPath, drawPolygon,
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
```

- [ ] **Step 2: 상태와 컨트롤을 쓴다**

```js
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
   * 1.12 \~ 4.00 m 로 유지된다 — 전부 지면 위다. 실측 확인함.
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
```

- [ ] **Step 3: 렌더를 쓴다**

```js
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
    {
      const ctx = sceneCanvas.getContext('2d');
      const C = cameraCenter(cam);
      const p = projectPoint(OBS, C);
      if (p.z > 0) drawHandlesAt(ctx, [[p.u, p.v]]);
    }

    function drawHandlesAt(ctx, pts) {
      pts.forEach((pt) => {
        const [x, y] = sceneView.toPixel(pt);
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = c.accent2; ctx.fill();
        ctx.strokeStyle = c.bg; ctx.lineWidth = 2; ctx.stroke();
      });
    }

    renderReadout(f, cam, pose);
  }
```

⚠️ `drawHandles` 는 world 점을 받아 뷰로 변환한다. 위에서는 관찰자 이미지 좌표가
곧 장면 뷰의 world 이므로 그대로 넘길 수 있다 — `drawHandles(ctx, sceneView,
[[p.u, p.v]], c)` 로 대신해도 된다. 로컬 함수를 쓴 이유는 색을 따로 주기 위해서다.
둘 중 하나로 통일하고 남는 쪽은 지운다.

- [ ] **Step 4: readout 을 쓴다**

```js
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
```

- [ ] **Step 5: 드래그와 테마를 붙이고 첫 렌더를 한다**

```js
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
```

⚠️ `yaw = atan2(g[0], -g[1])` 이다. `poseFromSliders` 가 `eye = (d sin φ, -d cos φ, h)`
이므로 역산이 그 형태여야 한다. `atan2(g[1], g[0])` 로 쓰면 90° 어긋난다.

- [ ] **Step 6: 브라우저에서 확인한다**

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
hugo server -D
```

Task 9 에서 글에 삽입하기 전이므로, 임시로 `content/posts/hello-world/index.md` 에
`{{< demo name="pinhole" panes="2" >}}` 를 넣어 확인하고 **확인 후 되돌린다.**

확인 목록:
- 두 패널이 나란히 뜨고 좁은 폭에서 세로로 쌓인다
- `dolly zoom` 켜고 `f` 를 200→2000: 평판 높이 **82.6023 px 고정**, 배경폭 **76.51 → 248.08 px**,
  카메라 높이 **1.12 → 4.00**, `거리` 슬라이더 회색으로 잠김
- `주점 cx` 를 밀면 이미지가 평행이동만 한다
- 카메라를 격자 안으로 끌어도 화면을 가로지르는 선이 없다 (최근접 깊이가 음수로 가며 경고가 뜬다)
- 절두체가 카메라를 따라간다
- light/dark 양쪽에서 읽힌다

- [ ] **Step 7: Commit**

```bash
git add static/js/mathviz/pinhole.js
git commit -m "feat(pinhole): demo 1 — touch the camera

dolly zoom 이 이 데모의 존재 이유다. 조준점을 고정하고 eye-target 오프셋
전체를 f/f0 로 스케일하면 평판 높이가 82.6023px 로 넷째 자리까지 고정되고
배경폭만 76.51 → 248.08px 로 벌어진다.

거리만 스케일하면 12% 흔들린다. 피사체를 박스로 두면 두께 때문에 또 안
고정된다. 그래서 오프셋 전체 + 평판 둘 다 필요하다 (스펙 3-3).

dolly 중에는 거리가 f 에서 파생되므로 슬라이더를 잠근다. 카메라 높이가
1.6 을 벗어나는 것은 버그가 아니라 닮음의 조건이다."
```

---

### Task 9: vanishing.js — 데모 2 (소실점)

**Files:**
- Create: `static/js/mathviz/vanishing.js`

**Interfaces:**
- Consumes: `camera.js`, `scene.js`, `core.js` 의 `themeColors`, `onThemeChange`, `createView`, `drawPath`, `drawPolygon`, `drawHandles`, `makeSliders`, `makeToggles`, `attachDrag`; `transform.js` 의 `apply`
- Produces: `init(root)`

- [ ] **Step 1: 선다발과 시드를 쓴다**

```js
// static/js/mathviz/vanishing.js
// 데모 2 — 소실점.
//
// 존재 이유는 `선 위치 흔들기` 다. offset 을 재배치해도 소실점 마커가 꿈쩍 안 하는
// 것이 v ~ KRd 에 X0 가 없다는 것의 분리 관측이다.

import {
  lookAt, intrinsics, projectPoint, vanishingPoint, horizon, planeHomography,
  groundFromImage, normalize, add, scale, dot, norm,
} from './camera.js';
import { apply as applyH } from './transform.js';
import {
  OBS, SCENE_HOME, IMAGE_WORLD, IMAGE_SIZE, IMAGE_CX, IMAGE_CY, F_DEFAULT,
  GROUND_LINES, drawPolys,
} from './scene.js';
import {
  themeColors, onThemeChange, createView, drawPath, drawPolygon,
  makeSliders, makeToggles, attachDrag, drawHandles,
} from './core.js';

const CAM_HEIGHT = 1.6;
const DIST = 6;                                     // 고정 — 이 데모의 주제는 방향이다
const PITCH0 = -7.5946 * Math.PI / 180;
const LINE_EXTENT = 60;                             // 직선을 s ∈ [-60, 60] 까지 그린다
const N_LINES = 5;

/** 스펙 §2-4 의 그 다섯 offset. 흔들기 전 기본값이다. */
const OFFSETS0 = [[0, 0, 0], [-3, 0, 0], [2, 1, 0], [5, -2, 0], [-8, 4, 0]];

/** 시드 난수. Math.random 을 쓰지 않는다 (5편 3-1 규약). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function offsetsFor(shakeCount) {
  if (shakeCount === 0) return OFFSETS0;
  const rnd = mulberry32(1000 + shakeCount);
  return Array.from({ length: N_LINES }, () => [
    (rnd() * 2 - 1) * 7, (rnd() * 2 - 1) * 7, 0,
  ]);
}

/** 방향 d 의 직선을 3D 폴리라인으로. */
const linePoly = (X0, d) => [add(X0, scale(d, -LINE_EXTENT)), add(X0, scale(d, LINE_EXTENT))];
```

- [ ] **Step 2: 상태·컨트롤·카메라를 쓴다**

```js
export function init(root) {
  const canvases = root.querySelectorAll('canvas');
  if (canvases.length < 2) throw new Error('vanishing 은 panes="2" 가 필요하다');
  const [sceneCanvas, imageCanvas] = canvases;

  const sceneView = createView(sceneCanvas, { ...SCENE_HOME });
  const imageView = createView(imageCanvas, IMAGE_WORLD);
  const sliderHost = root.querySelector('.mv-sliders');
  const readout = root.querySelector('.mv-readout');
  const hint = root.querySelector('.mv-hint');

  const state = { theta: 0.4, pitch: PITCH0, logF: Math.log10(F_DEFAULT) };
  let shakeCount = 0;
  let toggles;

  const sliders = makeSliders(sliderHost, [
    { key: 'theta', label: '방향 θ', min: 0, max: Math.PI, step: 0.004, value: state.theta,
      fmt: (v) => `${(v * 180 / Math.PI).toFixed(0)}°` },
    { key: 'pitch', label: 'pitch', min: -Math.PI / 6, max: Math.PI / 9, step: 0.002,
      value: state.pitch, fmt: (v) => `${(v * 180 / Math.PI).toFixed(1)}°` },
    { key: 'logF', label: 'f', min: Math.log10(200), max: Math.log10(2000), step: 0.005,
      value: state.logF, fmt: (v) => `${Math.round(10 ** v)} px` },
  ], (v) => { Object.assign(state, v); render(); });

  toggles = makeToggles(sliderHost, [
    { key: 'ortho', label: '직교 다발 추가', value: false },
    { key: 'showHorizon', label: '지평선 보기', value: true },
    { key: 'unwarp', label: '평면 = Homography', value: false },
  ], render);

  // '흔들기' 는 값이 아니라 사건이라 버튼이다.
  const shakeRow = document.createElement('div');
  shakeRow.className = 'mv-slider';
  const shakeBtn = document.createElement('button');
  shakeBtn.textContent = '선 위치 흔들기';
  shakeBtn.style.gridColumn = 'span 2';
  shakeBtn.addEventListener('click', () => { shakeCount += 1; render(); });
  shakeRow.append(document.createElement('label'), shakeBtn);
  sliderHost.appendChild(shakeRow);

  function build() {
    const f = 10 ** state.logF;
    const eye = [0, -DIST, CAM_HEIGHT];
    const target = [0, 0, CAM_HEIGHT + DIST * Math.tan(state.pitch)];
    const K = intrinsics({ f, cx: IMAGE_CX, cy: IMAGE_CY });
    return { f, cam: { K, ...lookAt({ eye, target, up: [0, 0, 1] }) } };
  }
```

- [ ] **Step 3: 렌더를 쓴다**

```js
  /** 이미지 world 사각형을 지나는 직선 l 을 선분으로 자른다. l·(u,v,1)=0 */
  function lineInWorld(l) {
    const { xmin, xmax, ymax, ymin } = IMAGE_WORLD;
    const pts = [];
    const [a, b, c] = l;
    if (Math.abs(b) > 1e-12) {
      for (const u of [xmin, xmax]) pts.push([u, -(a * u + c) / b]);
    }
    if (Math.abs(a) > 1e-12) {
      for (const v of [ymax, ymin]) pts.push([-(b * v + c) / a, v]);
    }
    const lo = Math.min(ymax, ymin), hi = Math.max(ymax, ymin);
    const inside = pts.filter(([u, v]) => u >= xmin - 1 && u <= xmax + 1 && v >= lo - 1 && v <= hi + 1);
    return inside.length >= 2 ? [inside[0], inside[1]] : null;
  }

  function render() {
    const c = themeColors();
    const { f, cam } = build();
    const { ortho, showHorizon, unwarp } = toggles.getValues();
    const offsets = offsetsFor(shakeCount);
    const dirs = [normalize([Math.cos(state.theta), Math.sin(state.theta), 0])];
    if (ortho) dirs.push(normalize([-Math.sin(state.theta), Math.cos(state.theta), 0]));
    const colors = [c.accent, c.accent2];

    for (const [canvas, view, viewCam, isScene] of [
      [sceneCanvas, sceneView, OBS, true],
      [imageCanvas, imageView, cam, false],
    ]) {
      view.resize();
      const ctx = canvas.getContext('2d');
      const { w, h } = view.size;
      ctx.clearRect(0, 0, w, h);
      drawPolys(ctx, view, viewCam, GROUND_LINES, { color: c.grid, width: 1 });
      dirs.forEach((d, k) => {
        drawPolys(ctx, view, viewCam, offsets.map((X0) => linePoly(X0, d)),
          { color: colors[k], width: 2 });
      });
      if (isScene) {
        // 방향 손잡이 — 원점에서 d 방향 3 m
        const p = projectPoint(OBS, scale(dirs[0], 3));
        if (p.z > 0) drawHandles(ctx, view, [[p.u, p.v]], c);
      }
    }

    // --- 이미지 뷰 전용 ---
    const ctx = imageCanvas.getContext('2d');
    const S = IMAGE_SIZE;
    drawPolygon(ctx, imageView, [[0, 0], [S, 0], [S, S], [0, S]], { stroke: c.fg, width: 1.5 });

    const vps = dirs.map((d) => vanishingPoint(cam, d));
    if (showHorizon) {
      const seg = lineInWorld(horizon(cam, [0, 0, 1]));
      if (seg) drawPath(ctx, imageView, seg, { color: c.accent3, width: 1.5 });
    }
    vps.forEach((vp, k) => {
      if (vp.atInfinity) return;
      const inView = vp.u >= IMAGE_WORLD.xmin && vp.u <= IMAGE_WORLD.xmax
        && vp.v <= IMAGE_WORLD.ymin && vp.v >= IMAGE_WORLD.ymax;
      if (inView) {
        const [x, y] = imageView.toPixel([vp.u, vp.v]);
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = colors[k]; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = colors[k]; ctx.fill();
      } else {
        // 밖이면 경계에 화살표 — 시야를 소실점에 맞추면 이미지가 너무 작아진다
        drawEdgeArrow(ctx, vp, colors[k]);
      }
    });

    if (unwarp) {
      // 이미지를 지면으로 되펴서 장면 뷰의 실제 격자에 겹친다. 정확히 겹치면 1편 매듭.
      const H = planeHomography(cam);
      const sctx = sceneCanvas.getContext('2d');
      for (const poly of GROUND_LINES) {
        const back = poly.map(([X, Y]) => {
          const img = applyH(H, [X, Y]);          // 지면 → 이미지
          const g = groundFromImage(cam, img);    // 이미지 → 지면 (되펴기)
          return g ?? [X, Y, 0];
        });
        for (const run of [back]) {
          const proj = run.map((P) => { const p = projectPoint(OBS, P); return [p.u, p.v]; });
          drawPath(sctx, sceneView, proj, { color: c.accent3, width: 3 });
        }
      }
    }

    renderReadout(cam, vps, offsets, dirs);
  }

  function drawEdgeArrow(ctx, vp, color) {
    const { xmin, xmax, ymin, ymax } = IMAGE_WORLD;
    const cxw = (xmin + xmax) / 2, cyw = (ymin + ymax) / 2;
    const u = Math.min(xmax - 8, Math.max(xmin + 8, vp.u));
    const v = Math.min(Math.max(ymax, ymin) - 8, Math.max(Math.min(ymax, ymin) + 8, vp.v));
    const [x, y] = imageView.toPixel([u, v]);
    const [cx0, cy0] = imageView.toPixel([cxw, cyw]);
    const ang = Math.atan2(y - cy0, x - cx0);
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-12, -6); ctx.lineTo(-12, 6); ctx.closePath();
    ctx.fillStyle = color; ctx.fill(); ctx.restore();
  }
```

⚠️ `unwarp` 의 되펴기가 항등이 되는 것이 맞다 — `applyH` 로 지면→이미지, `groundFromImage`
로 이미지→지면이므로 왕복이다. 그래서 실제 격자와 **정확히 겹친다.** 겹치는 게 요점이다
(1편의 3×3 이 6편의 3×4 와 같은 사상임을 보이는 것). 어긋나면 `planeHomography` 나
`groundFromImage` 에 버그가 있다.

- [ ] **Step 4: readout 을 쓴다**

```js
  function renderReadout(cam, vps, offsets, dirs) {
    const l = horizon(cam, [0, 0, 1]);
    const vp = vps[0];
    // 직선 끝점들이 s=60 에서 얼마나 모였나 — 유한 길이라 0 이 아니다
    const ends = offsets.map((X0) => projectPoint(cam, add(X0, scale(dirs[0], LINE_EXTENT))));
    const us = ends.map((p) => p.u), vsv = ends.map((p) => p.v);
    const spread = Math.hypot(Math.max(...us) - Math.min(...us),
                              Math.max(...vsv) - Math.min(...vsv));
    // 마커 이동 — offset 과 무관하므로 정확히 0 이다
    const ref = vanishingPoint(cam, dirs[0]);
    const move = vp.atInfinity ? 0 : Math.hypot(vp.u - ref.u, vp.v - ref.v);

    readout.innerHTML = `
      <div>소실점 ${vp.atInfinity
        ? '<b class="no">무한</b> (방향이 상면에 평행 — 이미지에서도 평행선이 평행하다)'
        : `<b>(${vp.u.toFixed(2)}, ${vp.v.toFixed(2)})</b>`}</div>
      <div>지평선 l = (${l.map((x) => x.toExponential(3)).join(', ')})</div>
      <div>흔들기 ${shakeCount} 회 · 마커 이동 <b class="ok">${move.toFixed(6)} px</b></div>
      <div>직선 끝점 산포 (s=${LINE_EXTENT}) ${spread.toFixed(2)} px</div>
      ${vps.length > 1 && !vps[0].atInfinity && !vps[1].atInfinity
        ? `<div>두 소실점의 v: ${vps.map((p) => p.v.toFixed(4)).join(' / ')} — 같으면 지평선 위다</div>`
        : ''}`;

    hint.innerHTML = '<b>선 위치 흔들기</b>를 눌러보세요. 직선들이 전부 옮겨가는데 소실점 마커는 꿈쩍도 안 합니다 — 소실점은 방향만의 함수입니다. <code>직교 다발</code>과 <code>지평선</code>을 같이 켜면 두 소실점이 같은 높이에 놓입니다.';
  }

  onThemeChange(render);
  window.addEventListener('resize', render);
  render();
}
```

⚠️ **마커 이동과 끝점 산포를 한 칸에 섞지 않는다.** 마커 이동은 정확히 0 이고
(`KRd` 는 offset 을 안 받는다), 끝점 산포는 유한 길이 때문에 0 이 아니다. 섞으면
"소실점이 안 움직인다" 의 의미가 흐려진다. 스펙 §5

- [ ] **Step 5: 브라우저에서 확인한다**

Task 8 Step 6 과 같은 방식으로 임시 삽입해 확인하고 되돌린다.

확인 목록:
- `선 위치 흔들기`: 직선이 다 옮겨가는데 마커 이동이 `0.000000 px`
- `직교 다발` + `지평선`: 두 소실점의 v 가 같고 지평선 위에 놓인다
- `pitch` 를 0 근처로, `θ` 를 0 으로 → `무한` 표시, 이미지에서 평행선이 평행
- `θ` 를 조금만 틀면 소실점이 이미지 밖으로 나가고 경계 화살표가 보인다
- `평면 = Homography` → 되편 격자가 실제 격자에 정확히 겹친다
- light/dark 양쪽, 좁은 폭 세로 쌓임, 터치 드래그

- [ ] **Step 6: Commit**

```bash
git add static/js/mathviz/vanishing.js
git commit -m "feat(vanishing): demo 2 — the vanishing point

'선 위치 흔들기' 가 이 데모의 존재 이유다. offset 을 시드에서 재배치해도
마커가 0.000000px 움직인다 — v ~ KRd 에 X0 가 없다는 것의 분리 관측이다.

마커 이동과 직선 끝점 산포를 readout 에서 분리했다. 앞은 정확히 0 이고
뒤는 유한 길이 때문에 0 이 아니다. 섞으면 주장이 흐려진다.

지평선은 h 로 그린다. atInfinity 인 방향에서 (u,v) 는 NaN 이다."
```

---

### Task 10: 글 쓰기

**Files:**
- Create: `content/posts/camera-projection/index.md`

**Interfaces:**
- Consumes: Task 8·9 의 데모 이름 `pinhole`, `vanishing`
- Produces: 없음 (최종 산출물)

- [ ] **Step 1: front matter 와 도입을 쓴다**

```toml
+++
title = "카메라 투영 — 행렬 하나로 누르고 나눗셈 한 번으로 원근을 만든다"
date = 2026-08-03T12:00:00+09:00
draft = false
math = true
tags = ["컴퓨터비전", "카메라", "핀홀", "투영", "소실점", "인터랙티브"]
categories = ["프로그램"]
summary = "1편은 '평면이 아니면 Homography 로는 안 된다'며 빚을 남겼습니다. 이 글이 그 빚을 갚습니다. 카메라는 3D 를 행렬 하나로 누르고 나눗셈 한 번으로 원근을 만드는데, 그 나눗셈이 1편의 그 나눗셈입니다 — 다만 세 번째 좌표가 깊이였습니다. 그리고 소실점은 직선이 어디 있는지와 무관합니다. 직접 만지는 데모 두 개를 넣었습니다."
+++
```

도입에 넣을 것:
- 데모 두 개 안내 + 시리즈 여섯 번째 글이라는 표시 (5편 형식 그대로)
- 한 줄 요약: **카메라는 행렬 하나로 누르고, 나눗셈 한 번으로 원근을 만든다.**
- 1편 인용 — "장면이 평면이 아니면 Homography 로는 안 된다 … 그게 이 시리즈의 뒷부분이다"
- 중반 결과 예고: **소실점은 직선이 어디 있는지와 무관하다 — 방향 하나가 정한다.**

- [ ] **Step 2: 본문을 쓴다 — 절 순서와 필수 내용**

| 절 | 반드시 들어갈 것 |
|---|---|
| 왜 3D 를 다시 꺼내는가 | 1편의 마지막 단락을 이어받는다. 깊이가 등장하는 지점 |
| 나눗셈 한 번 | 핀홀 닮은삼각형 → \\(x = fX/Z\\) → 3×4 + 나눗셈. **1편과 같은 나눗셈이고 세 번째 좌표가 깊이 Z 다** |
| 데모 1 | `{{< demo name="pinhole" panes="2" >}}` |
| \\(K\\) — 카메라 안쪽 | 화소 단위 f, 주점, **FOV 표** (스펙 §2-2), \\(f=\text{size}/2\\) 에서 90° |
| f 와 거리는 다르다 | **dolly zoom 표** (스펙 §2-8). 왜 피사체가 평판인지 한 줄 (두께가 있으면 정확히 안 고정된다) |
| \\([R\|t]\\) — 바깥 | \\(X_c = RX_w + t\\), ⚠️ **t 는 카메라 위치가 아니다** — eye=(0,−6,1.6) 에서 t=(0,0.793,6.159), \\(C = -R^\top t\\), 자유도 6 |
| 소실점 | \\(v \sim KRd\\) 유도, \\(X_0\\) 가 사라지는 것, **수렴 표** (스펙 §2-4) |
| 데모 2 | `{{< demo name="vanishing" panes="2" >}}` |
| 지평선 | **지면 방향 표** (스펙 §2-5) — u 는 10320 까지 발산하는데 v 는 전부 173.333333 |
| 평면이면 Homography | \\(Z=0\\) 이면 세 번째 열이 죽는다. 1편 자유도 8 의 출처. 체커보드가 왜 되는지 한 문장 |
| 정리 | 다음 글 = 카메라 두 대 (에피폴라) |
| 꼬리말 | "의존성 없는 순수 JavaScript … `node:test` 로 21개" |

- [ ] **Step 3: 수식·물결표 규약을 점검한다**

```bash
grep -n '\$[^$]' content/posts/camera-projection/index.md | grep -v '\$\$' | head
```
Expected: 출력 없음 (인라인은 `\(...\)` 만 쓴다)

```bash
grep -n '[^\\]~' content/posts/camera-projection/index.md | head
```
Expected: 출력 없음 (물결표는 전부 `\~`)

블록 수식에서 `=` 가 홀로 한 줄에 있는지 눈으로 확인한다.

- [ ] **Step 4: 빌드하고 확인한다**

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
hugo --gc --minify 2>&1 | tail -20
grep -c '<canvas' public/posts/camera-projection/index.html
grep -rc '<del>' public/posts/ | grep -v ':0' || echo "del 0건 OK"
```
Expected: 빌드 성공, canvas **4개** (데모 2개 × 2패널), `<del>` 0건

- [ ] **Step 5: Commit**

```bash
git add content/posts/camera-projection/index.md
git commit -m "post: camera projection — the division is the perspective

1편이 남긴 빚을 갚는 글이다. 1편의 '맨 아래 줄이 0 0 1 이면 Affine' 이
실은 깊이 이야기였다는 것이 매듭이다.

중반의 소실점 결과가 더 강하다 — v ~ KRd 에 X0 가 없다. 데모 2 에서
직선을 흔들어도 마커가 안 움직이는 것으로 확인할 수 있다."
```

---

### Task 11: 최종 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 테스트 전체**

```bash
npm test 2>&1 | tail -10
```
Expected: `pass 139`, `fail 0`

- [ ] **Step 2: 빌드와 산출물**

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
hugo --gc --minify 2>&1 | tail -20
grep -c '<canvas' public/posts/camera-projection/index.html   # 4
grep -c '<canvas' public/posts/sgd-noise/index.html            # 2 (회귀 없음)
grep -c '<canvas' public/posts/2d-transform-matrix/index.html  # 1 (회귀 없음)
grep -rc '<del>' public/posts/ | grep -v ':0' || echo "del 0건 OK"
```

- [ ] **Step 3: 스펙 §8 의 사람 확인 목록을 전부 돈다**

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
hugo server -D
```

- [ ] 데모 1: `dolly zoom` + `f` 200→2000 → 평판 82.6023 px 고정, 배경폭 76.5 → 248.1 px
- [ ] 데모 1: dolly 중 `거리`·`pitch` 슬라이더 잠김(pitch 는 기본값 복귀), 카메라 높이 1.12 → 4.00, 항상 지면 위
- [ ] 데모 1: dolly 켠 채 `yaw` 를 −60° \~ 60° 훑어도 절두체가 프레임 안, 평판 82.6023 px 유지
- [ ] 데모 1: `주점 cx` 밀면 평행이동만 (원근 불변)
- [ ] 데모 1: 카메라를 박스 안으로 끌어도 화면 가로지르는 선 없음
- [ ] 데모 1: 절두체가 카메라를 따라감
- [ ] 데모 2: `흔들기` 눌러도 마커 이동 `0.000000`
- [ ] 데모 2: `직교 다발` + `지평선` → 두 소실점의 v 가 같고 지평선 위
- [ ] 데모 2: `pitch` 0 · `θ` 0 → `무한` 표시, 이미지에서 평행선이 평행
- [ ] 데모 2: 소실점이 밖일 때 경계 화살표 + 좌표
- [ ] 데모 2: `평면 = Homography` → 되편 격자가 실제 격자에 겹침
- [ ] 1\~5편 데모 6종 회귀 없음
- [ ] light/dark 양쪽, 좁은 폭 세로 쌓임, 터치 드래그

- [ ] **Step 4: 스펙과 어긋난 것을 스펙에 반영한다**

구현 중 스펙과 달라진 것이 있으면 스펙 문서를 고쳐 맞춘다. 이미 알려진 것 하나:
- 스펙 §6 은 테스트 20개라고 적었지만 실제는 **21개**다 (`groundFromImage` 추가).
  스펙 §6 의 목록과 §8 의 "138개" 를 고친다.

```bash
git add docs/superpowers/specs/2026-08-03-cv-math-camera-projection-design.md
git commit -m "spec: reconcile the design doc with what shipped"
```

- [ ] **Step 5: 사람에게 넘긴다**

푸시와 병합은 사람이 승인할 때만. 브랜치 `post6-camera-projection` 를 그대로 둔다.

---

## Self-Review

**1. 스펙 커버리지**

| 스펙 절 | 담당 태스크 |
|---|---|
| §2-1 규약 (det, y-down, cameraCenter, t≠eye) | Task 1 |
| §2-2 FOV 표 | Task 2 (테스트), Task 10 (글) |
| §2-3 닮은삼각형 | Task 2 |
| §2-4 소실점 X0 소멸 | Task 4 |
| §2-5 지평선 / 지면 방향 v 동일 | Task 4 |
| §2-6 무한으로 가는 소실점 | Task 4 |
| §2-7 클리핑 | Task 3 |
| §2-8 dolly zoom | Task 8 (구현·검증), Task 10 (글) |
| §2-9 1편 매듭 | Task 5 |
| §3-1 헛검증 회피 | Task 4 (테스트가 먼 점을 투영) |
| §3-2 h 항상 반환 | Task 4 |
| §3-3 dolly zoom 두 조건 | Task 8 (`dollyPose` + `billboardPoly`) |
| §3-4 닮은삼각형 테스트 방법 | Task 2 |
| §3-5 y 뒤집힌 world | Task 7 (`IMAGE_WORLD`) |
| §3-6 drawGrid 안 씀 | Task 7 (지면 격자를 3D 로) |
| §3-7 클리핑 필수 | Task 3 (`projectPolyline`), Task 7 (`drawPolys` 가 강제) |
| §3-8 소실점 이미지 밖 | Task 9 (`drawEdgeArrow`) |
| §3-9 물결표 | Task 10 Step 3 |
| §3-10 블록 수식 `=` | Task 10 Step 3 |
| §4 데모 1 | Task 8 |
| §5 데모 2 | Task 9 |
| §6 API·테스트 | Task 1\~5 |
| §7 글 구조 | Task 10 |
| §8 성공 기준 | Task 11 |
| 2패널 하니스 | Task 6 |

빠진 스펙 요구 없음.

**2. 플레이스홀더 스캔**

"TBD"·"적절히"·"비슷하게" 없음. 모든 코드 단계에 실제 코드가 있다. Task 7 은
단위테스트 대신 로드 확인 + 후속 태스크의 육안 검증으로 대체하며 그 이유를 밝혔다.

**3. 타입 일관성**

- `lookAt` → `{R, t}` — Task 1 정의, Task 2·8·9 에서 `{K, ...lookAt(...)}` 로 합성. 일관됨
- `projectPoint` → `{u, v, z}` — 전 태스크 동일
- `vanishingPoint` → `{h, atInfinity, u, v}` — Task 4 정의, Task 9 에서 `h`·`atInfinity`·`u`·`v` 모두 사용
- `clipSegmentNear` → `null | {a, b}` (3D) — Task 3 정의, `projectPolyline` 내부에서만 소비
- `projectPolyline` → `[[u,v], ...][]` — Task 3 정의, Task 7 `drawPolys` 가 소비
- `groundFromImage` → `[X,Y,0] | null` — Task 2 정의, Task 8·9 드래그가 `null` 검사 후 사용
- `makeSliders` 반환 `{setValues, getValues, clamp, setDisabled}` — Task 6 에서 확장, Task 8 이 `setDisabled`·`clamp`·`setValues` 사용
- `themeColors()` 키 `{bg, fg, muted, grid, accent, accent2, accent3}` — Task 6 에서 `accent3`
  추가. Task 7·8·9 가 `c.accent3` 를 쓴다. **Task 6 없이 Task 7\~9 를 먼저 하면
  `c.accent3` 가 `undefined` 가 되어 선이 검게 그려진다** — 순서를 지킨다
- `scene.js` 상수 이름 — Task 7 정의, Task 8·9 import 목록과 일치

⚠️ Task 8 Step 3 에 `drawHandles` 를 쓸지 로컬 `drawHandlesAt` 을 쓸지 두 갈래로 적었다.
구현자가 하나를 고르고 남는 쪽을 지운다 — 단계에 그렇게 명시했다.
