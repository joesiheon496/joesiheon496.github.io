+++
title = "대응 두 개면 회전이 풀린다 — 2점 RANSAC, Wahba 문제, Cauchy 커널의 수식"
date = 2026-08-25T10:00:00+09:00
draft = false
math = true
tags = ["컴퓨터비전", "캘리브레이션", "RANSAC", "SVD", "최적화"]
categories = ["프로그램"]
summary = "거짓 대응이 절반을 넘는 매칭에서 어떻게 초기 자세를 뽑아내는가. SuperGlue(MegaDepth 사전학습)가 어텐션과 최적 수송으로 매칭을 풀면서도 교차 모달 입력에서는 왜 거짓 대응을 쏟아낼 수밖에 없는지, RANSAC의 반복 수 공식이 왜 '최소 표본을 줄이라'고 명령하는지, 작은 병진 가정이 어떻게 6-DoF 문제를 2점짜리 회전 문제로 접는지, 그 회전이 왜 SVD 한 번으로 닫힌형으로 풀리는지(Wahba), 그리고 남은 병진을 Levenberg-Marquardt + Cauchy 커널이 어떻게 회수하는지 — Koide+ ICRA 2023의 초기 추정 단계를 수식으로 완주한다. 모든 수치 예제는 numpy로 직접 실행해 확인했다."
+++

> 🔧 **범위와 검증**: 수식 전개는 [Koide+ ICRA 2023 정리 글]({{< ref "/posts/direct-visual-lidar-calibration" >}})에서 한 문단으로 지나갔던 초기 추정 단계(§III)를 풀어 쓴 것이다. 반복 수 표·합성 실험·IRLS 데모의 수치는 전부 numpy로 직접 실행해 확인한 실측값이다. SVD로 trace를 최대화하는 대목은 [SVD 글]({{< ref "/posts/svd" >}})의 도구를 그대로 쓴다.

## 한 줄 요약

> 아웃라이어가 지배하는 대응에서 RANSAC의 비용은 최소 표본 크기 \(s\)에 대해 **지수적**이다.
> 그래서 "작은 병진" 가정으로 6-DoF를 회전 3-DoF로 접어 \(s\)를 2까지 줄이고(닫힌형 SVD 해), 접으면서 버린 병진은 아웃라이어가 걸러진 뒤 Cauchy 커널을 쓴 LM이 회수한다. **먼저 거칠게 접고, 나중에 정확하게 펴는** 설계다.

## 문제 설정 — SuperGlue가 남긴 것

LiDAR 인텐시티 이미지와 카메라 이미지를 SuperGlue로 매칭하면, 대응 \(M\)개가 나온다. 인텐시티 이미지의 각 픽셀은 자기를 만든 LiDAR 3D 점을 기억하고 있으므로, 대응 하나는 결국 **3D 점 ↔ 2D 픽셀** 쌍이다:

$$
\{(\,{}^{L}\boldsymbol{p}_j,\ \boldsymbol{x}_j\,)\}_{j=1}^{M}, \qquad {}^{L}\boldsymbol{p}_j \in \mathbb{R}^3,\ \boldsymbol{x}_j \in \mathbb{R}^2
$$

찾을 것은 LiDAR 좌표를 카메라 좌표로 옮기는 변환 \({}^{C}T_{L} = (R, \boldsymbol{t}) \in \mathrm{SE}(3)\)이다. 문제는 이 대응의 **상당수가 거짓**이라는 것 — 왜 그런지는 SuperGlue가 어떻게 만들어졌는지를 보면 필연이다.

## SuperGlue는 무엇을 하는가 — 그리고 왜 거짓 대응을 쏟아내는가

SuperGlue(Sarlin+, CVPR 2020)는 특징점 **검출기가 아니라 매처**다. 검출은 앞단의 SuperPoint가 한다 — 각 이미지에서 키포인트 위치와 기술자(descriptor) 벡터를 뽑는 자기지도 학습 검출기다. SuperGlue는 이 두 키포인트 집합을 받아 "누가 누구와 짝인가"를 푸는데, 두 가지 설계가 고전적 최근접 매칭과 갈라놓는다.

**① 문맥을 보는 매칭.** 키포인트들을 그래프의 노드로 놓고, 같은 이미지 안의 어텐션(self-attention)과 상대 이미지로의 어텐션(cross-attention)을 교대로 쌓아 기술자를 문맥화한다. 기술자 혼자서는 "모서리"일 뿐이지만, 어텐션을 거치면 "큰 창문의 왼쪽 위 모서리, 문 옆"이 된다 — 반복 구조(창문 수십 개)에서 국소 기술자만으로는 구분 불가능한 후보들이 배치 정보로 갈라진다.

**② 매칭을 최적 수송으로.** 문맥화된 기술자들의 유사도 행렬에 **dustbin**(짝이 없는 점들이 버려지는 행/열)을 덧붙이고, Sinkhorn 반복으로 부분 할당(partial assignment)을 푼다. 한 점이 두 점과 짝이 되는 모순을 구조적으로 막고, 각 매칭에 신뢰도 점수를 준다 — 최종 매칭은 이 신뢰도가 임계값을 넘는 쌍만 남긴다.

**MegaDepth 사전학습의 의미.** Koide+가 쓴 가중치는 MegaDepth — 인터넷 관광 사진 수십만 장에 SfM/MVS로 기하 정답을 붙인 실외 데이터셋 — 로 학습된 것이다. 즉 이 네트워크는 **"사진 ↔ 사진"** 매칭을 배웠지, LiDAR 인텐시티는 한 번도 본 적이 없다. 그런데도 동작하는 이유는 [본편]({{< ref "/posts/direct-visual-lidar-calibration" >}})의 관점 그대로다 — 히스토그램 평활화까지 마친 인텐시티 이미지는 흑백사진과 통계적으로 충분히 닮았다.

닮았다고 같은 건 아니어서, 대가가 신뢰도에서 나타난다. 학습 분포 밖의 입력이라 신뢰도 보정이 무너지고, 통상 수준(0.2 안팎)의 임계값으로는 매칭이 거의 살아남지 않는다. 그래서 논문은 임계값을 **0.05**까지 내린다 — 매칭 수를 얻는 대신 거짓 대응이 대량으로 섞이는 거래다. 이것이 이 글 전체의 전제, "인라이어 비율 \(w\)가 절반 아래"의 출처다. (같은 이유로 어텐션의 위치 정보가 큰 회전 불일치에 약해서, 툴박스는 카메라 이미지를 90° 단위로 돌려 넣는 `--rotate_camera` 옵션을 둔다.)

정리하면 — SuperGlue는 "많되 더러운" 대응을 주는 장치로 쓰이고 있고, 뒷단은 그 전제 위에서 설계된다.

## RANSAC 산수 — 왜 표본을 줄여야 하는가

RANSAC이 "전부 인라이어인 표본"을 확률 \(p\)로 한 번 이상 뽑으려면 몇 번 반복해야 하나. 한 번의 추출(크기 \(s\))이 전부 인라이어일 확률은 \(w^s\)이고, \(N\)번 모두 실패할 확률이 \(1-p\)가 되게 하면:

$$
(1 - w^s)^N = 1 - p \quad\Longrightarrow\quad N = \frac{\log(1-p)}{\log(1 - w^s)}
$$

이 식의 성질이 설계를 결정한다. \(N\)은 \(s\)에 대해 **지수적으로** 자란다 (\(w^s\)가 지수적으로 작아지므로). \(p = 0.99\)로 계산한 표:

| 인라이어 비율 \(w\) | \(s=2\) (본 방법) | \(s=3\) (P3P) | \(s=4\) |
|:--:|:--:|:--:|:--:|
| 0.5 | 17 | 35 | 72 |
| 0.3 | 49 | 169 | 567 |
| 0.2 | **113** | 574 | 2,876 |
| 0.1 | **459** | 4,603 | 46,050 |

2D-3D에서 6-DoF를 직접 푸는 최소 문제는 P3P, 즉 \(s=3\)이다. \(w=0.2\)라면 표본을 3개에서 2개로 줄이는 것만으로 반복이 574 → 113으로, \(w=0.1\)이면 4,603 → 459로 준다. **아웃라이어가 많을수록 표본 하나의 값이 지수적으로 비싸진다** — 그래서 이 논문은 6-DoF가 아니라 회전만 푸는 길을 택한다.

## 접기 — 작은 병진 가정이 6-DoF를 3-DoF로

픽셀 \(\boldsymbol{x}_j\)는 역투영하면 카메라에서 그 점을 바라보는 **방향**(베어링 벡터)이 된다:

$$
\boldsymbol{b}_j^{C} = \frac{\pi^{-1}(\boldsymbol{x}_j)}{\|\pi^{-1}(\boldsymbol{x}_j)\|}, \qquad
\boldsymbol{b}_j^{L} = \frac{{}^{L}\boldsymbol{p}_j}{\|{}^{L}\boldsymbol{p}_j\|}
$$

카메라에서 본 점의 방향은 정확히는 \(R\,{}^{L}\boldsymbol{p}_j + \boldsymbol{t}\)의 방향이다. 여기서 가정 하나 — **센서 간 거리 \(\|\boldsymbol{t}\|\)는 장면 깊이 \(\|{}^{L}\boldsymbol{p}_j\|\)에 비해 작다** (한 리그에 붙은 LiDAR와 카메라는 수십 cm, 장면은 수 m~수십 m). 그러면:

$$
\boldsymbol{b}_j^{C} \;\approx\; R\, \boldsymbol{b}_j^{L}
$$

병진이 식에서 사라졌다. 남은 미지수는 회전 \(R\)의 3-DoF뿐이다. 자유도를 세어 보면 최소 표본이 왜 2인지 나온다 — 단위벡터 쌍 하나는 제약 2개를 주지만(방향 일치), 그 축 둘레 회전 1-DoF가 남는다. 비평행 쌍 하나를 더 얹으면 제약 4개 ≥ 3-DoF로 확정된다. **대응 2개면 회전이 풀린다.**

이 가정의 대가(병진 무시로 인한 베어링 오차)는 뒤에서 LM이 청산한다 — 지금 필요한 건 정확한 답이 아니라 **아웃라이어를 가려낼 만큼 좋은 답**이기 때문이다.

## 닫힌형으로 풀기 — Wahba 문제와 SVD

베어링 쌍들에서 회전을 찾는 문제는 위성 자세 결정에서 온 고전, **Wahba 문제**다:

$$
R^{*} = \arg\min_{R \in \mathrm{SO}(3)} \sum_j \left\| \boldsymbol{b}_j^{C} - R\,\boldsymbol{b}_j^{L} \right\|^2
$$

전개하면 \(\|\boldsymbol{b}^C\|^2 = \|\boldsymbol{b}^L\|^2 = 1\)이라 상수항만 남고, 교차항 최대화로 바뀐다:

$$
R^{*} = \arg\max_{R} \sum_j (\boldsymbol{b}_j^{C})^{\!\top} R\, \boldsymbol{b}_j^{L}
= \arg\max_{R}\ \mathrm{tr}\!\left(R\,H\right), \qquad
H = \sum_j \boldsymbol{b}_j^{L} (\boldsymbol{b}_j^{C})^{\!\top}
$$

(스칼라 \(a^\top R b = \mathrm{tr}(R\,b\,a^\top)\) 항등식으로 합을 행렬 하나에 몰아넣었다.) 이제 \(H\)를 SVD로 쪼갠다: \(H = U \Sigma V^\top\). 그러면

$$
\mathrm{tr}(R H) = \mathrm{tr}(R\, U \Sigma V^\top) = \mathrm{tr}(V^\top R\, U\, \Sigma) = \mathrm{tr}(K \Sigma) = \sum_i \sigma_i K_{ii}
$$

\(K = V^\top R U\)는 직교행렬들의 곱이니 직교행렬이고, 직교행렬의 원소는 \(|K_{ii}| \le 1\)이다. 따라서 \(\mathrm{tr}(K\Sigma) \le \sum_i \sigma_i\)이고 등호는 \(K = I\)일 때 — 즉:

$$
R^{*} = V\, \mathrm{diag}\big(1,\ 1,\ \det(V U^\top)\big)\, U^\top
$$

가운데 \(\det\) 보정은 \(K=I\) 해가 반사(\(\det = -1\))로 떨어지는 경우를 \(\mathrm{SO}(3)\)로 되돌리는 표준 장치다(Kabsch). 반복도 초기값도 없이, **SVD 한 번이 전역 최적해**를 준다. "직교 제약 아래 trace 최대화는 SVD가 푼다"는 [SVD 글]({{< ref "/posts/svd" >}})에서 본 그 근육이다.

## 조립 — 회전 전용 RANSAC

이제 부품이 다 모였다. 논문의 Algorithm 1이 하는 일:

1. 대응 2개를 무작위 추출 (두 베어링이 평행하면 퇴화 — 스킵)
2. 위 닫힌형으로 \(R\) 계산
3. 모든 대응에 대해 \(\|\pi(R\,{}^{L}\boldsymbol{p}_j) - \boldsymbol{x}_j\| < \alpha\)로 인라이어 집계 (\(\boldsymbol{t}=0\)으로 투영)
4. \(N\)번 반복 후 인라이어 최다인 \(R\) 채택, 인라이어 전체로 재추정

합성 실험으로 확인했다 (대응 50개, **거짓 60%**, 인라이어 베어링 노이즈 0.2°, numpy 실측):

```text
=== A. clean 2 pairs -> Kabsch rotation error: 0.3758 deg
=== B. 2-point RANSAC (27 iters, 60% outliers):
    inliers found: 20/50 (true: 20)
    rotation error: RANSAC 0.195 deg -> all-inlier refit 0.057 deg
    naive Kabsch on all 50 pairs: 22.0 deg
```

읽는 법: 깨끗한 2쌍만으로도 0.38° (노이즈 수준과 같은 자릿수). 반복 27번짜리 RANSAC은 참 인라이어 20개를 **정확히** 골라냈고, 인라이어 전체 재추정으로 0.057°까지 내려간다. 반면 아웃라이어를 거르지 않고 50쌍 전부에 Kabsch를 돌리면 22° — 최소자승은 아웃라이어 앞에서 무력하다는 것, 그래서 RANSAC이 최소자승 **앞에** 서야 한다는 것이 숫자로 보인다.

## 펴기 — Levenberg-Marquardt + Cauchy로 6-DoF 회수

회전은 얻었지만 병진은 0으로 뒀고, 인라이어 집합에도 거짓 대응이 몇 개 숨어 있을 수 있다. 마지막 단계는 재투영 오차의 로버스트 최소화다:

$$
{}^{C}\tilde{T}_{L} = \arg\min_{{}^{C}T_{L}} \sum_{j=1}^{M} \rho\!\left( \left\| \pi\!\left({}^{C}T_{L}\, {}^{L}\boldsymbol{p}_j\right) - \boldsymbol{x}_j \right\|^2 \right)
$$

초기값은 방금의 \((R^{*}, \boldsymbol{0})\) — "작은 병진" 가정으로 빌린 빚을 여기서 갚는다.

### Cauchy 커널: 아웃라이어의 발언권을 뺏는 법

\(\rho\)가 항등함수면 보통의 최소자승이고, 잔차 \(r\)의 손실 기여가 \(r^2\)로 자라 큰 잔차(=아웃라이어)가 해를 지배한다. Cauchy 커널은 성장을 로그로 꺾는다:

$$
\rho(s) = \frac{c^2}{2} \log\!\left(1 + \frac{s}{c^2}\right), \qquad s = r^2
$$

이게 실제로 무엇을 하는지는 미분해 보면 보인다. IRLS(반복 재가중 최소자승) 관점에서 각 잔차가 받는 가중치는 \(\rho'(s)\)에 비례하고:

$$
w(r) \;\propto\; \rho'(r^2) = \frac{1}{2}\cdot\frac{1}{1 + r^2/c^2}
$$

잔차가 \(c\) 근처면 가중치가 절반, \(c\)의 10배면 1/101 — **부드러운 인라이어 판정**이다. RANSAC의 이진 판정(문턱 \(\alpha\) 안/밖)을 연속 버전으로 이어받는 셈이다. 장난감 문제로 확인하면 (참값 1.0 근처 10개 + 아웃라이어 100 하나, numpy 실측):

```text
=== C. robust mean (true 1.0, outlier 100):
    L2 mean = 9.992 | Cauchy IRLS = 0.9884
    outlier weight after convergence: 1.02e-06
```

L2 평균은 아웃라이어 하나에 10배 끌려가지만, Cauchy IRLS는 수렴 후 아웃라이어에게 **가중치 백만분의 일**을 주고 참값 곁에 남는다.

### LM: 믿는 만큼만 걷는다

목적함수가 정해졌으니 최적화다. 잔차 벡터 \(\boldsymbol{r}(\theta)\)의 야코비안 \(J\)로 Gauss-Newton 갱신을 만들되, Levenberg-Marquardt는 감쇠 \(\lambda\)를 끼운다:

$$
\left(J^\top W J + \lambda\, I\right) \delta = -\,J^\top W \boldsymbol{r}
$$

(\(W\)는 위 Cauchy 가중치의 대각행렬 — 로버스트 커널이 실무에서 IRLS 가중치로 구현되는 이유다.) \(\lambda \to 0\)이면 Gauss-Newton(2차 근사를 신뢰), \(\lambda\)가 크면 스텝이 \(-J^\top W \boldsymbol{r}\) 방향의 짧은 경사하강으로 죽는다. 갱신이 손실을 줄이면 \(\lambda\)를 낮춰 크게 걷고, 실패하면 \(\lambda\)를 올려 보수적으로 — **근사를 믿는 만큼만 걷는 자동 조절기**다. 회전 성분의 파라미터화(축각 섭동)에 대해서는 [SO(3) 글]({{< ref "/posts/rotation-so3" >}})이 다뤘다.

## 정리

| 단계 | 수식 | 왜 이렇게 |
|---|---|---|
| 반복 수 | \(N = \log(1-p)/\log(1-w^s)\) | \(s\)에 지수적 → 최소 표본을 줄이는 게 최고의 가속 |
| 접기 | \(\boldsymbol{b}^C \approx R\,\boldsymbol{b}^L\) (\(\|\boldsymbol{t}\| \ll\) 깊이) | 6-DoF → 3-DoF, 최소 표본 3 → 2 |
| 닫힌형 | \(R^* = V\,\mathrm{diag}(1,1,\det(VU^\top))\,U^\top\) | Wahba: trace 최대화는 SVD가 전역해를 준다 |
| 거르기 | 재투영 오차 \(< \alpha\) 인라이어 집계 | 최소자승은 아웃라이어에 무력 — 실측 22° vs 0.057° |
| 펴기 | \(\min \sum \rho(\|\pi(T\boldsymbol{p}) - \boldsymbol{x}\|^2)\), Cauchy + LM | 병진 회수 + 잔존 거짓 대응은 가중치 \(\to\) 0 |

이 설계의 미덕은 각 단계가 **다음 단계가 감당할 수 있는 만큼만 틀리게** 만들어져 있다는 것이다. 작은 병진 가정은 회전을 틀리게 하지만 인라이어 판별이 견딜 만큼만, RANSAC 인라이어에는 거짓이 남지만 Cauchy가 침묵시킬 만큼만. 정밀한 답을 한 번에 구하는 대신, 거친 답으로 문제를 좁혀 가는 — 초기화 설계의 교과서적 형태다.
