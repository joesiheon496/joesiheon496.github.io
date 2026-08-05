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
    if not d.get("keeps_up", False):
        raise SystemExit("arrival.json 의 소비가 밀렸다. 지터가 아니라 백로그다 — 다시 재라.")

    nominal = d["nominal_interval_ms"]
    arrivals = np.array(d["arrival_ms"])
    idx = np.arange(len(arrivals))

    # 🚨 공칭 간격(1000/fps)으로 격자를 세우면 안 된다. 실측 평균 간격이 공칭과
    # 조금만 달라도 그 차이가 프레임마다 누적돼, 30 초 뒤에는 지터가 아니라
    # 드리프트를 재게 된다 — 처음에 그렇게 해서 편차 P99 가 1205 ms 로 나왔다.
    # 간격 P99 가 49.9 ms 인 스트림에서 나올 수 없는 값이다.
    #
    # 최소자승으로 실측 레이트를 추정해 격자를 세우고, 그 잔차를 지터로 본다.
    slope, intercept = np.polyfit(idx, arrivals, 1)
    offsets = arrivals - (slope * idx + intercept)
    offsets = offsets - offsets.min()
    measured_interval = float(slope)

    curve = []
    for b in np.arange(0.0, 8.0 * nominal + 1e-9, nominal / 8.0):
        curve.append({"buffer_ms": float(b), "added_latency_ms": float(b),
                      "loss_rate": float(np.mean(offsets > b))})
    ok = [c for c in curve if c["loss_rate"] <= 0.001]
    losses = [c["loss_rate"] for c in curve]
    path = write_result("jitter", {
        "source": "results/arrival.json 의 실측 도착 시각 + 계산 (최소자승 추세 제거)",
        "nominal_interval_ms": nominal,
        "measured_interval_ms": measured_interval,
        "n_samples": int(len(arrivals)),
        "offset_ms": {"p50": float(np.percentile(offsets, 50)),
                      "p99": float(np.percentile(offsets, 99)),
                      "max": float(offsets.max())},
        "curve": curve,
        "min_buffer_for_0p1pct_ms": ok[0]["buffer_ms"] if ok else None,
        "monotone": all(a >= b for a, b in zip(losses, losses[1:])),
        "is_simulation": True,
    })
    if ok:
        print(f"유실 0.1% 를 만족하는 최소 버퍼: {ok[0]['buffer_ms']:.1f} ms "
              f"({ok[0]['buffer_ms'] / nominal:.2f} 프레임)")
    else:
        print("0.1% 를 만족하는 버퍼가 범위(6 프레임) 안에 없다")
    print(f"편차 P99 {np.percentile(offsets, 99):.1f} ms · 최대 {offsets.max():.1f} ms")
    print(f"단조 감소: {all(a >= b for a, b in zip(losses, losses[1:]))}")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
