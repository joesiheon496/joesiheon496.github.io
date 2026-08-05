"""camera-latency 측정 스크립트가 공유하는 것들.

숫자의 출처를 한 곳으로 고정하기 위해, 모든 측정은 results/<name>.json 으로만
나간다. 글과 그림은 이 JSON 만 읽는다.
"""
import importlib.metadata
import json
import platform
import sys
from pathlib import Path

RESULTS = Path(__file__).parent / "results"

# (import 이름, 결과 키, 배포 이름). pyrealsense2 는 __version__ 을 노출하지 않으므로
# 배포 메타데이터로 내려가야 한다 — __version__ 만 보면 설치돼 있는데 "unavailable" 로
# 기록되고, 그건 조용히 틀린 환경 블록이다.
_PACKAGES = (
    ("cv2", "opencv", "opencv-contrib-python"),
    ("av", "pyav", "av"),
    ("numpy", "numpy", "numpy"),
    ("pyrealsense2", "pyrealsense2", "pyrealsense2"),
)


def env_block() -> dict:
    """숫자를 인용할 때 반드시 함께 적는 것."""
    env = {
        "os": platform.platform(),
        "python": sys.version.split()[0],
    }
    for mod, key, dist in _PACKAGES:
        try:
            __import__(mod)
        except Exception as exc:                      # 없으면 없다고 적는다
            env[key] = f"unavailable: {exc.__class__.__name__}"
            continue
        version = getattr(sys.modules[mod], "__version__", None)
        if version is None:
            try:
                version = importlib.metadata.version(dist)
            except importlib.metadata.PackageNotFoundError:
                version = "imported, version unknown"
        env[key] = version
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
