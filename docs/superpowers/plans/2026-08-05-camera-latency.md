# 카메라 딜레이 글 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카메라 지연을 아홉 단계 예산으로 쪼개고, 그중 네 구간을 이 기계에서 직접 재서 `content/posts/camera-latency/index.md` 글로 낸다.

**Architecture:** 측정이 먼저다. `tools/camera-latency/` 의 독립 스크립트 네 개가 각각 JSON 을 뱉고, 그 JSON 만이 글과 그림의 입력이 된다. 스크립트 → JSON → 그림 → 글의 단방향 흐름이라 숫자의 출처가 한 곳으로 고정된다. 측정이 스펙의 가설을 반증하면 Task 5 에서 축을 교체하고, 그 뒤에 글을 쓴다.

**Tech Stack:** Python (conda env `camera`: pyrealsense2 2.56.5.9235, PyAV 17.0.0, opencv-contrib-python 4.10.0.84, numpy 2.2.6, matplotlib 3.10.8) · ffmpeg (`ros_env`) · Hugo + PaperMod

## Global Constraints

스펙 `docs/superpowers/specs/2026-08-05-camera-latency-design.md` 의 프로젝트 전역 요구사항이다. **모든 태스크의 요구사항에 이것이 암묵적으로 포함된다.**

- **파이썬 인터프리터는 항상 `C:\Users\a\anaconda3\envs\camera\python.exe`** 다. `python` 을 그냥 호출하면 base 환경이고 거기에는 cv2·PyAV·pyrealsense2 가 없다.
- **ffmpeg 은 `C:\Users\a\anaconda3\envs\ros_env\Library\bin\ffmpeg.exe`** 다. PATH 에 없다.
- **절대 ms 를 본문 주장으로 쓰지 않는다.** 배율과 프레임 수만 쓴다. 표에는 절대값을 실어도 되지만 환경 블록을 함께 둔다.
- **실측과 문헌 인용을 구분 표기한다.** 표에서는 열을 나누고, 그림에서는 색을 나누고 범례에 적는다.
- **측정하지 못한 것은 "재지 않았다" 로 명시한다.** "안 나왔다" 가 아니라 "이 방법으로는 볼 수 없다" 로 쓴다.
- **Hugo 표기 규약:** 물결표는 `\~`, 인라인 수식은 `\(...\)`, 블록 수식은 `\[...\]`, 이미지는 `{{< img src="..." alt="..." caption="..." >}}`, 다른 글 링크는 `{{< ref "/posts/network-traffic-check" >}}`.
- **front matter:** `categories = ["기타"]`, `draft = false`, `math = true`, `tags` 에 `["카메라", "지연", "latency", "RealSense", "OpenCV", "FFmpeg", "H.264"]`.
- **모든 난수는 시드 고정.** `numpy.random.default_rng(20260805)`.
- **모든 스크립트는 JSON 을 `tools/camera-latency/results/` 에 쓴다.** 글과 그림은 이 JSON 만 읽는다.
- **UB·구현 세부는 규칙처럼 쓰지 않는다.** OpenCV 버전·백엔드 이름, x264 기본값은 관측한 버전을 붙인다.
- 🚫 **수학 시리즈 머리 배너를 쓰지 않는다.** `> 🎛 **직접 만지는 데모가 두 개** 있습니다. 슬라이더를 움직여보세요.` 와 `컴퓨터 비전 수학 시리즈 N 번째 글입니다` 는 **시리즈 글에만** 쓴다 (1\~9편 전부가 쓰고 있다). 이 글은 시리즈 밖이고 데모가 없다. 대신 트래픽 글과 같은 `> 🔧 실행 환경:` 블록쿼트를 쓴다 (Task 7 Step 1). 시리즈 번호도 붙이지 않는다.
- 브랜치는 `post-camera-latency`. 커밋은 태스크마다 하나 이상.

---

### Task 1: 측정 하네스와 D455 센서→호스트 지연 (스펙 §2-A)

**Files:**
- Create: `tools/camera-latency/common.py`
- Create: `tools/camera-latency/measure_sensor.py`
- Create: `tools/camera-latency/results/` (디렉터리, `.gitkeep`)
- Create: `tools/camera-latency/results/sensor.json` (스크립트 출력, 커밋한다)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `common.py`: `write_result(name: str, payload: dict) -> Path` — `results/<name>.json` 에 `{"env": {...}, "data": payload}` 를 UTF-8 로 쓰고 경로를 돌려준다. `env_block() -> dict` — 플랫폼·패키지 버전 딕셔너리. `percentile(xs: list[float], q: float) -> float` — 최근접 순위 백분위(선형보간 아님).
  - `results/sensor.json` 의 `data` 스키마: `{"metadata_supported": {str: bool}, "timestamp_domain": str, "global_time_enabled": bool, "exposure_option_range": {"min": float, "max": float, "step": float}, "runs": [{"width": int, "height": int, "fps": int, "exposure_us": float|null, "auto_exposure": bool, "n": int, "arrival_lag_ms": {"median": float, "p99": float}|null, "interval_ms": {"median": float, "std": float, "p99": float}, "actual_exposure_us": float|null}], "refutation_2a": {"passed": bool, "note": str}}`

- [ ] **Step 1: 하네스를 쓴다 (`common.py`)**

```python
"""camera-latency 측정 스크립트가 공유하는 것들.

숫자의 출처를 한 곳으로 고정하기 위해, 모든 측정은 results/<name>.json 으로만
나간다. 글과 그림은 이 JSON 만 읽는다.
"""
import json
import platform
import sys
from pathlib import Path

RESULTS = Path(__file__).parent / "results"


def env_block() -> dict:
    """숫자를 인용할 때 반드시 함께 적는 것."""
    env = {
        "os": platform.platform(),
        "python": sys.version.split()[0],
    }
    for mod, key in (("cv2", "opencv"), ("av", "pyav"),
                     ("numpy", "numpy"), ("pyrealsense2", "pyrealsense2")):
        try:
            env[key] = __import__(mod).__version__
        except Exception as exc:                      # 없으면 없다고 적는다
            env[key] = f"unavailable: {exc.__class__.__name__}"
    return env


def percentile(xs, q: float) -> float:
    """최근접 순위 백분위. 실측에 없는 값이 리포트에 찍히지 않게 보간하지 않는다."""
    s = sorted(xs)
    if not s:
        raise ValueError("빈 표본에서 백분위를 낼 수 없다")
    idx = max(0, min(len(s) - 1, int(-(-q * len(s) // 1)) - 1))
    return float(s[idx])


def write_result(name: str, payload: dict) -> Path:
    RESULTS.mkdir(exist_ok=True)
    path = RESULTS / f"{name}.json"
    path.write_text(
        json.dumps({"env": env_block(), "data": payload},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return path
```

- [ ] **Step 2: 하네스가 도는지 확인한다**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe -c "import sys; sys.path.insert(0, 'tools/camera-latency'); import common; print(common.env_block()); print(common.percentile([1,2,3,4,5,6,7,8,9,10], 0.99))"
```
Expected: 버전 딕셔너리가 찍히고 백분위가 `10.0`. (10 개 표본의 P99 는 최근접 순위로 최댓값이다.)

- [ ] **Step 3: D455 가 붙었는지 확인한다**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe -c "import pyrealsense2 as rs; print(len(list(rs.context().devices)))"
```
Expected: `1` 이상.

**`0` 이면 여기서 멈추고 사용자에게 D455 연결을 요청한다.** 연결 없이 이 태스크를 진행하면 안 된다 — 스펙 §2-A 는 실측이 전제다. 사용자가 연결할 수 없다고 답하면 스펙 §2-A 를 §2-E(재지 않은 구간)로 내리고 그 사실을 스펙에 되적은 뒤 Task 2 로 넘어간다.

- [ ] **Step 4: 측정 스크립트를 쓴다 (`measure_sensor.py`)**

```python
"""스펙 §2-A — D455 센서 타임스탬프에서 호스트 도착까지.

핵심 주의(스펙 §3-2): 카메라와 호스트는 서로 다른 시계다. global_time_enabled 를
켜면 SDK 가 프레임 타임스탬프를 호스트 시계 도메인으로 옮겨주고, 그때만 절대
단방향 지연을 말할 수 있다. 못 켜지면 상대 비교만 하고 그렇게 적는다.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import numpy as np
import pyrealsense2 as rs
from common import percentile, write_result

WARMUP = 30
N = 300
MD = {
    "sensor_timestamp": rs.frame_metadata_value.sensor_timestamp,
    "frame_timestamp": rs.frame_metadata_value.frame_timestamp,
    "time_of_arrival": rs.frame_metadata_value.time_of_arrival,
    "actual_exposure": rs.frame_metadata_value.actual_exposure,
    "frame_counter": rs.frame_metadata_value.frame_counter,
}
# 해상도·FPS 스윕은 노출 스윕과 교차하지 않는다 — 조건 수가 폭발한다.
# 노출의 효과(반증 조건)를 848x480@30 에서 재고, 해상도·FPS 는 auto 노출로 훑는다.
GEOM = [(424, 240, 30), (848, 480, 15), (848, 480, 30), (848, 480, 60), (1280, 720, 30)]
EXPOSURES_US = [1000, 8000, 33000]


def run_one(width, height, fps, exposure_us):
    """한 조건에서 N 프레임을 받아 도착 지연과 프레임 간격을 돌려준다."""
    pipe, cfg = rs.pipeline(), rs.config()
    cfg.enable_stream(rs.stream.color, width, height, rs.format.bgr8, fps)
    profile = pipe.start(cfg)
    sensor = profile.get_device().first_color_sensor()

    # 호스트 시계 도메인으로 옮긴다. 실패해도 계속하고 아래에서 도메인을 기록한다.
    global_ok = True
    try:
        sensor.set_option(rs.option.global_time_enabled, 1)
    except Exception:
        global_ok = False

    rng = sensor.get_option_range(rs.option.exposure)
    if exposure_us is None:
        sensor.set_option(rs.option.enable_auto_exposure, 1)
        applied = None
    else:
        sensor.set_option(rs.option.enable_auto_exposure, 0)
        applied = float(min(max(exposure_us, rng.min), rng.max))
        sensor.set_option(rs.option.exposure, applied)

    lags, stamps, actual, domain, supported = [], [], [], None, {}
    try:
        for i in range(WARMUP + N):
            f = pipe.wait_for_frames().get_color_frame()
            host_ms = time.perf_counter() * 1000.0
            if i < WARMUP:
                continue
            if domain is None:
                domain = str(f.get_frame_timestamp_domain())
                supported = {k: bool(f.supports_frame_metadata(v))
                             for k, v in MD.items()}
            stamps.append(f.get_timestamp())          # ms
            lags.append(host_ms - f.get_timestamp())  # 도메인이 같을 때만 의미 있다
            if supported.get("actual_exposure"):
                actual.append(float(f.get_frame_metadata(MD["actual_exposure"])))
    finally:
        pipe.stop()

    intervals = list(np.diff(stamps))
    # perf_counter 와 프레임 타임스탬프의 원점이 다르면 lag 의 절대값은 무의미하다.
    # 원점 차이는 상수이므로, 조건 사이의 '차이' 는 여전히 읽을 수 있다.
    absolute_ok = global_ok and "system_time" in (domain or "").lower()
    return {
        "width": width, "height": height, "fps": fps,
        "exposure_us": exposure_us, "auto_exposure": exposure_us is None,
        "applied_exposure_us": applied, "n": len(stamps),
        "timestamp_domain": domain, "absolute_lag_meaningful": absolute_ok,
        "arrival_lag_ms": {"median": float(np.median(lags)),
                           "p99": percentile(lags, 0.99)},
        "interval_ms": {"median": float(np.median(intervals)),
                        "std": float(np.std(intervals)),
                        "p99": percentile(intervals, 0.99)},
        "actual_exposure_us": float(np.median(actual)) if actual else None,
        "metadata_supported": supported,
    }


def main():
    runs = [run_one(w, h, f, None) for (w, h, f) in GEOM]
    runs += [run_one(848, 480, 30, e) for e in EXPOSURES_US]

    # 반증 조건: 노출 1ms -> 33ms 에서 도착 지연이 노출 증가분(32ms)만큼 늘어나는가.
    by_exp = {r["exposure_us"]: r for r in runs if r["exposure_us"] is not None}
    lo, hi = by_exp.get(1000), by_exp.get(33000)
    if lo and hi:
        delta = hi["arrival_lag_ms"]["median"] - lo["arrival_lag_ms"]["median"]
        expected = (33000 - 1000) / 1000.0
        passed = delta >= 0.5 * expected
        note = (f"노출 32ms 증가에 도착 지연 {delta:.1f}ms 증가 "
                f"(기대 {expected:.1f}ms, 절반 이상이면 통과) -> "
                f"{'통과' if passed else '반증: 노출이 지연에 직접 들어온다는 서술을 고쳐야 한다'}")
    else:
        passed, note = False, "노출 고정에 실패해 반증 조건을 평가할 수 없다"

    path = write_result("sensor", {"runs": runs,
                                   "refutation_2a": {"passed": passed, "note": note}})
    print(note)
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: 측정을 돌린다**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe tools/camera-latency/measure_sensor.py
```
Expected: 반증 조건 문장 한 줄과 `wrote ...\results\sensor.json`. 8 개 조건이 다 돈다.

메타데이터가 `not supported` 로 막히거나 `timestamp_domain` 이 `hardware_clock` 이면 `absolute_lag_meaningful` 이 `false` 로 찍힌다. **그건 실패가 아니다** — 스펙 §2-A 가 예상한 경로다. 그 경우 조건 사이 **상대 비교**만 글에 쓰고, 절대 센서 지연은 §2-E 로 내린다.

- [ ] **Step 6: 결과를 눈으로 확인한다**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe -c "import json; d=json.load(open('tools/camera-latency/results/sensor.json',encoding='utf-8'))['data']; print(d['refutation_2a']); [print(r['width'],r['height'],r['fps'],r['exposure_us'],r['timestamp_domain'],r['absolute_lag_meaningful'],round(r['arrival_lag_ms']['median'],2),round(r['interval_ms']['std'],2)) for r in d['runs']]"
```
Expected: 8 줄. `n` 이 300 이고, `interval_ms.median` 이 `1000/fps` 에 가까울 것. **`interval_ms.median` 이 `1000/fps` 와 10 % 이상 다르면 카메라가 요청한 FPS 를 못 내고 있다는 뜻이므로, 그 조건은 글에서 제외하거나 그 사실을 적는다.**

- [ ] **Step 7: 커밋**

```bash
git add tools/camera-latency/common.py tools/camera-latency/measure_sensor.py tools/camera-latency/results/sensor.json
git commit -m "feat(camera-latency): measure the D455 sensor-to-host arrival lag"
```

---

### Task 2: 인코더 구조적 지연 (스펙 §2-B)

이 글에서 **가장 인용 가치가 높은 값**을 만드는 태스크다. 삼킨 프레임 수는 기계에 독립이라 절대 시간 규칙(Global Constraints)의 예외다.

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

### Task 3: 수신측 버퍼 누적 (스펙 §2-C)

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

**Files:**
- Create: `tools/camera-latency/compute_jitter.py`
- Create: `tools/camera-latency/results/jitter.json`

**Interfaces:**
- Consumes: `results/sensor.json` (Task 1 의 `runs[*].interval_ms`), `common.write_result`
- Produces: `results/jitter.json` 의 `data` 스키마: `{"source": str, "nominal_interval_ms": float, "n_samples": int, "curve": [{"buffer_ms": float, "added_latency_ms": float, "loss_rate": float}], "min_buffer_for_0p1pct_ms": float|null, "is_simulation": true}`

⚠️ **이것은 실측 분포 + 계산이다.** JSON 에 `is_simulation: true` 가 박혀 있고, 글에도 "시뮬레이션" 이라고 쓴다 (Global Constraints).

- [ ] **Step 1: 계산 스크립트를 쓴다 (`compute_jitter.py`)**

```python
"""스펙 §2-D — 지터버퍼 크기 b 대 (추가 지연, 유실률).

입력은 §2-A 에서 실측한 프레임 간격 분포다. 버퍼 b 를 두면 재생 시각이
b 만큼 뒤로 밀리고, 누적 도착 지연이 b 를 넘긴 프레임은 늦어서 버려진다.
실측 분포 + 계산이므로 is_simulation 을 박아둔다.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import numpy as np
from common import write_result

HERE = Path(__file__).parent
RUN_LABEL = (848, 480, 30)                            # 노출 auto, 대표 조건


def arrival_offsets():
    """실측 프레임 간격에서 '이상적 등간격 대비 누적 편차' 를 만든다."""
    d = json.loads((HERE / "results" / "sensor.json").read_text(encoding="utf-8"))["data"]
    run = next(r for r in d["runs"]
               if (r["width"], r["height"], r["fps"]) == RUN_LABEL
               and r["auto_exposure"])
    nominal = 1000.0 / run["fps"]
    # 간격의 중앙값·표준편차·P99 만 JSON 에 있으므로, 관측된 세 통계량을
    # 재현하는 표본을 만든다 — 정규 + P99 를 맞춘 꼬리.
    rng = np.random.default_rng(20260805)
    n = run["n"]
    iv = run["interval_ms"]
    core = rng.normal(iv["median"], iv["std"], n)
    tail = int(max(1, round(n * 0.01)))
    core[rng.choice(n, tail, replace=False)] = iv["p99"]
    return nominal, np.cumsum(core - nominal), int(n)


def main():
    nominal, offsets, n = arrival_offsets()
    offsets = offsets - offsets.min()                  # 가장 이른 도착을 0 으로
    curve = []
    for b in np.arange(0.0, 6.0 * nominal + 0.01, nominal / 4.0):
        loss = float(np.mean(offsets > b))
        curve.append({"buffer_ms": float(b), "added_latency_ms": float(b),
                      "loss_rate": loss})
    ok = [c for c in curve if c["loss_rate"] <= 0.001]
    path = write_result("jitter", {
        "source": "results/sensor.json interval_ms (실측) + 계산",
        "nominal_interval_ms": nominal, "n_samples": n,
        "curve": curve,
        "min_buffer_for_0p1pct_ms": ok[0]["buffer_ms"] if ok else None,
        "is_simulation": True,
    })
    print(f"유실 0.1% 를 만족하는 최소 버퍼: "
          f"{ok[0]['buffer_ms']:.1f}ms ({ok[0]['buffer_ms'] / nominal:.2f} 프레임)"
          if ok else "0.1% 를 만족하는 버퍼가 범위 안에 없다")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 계산을 돌린다**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe tools/camera-latency/compute_jitter.py
```
Expected: 최소 버퍼 한 줄과 `wrote ...\results\jitter.json`.

- [ ] **Step 3: 곡선이 단조인지 확인한다**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe -c "import json; c=json.load(open('tools/camera-latency/results/jitter.json',encoding='utf-8'))['data']['curve']; ls=[x['loss_rate'] for x in c]; print('monotone:', all(a>=b for a,b in zip(ls,ls[1:]))); print(ls[:6], ls[-3:])"
```
Expected: `monotone: True`. 버퍼를 키우면 유실률이 줄어야 한다 — 아니면 계산이 틀렸다.

- [ ] **Step 4: 커밋**

```bash
git add tools/camera-latency/compute_jitter.py tools/camera-latency/results/jitter.json
git commit -m "feat(camera-latency): turn the measured interval spread into a jitter-buffer curve"
```

---

### Task 5: 🚨 축 확정 게이트 — 측정 결과를 스펙에 되적는다

**측정 전에 스펙을 썼으므로 이 게이트가 이 계획의 핵심이다.** 7편·8편·cpp-for-vision 에서 승인받은 축이 세 번 연속 무너졌다. 글을 쓰기 전에 반드시 통과한다.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-camera-latency-design.md` (§0 에 결과 절 추가, §1 의 축 확정 또는 교체, §2-A\~2-D 의 반증 조건에 결과 기입)

**Interfaces:**
- Consumes: `results/sensor.json`, `results/encoder.json`, `results/buffer.json`, `results/jitter.json`
- Produces: 확정된 축 한 문장과 제목 하나. Task 7 이 이것을 그대로 쓴다.

- [ ] **Step 1: 네 반증 조건의 결과를 한자리에 모은다**

Run:
```powershell
& C:\Users\a\anaconda3\envs\camera\python.exe -c "import json,glob;
[print(f, json.load(open(f,encoding='utf-8'))['data'].get('refutation_2a') or json.load(open(f,encoding='utf-8'))['data'].get('refutation_2b') or json.load(open(f,encoding='utf-8'))['data'].get('refutation_2c') or 'n/a') for f in sorted(glob.glob('tools/camera-latency/results/*.json'))]"
```
Expected: 4 줄. `jitter.json` 은 `n/a`(반증 조건이 없는 계산이다).

- [ ] **Step 2: 축을 판정한다**

스펙 §1 의 가설은 **"예산의 가장 큰 항목은 카메라·회선이 아니라 수신측 버퍼와 인코더 구조다"** 였다. 판정 규칙:

| 조건 | 결론 |
|---|---|
| `encoder.threading_vs_bframes.larger == "threads"` | 축의 "인코더 구조" 를 **스레딩** 으로 특정한다. B프레임은 부차 항목으로 내린다 |
| `refutation_2b.passed == false` | "B프레임은 구조적 지연" 을 **버린다**. 축을 스레딩·버퍼만으로 다시 쓴다 |
| `refutation_2c.passed == false` | "수신측 버퍼" 를 **"백엔드에 따라 버리거나 쌓는다"** 로 약화한다. 축의 앞부분(예산)만 남긴다 |
| 둘 다 `false` | 🚨 축이 무너졌다. 부제 축(**지연 ≠ 1/fps**)을 **주 축으로 승격**하고, 측정 결과는 "고칠 곳이 어디가 아닌지" 의 근거로 쓴다 |
| `refutation_2a.passed == false` 또는 `absolute_lag_meaningful == false` | §2-A 를 상대 비교로 축소하고 절대 센서 지연은 §2-E 로 내린다. 축과는 무관 |

- [ ] **Step 3: 스펙을 고친다**

`docs/superpowers/specs/2026-08-05-camera-latency-design.md` 에:

1. §0 **앞에** `## 0. 측정 결과 — 가설은 어떻게 됐나` 절을 넣는다. 8편 스펙 §0 과 같은 형식이다. 축이 교체됐으면 원래 축을 `~~취소선~~` 으로 남기고 무엇이 그것을 죽였는지 숫자와 함께 적는다. 유지됐으면 **어떤 숫자가 그것을 지지했는지** 적는다.
2. §1 의 "가설 — 측정으로 확정한다" 를 **"확정"** 으로 바꾸고 최종 축 한 문장을 쓴다.
3. §1 의 제목 후보 3 개에서 하나를 고르고 나머지에 `~~취소선~~`.
4. §2-A\~2-D 의 각 **반증 조건** 아래에 `**결과:**` 한 줄로 실측값과 통과/반증을 적는다.
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

`fig_budget()` — 아홉 단계 수평 스택 바 한 줄. 실측 구간은 `MEASURED`, 문헌 구간은 `CITED` 로 칠하고 **범례에 "이 글에서 실측" / "문헌 인용(재지 않음)" 을 적는다.** 실측 구간의 값은 `sensor.json`·`encoder.json`(프레임 수 × `1000/fps`)·`jitter.json` 에서 읽는다. 문헌 구간의 값은 Task 7 의 Sources 와 **같은 출처**에서 오며, 스크립트 상단에 `CITED_MS = {"패널 응답": (값, "출처 URL"), ...}` 로 두고 주석에 출처를 적는다.

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
tags = ["카메라", "지연", "latency", "RealSense", "OpenCV", "FFmpeg", "H.264"]
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

네 가지를 구분하는 표(glass-to-glass / 파이프라인 지연 / 지터 / 프레임 간격) + **지연 ≠ 1/fps** 를 여기서 한 번만 깬다. `sensor.json` 의 `interval_ms.median` 이 `1000/fps` 에 가까운데 도착 지연은 그보다 크다는 실측을 근거로 쓴다.

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
- §2-A 의 `absolute_lag_meaningful` 이 `false` 면 "이 방법으로는 절대 센서 지연을 볼 수 없다" 로 쓴다.

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

`tools/cpp-for-vision/README.md` 와 같은 형식. 담을 것: 어느 스크립트가 글의 어느 절을 만드는지 · 측정 환경 블록 · **정확한 실행 명령(파이썬 절대 경로 포함)** · D455 연결이 필요하다는 점 · `results/*.json` 이 글의 유일한 숫자 출처라는 점 · 지터버퍼는 시뮬레이션이라는 점.

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
| §2-A 센서→호스트 | Task 1 |
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

**3. 타입 일관성** — `common.write_result(name, payload)` / `common.percentile(xs, q)` / `common.env_block()` 이 Task 1 에서 정의되고 Task 2·3·4 에서 같은 이름·같은 인자로 쓰인다. JSON 키(`refutation_2a`/`2b`/`2c`, `threading_vs_bframes`, `absolute_lag_meaningful`, `grab_helps`, `is_simulation`)가 Task 5·6·7 에서 같은 이름으로 참조된다. `results/` 경로는 전부 `tools/camera-latency/results/`.
