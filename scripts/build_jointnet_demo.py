"""Author a joint-domain presentation fixture, not a physical combat model."""
from copy import deepcopy
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'scenarios/jointnet-01'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')


def track(points, altitude):
    return {'kind': 'track', 'frame': 'TACGRID-01', 'source': 'authored-synthetic', 'accuracy_m': 100,
            'segments': [{'from': i * 30, 'to': (i + 1) * 30, 'mode': 'move',
                          'at': dict(x=points[i][0], y=points[i][1], z=altitude),
                          'to_at': dict(x=points[i + 1][0], y=points[i + 1][1], z=altitude)} for i in range(4)]}


def main():
    graph = json.loads((ROOT / 'scenarios/airnet-01/mission.json').read_text(encoding='utf-8'))
    graph.update(scenario_id='jointnet-01', name='합동 임무 연동 · 해상 / 항공 / 우주',
                 basis='영상 표현을 재구성하는 자체 저작 합성 훈련. 물리·무장·탐지 성능 모델이 아님.')
    graph['geo']['frame']['extent'] = dict(x=[0, 110000], y=[0, 80000], z=[0, 450000])
    graph['geo']['georef']['approximation_error_m'] = 1100
    graph['geo']['georef']['approximation_note'] = '확장 영역의 고정 위도 근사. 모서리 검사 약 972m, 표시 허용 오차 1100m. 항법·판단에 사용하지 않음.'
    graph['geo']['safety']['claim'] = '가상 합동 훈련. 실제 부대 배치·항로·궤도·장비 성능 아님.'
    graph['geo']['safety']['how'] = ['항적과 고도는 자체 저작. 위성도 천체역학 전파가 아닌 축약 표시 항적.', '환경 효과는 표시 전용이며 엔진 상태를 바꾸지 않음.']
    for a in graph['assets']:
        if a['id'] in ('AIR-C2', 'AIR-BACKUP', 'AIR-GW'):
            a['site'] = {'AIR-C2': '주 합동통제소', 'AIR-BACKUP': '예비 합동통제소', 'AIR-GW': '합동 데이터링크 중계'}[a['id']]
        if a.get('visual_model') in ('fighter', 'aew'):
            a['geo'] = track([(38000, 18000), (82000, 27000), (77000, 65000), (32000, 50000), (38000, 18000)], 6500 if a['visual_model'] == 'fighter' else 8000)
            if a['id'] == 'FTR-02':
                for s in a['geo']['segments']:
                    for key in ('at', 'to_at'):
                        s[key]['x'] += 4000
                        s[key]['y'] -= 4000
                        s[key]['z'] += 400
            if a['id'] == 'AEW-01':
                for s in a['geo']['segments']:
                    for key in ('at', 'to_at'):
                        s[key]['x'] -= 10000
                        s[key]['y'] += 11000
    extra = [
        dict(id='SHIP-01', type='c2-terminal', visual_model='ship', site='가상 해상 지휘함',
             geo=track([(70000, 15000), (76000, 26000), (80000, 37000), (84000, 49000), (87000, 60000)], 0)),
        dict(id='USV-01', type='c2-terminal', visual_model='usv', site='가상 무인 수상정',
             geo=track([(65000, 17000), (71000, 29000), (75000, 40000), (79000, 52000), (82000, 63000)], 0)),
        dict(id='ORB-01', type='satcom-terminal', visual_model='spacecraft', site='가상 우주 중계 단말',
             geo=track([(10000, 60000), (38000, 65000), (65000, 58000), (92000, 48000), (106000, 35000)], 420000)),
    ]
    for a in extra:
        a.update(unit='U-AIR', os='appliance', transit=a['id'] == 'ORB-01', mobility='mobile')
    graph['assets'].extend(extra)
    graph['units'][0]['name'] = '가상 합동 연동 훈련대'
    graph['missions'].append(dict(id='M-MARITIME', name='해상 임무 연동', priority=2, owner='U-AIR'))
    graph['phases'].append(dict(id='PH-SEA', mission='M-MARITIME', seq=1, name='해상 상황 공유 유지', window=dict(**{'from': 0, 'to': 120})))
    graph['services'].append(dict(id='S-SPACE', name='우주 중계 데이터', kind='messaging'))
    graph['edges']['provided_by'].append(dict(**{'from': 'S-SPACE', 'to': 'ORB-01', 'w': 1}))
    for a in extra[:2]:
        tid = 'T-' + a['id']
        graph['tasks'].append(dict(id=tid, phase='PH-SEA', name=a['site'] + ' 정보 수신', criticality=1, performed_at=a['id']))
        for svc in ('S-AIR-C2', 'S-SPACE'):
            graph['edges']['requires'].append(dict(**{'from': tid, 'to': svc, 'w': 1, 'hard': True}))
    graph['links'].extend([dict(id='L-JOINT-' + a['id'], a='AIR-GW', b=a['id'], bearer='vhf') for a in extra[:2]])
    graph['links'].append(dict(id='L-JOINT-ORB-01', a='AIR-BACKUP', b='ORB-01', bearer='satcom'))
    graph['crown_jewels'].append('ORB-01')
    graph['notes'].append('해양·구름·지구·연결 시각화는 모형 표현이며 상태·경보·대응 우선순위 계산에 입력되지 않음.')
    attack = json.loads((ROOT / 'scenarios/airnet-01/attack-timeline.json').read_text(encoding='utf-8'))
    attack.update(campaign_id='CAMP-JOINT01', scenario_id='jointnet-01', name='합동 데이터 연동 합성 훈련')
    attack['steps'].insert(3, dict(t=70, label='우주 중계 단말 저하', state={'AIR-C2': 1, 'ORB-01': 0.45}, note='통신 단말 가용성 입력. 실제 궤도·전파·탐지 모델 아님.'))
    for step in attack['steps']:
        if step['t'] >= 80:
            step['state']['ORB-01'] = 0.45
    OUT.mkdir(parents=True, exist_ok=True)
    write(OUT / 'mission.json', graph)
    write(OUT / 'attack-timeline.json', attack)
    write(OUT / 'MANIFEST.json', dict(scenario_id='jointnet-01', origin='original synthetic fixture',
          license='project-authored; same terms as repository', redistributable=True,
          allowed_use=['development', 'regression', 'construct validation'], excluded_use='physical combat or detection performance claims',
          code_base='b568db5', generator='scripts/build_jointnet_demo.py', generator_sha256=sha(Path(__file__)),
          inputs=[dict(path=p, sha256=sha(ROOT / p)) for p in ['scenarios/airnet-01/mission.json', 'scenarios/airnet-01/attack-timeline.json']],
          files=[dict(path=p, sha256=sha(OUT / p)) for p in ['mission.json', 'attack-timeline.json']]))
    print('Authored jointnet-01: 9 assets, 3 missions, original synthetic tracks.')


def record():
    path = ROOT / 'ui/public/data/jointnet-01.replay.json'
    replay = json.loads(path.read_text(encoding='utf-8'))
    if replay['graph'] != json.loads((OUT / 'mission.json').read_text(encoding='utf-8')):
        raise ValueError('Stale replay; export the current graph first.')
    manifest = json.loads((OUT / 'MANIFEST.json').read_text(encoding='utf-8'))
    manifest['replay'] = dict(path=path.relative_to(ROOT).as_posix(), sha256=sha(path),
        engine='scripts/Invoke-MissionPropagation.ps1', engine_sha256=sha(ROOT / 'scripts/Invoke-MissionPropagation.ps1'),
        exporter_sha256=sha(ROOT / 'scripts/Export-ReplayData.ps1'), steps=len(replay['steps']), generated=replay['generated'])
    write(OUT / 'MANIFEST.json', manifest)
    write(ROOT / 'ui/public/data/jointnet-01.provenance.json', manifest)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record-replay', action='store_true')
    record() if parser.parse_args().record_replay else main()
