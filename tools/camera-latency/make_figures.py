"""results/*.json 만 읽어서 글의 그림을 만든다. 숫자를 여기에 손으로 쓰지 않는다.

세 장:
  latency-budget.png  (커버) 아홉 단계 중 잰 셋과 재지 않은 여섯
  encoder-delay.png          조건별 삼킨 프레임 수
  buffer-growth.png          경과 시간 대 누적 지연, 실측과 예측
"""
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

HERE = Path(__file__).parent
OUT = HERE.parent.parent / "content" / "posts" / "camera-latency"

MEASURED = "#2b6cb0"      # 이 글에서 실측
UNMEASURED = "#a0aec0"    # 재지 않음
ACCENT = "#e53e3e"
OK = "#38a169"
WARN = "#dd6b20"

plt.rcParams.update({
    "font.family": "Malgun Gothic",
    "axes.unicode_minus": False,
    "figure.dpi": 130,
    "savefig.bbox": "tight",
    "savefig.facecolor": "white",
    "axes.facecolor": "white",
    "figure.facecolor": "white",
    "axes.edgecolor": "#4a5568",
    "axes.labelcolor": "#1a202c",
    "text.color": "#1a202c",
    "xtick.color": "#4a5568",
    "ytick.color": "#4a5568",
    "axes.grid": True,
    "grid.color": "#e2e8f0",
    "grid.linewidth": 0.8,
})


def load(name):
    return json.loads((HERE / "results" / f"{name}.json").read_text(encoding="utf-8"))["data"]


def fig_budget():
    """아홉 단계. 잰 셋만 막대를 갖고, 나머지 여섯은 '재지 않음' 이라고 말한다.

    재지 않은 칸에 막대를 그리면 값을 아는 것처럼 보인다. 그래서 안 그린다 —
    이 그림의 논점이 바로 '아홉 중 셋만 쟀다' 이기 때문이다.
    """
    enc, buf, jit = load("encoder"), load("buffer"), load("jitter")
    fps = enc["fps"]
    frame_ms = 1000.0 / fps
    encode_ms = enc["isolated_costs_frames"]["lookahead"] * frame_ms
    jitter_ms = jit["min_buffer_for_0p1pct_ms"]
    queue_max = buf["pts_lag_ms"]["end"]

    rows = [
        ("노출", None), ("센서 리드아웃", None), ("ISP·포맷 변환", None),
        ("USB·MIPI 전송", None),
        ("인코딩", (encode_ms, encode_ms, f"{encode_ms:.0f} ms  (lookahead {enc['isolated_costs_frames']['lookahead']}프레임)")),
        ("네트워크", None),
        ("지터버퍼", (jitter_ms, jitter_ms, f"{jitter_ms:.0f} ms")),
        ("수신 큐", (1.0, queue_max, f"0 → {queue_max:,.0f} ms  (30초 만에)")),
        ("렌더·디스플레이", None),
    ]

    # 로그 눈금에서 막대는 길이가 값에 비례하지 않아 오해를 부른다.
    # 값 위치에 점을 찍고 축까지 선을 끄는 편이 정직하다.
    XMIN, XMAX = 1.0, 3.0e5
    fig, ax = plt.subplots(figsize=(10.0, 5.2))
    ys = range(len(rows))
    for y, (label, val) in zip(ys, rows):
        if val is None:
            ax.axhspan(y - 0.34, y + 0.34, color=UNMEASURED, alpha=0.13,
                       hatch="////", edgecolor=UNMEASURED, linewidth=0)
            ax.text(1.6, y, "재지 않음", va="center", ha="left",
                    fontsize=9.5, color="#718096", style="italic")
        else:
            lo, hi, note = val
            ax.plot([XMIN, hi], [y, y], color=MEASURED, linewidth=2.2,
                    alpha=0.35, zorder=2)
            if lo == hi:
                ax.plot([hi], [y], "o", color=MEASURED, markersize=9, zorder=3)
            else:                                   # 범위로 자라는 항목
                ax.plot([lo, hi], [y, y], color=MEASURED, linewidth=7,
                        solid_capstyle="round", zorder=3)
                ax.plot([hi], [y], "o", color=MEASURED, markersize=9, zorder=4)
            ax.text(hi * 1.5, y, note, va="center", ha="left",
                    fontsize=9.5, color=MEASURED, fontweight="bold")

    ax.set_yticks(list(ys))
    ax.set_yticklabels([r[0] for r in rows], fontsize=10.5)
    ax.invert_yaxis()
    ax.set_xscale("log")
    ax.set_xlim(XMIN, XMAX)
    ax.set_xticks([1, 10, 100, 1000, 10000])
    ax.set_xticklabels(["1 ms", "10 ms", "100 ms", "1 초", "10 초"])
    ax.set_xlabel("지연 (로그 눈금)", fontsize=10.5)
    ax.set_title(f"카메라 지연 예산 아홉 단계 — 이 글이 잰 것은 셋 ({fps} fps 기준)",
                 fontsize=12.5, fontweight="bold", pad=14)
    ax.grid(axis="y", visible=False)
    ax.legend(handles=[Patch(facecolor=MEASURED, label="이 글에서 실측"),
                       Patch(facecolor=UNMEASURED, alpha=0.3, hatch="////",
                             label="재지 않음 (문헌도 인용하지 않음)")],
              loc="lower center", bbox_to_anchor=(0.5, -0.30), ncol=2,
              fontsize=9.5, frameon=False)
    path = OUT / "latency-budget.png"
    fig.savefig(path)
    plt.close(fig)
    return path


def fig_encoder():
    """조건별로 첫 패킷 전에 삼킨 프레임 수. 원인이 색으로 갈린다."""
    enc = load("encoder")
    runs = enc["runs"]
    costs = enc["isolated_costs_frames"]

    def color_of(label):
        if "zerolatency" in label:
            return OK
        if label.startswith("대조군") or label.startswith("기본"):
            return ACCENT
        if "스레딩" in label:
            return WARN
        return MEASURED

    labels = [r["label"] for r in runs]
    values = [r["swallowed_frames"] for r in runs]
    colors = [color_of(l) for l in labels]

    fig, ax = plt.subplots(figsize=(9.5, 6.0))
    ys = range(len(runs))
    ax.barh(list(ys), values, color=colors, height=0.66)
    for y, v in zip(ys, values):
        ax.text(v + 0.6, y, str(v), va="center", fontsize=10, fontweight="bold",
                color="#1a202c")
    ax.set_yticks(list(ys))
    ax.set_yticklabels(labels, fontsize=10)
    ax.invert_yaxis()
    ax.set_xlim(0, max(values) * 1.28)
    ax.set_xlabel("첫 패킷이 나오기 전에 삼킨 프레임 수", fontsize=10.5)
    ax.set_title("인코더의 구조적 지연 — B프레임이 아니라 lookahead 다",
                 fontsize=12.5, fontweight="bold", pad=14)
    ax.grid(axis="y", visible=False)

    # Consolas 에는 한글이 없다. 등폭으로 맞추려다 라벨이 통째로 두부가 된다.
    ax.text(0.985, 0.035,
            f"삼키는 프레임 = 자기 파라미터\n"
            f"lookahead → min(gop, rc-lookahead) = {costs['lookahead']}\n"
            f"B프레임 → bf = {costs['bframes']}\n"
            f"프레임 스레딩 → threads = {costs['frame_threading']}",
            transform=ax.transAxes, ha="right", va="bottom", fontsize=9.5,
            linespacing=1.5,
            bbox=dict(boxstyle="round,pad=0.55", facecolor="#f7fafc",
                      edgecolor="#cbd5e0"))
    ax.legend(handles=[Patch(facecolor=OK, label="tune=zerolatency"),
                       Patch(facecolor=ACCENT, label="기본값 (lookahead 켜짐)"),
                       Patch(facecolor=MEASURED, label="lookahead 끔"),
                       Patch(facecolor=WARN, label="스레딩")],
              loc="center right", fontsize=9.5, framealpha=0.95)
    path = OUT / "encoder-delay.png"
    fig.savefig(path)
    plt.close(fig)
    return path


def fig_buffer():
    """늦게 읽으면 지연이 선형으로 자란다. 실측과 예측이 겹치는 것이 논점."""
    buf = load("buffer")
    trace = buf["trace"]
    growth = buf["lag_growth"]
    xs = [s["elapsed_s"] for s in trace]
    ys = [s["lag_ms"] for s in trace]
    rate = growth["predicted_ms_per_s"]

    fig, ax = plt.subplots(figsize=(9.5, 5.0))
    # 지연은 첫 표본을 0 으로 놓고 잰 값이라 절편이 아니라 '기울기' 를 비교한 것이다.
    # 예측선을 원점에서 그으면 상수만큼 어긋나 보여서, 두 값이 다른 것처럼 읽힌다.
    x0, y0 = xs[0], ys[0]
    ax.plot([x0, xs[-1]], [y0, y0 + rate * (xs[-1] - x0)], "--",
            color=ACCENT, linewidth=2.6,
            # U+2212 MINUS SIGN 은 Malgun Gothic 에 없다. ASCII 하이픈을 쓴다.
            label=f"예측 기울기  (30 - {growth['consume_fps']:.2f}) fps × 33.3 ms "
                  f"= {rate:.1f} ms/s")
    ax.plot(xs, ys, "o-", color=MEASURED, markersize=4.5, linewidth=1.8,
            label=f"실측 기울기  {growth['measured_ms_per_s']:.1f} ms/s")

    end = trace[-1]
    ax.annotate(f"{end['lag_ms']:,.0f} ms",
                xy=(end["elapsed_s"], end["lag_ms"]),
                xytext=(-14, 16), textcoords="offset points",
                fontsize=12, fontweight="bold", color=MEASURED, ha="right")
    ax.set_xlabel("경과 시간 (초)", fontsize=10.5)
    ax.set_ylabel("누적 지연 (ms)", fontsize=10.5)
    ax.set_title(f"30 fps 스트림을 {buf['consumer_target_fps']:.0f} fps 로 읽으면 "
                 "— 버려지지 않고 쌓인다",
                 fontsize=12.5, fontweight="bold", pad=14)
    ax.set_xlim(0, xs[-1] * 1.04)
    ax.set_ylim(0, max(ys) * 1.16)
    ax.legend(loc="upper left", fontsize=10, framealpha=0.95)
    ax.text(0.985, 0.06,
            f"프레임은 하나도 버려지지 않았다\n"
            f"드레인에서 {buf['phases']['drain']['frames_read']}장이 "
            f"{buf['phases']['drain']['seconds']*1000:.0f} ms 만에 쏟아짐",
            transform=ax.transAxes, ha="right", va="bottom", fontsize=9.5,
            bbox=dict(boxstyle="round,pad=0.5", facecolor="#f7fafc",
                      edgecolor="#cbd5e0"))
    path = OUT / "buffer-growth.png"
    fig.savefig(path)
    plt.close(fig)
    return path


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for fn in (fig_budget, fig_encoder, fig_buffer):
        print("wrote", fn())


if __name__ == "__main__":
    main()
