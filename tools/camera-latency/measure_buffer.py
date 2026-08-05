"""스펙 §2-C — 늦게 읽으면 지연이 자라는가, 프레임이 버려지는가.

30fps 를 localhost UDP 로 보내고 20fps 로 소비한 뒤, 소비를 최대 속도로
바꿔 200ms 안에 쏟아지는 프레임을 센다. 쏟아지면 버퍼가 쌓였던 것이고,
0 이면 버려졌던 것이다. 시계 동기가 필요 없는 판정이다.

판정과 별개로 시계열을 남긴다. CAP_PROP_POS_MSEC 가 스트림 타임스탬프를
주면 (벽시계 경과 - 스트림 경과) 가 곧 누적 지연이므로, 지연이 자라는 모습을
ms 로 그릴 수 있다. 안 주면 그 사실을 기록하고 프레임 수로만 말한다.
"""
import subprocess
import sys
import time
from pathlib import Path

# ⚠️ 실행하면 "non-existing PPS 0 referenced" / "decode_slice_header error" 가
# 수백 줄 쏟아진다. UDP 스트림에 GOP 중간부터 붙어 SPS/PPS 를 놓쳐서 나는
# 것이고, 다음 키프레임에서 복구된다. 측정값에는 영향이 없다 — 세 번 돌려
# 읽은 프레임 590\~593 장, 드레인 391\~394 장, 증가율 342.0\~345.4 ms/s 로
# 1% 안에서 움직였고, 실측과 예측의 일치는 매번 성립했다.
#
# OPENCV_FFMPEG_LOGLEVEL=-8 을 cv2 import 전에 걸어봤지만 이 빌드
# (opencv-contrib-python 4.10.0.84)에서는 먹지 않았다. 그래서 끄지 않고
# 그대로 둔다 — 안 되는 회피법을 코드에 남겨두면 다음 사람이 속는다.

sys.path.insert(0, str(Path(__file__).parent))
import cv2
from common import write_result

FFMPEG = r"C:\Users\a\anaconda3\envs\ros_env\Library\bin\ffmpeg.exe"
URL = "udp://127.0.0.1:23000"
FPS, SLOW_SECONDS, SLEEP, DRAIN_SECONDS = 30, 30.0, 0.05, 0.2
SENDER = [FFMPEG, "-hide_banner", "-loglevel", "error", "-re",
          "-f", "lavfi", "-i", f"testsrc=size=640x480:rate={FPS}",
          "-c:v", "libx264", "-tune", "zerolatency", "-g", "30",
          "-pix_fmt", "yuv420p", "-f", "mpegts", URL]


def open_capture():
    cap = cv2.VideoCapture(f"{URL}?overrun_nonfatal=1&fifo_size=1000000",
                           cv2.CAP_FFMPEG)
    for _ in range(200):                               # 첫 프레임까지 기다린다
        if cap.isOpened() and cap.read()[0]:
            return cap
        time.sleep(0.05)
    raise RuntimeError("수신 스트림을 열지 못했다")


def consume(cap, seconds, sleep_s, trace=None):
    """seconds 동안 읽는다. trace 가 주어지면 1초마다 표본을 남긴다."""
    t0, n, next_sample = time.perf_counter(), 0, 1.0
    while True:
        elapsed = time.perf_counter() - t0
        if elapsed >= seconds:
            break
        if cap.read()[0]:
            n += 1
        if trace is not None and elapsed >= next_sample:
            trace.append({"elapsed_s": round(elapsed, 3), "frames_read": n,
                          "pos_msec": cap.get(cv2.CAP_PROP_POS_MSEC)})
            next_sample += 1.0
        if sleep_s:
            time.sleep(sleep_s)
    return n, time.perf_counter() - t0


def main():
    sender = subprocess.Popen(SENDER)
    try:
        time.sleep(2.0)                                # 송출이 안정될 때까지
        cap = open_capture()
        backend = cap.getBackendName()
        set_returned = bool(cap.set(cv2.CAP_PROP_BUFFERSIZE, 1))
        buffersize_readback = cap.get(cv2.CAP_PROP_BUFFERSIZE)

        trace = []
        slow_n, slow_s = consume(cap, SLOW_SECONDS, SLEEP, trace)
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
    verdict = ("효과 있음" if g_drain < drain_n
               else "효과 없음 — 이 백엔드에서는 통설이 틀리다")

    # POS_MSEC 가 쓸 수 있으면 (벽시계 경과 - 스트림 경과) 가 누적 지연이다.
    usable = len(trace) >= 2 and any(s["pos_msec"] > 0 for s in trace)
    growth = None
    if usable:
        base = trace[0]
        for s in trace:
            s["lag_ms"] = ((s["elapsed_s"] - base["elapsed_s"]) * 1000.0
                           - (s["pos_msec"] - base["pos_msec"]))
        lag_span = {"start": trace[0]["lag_ms"], "end": trace[-1]["lag_ms"]}

        # 지연 증가율이 '못 읽은 프레임 수 x 프레임 주기' 와 맞는지 스크립트가
        # 확인한다. 두 방법이 독립이므로, 맞으면 둘 다 믿을 수 있다.
        span_s = trace[-1]["elapsed_s"] - base["elapsed_s"]
        measured_rate = (lag_span["end"] - lag_span["start"]) / span_s
        consume_fps = (trace[-1]["frames_read"] - base["frames_read"]) / span_s
        predicted_rate = (FPS - consume_fps) * (1000.0 / FPS)
        growth = {
            "measured_ms_per_s": measured_rate,
            "predicted_ms_per_s": predicted_rate,
            "consume_fps": consume_fps,
            "agrees_within_5pct": abs(measured_rate - predicted_rate) <= 0.05 * predicted_rate,
            "monotonic": all(a <= b + 1e-9 for a, b in
                             zip([s["lag_ms"] for s in trace], [s["lag_ms"] for s in trace][1:])),
        }
    else:
        lag_span = None

    path = write_result("buffer", {
        "backend": backend, "sender_cmd": SENDER,
        "consumer_target_fps": round(1.0 / SLEEP, 1),
        "phases": {"slow": {"seconds": slow_s, "frames_read": slow_n,
                            "expected_frames": expected},
                   "drain": {"seconds": drain_s, "frames_read": drain_n}},
        "buffersize": {"set_returned": set_returned,
                       "readback": buffersize_readback},
        "grab_helps": {"tested": True, "frames_read": grab_n,
                       "drain_frames": g_drain, "verdict": verdict},
        "trace": trace,
        "pos_msec_usable": usable,
        "pts_lag_ms": lag_span,
        "lag_growth": growth,
        "refutation_2c": {"passed": accumulated, "note": note},
    })
    print(note)
    print(f"grab() 회피법: {verdict} (grab {grab_n} 장 / 드레인 {g_drain} 장)")
    print(f"CAP_PROP_BUFFERSIZE: set()={set_returned}, 되읽기={buffersize_readback}")
    if growth:
        print(f"지연 증가율 실측 {growth['measured_ms_per_s']:.1f} ms/s "
              f"대 예측 {growth['predicted_ms_per_s']:.1f} ms/s "
              f"-> {'5% 안에서 일치' if growth['agrees_within_5pct'] else '불일치 — 둘 중 하나가 틀렸다'}, "
              f"단조 {growth['monotonic']}")
    else:
        print("POS_MSEC 를 못 써서 지연을 ms 로 말할 수 없다 — 프레임 수로만 쓴다")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
