# 21. 배포 절차

**근거**: ADR-0021(호스팅 배치와 모델 엔드포인트), ADR-0018(정적 번들), ADR-0007
**상태**: 절차 확정. ADR-0021 이 남겨둔 두 문제를 여기서 닫는다.

---

## 1. ADR-0021 이 남긴 두 문제

그 ADR 은 스스로 두 가지를 미결로 적어뒀다.

1. 프록시 경로의 **인증과 유량 제한**을 정하지 않았다.
2. 기본값이 `local` 이므로 **config.json 을 안 고치고 올리면** 두 가지 나쁜 동작이
   그대로 난다. 예시 파일을 옆에 두는 것으로는 부족하고 절차서에 넣어야 한다.

2번부터 닫는다. 절차서에만 적으면 **적힌 대로 안 하는 날**이 온다. 그래서 절차의
기계로 확인 가능한 절반을 스크립트로 만들었다.

```powershell
cd ui; npm run build; cd ..
.\scripts\Test-BundleConfig.ps1 -Bundle ui\dist -Posture hosted
```

지금 저장소 상태로 돌리면 이렇게 나온다.

```
FAIL  llm.enabled is true and endpoint is http://127.0.0.1:11434.
      On a public host that address is the VISITOR machine, not this server.
RESULT: DO NOT DEPLOY   1 failure(s)
```

**빌드 산출물의 기본 상태가 곧 함정이라는 뜻이다.** 종료 코드가 1이므로 배포
스크립트 중간에 넣으면 그 자리에서 멈춘다.

## 2. 어느 자세로 올릴 것인가

| 자세 | 설정 | 화면에서 사라지는 것 | 서버가 지는 위험 |
|---|---|---|---|
| `off` | `llm.enabled: false` | 실시간 LLM 공격자 하나 | 없음 |
| `proxied` | `endpoint: /api/llm` | 없음 | 남의 GPU 를 열어주는 것 |
| `local` | 기본값 | (호스팅에 쓰면 안 된다) | - |

**공개 호스트의 기본 권고는 `off` 다.** ADR-0021 결과절이 이미 이유를 적어놨다.
임무 저하도, 원인 분해, 단절, 봉쇄 비용, 지형, 교전의 greedy·random, 브리핑과 근거
인용까지 전부 결정론 계층이라 모델 없이 그대로 나온다. 사라지는 것은 실시간 LLM
공격자 하나뿐이고, 그 대조 결과(`docs/13-adversary-comparison.md`)는 이미 측정되어
문서에 있다.

**LLM 출력이 상태값을 정하는 경로를 만들지 않았기 때문에**(ADR-0003) 이 선택지가
존재한다. 그 경로가 있었다면 모델 없는 배포본은 숫자가 비었을 것이다.

`proxied` 는 시연에서 실시간 공격자를 꼭 보여줘야 할 때만 켠다. 그때도 시연 시간대에만
열고 닫는 것이 맞다.

## 3. `proxied` 를 켠다면: 인증과 유량 제한 (1번 문제)

**결정: 인증 없이는 열지 않는다. 유량 제한 없이도 열지 않는다. 둘 중 하나만 있는
구성은 `off` 보다 나쁘다.**

예시 설정은 `deploy/nginx.example.conf` 와 `deploy/Caddyfile.example` 에 있다.
핵심은 세 줄로 요약된다.

### 3.1 Ollama 는 추론 API 가 아니라 모델 관리 API 이기도 하다

여기가 이 결정의 날카로운 부분이다. Ollama 에는 자체 인증이 없고, API 에는 추론만
있는 것이 아니라 `/api/pull`, `/api/create`, `/api/copy`, `/api/delete`, `/api/push`
가 같이 있다.

`/api/llm/` 을 `proxy_pass http://127.0.0.1:11434/;` 로 통째로 넘기면 **방문자가
서버에 아무 모델이나 받게 하거나, 있는 모델을 지울 수 있다.** 추론 비용은 눈에
보이는 문제이고, 모델 관리는 기계를 망가뜨리는 문제다.

그래서 예시 설정은 **허용 목록**으로 짰다. `/api/generate` 와 `/api/tags` 두 경로만
열고 `/api/llm/` 아래 나머지는 403 이다. 거부 목록으로 짜면 Ollama 가 엔드포인트를
하나 추가하는 날 틀린 설정이 된다.

### 3.2 유량 제한은 사람의 속도에 맞춘다

교전 한 턴이 모델 호출 한 번이고, 사람은 사람의 속도로 턴을 넘긴다. nginx 예시는
IP 당 분당 6회에 버스트 2다. 시연에는 넉넉하고 무료 추론 API 로는 쓸모가 없다.

Caddy 에는 내장 유량 제한이 없다. 플러그인을 넣은 커스텀 빌드를 쓸 수 없는 환경이면
`proxied` 를 포기하고 `off` 로 간다. **인증만 있고 제한이 없는 엔드포인트는 비밀번호를
가진 사람에게는 여전히 열린 엔드포인트다.**

### 3.3 `/config.json` 은 캐시하지 않는다

이 파일을 고치는 것이 배포 행위 자체다. 강하게 캐시되면 고쳐도 안 바뀐다.
예시 설정에 `Cache-Control: no-store` 가 들어 있다.

## 4. 절차

```powershell
# 1) 데이터가 최신인지. UI 는 mission.json 이 아니라 replay 를 읽는다.
.\scripts\Export-ReplayData.ps1

# 2) 빌드
cd ui; npm run build; cd ..

# 3) 자세에 맞게 config.json 을 바꾼다
Copy-Item ui\public\config.hosted.example.json ui\dist\config.json -Force
#    off      -> llm.enabled = false
#    proxied  -> llm.enabled = true, endpoint = /api/llm

# 4) 게이트. 여기서 멈추면 3)을 안 한 것이다.
.\scripts\Test-BundleConfig.ps1 -Bundle ui\dist -Posture hosted

# 5) 복사
#    ui\dist\*  ->  /srv/mc-cycop/

# 6) proxied 인 경우에만: deploy
ginx.example.conf 를 반영하고
#    htpasswd 를 만든다. 만들지 않았으면 5)로 돌아가 off 로 다시 올린다.
```

3)에서 `config.json` 을 `ui\public\` 이 아니라 `ui\dist\` 에 두는 것에 주의한다.
`public/` 을 고치면 다음 빌드에 반영되지만 **이번 산출물에는 안 들어간다.**

## 5. 올린 뒤 확인

| 확인 | 방법 | 기대 |
|---|---|---|
| 설정이 실제로 반영됐는가 | 브라우저에서 `/config.json` 을 연다 | 방금 올린 내용 |
| `off` 인데 LLM 이 눌리는가 | 교전 패널 | 선택지가 **사유와 함께** 비활성 |
| 모델 관리 경로가 막혔는가 | `curl -X POST https://호스트/api/llm/api/pull` | **403** |
| 유량 제한이 걸리는가 | `/api/llm/api/tags` 를 10회 연속 호출 | 중간부터 429 |
| 브리핑이 보이는가 | 시나리오를 연다 | 모델 없이도 문장과 근거 인용이 나온다 |

세 번째 줄이 이 표에서 제일 중요하다. 403 이 아니면 **지금 그 서버는 공개 모델
관리 API 다.**

## 6. 아직 안 정한 것

- **인증 방식이 basic auth 다.** 시연 규모에서는 충분하지만 계정 관리가 없다.
  여러 사람이 각자 접속해야 하면 그때 다시 본다.
- **HTTPS 인증서 발급은 이 문서 밖이다.** 예시는 Let's Encrypt 경로를 가정한다.
- **접속 로그에 무엇을 남길지 정하지 않았다.** 유량 제한이 걸린 요청을 남길지 여부가
  개인정보 문제와 닿는다. 실제로 공개하기 전에 정한다.
