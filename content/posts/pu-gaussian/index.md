+++
title = "PU-Gaussian : 3D 가우시안으로 점군 업샘플링"
date = 2026-07-27T12:50:00+09:00
draft = false
tags = ["논문정리", "point-cloud", "upsampling", "3D-gaussian", "3D-vision"]
categories = ["논문"]
summary = "점 주변 국소 이웃을 이방성 3D 가우시안으로 모델링하고, 그 가우시안에서 점을 샘플링→정제해 희소 점군을 조밀하게 만드는 PU-Gaussian 정리. 암시적 특징 대신 기하 도메인에서 직접 샘플링해 해석 가능하고 견고하다."

[cover]
  image = "teaser.png"
  alt = "PU-Gaussian 개요: 희소 입력 → GaussianNet → 가우시안 예측 → 샘플·정제 → 조밀 출력"
  caption = "PU-Gaussian 개요 — 희소 입력을 이방성 가우시안으로 예측 후 샘플·정제 · 원논문 Figure 1 (Khater et al., [arXiv:2509.20207](https://arxiv.org/abs/2509.20207), 학습용 인용)"
  relative = true
+++

> 📄 **논문**: *PU-Gaussian: Point Cloud Upsampling using 3D Gaussian Representation*, Mahmoud Khater 외 (Univ. Freiburg / Fraunhofer IPM) — [arXiv:2509.20207](https://arxiv.org/abs/2509.20207) · **ICCV 2025 e2e3D Workshop**
> 💻 **코드**: [mvg-inatech/PU-Gaussian](https://github.com/mvg-inatech/PU-Gaussian) (MIT)
> 🔗 관련 정리: [PUFM++ — Flow Matching으로 점군 업샘플링]({{< ref "/posts/pufm-plus-plus" >}}) — 같은 "점군 업샘플링" 문제를 **다른 방식**(생성 궤적 vs 명시적 기하)으로 푼다.
>
> ⚠️ Figure 1·2는 원논문 그림(출처 명기, 학습용 인용), 부록 도식은 직접 작성.

## 논문 카드 (CELOS 양식)

연구실 보고 양식(CELOS)으로 정리한 슬라이드다. 제목줄을 눌러 펴고, 이미지를 누르면 원본 크기로 열린다.

{{< celos title="[2025] PU-Gaussian : Point Cloud Upsampling" src="celos-card.png" />}}

## 한 줄 요약

점 하나하나의 **국소 이웃을 이방성 3D 가우시안** `𝒩(μ, Σ)`으로 모델링하고, **그 가우시안에서 새 점을 샘플링**한 뒤 **정제**해 희소 점군을 조밀하게 만든다. 암시적 특징(implicit feature)에만 기대던 기존 방식과 달리 **기하 도메인에서 직접 샘플링**해 해석 가능하고 노이즈·희소 입력에 견고. PU-GAN·PU1K에서 SOTA.

## 배경 / 문제

3D 센서 점군은 희소하고 노이즈가 많은데, 표면 복원·인식은 조밀·고품질 점군을 원한다. 기존 업샘플링은 (1) 암시적 특징에 의존해 **해석성**이 떨어지거나 (2) 노이즈·희소 입력에 **견고성**이 부족했다. PU-Gaussian은 "점 주변을 가우시안으로 그린다"는 **명시적 기하 표현**으로 이 둘을 잡는다.

## 핵심 아이디어

각 입력 점 `x_i`의 국소 이웃을 **이방성 가우시안**으로 본다. 공분산을 3D Gaussian Splatting과 동일하게 분해:

```text
Σ = R S Sᵀ Rᵀ      # R: 회전(방향), S: 축별 스케일(크기)
```

→ 표면을 따라 **납작한 타원체**가 국소 형상에 밀착한다. 이 타원체에서 점을 뽑으면(샘플링) 표면 위에 자연스럽게 조밀한 점이 깔린다. (직관은 [부록](#부록-수식-직관-가이드))

## 파이프라인

{{< img src="pipeline.png" alt="PU-Gaussian 2단계 파이프라인" caption="2단계 파이프라인 — (위) Gaussian Network: Point Transformer 특징 → μ/R/S 예측 → 샘플 → Coarse, (아래) Refinement Network: coarse+특징 → offset로 정제 → Refined. 원논문 Figure 2 (Khater et al., arXiv:2509.20207, 학습용 인용)" >}}

**Stage 1 — Gaussian Network & 샘플링**
- Point Transformer로 특징 추출 → 3개 head: **스케일 S**(softmax), **회전 R**(quaternion), **오프셋 Δ**.
- 평균 `μ = Δ + P_in`. 각 가우시안에서 **reparameterization trick**으로 `r`개 점 샘플 → coarse 점군. (2σ 벗어난 샘플은 버려 형상 제어)

**Stage 2 — Refinement Network**
- coarse 점을 특징공간에 투영·결합 → Point Transformer → **잔차 오프셋** 예측 → `P_up = P_coarse + Δ`.
- 추론 시 정제를 **2회** 반복해 안정화.

## 결과

CD/HD/P2F 모두 **낮을수록 좋음** (×10⁻³).

**PU-GAN 4×**

| 방법 | CD | HD | P2F |
|---|:--:|:--:|:--:|
| Grad-PU | 0.260 | 2.462 | 1.949 |
| RepKPU | 0.248 | 2.880 | 1.906 |
| APU-LDI | 0.232 | **1.679** | **1.338** |
| **PU-Gaussian** | **0.228** | 1.710 | 1.660 |

**PU-GAN 16×**

| 방법 | CD | HD | P2F |
|---|:--:|:--:|:--:|
| Grad-PU | 0.132 | 2.421 | 2.190 |
| RepKPU | 0.107 | 3.345 | 2.068 |
| APU-LDI | 0.092 | 1.504 | 1.544 |
| **PU-Gaussian** | **0.079** | **1.443** | 1.720 |

**PU1K 4×**: CD **0.323**(SOTA), HD **2.593**(SOTA) — Grad-PU/RepKPU/APU-LDI 대비 우위.

- **견고성**: 노이즈(τ=0.01)에선 APU-LDI 다음 2위지만 single-pass 방법들은 모두 상회. **희소 입력(256~1024점)** 에선 composite CD **0.8803** 로 RepKPU(0.915)·PU-CRN(1.205)보다 확실히 좋음 → 일반화 강함.
- 실제 데이터(KITTI, Fraunhofer IPM 건물 스캔)에서도 outlier 감소·기하 보존.

## 돌려보기

```bash
git clone https://github.com/mvg-inatech/PU-Gaussian.git && cd PU-Gaussian
pip install -r requirements.txt
cd pointops && pip install . && cd ../utils/chamfer3d && pip install . && cd ../..

# 임의 크기 점군 업샘플 (RAM 한도 내)
python infer.py --inference_input_path input.pcd \
  --inference_output_path out.ply \
  --ckpt pretrained_model/pu_gaussian_pugan_Best.pth --return_color --patch_size 10000
```

## 메모

- **PUFM++와 대조**: 둘 다 점군 업샘플링인데, [PUFM++]({{< ref "/posts/pufm-plus-plus" >}})는 희소→조밀을 **생성 궤적(flow matching)** 으로 잇고, PU-Gaussian은 **명시적 기하(가우시안)** 에서 직접 샘플한다. 후자는 "어디에 왜 점이 생기는지"가 눈에 보여 **해석성**이 장점.
- 3D Gaussian Splatting의 `Σ = RSSᵀRᵀ` 파라미터화를 **렌더링이 아니라 업샘플링**에 가져온 게 재밌는 지점.
- 우리 센서퓨전/포인트클라우드 파이프라인에서 **희소 LiDAR 점군 조밀화** 후처리 후보.
- 원문: [arXiv:2509.20207](https://arxiv.org/abs/2509.20207) · 코드: [mvg-inatech/PU-Gaussian](https://github.com/mvg-inatech/PU-Gaussian)

---

## 부록: 수식 직관 가이드

> 핵심 수식을 비유와 그림으로. (도식은 직접 작성)

### A. 이방성 가우시안

```text
Σ = R S Sᵀ Rᵀ
  S : 축별 크기(얼마나 퍼지나)   R : 방향(어느 쪽으로 눕나)
```

{{< img src="apx-gaussian.png" alt="등방성 vs 이방성 가우시안" caption="등방성(원)은 사방 균일이라 표면을 못 살리고, 이방성(타원)은 표면 방향으로 납작해 국소 형상에 밀착" >}}

**비유**: 각 점에 **방향 있는 물방울**을 하나씩 붙인다고 생각하면 된다. 평평한 벽 위의 점이라면 물방울이 **벽을 따라 납작하게** 퍼지고(표면 방향은 크게 `S`, 표면 수직은 작게), 그 방향은 `R`이 정한다. 이렇게 국소 형상을 닮은 타원체를 만들면, 거기서 뽑은 점들이 **표면 위에 자연스럽게** 놓인다. (등방성 = 방향 없는 공 모양 → 표면을 못 살림)

### B. Reparameterization 샘플링

```text
P_coarse = μ + Σ ⊙ ε ,   ε ~ 𝒩(0, I)
```

**비유**: 표준 정규분포라는 **주사위 `ε`** 를 굴려 무작위 값을 얻은 뒤, 그것을 가우시안의 **크기·방향(Σ)만큼 늘려·돌리고 중심(μ)으로 옮겨** 점을 놓는다. 무작위성을 `ε`에 몰아넣어서 **미분이 가능**해지고(= 네트워크가 μ, Σ를 학습할 수 있음), 이게 VAE에서 쓰는 그 reparameterization trick이다.

### C. 가우시안 정규화 손실

```text
L_Gaussian = (1/N) Σ (x_i − μ_i)ᵀ Σ_i (x_i − μ_i)
```

**비유**: 예측한 가우시안이 **실제 점을 잘 감싸도록** 조이는 항. 실제 점이 가우시안 중심에서 너무 벗어나면 벌점을 줘서, 타원체가 국소 이웃에 딱 맞게 학습된다. 최종 출력엔 여기에 **Chamfer 거리**(정답 점군과의 정합)를 더해 학습한다.
