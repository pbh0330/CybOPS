# UI 2차 개편 (실지형 지리 뷰 + 관제 콘솔 밀도) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** tacnet-01 을 강원 인제 실지형 위에 얹어 MapLibre GL 로 그리고, 상황도 셸을 관제 콘솔 밀도(KPI 띠·이벤트 스트림·재생 컨트롤·브리핑 상시)로 바꾼다.

**Architecture:** 정본 좌표는 그대로 TACGRID-01 로컬 평면(m)이고 `georef.anchor` 만 인제로 옮긴다. `graph.geo.georef` 가 있으면 새 `MapPane`(MapLibre), 없으면 기존 `GeoPane`(geo.js) - 분기는 데이터 한 필드다. 새 파생값(이벤트 스트림, KPI, GeoJSON 레이어, 좌표 변환)은 전부 순수 함수로 두고 Vitest 로 검사한다. 엔진·replay 계약은 손대지 않는다.

**Tech Stack:** React 18, Vite 5, Cytoscape.js, **maplibre-gl 5**, milsymbol, **vitest 3**, `@fontsource/ibm-plex-sans-kr` + `@fontsource/ibm-plex-mono`, Python 3.12 + Pillow(DEM 샘플러), PowerShell 5.1 게이트.

**Spec:** `docs/superpowers/specs/2026-09-19-ui-real-terrain-console-design.md`

## Global Constraints

- 엔진은 geo 를 읽지 않는다. `scripts\Test-GeoInvariance.ps1` 이 매 태스크 끝에 PASS 여야 한다.
- 빨강(`#ff4d5e`)은 공격 전용. 크롬(상단바·레일·버튼·탭·시간축·패널)에 유채색 없음. 글로우·펄스는 원인색 8종에만.
- outage 의 `from/to/cause` 와 `edges`·`links` 는 바꾸지 않는다. `replay.json` 의 `steps[*].mission/asset/service/task` 는 재저작 전후 동일해야 한다.
- 지도 타일 URL 은 코드에 박지 않고 `config.json` 의 `map` 블록(ADR-0021 런타임 설정)에서 읽는다. 타일이 안 오면 지도는 빈 바탕 + 오버레이로 동작하고 다른 화면은 영향 없음.
- 지리 뷰 좌하단 워터마크 **"가상 훈련 시나리오 · 실제 부대 배치 아님"** 은 항상 보이고 끌 수 없다.
- CDN 폰트·스크립트 링크 없음. 폰트는 `@fontsource` 로 번들에 포함.
- PowerShell 5.1: 한글이 들어가는 `.ps1` 은 BOM, 변수 대소문자 충돌 금지. 이 계획이 새로 만드는 `.ps1` 은 `Test-UiUnit.ps1` 하나이고 ASCII 만 쓴다.
- Python 은 전체 경로로 부른다: `$py = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"`. Node 는 `%LOCALAPPDATA%\Programs\nodejs-portable\node-v24.20.0-win-x64` (PowerShell 에서는 PATH 에 있음).
- 커밋 메시지는 이 저장소 관례대로 한국어 한 줄 요약 + 본문, 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- `git commit` 은 `-m` 여러 개 대신 here-string 하나로. `&&` 는 PowerShell 5.1 에서 안 된다 - `;` 를 쓴다.

---

## 파일 구조

| 파일 | 역할 | 상태 |
|---|---|---|
| `docs/adr/0025-real-terrain-geo-and-console-density.md` | 결정 기록 3건 | 신규 |
| `scripts/check_geo_terrain.py` | DEM 샘플·고도 단면 보고 (exit 0, 게이트 아님) | 신규 |
| `scenarios/tacnet-01/mission.json` | `geo.georef.anchor`, `geo.safety`, `geo.terrain` 제거, 자산 좌표 | 수정 |
| `ui/public/data/tacnet-01.replay.json` | 재내보내기 | 재생성 |
| `ui/vitest.config.js`, `ui/src/__tests__/*.test.js` | 순수 함수 테스트 | 신규 |
| `ui/src/georef.js` | 로컬 평면 ↔ WGS84, UTM, MGRS | 신규 |
| `ui/src/derive.js` | `eventRows`, `kpiOf`, `timeLabel` 추가 | 수정 |
| `ui/src/mapLayers.js` | graph+step → GeoJSON (링크·궤적·공격 호·격자·AO·마커 위치) | 신규 |
| `ui/src/ui/MapPane.jsx` | MapLibre 패널 (바탕·지형·마커·오버레이·워터마크) | 신규 |
| `ui/src/ui/GeoPane.jsx` | 그대로 (georef 없는 시나리오용) | 유지 |
| `ui/src/App.jsx` | 분기, 배속, 스텝, 탭 목록 | 수정 |
| `ui/src/ui/Topbar.jsx` | KPI 띠 | 수정 |
| `ui/src/ui/Rail.jsx` | 브리핑 카드 상시, 이벤트 스트림, 탭 3개 | 수정 |
| `ui/src/ui/Timeline.jsx` | 재생 컨트롤 확장 | 수정 |
| `ui/src/graph.js`, `ui/src/ui/GraphCanvas.jsx` | 밀도·글로우·공격 파선 애니메이션·선택 흰 외곽 | 수정 |
| `ui/src/style.css`, `ui/src/styles/modules.css`, `ui/src/main.jsx` | 토큰·폰트·새 컴포넌트 CSS | 수정 |
| `ui/src/config.js`, `ui/public/config.json`, `ui/dist/config.hosted.example.json` | `map` 블록 | 수정 |
| `docs/17-geo-layer.md`, `docs/11-tactical-time-axis.md`, `docs/03-mission-ontology.md`, `docs/design/tokens.md`, `docs/design/decisions.md`, `CLAUDE.md`, `STATE.md` | 문서 | 수정 |

---

### Task 1: ADR-0025 와 docs/17 §4 폐기 표시

**Files:**
- Create: `docs/adr/0025-real-terrain-geo-and-console-density.md`
- Modify: `docs/17-geo-layer.md` §4, §4.1 (187~228행) 앞에 폐기 안내 블록 추가
- Modify: `CLAUDE.md` "미확정 사항" 표 아래 행 추가, 확정 결정 목록 11번 아래 12번 추가

**Interfaces:**
- Produces: 이후 태스크가 인용하는 ADR 번호 `ADR-0025`.

- [ ] **Step 1: ADR 작성**

```markdown
# ADR-0025. 지리 뷰를 실지형 위에 올린다 - 훈련장 위의 가상 시나리오, 지도 타일 예외, 저채도 바탕

**상태**: 채택 (2026-09-19)

ADR-0001(좌표계는 의존 그래프), ADR-0018(정적 번들), ADR-0024(무채색 크롬)를 **대체하지
않는다.** 셋 다 살아 있고 이 문서는 그 위에 예외 세 개를 얹는다.

## 맥락

D4D 쇼케이스 49개를 조사했다(`docs/superpowers/specs/2026-09-19-ui-real-terrain-console-design.md` 0절).
C2·COP 계열의 지리 뷰는 예외 없이 실지형·위성영상 위에 있었고, 우리 화면의 지리 뷰는 창작
등고선 위의 요도였다. 데모가 1순위(ADR-0014)인데 지리 뷰가 "가상 좌표" 고지문과 함께
빈 격자로 서 있는 것은 그 순위와 맞지 않았다.

docs/17 §4.1 은 "지도가 그럴듯해 보이게 하려는 압력이 안전성을 깎는 유일한 경로" 라고 썼고
그 압력을 차단했다. 이 ADR 은 바로 그 압력에 굴복하는 결정이다. 그래서 무엇을 내주고
무엇으로 대신 막는지를 적는다.

## 결정 1. tacnet-01 지리 뷰는 실지형·온라인 타일 위에 그린다

- 엔진: MapLibre GL JS. 바탕 벡터(OpenFreeMap dark), 위성(ESRI World Imagery),
  지형 DEM(AWS Terrain Tiles, Terrarium). 전부 키 없음.
- 분기 규칙: `graph.geo.georef` 가 있으면 MapLibre, 없으면 기존 로컬 평면 렌더러(geo.js).
  defnet-01 의 영내 배치도(docs/17 §10)는 georef 가 없으므로 그대로다.
- **ADR-0018 "CDN 미의존"의 예외는 지도 타일뿐이다.** 타일 URL 은 `config.json` 의 `map`
  블록에 있고(ADR-0021), 오프라인 배치는 이 블록을 로컬 타일 서버로 바꾸면 된다. 타일이
  안 오면 지도는 빈 바탕 + 오버레이로 동작하고 다른 화면은 영향이 없어야 한다.
- 정본 좌표는 여전히 로컬 평면이다. 자산에 위경도를 따로 넣지 않는다(docs/17 §2).

## 결정 2. 안전성 논거를 "가상 좌표"에서 "훈련장 위의 가상 시나리오"로 바꾼다

docs/17 §4 의 네 겹(임의 앵커·공해·일반명·창작 지형)은 이 결정으로 **폐기**된다. 대신:

1. **AO 는 공개된 훈련 지역이다.** 앵커(38.02 N, 128.08 E)는 강원 인제군 일대이며,
   과학화전투훈련단(KCTC) 훈련장이 있는 지역으로 위치가 공개돼 있다. 훈련장은 가상의
   전투를 벌이기 위해 존재하는 곳이고, 그 위의 가상 부대 배치는 실제 배치를 뜻하지 않는다.
2. **실제 부대·편성·시설을 참조하지 않았다.** 자산 좌표는 DEM 을 보고 서사(능선 중계소는
   능선, 계곡 진입은 계곡)에 맞게 저작한 값이다. 어떤 실제 배치도·시설 목록도 입력에 없다.
3. **화면 워터마크.** 지리 뷰 좌하단에 "가상 훈련 시나리오 · 실제 부대 배치 아님" 을 항상
   표시하고 끌 수 없게 한다. 스크린샷이 어디로 가든 이 문장이 같이 간다.
4. **site 라벨은 여전히 일반명이다.** 여단 TOC, 능선 중계소, 포병 FDC. 실제 지명은 지도
   타일이 그리는 것이지 우리 데이터가 말하는 것이 아니다.

`mission.json` 의 `geo.safety` 블록을 이 네 항목으로 다시 쓴다. `geo.terrain`(창작
능선·계곡)은 제거한다 - 실지형이 그 자리를 대신한다.

## 결정 3. ADR-0024 색 규칙의 소폭 개정

크롬은 여전히 무채색이다. 바꾸는 것은 **바탕 휘도**뿐이다: 흑연(`#23262A`)에서 저채도
네이비-블랙(`#0B0F17`)으로. OKLCH 채도 0.02 이하라 "무채색에 준함". 시안 강조색은 여전히
없고, 선택 하이라이트는 흰 외곽선이며, 글로우·펄스는 원인색 8종에만 쓴다.
저하도=휘도(ADR-0024 §2)는 그대로다. 토큰표는 `docs/design/tokens.md`.

## 하지 않는 것

- DEM 으로 가시선을 계산해 단절 원인에 넣지 않는다(ADR-0003 경계). `scripts/check_geo_terrain.py`
  는 고도 단면을 **보고만** 하고 exit 0 이다.
- Cesium. 오프라인 타일 패키징(필요해지면 `config.json` 의 `map` 을 바꾸는 일이다).
- defnet-01 지리 변경.

## 결과

- 검증: `Test-GeoInvariance.ps1`(앵커 이동 변이 포함) PASS, 재저작 전후 replay 저하도 동일.
- 문서: docs/17 §4·§4.1 폐기 표시, §9 는 georef 없는 시나리오 전용으로 한정.
```

- [ ] **Step 2: docs/17 §4 앞에 폐기 블록 추가**

`docs/17-geo-layer.md` 의 `## 4. 가상 좌표 안전성 - 어떻게 확보했는가` 행 바로 아래에 삽입:

```markdown
> **2026-09-19 폐기 (ADR-0025).** 이 절과 §4.1 의 논거는 tacnet-01 에 더 이상 적용되지 않는다.
> tacnet-01 은 강원 인제 일대 실지형 위에 올라갔고, 안전성은 "공개된 훈련장 위의 가상
> 시나리오 + 실제 배치 미참조 + 화면 워터마크" 로 확보한다. 아래 본문은 결정 당시의 논거로
> 남긴다. georef 가 없는 시나리오(defnet-01)에는 §10 이 그대로 적용된다.
```

`## 9. 지형면 - 저작 도형에서 만든 보간면` 행 바로 아래에 삽입:

```markdown
> **2026-09-19 (ADR-0025).** tacnet-01 의 `geo.terrain` 블록은 제거됐고 지리 뷰는 실제 DEM
> 위에 그린다. 이 절의 지형면은 `georef` 가 없는 시나리오에서만 쓰인다(현재 defnet-01 은
> terrain 블록이 없으므로 실제로 쓰는 시나리오는 없다). 코드(`terrain.js`)는 남긴다.
```

- [ ] **Step 3: CLAUDE.md 갱신**

확정 결정 목록의 11번 항목 아래에 추가:

```markdown
12. **tacnet-01 지리 뷰는 실지형(인제 일대) 위에 MapLibre 로 그린다.** 지도 타일만 ADR-0018
    의 CDN 예외이고 URL 은 `config.json` 의 `map` 블록에 있다. 워터마크 "가상 훈련 시나리오 ·
    실제 부대 배치 아님" 은 끌 수 없다. DEM 은 표시 전용이고 판단에 안 들어간다. (ADR-0025)
```

- [ ] **Step 4: 커밋**

```powershell
git add docs/adr/0025-real-terrain-geo-and-console-density.md docs/17-geo-layer.md CLAUDE.md
git commit -m @'
docs: ADR-0025 - 지리 뷰를 실지형 위에 올린다. docs/17 §4 의 안전성 논거를 폐기하고 무엇으로 대신 막는지 적는다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 2: DEM 샘플러 `check_geo_terrain.py`

**Files:**
- Create: `scripts/check_geo_terrain.py`

**Interfaces:**
- Produces: CLI. `--sample "x,y" ["x,y" ...]` 로컬 평면 좌표의 DEM 고도 출력. 인자 없이 실행하면 mission.json 의 자산·구간 z 를 DEM 과 대조하고 terrain 원인 링크의 고도 단면을 보고한다. 항상 exit 0.

- [ ] **Step 1: Pillow 확인**

```powershell
$py = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
& $py -c "import PIL; print(PIL.__version__)"
```
Expected: 버전 출력(12.x). `ModuleNotFoundError` 면 `& $py -m pip install pillow`.

- [ ] **Step 2: 스크립트 작성**

```python
"""DEM sampler and terrain profile REPORT for a georeferenced scenario.

This is not a gate. It prints, it exits 0. Outage causes are authored values
(ADR-0003) and nothing here changes them; the report exists so a human can see
whether the authored story (ridge relay, valley entry) sits on the real relief.

Tiles: AWS Terrain Tiles, Terrarium PNG (elevation = R*256 + G + B/256 - 32768).
Cached under %TEMP%\mccycop-dem so re-runs are offline.

Usage:
  python scripts/check_geo_terrain.py                         # report for tacnet-01
  python scripts/check_geo_terrain.py --scenario scenarios/tacnet-01/mission.json
  python scripts/check_geo_terrain.py --sample 5700,9600 4120,2140
"""
import argparse
import io
import json
import math
import os
import sys
import urllib.request

from PIL import Image

TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
ZOOM = 12
CACHE = os.path.join(os.environ.get("TEMP", "."), "mccycop-dem")
_tiles = {}


def _tile(z, x, y):
    key = (z, x, y)
    if key in _tiles:
        return _tiles[key]
    os.makedirs(CACHE, exist_ok=True)
    fn = os.path.join(CACHE, f"{z}_{x}_{y}.png")
    if not os.path.exists(fn):
        urllib.request.urlretrieve(TILE_URL.format(z=z, x=x, y=y), fn)
    im = Image.open(fn).convert("RGB")
    _tiles[key] = im
    return im


def elevation(lat, lon, z=ZOOM):
    n = 2 ** z
    xt = (lon + 180) / 360 * n
    lat_r = math.radians(lat)
    yt = (1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n
    xi, yi = int(xt), int(yt)
    im = _tile(z, xi, yi)
    px = min(255, int((xt - xi) * 256))
    py = min(255, int((yt - yi) * 256))
    r, g, b = im.getpixel((px, py))
    return r * 256 + g + b / 256 - 32768


class Georef:
    """The scenario's own formula (geo.georef.formula), nothing else."""

    def __init__(self, georef):
        a = georef["anchor"]
        self.lat0, self.lon0 = float(a["lat"]), float(a["lon"])
        self.x0, self.y0 = float(a.get("x", 0)), float(a.get("y", 0))
        self.k = 111320 * math.cos(math.radians(self.lat0))

    def to_ll(self, x, y):
        return self.lat0 + (y - self.y0) / 111320, self.lon0 + (x - self.x0) / self.k


def position_at(asset, t):
    g = asset.get("geo") or {}
    if g.get("kind") == "fixed" or not g.get("segments"):
        return g.get("at")
    for s in g["segments"]:
        if s["from"] <= t < s["to"]:
            if s.get("mode") == "move" and s.get("to_at"):
                u = (t - s["from"]) / (s["to"] - s["from"]) if s["to"] > s["from"] else 0
                a, b = s["at"], s["to_at"]
                return {k: a[k] + (b[k] - a[k]) * u for k in ("x", "y", "z")}
            return s["at"]
    return None


def report(scenario_path):
    m = json.load(open(scenario_path, encoding="utf-8"))
    georef = (m.get("geo") or {}).get("georef")
    if not georef:
        print("no geo.georef in this scenario - nothing to sample")
        return
    gr = Georef(georef)
    assets = {a["id"]: a for a in m["assets"]}

    print(f"== asset z vs DEM  (anchor {gr.lat0}, {gr.lon0})")
    for a in m["assets"]:
        g = a.get("geo") or {}
        pts = [("at", g["at"])] if g.get("at") else []
        for s in g.get("segments", []):
            pts.append((f"{s['from']}-{s['to']} at", s["at"]))
            if s.get("to_at"):
                pts.append((f"{s['from']}-{s['to']} to", s["to_at"]))
        for label, p in pts:
            lat, lon = gr.to_ll(p["x"], p["y"])
            dem = elevation(lat, lon)
            flag = "" if abs(dem - p.get("z", 0)) <= 15 else "   <-- differs from DEM by >15 m"
            print(f"  {a['id']:9s} {label:14s} x={p['x']:6.0f} y={p['y']:6.0f} z={p.get('z', 0):5.0f}  dem={dem:6.0f}{flag}")

    print("\n== terrain-caused link outages: elevation profile at the outage midpoint")
    for l in m.get("links", []):
        for o in l.get("outages", []):
            if o.get("cause") != "terrain":
                continue
            t = (o["from"] + o["to"]) / 2
            pa, pb = position_at(assets[l["a"]], t), position_at(assets[l["b"]], t)
            if not pa or not pb:
                print(f"  {l['id']}: endpoint position undefined at t={t}")
                continue
            n = 40
            ha, hb = pa["z"] + 2, pb["z"] + 2
            blocked = 0
            worst = 0.0
            for i in range(1, n):
                u = i / n
                x, y = pa["x"] + (pb["x"] - pa["x"]) * u, pa["y"] + (pb["y"] - pa["y"]) * u
                lat, lon = gr.to_ll(x, y)
                ground = elevation(lat, lon)
                los = ha + (hb - ha) * u
                if ground > los:
                    blocked += 1
                    worst = max(worst, ground - los)
            verdict = "shadowed" if blocked else "clear"
            print(f"  {l['id']:10s} t={t:5.1f} {l['a']}({pa['z']:.0f} m) -> {l['b']}({pb['z']:.0f} m): "
                  f"{verdict}, {blocked}/{n - 1} samples above LOS, max {worst:.0f} m   [authored: {o.get('note', '')}]")
    print("\nreport only - causes are authored, this changes nothing (ADR-0003).")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", default=os.path.join(os.path.dirname(__file__), "..", "scenarios", "tacnet-01", "mission.json"))
    ap.add_argument("--sample", nargs="*", help='local-plane points "x,y"')
    args = ap.parse_args()
    if args.sample:
        m = json.load(open(args.scenario, encoding="utf-8"))
        gr = Georef(m["geo"]["georef"])
        for s in args.sample:
            x, y = (float(v) for v in s.split(","))
            lat, lon = gr.to_ll(x, y)
            print(f"x={x:.0f} y={y:.0f}  lat={lat:.5f} lon={lon:.5f}  z={elevation(lat, lon):.0f}")
        return
    report(args.scenario)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
```

- [ ] **Step 3: 현재(옛 앵커) 시나리오로 실행해 동작 확인**

```powershell
& $py scripts\check_geo_terrain.py --sample 0,0 24000,18000
```
Expected: 두 줄, `lat=36.45 lon=128.5 z=...` 형태. 네트워크 오류면 타일 URL 을 브라우저로 열어 확인.

- [ ] **Step 4: 커밋**

```powershell
git add scripts/check_geo_terrain.py
git commit -m @'
scripts: DEM 샘플러와 지형 단면 보고. 게이트가 아니라 보고다 - 원인은 저작값이고 여기서 바꾸지 않는다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 3: tacnet-01 좌표 재저작 (인제 앵커, DEM z, terrain 제거, safety 재작성)

**Files:**
- Modify: `scenarios/tacnet-01/mission.json` - `geo.georef.anchor`, `geo.safety`, `geo.terrain`(삭제), 루트 `geo.dem_source` 추가, 13개 자산의 `geo`
- Regenerate: `ui/public/data/tacnet-01.replay.json`

**Interfaces:**
- Produces: `graph.geo.georef.anchor = {x:0, y:0, lat:38.02, lon:128.08}` - Task 5·7 이 이 값을 읽는다.

**주의**: `mission.json` 은 손으로 정렬된 파일이다(빈 줄, 한 줄 배열). `json.dump` 로 통째로 다시 쓰지 않는다. Edit 로 해당 블록만 바꾼다.

- [ ] **Step 1: 재저작 전 기준값 저장**

```powershell
Copy-Item ui\public\data\tacnet-01.replay.json $env:TEMP\tacnet-before.replay.json
```

- [ ] **Step 2: `geo.georef.anchor` 변경**

`"anchor": {` 블록의 `"lat": 36.45, "lon": 128.5` 를 `"lat": 38.02, "lon": 128.08` 로. `approximation_note` 의 수치는 그대로(위도 38 에서 cos 고정 오차는 여전히 100 m 안쪽).

- [ ] **Step 3: `geo.safety` 블록 교체**

기존 `"safety": { ... }` 전체를 다음으로:

```json
  "safety": {
   "claim": "공개된 훈련 지역 실지형 위의 가상 훈련 시나리오다. 실제 부대 배치·편성·시설을 참조하지 않았다.",
   "how": [
    "앵커(위도 38.02, 경도 128.08)는 강원 인제군 일대다. 과학화전투훈련단(KCTC) 훈련장이 있는 지역으로 위치가 공개돼 있다. 훈련장은 가상의 전투를 벌이기 위한 곳이고, 그 위의 가상 부대 배치는 실제 배치를 뜻하지 않는다.",
    "자산 좌표는 DEM(AWS Terrain Tiles)을 보고 서사에 맞게 저작한 값이다 - 능선 중계소는 능선에, 계곡 진입 구간은 계곡에. 어떤 실제 배치도·시설 목록도 입력에 없다.",
    "site 라벨(여단 TOC, 능선 중계소 등)과 부대 이름(여단·대대·중대)은 전부 일반명이다. 실제 지명은 지도 타일이 그리는 것이지 이 데이터가 말하는 것이 아니다.",
    "지리 뷰 좌하단에 '가상 훈련 시나리오 · 실제 부대 배치 아님' 워터마크를 항상 표시하고 끌 수 없게 한다."
   ],
   "basemap_policy": "실지형·위성 타일을 이 좌표에 깐다(ADR-0025). 타일 URL 은 config.json 의 map 블록에 있고 오프라인 배치는 그것을 로컬 타일로 바꾼다. 워터마크는 코드에서 끌 수 없다.",
   "superseded": "2026-09-19 이전의 '가상 좌표' 논거는 docs/17 §4 에 기록으로 남아 있고 ADR-0025 가 폐기했다."
  },
  "dem_source": "aws-terrain-tiles (Terrarium, z12). 표시 전용. 판단 로직은 읽지 않는다.",
```

- [ ] **Step 4: `geo.terrain` 블록 삭제**

`"terrain": {` 부터 그 짝이 되는 `}` 까지(`_note`, `_authored`, `field`, `features`, `spots` 전부) 삭제. 앞 항목 뒤의 쉼표가 남지 않게 한다. `position_rule` 은 남긴다.

- [ ] **Step 5: 자산 좌표 교체**

각 자산의 `"geo": {...}` 를 아래로 교체. `source` 는 `"authored-on-dem"`, `accuracy_m` 은 30. z 는 Task 2 의 샘플러로 뽑은 값(±5 m 는 무시).

```json
TOC-ESX   "geo": {"kind": "fixed", "frame": "TACGRID-01", "source": "authored-on-dem", "accuracy_m": 30, "at": {"x": 4120, "y": 2140, "z": 189}}
TOC-SRV   "geo": {"kind": "fixed", "frame": "TACGRID-01", "source": "authored-on-dem", "accuracy_m": 30, "at": {"x": 4145, "y": 2132, "z": 185}}
TOC-WS    "geo": {"kind": "fixed", "frame": "TACGRID-01", "source": "authored-on-dem", "accuracy_m": 30, "at": {"x": 4102, "y": 2111, "z": 182}}
BFT-GW    "geo": {"kind": "fixed", "frame": "TACGRID-01", "source": "authored-on-dem", "accuracy_m": 30, "at": {"x": 4161, "y": 2158, "z": 182}}
FDC-SRV   "geo": {"kind": "fixed", "frame": "TACGRID-01", "source": "authored-on-dem", "accuracy_m": 30, "at": {"x": 7480, "y": 6040, "z": 319}}
FDC-TERM  "geo": {"kind": "fixed", "frame": "TACGRID-01", "source": "authored-on-dem", "accuracy_m": 30, "at": {"x": 7456, "y": 6018, "z": 308}}
RELAY-1   "geo": {"kind": "fixed", "frame": "TACGRID-01", "source": "authored-on-dem", "accuracy_m": 30, "at": {"x": 5700, "y": 9600, "z": 938}}
```

track 자산 (segments 의 `from/to/mode/note` 는 **그대로**, `at`/`to_at` 만 교체):

```
BN-SRV    0-95 hold  at (8800, 8500, 196)
          95-125 move at (8800, 8500, 196) -> to_at (13500, 11700, 538)
          125-420 hold at (13500, 11700, 538)
BN-CP     같은 세 구간, x-18 y+12 (8782,8512,196) -> (13482,11712,538)
SAT-TERM  같은 세 구간, x+22 y-9  (8822,8491,196) -> (13522,11691,538)
CO1-VEH   0-90 hold (6600, 7200, 482)
          90-150 move (6600,7200,482) -> (10800, 9500, 208)
          150-195 move (10800,9500,208) -> (16300, 12800, 267)   note 그대로("... 사각지대 통과 ..." 의 TF-RIDGE-A 는 "동쪽 능선 후사면" 으로 고친다)
          195-260 move (16300,12800,267) -> (15700, 14500, 256)
          260-420 hold (15700, 14500, 256)
CO2-VEH   0-100 hold (5600, 6300, 327)
          100-205 move (5600,6300,327) -> (11300, 11000, 218)
          205-235 move (11300,11000,218) -> (13100, 12500, 232)
          235-420 hold (13100, 12500, 232)
FO-TAB    0-120 hold (4500, 2900, 244)
          120-180 move (4500,2900,244) -> (9500, 9000, 203)
          180-255 move (9500,9000,203) -> (15400, 12100, 319)
          255-275 move (15400,12100,319) -> (16300, 12800, 267)   note 의 TF-VALLEY-B 는 "동쪽 계곡" 으로
          275-330 move (16300,12800,267) -> (17800, 14700, 909)
          330-420 hold (17800, 14700, 909)
```

배치 논리(검토용): 여단 TOC 는 남서 저지대(인제읍 남쪽), 포병 FDC 중간 고도, 대대 1차 지휘소는 원통 계곡 바닥, 2차는 북동 고지 능선의 538 m 봉, 능선 중계소는 서쪽 938 m 봉(계곡 전체를 내려다봄), 중대·관측반은 계곡을 따라 북동으로 이동해 동쪽 능선(965 m 선)을 넘어 동쪽 계곡(267 m)으로 들어간다 - 서쪽 중계소에서 보면 능선 뒤라 차폐가 서사와 맞는다.

- [ ] **Step 6: z 대조와 단면 보고**

```powershell
& $py scripts\check_geo_terrain.py
```
Expected: `differs from DEM by >15 m` 표시가 0건. terrain 링크 2건(`L-VHF-CO1`, `L-VHF-FO`)이 `shadowed`. `clear` 가 나오면 계곡 쪽 좌표를 `--sample` 로 더 낮은 점을 찾아 조정한다(원인은 안 바꾼다).

- [ ] **Step 7: 온톨로지·지오 불변 게이트**

```powershell
.\scripts\Test-Ontology.ps1
.\scripts\Test-GeoInvariance.ps1
```
Expected: `ERRORS 0 / WARNINGS 0`, geo invariance `PASS` (mutation 5 self-test 는 원래 FAIL 로 표시되는 것이 정상 - 스크립트 요약이 PASS 면 된다).

- [ ] **Step 8: 재내보내기와 저하도 동일성 확인**

```powershell
.\scripts\Export-ReplayData.ps1
& $py - @'
import json
a=json.load(open(r'%TEMP%\tacnet-before.replay.json'.replace('%TEMP%',__import__('os').environ['TEMP']),encoding='utf-8'))
b=json.load(open('ui/public/data/tacnet-01.replay.json',encoding='utf-8'))
keys=['mission','asset','service','task','compromise','asset_outage','link_outage','active_phases','whatif']
bad=[(i,k) for i,(x,y) in enumerate(zip(a['steps'],b['steps'])) for k in keys if x.get(k)!=y.get(k)]
print('steps',len(a['steps']),len(b['steps']),'diffs',bad[:5])
print('terrain removed:', 'terrain' not in b['graph']['geo'], 'anchor', b['graph']['geo']['georef']['anchor'])
'@
```
Expected: `diffs []`, `terrain removed: True anchor {'x': 0, 'y': 0, 'lat': 38.02, 'lon': 128.08}`.

- [ ] **Step 9: 커밋**

```powershell
git add scenarios/tacnet-01/mission.json ui/public/data/tacnet-01.replay.json
git commit -m @'
data: tacnet-01 을 인제 실지형 위로 옮긴다. 앵커 38.02N 128.08E, z 는 DEM, 창작 지형 블록 제거. 저하도 수치는 한 셀도 안 바뀌었다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 4: Vitest 도입 + `georef.js` (로컬 평면 ↔ WGS84, MGRS)

**Files:**
- Modify: `ui/package.json` (devDependencies `vitest`, script `test`)
- Create: `ui/vitest.config.js`
- Create: `ui/src/georef.js`
- Create: `ui/src/__tests__/georef.test.js`

**Interfaces:**
- Produces:
  - `toLonLat(georef, x, y) -> [lon, lat]`
  - `fromLonLat(georef, lon, lat) -> { x, y }`
  - `toUtm(lat, lon) -> { zone, easting, northing }`
  - `toMgrs(lat, lon, precision = 5) -> string` (precision = 축당 자릿수; 5 = 1 m, 2 = 1 km)

- [ ] **Step 1: vitest 설치**

```powershell
Set-Location ui
npm i -D vitest@^3
```
`package.json` 의 `scripts` 에 `"test": "vitest run"` 추가.

`ui/vitest.config.js`:
```js
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.js'] } })
```

- [ ] **Step 2: 실패하는 테스트 작성**

`ui/src/__tests__/georef.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { toLonLat, fromLonLat, toMgrs } from '../georef.js'

const georef = { anchor: { x: 0, y: 0, lat: 38.02, lon: 128.08 } }

describe('local plane <-> WGS84', () => {
  it('anchor maps to itself', () => {
    expect(toLonLat(georef, 0, 0)).toEqual([128.08, 38.02])
  })
  it('round trips within 1 m across the AO', () => {
    for (const [x, y] of [[0, 0], [24000, 18000], [5700, 9600], [13500, 11700]]) {
      const [lon, lat] = toLonLat(georef, x, y)
      const back = fromLonLat(georef, lon, lat)
      expect(Math.abs(back.x - x)).toBeLessThan(1)
      expect(Math.abs(back.y - y)).toBeLessThan(1)
    }
  })
  it('uses the scenario formula: y/111320 north, x/(111320 cos lat0) east', () => {
    const [lon, lat] = toLonLat(georef, 1000, 1000)
    expect(lat).toBeCloseTo(38.02 + 1000 / 111320, 6)
    expect(lon).toBeCloseTo(128.08 + 1000 / (111320 * Math.cos(38.02 * Math.PI / 180)), 6)
  })
})

describe('MGRS (reference values from python mgrs 1.5)', () => {
  it.each([
    [38.02, 128.08, '52SDH1924708433'],
    [38.123, 128.211, '52SDH3084319756'],
    [38.18, 128.35, '52SDH4307125986'],
    [36.45, 128.5, '52SDF5519333978'],
  ])('%f,%f -> %s', (lat, lon, want) => {
    expect(toMgrs(lat, lon, 5)).toBe(want)
  })
  it('truncates to the requested precision', () => {
    expect(toMgrs(38.02, 128.08, 2)).toBe('52SDH1908')
  })
})
```

- [ ] **Step 3: 실패 확인**

```powershell
npm test
```
Expected: FAIL - `Cannot find module '../georef.js'`.

- [ ] **Step 4: 구현**

`ui/src/georef.js`:
```js
// Local plane <-> WGS84 <-> MGRS. Display only (docs/17 §2, ADR-0025): the
// engine reads none of this and the scenario stores only the local plane.
//
// The plane->WGS84 step is the scenario's own formula (geo.georef.formula),
// repeated here rather than read from the JSON so a scenario cannot ship a
// formula the UI does not implement. The UTM step is the classic USGS series
// (Snyder 1987), good to about a metre - far inside the ~90 m the anchor's
// fixed-cosine approximation already accepts.

export function toLonLat(georef, x, y) {
  const a = georef.anchor
  const lat = a.lat + (y - (a.y || 0)) / 111320
  const lon = a.lon + (x - (a.x || 0)) / (111320 * Math.cos(a.lat * Math.PI / 180))
  return [lon, lat]
}

export function fromLonLat(georef, lon, lat) {
  const a = georef.anchor
  return {
    x: (a.x || 0) + (lon - a.lon) * 111320 * Math.cos(a.lat * Math.PI / 180),
    y: (a.y || 0) + (lat - a.lat) * 111320,
  }
}

const A = 6378137
const F = 1 / 298.257223563
const K0 = 0.9996
const E2 = F * (2 - F)
const EP2 = E2 / (1 - E2)

export function toUtm(lat, lon) {
  const zone = Math.floor((lon + 180) / 6) + 1
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180
  const phi = lat * Math.PI / 180
  const lam = lon * Math.PI / 180
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi)
  const N = A / Math.sqrt(1 - E2 * sin * sin)
  const T = tan * tan
  const C = EP2 * cos * cos
  const Aa = cos * (lam - lon0)
  const M = A * ((1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256) * phi
    - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * E2 * E2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * E2 ** 3 / 3072) * Math.sin(6 * phi))
  const easting = K0 * N * (Aa + (1 - T + C) * Aa ** 3 / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5 / 120) + 500000
  let northing = K0 * (M + N * tan * (Aa * Aa / 2 + (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6 / 720))
  if (lat < 0) northing += 10000000
  return { zone, easting, northing }
}

const BANDS = 'CDEFGHJKLMNPQRSTUVWX'
const COLS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const ROWS = 'ABCDEFGHJKLMNPQRSTUV'

// precision = digits per axis: 5 is one metre, 2 is one kilometre
export function toMgrs(lat, lon, precision = 5) {
  const { zone, easting, northing } = toUtm(lat, lon)
  const band = BANDS[Math.min(19, Math.max(0, Math.floor((lat + 80) / 8)))]
  const colSet = (zone - 1) % 3
  const col = COLS[(colSet * 8 + Math.floor(easting / 100000) - 1) % 24]
  const rowOff = zone % 2 === 0 ? 5 : 0
  const row = ROWS[(Math.floor(northing / 100000) + rowOff) % 20]
  const e = String(Math.floor(easting % 100000)).padStart(5, '0').slice(0, precision)
  const n = String(Math.floor(northing % 100000)).padStart(5, '0').slice(0, precision)
  return `${zone}${band}${col}${row}${e}${n}`
}
```

- [ ] **Step 5: 통과 확인**

```powershell
npm test
```
Expected: 7 passed.

- [ ] **Step 6: 커밋**

```powershell
Set-Location ..
git add ui/package.json ui/package-lock.json ui/vitest.config.js ui/src/georef.js ui/src/__tests__/georef.test.js
git commit -m @'
ui: 로컬 평면↔WGS84↔MGRS 변환을 순수 함수로, Vitest 로 파이썬 mgrs 기준값과 대조

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 5: `eventRows` · `kpiOf` · `timeLabel` (derive.js) + 테스트

**Files:**
- Modify: `ui/src/derive.js` (끝에 추가)
- Create: `ui/src/__tests__/derive.test.js`

**Interfaces:**
- Produces:
  - `timeLabel(graph, t) -> string` (`'11:00'` 또는 `'+300분'`)
  - `eventRows(graph, payload) -> [{ t, time, kind, cause, text, stepIdx, id }]`, kind ∈ `'attack'|'outage'|'restore'|'phase'|'move'`, t 오름차순
  - `kpiOf(graph, step) -> { missions:[{id,name,priority,total,active}], compromised:{n,total}, cuts:{n, byCause:{[cause]:n}}, band:{level:0|1|2|3,label} }`
  - `BAND_LABELS = ['정상','주의','경계','심각']`
- Consumes: `assetName`, `linkName`, `techniqueKo` from `labels.js`; `num` from derive.js.

- [ ] **Step 1: 실패하는 테스트 작성**

`ui/src/__tests__/derive.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { eventRows, kpiOf, timeLabel, BAND_LABELS } from '../derive.js'

const graph = {
  timeline: { t0_iso: '2026-09-10T06:00:00+09:00', horizon: 420, step: 15 },
  units: [{ id: 'U-1BN', name: '1대대' }],
  missions: [{ id: 'M-C2', name: '지휘통제', priority: 1 }, { id: 'M-FIRE', name: '화력지원', priority: 2 }],
  phases: [{ id: 'PH-1', mission: 'M-C2', name: '집결·준비' }, { id: 'PH-2', mission: 'M-C2', name: '기동' }],
  assets: [
    { id: 'BN-SRV', type: 'c2-server', unit: 'U-1BN', site: '대대 지휘소',
      geo: { kind: 'track', segments: [
        { from: 0, to: 95, mode: 'hold', at: { x: 0, y: 0, z: 0 } },
        { from: 95, to: 125, mode: 'move', at: { x: 0, y: 0, z: 0 }, to_at: { x: 1, y: 1, z: 1 } },
        { from: 125, to: 420, mode: 'hold', at: { x: 1, y: 1, z: 1 } } ] } },
    { id: 'CO2-VEH', type: 'c2-terminal', unit: 'U-1BN', site: '2중대 지휘차', geo: { kind: 'fixed', at: { x: 0, y: 0, z: 0 } } },
  ],
  links: [{ id: 'L-SAT-TOC', a: 'BN-SRV', b: 'CO2-VEH', bearer: 'satcom' }],
}

const steps = [
  { t: 0, active_phases: ['PH-1'], compromise: {}, link_outage: { 'L-SAT-TOC': null }, asset_outage: {} },
  { t: 90, active_phases: ['PH-2'], compromise: {}, link_outage: { 'L-SAT-TOC': null }, asset_outage: {} },
  { t: 300, label: 'BN-SRV 장악', gt: [{ technique: 'T1078.002' }], compromise: { BN-SRV: 1 },
    link_outage: { 'L-SAT-TOC': 'unknown' }, asset_outage: {} },
  { t: 345, active_phases: ['PH-2'], compromise: { BN-SRV: 1 }, link_outage: { 'L-SAT-TOC': null }, asset_outage: {} },
]
const payload = { steps }

describe('timeLabel', () => {
  it('formats wall clock from t0', () => expect(timeLabel(graph, 300)).toBe('11:00'))
  it('falls back to offset without t0', () => expect(timeLabel({}, 300)).toBe('+300분'))
})

describe('eventRows', () => {
  const rows = eventRows(graph, payload)
  it('is sorted by t', () => {
    const ts = rows.map((r) => r.t)
    expect(ts).toEqual([...ts].sort((a, b) => a - b))
  })
  it('emits a phase change, an attack, an outage, a restore and two moves', () => {
    const kinds = rows.map((r) => r.kind)
    expect(kinds.filter((k) => k === 'phase').length).toBe(2)    // PH-1 at t=0, PH-2 at t=90
    expect(kinds.filter((k) => k === 'attack').length).toBe(1)
    expect(kinds.filter((k) => k === 'outage').length).toBe(1)
    expect(kinds.filter((k) => k === 'restore').length).toBe(1)
    expect(kinds.filter((k) => k === 'move').length).toBe(2)     // start 95, arrive 125
  })
  it('names things in Korean and carries the cause', () => {
    const out = rows.find((r) => r.kind === 'outage')
    expect(out.cause).toBe('unknown')
    expect(out.text).toContain('단절')
    const atk = rows.find((r) => r.kind === 'attack')
    expect(atk.cause).toBe('attack')
    expect(atk.text).toContain('대대 지휘소')
  })
  it('points each row at the last step at or before its t', () => {
    const move = rows.find((r) => r.kind === 'move' && r.t === 95)
    expect(move.stepIdx).toBe(1)                                  // t=90 is the last step <= 95
    expect(rows.find((r) => r.kind === 'restore').stepIdx).toBe(3)
  })
})

describe('kpiOf', () => {
  it('counts compromised assets and cut links by cause, and bands the worst mission', () => {
    const k = kpiOf(graph, { ...steps[2], mission: { 'M-C2': 0.72, 'M-FIRE': 0 }, mission_active: { 'M-C2': true, 'M-FIRE': true } })
    expect(k.compromised).toEqual({ n: 1, total: 2 })
    expect(k.cuts).toEqual({ n: 1, byCause: { unknown: 1 } })
    expect(k.band).toEqual({ level: 3, label: '심각' })
    expect(k.missions[0]).toMatchObject({ id: 'M-C2', total: 0.72, active: true })
  })
  it('bands 0 / <0.3 / <0.7 / >=0.7', () => {
    const at = (v) => kpiOf(graph, { mission: { 'M-C2': v }, compromise: {}, link_outage: {} }).band.level
    expect([at(0), at(0.1), at(0.5), at(0.7)]).toEqual([0, 1, 2, 3])
    expect(BAND_LABELS).toEqual(['정상', '주의', '경계', '심각'])
  })
})
```

- [ ] **Step 2: 실패 확인**

```powershell
Set-Location ui; npm test
```
Expected: FAIL - `eventRows is not a function` 류.

- [ ] **Step 3: 구현 (derive.js 끝에 추가)**

```js
import { techniqueKo } from './labels.js'   // 파일 상단 import 줄에 추가 (assetName, linkName 옆)

const CAUSE_KO_ROW = { attack: '공격', mobility: '기동', terrain: '지형', maintenance: '정비', unknown: '미상' }

// Wall clock for an offset in minutes, or the offset itself when the
// scenario has no t0 (defnet-01's chain clock).
export function timeLabel(graph, t) {
  const t0 = graph?.timeline?.t0_iso
  if (!t0) return `+${t}분`
  const d = new Date(new Date(t0).getTime() + Number(t) * 60000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// The replay read as a log. Every row is a change between two consecutive
// exported steps (or a segment boundary in the authored track), so nothing
// here is inferred: it is the same data the timeline ribbon draws, in prose.
// Rows point at the last step at or before their t so a click lands on the
// picture that already shows the change.
export function eventRows(graph, payload) {
  const steps = payload?.steps || []
  if (!steps.length) return []
  const rows = []
  const stepAt = (t) => {
    let idx = 0
    steps.forEach((s, i) => { if (num(s.t) <= t) idx = i })
    return idx
  }
  const push = (t, kind, cause, text, id) => rows.push({ t, time: timeLabel(graph, t), kind, cause, text, id, stepIdx: stepAt(t) })
  const phaseName = (id) => (graph?.phases || []).find((p) => p.id === id)?.name || id

  let prev = { compromise: {}, link_outage: {}, asset_outage: {}, active_phases: [] }
  for (const s of steps) {
    const t = num(s.t)
    const gts = Array.isArray(s.gt) ? s.gt : (s.gt ? [s.gt] : [])
    const tech = gts.length ? gts[gts.length - 1].technique : null
    for (const [id, v] of Object.entries(s.compromise || {})) {
      if (num(v) > 0 && !(num(prev.compromise?.[id]) > 0)) {
        const ko = techniqueKo(tech)
        push(t, 'attack', 'attack', `${assetName(graph, id).ko} 침해${ko ? ` · ${ko}` : ''}${s.label ? ` (${s.label})` : ''}`, id)
      }
    }
    for (const l of graph?.links || []) {
      const now = (s.link_outage || {})[l.id] || null
      const was = (prev.link_outage || {})[l.id] || null
      if (now && !was) push(t, 'outage', now, `${linkName(graph, l)} 단절 · ${CAUSE_KO_ROW[now] || now}`, l.id)
      if (!now && was) push(t, 'restore', was, `${linkName(graph, l)} 복구`, l.id)
    }
    for (const a of graph?.assets || []) {
      const now = (s.asset_outage || {})[a.id] || null
      const was = (prev.asset_outage || {})[a.id] || null
      if (now && !was) push(t, 'outage', now, `${assetName(graph, a.id).ko} 단절 · ${CAUSE_KO_ROW[now] || now}`, a.id)
      if (!now && was) push(t, 'restore', was, `${assetName(graph, a.id).ko} 복구`, a.id)
    }
    const wasPh = new Set(prev.active_phases || [])
    for (const ph of s.active_phases || []) {
      if (!wasPh.has(ph)) push(t, 'phase', null, `${phaseName(ph)} 단계 시작`, ph)
    }
    prev = { ...prev, ...s, compromise: s.compromise || prev.compromise, link_outage: s.link_outage || {}, asset_outage: s.asset_outage || {}, active_phases: s.active_phases || prev.active_phases }
  }
  for (const a of graph?.assets || []) {
    for (const seg of a.geo?.segments || []) {
      if (seg.mode !== 'move') continue
      const name = assetName(graph, a.id).ko
      push(num(seg.from), 'move', null, `${name} 이동 시작${seg.note ? ` · ${seg.note}` : ''}`, a.id)
      push(num(seg.to), 'move', null, `${name} 이동 완료`, a.id)
    }
  }
  const order = { phase: 0, move: 1, outage: 2, restore: 3, attack: 4 }
  rows.sort((a, b) => (a.t - b.t) || (order[a.kind] - order[b.kind]))
  return rows
}

export const BAND_LABELS = ['정상', '주의', '경계', '심각']

// Headline numbers for the top strip. The band is a fixed rule over the worst
// active mission value - a threshold, not a judgement, and not a doctrinal
// term (ADR-0003).
export function kpiOf(graph, s) {
  const missions = (graph?.missions || []).slice().sort((a, b) => (a.priority || 9) - (b.priority || 9))
    .map((m) => ({ id: m.id, name: m.name, priority: m.priority, total: num(s?.mission?.[m.id]),
      active: s?.mission_active ? s.mission_active[m.id] !== false : true }))
  const assets = graph?.assets || []
  const compromised = assets.filter((a) => num(s?.compromise?.[a.id]) > 0).length
  const byCause = {}
  for (const c of Object.values(s?.link_outage || {})) if (c) byCause[c] = (byCause[c] || 0) + 1
  const cuts = Object.values(byCause).reduce((x, y) => x + y, 0)
  const worst = Math.max(0, ...missions.filter((m) => m.active).map((m) => m.total))
  const level = worst <= 0 ? 0 : worst < 0.3 ? 1 : worst < 0.7 ? 2 : 3
  return { missions, compromised: { n: compromised, total: assets.length }, cuts: { n: cuts, byCause }, band: { level, label: BAND_LABELS[level] } }
}
```

- [ ] **Step 4: 통과 확인**

```powershell
npm test
```
Expected: 전부 PASS (georef 7 + derive 8).

- [ ] **Step 5: 커밋**

```powershell
Set-Location ..
git add ui/src/derive.js ui/src/__tests__/derive.test.js
git commit -m @'
ui: replay 를 로그로 읽는 eventRows, 상단 띠용 kpiOf. 둘 다 순수 함수이고 추론이 없다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 6: `mapLayers.js` - graph+step → GeoJSON + 테스트

**Files:**
- Create: `ui/src/mapLayers.js`
- Create: `ui/src/__tests__/mapLayers.test.js`

**Interfaces:**
- Consumes: `positionAt(asset, t)` from `geo.js`; `toLonLat`, `toMgrs` from `georef.js`.
- Produces (전부 순수, 모두 GeoJSON `FeatureCollection`):
  - `markerRows(graph, step, t, georef) -> [{ id, lon, lat, z, mode, compromise, outage }]` (위치 미정의는 제외)
  - `linkFeatures(graph, step, t, georef)` - LineString, props `{ id, cause, cut, bearer }`
  - `trackFeatures(graph, t, georef)` - 자산별 현재 t 까지 지나온 경로 LineString, props `{ id }`
  - `attackArcFeatures(graph, hops, t, georef)` - 호 LineString(25점), props `{ label, from, to }`
  - `gridFeatures(georef, extent, spacing = 2000) -> { lines, labels }` - lines: MultiLineString 1개, labels: Point + props `{ text }` (MGRS 1 km 정밀도 4자리, 예 `DH1908`)
  - `aoFeature(georef, extent)` - Polygon

- [ ] **Step 1: 실패하는 테스트 작성**

`ui/src/__tests__/mapLayers.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { markerRows, linkFeatures, trackFeatures, attackArcFeatures, gridFeatures, aoFeature } from '../mapLayers.js'

const georef = { anchor: { x: 0, y: 0, lat: 38.02, lon: 128.08 } }
const extent = { x: [0, 24000], y: [0, 18000] }
const graph = {
  assets: [
    { id: 'A', geo: { kind: 'fixed', at: { x: 1000, y: 1000, z: 10 } } },
    { id: 'B', geo: { kind: 'track', segments: [
      { from: 0, to: 100, mode: 'move', at: { x: 0, y: 0, z: 0 }, to_at: { x: 2000, y: 0, z: 0 } },
      { from: 100, to: 200, mode: 'hold', at: { x: 2000, y: 0, z: 0 } } ] } },
    { id: 'C', geo: { kind: 'track', segments: [{ from: 50, to: 60, mode: 'hold', at: { x: 5, y: 5, z: 0 } }] } },
  ],
  links: [{ id: 'L1', a: 'A', b: 'B', bearer: 'vhf' }, { id: 'L2', a: 'A', b: 'C', bearer: 'wired' }],
}
const step = { compromise: { A: 1 }, link_outage: { L1: 'terrain' }, asset_outage: { B: 'mobility' } }

describe('markerRows', () => {
  it('drops assets whose position is undefined at t', () => {
    const rows = markerRows(graph, step, 150, georef)
    expect(rows.map((r) => r.id)).toEqual(['A', 'B'])
    expect(rows[0]).toMatchObject({ compromise: 1, outage: null })
    expect(rows[1]).toMatchObject({ outage: 'mobility', lon: expect.any(Number) })
  })
})

describe('linkFeatures', () => {
  it('draws only links with both ends placed, with cause and cut flags', () => {
    const fc = linkFeatures(graph, step, 150, georef)
    expect(fc.features.length).toBe(1)
    expect(fc.features[0].properties).toEqual({ id: 'L1', cause: 'terrain', cut: true, bearer: 'vhf' })
    expect(fc.features[0].geometry.coordinates.length).toBe(2)
  })
})

describe('trackFeatures', () => {
  it('traces the path so far, interpolated inside a move', () => {
    const fc = trackFeatures(graph, 50, georef)
    const b = fc.features.find((f) => f.properties.id === 'B')
    expect(b.geometry.coordinates.length).toBe(2)
    const [lon1] = b.geometry.coordinates[1]
    const [lon0] = b.geometry.coordinates[0]
    expect(lon1).toBeGreaterThan(lon0)                     // moved east
    expect(fc.features.some((f) => f.properties.id === 'A')).toBe(false)   // fixed assets have no track
  })
})

describe('attackArcFeatures', () => {
  it('bends an arc between the two assets and labels it', () => {
    const fc = attackArcFeatures(graph, [{ from: 'A', to: 'B', t: 120, technique: 'T1021' }], 150, georef)
    expect(fc.features.length).toBe(1)
    expect(fc.features[0].geometry.coordinates.length).toBe(25)
    expect(fc.features[0].properties.label).toContain('+120분')
  })
})

describe('gridFeatures / aoFeature', () => {
  it('makes 13 vertical and 10 horizontal 2 km lines and labels them in MGRS', () => {
    const { lines, labels } = gridFeatures(georef, extent, 2000)
    expect(lines.features[0].geometry.coordinates.length).toBe(13 + 10)
    expect(labels.features.length).toBe(13 + 10)
    expect(labels.features[0].properties.text).toMatch(/^[A-Z]{2}\d{4}$/)
  })
  it('closes the AO polygon', () => {
    const ring = aoFeature(georef, extent).geometry.coordinates[0]
    expect(ring.length).toBe(5)
    expect(ring[0]).toEqual(ring[4])
  })
})
```

- [ ] **Step 2: 실패 확인** - `npm test` → `Cannot find module '../mapLayers.js'`.

- [ ] **Step 3: 구현**

`ui/src/mapLayers.js`:
```js
// graph + step -> GeoJSON for the MapLibre pane. Pure functions: MapPane owns
// the map, this file owns what is drawn on it. Positions come from the
// scenario's segment table via positionAt and are converted with the
// scenario's own georef; the engine reads none of it (ADR-0001, ADR-0025).

import { positionAt } from './geo.js'
import { toLonLat, toMgrs } from './georef.js'
import { techniqueKo } from './labels.js'

const fc = (features) => ({ type: 'FeatureCollection', features })
const line = (coords, properties) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties })

function placed(graph, t, georef) {
  const out = new Map()
  for (const a of graph?.assets || []) {
    const p = positionAt(a, t)
    if (!p) continue
    const [lon, lat] = toLonLat(georef, p.x, p.y)
    out.set(a.id, { ...p, lon, lat })
  }
  return out
}

export function markerRows(graph, step, t, georef) {
  const rows = []
  for (const [id, p] of placed(graph, t, georef)) {
    rows.push({
      id, lon: p.lon, lat: p.lat, z: p.z ?? 0, mode: p.mode,
      compromise: Number(step?.compromise?.[id] || 0),
      outage: (step?.asset_outage || {})[id] || null,
    })
  }
  return rows
}

export function linkFeatures(graph, step, t, georef) {
  const pos = placed(graph, t, georef)
  const feats = []
  for (const l of graph?.links || []) {
    const a = pos.get(l.a), b = pos.get(l.b)
    if (!a || !b) continue
    const cause = (step?.link_outage || {})[l.id] || null
    feats.push(line([[a.lon, a.lat], [b.lon, b.lat]], { id: l.id, cause, cut: !!cause, bearer: l.bearer || '' }))
  }
  return fc(feats)
}

// The path a track asset has covered up to t: every segment start before t,
// then the interpolated point at t itself.
export function trackFeatures(graph, t, georef) {
  const feats = []
  for (const a of graph?.assets || []) {
    const segs = a.geo?.segments
    if (!segs) continue
    const pts = []
    for (const s of segs) {
      if (Number(s.from) > t) break
      pts.push(s.at)
    }
    const now = positionAt(a, t)
    if (now) pts.push(now)
    if (pts.length < 2) continue
    feats.push(line(pts.map((p) => toLonLat(georef, p.x, p.y)), { id: a.id }))
  }
  return fc(feats)
}

// A quadratic arc in the local plane (metres), offset to the left of travel by
// 12% of the hop length, then converted. Curving in metres rather than in
// degrees keeps the bend symmetric on the map.
export function attackArcFeatures(graph, hops, t, georef) {
  const feats = []
  for (const h of hops || []) {
    const a = positionAt((graph.assets || []).find((x) => x.id === h.from), t)
    const b = positionAt((graph.assets || []).find((x) => x.id === h.to), t)
    if (!a || !b) continue
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const cx = (a.x + b.x) / 2 - dy / len * len * 0.12
    const cy = (a.y + b.y) / 2 + dx / len * len * 0.12
    const coords = []
    for (let i = 0; i <= 24; i++) {
      const u = i / 24
      const x = (1 - u) ** 2 * a.x + 2 * (1 - u) * u * cx + u * u * b.x
      const y = (1 - u) ** 2 * a.y + 2 * (1 - u) * u * cy + u * u * b.y
      coords.push(toLonLat(georef, x, y))
    }
    const ko = techniqueKo(h.technique)
    feats.push(line(coords, { label: `${ko || h.technique || ''} +${h.t}분`, from: h.from, to: h.to }))
  }
  return fc(feats)
}

export function gridFeatures(georef, extent, spacing = 2000) {
  const [x0, x1] = extent.x, [y0, y1] = extent.y
  const lines = [], labels = []
  for (let x = x0; x <= x1; x += spacing) {
    lines.push([toLonLat(georef, x, y0), toLonLat(georef, x, y1)])
    const [lon, lat] = toLonLat(georef, x, y0)
    labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { text: toMgrs(lat, lon, 2).slice(3) } })
  }
  for (let y = y0; y <= y1; y += spacing) {
    lines.push([toLonLat(georef, x0, y), toLonLat(georef, x1, y)])
    const [lon, lat] = toLonLat(georef, x0, y)
    labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { text: toMgrs(lat, lon, 2).slice(3) } })
  }
  return {
    lines: fc([{ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: lines }, properties: {} }]),
    labels: fc(labels),
  }
}

export function aoFeature(georef, extent) {
  const [x0, x1] = extent.x, [y0, y1] = extent.y
  const ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => toLonLat(georef, x, y))
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }
}
```

`toMgrs(...,2)` 는 `52SDH1908` 을 주고 `.slice(3)` 이 `DH1908` 이다.

- [ ] **Step 4: 통과 확인** - `npm test` → 전부 PASS.

- [ ] **Step 5: 커밋**

```powershell
Set-Location ..
git add ui/src/mapLayers.js ui/src/__tests__/mapLayers.test.js
git commit -m @'
ui: 지도에 그릴 것을 GeoJSON 으로 뽑는 순수 함수 - 링크·궤적·공격 호·격자·AO

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 7: MapLibre 패널 `MapPane.jsx` + `config.map` + App 분기

**Files:**
- Modify: `ui/package.json` (`maplibre-gl@^5`)
- Modify: `ui/src/config.js` DEFAULTS 에 `map`
- Modify: `ui/public/config.json`, `ui/dist/config.hosted.example.json` 에 `map`
- Create: `ui/src/ui/MapPane.jsx`
- Modify: `ui/src/App.jsx` (분기, geoCam 대신 mapCam)
- Modify: `ui/src/style.css` (map CSS, 끝에 추가)

**Interfaces:**
- Consumes: Task 5 `attackHops`, Task 6 전부, `symbolDataUriWithStatus`, `statusForState` from `symbols.js`, `assetName` from `labels.js`.
- Produces: `<MapPane graph step steps idx selected onSelect hidden />`.

**설계서와의 차이 (승인된 조정):** 설계서 §2.3 의 "what-if: 격리 시 영향 받는 자산에 흰 링" 은
replay 에 자산 단위 what-if 가 없어(`step.whatif[id].delta` 는 임무 단위) 그릴 데이터가 없다.
선택 자산에만 흰 외곽 링을 그리고, 격리 비용은 지금처럼 우측 "대응" 탭이 임무 단위로 말한다.
설계서 §2.3 표의 해당 행은 같은 문장으로 이미 고쳤다.

- [ ] **Step 1: 설치와 설정**

```powershell
Set-Location ui; npm i maplibre-gl@^5
```

`ui/src/config.js` DEFAULTS 에 추가:
```js
  // Map tiles are the one CDN exception (ADR-0025). An on-prem deployment
  // points these at its own tile server; nothing else in the bundle leaves
  // the box. Keyless public sources by default.
  map: {
    style: 'https://tiles.openfreemap.org/styles/dark',
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    satellite_attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    dem: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    dem_attribution: 'Terrain: AWS Terrain Tiles (Mapzen), SRTM/USGS/NRCan',
  },
```

`ui/public/config.json` 과 `ui/dist/config.hosted.example.json` 에 같은 `map` 블록을 `llm` 옆에 추가(hosted 예시에는 `_map_note: "오프라인 배치는 세 URL 을 로컬 타일 서버로 바꾼다"` 한 줄 더).

- [ ] **Step 2: MapPane 작성**

`ui/src/ui/MapPane.jsx`:
```jsx
import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { config } from '../config.js'
import { CAUSE_COLOR } from '../graph.js'
import { attackHops } from '../derive.js'
import { toLonLat, toMgrs } from '../georef.js'
import { markerRows, linkFeatures, trackFeatures, attackArcFeatures, gridFeatures, aoFeature } from '../mapLayers.js'
import { symbolDataUriWithStatus, statusForState } from '../symbols.js'
import { assetName } from '../labels.js'

// The map view for a georeferenced scenario (ADR-0025). Secondary by
// construction (ADR-0001): it draws positions the engine never reads.
//
// One style load. The OpenFreeMap dark style is fetched once and the
// satellite raster, the DEM and every overlay are added on top of it, so
// switching base maps is a visibility toggle and never a setStyle that would
// throw the overlays away.

const BASES = [['dark', '다크'], ['satellite', '위성'], ['terrain', '지형']]
const EMPTY = { type: 'FeatureCollection', features: [] }

function firstSymbolLayer(style) {
  const l = (style.layers || []).find((x) => x.type === 'symbol')
  return l ? l.id : undefined
}

export default function MapPane({ graph, step, steps, idx, selected, onSelect, hidden }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const markers = useRef(new Map())
  const dashRef = useRef({ raf: null, i: 0 })
  const [ready, setReady] = useState(false)
  const [base, setBase] = useState('satellite')
  const [is3d, setIs3d] = useState(true)
  const [tileError, setTileError] = useState(false)

  const georef = graph?.geo?.georef
  const extent = graph?.geo?.frame?.extent
  const t = step && step.t !== undefined && step.t !== null ? Number(step.t) : 0

  // --- build ------------------------------------------------------------
  useEffect(() => {
    if (!boxRef.current || !georef || !extent) return
    const cfg = config().map
    const [lon0, lat0] = toLonLat(georef, extent.x[0], extent.y[0])
    const [lon1, lat1] = toLonLat(georef, extent.x[1], extent.y[1])
    const map = new maplibregl.Map({
      container: boxRef.current,
      style: cfg.style,
      bounds: [[lon0, lat0], [lon1, lat1]],
      fitBoundsOptions: { padding: 40 },
      pitch: 55,
      maxPitch: 75,
      attributionControl: { compact: true, customAttribution: `${cfg.satellite_attribution} · ${cfg.dem_attribution}` },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.on('error', (e) => { if (e?.error && /tile|fetch|style/i.test(String(e.error.message || e.error))) setTileError(true) })

    map.on('load', () => {
      const style = map.getStyle()
      const beforeLabels = firstSymbolLayer(style)
      map.addSource('sat', { type: 'raster', tiles: [cfg.satellite], tileSize: 256, maxzoom: 18 })
      map.addLayer({ id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-opacity': 1 }, layout: { visibility: 'none' } }, beforeLabels)
      map.addSource('dem', { type: 'raster-dem', tiles: [cfg.dem], tileSize: 256, encoding: 'terrarium', maxzoom: 15 })
      map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', layout: { visibility: 'none' },
        paint: { 'hillshade-exaggeration': 0.6, 'hillshade-shadow-color': '#05070c', 'hillshade-highlight-color': '#b9c4d1' } }, beforeLabels)

      // overlays, bottom to top
      map.addSource('ao', { type: 'geojson', data: aoFeature(georef, extent) })
      map.addLayer({ id: 'ao', type: 'line', source: 'ao', paint: { 'line-color': '#f2f3f4', 'line-opacity': 0.55, 'line-width': 1.5, 'line-dasharray': [4, 3] } })
      const grid = gridFeatures(georef, extent, 2000)
      map.addSource('grid', { type: 'geojson', data: grid.lines })
      map.addLayer({ id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': '#f2f3f4', 'line-opacity': 0.14, 'line-width': 0.8 } })
      map.addSource('grid-labels', { type: 'geojson', data: grid.labels })
      map.addLayer({ id: 'grid-labels', type: 'symbol', source: 'grid-labels',
        layout: { 'text-field': ['get', 'text'], 'text-size': 10, 'text-font': ['Noto Sans Regular'], 'text-anchor': 'bottom-left', 'text-offset': [0.3, -0.2] },
        paint: { 'text-color': '#c2c6cb', 'text-opacity': 0.75, 'text-halo-color': '#070a10', 'text-halo-width': 1 } })
      map.addSource('tracks', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'tracks', type: 'line', source: 'tracks', paint: { 'line-color': '#c2c6cb', 'line-opacity': 0.5, 'line-width': 1.2, 'line-dasharray': [1, 2] } })
      map.addSource('links', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'links', type: 'line', source: 'links', layout: { 'line-cap': 'round' },
        paint: {
          'line-color': ['case', ['get', 'cut'], ['match', ['get', 'cause'],
            'attack', CAUSE_COLOR.attack, 'mobility', CAUSE_COLOR.mobility, 'terrain', CAUSE_COLOR.terrain,
            'maintenance', CAUSE_COLOR.maintenance, 'unknown', CAUSE_COLOR.unknown, CAUSE_COLOR.unknown], '#9aa5b1'],
          'line-width': ['case', ['get', 'cut'], 3, 1.6],
          'line-opacity': 0.9,
          'line-dasharray': ['case', ['get', 'cut'], ['literal', [1, 2.5]], ['literal', [1, 0]]],
        } })
      map.addSource('attack', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'attack', type: 'line', source: 'attack', layout: { 'line-cap': 'round' },
        paint: { 'line-color': CAUSE_COLOR.attack, 'line-width': 2.5, 'line-opacity': 0.95, 'line-dasharray': [0, 4, 3] } })
      map.addLayer({ id: 'attack-labels', type: 'symbol', source: 'attack',
        layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'label'], 'text-size': 11, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, -1] },
        paint: { 'text-color': '#ffb4ba', 'text-halo-color': '#070a10', 'text-halo-width': 1.2 } })
      setReady(true)
    })
    return () => {
      cancelAnimationFrame(dashRef.current.raf)
      for (const m of markers.current.values()) m.remove()
      markers.current.clear()
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [graph])

  // --- base map / terrain ----------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.setLayoutProperty('sat', 'visibility', base === 'satellite' ? 'visible' : 'none')
    map.setLayoutProperty('hillshade', 'visibility', base === 'terrain' ? 'visible' : 'none')
  }, [base, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (is3d) { map.setTerrain({ source: 'dem', exaggeration: 1.5 }); map.easeTo({ pitch: 55, duration: 500 }) }
    else { map.setTerrain(null); map.easeTo({ pitch: 0, duration: 500 }) }
  }, [is3d, ready])

  // the pane is display:none while another view is up; MapLibre has to be
  // told when its box got a size again
  useEffect(() => { if (!hidden && mapRef.current) mapRef.current.resize() }, [hidden])

  // --- overlays per step ---------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !graph || !step) return
    map.getSource('links').setData(linkFeatures(graph, step, t, georef))
    map.getSource('tracks').setData(trackFeatures(graph, t, georef))
    const { hops } = attackHops(steps || [], idx || 0)
    map.getSource('attack').setData(attackArcFeatures(graph, hops, t, georef))

    const rows = markerRows(graph, step, t, georef)
    const seen = new Set()
    for (const r of rows) {
      seen.add(r.id)
      const asset = graph.assets.find((a) => a.id === r.id)
      const status = statusForState({ compromise: r.compromise, outageCause: r.outage })
      const uri = symbolDataUriWithStatus(asset?.type, status, { size: 34 })
      const state = r.compromise > 0 ? 'attack' : r.outage ? `outage cause-${r.outage}` : 'ok'
      let m = markers.current.get(r.id)
      if (!m) {
        const el = document.createElement('div')
        el.className = 'map-mark'
        el.innerHTML = `<div class="map-mark-sym"><img alt="" /></div><div class="map-mark-label"></div>`
        el.addEventListener('click', (e) => { e.stopPropagation(); onSelect(r.id) })
        m = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([r.lon, r.lat]).addTo(map)
        markers.current.set(r.id, m)
      }
      m.setLngLat([r.lon, r.lat])
      const el = m.getElement()
      el.className = `map-mark ${state}${selected === r.id ? ' is-selected' : ''}`
      const img = el.querySelector('img')
      if (uri && img.src !== uri) img.src = uri
      const n = assetName(graph, r.id)
      el.querySelector('.map-mark-label').textContent = n.ko
      el.title = `${n.ko} · ${r.id} · ${Math.round(r.z)} m`
    }
    for (const [id, m] of markers.current) if (!seen.has(id)) { m.remove(); markers.current.delete(id) }
  }, [graph, step, steps, idx, t, georef, ready, selected, onSelect])

  // the attack arc crawls: a route, not a border (same idea as the transport
  // flow in GraphCanvas)
  useEffect(() => {
    const seq = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]]
    let last = 0
    const tick = (now) => {
      dashRef.current.raf = requestAnimationFrame(tick)
      const map = mapRef.current
      if (!map || !ready || hidden || now - last < 60) return
      last = now
      dashRef.current.i = (dashRef.current.i + 1) % seq.length
      if (map.getLayer('attack')) map.setPaintProperty('attack', 'line-dasharray', seq[dashRef.current.i])
    }
    dashRef.current.raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(dashRef.current.raf)
  }, [ready, hidden])

  const anchor = georef?.anchor
  const anchorMgrs = anchor ? toMgrs(anchor.lat, anchor.lon, 3) : ''

  return (
    <div className="map-pane" hidden={hidden}>
      <div className="map-canvas" ref={boxRef} onClick={() => onSelect(null)} />
      <div className="geo-controls map-controls">
        <div className="seg" role="group" aria-label="바탕">
          {BASES.map(([id, label]) => (
            <button key={id} type="button" className={base === id ? 'on' : ''} aria-pressed={base === id} onClick={() => setBase(id)}>{label}</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="차원">
          <button type="button" className={!is3d ? 'on' : ''} onClick={() => setIs3d(false)}>2D</button>
          <button type="button" className={is3d ? 'on' : ''} onClick={() => setIs3d(true)}>3D</button>
        </div>
      </div>
      {/* not removable by design (ADR-0025): the screenshot carries the caveat */}
      <div className="map-watermark" aria-label="주의">가상 훈련 시나리오 · 실제 부대 배치 아님</div>
      {tileError && <div className="map-tile-error">지도 타일을 받지 못했다. 오버레이만 그린다.</div>}
      <div className="geo-foot">
        <span>{graph?.geo?.frame?.id} · 격자 2 km · MGRS {anchorMgrs}</span>
        <span>지형 DEM · 3D 과장 1.5배</span>
        <span className="geo-warn">위치는 표시 전용이다. 단절 원인은 저작값이고 지형에서 계산하지 않는다.</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: App 분기**

`App.jsx`:
- import 추가: `import MapPane from './ui/MapPane.jsx'`
- `const isGeo = view === 'geo'` 아래에 `const hasGeoref = !!(graph && graph.geo && graph.geo.georef)`
- `<GeoPane .../>` 를 다음으로 교체:
```jsx
            {hasGeoref ? (
              <MapPane
                graph={graph} step={step} steps={payload?.steps} idx={idx}
                selected={selectedData?.id || null} onSelect={onSelect} hidden={!isGeo}
              />
            ) : (
              <GeoPane
                graph={graph} step={step} cam={geoCam} onCam={setGeoCam}
                selected={selectedData?.id || null} onSelect={onSelect} hidden={!isGeo}
              />
            )}
```

- [ ] **Step 4: CSS (style.css 끝에 추가)**

```css
/* ------------------------------------------------------------- map pane (ADR-0025) */
.map-pane { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; background: var(--surface-board); }
.map-pane[hidden] { display: none; }
.map-canvas { flex: 1; min-height: 0; }
.map-controls { right: 56px; }
.maplibregl-ctrl-group { background: var(--surface-chrome) !important; border: 1px solid var(--line-strong); }
.maplibregl-ctrl-group button { filter: invert(.85); }
.maplibregl-ctrl-attrib { background: rgba(7,10,16,.7) !important; color: var(--text-muted) !important; font-size: 10px; }
.maplibregl-ctrl-attrib a { color: var(--text-secondary) !important; }

.map-watermark {
  position: absolute; left: 16px; bottom: 56px; z-index: 5; pointer-events: none;
  padding: 6px 10px; border-radius: var(--radius-sm);
  background: rgba(7,10,16,.78); border: 1px solid var(--line-strong);
  color: var(--text-primary); font-size: 12px; font-weight: 500; letter-spacing: .01em;
}
.map-tile-error {
  position: absolute; left: 50%; top: 16px; transform: translateX(-50%); z-index: 5;
  padding: 6px 12px; border-radius: var(--radius-sm); background: var(--surface-raised);
  border: 1px solid var(--line-strong); font-size: 12px; color: var(--text-secondary);
}

/* markers: the symbol is the picture, state is the ring around it. Red ring
   and pulse are attack only (ADR-0012); an outage ring takes its cause colour. */
.map-mark { position: relative; width: 44px; height: 44px; cursor: pointer; }
.map-mark-sym {
  width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center;
  background: rgba(7,10,16,.72); border: 2px solid var(--line-strong);
  box-shadow: 0 2px 8px rgba(0,0,0,.6);
}
.map-mark-sym img { width: 30px; height: 30px; display: block; }
.map-mark-label {
  position: absolute; left: 50%; top: 46px; transform: translateX(-50%); white-space: nowrap;
  font-size: 11px; color: var(--text-primary); padding: 1px 6px; border-radius: 3px;
  background: rgba(7,10,16,.72);
}
.map-mark.attack .map-mark-sym { border-color: var(--attack); box-shadow: 0 0 0 4px rgba(255,77,94,.22), 0 0 18px rgba(255,77,94,.55); animation: mark-pulse 1.6s ease-in-out infinite; }
.map-mark.outage .map-mark-sym { border-style: dashed; }
.map-mark.cause-mobility .map-mark-sym { border-color: var(--mobility); box-shadow: 0 0 14px rgba(53,200,255,.4); }
.map-mark.cause-terrain .map-mark-sym { border-color: var(--terrain); box-shadow: 0 0 14px rgba(167,194,97,.4); }
.map-mark.cause-maintenance .map-mark-sym { border-color: var(--maintenance); }
.map-mark.cause-unknown .map-mark-sym { border-color: var(--unknown); box-shadow: 0 0 14px rgba(255,176,32,.4); }
.map-mark.is-selected .map-mark-sym { outline: 3px solid var(--text-primary); outline-offset: 2px; }
@keyframes mark-pulse { 0%, 100% { box-shadow: 0 0 0 4px rgba(255,77,94,.22), 0 0 18px rgba(255,77,94,.55); } 50% { box-shadow: 0 0 0 9px rgba(255,77,94,.08), 0 0 26px rgba(255,77,94,.75); } }
```

- [ ] **Step 5: 눈으로 확인**

```powershell
npm run dev
```
브라우저 `http://localhost:5180/?scenario=tacnet-01&t=300&view=geo`: 인제 일대 위성영상 + 3D 지형, 마커 13개(BN-SRV·CO2-VEH 빨간 링 + 펄스), `L-SAT-TOC` 주황 파선, 공격 호 CO2-VEH→BN-SRV 흐르는 빨간 파선, 2 km 격자와 `DH1908` 류 라벨, 좌하단 워터마크. 바탕 3종 토글, 2D/3D 토글, 마커 클릭 → 우측 "선택" 탭. `?scenario=defnet-01&view=geo` 는 기존 영내 배치도 그대로.
콘솔에 MapLibre 오류가 없어야 한다(`text-font` 가 스타일의 glyph 에 없으면 `Noto Sans Regular` 를 스타일의 `layers` 중 아무 symbol 레이어의 `text-font` 값으로 바꾼다 - `map.getStyle().layers.find(l=>l.type==='symbol').layout['text-font']` 로 확인).

- [ ] **Step 6: 빌드와 게이트**

```powershell
npm run build
Set-Location ..
.\scripts\Test-GeoInvariance.ps1
```
Expected: 빌드 성공(번들 경고는 maplibre 크기뿐), 게이트 PASS.

- [ ] **Step 7: 커밋**

```powershell
git add ui/package.json ui/package-lock.json ui/src/config.js ui/public/config.json ui/dist/config.hosted.example.json ui/src/ui/MapPane.jsx ui/src/App.jsx ui/src/style.css
git commit -m @'
ui: tacnet-01 지리 뷰를 MapLibre 실지형 위에 - 위성·다크·지형 바탕, 3D DEM, milsymbol 마커, 원인색 링크, 흐르는 공격 호, MGRS 격자, 끌 수 없는 워터마크

georef 가 있으면 MapPane, 없으면 GeoPane. defnet-01 의 영내 배치도는 그대로다.
타일 URL 은 config.json 의 map 블록(ADR-0021)에 있고 그것만이 CDN 예외다(ADR-0025).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 8: 상단 KPI 띠 (Topbar)

**Files:**
- Modify: `ui/src/ui/Topbar.jsx`
- Modify: `ui/src/App.jsx` (props 전달)
- Modify: `ui/src/style.css` (topbar 절 교체)

**Interfaces:**
- Consumes: `kpiOf(graph, step)` (Task 5), `clockOf(step)`.
- Produces: `<Topbar ... graph step />` (기존 props + `graph`, `step`).

- [ ] **Step 1: Topbar 교체**

```jsx
import { kpiOf, clockOf, pct } from '../derive.js'
import { CAUSE_COLOR } from '../graph.js'

// Top strip. Achromatic by rule (ADR-0024/0025): the numbers are big, the
// chrome is not coloured, and the only hue is the cause dot on the cut count.

const MODES = [['observe', '관측'], ['edit', '편집'], ['wargame', '교전']]

function Ring({ value }) {
  const r = 13, c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <svg className="kpi-ring" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="3" />
      <circle cx="16" cy="16" r={r} fill="none" stroke="var(--text-primary)" strokeWidth="3"
        strokeDasharray={`${c * v} ${c}`} strokeLinecap="round" transform="rotate(-90 16 16)" />
    </svg>
  )
}

export default function Topbar({ scenarios, scenarioId, onScenario, mode, onMode, phases, onHelp, graph, step }) {
  const k = kpiOf(graph, step)
  const clock = clockOf(step)
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">MC-CyCOP</span>
        <span className="brand-sub">임무중심 사이버 공동상황도</span>
      </div>
      <span className="tb-rule" />
      <div className="tb-field">
        <label htmlFor="scenario">시나리오</label>
        <select id="scenario" value={scenarioId || ''} onChange={(e) => onScenario(e.target.value)}>
          {scenarios.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </div>
      <div className="seg" role="group" aria-label="모드">
        {MODES.map(([id, label]) => (
          <button key={id} type="button" className={mode === id ? 'on' : ''} aria-pressed={mode === id} onClick={() => onMode(id)}>{label}</button>
        ))}
      </div>
      <span className="tb-rule" />

      <div className="kpis">
        {k.missions.map((m) => (
          <div className={`kpi${m.active ? '' : ' inactive'}`} key={m.id}>
            <Ring value={m.active ? m.total : 0} />
            <div>
              <div className="kpi-v">{m.active ? pct(m.total) : '—'}</div>
              <div className="kpi-l">{m.name} <span className="ref">P{m.priority}</span></div>
            </div>
          </div>
        ))}
        <div className="kpi">
          <div>
            <div className="kpi-v">{k.compromised.n}<small>/{k.compromised.total}</small></div>
            <div className="kpi-l">침해 자산</div>
          </div>
        </div>
        <div className="kpi">
          <div>
            <div className="kpi-v">{k.cuts.n}
              <span className="kpi-dots">{Object.entries(k.cuts.byCause).map(([c, n]) => (
                <i key={c} title={`${c} ${n}`} style={{ background: CAUSE_COLOR[c] || CAUSE_COLOR.unknown }} />
              ))}</span>
            </div>
            <div className="kpi-l">단절 링크</div>
          </div>
        </div>
        <div className={`kpi kpi-band lv${k.band.level}`}>
          <div>
            <div className="kpi-v">{k.band.label}</div>
            <div className="kpi-l">상황 등급</div>
          </div>
        </div>
      </div>

      <span className="tb-spacer" />
      <div className="tb-phase">{phases.length ? <>활성 단계 <b>{phases.join(' · ')}</b></> : '활성 단계 없음'}</div>
      <div className="tb-clock"><b>{clock.time}</b><span>{clock.off}</span></div>
      <button type="button" className="help-btn" title="이 화면 읽는 법" onClick={onHelp}>?</button>
    </header>
  )
}
```

App 에서 `<Topbar ... graph={graph} step={step} />` 로 전달.

- [ ] **Step 2: CSS** - `.topbar { height: 56px }` 를 `64px` 로, 아래 추가:

```css
.kpis { display: flex; align-items: stretch; gap: 0; }
.kpi { display: flex; align-items: center; gap: 8px; padding: 0 14px; border-left: 1px solid var(--line-soft); }
.kpi:first-child { border-left: none; padding-left: 4px; }
.kpi-v { font-family: "IBM Plex Mono", ui-monospace, Consolas, monospace; font-size: 20px; font-weight: 600; line-height: 1.1; color: var(--text-primary); display: flex; align-items: baseline; gap: 4px; }
.kpi-v small { font-size: 12px; color: var(--text-muted); font-weight: 400; }
.kpi-l { font-size: 10.5px; color: var(--text-muted); margin-top: 2px; white-space: nowrap; }
.kpi.inactive .kpi-v { color: var(--text-muted); }
.kpi-ring { width: 30px; height: 30px; flex: none; }
.kpi-dots { display: inline-flex; gap: 3px; margin-left: 6px; align-self: center; }
.kpi-dots i { width: 7px; height: 7px; border-radius: 50%; display: block; }
/* the band is a luminance step, never a hue: attack alone owns red */
.kpi-band .kpi-v { font-family: inherit; font-size: 14px; padding: 3px 10px; border-radius: 4px; border: 1px solid var(--line-strong); }
.kpi-band.lv0 .kpi-v { color: var(--text-muted); }
.kpi-band.lv1 .kpi-v { color: var(--text-secondary); background: var(--surface-raised); }
.kpi-band.lv2 .kpi-v { color: var(--text-primary); background: var(--surface-hover); }
.kpi-band.lv3 .kpi-v { color: var(--surface-app); background: var(--text-primary); border-color: var(--text-primary); }
.tb-clock { display: flex; align-items: baseline; gap: 6px; }
.tb-clock b { font-family: "IBM Plex Mono", ui-monospace, Consolas, monospace; font-size: 22px; font-weight: 600; }
.tb-clock span { font-size: 11px; color: var(--text-muted); }
```

- [ ] **Step 3: 확인** - dev 서버에서 t=300: `100.0%` 링 가득, `0.0%`, 침해 `2/13`, 단절 `1` + 주황 점, 등급 `심각`, 시계 `11:00 +300분`. 창을 1280px 로 줄여도 한 줄 안에 들어가야 한다(넘치면 `.brand-sub` 를 `@media (max-width: 1400px) { .brand-sub { display: none } }`).

- [ ] **Step 4: 커밋**

```powershell
git add ui/src/ui/Topbar.jsx ui/src/App.jsx ui/src/style.css
git commit -m @'
ui: 상단 KPI 띠 - 임무 저하도 링 게이지, 침해 자산, 원인별 단절, 결정론 밴드의 상황 등급, 큰 시계

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 9: 우측 레일 - 브리핑 상시 카드 + 이벤트 스트림

**Files:**
- Modify: `ui/src/ui/Rail.jsx`
- Modify: `ui/src/App.jsx` (`onSeekIdx`, 탭 목록)
- Modify: `ui/src/style.css`

**Interfaces:**
- Consumes: `eventRows(graph, payload)` (Task 5), 기존 `loadBrief`/`Brief`.
- Produces: `<Rail ... payload idx onSeekIdx />` 추가 props.

- [ ] **Step 1: Rail 수정**

(a) `TABS` 에서 `['brief', '브리핑']` 제거.

(b) `Brief` 아래에 상시 카드 추가:
```jsx
// The briefing is one sentence away at all times: the first sentence, the
// citation count, and a badge when a sentence has no citation (ADR-0009).
// Opening it shows the full Brief with its chips.
function BriefCard({ scenarioId, step, edited, onToast }) {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(false)
  const t = step && step.t !== undefined && step.t !== null ? Number(step.t) : null
  useEffect(() => {
    let alive = true
    if (t === null || edited) { setData(null); return }
    loadBrief(scenarioId, t).then((d) => { if (alive) setData(d) })
    return () => { alive = false }
  }, [scenarioId, t, edited])
  const text = data?.brief?.text ? String(data.brief.text) : ''
  const sentences = text.split(/(?<=[.!?])\s+/).filter((x) => x.trim())
  const cited = sentences.filter((x) => /\[F\d+\]/.test(x)).length
  const unverified = sentences.length - cited
  return (
    <div className="brief-card">
      <div className="brief-card-head">
        <span>브리핑 <em className="ref">LLM · 인용 필수</em></span>
        {sentences.length > 0 && (
          <span className="brief-badges">
            <span className="badge">인용 {cited}건</span>
            {unverified > 0 && <span className="unverified">미검증 {unverified}</span>}
          </span>
        )}
      </div>
      {!sentences.length && <div className="none">{edited ? '편집된 그래프에는 브리핑이 없다' : '이 시점 브리핑 없음'}</div>}
      {sentences.length > 0 && !open && (
        <p className="brief-first">{sentences[0].replace(/\[(F\d+)\]/g, '').trim()}</p>
      )}
      {open && <Brief scenarioId={scenarioId} step={step} edited={edited} onToast={onToast} />}
      {sentences.length > 0 && (
        <button type="button" className="brief-toggle" onClick={() => setOpen((o) => !o)}>{open ? '접기' : `펼치기 (${sentences.length}문장)`}</button>
      )}
    </div>
  )
}

// The replay as a log. Rows come from eventRows - differences between
// consecutive exported steps, nothing inferred. The current step's rows are
// lit and kept in view; clicking a row jumps to the step it points at.
function EventStream({ graph, payload, idx, onSeekIdx }) {
  const rows = useMemo(() => eventRows(graph, payload), [graph, payload])
  const ref = useRef(null)
  const curT = Number(payload?.steps?.[idx]?.t ?? -1)
  useEffect(() => {
    const el = ref.current?.querySelector('.ev.is-now')
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [idx])
  if (!rows.length) return null
  return (
    <div className="stream">
      <div className="stream-head">이벤트 스트림 <em className="ref">{rows.length}건 · replay 차분</em></div>
      <div className="stream-body" ref={ref}>
        {rows.map((r, i) => (
          <button
            type="button" key={i}
            className={`ev ev-${r.kind}${r.t <= curT ? ' is-past' : ''}${r.t === curT ? ' is-now' : ''}`}
            onClick={() => onSeekIdx(r.stepIdx)}
          >
            <span className="ev-t">{r.time}</span>
            <i className="ev-dot" style={{ background: r.cause ? (CAUSE_COLOR[r.cause] || CAUSE_COLOR.unknown) : 'var(--text-muted)' }} />
            <span className="ev-text">{r.text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
```
import 줄에 `useMemo, useRef` 와 `eventRows` 추가.

(c) `Rail` 본체: props 에 `payload, idx, onSeekIdx` 추가. `tab === 'brief'` 줄 삭제. `</>` (관측 모드 분기 끝) 뒤, `.rail-foot` 앞에:
```jsx
      {mode !== 'wargame' && <BriefCard scenarioId={scenarioId} step={step} edited={edited} onToast={onToast} />}
      {mode !== 'wargame' && <EventStream graph={graph} payload={payload} idx={idx} onSeekIdx={onSeekIdx} />}
```

(d) `App.jsx`: `pick('tab', ['cuts','actions','brief','inspect'], 'actions')` 에서 `'brief'` 제거. `<Rail ... payload={payload} idx={idx} onSeekIdx={(i) => setIdx(i)} />`.

- [ ] **Step 2: CSS 추가**

```css
.rail-body { flex: 1 1 auto; min-height: 120px; }
.brief-card { flex: none; padding: 10px 16px; border-top: 1px solid var(--line-strong); max-height: 40vh; overflow-y: auto; scrollbar-width: thin; }
.brief-card-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 500; margin-bottom: 6px; }
.brief-badges { display: flex; gap: 6px; }
.badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--line-strong); color: var(--text-secondary); }
.brief-first { margin: 0; font-size: 12px; line-height: 1.6; color: var(--text-secondary); padding-left: 10px; border-left: 2px solid var(--line-strong); }
.brief-toggle { margin-top: 6px; font-size: 11px; padding: 3px 9px; background: none; color: var(--text-muted); }

.stream { flex: none; height: 224px; display: flex; flex-direction: column; border-top: 1px solid var(--line-strong); }
.stream-head { flex: none; padding: 8px 16px 6px; font-size: 12px; font-weight: 500; }
.stream-body { flex: 1; overflow-y: auto; scrollbar-width: thin; padding: 0 8px 8px; }
.ev {
  display: grid; grid-template-columns: 44px 10px 1fr; align-items: baseline; gap: 8px;
  width: 100%; text-align: left; background: none; border: none; border-radius: 3px;
  padding: 3px 8px; font-size: 11.5px; line-height: 1.45; color: var(--text-muted);
}
.ev:hover { background: var(--surface-raised); }
.ev.is-past { color: var(--text-secondary); }
.ev.is-now { background: var(--surface-raised); color: var(--text-primary); }
.ev-t { font-family: "IBM Plex Mono", ui-monospace, Consolas, monospace; font-size: 11px; color: var(--text-muted); }
.ev.is-now .ev-t { color: var(--text-primary); }
.ev-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; align-self: center; }
.ev-attack .ev-text { color: var(--text-primary); }
.ev-attack.is-past .ev-text::before { content: '● '; color: var(--attack); }
```

- [ ] **Step 3: 확인** - dev 서버 t=300: 레일 아래쪽에 브리핑 카드(첫 문장 + `인용 n건`), 그 아래 스트림에 `06:00 집결·준비 단계 시작` … `11:00 대대 지휘소 침해 · 도메인 계정 악용` 이 하이라이트. 행 클릭 → 해당 시점으로 이동. 스트림이 재생 중 자동으로 따라온다. 900px 높이에서 탭 본문이 최소 120px 남아야 한다.

- [ ] **Step 4: 커밋**

```powershell
git add ui/src/ui/Rail.jsx ui/src/App.jsx ui/src/style.css
git commit -m @'
ui: 브리핑을 탭에서 꺼내 상시 카드로, 그 아래 replay 차분으로 만든 이벤트 스트림

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 10: 시간축 재생 컨트롤 (재생 크기·스텝·배속)

**Files:**
- Modify: `ui/src/App.jsx` (`speed` state, 인터벌)
- Modify: `ui/src/ui/Timeline.jsx`
- Modify: `ui/src/style.css`

**Interfaces:**
- Produces: `<Timeline ... speed onSpeed onStep />`; `onStep(±1)`.

- [ ] **Step 1: App**

`const [speed, setSpeed] = useState(1)` 추가. 재생 effect 의 `900` 을 `900 / speed` 로, deps 에 `speed`. `<Timeline ... speed={speed} onSpeed={setSpeed} onStep={(d) => setIdx((i) => Math.max(0, Math.min((payload?.steps.length || 1) - 1, i + d)))} />`.

- [ ] **Step 2: Timeline 의 `.transport` 교체**

```jsx
      <div className="transport">
        <button type="button" className="step-btn" onClick={() => onStep(-1)} title="이전 (←)">◀</button>
        <button type="button" className="play-btn" onClick={onPlay} title="재생 / 정지 (Space)">
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className="step-btn" onClick={() => onStep(1)} title="다음 (→)">▶</button>
        <div className="seg speed" role="group" aria-label="배속">
          {[1, 4, 16].map((s) => (
            <button key={s} type="button" className={speed === s ? 'on' : ''} onClick={() => onSpeed(s)}>{s}×</button>
          ))}
        </div>
      </div>
```
시그니처: `export default function Timeline({ graph, payload, idx, step, playing, onPlay, onSeek, speed, onSpeed, onStep })`.

- [ ] **Step 3: CSS**

```css
.timeline { height: 104px; }
.play-btn { width: 40px; height: 40px; font-size: 15px; background: var(--text-primary); color: var(--surface-app); border-color: var(--text-primary); }
.play-btn:hover { background: #fff; }
.step-btn { width: 28px; height: 28px; padding: 0; border-radius: 50%; display: grid; place-items: center; font-size: 10px; }
.seg.speed button { padding: 4px 9px; font-size: 11px; font-family: "IBM Plex Mono", ui-monospace, Consolas, monospace; }
.clock-time { font-family: "IBM Plex Mono", ui-monospace, Consolas, monospace; font-size: 26px; }
```

- [ ] **Step 4: 확인** - 재생 버튼이 흰 원, ◀▶ 스텝, 16× 에서 28스텝이 약 1.6초에 지나간다.

- [ ] **Step 5: 커밋**

```powershell
git add ui/src/App.jsx ui/src/ui/Timeline.jsx ui/src/style.css
git commit -m @'
ui: 시간축 재생 컨트롤 - 큰 재생 버튼, 스텝, 배속 1×/4×/16×

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 11: 그래프 밀도·글로우·공격 파선 애니메이션·흰 선택 외곽

**Files:**
- Modify: `ui/src/graph.js` (stylesheet, LAYOUTS)
- Modify: `ui/src/ui/GraphCanvas.jsx` (paint, flow loop)

- [ ] **Step 1: graph.js**

`stylesheet()`:
- `node[kind="mission"]`: `width: 148, height: 50, font-size: 13`
- `node[kind="task"]`: `width: 120, height: 36`
- `node[kind="service"]`, `node[kind="asset"]`: `width: 68, height: 68`
- `node:selected`: `'border-color': '#f2f3f4'` (파랑 제거)
- `edge.attack-hop`: `'width': 2.5`, `'line-dash-pattern': [8, 6]`
- 새 규칙 추가:
```js
    // glow lives under the node and takes the cause colour, so a lit node is
    // read the same way as its border (ADR-0012: red only for attack)
    { selector: 'node.hit', style: { 'underlay-color': CAUSE_COLOR.attack, 'underlay-opacity': 0.28, 'underlay-padding': 12, 'underlay-shape': 'ellipse' } },
    { selector: 'node.out', style: { 'underlay-color': 'data(outColor)', 'underlay-opacity': 0.16, 'underlay-padding': 10, 'underlay-shape': 'ellipse' } },
```
`LAYOUTS.dependency`: `nodeSep: 34, rankSep: 96, padding: 16`. `LAYOUTS.transport.padding: 24`.

- [ ] **Step 2: GraphCanvas paint**

paint effect 의 노드 루프 안, `n.style('border-style', ...)` 다음에:
```js
        n.toggleClass('hit', hit)
        n.toggleClass('out', !!cause && !hit)
        n.data('outColor', cause ? (CAUSE_COLOR[cause] || CAUSE_COLOR.unknown) : '#000')
```
`onFit` 의 패딩: App 의 `cyRef.current.fit(undefined, 40)` → `16`.

흐름 루프(`tick`)를 뷰와 무관하게 공격 홉도 돌리게 교체:
```js
    const tick = () => {
      flowRef.current.raf = requestAnimationFrame(tick)
      const cy = cyRef.current
      if (!cy) return
      flowRef.current.offset = (flowRef.current.offset - 0.6) % 26
      if (flowRef.current.view === 'transport') {
        const live = cy.edges('.transport').not('.cut').not('.hidden')
        if (live.length) live.style('line-dash-offset', flowRef.current.offset)
      }
      const hops = cy.edges('.attack-hop')
      if (hops.length) hops.style('line-dash-offset', flowRef.current.offset)
    }
```

- [ ] **Step 3: 확인** - t=300 의존 뷰: 그래프가 캔버스 폭을 거의 채우고, BN-SRV·CO2-VEH 아래 붉은 글로우, 공격 화살표 파선이 흐른다. 노드 선택 시 흰 테두리. 전송로 뷰에서도 홉이 흐른다.

- [ ] **Step 4: 커밋**

```powershell
git add ui/src/graph.js ui/src/ui/GraphCanvas.jsx ui/src/App.jsx
git commit -m @'
ui: 그래프가 캔버스를 채운다. 침해·단절 노드 아래 원인색 글로우, 공격 경로는 흐르고, 선택은 흰 외곽선

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 12: 색 토큰 개정 + 폰트 번들 + tokens.md

**Files:**
- Modify: `ui/package.json` (`@fontsource/ibm-plex-sans-kr`, `@fontsource/ibm-plex-mono`)
- Modify: `ui/src/main.jsx` (폰트 import)
- Modify: `ui/src/style.css` (`:root`), `ui/src/styles/modules.css` (cite-chip 무채화), `ui/src/ui/Timeline.jsx` 와 `ui/src/graph.js` 의 박힌 색
- Modify: `docs/design/tokens.md`

- [ ] **Step 1: 폰트**

```powershell
Set-Location ui; npm i @fontsource/ibm-plex-sans-kr @fontsource/ibm-plex-mono
```
`main.jsx` 의 `import './style.css'` 위에:
```js
import '@fontsource/ibm-plex-sans-kr/400.css'
import '@fontsource/ibm-plex-sans-kr/500.css'
import '@fontsource/ibm-plex-sans-kr/600.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
```

- [ ] **Step 2: 토큰**

`style.css` `:root` 의 표면·선 7개를 교체:
```css
  /* surfaces - low-chroma navy-black (ADR-0025 §3). Chroma stays below 0.02
     OKLCH: this is darker, not bluer. */
  --surface-app: #0b0f17;
  --surface-chrome: #111722;
  --surface-raised: #18202c;
  --surface-hover: #222b39;
  --surface-board: #070a10;
  --line-strong: #2a3442;
  --line-soft: #1c2430;
```
`button:hover` 의 `#5a626c` → `#3a4656`. `.band.alt` 의 `rgba(255,255,255,.018)` → `.025`.

박힌 색 치환:
- `Timeline.jsx`: `#343941` → `#1c2430`, `#353a41` → `#18202c`, `#434952` → `#222b39`, `#4a515a` → `#2a3442`, `#6d757f` → `#4a5668`.
- `graph.js` stylesheet: `'text-outline-color': '#1e2125'` → `'#070a10'`; node `'background-color': '#31353b'` → `'#151c27'`, `'border-color': '#4a515a'` → `'#2a3442'`(3곳); mission `'background-color': '#353a41'` → `'#18202c'`; edge `'#2b3646'` → `'#1f2a3a'`(2곳); `'#3b4a5c'` → `'#2a3a4e'`; attack-hop `'text-background-color': '#1c1e22'` → `'#070a10'`; transport `'text-background-color': '#0e1116'` → `'#070a10'`.
- `GraphCanvas.jsx` paint: `'#4a515a'` 2곳 → `'#2a3442'`.
- `modules.css` `.cite-chip`, `.cite-chip-ex`: `rgba(53,224,255,.1)` → `var(--surface-hover)`, border `rgba(53,224,255,.3)` → `var(--line-strong)`, color `#bdeaff` → `var(--text-secondary)`; hover `rgba(53,224,255,.2)` → `var(--line-strong)`.

- [ ] **Step 3: tokens.md** - "표면 · 텍스트" 표의 7개 값을 위 값으로 바꾸고 표 위에 한 줄: `2026-09-19 ADR-0025 로 바탕 휘도를 낮췄다. 채도 규칙은 그대로다.` 타이포 절에 `수치·시계·로그·좌표: IBM Plex Mono 500/600 (@fontsource 번들)` 행 추가.

- [ ] **Step 4: 확인** - dev 서버 전체 화면에서 크롬에 시안·파랑이 남아 있지 않은지(선택 테두리, cite chip 포함) 눈으로 확인. Network 탭에 `fonts.googleapis` 류 요청 0.

```powershell
npm run build
Select-String -Path dist\assets\*.js,dist\index.html -Pattern "fonts\.googleapis|cdn\.jsdelivr|unpkg\.com" | Measure-Object
```
Expected: Count 0.

- [ ] **Step 5: 커밋**

```powershell
Set-Location ..
git add ui/package.json ui/package-lock.json ui/src/main.jsx ui/src/style.css ui/src/styles/modules.css ui/src/ui/Timeline.jsx ui/src/graph.js ui/src/ui/GraphCanvas.jsx docs/design/tokens.md
git commit -m @'
ui: 바탕을 저채도 네이비-블랙으로, 수치는 IBM Plex Mono. 크롬의 채도 규칙은 그대로다 (ADR-0025 §3)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 13: 검증·스크린샷·문서·STATE

**Files:**
- Create: `docs/design/screens/2026-09-19-*.png` (5장)
- Modify: `docs/11-tactical-time-axis.md`, `docs/03-mission-ontology.md`, `docs/design/decisions.md`, `STATE.md`
- Modify: `scripts/Invoke-Gates.ps1` (vitest 게이트 1줄)

- [ ] **Step 1: 게이트 전부**

```powershell
Set-Location ui; npm test; npm run build; Set-Location ..
.\scripts\Invoke-Gates.ps1
```
Expected: vitest 전부 PASS, 빌드 성공, 게이트 표에 FAIL 0 (`bundle: hosted` 는 `dist-hosted` 가 없으면 SKIP/FAIL 로 나올 수 있다 - 이전 실행과 같은 상태면 무시).

게이트 러너는 `scripts\<script>.ps1` 을 `& $path @callArgs` 로 부르고 `$LASTEXITCODE` 를 읽는다. 그 규약에 맞춰 얇은 래퍼를 하나 만든다(ASCII 만, BOM 불필요):

`scripts/Test-UiUnit.ps1`:
```powershell
# Runs the UI unit tests (vitest) and exits with their code, so
# Invoke-Gates.ps1 can list them like every other gate. ASCII only.
#
# Usage:
#   .\scripts\Test-UiUnit.ps1
$ErrorActionPreference = 'Continue'
$ui = Join-Path (Split-Path $PSScriptRoot -Parent) 'ui'
if (-not (Test-Path (Join-Path $ui 'node_modules'))) {
  Write-Output "ui/node_modules missing - run npm install in ui first"
  exit 1
}
Push-Location $ui
try {
  cmd /c "npm test --silent"
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($null -eq $code) { $code = 1 }
exit $code
```

`Invoke-Gates.ps1` 의 `$gates` 에서 `geo invariance` 행 아래에 추가:
```powershell
  @{ name = 'ui unit tests';      tier = 'offline'; script = 'Test-UiUnit.ps1';         args = @{} },
```
끝나면 `.\scripts\Test-CaseCollisions.ps1` 과 `.\scripts\Invoke-Gates.ps1` 로 확인 - `ui unit tests` 행이 `pass`.

- [ ] **Step 2: 스크린샷 5장**

Playwright MCP 또는 브라우저로 1600×900, `docs/design/screens/` 에 저장:
- `2026-09-19-dependency-t300.png` - `?scenario=tacnet-01&t=300`
- `2026-09-19-geo-satellite-3d-t300.png` - `&view=geo` (위성, 3D)
- `2026-09-19-geo-dark-2d-t300.png` - 다크, 2D
- `2026-09-19-transport-t300.png` - 전송로
- `2026-09-19-defnet-geo.png` - `?scenario=defnet-01&view=geo` (기존 배치도 회귀 확인)

- [ ] **Step 3: 문서**

`docs/11-tactical-time-axis.md` §1 끝에:
```markdown
> **2026-09-19 (ADR-0025).** 자산 좌표를 강원 인제 일대 실지형(DEM) 위로 재저작했다.
> outage 의 시각·원인과 의존 엣지는 그대로이므로 이 문서의 수치는 전부 유효하다
> (재내보내기 전후 저하도 diff 0). 좌표 논거는 docs/17 §4 폐기 블록과 ADR-0025.
```

`docs/03-mission-ontology.md` 175행 `geo.safety` 설명을 `가상 시나리오임을 보증하는 논거(ADR-0025: 훈련장 위의 가상 시나리오)와 배경지도 정책` 로.

`docs/design/decisions.md` 끝에 새 절 `## 2026-09-19 - 실지형 지리 뷰와 관제 콘솔 밀도`: 무엇을 바꿨는지 6줄(지리 엔진 분기 규칙, 타일은 config, 워터마크, KPI 띠의 밴드 규칙, 이벤트 스트림은 replay 차분, 바탕 휘도), 그리고 잡은 문제가 있으면 적는다.

`STATE.md` "한눈에" 표의 UI 행을 `**2차 개편 완료(09-19, ADR-0025)**: tacnet-01 은 인제 실지형 위 MapLibre, KPI 띠·이벤트 스트림·배속, 저채도 바탕` 로. 날짜 헤더를 `2026-09-19` 로. 새 절 `## 2026-09-19 - UI 2차 개편` 에 쇼케이스 조사 한 단락 + 결과 + 검증 결과.

`docs/design/decisions.md` 끝에 추가:
```markdown
## 2026-09-19 - 실지형 지리 뷰와 관제 콘솔 밀도 (ADR-0025)

D4D 쇼케이스 49개를 조사한 뒤 여섯 가지를 바꿨다. 상세와 논거는
`docs/superpowers/specs/2026-09-19-ui-real-terrain-console-design.md`.

- **지리 엔진 분기는 데이터 한 필드다.** `graph.geo.georef` 가 있으면 MapLibre(`MapPane`),
  없으면 로컬 평면 렌더러(`GeoPane`). defnet-01 의 영내 배치도는 손대지 않았다.
- **타일 URL 은 코드가 아니라 `config.json` 의 `map` 블록에 있다.** ADR-0018 의 CDN
  예외는 이것뿐이고, 오프라인 배치는 이 블록을 로컬 타일로 바꾼다.
- **워터마크는 끌 수 없다.** "가상 훈련 시나리오 · 실제 부대 배치 아님". 스크린샷이
  어디로 가든 같이 간다.
- **상단 띠의 "상황 등급"은 밴드 규칙이다.** 활성 임무 최대 저하도 0 / <30 / <70 / ≥70 →
  정상 / 주의 / 경계 / 심각. 교리 용어를 쓰지 않았다. 판단이 아니라 임계값이다.
- **이벤트 스트림은 replay 의 차분이다.** 연속한 두 step 의 침해·단절·단계 차이와 저작된
  이동 구간 경계를 시각순으로 늘어놓은 것. 추론이 없다(`derive.js` `eventRows`).
- **바탕 휘도를 낮췄다.** 흑연에서 저채도 네이비-블랙으로. 채도 규칙(크롬 무채색, 원인색
  8종, 빨강은 공격)은 그대로다.
```

- [ ] **Step 4: 커밋**

```powershell
git add docs scripts/Invoke-Gates.ps1 scripts/Test-UiUnit.ps1 STATE.md
git commit -m @'
docs: UI 2차 개편 기록 - 스크린샷 5장, docs/11·03 각주, 결정 로그, STATE. vitest 를 게이트에 넣는다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
'@
```

---

## 완료 기준 (전부 만족해야 끝)

- `Test-Ontology` ERRORS 0, `Test-GeoInvariance` PASS, `Test-CaseCollisions` exit 0, `Add-Bom -Check` exit 0
- `npm test` 전부 PASS (georef 7, derive 8, mapLayers 6)
- 재저작 전후 `steps[*].mission/asset/service/task/whatif` 동일
- `vite build` 성공, 번들에 CDN 폰트·스크립트 참조 0 (타일 URL 은 config.json 에만)
- `?scenario=defnet-01&view=geo` 가 개편 전과 같은 영내 배치도
- 지리 뷰 워터마크가 어느 바탕·차원에서도 보임
- 크롬에 유채색 없음(선택 테두리·cite chip 포함), 빨강은 공격 요소에만
