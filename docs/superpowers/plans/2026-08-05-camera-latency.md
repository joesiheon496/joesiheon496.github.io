# 카메라 딜레이 글 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카메라 지연을 아홉 단계 예산으로 쪼개고, **그중 세 구간**(인코딩·지터버퍼·수신 버퍼)을 이 기계에서 직접 재서 `content/posts/camera-latency/index.md` 글로 낸다. 나머지 여섯 칸은 문헌 인용이고, 그 사실을 숨기지 않는 것이 이 글의 조건이다.

**Architecture:** 측정이 먼저다. `tools/camera-latency/` 의 독립 스크립트들이 각각 JSON 을 뱉고, 그 JSON 만이 글과 그림의 입력이 된다. 스크립트 → JSON → 그림 → 글의 단방향 흐름이라 숫자의 출처가 한 곳으로 고정된다. 측정이 스펙의 가설을 반증하면 Task 5 에서 축을 교체하고, 그 뒤에 글을 쓴다.

> 🚫 **2026-08-05 — 카메라(D455)를 쓰지 않기로 했다.** 원래 Task 1 이던 센서→호스트 실측이
> 취소되고 스펙 §2-E(재지 않은 것)로 내려갔다. 그 결과 축의 뒷문장("카메라·회선이 아니라
> 가장 크다")을 **쓸 수 없게 됐다** — 재지 않은 것과 비교할 수 없기 때문이다. 스펙 §1 에
> 대체 축을 적었고, Task 4 의 지터 분포 입력도 센서에서 파이프라인 실측으로 바꿨다.

**Tech Stack:** Python (conda env `camera`: PyAV 17.0.0, opencv-contrib-python 4.10.0.84, numpy 2.2.6, matplotlib 3.10.8) · ffmpeg (`ros_env`) · Hugo + PaperMod. **카메라는 쓰지 않는다** — 스펙 §2-A 취소.

## Global Constraints

스펙 `docs/superpowers/specs/2026-08-05-camera-latency-design.md` 의 프로젝트 전역 요구사항이다. **모든 태스크의 요구사항에 이것이 암묵적으로 포함된다.**

- **파이썬 인터프리터는 항상 `C:\Users\a\anaconda3\envs\camera\python.exe`** 다. `python` 을 그냥 호출하면 base 환경이고 거기에는 cv2 도 PyAV 도 없다.
- **ffmpeg 은 `C:\Users\a\anaconda3\envs\ros_env\Library\bin\ffmpeg.exe`** 다. PATH 에 없다.
- **절대 ms 를 본문 주장으로 쓰지 않는다.** 배율과 프레임 수만 쓴다. 표에는 절대값을 실어도 되지만 환경 블록을 함께 둔다.
- **실측과 문헌 인용을 구분 표기한다.** 표에서는 열을 나누고, 그림에서는 색을 나누고 범례에 적는다.
- **측정하지 못한 것은 "재지 않았다" 로 명시한다.** "안 나왔다" 가 아니라 "이 방법으로는 볼 수 없다" 로 쓴다.
- **Hugo 표기 규약:** 물결표는 `\~`, 인라인 수식은 `\(...\)`, 블록 수식은 `\[...\]`, 이미지는 `{{< img src="..." alt="..." caption="..." >}}`, 다른 글 링크는 `{{< ref "/posts/network-traffic-check" >}}`.
- **front matter:** `categories = ["기타"]`, `draft = false`, `math = true`, `tags` 에 `["카메라", "지연", "latency", "OpenCV", "FFmpeg", "H.264"]`. RealSense 는 쓰지 않았으므로 태그에 넣지 않는다.
- **모든 난수는 시드 고정.** `numpy.random.default_rng(20260805)`.
- **모든 스크립트는 JSON 을 `tools/camera-latency/results/` 에 쓴다.** 글과 그림은 이 JSON 만 읽는다.
- **UB·구현 세부는 규칙처럼 쓰지 않는다.** OpenCV 버전·백엔드 이름, x264 기본값은 관측한 버전을 붙인다.
- 🚫 **수학 시리즈 머리 배너를 쓰지 않는다.** `> 🎛 **직접 만지는 데모가 두 개** 있습니다. 슬라이더를 움직여보세요.` 와 `컴퓨터 비전 수학 시리즈 N 번째 글입니다` 는 **시리즈 글에만** 쓴다 (1\~9편 전부가 쓰고 있다). 이 글은 시리즈 밖이고 데모가 없다. 대신 트래픽 글과 같은 `> 🔧 실행 환경:` 블록쿼트를 쓴다 (Task 7 Step 1). 시리즈 번호도 붙이지 않는다.
- 브랜치는 `post-camera-latency`. 커밋은 태스크마다 하나 이상.

---

### Task 1: 측정 하네스 ✅ 완료

> 🚫 **원래 이 태스크는 D455 센서→호스트 지연 실측(스펙 §2-A)이었다. 2026-08-05 취소됐다** —
> 사용자가 카메라를 연결하지 않기로 했다. `measure_sensor.py` 와 `results/sensor.json` 은
> 만들지 않는다. 센서 구간은 스펙 §2-E(재지 않은 것)로 내려갔고, §1 의 축도 그에 맞춰
> 좁혀졌다. 남은 것은 하네스뿐이고, 그건 이미 끝났다(`c743e02`).

**Files:**
- Create: `tools/camera-latency/common.py` ✅
- Create: `tools/camera-latency/results/.gitkeep` ✅

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `common.py`
  - `write_result(name: str, payload: dict) -> Path` — `results/<name>.json` 에
    `{"env": {...}, "data": payload}` 를 UTF-8 로 쓰고 경로를 돌려준다
  - `env_block() -> dict` — 플랫폼·패키지 버전. `__version__` 이 없는 패키지는
    배포 메타데이터로 내려간다 (pyrealsense2 가 그렇다)
  - `percentile(xs, q: float) -> float` — 최근접 순위. 실측에 없는 값이 표에 찍히지
    않도록 보간하지 않는다

- [x] **Step 1: 하네스를 쓴다 (`common.py`)** — 완료
- [x] **Step 2: 하네스가 도는지 확인한다** — 완료

```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe -c "import sys; sys.path.insert(0, 'tools/camera-latency'); import common; print(common.env_block()); print(common.percentile([1,2,3,4,5,6,7,8,9,10], 0.99))"
```

10 개 표본의 P99 는 최근접 순위로 최댓값(`10.0`)이다.

⚠️ 이 검증에서 실제로 버그가 하나 잡혔다. 첫 판 `env_block()` 은 `module.__version__`
만 읽어서, **설치돼 있고 import 도 되는 pyrealsense2 를 "unavailable" 로 기록**했다.
모든 인용 숫자가 딸려 있는 환경 블록이 조용히 틀린 것이라 배포 메타데이터 폴백을
넣었다. 이 글이 다루는 실패 양식 그대로다.

- [x] **Step 3: 커밋** — `c743e02`

---

### Task 2: 인코더 구조적 지연 (스펙 §2-B) ✅ 완료 — `2771a55`

이 글에서 **가장 인용 가치가 높은 값**을 만드는 태스크다. 삼킨 프레임 수는 기계에 독립이라 절대 시간 규칙(Global Constraints)의 예외다.

> 🚨 **아래 조건 목록과 반증 논리는 실행해보니 무효였다. 실제 스크립트는 다르다** —
> `tools/camera-latency/measure_encoder.py` 를 보라. 아래를 고쳐 쓰지 않고 남겨두는 것은
> 무엇이 왜 틀렸는지가 이 계획의 기록이기 때문이다.
>
> 아래 목록에는 **`bf=0` 을 기본 lookahead 로 둔 대조군이 없다.** 그래서 `bf=3` 이 31 장을
> 삼킨 것을 "B프레임이 구조적 지연" 으로 읽었는데, `bf=0` 도 31 장이고 `bf=16` 도 31 장이었다.
> 세 원인(lookahead · B프레임 · 프레임 스레딩)이 분리되지 않아 반증 조건이 아무것도
> 증명하지 못했다.
>
> 실제 스크립트는 각 원인마다 '그것만 끈' 짝을 넣어 12 조건으로 재고, 관측한 세 규칙이
> 모든 조건에서 성립하는지 **스크립트가 직접 확인**한다(`rules_hold`). 결과는 스펙 §2-B 에
> 적었다 — 지배 원인은 lookahead(30 프레임)이고 B프레임(3)의 10배다.

**Files:**
- Create: `tools/camera-latency/measure_encoder.py`
- Create: `tools/camera-latency/results/encoder.json`

**Interfaces:**
- Consumes: `common.write_result`, `common.percentile` (Task 1)
- Produces: `results/encoder.json` 의 `data` 스키마: `{"codec": str, "runs": [{"label": str, "options": {str: str}, "swallowed_frames": int, "encode_ms": {"median": float, "p99": float}, "flush_packets": int}], "refutation_2b": {"passed": bool, "note": str}, "threading_vs_bframes": {"bframes_only": int, "threads_only": int, "larger": str}}`

- [ ] **Step 1: libx264 가 있는지 확인한다**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe -c "import av; print([c for c in av.codecs_available if '264' in c])"
```
Expected: `libx264` 가 목록에 있다.

없으면 `libopenh264` 를 쓰되 **`bf` 옵션이 없으므로 B프레임 항목을 잴 수 없다.** 그 경우 이 태스크를 멈추고 사용자에게 알린다 — 스펙 §1 의 축이 걸린 측정이라 대체할 수 없다.

- [ ] **Step 2: 측정 스크립트를 쓴다 (`measure_encoder.py`)**

```python
"""스펙 §2-B — 인코더가 첫 패킷을 내놓기까지 프레임을 몇 장 삼키는가.

이 '삼킨 프레임 수' 가 구조적(불가피한) 지연이다. 프레임 수라서 기계에
독립이고, 그래서 이 글에서 유일하게 절대값으로 인용할 수 있는 지연이다.
"""
import sys
import time
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import av
import numpy as np
from common import percentile, write_result

W, H, FPS, N = 640, 480, 30, 120
CODEC = "libx264"
CONDITIONS = [
    ("zerolatency, bf=0, threads=1", {"tune": "zerolatency", "bf": "0", "g": "30", "threads": "1"}),
    ("기본값 (bf=3), threads=1",      {"bf": "3", "g": "30", "threads": "1"}),
    ("bf=16, threads=1",              {"bf": "16", "g": "30", "threads": "1"}),
    ("bf=0, threads=auto",            {"bf": "0", "g": "30", "threads": "0"}),
    ("bf=3, threads=auto",            {"bf": "3", "g": "30", "threads": "0"}),
    ("bf=0, g=250, threads=1",        {"bf": "0", "g": "250", "threads": "1"}),
    ("bf=0, g=15, threads=1",         {"bf": "0", "g": "15", "threads": "1"}),
    ("zerolatency, threads=auto",     {"tune": "zerolatency", "g": "30", "threads": "0"}),
]


def frames(n):
    """움직이는 내용. 정지 화면은 인코더가 스킵해버려 측정이 왜곡된다."""
    rng = np.random.default_rng(20260805)
    base = rng.integers(0, 256, (H, W, 3), dtype=np.uint8)
    for i in range(n):
        arr = np.roll(base, i * 7, axis=1)            # 결정적인 팬
        f = av.VideoFrame.from_ndarray(arr, format="rgb24")
        f.pts = i
        f.time_base = Fraction(1, FPS)
        yield f


def run_one(label, options):
    enc = av.CodecContext.create(CODEC, "w")
    enc.width, enc.height = W, H
    enc.pix_fmt = "yuv420p"
    enc.time_base = Fraction(1, FPS)
    enc.options = dict(options)

    swallowed, times = None, []
    for i, frame in enumerate(frames(N)):
        t0 = time.perf_counter()
        pkts = enc.encode(frame)
        times.append((time.perf_counter() - t0) * 1000.0)
        if pkts and swallowed is None:
            swallowed = i                              # 앞의 i 장이 삼켜졌다
    flush = len(enc.encode(None))                      # 남은 것을 밀어낸다
    return {
        "label": label, "options": dict(options),
        "swallowed_frames": swallowed if swallowed is not None else N,
        "encode_ms": {"median": float(np.median(times)),
                      "p99": percentile(times, 0.99)},
        "flush_packets": flush,
    }


def main():
    runs = [run_one(label, opts) for label, opts in CONDITIONS]
    by = {r["label"]: r["swallowed_frames"] for r in runs}

    bf_only = by["기본값 (bf=3), threads=1"]
    th_only = by["bf=0, threads=auto"]
    passed = bf_only > 0
    note = (f"bf=3/threads=1 이 삼킨 프레임 {bf_only} 장 -> "
            f"{'통과: B프레임은 구조적 지연이다' if passed else '반증: bf=3 이 0 프레임을 삼켰다. B프레임=구조적 지연 서술을 버려야 한다'}")
    larger = ("threads" if th_only > bf_only
              else "bframes" if bf_only > th_only else "tie")

    path = write_result("encoder", {
        "codec": CODEC, "runs": runs,
        "refutation_2b": {"passed": passed, "note": note},
        "threading_vs_bframes": {"bframes_only": bf_only,
                                 "threads_only": th_only, "larger": larger},
    })
    print(note)
    print(f"B프레임만: {bf_only} 장 · 스레딩만: {th_only} 장 -> 큰 쪽: {larger}")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: 측정을 돌린다**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe tools/camera-latency/measure_encoder.py
```
Expected: 반증 조건 한 줄, `B프레임만: N 장 · 스레딩만: M 장 -> 큰 쪽: ...`, `wrote ...`.

- [ ] **Step 4: 결과를 읽고 축에 미치는 영향을 판단한다**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe -c "import json; d=json.load(open('tools/camera-latency/results/encoder.json',encoding='utf-8'))['data']; print(d['refutation_2b']); print(d['threading_vs_bframes']); [print(r['swallowed_frames'], r['label']) for r in d['runs']]"
```
Expected: 8 줄. `zerolatency, bf=0, threads=1` 이 `0` 이어야 한다 — **아니면 스크립트가 틀렸거나 측정이 오염됐으니 먼저 그것을 고친다.**

`threading_vs_bframes.larger` 가 `threads` 로 나오면 스펙 §2-B 가 예고한 대로 **글의 강조점이 스레딩으로 옮겨간다.** Task 5 에 기록한다.

- [ ] **Step 5: 커밋**

```bash
git add tools/camera-latency/measure_encoder.py tools/camera-latency/results/encoder.json
git commit -m "feat(camera-latency): count the frames an encoder swallows before its first packet"
```

---

### Task 3: 수신측 버퍼 누적 (스펙 §2-C) ✅ 완료 — `756dc8b`

> 실제 스크립트가 계획과 다른 점 둘. (1) `drawtext` burn-in 을 뺐다 — 읽으려면 OCR 이
> 필요한데 드레인 판정은 OCR 없이 된다. (2) 1 초 간격 **시계열**을 남기도록 늘렸다 —
> Task 6 의 `buffer-growth.png` 가 시계열을 필요로 하는데 두 단계 판정만으로는 그릴
> 데이터가 없었다. 그 덕에 `CAP_PROP_POS_MSEC` 기반 지연과 프레임 결손 기반 예측을
> 서로 맞춰보는 검증이 생겼다. 결과는 스펙 §2-C 에 적었다.

**Files:**
- Create: `tools/camera-latency/measure_buffer.py`
- Create: `tools/camera-latency/results/buffer.json`

**Interfaces:**
- Consumes: `common.write_result` (Task 1)
- Produces: `results/buffer.json` 의 `data` 스키마: `{"backend": str, "sender_cmd": [str], "phases": {"slow": {"seconds": float, "frames_read": int, "expected_frames": int}, "drain": {"seconds": float, "frames_read": int}}, "buffersize_settable": bool, "grab_helps": {"tested": bool, "frames_read": int, "verdict": str}, "pts_lag_ms": {"start": float, "end": float}|null, "refutation_2c": {"passed": bool, "note": str}}`

**측정 원리** — 30 fps 스트림을 20 fps 로 소비한다(`read()` 사이에 50 ms 쉼). 30 초 뒤 소비를 최대 속도로 바꾸고 **200 ms 안에 몇 프레임이 쏟아지는지** 센다. 백로그가 쏟아지면 버퍼가 쌓였던 것이고 = 지연이 자랐다. 0 에 가까우면 프레임이 버려졌던 것이다. OCR 도 시계 동기도 필요 없는 판정이다.

- [ ] **Step 1: ffmpeg 이 lavfi 와 mpegts 출력을 하는지 확인한다**

Run:
```powershell
& "C:\Users\a\anaconda3\envs\ros_env\Library\bin\ffmpeg.exe" -hide_banner -f lavfi -i testsrc=size=320x240:rate=30 -t 1 -c:v libx264 -f mpegts -y NUL
```
Expected: 오류 없이 끝난다. `Unknown input format: 'lavfi'` 나 `Unknown encoder 'libx264'` 가 나오면 여기서 멈추고 사용자에게 알린다.

- [ ] **Step 2: 측정 스크립트를 쓴다 (`measure_buffer.py`)**

```python
"""스펙 §2-C — 늦게 읽으면 지연이 자라는가, 프레임이 버려지는가.

30fps 를 localhost UDP 로 보내고 20fps 로 소비한 뒤, 소비를 최대 속도로
바꿔 200ms 안에 쏟아지는 프레임을 센다. 쏟아지면 버퍼가 쌓였던 것이고,
0 이면 버려졌던 것이다. 시계 동기가 필요 없는 판정이다.
"""
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import cv2
from common import write_result

FFMPEG = r"C:\Users\a\anaconda3\envs\ros_env\Library\bin\ffmpeg.exe"
URL = "udp://127.0.0.1:23000"
FPS, SLOW_SECONDS, SLEEP, DRAIN_SECONDS = 30, 30.0, 0.05, 0.2
SENDER = [FFMPEG, "-hide_banner", "-loglevel", "error", "-re",
          "-f", "lavfi", "-i", f"testsrc=size=640x480:rate={FPS}",
          "-c:v", "libx264", "-tune", "zerolatency", "-g", "30",
          "-f", "mpegts", URL]


def open_capture():
    cap = cv2.VideoCapture(f"{URL}?overrun_nonfatal=1&fifo_size=1000000",
                           cv2.CAP_FFMPEG)
    for _ in range(200):                               # 첫 프레임까지 기다린다
        if cap.isOpened() and cap.read()[0]:
            return cap
        time.sleep(0.05)
    raise RuntimeError("수신 스트림을 열지 못했다")


def consume(cap, seconds, sleep_s):
    t0, n = time.perf_counter(), 0
    while time.perf_counter() - t0 < seconds:
        if cap.read()[0]:
            n += 1
        if sleep_s:
            time.sleep(sleep_s)
    return n, time.perf_counter() - t0


def main():
    sender = subprocess.Popen(SENDER)
    try:
        time.sleep(2.0)                                # 송출이 안정될 때까지
        cap = open_capture()
        backend = cap.getBackendName()
        settable = bool(cap.set(cv2.CAP_PROP_BUFFERSIZE, 1))

        slow_n, slow_s = consume(cap, SLOW_SECONDS, SLEEP)
        drain_n, drain_s = consume(cap, DRAIN_SECONDS, 0.0)
        cap.release()

        # grab() 으로 비우는 널리 퍼진 회피법이 이 백엔드에서 실제로 먹는지.
        cap2 = open_capture()
        t0, grab_n = time.perf_counter(), 0
        while time.perf_counter() - t0 < SLOW_SECONDS:
            for _ in range(3):
                cap2.grab()
            if cap2.retrieve()[0]:
                grab_n += 1
            time.sleep(SLEEP)
        g_drain, _ = consume(cap2, DRAIN_SECONDS, 0.0)
        cap2.release()
    finally:
        sender.terminate()
        sender.wait(timeout=10)

    expected = int(SLOW_SECONDS * FPS)
    # 정상 소비율은 20fps -> 30초에 약 600 장. 백로그가 쌓였다면 드레인에서 쏟아진다.
    accumulated = drain_n > FPS * DRAIN_SECONDS * 2
    note = (f"느린 소비 {slow_s:.1f}s 동안 {slow_n} 장 읽음 (송출 약 {expected} 장), "
            f"드레인 {drain_s * 1000:.0f}ms 에 {drain_n} 장 쏟아짐 -> "
            f"{'통과: 버퍼가 쌓였다 = 지연이 자란다' if accumulated else '반증: 백로그가 없다. 이 백엔드는 프레임을 버린다'}")
    verdict = ("효과 있음" if g_drain < drain_n else "효과 없음 — 이 백엔드에서는 통설이 틀리다")

    path = write_result("buffer", {
        "backend": backend, "sender_cmd": SENDER,
        "phases": {"slow": {"seconds": slow_s, "frames_read": slow_n,
                            "expected_frames": expected},
                   "drain": {"seconds": drain_s, "frames_read": drain_n}},
        "buffersize_settable": settable,
        "grab_helps": {"tested": True, "frames_read": grab_n,
                       "drain_frames": g_drain, "verdict": verdict},
        "pts_lag_ms": None,
        "refutation_2c": {"passed": accumulated, "note": note},
    })
    print(note)
    print(f"grab() 회피법: {verdict}")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: 측정을 돌린다 (약 70 초)**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe tools/camera-latency/measure_buffer.py
```
Expected: 판정 문장 두 줄과 `wrote ...`. `backend` 가 `FFMPEG` 로 찍혀야 한다.

- [ ] **Step 4: 결과를 확인한다**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe -c "import json; d=json.load(open('tools/camera-latency/results/buffer.json',encoding='utf-8'))['data']; print(d['backend'], d['buffersize_settable']); print(d['phases']); print(d['grab_helps']); print(d['refutation_2c'])"
```
Expected: `phases.slow.frames_read` 가 600 근처(20 fps × 30 s). **`expected_frames`(900)에 가까우면 소비가 느려지지 않은 것이므로 `SLEEP` 을 키워 다시 잰다.**

`refutation_2c.passed` 가 `false` 여도 실패가 아니다 — 그 경우 글에 **"이 백엔드는 버리고, 따라서 널리 퍼진 이 조언은 백엔드 의존이다"** 로 쓴다. 일반화하지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add tools/camera-latency/measure_buffer.py tools/camera-latency/results/buffer.json
git commit -m "feat(camera-latency): decide whether a slow reader grows latency or drops frames"
```

---

### Task 4: 지터버퍼 트레이드오프 (스펙 §2-D)

> 🔁 **입력이 바뀌었다.** 원안은 `sensor.json` 의 프레임 간격 통계(중앙값·표준편차·P99)에서
> 표본을 **합성**해 쓰려 했다. 2-A 취소로 그 파일이 없어졌고, 대신 2-C 의 송수신 경로에서
> **실제 도착 시각을 찍어** 쓴다. 합성이 사라졌으므로 이쪽이 더 낫다 — 세 통계량만 맞춘
> 가짜 표본 대신 실제 분포다.
>
> ⚠️ 다만 이 지터는 **인코더·UDP·디코더**의 것이고 **카메라의 것이 아니다.** 글에서
> "이 파이프라인의 지터에서는" 으로 한정한다.

**Files:**
- Create: `tools/camera-latency/measure_arrival.py`
- Create: `tools/camera-latency/results/arrival.json`
- Create: `tools/camera-latency/compute_jitter.py`
- Create: `tools/camera-latency/results/jitter.json`

**Interfaces:**
- Consumes: `common.write_result`, `common.percentile` (Task 1). ffmpeg 송출 명령은 Task 3 의 `SENDER` 와 같다
- Produces:
  - `results/arrival.json` 의 `data`: `{"fps": int, "nominal_interval_ms": float, "backend": str, "warmup_dropped": int, "n": int, "arrival_ms": [float], "interval_ms": {"median": float, "std": float, "p99": float}, "consume_fps": float}`
  - `results/jitter.json` 의 `data`: `{"source": str, "nominal_interval_ms": float, "n_samples": int, "curve": [{"buffer_ms": float, "added_latency_ms": float, "loss_rate": float}], "min_buffer_for_0p1pct_ms": float|null, "is_simulation": true}`

⚠️ 곡선은 **실측 분포 + 계산**이다. JSON 에 `is_simulation: true` 가 박혀 있고 글에도
"시뮬레이션" 이라고 쓴다 (Global Constraints).

- [ ] **Step 1: 도착 시각을 찍는다 (`measure_arrival.py`)**

```python
"""스펙 §2-D 의 입력 — 이 파이프라인의 프레임 도착 지터.

2-A(카메라 센서)가 취소되어 지터 분포의 출처가 여기로 바뀌었다. Task 3 과 같은
ffmpeg -> UDP -> OpenCV 경로를 쓰되, 소비를 늦추지 않고 최대 속도로 받으며
도착 시각만 찍는다. 늦게 읽으면 버퍼가 쌓여(2-C) 지터가 아니라 백로그를 재게 된다.

송신과 수신이 같은 기계·같은 시계라 드리프트 보정이 필요 없다.
"""
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import cv2
import numpy as np
from common import percentile, write_result
from measure_buffer import FFMPEG, FPS, SENDER, URL, open_capture

SECONDS, WARMUP = 30.0, 30


def main():
    sender = subprocess.Popen(SENDER)
    try:
        time.sleep(2.0)
        cap = open_capture()
        backend = cap.getBackendName()
        stamps = []
        t0 = time.perf_counter()
        while time.perf_counter() - t0 < SECONDS:
            if cap.read()[0]:
                stamps.append((time.perf_counter() - t0) * 1000.0)
        cap.release()
    finally:
        sender.terminate()
        sender.wait(timeout=10)

    stamps = stamps[WARMUP:]                    # 스트림에 붙는 동안의 과도상태를 버린다
    intervals = np.diff(stamps)
    span_s = (stamps[-1] - stamps[0]) / 1000.0
    path = write_result("arrival", {
        "fps": FPS, "nominal_interval_ms": 1000.0 / FPS, "backend": backend,
        "warmup_dropped": WARMUP, "n": len(stamps),
        "arrival_ms": [round(s, 4) for s in stamps],
        "interval_ms": {"median": float(np.median(intervals)),
                        "std": float(np.std(intervals)),
                        "p99": percentile(intervals, 0.99)},
        "consume_fps": (len(stamps) - 1) / span_s,
    })
    print(f"{len(stamps)} 프레임, 소비 {(len(stamps)-1)/span_s:.2f} fps, "
          f"간격 중앙값 {np.median(intervals):.2f} ms · P99 {percentile(intervals, 0.99):.2f} ms")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 돌리고 소비가 안 밀렸는지 확인한다**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe tools/camera-latency/measure_arrival.py
```

Expected: `consume_fps` 가 30 에 가깝고 `interval_ms.median` 이 33.3 ms 근처.

🚨 **`consume_fps` 가 30 보다 뚜렷이 낮으면 이 측정은 무효다.** 소비가 밀렸다는 뜻이고,
그러면 재는 것이 지터가 아니라 2-C 의 백로그다. 그 경우 해상도를 낮추거나 디코드를
가볍게 해서 다시 잰다.

- [ ] **Step 3: 곡선을 계산한다 (`compute_jitter.py`)**

```python
"""스펙 §2-D — 지터버퍼 크기 b 대 (추가 지연, 유실률).

입력은 measure_arrival.py 가 찍은 실제 도착 시각이다. 버퍼 b 를 두면 재생 시각이
b 만큼 뒤로 밀리고, 이상적 등간격보다 b 이상 늦게 온 프레임은 버려진다.
실측 분포 + 계산이므로 is_simulation 을 박아둔다.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import numpy as np
from common import write_result

HERE = Path(__file__).parent


def main():
    d = json.loads((HERE / "results" / "arrival.json").read_text(encoding="utf-8"))["data"]
    nominal = d["nominal_interval_ms"]
    arrivals = np.array(d["arrival_ms"])
    # 이상적 등간격 대비 편차. 가장 이른 도착을 0 으로 맞춘다.
    ideal = arrivals[0] + np.arange(len(arrivals)) * nominal
    offsets = arrivals - ideal
    offsets = offsets - offsets.min()

    curve = []
    for b in np.arange(0.0, 6.0 * nominal + 1e-9, nominal / 4.0):
        curve.append({"buffer_ms": float(b), "added_latency_ms": float(b),
                      "loss_rate": float(np.mean(offsets > b))})
    ok = [c for c in curve if c["loss_rate"] <= 0.001]
    path = write_result("jitter", {
        "source": "results/arrival.json 의 실측 도착 시각 + 계산",
        "nominal_interval_ms": nominal, "n_samples": int(len(arrivals)),
        "curve": curve,
        "min_buffer_for_0p1pct_ms": ok[0]["buffer_ms"] if ok else None,
        "is_simulation": True,
    })
    if ok:
        print(f"유실 0.1% 를 만족하는 최소 버퍼: {ok[0]['buffer_ms']:.1f} ms "
              f"({ok[0]['buffer_ms'] / nominal:.2f} 프레임)")
    else:
        print("0.1% 를 만족하는 버퍼가 범위(6 프레임) 안에 없다 — 범위를 넓혀 다시 계산한다")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 곡선이 단조인지 확인한다**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe tools/camera-latency/compute_jitter.py
& C:\Users\a\anaconda3\envs\camera\python.exe -c "import json; c=json.load(open('tools/camera-latency/results/jitter.json',encoding='utf-8'))['data']['curve']; ls=[x['loss_rate'] for x in c]; print('monotone:', all(a>=b for a,b in zip(ls,ls[1:]))); print(ls[:6], ls[-3:])"
```

Expected: `monotone: True`. 버퍼를 키우면 유실률이 줄어야 한다 — 아니면 계산이 틀렸다.

- [ ] **Step 5: 커밋**

```bash
git add tools/camera-latency/measure_arrival.py tools/camera-latency/compute_jitter.py \
        tools/camera-latency/results/arrival.json tools/camera-latency/results/jitter.json
git commit -m "feat(camera-latency): the jitter-buffer curve, from real arrival times"
```

---

### Task 5: 🚨 축 확정 게이트 — 측정 결과를 스펙에 되적는다

**측정 전에 스펙을 썼으므로 이 게이트가 이 계획의 핵심이다.** 7편·8편·cpp-for-vision 에서 승인받은 축이 세 번 연속 무너졌다. 글을 쓰기 전에 반드시 통과한다.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-camera-latency-design.md` (§0 에 결과 절 추가, §1 의 축 확정, 제목·그림 선택)

**Interfaces:**
- Consumes: `results/encoder.json`, `results/buffer.json`, `results/arrival.json`, `results/jitter.json`
- Produces: 확정된 축 한 문장과 제목 하나. Task 7 이 이것을 그대로 쓴다.

> 🔁 **2-A 취소로 이 게이트의 일부가 이미 처리됐다.** 축의 뒷문장("카메라·회선이 아니라")은
> 측정이 아니라 **범위 축소**로 죽었다 — 카메라를 재지 않으면 "카메라보다 크다" 를 말할 수
> 없다. 스펙 §1 에 취소선과 대체 축을 적어뒀고, §2-B·§2-C 에도 결과를 적었다.
> 남은 일은 **대체 축이 실측 셋과 맞는지 확인하고 제목·그림을 고르는 것**이다.

- [ ] **Step 1: 두 반증 조건의 결과를 한자리에 모은다**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe -c "import json,glob; [print(f, json.load(open(f,encoding='utf-8'))['data'].get('refutation_2b') or json.load(open(f,encoding='utf-8'))['data'].get('refutation_2c') or 'n/a') for f in sorted(glob.glob('tools/camera-latency/results/*.json'))]"
```
Expected: 4 줄. `arrival.json` 과 `jitter.json` 은 `n/a`(반증 조건이 없는 측정·계산이다).

- [ ] **Step 2: 대체 축이 실측과 맞는지 확인한다**

스펙 §1 의 대체 축은 **"지연 예산의 각 항목은 파라미터에서 예측할 수 있고, 프레임률과 무관하다"** 다. 판정 규칙:

| 조건 | 결론 |
|---|---|
| `encoder.rules_hold` 가 전부 참 **그리고** `buffer.lag_growth.agrees_within_5pct` 가 참 | 축 확정. 두 예측식이 실측과 맞았다는 것이 축 그 자체다 |
| `encoder.rules_hold` 중 하나라도 거짓 | 그 규칙을 **식이 아니라 관측치로** 내려 쓴다. "예측할 수 있다" 를 "인코더는 예측되고 버퍼는" 으로 좁힌다 |
| `buffer.lag_growth.agrees_within_5pct` 가 거짓 | 버퍼 쪽 예측식을 버리고 실측 곡선만 쓴다. 축을 "인코더는 계산되고, 버퍼는 재야 한다" 로 바꾼다 |
| 둘 다 거짓 | 🚨 축이 무너졌다. 부제 축(**지연 ≠ 1/fps**)을 주 축으로 승격한다 |
| `arrival.consume_fps` 가 `fps` 보다 뚜렷이 낮음 | 🚨 2-D 무효 — 지터가 아니라 백로그를 잰 것이다. Task 4 Step 2 로 돌아간다 |

- [ ] **Step 3: 스펙을 마저 고친다**

`docs/superpowers/specs/2026-08-05-camera-latency-design.md` 에:

1. §0 **앞에** `## 0. 측정 결과 — 가설은 어떻게 됐나` 절을 넣는다. 8편 스펙 §0 과 같은 형식이다. **이번에는 축이 측정이 아니라 범위 축소로 바뀌었다는 점**을 분명히 적는다 — 측정이 반박한 것과 못 재서 못 쓰게 된 것은 다르고, 그 구분이 이 글의 규율이다.
2. §1 의 "가설 — 측정으로 확정한다" 를 **"확정"** 으로 바꾼다.
3. §1 의 남은 제목 후보 둘 중 하나를 고르고 나머지에 `~~취소선~~`.
4. §2-D 에 `**결과:**` 를 적는다 (2-B·2-C 는 이미 적혀 있다).
5. §5 의 그림 4 후보에서 **셋을 고르고** 근거를 한 줄 적는다.

- [ ] **Step 4: 스펙에 미결이 남지 않았는지 확인한다**

Run:
```powershell
Select-String -Path docs/superpowers/specs/2026-08-05-camera-latency-design.md -Pattern "측정 대기|가설 —|숫자는 아직 없다|TBD|TODO"
```
Expected: **출력 없음.** 하나라도 남으면 Step 3 을 마치지 않은 것이다.

- [ ] **Step 5: 커밋**

```bash
git add docs/superpowers/specs/2026-08-05-camera-latency-design.md
git commit -m "spec: record what the four measurements did to the hypothesis"
```

---

### Task 6: 그림 세 장

**Files:**
- Create: `tools/camera-latency/make_figures.py`
- Create: `content/posts/camera-latency/latency-budget.png`
- Create: `content/posts/camera-latency/<Task 5 에서 고른 두 장>.png`

**Interfaces:**
- Consumes: `results/*.json` (Task 1\~4), Task 5 가 고른 그림 세 장
- Produces: `content/posts/camera-latency/` 안의 PNG 세 장. Task 7 이 `{{< img >}}` 로 참조한다.

- [ ] **Step 1: 그림 스크립트를 쓴다 (`make_figures.py`)**

세 함수 `fig_budget()`, `fig_encoder()`, `fig_buffer()`, `fig_jitter()` 를 정의하고 `main()` 에서 커버 + Task 5 가 고른 둘만 호출한다. 공통 규약:

```python
"""results/*.json 만 읽어서 글의 그림을 만든다. 숫자를 여기에 손으로 쓰지 않는다."""
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = Path(__file__).parent
OUT = HERE.parent.parent / "content" / "posts" / "camera-latency"
MEASURED, CITED = "#2b6cb0", "#a0aec0"        # 실측 / 문헌 — 스펙 §3-6
plt.rcParams.update({"font.family": "Malgun Gothic", "axes.unicode_minus": False,
                     "figure.dpi": 130, "savefig.bbox": "tight"})


def load(name):
    return json.loads((HERE / "results" / f"{name}.json").read_text(encoding="utf-8"))["data"]
```

`fig_budget()` — 아홉 단계 수평 스택 바 한 줄. 실측 구간은 `MEASURED`, 문헌 구간은 `CITED` 로 칠하고 **범례에 "이 글에서 실측" / "문헌 인용(재지 않음)" 을 적는다.** 실측 구간의 값은 `encoder.json`(프레임 수 × `1000/fps`)·`buffer.json`·`jitter.json` 에서 읽는다. **인용 칸이 여섯, 실측 칸이 셋**이므로 그 비율이 그림에서 그대로 보이게 그린다 — 인용이 다수라는 사실을 숨기지 않는다. 문헌 구간의 값은 Task 7 의 Sources 와 **같은 출처**에서 오며, 스크립트 상단에 `CITED_MS = {"패널 응답": (값, "출처 URL"), ...}` 로 두고 주석에 출처를 적는다.

`fig_encoder()` — 조건별 삼킨 프레임 수 수평 막대. `zerolatency` 조건을 0 기준선으로 강조.
`fig_buffer()` — 느린 소비 구간과 드레인 구간의 누적 프레임 수 두 선.
`fig_jitter()` — 이중 y축: 버퍼 ms 대 추가 지연(왼쪽), 유실률 로그 스케일(오른쪽). 0.1 % 수평선과 최소 버퍼 지점 표시. **제목이나 캡션에 "시뮬레이션" 을 적는다.**

- [ ] **Step 2: 그림을 만든다**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe tools/camera-latency/make_figures.py
```
Expected: PNG 세 개 경로가 찍힌다.

- [ ] **Step 3: 눈으로 확인한다**

Read 툴로 세 PNG 를 열어 확인한다. 체크:
- 한글이 `□□□` 로 깨지지 않았나 (`Malgun Gothic` 이 없으면 폰트를 바꾼다)
- 커버의 범례에 실측/문헌 구분이 있나
- 지터 그림에 "시뮬레이션" 이 있나
- 축 라벨에 단위(ms, 프레임)가 있나

**깨진 것이 있으면 고치고 Step 2 로 돌아간다.** 스크린샷 없이 통과시키지 않는다.

- [ ] **Step 4: 커밋**

```bash
git add tools/camera-latency/make_figures.py content/posts/camera-latency/*.png
git commit -m "feat(camera-latency): three figures, drawn only from the measured JSON"
```

---

### Task 7: 글

**Files:**
- Create: `content/posts/camera-latency/index.md`

**Interfaces:**
- Consumes: Task 5 가 확정한 축·제목, `results/*.json` 의 숫자, Task 6 의 PNG 세 장
- Produces: 발행 가능한 글. Task 8 이 빌드로 검증한다.

- [ ] **Step 1: front matter 와 §"한 줄 요약" 을 쓴다**

```toml
+++
title = "<Task 5 에서 고른 제목>"
date = 2026-08-05T18:00:00+09:00
draft = false
math = true
tags = ["카메라", "지연", "latency", "OpenCV", "FFmpeg", "H.264"]
categories = ["기타"]
summary = "<축 한 문장 + 실측 범위 한 문장>"

[cover]
  image = "latency-budget.png"
  alt = "카메라 지연 예산 아홉 단계"
  caption = "<실측/문헌 구분을 언급하는 캡션>"
  relative = true
+++
```

머리에 트래픽 글과 같은 형식의 실행 환경 블록쿼트를 둔다:

```markdown
> 🔧 실행 환경: 아래 숫자 중 **실측**이라고 적은 것은 이 기계에서 직접 돌려 나온 값이고,
> 스크립트는 [`tools/camera-latency/`](https://github.com/joesiheon496/joesiheon496.github.io/tree/main/tools/camera-latency)
> 에 있다. **문헌 인용**은 출처를 달았고 이 글에서 재지 않았다.
```

- [ ] **Step 2: §"먼저: 무슨 지연을 말하는가" 를 쓴다**

네 가지를 구분하는 표(glass-to-glass / 파이프라인 지연 / 지터 / 프레임 간격) + **지연 ≠ 1/fps** 를 여기서 한 번만 깬다. `arrival.json` 의 `interval_ms.median` 이 `1000/fps` 에 가까운데 `buffer.json` 의 누적 지연은 9.6 초까지 자란다는 실측을 근거로 쓴다 — **같은 스트림에서 프레임 간격은 정상인데 지연은 9 초**라는 것이 이 문장의 가장 좋은 증거다.

- [ ] **Step 3: §"지연 예산 — 아홉 단계" 를 쓴다**

노출 → 리드아웃 → ISP → 전송 → 인코딩 → 네트워크 → 지터버퍼 → 디코딩·리오더 → 렌더.
표 열: `단계 | 크기 | 실측/인용 | 지배 요인 | 재는 법 | 줄일 수 있나`.
네트워크 행에서 `{{< ref "/posts/network-traffic-check" >}}` 로 큐잉·마이크로버스트 절을 링크한다.

- [ ] **Step 4: §"어떻게 재는가 — 네 가지 방법" 을 쓴다**

트래픽 글과 같은 비용 순서 구조. ① 밀리초 스톱워치 촬영 ② 파이프라인 타임스탬프 ③ LED + 포토다이오드 ④ RTP 타임스탬프 대 도착시각. 각 방법에 **무엇을 못 재는지**를 함께 적는다.

- [ ] **Step 5: §"실측" 네 절을 쓴다**

A(센서→호스트) · B(인코더 구조적 지연) · C(버퍼 누적) · D(지터버퍼). 규칙:
- 표의 숫자는 `results/*.json` 에서 옮긴다. 손으로 계산하지 않는다.
- B 의 **프레임 수**는 절대값으로 인용한다(기계 독립). ms 는 배율만.
- C 는 백엔드 이름과 OpenCV 버전을 붙인다. `grab_helps.verdict` 를 그대로 항목으로 쓴다.
- D 는 **"시뮬레이션"** 이라고 적는다.
- 센서 구간(노출·리드아웃·ISP·USB)은 **재지 않았다.** "이 글에서 재지 않았다" 로 명시하고 출처를 단다. "안 나왔다" 가 아니다.

- [ ] **Step 6: §"재지 않은 것" · §"흔한 함정" · §"상황별 첫 수" · §"메모" · Sources 를 쓴다**

함정 목록에 최소 이것들: 지연 = 1/fps 착각 · 시계 두 개로 단방향 지연 재기 · 화면 녹화로 재기 · 평균만 보고 P99 안 보기 · RTSP TCP↔UDP · 스위치를 탓하기 · 운영 회선에서 부하 걸어 재기. **P95(트래픽 글, 과금 근거) 대 P99(이 글, 지각 근거) 대조를 메모에 넣는다.**

- [ ] **Step 7: 커밋**

```bash
git add content/posts/camera-latency/index.md
git commit -m "post: camera latency — where the milliseconds go, and how to measure each one"
```

---

### Task 8: 검증과 README

**Files:**
- Create: `tools/camera-latency/README.md`
- Modify: `content/posts/camera-latency/index.md` (검증에서 나온 것만)

**Interfaces:**
- Consumes: Task 1\~7 전부
- Produces: 스펙 §6 성공 기준 8 항목이 전부 체크된 상태

- [ ] **Step 1: `tools/camera-latency/README.md` 를 쓴다**

`tools/cpp-for-vision/README.md` 와 같은 형식. 담을 것: 어느 스크립트가 글의 어느 절을 만드는지 · 측정 환경 블록 · **정확한 실행 명령(파이썬 절대 경로 포함)** · 카메라가 필요 없다는 점(전부 localhost 루프백) · `results/*.json` 이 글의 유일한 숫자 출처라는 점 · 지터버퍼는 시뮬레이션이라는 점.

- [ ] **Step 2: Hugo 빌드**

Run:
```powershell
hugo --gc --minify
```
Expected: `ERROR` 0 건. `REF_NOT_FOUND` 가 나오면 Step 5 의 `ref` 링크를 고친다.

- [ ] **Step 3: 수식 손상 검사**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe tools/check-math.py public/posts/camera-latency/index.html
```
Expected: 손상 0 건.

- [ ] **Step 4: 규약 위반을 기계로 훑는다**

Run:
```powershell
Select-String -Path content/posts/camera-latency/index.md -Pattern '(?<!\\)~|\$[^$]*\$'
```
Expected: **출력 없음.** 이스케이프 안 된 물결표와 `$...$` 수식이 없어야 한다 (`hugo.toml` 은 인라인 수식을 `\(...\)` 로만 받는다).

- [ ] **Step 5: 렌더된 글을 눈으로 확인한다**

Run: `hugo server` 를 띄우고 `http://localhost:1313/posts/camera-latency/` 를 브라우저로 연다.

체크:
- 그림 세 장이 다 뜨고 캡션이 붙었나
- 표가 넘치지 않나 (아홉 단계 표의 열이 6 개다 — 모바일 폭에서 확인)
- 트래픽 글 링크가 눌리나
- 실측/문헌 구분이 글에서 읽히나
- 다크 모드에서 그림이 읽히나

**확인 없이 완료로 넘기지 않는다.**

- [ ] **Step 6: 스펙 §6 성공 기준을 체크한다**

`docs/superpowers/specs/2026-08-05-camera-latency-design.md` §6 의 8 개 체크박스를 실제로 확인하고 `- [x]` 로 바꾼다. **확인하지 못한 항목은 체크하지 않고 왜 못 했는지 한 줄 적는다.**

- [ ] **Step 7: 회귀 확인**

Run:
```powershell
git diff --stat main
```
Expected: `content/posts/camera-latency/`, `tools/camera-latency/`, `docs/superpowers/{specs,plans}/` 만 나온다. **기존 글이나 `layouts/`·`hugo.toml` 이 바뀌었으면 되돌린다.**

- [ ] **Step 8: 커밋**

```bash
git add tools/camera-latency/README.md docs/superpowers/specs/2026-08-05-camera-latency-design.md content/posts/camera-latency/index.md
git commit -m "docs(camera-latency): reproduction notes, and tick the spec's success criteria"
```

---

## Self-Review

**1. 스펙 커버리지**

| 스펙 항목 | 태스크 |
|---|---|
| §1 축(가설) 확정 | Task 5 |
| §1 제목 선택 | Task 5 Step 3 |
| §1 세 매듭 (트래픽 글·백분위·taxonomy) | Task 7 Step 3·4·6 |
| §2-A 센서→호스트 | ~~Task 1~~ — 2026-08-05 취소, §2-E 로 내림 |
| §2-B 인코더 구조적 지연 | Task 2 |
| §2-C 버퍼 누적 | Task 3 |
| §2-D 지터버퍼 | Task 4 |
| §2-E 재지 않은 구간 | Task 6 Step 1 (`CITED_MS`), Task 7 Step 6 |
| §3-1 축 무너짐 기록 | Task 5 |
| §3-2 시계 두 개 | Task 1 Step 4 (`global_time_enabled`), Task 7 Step 6 |
| §3-3 배율만 인용 | Task 7 Step 5, Global Constraints |
| §3-4 버전 명시 | Task 7 Step 5 |
| §3-5 "지연 ≠ 1/fps" 한 번만 | Task 7 Step 2 |
| §3-6 실측/문헌 구분 | Task 6 Step 1·3, Task 7 Step 1 |
| §3-7 저장소 규약 | Global Constraints, Task 8 Step 4 |
| §3-8 능동 측정 경고 | Task 7 Step 6 |
| §4 글 구조 | Task 7 |
| §5 그림 3 장 | Task 5 Step 3 (선택), Task 6 |
| §6 성공 기준 | Task 8 |

빠진 것 없음.

**2. 플레이스홀더 스캔** — Task 6 Step 1 이 `fig_budget()` 등의 본문 코드를 다 싣지 않고 규약과 데이터 출처만 지정한다. 의도적이다: 그림의 구체적 형태는 Task 5 가 고른 셋과 실측값의 모양에 달렸고, 지금 코드를 박아두면 값을 손으로 쓰게 된다. 대신 **입력 JSON 경로·색 상수·범례 문구·확인 항목**을 못 박아 두었다. Task 7 도 같은 이유로 절별 요구사항과 규칙을 지정하며, 실제 문장은 실측값에 달렸다.

**3. 타입 일관성** — `common.write_result(name, payload)` / `common.percentile(xs, q)` / `common.env_block()` 이 Task 1 에서 정의되고 Task 2·3·4 에서 같은 이름·같은 인자로 쓰인다. JSON 키(`refutation_2b`/`2c`, `rules_hold`, `isolated_costs_frames`, `lag_growth`, `grab_helps`, `is_simulation`, `consume_fps`)가 Task 5·6·7 에서 같은 이름으로 참조된다. `results/` 경로는 전부 `tools/camera-latency/results/`.
