+++
title = "PUFM++ : Flow Matching으로 점군 업샘플링 정리"
date = 2026-07-27T11:00:00+09:00
draft = false
tags = ["논문정리", "point-cloud", "flow-matching", "3D-vision", "upsampling"]
categories = ["논문"]
summary = "희소 점군을 조밀한 점군으로 복원하는 PUFM++ 논문(arXiv 2512.20988)과 전작 PUFM(코드 공개) 정리. Flow Matching으로 diffusion보다 훨씬 적은 스텝으로 고품질 업샘플링을 달성한다."

[cover]
  image = "overview.jpg"
  alt = "PUFM++ 개요: 희소→조밀 point cloud flow matching (원논문 Figure 1)"
  caption = "PUFM++ 개요 · 희소 점군에서 조밀 점군으로의 flow matching — 원논문 Figure 1 (Liu et al., [arXiv:2512.20988](https://arxiv.org/abs/2512.20988), 학습용 인용)"
  relative = true
+++

> 📄 **논문**: *Point Cloud Upsampling via Enhanced Flow Matching* (PUFM++), Zhi-Song Liu, Chenhang He, Roland Maier, Andreas Rupp — [arXiv:2512.20988](https://arxiv.org/abs/2512.20988) (2025-12)
> 💻 **코드**: [Holmes-Alan/PUFM](https://github.com/Holmes-Alan/PUFM) — 전작 **PUFM** (*Efficient Point Cloud Upsampling via Flow Matching*, [arXiv:2501.15286](https://arxiv.org/abs/2501.15286))의 공식 구현. 아래 "코드 돌려보기"는 이 저장소 기준입니다.
> 🔗 관련 정리: [Grad-PU]({{< ref "/posts/grad-pu" >}}) (아래 비교표에 등장) · [PU-Gaussian]({{< ref "/posts/pu-gaussian" >}}) · [PUtPFS]({{< ref "/posts/putpfs" >}}) · [PU-Mask]({{< ref "/posts/pu-mask" >}}) · [ReLPU]({{< ref "/posts/relpu" >}}) · [GaussianPU]({{< ref "/posts/gaussianpu" >}}) · [EGP3D]({{< ref "/posts/egp3d" >}}) — 같은 점군 업샘플링 문제를 거리 함수 / 가우시안 / 빈칸 채우기 / 2D 렌더링 / 학습 없는 최적화로 푼 쪽. 이 글은 **생성 궤적(flow matching)** 계열이다.
>
> ⚠️ 이 글의 그림은 저작권 문제를 피하려고 논문 figure를 그대로 쓰지 않고, **보고된 수치와 개념을 직접 도식/차트로 재구성**한 것입니다.

## 논문 카드 (CELOS 양식)

연구실 보고 양식(`CELOS양식_only_abstract.pptx`)의 8칸을 그대로 옮긴 카드다. 제목줄을 눌러 펴고, 다 보면 다시 접으면 된다. 칸 이름과 순서는 PPTX와 글자까지 같게 두었으니 슬라이드 한 장에 그대로 옮겨 붙일 수 있다.

{{< celos title="[2025] PUFM++ : Point Cloud Upsampling" >}}
| | |
|---|---|
| **Title** | PUFM++: Point Cloud Upsampling via Enhanced Flow Matching |
| **Year / Journal** | 2025 / 저널 없음 — arXiv 프리프린트 ([arXiv:2512.20988](https://arxiv.org/abs/2512.20988), 2025-12-24 제출) |
| **Keywords** | *(프리프린트가 자체 키워드 목록을 붙이지 않았다. arXiv 분류: Computer Vision and Pattern Recognition (cs.CV))* |
| **1st Author** | Zhi-Song Liu |

**Contributions**

1. **2단계 Flow Matching** — EMD(auction) 사전 정렬로 희소↔조밀 대응을 먼저 잡아 학습 경로를 곧게 만들고(Stage 1), 실제로 적분해 얻은 종점과 목표의 Chamfer Distance를 최소화해 분포를 직접 맞춘다(Stage 2).
2. **Adaptive Time Scheduler** — 타임스텝별 학습 손실로 "어려움 밀도"를 만들고 그 CDF를 역변환 샘플링해, 같은 스텝 예산을 어려운 구간에 몰아준다.
3. **추론 쪽 개선 둘** — RIN latent로 스텝 사이 전역 구조를 이어가고, test-time에 곡률 가중·역투영으로 점을 실제 표면에 밀착시킨다.

**Methods**

- **패치 단위 학습**: 조밀 1024pts / 희소 256pts. Stage 1은 EMD로 대응 `φ*`를 배정한 뒤 속도장에 MSE. Stage 2는 소스에서 ODE를 실제로 적분해 얻은 `x̃1`과 `x1`의 CD를 최소화하고, 입력에 `ξ~N(0,σ²)`를 더해 국소 이웃 수송을 매끄럽게 정규화한다.
- **ATS**: 학습이 끝난 모델을 고정해 타임스텝별 MSE를 다시 수집 → `ω(t)=(L_mse(t)+ψ)^β`의 CDF 역변환 샘플링으로 스텝 위치를 정한다.
- **구조(RIN)**: latent token을 유지하며 속도와 함께 갱신(`[v, z_{t+1}] = v_θ(x_t, z_t, t)`). Read→Compute→Write 3단 어텐션. 학습 시엔 과거 `z`가 없으므로 null 초기화로 proxy latent를 뽑아(stop-grad) 자기 출력을 조건으로 쓰는 2-pass 학습.
- **test-time 제약**: k-NN 공분산 고윳값으로 `κ=λ1/(λ1+λ2+λ3)`를 구해 `w=1+α·κ`로 가중, 적분 후 `‖x_kNN − x̃0‖²`를 작은 lr로 경사하강(역투영).

**Simulation Tool / Verifications**

- **데이터셋**: PU1K(학습) · PU-GAN 27개/PU1K 127개(평가) · KITTI(LiDAR 3D 검출) · ScanNet(RGB-D)
- **메트릭**: CD·HD·P2F·JSD(낮을수록) / NC·ALR·MR(메시 품질, 높을수록)
- **주요 수치**: PU-GAN 4× CD **0.980** (전작 PUFM 1.049, [Grad-PU]({{< ref "/posts/grad-pu" >}}) 1.132) · PU1K 16× CD 0.220→**0.176** · KITTI Car AP@0.7 sparse 20.35→**23.86**
- **코드**: 전작 PUFM 공식 구현 [Holmes-Alan/PUFM](https://github.com/Holmes-Alan/PUFM) (python 3.9 / torch 1.13, `pointops`·`Chamfer3D`·`emd_assignment` 확장 빌드 필요). **PUFM++ 전용 코드는 공개 여부 확인 안 됨.**

**etc**

- **한계**: EMD가 O(n²)이고 RIN 2-pass 때문에 학습 비용이 크다. 모델 115M(전작 30M). ATS는 학습 후 손실을 재수집해야 CDF가 나와 배포 절차가 번거롭다. 합성·정제 데이터 편향도 남는다.
- **저자 예고**: 1-step distillation, 업샘플링–완성(completion) 결합.
- **양식 관련 메모 둘**: ① 원제에 `PUFM++:` 약어 접두가 붙어 있어, 제목줄은 접두 뒤 세 단어를 썼다. ② 논문은 개선을 **네 가지**로 제시하는데, 3칸 양식에 맞추려고 추론 쪽 둘(RIN·manifold 제약)을 3번으로 묶었다. 원래 구분은 본문 "PUFM++의 4가지 개선"에 그대로 있다.
- **내 연구와의 관계**: depth back-projection으로 얻은 희소 점군을 조밀화하는 후처리 후보.
{{< /celos >}}

## 한 줄 요약

LiDAR·깊이카메라로 얻은 **희소하고 노이즈 많은 점군**을 **조밀하고 균일한 점군**으로 복원(업샘플링)하는 문제를, 노이즈→점군이 아니라 **희소 점군 → 조밀 점군을 직접 잇는 Flow Matching**으로 풀어, diffusion(20~50스텝) 대비 **6스텝 수준**으로 SOTA 품질을 낸다.

## 배경: 왜 어려운가

- 다운스트림 작업(표면 복원, 인식, SLAM 등)은 조밀·균일·무노이즈 점군을 원하지만, 센서 출력은 그 반대다.
- 고전적 최적화 기반 방법은 수작업 기하 prior에 의존해 일반화가 약하다.
- PU-Net·PU-GAN 등 초기 딥러닝은 특징 표현/전역 일관성이 부족했다.
- **Diffusion 기반**(PUDM 등)은 품질은 좋지만 **가우시안 노이즈에서 시작**하기 때문에 (1) 희소 점군에 이미 들어있는 기하 정보를 버리고, (2) 추론에 20~50스텝이 필요해 느리다.

## 핵심 아이디어 (전작 PUFM)

{{< img src="fig-concept.png" alt="sparse에서 dense로의 flow matching 개념도" caption="그림 1. 노이즈가 아니라 '희소 점군 자체'를 시작점으로 삼아 조밀 점군까지 직선 경로로 흐른다 (직접 재구성한 개념도)" >}}

Flow Matching은 시작 분포 `x0`(희소)와 목표 분포 `x1`(조밀) 사이를 잇는 속도장 `v_θ`를 학습한다.

```text
직선 보간:   x_t = (1 - t)·x0 + t·x1,   t ∈ [0,1]
학습 목표:   min ‖ v_θ(x_t, t) − (x1 − x0) ‖²   (MSE)
추론:        x0에서 시작해 ODE 적분 → x1  (스텝 수 적음)
```

핵심은 **시작점이 노이즈가 아니라 희소 점군**이라는 것. 이미 대략의 형상을 알고 출발하므로 경로가 짧아 스텝이 적게 든다. 단, 점군은 순서가 없어(unordered) 어떤 희소점이 어떤 조밀점으로 가야 하는지 대응이 모호한데, PUFM은 **EMD(Earth Mover's Distance) 사전 정렬**로 최적수송(OT) 대응을 잡아 안정적인 학습 경로를 만든다.

## PUFM++의 4가지 개선

### 1. 2단계 Flow Matching
- **Stage 1 (사전 정렬)**: EMD(auction 알고리즘)로 희소↔조밀 대응 `φ*`를 찾은 뒤 위 MSE 손실로 속도장을 학습. → *국소* 속도는 맞지만 t=1에서의 분포가 목표와 정확히 일치한다는 보장은 없음.
- **Stage 2 (종점 정제)**: 소스에서 궤적을 실제로 적분해 얻은 `x̃1`과 목표 `x1`의 **Chamfer Distance(순열 불변)** 를 최소화. 입력에 소량 노이즈 `ξ~N(0,σ²)`를 더해 국소 이웃 수송을 매끄럽게 정규화. → 분포 일치를 직접 강제.

### 2. Adaptive Time Scheduler (ATS)
학습 중 **타임스텝별 MSE 손실**로 "어려운 구간 밀도" `ω(t)=(L_mse(t)+ψ)^β`를 만들고, 그 CDF를 역변환 샘플링해 **어려운 구간에 ODE 스텝을 더 배분**. 같은 6스텝 예산에서 균일 스케줄 대비 CD 약 7% 개선.

### 3. Manifold 제약 (test-time)
- **곡률 가중**: 점마다 k-NN 공분산의 고윳값으로 곡률 `κ=λ1/(λ1+λ2+λ3)`을 구해, 고곡률(모서리·디테일) 영역의 속도 갱신을 강조(`w = 1 + α·κ`).
- **역투영(back-projection)**: 적분 후 원본 희소 표면으로의 거리 `‖x_kNN − x̃0‖²`를 작은 lr로 경사하강 → 점을 실제 표면에 밀착. → 메시 품질(법선 일관성·삼각형 품질) 향상.

### 4. RIN 기반 recurrent latent
PointNet++ 피드포워드는 매 스텝 전역 구조를 다시 추론해 시간적 일관성이 깨진다. PUFM++는 **Recurrent Interface Network(RIN)** 로 latent token `z_t`를 유지하며 속도와 함께 갱신(`[v, z_{t+1}] = v_θ(x_t, z_t, t)`). Read → Compute → Write 3단 어텐션 구조. 학습 시엔 스텝이 독립 샘플이라 과거 `z`가 없으므로, **null 초기화로 proxy latent를 뽑아(stop-grad) 자기 출력을 조건으로 쓰도록** 2-pass로 학습.

{{< img src="pipeline.png" alt="PUFM++ 네트워크 구조 (원논문 Figure 2)" caption="PUFM++ 네트워크 구조 — 입력 x_t·step t·이전 latent z를 받아 RIN 블록(Read/Compute/Write 어텐션)을 거쳐 속도장 v_pred와 갱신된 z_{t+1}을 출력. 원논문 Figure 2 (Liu et al., arXiv:2512.20988, 학습용 인용)" >}}

## 실험 결과

**데이터셋**: PU-GAN(테스트 27), PU1K(테스트 127). 패치 단위(조밀 1024pts / 희소 256pts).
**메트릭**: CD(Chamfer, ×1e4), HD(Hausdorff, ×1e3), P2F(점-표면 거리), JSD(분포 차이) — 모두 낮을수록 좋음. 메시 품질은 NC(법선 일관성)·ALR(삼각형 품질)·MR(다양체율) — 높을수록 좋음.

### 정량 결과 (PUGAN 4×)

{{< img src="fig-cd.png" alt="PUGAN 4x CD 비교 막대차트" caption="그림 2. PUGAN 4× Chamfer Distance 비교 (논문 Table 1 수치로 직접 작성, 낮을수록 좋음)" >}}

| 방법 | CD ↓ | HD ↓ | P2F ↓ | JSD ↓ |
|------|:----:|:----:|:-----:|:-----:|
| PUDM (diffusion) | 1.221 | 1.174 | 3.132 | 0.147 |
| SAPCU | 1.522 | 1.471 | 3.441 | 0.135 |
| [Grad-PU]({{< ref "/posts/grad-pu" >}}) | 1.132 | 1.186 | 1.957 | 0.111 |
| PUFM (전작) | 1.049 | 0.876 | 1.864 | 0.121 |
| **PUFM++** | **0.980** | **0.747** | **1.301** | **0.098** |

PU1K 16×에서도 CD 0.220→**0.176**, JSD 0.228→**0.135** 등 전작 대비 전반적 개선. JSD는 약 19% 감소.

### 실제 데이터 & 다운스트림
- **노이즈 입력**(PU1K 4×, η=0.02): CD 1.761(PUFM)→**1.662**로 견고.
- **KITTI LiDAR 3D 검출**(2×): Car AP@0.7 sparse 20.35 → **PUFM++ 23.86** (GT 20.36 상회, 빔 패턴 보존).
- **ScanNet RGB-D**(4×): CD **0.899**, HD **0.156** 로 Grad-PU·PUDM 대비 우수.
- **메시 복원**(PU1K 16×): NC **0.950** 로 가장 매끄러운 표면.

### Ablation 요약
- EMD 정렬 단독 효과는 미미, **Stage 2 정제가 핵심**(CD 0.035~0.05 개선).
- RIN은 파라미터 3.8배(115M vs 30M)지만 런타임 +73%에 그치고, 2단계 학습과 결합 시 CD 최대 개선.
- 곡률+역투영 둘 다 켜면 ALR +16%, NC +4%.

## 코드 돌려보기 (전작 PUFM 저장소 기준)

```bash
# 환경 (README): python 3.9, torch 1.13
# 내장 확장 빌드 필요: pointops, Chamfer3D, emd_assignment
pip install numpy==1.25.2 open3d==0.17.0 einops==0.3.2 scikit-learn==1.3.1 tqdm h5py

# 단일 파일 업샘플 (4배)
python test_pufm.py --model pufm --test_input_path example/camel.xyz --up_rate 4

# 벤치마크 평가 (attention 버전, PU-GAN)
python eval_pufm.py --model pufm_w_attn --dataset pugan --up_rate 4

# 임의 배율
python test_pufm_arbitrary.py
```

데이터셋은 PU1K(학습)·PU-GAN(평가), 사전학습 가중치는 `pretrained_model/`에 포함. Colab 데모도 제공. (PUFM++ 전용 코드는 공개 여부를 저장소에서 확인 필요.)

## 한계

- EMD 계산이 O(n²)이고, RIN latent를 위한 2-pass 학습으로 **학습 비용이 큼**. 모델도 115M로 무겁다.
- ATS의 CDF를 만들려면 학습 후 모델을 고정해 타임스텝별 손실을 재수집해야 해 **배포 절차가 번거로움**.
- 합성/정제 데이터 편향 — 도메인이 크게 다른 실제 스캔에선 성능 저하 가능.
- 향후 계획: **1-step distillation**, 업샘플링–완성(completion) 결합 모델.

## 메모

- 큰 그림: "노이즈에서 만들지 말고, 이미 가진 희소 점군에서 출발하라"가 diffusion 대비 효율의 핵심.
- 우리 쪽 깊이/포인트클라우드 파이프라인(예: 왜곡 보정 후 포인트클라우드)에서 **희소한 depth-back-projected 점군을 조밀화**하는 후처리로 붙여볼 여지가 있어 보임.
- 원문: [arXiv:2512.20988](https://arxiv.org/abs/2512.20988) · 코드: [Holmes-Alan/PUFM](https://github.com/Holmes-Alan/PUFM)

---

## 부록: 수식 직관 가이드

> 본문 수식을 **비유와 그림으로** 다시 보는 선택 코너입니다. (아래 도식은 이해를 돕기 위해 직접 그린 것)

### A. 직선 보간과 속도장

```text
x_t = (1 - t)·x0 + t·x1        (희소 x0 → 조밀 x1 사이의 위치)
v_θ(x_t, t) ≈ x1 - x0          (그 위치에서 가야 할 방향·속도)
```

{{< img src="apx-flow.png" alt="직선 보간과 속도장 비유" caption="자를 대고 t 비율만큼 걸어간 위치가 x_t, 화살표가 속도장" >}}

**비유**: 출발점(희소 점군)에서 도착점(조밀 점군)까지 **자를 대고 t 비율만큼 걸어간 지점**이 `x_t`. 속도장 `v_θ`는 각 점에게 *"너는 이 방향으로 이만큼 가면 돼"* 라고 알려주는 **내비게이션 화살표**다. 학습은 이 화살표가 실제 필요한 이동량(`도착 − 출발`)과 같아지도록 맞추는 것.

### B. EMD 정렬 vs Chamfer

{{< img src="apx-match.png" alt="EMD와 Chamfer 매칭 비교" caption="EMD=일대일 최적 배정, Chamfer=각자 최근접(겹치거나 빠질 수 있음)" >}}

**비유**: 점군은 순서가 없어서 "어느 희소점이 어느 조밀점의 짝인가"를 먼저 정해야 한다.
- **EMD** = **택배 최적 배차**: 전체 이동 비용이 최소가 되게 **일대일**로 배정. 정확하지만 계산이 무겁다(O(n²)).
- **Chamfer** = **각자 제일 가까운 짝만** 보기: 빠르지만 여러 점이 한 점에 몰리거나 빠지는 점이 생긴다.

PUFM++는 학습 전 **EMD로 짝을 정해 경로를 곧게** 만들고(Stage 1), 마지막엔 **Chamfer로 최종 분포**를 맞춘다(Stage 2).

### C. 적응형 시간 스케줄러 (ATS)

```text
ω(t) = (L_mse(t) + ψ)^β        (타임스텝별 '어려움' 가중치)
→ 이 가중치의 CDF를 역변환 샘플링해 스텝 위치 결정
```

{{< img src="apx-ats.png" alt="적응형 시간 스케줄러 비유" caption="쉬운 구간은 스텝 듬성, 어려운(손실 큰) 구간은 촘촘히" >}}

**비유**: 여행 일정에서 **쉬운 고속도로 구간엔 정거장을 드문드문**, **복잡한 골목 구간엔 촘촘히** 두는 것과 같다. 학습 손실이 큰(=모델이 어려워하는) 시간대에 ODE 스텝을 몰아줘, 같은 스텝 예산으로 더 정확한 결과를 낸다.

### D. 곡률 점수

```text
κ = λ1 / (λ1 + λ2 + λ3)        (λ1 ≤ λ2 ≤ λ3: 국소 이웃 공분산의 고윳값)
```

**비유**: 한 점 주변 이웃이 **납작한 판(평면)** 이면 두께 방향(최소 고윳값 `λ1`)이 거의 0 → `κ ≈ 0`. **모서리·뾰족한 디테일**이면 이웃이 사방으로 퍼져 `λ1`이 커짐 → `κ` 상승. 즉 `κ`는 *"이 점이 평평한 곳인가, 디테일인가"* 를 0~1로 재는 값이고, PUFM++는 `κ`가 큰 영역의 이동을 더 세심하게 다룬다.
