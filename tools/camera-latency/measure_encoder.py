"""스펙 §2-B — 인코더가 첫 패킷을 내놓기까지 프레임을 몇 장 삼키는가.

이 '삼킨 프레임 수' 가 구조적(불가피한) 지연이다. 프레임 수라서 기계에
독립이고, 그래서 이 글에서 유일하게 절대값으로 인용할 수 있는 지연이다.

⚠️ 1차 측정의 조건 설계가 틀렸다. bf=3 이 31 장을 삼킨 것을 보고 "B프레임이
구조적 지연" 이라고 읽었는데, B프레임이 없는 bf=0 도 31 장을 삼켰다. 원인을
분리할 대조군(bf=0, g=30, threads=1, tune 없음)이 조건에 없었던 것이다.
그래서 여기서는 세 후보(lookahead · B프레임 · 프레임 스레딩)를 각각
'그것만 끈' 조건과 짝지어 넣는다.

요청한 옵션이 실제로 먹었는지 되읽어 JSON 에 함께 남긴다. 안 그러면 인코더가
무시한 설정을 '측정했다' 고 적게 된다.
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

# (라벨, x264/libavcodec 옵션, CodecContext 속성)
# 대조군은 "기본 bf=0" 이다. 나머지는 거기서 한 가지만 바꾼다.
CONDITIONS = [
    ("tune=zerolatency (하한)",   {"tune": "zerolatency", "bf": "0", "g": "30"}, {"thread_count": 1}),
    ("대조군: 기본 bf=0",          {"bf": "0", "g": "30"}, {"thread_count": 1}),
    ("기본 bf=3",                 {"bf": "3", "g": "30"}, {"thread_count": 1}),
    ("기본 bf=16",                {"bf": "16", "g": "30"}, {"thread_count": 1}),
    ("lookahead=0, bf=0",         {"bf": "0", "g": "30", "rc-lookahead": "0"}, {"thread_count": 1}),
    ("lookahead=0, bf=3",         {"bf": "3", "g": "30", "rc-lookahead": "0"}, {"thread_count": 1}),
    ("lookahead=0, bf=16",        {"bf": "16", "g": "30", "rc-lookahead": "0"}, {"thread_count": 1}),
    ("lookahead=10, bf=0",        {"bf": "0", "g": "30", "rc-lookahead": "10"}, {"thread_count": 1}),
    ("g=15, bf=0",                {"bf": "0", "g": "15"}, {"thread_count": 1}),
    ("g=250, bf=0",               {"bf": "0", "g": "250"}, {"thread_count": 1}),
    ("슬라이스 스레딩 x4, la=0",   {"bf": "0", "g": "30", "rc-lookahead": "0"},
                                  {"thread_count": 4, "thread_type": "SLICE"}),
    # 프레임 스레딩은 스레드 수를 셋 재서 'threads + 1' 인지 확인한다.
    # 한 점으로는 규칙을 말할 수 없다.
    ("프레임 스레딩 x2, la=0",     {"bf": "0", "g": "30", "rc-lookahead": "0"},
                                  {"thread_count": 2, "thread_type": "FRAME"}),
    ("프레임 스레딩 x4, la=0",     {"bf": "0", "g": "30", "rc-lookahead": "0"},
                                  {"thread_count": 4, "thread_type": "FRAME"}),
    ("프레임 스레딩 x8, la=0",     {"bf": "0", "g": "30", "rc-lookahead": "0"},
                                  {"thread_count": 8, "thread_type": "FRAME"}),
]
# 되읽어서 옵션이 먹었는지 확인할 AVCodecContext 필드.
READBACK = ("thread_count", "thread_type", "gop_size", "max_b_frames")

CONTROL = "대조군: 기본 bf=0"
LA0_BF0 = "lookahead=0, bf=0"
LA0_BF3 = "lookahead=0, bf=3"
FRAME_THREADS = "프레임 스레딩 x4, la=0"


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


def run_one(label, options, attrs):
    enc = av.CodecContext.create(CODEC, "w")
    enc.width, enc.height = W, H
    enc.pix_fmt = "yuv420p"
    enc.time_base = Fraction(1, FPS)
    enc.options = dict(options)
    for key, value in attrs.items():
        setattr(enc, key, value)

    swallowed, times = None, []
    for i, frame in enumerate(frames(N)):
        t0 = time.perf_counter()
        pkts = enc.encode(frame)
        times.append((time.perf_counter() - t0) * 1000.0)
        if pkts and swallowed is None:
            swallowed = i                              # 앞의 i 장이 삼켜졌다
    flush = len(enc.encode(None))                      # 남은 것을 밀어낸다

    applied = {}
    for attr in READBACK:
        if hasattr(enc, attr):
            applied[attr] = str(getattr(enc, attr))
    return {
        "label": label, "options": dict(options), "requested_attrs": {k: str(v) for k, v in attrs.items()},
        "applied": applied,
        "swallowed_frames": swallowed if swallowed is not None else N,
        "encode_ms": {"median": float(np.median(times)),
                      "p99": percentile(times, 0.99)},
        "flush_packets": flush,
    }


def main():
    runs = [run_one(*c) for c in CONDITIONS]
    by = {r["label"]: r["swallowed_frames"] for r in runs}

    # 세 후보를 각각 '그것만 끈' 조건과의 차이로 분리한다.
    lookahead_cost = by[CONTROL] - by[LA0_BF0]
    bframe_cost = by[LA0_BF3] - by[LA0_BF0]
    frame_thread_cost = by[FRAME_THREADS] - by[LA0_BF0]
    costs = {"lookahead": lookahead_cost, "bframes": bframe_cost,
             "frame_threading": frame_thread_cost}
    dominant = max(costs, key=costs.get)

    # 관측한 규칙이 조건 전체에서 성립하는지 스크립트가 직접 확인한다.
    # 손으로 눈대중하면 세 점에 맞는 식을 다섯 점의 규칙이라고 쓰게 된다.
    def swallowed_of(label):
        return by[label]

    rules = {
        "lookahead_min_gop_plus_1": [
            {"gop": g, "rc_lookahead": la, "predicted": min(g, la) + 1,
             "measured": swallowed_of(label)}
            for label, g, la in (("대조군: 기본 bf=0", 30, 40), ("g=250, bf=0", 250, 40),
                                 ("g=15, bf=0", 15, 40), ("lookahead=10, bf=0", 30, 10),
                                 (LA0_BF0, 30, 0))
        ],
        "bframes_bf_plus_1": [
            {"bf": bf, "predicted": bf + 1, "measured": swallowed_of(label)}
            for label, bf in ((LA0_BF0, 0), (LA0_BF3, 3), ("lookahead=0, bf=16", 16))
        ],
        "frame_threading_threads_plus_1": [
            {"threads": t, "predicted": t + 1, "measured": swallowed_of(label)}
            for label, t in (("프레임 스레딩 x2, la=0", 2), ("프레임 스레딩 x4, la=0", 4),
                             ("프레임 스레딩 x8, la=0", 8))
        ],
    }
    rules_hold = {k: all(r["predicted"] == r["measured"] for r in v)
                  for k, v in rules.items()}

    # 반증 조건(스펙 §2-B): lookahead 를 끈 상태에서 B프레임이 구조적 지연을
    # 더하는가. 1차 측정의 조건(bf=3 이 0 보다 큰가)은 lookahead 를 분리하지
    # 못해 무효였다.
    passed = bframe_cost > 0
    note = (f"lookahead=0 에서 bf=0 은 {by[LA0_BF0]} 장, bf=3 은 {by[LA0_BF3]} 장 "
            f"-> B프레임만의 비용 {bframe_cost} 장. "
            f"{'통과: B프레임은 구조적 지연을 더한다' if passed else '반증: B프레임은 구조적 지연을 더하지 않는다'}")

    path = write_result("encoder", {
        "codec": CODEC, "width": W, "height": H, "fps": FPS, "frames_fed": N,
        "runs": runs,
        "isolated_costs_frames": costs,
        "dominant_cause": dominant,
        "rules": rules,
        "rules_hold": rules_hold,
        "refutation_2b": {"passed": passed, "note": note},
    })
    print(note)
    print(f"분리된 비용(프레임): {costs} -> 지배 원인: {dominant}")
    for name, holds in rules_hold.items():
        print(f"  규칙 {name}: {'성립' if holds else '깨짐 — 글에 규칙으로 쓰지 말 것'}")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
