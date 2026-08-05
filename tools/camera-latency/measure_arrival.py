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
import numpy as np
from common import percentile, write_result
from measure_buffer import FPS, SENDER, open_capture

# 워밍업이 크다. 수신을 시작하는 순간 송출이 이미 2 초쯤 앞서 있어서 그 백로그를
# 최대 속도로 들이켠다. 그 구간을 남겨두면 소비 fps 가 송출 fps 를 넘고(31.5 관측),
# 지터가 아니라 그 초기 버스트를 재게 된다.
SECONDS, WARMUP = 40.0, 150


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
    consume_fps = (len(stamps) - 1) / span_s
    path = write_result("arrival", {
        "fps": FPS, "nominal_interval_ms": 1000.0 / FPS, "backend": backend,
        "warmup_dropped": WARMUP, "n": len(stamps),
        "arrival_ms": [round(s, 4) for s in stamps],
        "interval_ms": {"median": float(np.median(intervals)),
                        "std": float(np.std(intervals)),
                        "p99": percentile(intervals, 0.99),
                        "max": float(np.max(intervals))},
        "consume_fps": consume_fps,
        # 소비가 밀렸으면 재는 것이 지터가 아니라 백로그다 — 그러면 이 측정은 무효.
        "keeps_up": consume_fps >= 0.95 * FPS,
    })
    print(f"{len(stamps)} 프레임, 소비 {consume_fps:.2f} fps "
          f"({'따라잡음' if consume_fps >= 0.95 * FPS else '🚨 밀렸다 — 무효'})")
    print(f"간격 중앙값 {np.median(intervals):.2f} ms · P99 {percentile(intervals, 0.99):.2f} ms "
          f"· 최대 {np.max(intervals):.2f} ms")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
