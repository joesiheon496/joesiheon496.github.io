# `camera-latency` 글의 실측 코드

`content/posts/camera-latency/index.md` 의 표와 그림에 들어간 숫자는 전부 여기서
나왔다. **`results/*.json` 이 글의 유일한 숫자 출처**이고, 글도 그림도 그 JSON 만 읽는다.

**카메라가 필요 없다.** 전부 localhost 루프백이다 — 원래는 RealSense D455 로 센서→호스트
구간을 재려 했으나 취소됐고, 그래서 글의 예산 아홉 칸 중 앞의 여섯 칸은 재지 않았다.

## 파일

| 스크립트 | 출력 | 글의 절 |
|---|---|---|
| `common.py` | — | 공통 하네스 (환경 블록, 최근접 순위 백분위, JSON 쓰기) |
| `measure_encoder.py` | `results/encoder.json` | 실측 1 — 인코더 구조적 지연 |
| `measure_buffer.py` | `results/buffer.json` | 실측 2 — 수신 버퍼 누적 |
| `measure_arrival.py` | `results/arrival.json` | 실측 3 의 입력 — 도착 시각 |
| `compute_jitter.py` | `results/jitter.json` | 실측 3 — 지터버퍼 곡선 |
| `make_figures.py` | 글 폴더의 PNG 3장 | 커버 + 실측 1·2 그림 |

## 측정 환경

```
Windows 11 x64 (build 26100)
conda env "camera" — Python 3.11.14, opencv-contrib-python 4.10.0.84,
                     PyAV 17.0.0, numpy 2.2.6, matplotlib
ffmpeg             — C:\Users\a\anaconda3\envs\ros_env\Library\bin\ffmpeg.exe
```

⚠️ **시간 수치는 이 기계 값이다.** 글에서도 배율만 인용한다. 예외는
`measure_encoder.py` 의 **삼킨 프레임 수** — 프레임 수라서 기계에 독립이다.

## 실행

파이썬은 절대 경로로 부른다. `python` 을 그냥 부르면 base 환경이고 거기엔 cv2 도
PyAV 도 없다.

```powershell
$PY = "C:\Users\a\anaconda3\envs\camera\python.exe"

& $PY tools/camera-latency/measure_encoder.py    # 수 초
& $PY tools/camera-latency/measure_buffer.py     # 약 70 초
& $PY tools/camera-latency/measure_arrival.py    # 약 45 초
& $PY tools/camera-latency/compute_jitter.py     # 즉시 (arrival.json 필요)
& $PY tools/camera-latency/make_figures.py       # 즉시 (위 셋 필요)
```

## 주의

- **`measure_buffer.py` 와 `measure_arrival.py` 는 UDP 23000 포트를 쓴다.** 이전 실행의
  ffmpeg 가 남아 있으면 결과가 오염된다. 두 스크립트를 동시에 돌리지 말 것.
- **h264 디코더가 `non-existing PPS 0 referenced` 를 수백 줄 뱉는다.** UDP 스트림에 GOP
  중간부터 붙어서 나는 것이고 다음 키프레임에서 복구된다. 측정값에 영향 없다.
  `OPENCV_FFMPEG_LOGLEVEL=-8` 은 이 빌드에서 먹지 않았다 — 안 되는 회피법을 코드에
  남기지 않으려고 끄지 않았다.
- **`measure_arrival.py` 의 `keeps_up` 이 거짓이면 그 실행은 무효다.** 소비가 밀렸다는
  뜻이고, 그러면 재는 것이 지터가 아니라 백로그다. `compute_jitter.py` 가 이걸 확인하고
  거짓이면 멈춘다.
- **`results/jitter.json` 의 곡선은 시뮬레이션이다.** 도착 시각은 실측이지만 버퍼 크기별
  유실률은 계산이고, JSON 에 `is_simulation: true` 가 박혀 있다.

## 스크립트가 스스로 확인하는 것

표를 눈으로 보고 규칙을 짐작하면 세 점에 맞는 식을 다섯 점의 규칙이라고 쓰게 된다.
그래서 두 스크립트가 자기 결론을 직접 검증하고 결과를 JSON 에 남긴다.

- `measure_encoder.py` → `rules_hold` — 세 식(`min(gop, rc-lookahead)` · `bf` ·
  `threads`)이 **모든 조건**에서 성립하는지
- `measure_buffer.py` → `lag_growth.agrees_within_5pct` — 서로 독립인 두 방법
  (스트림 타임스탬프 대 벽시계, 프레임 결손 × 프레임 주기)이 일치하는지

## 실제 IP 카메라 측정 (`measure_camera.py`)

Hanwha Vision Wisenet **XNO-L6020R**, 펌웨어 2.10.02. 글의 실측 3 을 만든다.

**읽기 전용이다.** 프로파일·GOP·비트레이트를 바꾸지 않는다. Profile 2 가 H.264
GOP 60, Profile 1 이 MJPEG 이라 설정을 안 바꾸고도 두 코덱을 대조할 수 있었다.

```powershell
$env:CAMPW  = "<카메라 비밀번호>"     # 코드에도 JSON 에도 남기지 않는다
$env:CAMHOST = "192.168.50.27"        # 기본값
& $PY tools/camera-latency/measure_camera.py        # 약 6 분 (반복 포함)
```

⚠️ **한 번만 재면 틀린다.** UDP 도착 편차는 초반 세 번의 실행에서 500\~1900 ms 가
나왔다가 이후 12 회에서 한 번도 재현되지 않았다. 그래서 이 스크립트는 기본 설정
TCP/UDP 를 **5 회씩** 반복하고 최대/최소 비를 `repeatability[].reproducible` 로
기록한다. 그 값이 거짓이면 숫자를 글에 쓰면 안 된다.

⚠️ `max_delay` 를 임의로 걸지 말 것. 걸면 도착 편차가 그 값까지 커져서, 네트워크가
아니라 자기 버퍼 설정을 재게 된다. 본 비교는 전부 ffmpeg 기본값이다.
