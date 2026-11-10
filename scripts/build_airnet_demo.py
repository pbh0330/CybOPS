"""Author a small synthetic air C2 scenario; no raw dataset is read or modified."""
from copy import deepcopy
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scenarios/tacnet-01/mission.json"
OUT = ROOT / "scenarios/airnet-01"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def position(x, y, z):
    return {"x": x, "y": y, "z": z}


def fixed(x, y, z=300):
    return {"kind": "fixed", "frame": "TACGRID-01", "source": "authored-synthetic",
            "accuracy_m": 100, "at": position(x, y, z)}


def track(points, altitude):
    return {"kind": "track", "frame": "TACGRID-01", "source": "authored-synthetic",
            "accuracy_m": 100, "note": "축약 훈련 항적. 실제 비행 속도·항공 성능 모델이 아님.",
            "segments": [{"from": i * 30, "to": (i + 1) * 30, "mode": "move",
                          "at": position(*points[i], altitude), "to_at": position(*points[i + 1], altitude)}
                         for i in range(4)]}


def main():
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    geo = deepcopy(source["geo"])
    geo["frame"]["extent"]["z"] = [0, 6000]
    geo["safety"]["claim"] = "가상 항공 통제 훈련. 실제 부대·공역·항로·장비·작전계획을 사용하지 않음."
    geo["safety"]["how"] = ["tacnet-01의 공개 지형 앵커만 재사용. 항공 자산과 지상 장비의 위치는 자체 저작.",
                            "워터마크 항상 표시. 항적은 축약 훈련 궤적이며 비행역학 모델이 아님."]
    geo["dem_source"] = "지도 표시 전용. 항공 시나리오 좌표와 고도는 DEM에서 추출하지 않은 가상값."
    assets = [
        {"id": "AIR-C2", "type": "c2-server", "site": "주 항공통제소", "geo": fixed(4200, 4200)},
        {"id": "AIR-BACKUP", "type": "c2-server", "site": "예비 항공통제소", "geo": fixed(5100, 5200)},
        {"id": "AIR-GW", "type": "gateway", "site": "항공 데이터링크 중계", "geo": fixed(6500, 6400)},
        {"id": "FTR-01", "type": "c2-terminal", "visual_model": "fighter", "site": "가상 전투기 1",
         "geo": track([(10000, 7000), (19000, 9000), (18000, 15000), (9000, 13000), (10000, 7000)], 4200)},
        {"id": "FTR-02", "type": "c2-terminal", "visual_model": "fighter", "site": "가상 전투기 2",
         "geo": track([(12000, 5500), (21000, 7500), (20000, 13500), (11000, 11500), (12000, 5500)], 4600)},
        {"id": "AEW-01", "type": "gateway", "visual_model": "aew", "site": "가상 조기경보통제기",
         "geo": track([(7000, 11000), (10000, 15000), (15000, 15000), (11000, 10500), (7000, 11000)], 5500)},
    ]
    for asset in assets:
        asset.update(unit="U-AIR", os="appliance", transit=not asset["id"].startswith("FTR"),
                     mobility="mobile" if "visual_model" in asset else "static")
    links = [
        {"id": "L-PRIMARY", "a": "AIR-C2", "b": "AIR-GW", "bearer": "wired"},
        {"id": "L-BACKUP", "a": "AIR-BACKUP", "b": "AIR-GW", "bearer": "wired",
         "outages": [{"from": 40, "to": 60, "cause": "unknown", "note": "예비 통제소 전송 구간 단절. 원인 미상, 공격으로 단정하지 않음."}]},
    ]
    for aid in ["FTR-01", "FTR-02", "AEW-01"]:
        links.append({"id": f"L-DATA-{aid}", "a": "AIR-GW", "b": aid, "bearer": "vhf"})
    for link in links[:2]:
        link["rule_exception"] = {"exempts": ["same_site"], "why": "가상 지상 전송망의 중간 구간을 생략한 논리 링크."}
    # Existing bearer vocabulary only. This is an abstract data connection,
    # not a claim that a specific airframe uses a particular real protocol.
    graph = {
        "scenario_id": "airnet-01", "name": "항공 지휘통제 · 가상 연동 훈련", "network_type": "tactical",
        "authored": "2026-11-10", "classification": "합성 훈련 전용. 실제 부대·항공기 성능·작전계획 미사용.",
        "basis": "사용자 요청에 따른 항공 플랫폼 UI·의존성 회귀 시나리오. 탐지 성능 근거로 사용할 수 없음.",
        "timeline": {"unit": "minute", "t0_iso": "2026-11-10T06:00:00+09:00", "horizon": 120, "step": 5},
        "cause_labels": source["cause_labels"], "geo": geo,
        "units": [{"id": "U-AIR", "name": "가상 항공 훈련대", "echelon": "BN", "parent": None}],
        "missions": [{"id": "M-AIR-C2", "name": "항공 지휘통제", "priority": 1, "owner": "U-AIR"},
                     {"id": "M-AIR-PICTURE", "name": "공중 상황 공유", "priority": 2, "owner": "U-AIR"}],
        "phases": [{"id": "PH-AIR-C2", "mission": "M-AIR-C2", "seq": 1, "name": "편대 통제 유지", "window": {"from": 0, "to": 120}},
                   {"id": "PH-AIR-PICTURE", "mission": "M-AIR-PICTURE", "seq": 1, "name": "상황 공유 유지", "window": {"from": 0, "to": 120}}],
        "tasks": [{"id": f"T-C2-{n}", "phase": "PH-AIR-C2", "name": f"전투기 {n} 통제정보 수신", "criticality": 1, "performed_at": f"FTR-0{n}"} for n in [1, 2]]
                 + [{"id": f"T-PIC-{n}", "phase": "PH-AIR-PICTURE", "name": f"전투기 {n} 공중상황 수신", "criticality": 1, "performed_at": f"FTR-0{n}"} for n in [1, 2]],
        "services": [{"id": "S-AIR-C2", "name": "항공 통제 메시징", "kind": "messaging", "redundancy_group": "air-c2"},
                     {"id": "S-AIR-PICTURE", "name": "공중 상황 정보", "kind": "intel"},
                     {"id": "S-AIRLINK", "name": "항공 데이터링크", "kind": "messaging"}],
        "assets": assets, "links": links,
        "edges": {"requires": [{"from": f"T-{task}-{n}", "to": service, "w": 1, "hard": True}
                               for task, service in [("C2", "S-AIR-C2"), ("PIC", "S-AIR-PICTURE")] for n in [1, 2]]
                              + [{"from": f"T-{task}-{n}", "to": "S-AIRLINK", "w": 1, "hard": True} for task in ["C2", "PIC"] for n in [1, 2]],
                  "provided_by": [{"from": "S-AIR-C2", "to": "AIR-C2", "w": 1},
                                  {"from": "S-AIR-C2", "to": "AIR-BACKUP", "w": 1},
                                  {"from": "S-AIR-PICTURE", "to": "AEW-01", "w": 1},
                                  {"from": "S-AIRLINK", "to": "AIR-GW", "w": 1}],
                  "depends_on": [], "hosted_on": [],
                  "redundant_with": [{"a": "AIR-C2", "b": "AIR-BACKUP", "group": "air-c2"}]},
        "crown_jewels": ["AIR-C2", "AEW-01"],
        "notes": ["visual_model은 표시 전용. 사이버 단말 유형과 SIDC는 기존 유형을 유지한다.",
                  "표시 항적·고도는 결정론 엔진 입력이 아니다. 실측 장비 성능·전투 결과를 주장하지 않는다."],
    }
    attack = {"campaign_id": "CAMP-AIR01", "scenario_id": "airnet-01", "name": "항공 통제 가용성 합성 훈련",
              "victim_entry": "AIR-C2", "note": "합성 침해 입력. 환경 단절은 mission.json에만 정의.",
              "steps": [
                  {"t": 0, "label": "연동 정상", "state": {}, "note": "두 통제소가 제공하는 이중화 통제 메시징."},
                  {"t": 25, "label": "주 통제소 침해", "state": {"AIR-C2": 0.6}, "gt": {"technique": "T1078", "tactic": "initial-access"}, "note": "예비 통제소가 가용한 동안 이중화가 받친다."},
                  {"t": 40, "label": "주 통제소 장악", "state": {"AIR-C2": 1}, "gt": {"technique": "T1486", "tactic": "impact"}, "note": "예비 링크 미상 단절과 겹친다. 두 원인을 별도로 표시한다."},
                  {"t": 80, "label": "공중 상황 단말 침해", "state": {"AIR-C2": 1, "AEW-01": 0.65}, "gt": {"technique": "T1021", "tactic": "lateral-movement"}, "note": "가상 조기경보통제기의 상황 공유 단말 침해. 센서 성능을 뜻하지 않는다."},
                  {"t": 100, "label": "편대 단말 가용성 저하", "state": {"AIR-C2": 1, "AEW-01": 0.65, "FTR-01": 0.5}, "gt": {"technique": "T1486", "tactic": "impact"}, "note": "전투기 1의 임무 단말 저하. 비행·무장 제어 모델이 아니다."},
              ]}
    OUT.mkdir(parents=True, exist_ok=True)
    write("mission.json", graph)
    write("attack-timeline.json", attack)
    write("MANIFEST.json", {"scenario_id": "airnet-01", "origin": "original synthetic fixture, not an external dataset",
                           "license": "project-authored; same terms as repository", "redistributable": True,
                           "allowed_use": ["development", "regression", "construct validation"],
                           "excluded_use": "detection performance claims", "code_base": "a71eace",
                           "generator": "scripts/build_airnet_demo.py", "generator_sha256": sha(Path(__file__)),
                           "inputs": [{"path": "scenarios/tacnet-01/mission.json", "sha256": sha(SOURCE)}],
                           "parameters": {"horizon_minutes": 120, "step_minutes": 5},
                           "files": [{"path": name, "sha256": sha(OUT / name)} for name in ["mission.json", "attack-timeline.json"]]})
    print("Authored airnet-01: 6 assets, 2 missions. Export with Export-ReplayData.ps1.")


def record_replay():
    """Record the independently exported replay only if it embeds this graph."""
    replay_path = ROOT / "ui/public/data/airnet-01.replay.json"
    replay = json.loads(replay_path.read_text(encoding="utf-8"))
    graph = json.loads((OUT / "mission.json").read_text(encoding="utf-8"))
    if replay["graph"] != graph:
        raise ValueError("Replay graph is stale. Run Export-ReplayData.ps1 first.")
    manifest = json.loads((OUT / "MANIFEST.json").read_text(encoding="utf-8"))
    manifest["replay"] = {
        "path": replay_path.relative_to(ROOT).as_posix(), "sha256": sha(replay_path),
        "engine": "scripts/Invoke-MissionPropagation.ps1",
        "engine_sha256": sha(ROOT / "scripts/Invoke-MissionPropagation.ps1"),
        "exporter_sha256": sha(ROOT / "scripts/Export-ReplayData.ps1"),
        "inputs": manifest["files"], "method": replay["method"], "steps": len(replay["steps"]),
        "generated": replay["generated"],
    }
    write("MANIFEST.json", manifest)
    (ROOT / "ui/public/data/airnet-01.provenance.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Recorded replay hashes and engine provenance.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--record-replay", action="store_true", help="Record hashes after PowerShell export; does not regenerate inputs.")
    if parser.parse_args().record_replay:
        record_replay()
    else:
        main()
