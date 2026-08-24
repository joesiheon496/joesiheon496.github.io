+++
title = "Koide 캘리브레이션 툴박스 : LiDAR 인텐시티는 이미 흑백사진이다"
date = 2026-08-24T11:00:00+09:00
draft = false
tags = ["논문정리", "lidar", "camera", "calibration", "nid", "ros2"]
categories = ["논문"]
summary = "체커보드 없이, 데이터 한 쌍으로, 초기값도 없이 LiDAR-카메라 외부 캘리브레이션을 끝내는 공개 툴박스. 핵심 통찰은 LiDAR 인텐시티가 표면 반사율을 담은 흑백사진이라는 것 — 그러면 캘리브레이션은 '같은 장면을 찍은 두 사진의 정합'이 되고, 유사도로 정규화 상호정보(NID)를 외부 파라미터에 대해 직접 최소화할 수 있다. SuperGlue 초기 추정부터 Nelder-Mead NID 정합까지, 방법과 도구 사용법·수치의 명암을 함께 정리했다."

[cover]
  image = "teaser.png"
  alt = "LiDAR 인텐시티에서 카메라 이미지로 정합되는 캘리브레이션 결과"
  caption = "캘리브레이션 결과 — 왼쪽에서 오른쪽으로 LiDAR 인텐시티가 카메라 영상 위에 정렬된다 · 원논문 Figure 1 (Koide et al., [arXiv:2302.05094](https://arxiv.org/abs/2302.05094), 학습용 인용)"
  relative = true
+++

> 📄 **논문**: *General, Single-shot, Target-less, and Automatic LiDAR-Camera Extrinsic Calibration Toolbox*, Kenji Koide·Shuji Oishi·Masashi Yokozuka·Atsuhiko Banno (일본 산업기술종합연구소 AIST, 쓰쿠바) — ICRA 2023, [arXiv:2302.05094](https://arxiv.org/abs/2302.05094)
> 💻 **코드**: [github.com/koide3/direct_visual_lidar_calibration](https://github.com/koide3/direct_visual_lidar_calibration) (MIT, ★1.5k+, ROS1/ROS2 + Docker, [공식 문서](https://koide3.github.io/direct_visual_lidar_calibration/))
> 🔗 관련 정리: [Windows ROS2 설치기]({{< ref "/posts/ros2-humble-windows" >}}) · [카메라 투영]({{< ref "/posts/camera-projection" >}})
>
> ⚠️ 그림은 모두 원논문 figure (출처 명기, 학습용 인용). 표 수치는 arXiv 원문에서 직접 재추출해 대조했다.

{{< celos title="[2023] Koide+ : Target-less LiDAR-Camera Extrinsic Calibration" >}}
| 항목 | 내용 |
|---|---|
| Title | General, Single-shot, Target-less, and Automatic LiDAR-Camera Extrinsic Calibration Toolbox |
| Year · Venue | 2023 · ICRA (arXiv:2302.05094) |
| Keywords | extrinsic calibration, LiDAR intensity, NID, SuperGlue, target-less |
| 1st Author | Kenji Koide (AIST, 일본) |
| Contributions | ① 스피닝·비반복 LiDAR × 핀홀·전방위 카메라 전 조합을 다루는 최초의 범용 타깃리스 툴박스 ② SuperGlue 교차 모달 대응 + 회전 RANSAC 자동 초기 추정 ③ NID 직접 정합 + hidden point removal |
| Methods | 동적/정적 점군 조밀화 → 가상 카메라 인텐시티 렌더 → SuperGlue+RANSAC → NID 최소화 (Nelder-Mead) |
| Verifications | 센서 4조합 × 15쌍 실측, 고반사 구 타깃 기반 의사 GT 대비 병진 0.043~0.101 m·회전 0.37~0.81°, 에지 기반 대비 5배 이상 개선 |
| etc | MIT 라이선스 공개 도구, 다중 데이터 사용 시 0.010 m/0.13°까지 |
{{< /celos >}}

## 한 줄 요약

LiDAR 포인트에는 좌표만 있는 게 아니라 **인텐시티** — 레이저가 표면에서 얼마나 반사돼 돌아왔는지 — 가 있다. 이 값은 표면 재질·반사율을 따라가므로, 인텐시티로 그린 그림은 사실상 **그 장면의 흑백사진**이다. 그렇다면 LiDAR-카메라 캘리브레이션은 "3D 센서와 2D 센서를 맞추는 기하 문제"가 아니라 **"같은 장면을 찍은 두 사진의 정합 문제"**가 된다.

이 관점 전환이 논문의 전부라 해도 과언이 아니다. 나머지는 정합을 잘 하기 위한 공학이다: 두 "사진"의 밝기 체계가 서로 다르니 픽셀 차이 대신 **통계적 닮음(NID, 정규화 상호정보 거리)**을 쓰고, 초기값이 없으니 학습 기반 매처(SuperGlue)로 첫 추정을 만들고, 한 스캔이 너무 성기니 점군을 조밀화한다. 결과물은 체커보드도, 초기값도, 여러 장의 데이터도 요구하지 않는 **공개 툴박스**다.

## 배경 / 문제

- 외부 캘리브레이션의 전통 경로는 체커보드·마커 같은 **타깃 + 수동 대응**이다. 정확하지만 번거롭고, 현장 재캘리브레이션(진동으로 마운트가 틀어진 뒤)에는 부적합하다.
- 타깃리스 계열의 대표는 **에지 정렬** — LiDAR 깊이 불연속과 이미지 에지를 맞춘다. 그러나 에지가 풍부한 환경이 필요하고, 좋은 초기값을 요구하며, 대체로 특정 센서 조합 전용이다.
- 이 논문의 목표는 제목 그대로 네 가지: **General**(스피닝·비반복 스캔 LiDAR × 핀홀·어안·전방위 카메라), **Single-shot**(데이터 한 쌍), **Target-less**, **Automatic**(초기값 불요).

## 핵심 아이디어

{{< img src="fig-system.png" alt="전체 파이프라인" caption="그림 1. 조밀화 → SuperGlue 초기 추정 → hidden point removal → NID 정합의 파이프라인 · 원논문 Figure 2 (Koide et al., arXiv:2302.05094, 학습용 인용)" >}}

### ① 한 스캔은 사진이 되기엔 너무 성기다 — 조밀화

스피닝 LiDAR(예: Ouster OS1-64)의 한 회전은 세로 64줄짜리 이미지라, 인텐시티 "사진"으로 쓰기엔 해상도가 부족하다. 해법은 **센서를 몇 초 천천히 흔들며 녹화**하고, 연속시간 ICP로 스캔 사이 움직임을 추정·보정하며 점군을 누적하는 것(효율을 위해 iVox 복셀 구조 사용). 비반복 스캔 LiDAR(Livox Avia)는 패턴이 회전마다 달라지므로 **정지 상태로 그냥 누적**하면 조밀해진다. 마지막으로 LiDAR 인텐시티와 카메라 이미지 모두에 **히스토그램 평활화**를 적용한다 — 뒤의 NID가 균일한 밝기 분포에서 가장 잘 작동하기 때문.

{{< img src="fig-densify.png" alt="단일 스캔 vs 조밀화 점군" caption="그림 2. 단일 스캔(좌)과 몇 초의 동적 통합으로 조밀화한 점군(우) — 오른쪽은 표면 텍스처가 사진처럼 살아난다 · 원논문 Figure 3 (Koide et al., arXiv:2302.05094, 학습용 인용)" >}}

### ② 초기값이 없다 — 학습 매처 + 회전 RANSAC

조밀 점군의 인텐시티를 **가상 카메라로 렌더**해 이미지를 만든다 (추정 FoV가 150° 미만이면 핀홀, 이상이면 등장방형 투영 — Ouster는 178.6°로 등장방형, Livox는 76.2°로 핀홀이 선택된다). 이 인텐시티 이미지와 실제 카메라 이미지 사이의 대응을 **SuperGlue**(MegaDepth 사전학습 가중치)로 찾는다.

문제는 모달리티가 달라서 매칭 임계값을 0.05까지 낮춰야 대응이 충분히 나오고, 그 대가로 **거짓 대응이 대량으로 섞인다**는 것. 그래서 강건화가 두 겹이다 — 대응 2개만 샘플해 SVD로 회전을 푸는 **회전 전용 RANSAC**으로 인라이어를 거르고, 살아남은 대응으로 재투영 오차를 Levenberg-Marquardt + Cauchy 커널로 최소화해 6-DoF 초기값을 얻는다.

{{< img src="fig-matches.png" alt="SuperGlue 교차 모달 매칭" caption="그림 3. LiDAR 인텐시티 이미지(위)와 카메라 이미지(아래) 사이의 SuperGlue 대응 — 낮은 임계값 탓에 거짓 대응이 섞여 있고, RANSAC이 걸러낸다 · 원논문 Figure 5 (Koide et al., arXiv:2302.05094, 학습용 인용)" >}}

### ③ 픽셀은 못 빼도 분포는 비교할 수 있다 — NID 직접 정합

정밀 정합 단계에서는 외부 파라미터 후보 `T`로 LiDAR 포인트를 이미지에 투영하고, 각 포인트의 **LiDAR 인텐시티 ↔ 떨어진 픽셀의 밝기** 쌍을 모아 결합 히스토그램을 만든다. 두 센서의 밝기 체계는 서로 다르므로 값을 직접 빼는 건 무의미하지만, **정렬이 맞을수록 "인텐시티를 알면 픽셀 밝기를 잘 예측할 수 있는" 상태**가 된다 — 이 예측 가능성을 재는 것이 상호정보(MI)이고, 논문은 그 정규화판인 NID를 쓴다:

$$\text{NID}(\mathcal{L}, \mathcal{I}) = \frac{H(\mathcal{L},\mathcal{I}) - \text{MI}(\mathcal{L};\mathcal{I})}{H(\mathcal{L},\mathcal{I})}, \qquad \text{MI} = H(\mathcal{L}) + H(\mathcal{I}) - H(\mathcal{L},\mathcal{I})$$

MI가 아니라 NID인 이유: MI는 겹치는 영역의 크기에 따라 절대값이 변해 비교 기준이 흔들리는 반면, NID는 [0, 1]로 정규화되고 거리 공간 공리를 만족해 더 강건하다. 이 NID를 **Nelder-Mead**(미분 불요 심플렉스법)로 최소화한다 — 히스토그램 기반 목적함수라 매끄러운 기울기가 없기 때문이다. 카메라에서 보이지 않아야 할 점이 히스토그램을 오염시키지 않도록 **hidden point removal**로 가려진 점을 제거하고, 추정이 갱신되면 제거와 정합을 수렴까지 반복한다.

## 결과 — 수치의 명암까지

센서 2종(Ouster OS1-64, Livox Avia) × 카메라 2종(핀홀, 전방위) × 15쌍 데이터로 평가. 참조값은 고반사 구 타깃을 수동 주석해 만든 **의사 GT**다. 단발(single-shot) 평균 (원문 Table I–III에서 재추출):

| 조합 | 초기 추정 성공 | 병진 [m] | 회전 [°] | 에지 기반 [3] 병진/회전 |
|---|:--:|:--:|:--:|:--:|
| Ouster + 핀홀 | 12/15 | 0.043 | 0.374 | 0.236 / 1.329 |
| Livox + 핀홀 | 15/15 | 0.059 | 0.579 | 0.323 / 3.497 |
| Ouster + 전방위 | 15/15 | 0.069 | 0.724 | – |
| Livox + 전방위 | 10/15 | 0.101 | 0.807 | – |

읽는 법:

- **에지 기반 대비 병진 5배 이상 개선.** 에지 기반 [Yuan+ 2021]은 환경에 따라 1 m 이상 틀어지는 케이스(Livox 00: 1.054 m)가 있는 반면, 제안 방법은 대부분 수 cm에 머문다.
- **평균의 함정이 여기도 있다.** Ouster+핀홀 평균 0.043 m에는 12번 데이터의 실패(0.325 m) 한 건이 포함돼 있고, 이 한 건이 평균의 절반을 만든다 — 나머지 14건의 중앙값은 약 0.019 m다. 반대로 00번은 회전만큼은 에지 기반이 더 좋다(0.135° vs 0.688°). 평균 한 줄이 아니라 행을 봐야 하는 표다.
- **다중 데이터를 쓰면 한 자릿수 mm까지.** 15쌍을 모두 넣은 조인트 캘리브레이션은 Livox+핀홀 0.010 m/0.132°, Ouster+핀홀 0.034 m/0.414° (Table IV). 단발은 "가능하다"의 증명이고, 정밀도가 필요하면 몇 쌍 더 찍는 게 맞다.
- **처리 시간**은 조합에 따라 74~249초 (Table V) — 전방위 카메라가 NID 정합에서 크게 느려진다(Ouster+전방위 181.5초).

## 도구로 쓰기 — ROS2 기준 네 명령

공식 문서 예제(2026-08 기준)의 흐름이다. 버전에 따라 옵션은 달라질 수 있다.

```bash
# 1) 전처리 — 조밀화 + calib.json 생성
#    -a: 토픽 자동 감지, -d: 동적 점군 통합(스피닝 LiDAR 필수), -v: 시각화
ros2 run direct_visual_lidar_calibration preprocess <bag경로> <출력경로> -adv

# 2) 초기 추정 — 자동 (SuperGlue)
ros2 run direct_visual_lidar_calibration find_matches_superglue.py <출력경로>
ros2 run direct_visual_lidar_calibration initial_guess_auto <출력경로>
#    자동이 실패하면 수동 GUI로: 2D-3D 대응을 3쌍 이상 찍고 Estimate
# ros2 run direct_visual_lidar_calibration initial_guess_manual <출력경로>

# 3) NID 정밀 정합 — 최종 T_lidar_camera 산출
ros2 run direct_visual_lidar_calibration calibrate <출력경로>
```

- 결과는 `calib.json`의 `T_lidar_camera = [x y z qx qy qz qw]`. 전용 viewer 프로그램으로 점군-이미지 겹침을 눈으로 확인할 수 있다.
- **취득 요령이 절반이다**: 스피닝 LiDAR은 몇 초간 센서를 천천히 흔들며 녹화(조밀화 재료), 비반복 스캔은 정지 녹화. 구조와 텍스처가 풍부한 장면일수록 초기 추정 성공률이 오른다 — 논문의 실패 케이스가 전부 "평면적이고 반복적인" 장면이었다.
- ROS1/ROS2 모두 지원하고 Docker 이미지(`koide3/direct_visual_lidar_calibration`)가 있어 의존성(GTSAM, Ceres, Iridescence, SuperGlue)을 직접 쌓지 않아도 된다. Windows ROS2 환경에서 Ouster를 다루는 이야기는 [설치기]({{< ref "/posts/ros2-humble-windows" >}})에 따로 정리했다.

## 읽으면서 걸린 것들

1. **식 (2)의 엔트로피에 마이너스가 없다.** 원문 수식은 H(X) = Σ p(x) log p(x)로 적혀 있는데, 표준 정의는 −Σ다. NID처럼 엔트로피들의 비율·차로 조합하는 맥락에서는 일관되게 쓰면 결과가 같아 실해는 없지만, 수식을 그대로 구현하면 음수 엔트로피를 보게 된다. 오기로 보인다.
2. **"Automatic"의 정직한 범위.** 초기 추정 성공률은 조합에 따라 10/15~15/15다. 실패는 SuperGlue가 특징을 못 잡는 평면·반복 구조에서 나고, 그때는 수동 GUI 폴백을 쓴다 — 논문 제목의 "Automatic"은 "대부분 자동, 실패 감지 시 수동"으로 읽는 게 맞다. 도구가 수동 경로를 잘 만들어 둔 것이 오히려 실무적 미덕이다.
3. **전방위 카메라의 저하는 구조적이다.** LiDAR과 카메라의 FoV가 크게 다르면 이미지의 작은 조각만 캘리브레이션에 기여하고, 그 해상도로는 미세 구조를 못 담는다고 저자가 직접 인정한다(Livox+전방위 10/15가 그 결과).
4. **참조값도 추정치다.** 오차 표의 기준이 되는 "GT"는 고반사 구 타깃의 재투영 오차 최소화로 만든 값 — 절대 정확도의 상한이 아니라 상대 비교의 기준으로 읽어야 한다.

## 정리

| 질문 | 답 |
|---|---|
| 무엇이 새로운가 | 인텐시티를 "사진"으로 보고, 캘리브레이션을 NID 직접 정합으로 환원 + 전 센서 조합 지원 툴박스 |
| 초기값은 | SuperGlue 교차 모달 매칭 + 회전 RANSAC으로 자동 (실패 시 수동 GUI) |
| 얼마나 정확한가 | 단발 수 cm/0.4~0.8°, 다중 데이터 시 1 cm/0.13°까지 (에지 기반 대비 병진 5배+) |
| 언제 쓰나 | 체커보드 없이 현장 재캘리브레이션, 특히 Ouster·Livox 계열 + 핀홀 카메라 |
| 조심할 것 | 평면적·반복적 장면(초기 추정 실패), FoV 크게 다른 전방위 조합, 취득 시 흔들기(스피닝) |

한 줄 평: "타깃리스 캘리브레이션" 논문은 많지만, 센서 조합을 가리지 않는 **공개 도구**로까지 완성해 둔 것은 드물다. LiDAR과 카메라를 한 리그에 올려 쓰는 사람이라면 — 특히 마운트가 한 번이라도 틀어져 본 사람이라면 — 저장소를 북마크할 가치가 있다.
