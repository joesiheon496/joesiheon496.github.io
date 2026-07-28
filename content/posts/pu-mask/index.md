+++
title = "PU-Mask : 업샘플링을 '생성'이 아니라 '빈칸 채우기'로 본다"
date = 2026-07-28T15:35:00+09:00
draft = false
tags = ["논문정리", "point-cloud", "upsampling", "transformer", "attention", "TCSVT"]
categories = ["논문"]
summary = "희소 점군은 원래 조밀했던 점군을 가상 마스크로 국소적으로 가린 결과라고 가정한다. 그러면 업샘플링은 무제약 생성이 아니라 마스크 뒤에 숨은 점을 복원하는 문제가 된다. 마스크 유도 비대칭 트랜스포머 오토인코더와 학습 가능한 의사 라플라시안으로 좌표를 보정한다."

[cover]
  image = "sample-output.png"
  alt = "PU-Mask 저장소 테스트 샘플: Panda와 Tiger의 2048점 입력과 8192점 출력"
  caption = "저장소에 포함된 테스트 입출력을 직접 렌더링한 것 (2,048점 → 8,192점, 4×)"
  relative = true
+++

> 📄 **논문**: *PU-Mask: 3D Point Cloud Upsampling via an Implicit Virtual Mask*, Hao Liu, Hui Yuan, Raouf Hamzaoui, Qi Liu, Shuai Li — **IEEE T-CSVT** vol. 34, no. 7, pp. 6489–6502, 2024.07 ([doi:10.1109/TCSVT.2024.3370001](https://doi.org/10.1109/TCSVT.2024.3370001))
> 💻 **코드**: [liuhaoyun/PU-Mask](https://github.com/liuhaoyun/PU-Mask) (TensorFlow)
> 🔗 관련 정리: [Grad-PU]({{< ref "/posts/grad-pu" >}}) · [ReLPU]({{< ref "/posts/relpu" >}}) · [PU-Gaussian]({{< ref "/posts/pu-gaussian" >}})
>
> ⚠️ **이 글의 근거 범위**: 본문 전문이 IEEE 유료 구독 뒤에 있어 **정량 결과 표와 절제 실험을 확인하지 못했다.** 아래 방법 설명은 **초록 + 공개된 구현 코드를 직접 읽고** 정리한 것이고, 논문이 보고한 수치는 싣지 않았다. 그림도 원논문 것이 아니라 저장소의 테스트 입출력과 코드를 근거로 직접 만들었다.

## 한 줄 요약

기존 업샘플링은 "없는 점을 만들어낸다"는 **무제약 생성(unconstrained generative)** 문제로 다뤄졌다. PU-Mask는 관점을 뒤집는다.

> **희소 입력 점군은 원래 조밀했던 점군을 가상 마스크로 국소적으로 가린 결과**라고 가정한다. 그러면 우리가 할 일은 생성이 아니라 **마스크 뒤에 숨은 점을 채우는 것(local filling)** 이다.

마스크는 실제로 존재하지 않으니 먼저 **어디를 가렸는지 찾아 마스크를 만들고**, 그 마스크가 트랜스포머 디코더를 유도해 특징을 복원한다. 마지막에 **학습 가능한 의사 라플라시안 연산자**로 좌표를 보정한다.

## 초록이 말하는 구성 요소

논문 초록 기준으로 기여는 다섯 개다.

1. **가상 마스크 생성 모듈** — 마스크의 위치를 찾아 형태를 구성
2. **MTAA** (mask-guided transformer-style asymmetric auto-encoder) — 업샘플 특징 복원
3. **2차 전개 어텐션**(second-order unfolding attention) — MTAA의 채널 간 상호작용 강화
4. **마스크 전용 풀링** — coarse 업샘플 점군 생성
5. **학습 가능한 의사 라플라시안 연산자** — coarse를 보정해 refined 출력

## 코드에서 읽은 파이프라인

논문 그림을 볼 수 없으므로, 공개된 `Upsampling/generator.py`와 `Common/ops.py`를 읽어 흐름을 재구성했다.

{{< img src="pipeline.png" alt="PU-Mask 파이프라인 도식" caption="공개 코드의 Generator를 따라 그린 흐름도 (도식 직접 작성). 각 상자 이름은 코드의 실제 함수명" >}}

### ① 특징 추출 — `feature_extraction_RCB`

Chain Residual Block(CRB)을 쌓은 인코더다. 성장률 24, kNN 15로 4개 층을 거치며 각 층 출력을 앞선 특징과 **dense concat** 한다 (24 → 96 → 224 → 352 → 480 채널). PU-GAN/PU-GCN 계열의 dense 특징 추출기와 같은 계보.

### ② 가상 마스크 생성 — `Pre_upsampling`

여기가 "마스크를 찾는" 부분인데, 코드는 놀랄 만큼 단순하다.

```python
knn_xyz, idx = get_KNN_feature(xyz, k=12)      # [B,N,K,3]
mask = central_xyz - knn_xyz                    # 중심점 − 이웃 상대좌표
mask = conv2d(mask, dim//2, ...)                # MLP
features_global = tf.reduce_max(mask, axis=1)   # 전역 maxpool
mask = tf.concat([mask, tile(features_global)]) # 지역+전역 결합
mask = conv2d(mask, dim, ...)                   # → 256채널 마스크 특징
```

**각 점의 12-이웃 상대좌표를 펼쳐 MLP에 넣고, 전역 특징을 붙인다.** 즉 마스크는 명시적인 이진 마스크가 아니라 **"이 점 주변이 얼마나 비어 있는가"를 인코딩한 256차원 특징 벡터**다. 논문 제목의 *implicit*(암시적)이 정확히 이 뜻이다.

### ③ MTAA — `Mask_Feature_Expand`

```text
입력 특징 F + 2D 그리드  →  Adjust MLP(256)  →  인코더 어텐션 1개
마스크 M + 그리드        →  MLP(512)
                         ↓ concat
디코더:  L0 = [head0, head1] → MLP(512)
        L1 = [head0, head1] → MLP(512)
        L2 = [head0, head1] → Linear(1536)
```

**비대칭(asymmetric)** 이라는 말의 의미가 코드에서 드러난다. **인코더는 어텐션 1개, 디코더는 3층 × 2 head** 로 훨씬 두껍다. 복원 쪽에 용량을 몰아준 구조다.

그리고 **마스크는 디코더에만 들어간다.** 인코더는 입력 점군만 보고, 디코더가 "어디를 채워야 하는가"를 마스크로부터 받는다. 이게 "mask-guided"의 실체다.

각 어텐션 유닛(`attention_unit`)은 **self-attention과 채널 어텐션(SE-Net)을 함께** 쓴다.

```python
f = conv2d(inputs, dim//4)   # query
g = conv2d(inputs, dim//4)   # key
h = conv2d(inputs, dim)
h = SE_NET(h)                          # ← 채널 어텐션
s = matmul(g, f, transpose_b=True)     # [B,N,N]
beta = softmax(s)
o = matmul(beta, h)
x = gamma * o + inputs                 # gamma 는 0 초기화 학습 파라미터
```

초록의 "2차 전개 어텐션"이 이 SE 결합을 가리키는 것으로 보이는데, **코드만으로는 확증할 수 없다.** 논문 본문을 봐야 정확히 대응시킬 수 있다.

### ④ 마스크 전용 풀링과 좌표 회귀

```python
local = reshape(H, [B, N, r, C])
local_global = tile(reduce_max(local, axis=2), [1,1,r,1])   # r개 분기에 대한 max
H = concat([H, local_global])                               # → rN × 2C
coord = MLP(H)                    # 3채널
out = tile(inputs, r) + coord     # coarse
```

**같은 점에서 파생된 r개 분기끼리 max pooling** 을 해 그 결과를 각 분기에 되돌려 붙인다. 형제 분기들이 서로를 참조하게 만드는 장치다.

### ⑤ 좌표 보정 — `Coordinate_Refine`

초록의 "학습 가능한 의사 라플라시안 연산자"에 해당하는 부분.

```python
knn_xyz, idx = get_KNN_feature(xyz_up, k=26)
edge_xyz = concat([central_xyz, central_xyz - knn_xyz])   # 절대 + 상대좌표
edge_xyz = MLP → MLP → Residual Block → MLP
feature  = MLP(features)                                   # H 를 같은 차원으로
res = edge_xyz - tile(feature)        # ← 이웃 기하와 특징의 "차이"
res = reduce_max(res, axis=2)
offset = MLP(res)
outputs = out + offset                                     # refined
```

라플라시안이라 부르는 이유가 보인다. **`edge_xyz − feature`는 "이웃들로부터 계산된 값"과 "자기 자신의 값"의 차이**로, 그래프 라플라시안 `L = D − A`가 하는 일(이웃 평균과 자신의 차)과 같은 구조다. 그걸 고정 연산자가 아니라 MLP로 **학습**하니 *pseudo*·*learnable*.

### ⑥ 정확한 개수 맞추기

```python
self.up_ratio_real = self.up_ratio + 2      # 내부적으로 (r+2)배 생성
...
outputs = gather_point(outputs, farthest_point_sample(self.out_num_point, outputs))
```

**여유분을 만들고 FPS로 솎아낸다.** `--more_up 2`가 기본값이라 4× 요청이면 내부적으로 6배를 만든 뒤 4N개를 고른다. PU-GAN 계열의 관행이지만, "요청 배율만큼만 만드는 것보다 넉넉히 만들고 고르는 게 낫다"는 실용적 선택이다.

## 학습 설정 (코드 기준)

| 항목 | 값 |
|---|:--:|
| 패치 점 수 | 256 |
| 업샘플 배율 | 4 (`--more_up 2` → 내부 6배) |
| 배치 | 28 |
| 에폭 | 121 |
| 생성기 lr | 1e-3 (10,000 스텝부터 10,000마다 ×0.7, 하한 1e-6) |
| 손실 | **Chamfer(가중 8500) + PU-GAN uniform loss(가중 10)** |
| repulsion loss | 기본 **꺼짐** |
| 비균일 데이터 증강 | 켜짐 (`--use_non_uniform`) |

주목할 점: **저장소에는 판별자(`discriminator.py`)가 있지만 실제 최적화되는 `pu_loss`에는 GAN 손실이 들어가지 않는다.** CD + uniform 만으로 학습된다. 코드 헤더에 PU-GAN 저자(Ruihui Li)의 이름이 남아 있는 걸로 보아 **PU-GAN 코드베이스에서 출발했고 적대적 학습은 걷어낸** 구성으로 읽힌다.

## 돌려보기

환경이 상당히 낡았다 — **TensorFlow 1.11+, Python 3.6, Ubuntu 16.04**. PointNet++ TF 연산자를 직접 컴파일해야 한다.

```bash
# tf_ops 하위 디렉터리들에서 컴파일 스크립트 실행
# (nvcc / Python / TensorFlow 라이브러리 경로를 환경에 맞게 수정)

python pu_mask.py --phase train     # 학습
python pu_mask.py --phase test      # 추론
```

- 학습 패치(HDF5)와 학습·테스트 메시는 저장소의 Google Drive 링크로 배포된다.
- 사전학습 모델도 Google Drive에 있고 `/model` 폴더에 넣으면 된다.
- 평가 코드는 **CGAL** 설치가 필요하다: `./evaluation Icosahedron.off Icosahedron.xyz`
- 저장소에 Panda·Tiger 테스트 점군과 그 출력이 함께 들어 있어, **모델을 돌리지 않고도 결과물을 확인할 수 있다.** 이 글의 커버 이미지가 그것을 렌더링한 것이다 (2,048 → 8,192점).

## 메모

- **"생성이 아니라 채우기"라는 프레이밍이 이 논문의 진짜 기여**라고 본다. 수식이나 모듈보다 관점의 전환이 먼저다. 무제약 생성으로 보면 "어디에 점을 놓을지"에 제약이 없어 아웃라이어가 생기지만, 빈칸 채우기로 보면 **"비어 있는 곳"이라는 사전 제약**이 생긴다. 이게 [Grad-PU]({{< ref "/posts/grad-pu" >}})가 "좌표 대신 거리를 예측한다"로 얻는 것과 비슷한 종류의 이득이다.
- **다만 "마스크"라는 이름이 실제 구현보다 거창하다.** 코드를 열어보면 12-이웃 상대좌표를 MLP에 통과시킨 특징 벡터이고, 명시적으로 "여기가 가려졌다"고 판정하는 단계는 없다. 개념적 프레이밍과 구현 사이의 거리를 알고 읽는 게 좋다.
- **의사 라플라시안 보정은 다른 곳에도 쓸 만하다.** 이웃 기하로부터 계산한 값과 자기 특징의 차이를 offset으로 회귀하는 구조는, 업샘플링뿐 아니라 점군 디노이징·정합 후처리에도 그대로 옮길 수 있다.
- **환경이 발목을 잡는다.** TF1 + Python 3.6 + 직접 컴파일하는 CUDA 연산자 조합은 2026년 기준으로 재현이 꽤 고통스럽다. 같은 문제를 PyTorch로 다루는 [Grad-PU]({{< ref "/posts/grad-pu" >}})와 비교하면 실험 진입 비용 차이가 크다.
- **아쉬운 점은 이 글에도 남는다.** 유료 논문이라 저자들이 보고한 CD/HD/P2F와 절제 실험을 확인하지 못했다. 성능을 근거로 이 방법을 선택할지 판단하려면 IEEE Xplore 접근이 필요하다. [ReLPU]({{< ref "/posts/relpu" >}}) 논문이 관련연구에서 이 방법을 "암시적 가상 마스크로 디테일 있고 구조적인 점군 생성을 유도한다"고 인용하는 정도가 외부에서 확인 가능한 평가다.

---

**Sources**

- [PU-Mask: 3D Point Cloud Upsampling via an Implicit Virtual Mask — IEEE Xplore](https://ieeexplore.ieee.org/document/10445295/) (초록)
- [liuhaoyun/PU-Mask — GitHub](https://github.com/liuhaoyun/PU-Mask) (README 및 구현 코드)
- [Raouf Hamzaoui 논문 목록](https://www.tech.dmu.ac.uk/~hamzaoui/publications.html) (서지 정보 확인)
