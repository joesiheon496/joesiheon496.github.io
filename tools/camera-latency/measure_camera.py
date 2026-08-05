"""실제 IP 카메라(Hanwha Wisenet XNO-L6020R)에서 재는 것 — 설정은 건드리지 않는다.

지금까지의 측정은 전부 localhost 루프백이었고 소프트웨어 인코더(libx264) 하나의
결과였다. 여기서는 하드웨어 인코더가 붙은 실제 카메라를 RTSP 로 받는다.

읽기 전용이다. 카메라의 프로파일·GOP·비트레이트를 바꾸지 않는다. 마침 Profile 1 이
MJPEG(프레임 간 예측 없음), Profile 2 가 H.264 GOP 60 이라 설정을 안 바꾸고도
"프레임 간 의존이 지연을 만드는가" 를 대조할 수 있다.

비밀번호는 환경변수 CAMPW 로 받는다. JSON 에도 코드에도 남기지 않는다.
"""
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import av
import numpy as np
from common import percentile, write_result

HOST = os.environ.get("CAMHOST", "192.168.50.27")
USER = os.environ.get("CAMUSER", "admin")
PW = os.environ.get("CAMPW")
if not PW:
    raise SystemExit("CAMPW 환경변수에 카메라 비밀번호를 넣고 실행하라")

SECONDS, WARMUP = 25.0, 30

# 🚨 max_delay 를 임의로 걸면 안 된다. 1차 측정에서 max_delay=500ms 를 걸고 UDP 지터
# P99 가 503 ms 로 나와 "UDP 가 TCP 보다 16배 나쁘다" 로 읽었는데, 아래 스윕이 그 값이
# 내가 건 설정을 그대로 따라간다는 것을 보여준다. 재고 있던 것은 네트워크가 아니라
# 내 클라이언트의 재정렬 버퍼였다. 그래서 본 비교는 전부 기본값으로 한다.
CONFIGS = [
    ("H.264 profile2 / TCP", 2, "tcp", None),
    ("H.264 profile2 / UDP", 2, "udp", None),
    ("MJPEG profile1 / TCP", 1, "tcp", None),
    # max_delay 가 측정값을 만든다는 것을 보이는 스윕
    ("UDP max_delay=100ms", 2, "udp", 100_000),
    ("UDP max_delay=500ms", 2, "udp", 500_000),
    ("UDP max_delay=2000ms", 2, "udp", 2_000_000),
    ("TCP max_delay=500ms (대조)", 2, "tcp", 500_000),
]

# UDP 지터는 한 번 재서 특정할 수 없다 — 첫 측정에서 실행마다 33 ms 에서 1863 ms 까지
# 흔들렸다. 재현되는 양인지 아닌지를 먼저 말해야 숫자를 쓸 수 있으므로 반복해서 잰다.
REPEAT_CONFIGS = [("TCP 기본값", 2, "tcp", None), ("UDP 기본값", 2, "udp", None)]
REPEATS = 5
REPEAT_SECONDS = 15.0


def url(profile):
    return f"rtsp://{USER}:{PW}@{HOST}/profile{profile}/media.smp"


def run_one(label, profile, transport, max_delay_us, seconds=None):
    seconds = SECONDS if seconds is None else seconds
    opts = {"rtsp_transport": transport, "stimeout": "8000000"}
    if max_delay_us is not None:
        opts["max_delay"] = str(max_delay_us)
    container = av.open(url(profile), options=opts)
    stream = next(s for s in container.streams if s.type == "video")
    stream.thread_type = "NONE"          # 디코더 스레딩이 지연을 더하지 않게

    arrivals, pts_list, dts_list = [], [], []
    packets_before_first_frame = None
    n_pkt = 0
    t0 = time.perf_counter()
    try:
        for packet in container.demux(stream):
            if packet.dts is None:
                continue
            n_pkt += 1
            frames = packet.decode()
            if frames and packets_before_first_frame is None:
                packets_before_first_frame = n_pkt - 1
            for _ in frames:
                arrivals.append((time.perf_counter() - t0) * 1000.0)
                pts_list.append(packet.pts)
                dts_list.append(packet.dts)
            if time.perf_counter() - t0 > seconds:
                break
    finally:
        container.close()

    a = np.array(arrivals[WARMUP:])
    intervals = np.diff(a)
    span_s = (a[-1] - a[0]) / 1000.0
    # pts 와 dts 가 어긋나면 B프레임이 실려 있다는 뜻이고, 디코더가 재정렬해야 한다.
    pts_arr, dts_arr = np.array(pts_list, float), np.array(dts_list, float)
    reordered = int(np.sum(pts_arr != dts_arr))
    # 지터: 최소자승으로 실측 레이트를 빼고 남은 잔차 (드리프트 제거)
    idx = np.arange(len(a))
    slope, intercept = np.polyfit(idx, a, 1)
    offsets = a - (slope * idx + intercept)
    offsets -= offsets.min()

    return {
        "label": label, "profile": profile, "transport": transport,
        "max_delay_us": max_delay_us,
        "codec": stream.codec_context.name,
        "width": stream.codec_context.width, "height": stream.codec_context.height,
        "n_frames": int(len(a)),
        "packets_before_first_frame": packets_before_first_frame,
        "pts_dts_mismatch_frames": reordered,
        "measured_fps": float((len(a) - 1) / span_s),
        "interval_ms": {"median": float(np.median(intervals)),
                        "std": float(np.std(intervals)),
                        "p99": percentile(intervals, 0.99),
                        "max": float(intervals.max())},
        "jitter_offset_ms": {"p50": float(np.percentile(offsets, 50)),
                            "p99": float(np.percentile(offsets, 99)),
                            "max": float(offsets.max())},
    }


def main():
    runs = []
    for cfg in CONFIGS:
        print(f"재는 중: {cfg[0]} ...", flush=True)
        try:
            r = run_one(*cfg)
            runs.append(r)
            print(f"  {r['n_frames']} 프레임 · {r['measured_fps']:.2f} fps · "
                  f"간격 P99 {r['interval_ms']['p99']:.1f} ms · "
                  f"지터 P99 {r['jitter_offset_ms']['p99']:.1f} ms · "
                  f"pts≠dts {r['pts_dts_mismatch_frames']}")
        except Exception as exc:
            print(f"  실패: {exc.__class__.__name__}: {exc}")
            runs.append({"label": cfg[0], "profile": cfg[1], "transport": cfg[2],
                         "max_delay_us": cfg[3],
                         "error": f"{exc.__class__.__name__}: {exc}"})

    # max_delay 를 건 UDP 실행의 지터 P99 가 그 설정을 따라가는지 확인한다.
    # 따라가면 그 숫자는 네트워크가 아니라 클라이언트 버퍼를 잰 것이다.
    swept = [r for r in runs
             if r.get("max_delay_us") and r.get("transport") == "udp"
             and "jitter_offset_ms" in r]
    artifact = None
    if len(swept) >= 2:
        ratios = [r["jitter_offset_ms"]["p99"] / (r["max_delay_us"] / 1000.0)
                  for r in swept]
        artifact = {
            "points": [{"max_delay_ms": r["max_delay_us"] / 1000.0,
                        "jitter_p99_ms": r["jitter_offset_ms"]["p99"]}
                       for r in swept],
            "p99_over_setting": ratios,
            # 비가 전부 0.8~1.3 이면 측정값이 설정에 붙어 있다는 뜻
            "tracks_setting": all(0.8 <= x <= 1.3 for x in ratios),
        }

    # 반복 측정 — 재현되는 양인지부터 정한다.
    repeats = []
    for label, profile, transport, md in REPEAT_CONFIGS:
        p99s = []
        for i in range(REPEATS):
            try:
                r = run_one(f"{label} #{i+1}", profile, transport, md, REPEAT_SECONDS)
                p99s.append(r["jitter_offset_ms"]["p99"])
                print(f"  {label} #{i+1}: 지터 P99 {p99s[-1]:.1f} ms", flush=True)
            except Exception as exc:
                print(f"  {label} #{i+1} 실패: {exc.__class__.__name__}")
        if p99s:
            lo, hi = min(p99s), max(p99s)
            repeats.append({
                "label": label, "transport": transport, "n_runs": len(p99s),
                "seconds_per_run": REPEAT_SECONDS,
                "jitter_p99_ms": [round(x, 1) for x in p99s],
                "min": lo, "max": hi, "median": float(np.median(p99s)),
                "spread_ratio": hi / lo if lo > 0 else None,
                # 최악이 최선의 2배를 넘으면 한 번 재서 특정할 수 없는 양이다
                "reproducible": (hi / lo) <= 2.0 if lo > 0 else False,
            })
            print(f"{label}: {lo:.1f} ~ {hi:.1f} ms (배율 {hi/lo:.1f}) -> "
                  f"{'재현됨' if repeats[-1]['reproducible'] else '재현 안 됨'}")

    path = write_result("camera", {
        "device": {"model": "XNO-L6020R", "vendor": "Hanwha Vision (Wisenet)",
                   "firmware": "2.10.02_20220401_R441",
                   "host": HOST,
                   "profile2": "H.264 High/CABAC 1920x1080 30fps VBR 2560kbps GOP(GOV)=60",
                   "profile1": "MJPEG 1920x1080 5fps"},
        "note": "카메라 설정은 변경하지 않았다. 읽기 전용 측정.",
        "seconds_per_config": SECONDS, "warmup_frames_dropped": WARMUP,
        "runs": runs,
        "max_delay_artifact": artifact,
        "repeatability": repeats,
    })
    if artifact:
        print(f"max_delay 스윕: 지터 P99 / 설정값 비 = "
              f"{[round(x, 2) for x in artifact['p99_over_setting']]} -> "
              f"{'설정을 따라간다 (네트워크가 아니라 내 버퍼를 잰 것)' if artifact['tracks_setting'] else '설정과 무관'}")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
