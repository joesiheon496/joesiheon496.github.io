+++
title = "Depth Anything 3 비디오 프레임 심도 테스터 (Gradio 앱)"
date = 2026-07-27T12:30:00+09:00
draft = false
tags = ["depth-anything", "gradio", "3D-vision", "point-cloud", "프로그램정리"]
categories = ["프로그램"]
summary = "Depth Anything 3로 비디오·카메라 프레임의 depth map과 3D 포인트클라우드를 즉석에서 뽑아보는 로컬 Gradio 앱 정리. UI 구성, 실행법, 핵심 기능과 구현 삽질 포인트까지."

[cover]
  image = "app-output.png"
  alt = "앱 출력: 원본 프레임 · Depth Map · 3D 포인트클라우드"
  caption = "앱 출력 예시 — 원본 프레임 · Depth Map(inferno) · 3D 포인트클라우드"
  relative = true
+++

> 🛠 로컬에서 도는 **개인용 도구**입니다. `C:\Users\a\anaconda3\envs\da3\python.exe D:\depth_anything_test\app.py` 로 실행되어 `http://127.0.0.1:7860` 에 뜹니다. (Gradio 앱 타이틀: *Depth Anything 3 - Video Frame Tester*)

## 한 줄 요약

**Depth Anything 3(DA3)** 로 비디오 파일·라이브 카메라 프레임에서 **depth map**과 **3D 포인트클라우드(.glb)** 를 즉석에서 뽑아 보고, 카메라 왜곡 보정까지 한 화면에서 실험하는 **로컬 Gradio 앱**.

## 출력 예시

{{< img src="app-output.png" alt="앱 출력 예시" caption="한 프레임에 대한 원본 | Depth Map | 3D 포인트클라우드 동시 출력" >}}

밝을수록 먼 거리(DA3 depth는 실제 거리 기반). 포인트클라우드는 depth를 카메라 기하로 역투영해 만든 것.

## 뭘 하는 앱인가 (UI 구성)

- **입력 탭 4개**
  - 📹 **라이브 카메라** — RTSP 카메라의 현재 프레임을 한 번에 depth/포인트클라우드로 (원클릭 워크플로우)
  - 🎬 **비디오 파일** — 업로드 영상 재생 → 원하는 시점의 프레임 캡처
  - 🔧 **카메라 보정** — 렌즈 왜곡(배럴) 보정
  - 🗂 **저장 / 비교** — depth 결과 저장 및 갤러리 비교
- **공통 설정(항상 표시)**: 모델 · 컬러스케일 · 심도 반전 · 왜곡 보정 적용
- **출력(항상 표시)**: 원본 | Depth, 그리고 3D 포인트클라우드

## 실행 방법

```powershell
# 전용 conda 환경 da3 (Python 3.11)
& "C:\Users\a\anaconda3\envs\da3\python.exe" "D:\depth_anything_test\app.py"
# → http://127.0.0.1:7860
```

## 핵심 기능

### Depth 추정
- 모델 3종: `da3-small`(빠름) · `da3-base`(균형) · `da3mono-large`(전용 모노큘러/최고 품질) — Hugging Face `depth-anything/da3-*`.
- 컬러맵 `inferno`/`plasma`, 심도 반전 토글. DA3 depth 출력은 저해상도라 원본 프레임 크기로 리사이즈해 표시.

### 3D 포인트클라우드 (.glb)
- DA3의 GLB export + `gr.Model3D(display_mode="point_cloud")`.
- ⚠️ 모노큘러 모델(`da3mono-large`)은 intrinsics/extrinsics/conf가 없어 export가 실패 → 기본 핀홀 K·단위 extrinsics·균일 conf를 **합성 주입**해 해결.

### 카메라 왜곡 보정 (2가지)
- **Plumb-line(수동)**: "실제로는 직선인 모서리"를 이미지에서 클릭(선당 3점↑)해 방사왜곡 `k1,k2,k3`를 추정(`scipy least_squares`). 직선/보정값은 JSON으로 저장·불러오기(고정 카메라라 한 번 마킹 후 재사용).
- **ChArUco(정식·권장)**: OpenCV 4.11 신 API(`CharucoDetector` + `matchImagePoints` + `calibrateCamera`), 5×7 보드. A4 300DPI로 출력해 여러 장 캡처 → K/왜곡 계수 산출.

### 업로드 영상 재생 & 프레임 캡처
- 브라우저가 못 트는 코덱(예: `FMP4`)을 imageio-ffmpeg 번들 ffmpeg로 **H.264(yuv420p, +faststart) 트랜스코딩**. 입력(`gr.File`)과 플레이어(`gr.Video`)를 분리해 "Video not playable" 문제 제거.
- 재생 위치 → 프레임: 캡처 버튼이 JS로 `<video>.currentTime`을 읽어 `frame = round(t·fps)`로 변환. 트랜스코딩본을 재생·추출 양쪽에 써서 프레임 인덱스 정합.

### 저장 / 비교
- depth PNG + "원본|Depth" 비교본을 메타데이터 파일명으로 저장, 갤러리로 불러와 비교.

### RTSP 카메라 연결
- Hanwha/Wisenet RTSP 카메라의 라이브 1프레임을 취득해 파이프라인 재사용. (내부 IP·계정 등 네트워크 정보는 여기선 생략)

## 구현 메모 & 삽질 포인트

프로그램 정리의 "부록" 격으로, 다시 만들 때 걸릴 만한 지점들:

- **gradio ≥ 5**: `gr.Slider(minimum == maximum)` 금지 → 초기 `maximum ≥ 1`로 둘 것.
- **클릭 마커 즉시 표시**: 보정 클릭 시 마커를 바로 그려야 함. 안 그리면 등록은 되는데 시각 피드백이 없어 "점이 안 찍힌다"는 오해 발생(실제 겪음).
- **왜곡 추정**: `least_squares`의 `diff_step`을 크게. `cv2.undistortPoints` 내부 반복 때문에 기본 미분 스텝이면 gradient가 0으로 죽음.
- **ChArUco 퇴화 뷰 방어**: 코너가 거의 한 줄에 몰린 뷰가 섞이면 `calibrateCamera`가 assertion으로 사망 → 뷰별 고유 row/col ≥ 3인 것만 사용 + try/except.
- **Gradio 파일 서빙**: 갤러리·.glb 표시에 `launch(allowed_paths=[temp, r"D:\depth_anything_test"])` 필요.
- **무해한 경고**: `triton`/`gsplat` 미설치 경고는 각각 xformers 선택 최적화·3D 렌더링 전용이라 모노큘러 depth엔 무관.

## 환경 / 의존성

- conda env **da3** (Python 3.11)
- torch 2.4.0+cu121 · torchvision 0.19.0+cu121 · xformers 0.0.27.post2 · gradio 6.20 · **numpy 1.26.4 (<2 필수)** · opencv · matplotlib
- DA3 공식 레포를 editable 설치: `pip install -e "D:\depth_anything_test\Depth-Anything-3[app]"` (+ `addict`)

## 성능 / 한계

- RTX 4060(8GB)에서 `da3-small` forward pass ≈ 0.39s.
- depth 출력이 저해상도(예: 280×504)라 원본 크기로 리사이즈.
- 모노큘러 모델은 카메라 기하가 없어 포인트클라우드 시 합성 주입 필요(위 참고).
