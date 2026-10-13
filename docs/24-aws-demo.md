# 24. AWS 시연 사본 - 정적 번들 + 시연 시간에만 모델

**근거**: ADR-0029(시연 사본 자세), ADR-0021(호스팅 자세와 모델 엔드포인트), ADR-0018(정적 번들), ADR-0014(데모 1순위)
**설계**: `docs/superpowers/specs/2026-09-23-aws-demo-design.md`
**템플릿**: `infra/demo-static.yaml` (파라미터와 비밀 취급은 `infra/README.md`)
**상태**: AWS-0(정적 스택·배포 스크립트·문서) 완료. AWS-1(GPU 오리진)은 아직 없다.

> **AWS 리소스 생성은 사람이 실행한다.** 저장소의 어떤 스크립트도 스택을 만들지 않는다.
> 아래 `aws` 명령은 운영자가 직접 치는 것이고, 여기 적힌 것은 그 절차의 기록이다.
> 스택 생성·삭제는 돈과 공개 노출이 걸린 행위라서 사람 판단을 거친다(ADR-0004 와 같은 자세).

---

## 1. 무엇을 올리고 무엇을 안 올리나

| | |
|---|---|
| **올린다** | `ui\dist\*` - 정적 번들, `data/` 의 저작·합성 시나리오 replay, 사전 생성 브리핑 팩, 심볼·규칙표 JSON, `config.json` |
| **안 올린다** | `data/`, `eval/results/`, `models/`, OpTC 파생물. 라이선스와 크기 두 가지가 동시에 걸린다(ADR-0010) |

워터마크 "가상 훈련 시나리오 · 실제 부대 배치 아님" 은 공개 사본에도 따라가고 끌 수 없다(ADR-0025).

### 엔진은 브라우저에 남는다 - 이것은 취향이 아니라 측정값이다

tacnet-01(자산 13, 링크 12, 서비스 5, 작업 8, 임무 2)에서 `runChain` 1회가 **0.07 ms** 다
(Node 24, 1000회 평균). 서울 리전 왕복은 **10~50 ms** 다. 엔진을 서버로 옮기면 계산 한 번이
**100~700배** 느려지고, UI 는 마커를 끌 때마다·시간 슬라이더를 움직일 때마다 재계산하므로
드래그 한 번이 네트워크 요청 수십 개가 된다.

두 번째 이유는 비용이 아니라 정합이다. 지금 구현은 둘이다 - PowerShell 참조와 브라우저 JS.
`node ui\tools\parity.mjs` 가 그 **둘** 사이에서 1,622개 값의 일치를 지킨다. 서버 엔진을
만들면 구현이 셋이 되고 그 게이트 비용이 그대로 늘어난다.

무거운 배치(autoplay 스윕, 참모 골든셋 평가)가 필요하면 **같은 `ui/src/engine.js` 를 Node 에서**
돌린다. 구현은 둘 그대로다.

### 모델이 없어도 화면은 온전하다

**LLM 출력이 상태값을 정하는 경로를 만들지 않았기 때문이다**(ADR-0003). 임무 저하도, 원인
분해, 단절, 봉쇄 비용, 지형, 교전의 턴·점수·승패, 격리 순위표, 사전 생성 브리핑과 근거
인용까지 전부 결정론 계층이라 모델 없이 그대로 나온다.

모델이 꺼져 있을 때 사라지는 것은 둘뿐이다.

- 참모의 **자연어 질문 상자**. 질의 버튼(카탈로그 8종, 화면에 뜨는 것은 ctx 게이트가
  고른 부분집합이다 - `decision_why` 는 `needs:'game'` 이라 교전에서만 뜬다), 사실, 표,
  인용 참조는 엔진 산출이라 그대로
  나온다(ADR-0028 4절). 잠긴 입력 옆의 `다시 확인` 을 누르면 그 자리에서 모델을 다시 찾고,
  시연 시간에 GPU 를 켠 뒤 새로고침 없이 살아난다.
- 사실 위에 얹히는 **서술 문장**(참모 순위표를 읽어 주는 문장 포함). 순위표 자체는 규칙이
  만든다(ADR-0026 4번).

교전의 **실시간 LLM 공격자** 선택지는 애초에 화면에 없다 - 모델 유무와 무관하게
`llm.attacker_enabled`(기본 `false`) 뒤에 있다(ADR-0028 1절). 그 대조 결과는
`docs/13-adversary-comparison.md` 에 이미 측정돼 있다.

즉 **모델 유무는 기능 차이가 아니라 서술 차이다.** 화면에는 그렇게 읽히는 문구가 떠야 한다
(`config.json` 의 `llm.unavailable_note`). **꺼진 상태는 고장이 아니라 정상 동작이다.**

---

## 2. 구성

```
브라우저
  |  https (CloudFront, 뷰어 요청 함수가 basic auth 를 검사하고 authorization 헤더를 지운다)
  v
CloudFront distribution
  |-- 기본 오리진: S3 버킷(비공개, OAC)        -> 정적 번들
  |-- /api/llm/*  오리진: GPU EC2 (http)       -> Ollama, 캐시 없음, X-Demo-Origin 헤더
  |                                               ** AWS-1 에서 켠다 **
  |-- 로그 버킷: CloudFront 표준 로그, 90일 수명주기
```

**AWS-0 에서는 `/api/llm/*` 가지가 아예 만들어지지 않는다.** `LlmOriginDomain` 파라미터가 빈
값이면 `HasLlm` 조건이 거짓이 되어 두 번째 오리진도, 그 캐시 행동도, 그 원본 요청 정책도
생성되지 않는다. 템플릿을 고치지 않고 파라미터 둘로 켠다(`infra/README.md`).

---

## 3. 최초 1회 - 스택 생성

```powershell
cd F:\F\other_class\CybOPS

# 1) basic auth 자격을 만든다. 파일에 적지 않는다.
#    <password> 는 직접 정한다. 심사위원에게는 demo / <password> 를 따로 전달한다.
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("demo:<password>"))

# 2) 템플릿을 먼저 검사한다. python -m cfn_lint 은 없는 모듈이다(infra/README.md).
& "$env:LOCALAPPDATA\Programs\Python\Python312\Scripts\cfn-lint.exe" infra\demo-static.yaml

# 3) 스택을 만든다. IAM 리소스가 없으므로 --capabilities 는 필요 없다.
#    <bucket> 은 전역 고유, 3~56자. 로그 버킷은 <bucket>-logs 로 만들어진다.
aws cloudformation deploy `
  --template-file infra\demo-static.yaml `
  --stack-name mc-cycop-demo `
  --parameter-overrides BucketName=<bucket> BasicAuthBase64=$b64

# 4) 배포 스크립트가 쓸 두 값과 심사위원이 열 주소를 받는다.
aws cloudformation describe-stacks --stack-name mc-cycop-demo `
  --query "Stacks[0].Outputs" --output table
```

출력은 셋이다 - `BucketName`, `DistributionId`, `DomainName`.

배포가 전 세계 엣지에 퍼지는 데 몇 분이 걸린다. **스택 생성 직후 주소가 안 열리는 것은
설정 실패가 아닐 수 있다.**

---

## 4. 배포할 때마다

```powershell
cd F:\F\other_class\CybOPS

# 0) 시나리오를 고쳤다면 먼저. UI 는 mission.json 이 아니라 replay 를 읽는다.
.\scripts\Export-ReplayData.ps1

# 1) 무엇이 올라갈지 먼저 읽는다. 로컬 단계(자세 config, 번들 게이트)는 실제로 돌고
#    AWS 를 건드리는 단계는 명령만 출력된다. ui\dist 가 이미 있어야 한다 -
#    -DryRun 은 빌드를 실행하지 않고 명령만 찍으므로, -SkipBuild 없이 ui\dist 가
#    없으면 3단계(자세 config)에서 멈춘다.
.\scripts\Deploy-Aws.ps1 -Bucket <bucket> -DistributionId <id> -SkipBuild -DryRun

# 2) 실제 배포
.\scripts\Deploy-Aws.ps1 -Bucket <bucket> -DistributionId <id>

# 3) 모델 오리진이 살아 있는 시연 시간대에만
.\scripts\Deploy-Aws.ps1 -Bucket <bucket> -DistributionId <id> -Posture proxied
```

스크립트가 하는 8단계: 도구 확인 → 빌드 → 자세 `config.json` → 번들 게이트
(`Test-BundleConfig.ps1 -Posture hosted`) → `assets/` 동기화(1년 immutable) →
나머지 동기화(`no-cache`) + `config.json` 재업로드(`no-store`) → 무효화 `/*` →
확인 목록 출력(아래 7.1).

`config.json` 을 두 번 올리는 이유: `aws s3 sync` 는 키마다 다른 `Cache-Control` 을 못 준다.
그리고 **이 파일을 고치는 것이 배포 행위 자체**라 캐시되면 방금 한 배포가 안 보인다
(`docs/21-deployment.md` 3.3절).

`-Posture off`(기본)는 `llm.enabled = false`, `-Posture proxied` 는 그 한 플래그만 true 로
바꾼다. 엔드포인트는 두 경우 모두 같은 오리진의 `/api/llm` 이다.

**게이트에서 멈추면 아무것도 올라가지 않았다.** 출력이 시키는 것을 고치고 다시 돌린다.

**`-DryRun` 도 `ui\dist\config.json` 은 실제로 고쳐 쓴다.** 3단계(자세 config)는 파일 하나만
바꾸는 되돌릴 수 있는 단계라 드라이런에서도 그대로 실행되기 때문이다(스크립트 안 주석
"WHAT -DryRun DOES AND DOES NOT DO" 참고). 빌드 산출물이라 무해하고 다음 `npm run build`
가 되돌린다.

---

## 5. 시연 직전 / 직후 (AWS-1 에서 쓴다)

지금은 GPU 오리진이 없으므로 이 절은 예고다. `infra/demo-llm.yaml` 과 `infra/user-data.sh`
가 생긴 뒤에 쓴다.

```powershell
# 최초 1회: 모델 경로를 켠다. 템플릿은 안 고친다, 파라미터 둘을 채워 스택을 갱신한다.
aws cloudformation deploy `
  --template-file infra\demo-static.yaml `
  --stack-name mc-cycop-demo `
  --parameter-overrides BucketName=<bucket> BasicAuthBase64=$b64 `
                        LlmOriginDomain=<eip-dns> LlmOriginSecret=<secret>

# 시연 직전
aws ec2 start-instances --instance-ids <id>
.\scripts\Deploy-Aws.ps1 -Bucket <bucket> -DistributionId <id> -Posture proxied

# 시연 직후. 잊어도 30분 유휴 타이머가 같은 일을 한다.
aws ec2 stop-instances --instance-ids <id>
.\scripts\Deploy-Aws.ps1 -Bucket <bucket> -DistributionId <id> -Posture off
```

인스턴스를 껐으면 자세도 `off` 로 되돌린다. `proxied` 인 채로 두면 `probeLlm()` 이
매번 2.5초를 기다렸다가 실패하고, 그 대기가 화면에 보인다.

---

## 6. 비용

| 항목 | 상태 | 비용 |
|---|---|---|
| S3 + CloudFront | 상시 | 월 $1 미만(시연 규모) |
| GPU 인스턴스 g4dn.xlarge | **켤 때만** | 시간당 약 $0.6, 시연 2시간 약 $1.2 |
| EBS 30 GB gp3 | **꺼져 있어도 나간다** | 월 약 $2.4 |
| 공인 IPv4 주소 1개(EIP) | **켜져 있든 꺼져 있든 나간다** | 월 약 $3.6 |

**"인스턴스를 껐으니 0원" 이 아니다.** 꺼진 인스턴스도 두 가지를 계속 청구한다.

- **EBS 루트 볼륨**은 인스턴스 상태와 무관하게 프로비저닝된 용량만큼 과금된다. 모델
  가중치가 거기 있으므로 지울 수도 없다 - 지우면 시연마다 다시 받는다.
- **공인 IPv4 주소**는 **2024-02 부터 AWS 의 모든 공인 IPv4 가 시간당 과금**이다. 예전처럼
  "인스턴스에 붙어 있는 EIP 는 무료" 가 아니다. 붙어 있든 놀고 있든 나간다.

그래도 EIP 를 쓰는 이유: 인스턴스를 켤 때마다 공개 DNS 가 바뀌면 CloudFront 오리진을 고치고
배포 전파를 몇 분 기다려야 한다. **시연 직전에 할 일이 아니다.** 월 $4 로 주소를 고정한다.

**스팟 인스턴스는 쓰지 않는다.** 심사 도중 회수되면 그걸로 끝이다. 아낄 금액은 시연 2시간에
$1 이 안 된다. 그 돈으로 심사를 걸지 않는다.

**방어 두 겹** (AWS-1 이 만든다)

1. **유휴 자동 정지.** 접근 로그의 마지막 요청이 30분 이상 오래되면 `shutdown -h`.
   인스턴스는 `InstanceInitiatedShutdownBehavior=stop` 이라 종료가 아니라 정지다.
2. **AWS Budgets 월 $20 알림**(이메일). 넘기면 사람이 본다. 자동으로 무엇을 끄지 않는다.

---

## 7. 확인 목록

`scripts\Deploy-Aws.ps1` 의 마지막 단계가 **7.1 의 여섯 개를 같은 번호로** 출력한다.
번호가 어긋나면 둘 중 하나가 낡은 것이다.

### 7.1 지금 확인할 수 있는 것 (AWS-0, 모델 없이)

1. **배포 주소가 401 을 주고, 올바른 비밀번호를 넣으면 열린다.**
   틀린 비밀번호는 다시 401 이다. 주소는
   `aws cloudfront get-distribution --id <id> --query Distribution.DomainName` 로 확인한다.
2. **`/config.json` 이 방금 올린 내용이다.** 브라우저에서 직접 연다. `off` 면
   `llm.enabled: false`, `proxied` 면 `true` 에 `endpoint: /api/llm`. 옛 내용이 보이면
   `no-store` 가 안 걸렸거나 무효화가 아직 안 끝난 것이다.
3. **상황도가 뜨고 시간 슬라이더가 돈다.** 이것이 **엔진이 브라우저에서 돈다는 증거**다 -
   슬라이더를 끄는 동안 네트워크 요청이 늘지 않는 것을 개발자 도구에서 같이 본다.
4. **교전장(`sandbox-01`)에서 자산을 놓고 연결하면 준비도 카드가 찬다.** 서비스 제공자·작업
   수행 자산·도달성 셋이 다 차야 교전이 열린다(`docs/23-sandbox.md`).
5. **모델 없이도 브리핑이 근거 인용과 함께 나오고, 참모 질의 버튼이 사실·표로 답하며,
   교전 참모 순위표가 나온다.** 참모의 **질문 상자만** 사유와 함께 비활성이고
   greedy·random 은 그대로 돈다. 사유 문구는 `config.json` 의 `llm.unavailable_note` 다.
   **이 화면은 고장이 아니다.**
6. **캐시 헤더가 둘로 갈린다.** `assets/*` 는 `max-age=31536000, immutable` 이고
   `index.html` 은 아니다.
   `curl.exe -sI <주소>/index.html` 과 `curl.exe -sI <주소>/assets/<파일 하나>` 를 나란히 본다.
   (PowerShell 5.1 에서 `curl` 은 `Invoke-WebRequest` 별칭이라 `-sI` 를 모른다. `curl.exe` 로
   불러야 한다.)

### 7.2 AWS-1 에서 확인할 것 (GPU 오리진이 생긴 뒤)

7. **인스턴스를 켜고 질의창 옆 `다시 확인` 을 누르면 새로고침 없이 상자가 열리고, 참모
   문장 끝마다 `[F#]` 이 붙는다.**
   인용 없는 문장은 화면에서 "미검증" 으로 표시돼야 한다(ADR-0009).
   같이 볼 것: 정적 페이지 인증을 통과하기 전에 `probeLlm()` 이 먼저 돌면 401 을 받아
   "모델 없음" 으로 읽힌다. 순서상 그럴 일이 없어야 하지만 여기서 실물로 확인한다.
8. **`/api/llm/api/pull` 이 403 이다.**
   `curl.exe -u demo:<password> -X POST https://<주소>/api/llm/api/pull`
   (여기도 `curl.exe` 다 - PowerShell 5.1 별칭 `curl` 은 `-u`/`-X` 를 모른다.)
   **200 이 나오면 그 시연 사본은 지금 공개 모델 관리 API 다**(`docs/21-deployment.md` 5절).
   설계 문서 8절은 이 칸을 404 라고 적었지만, 저장소의 프록시 예시
   (`deploy/Caddyfile.example`, `deploy/nginx.example.conf`)는 허용목록 밖을 **403** 으로
   돌려주고 AWS-1 의 user-data 는 그 예시에서 `auth_basic` / `basicauth` 블록만 뺀 나머지
   (경로 허용목록, 유량 제한, catch-all 403)를 따른다. **GPU 프록시의 인증은
   `X-Demo-Origin` 헤더 검사뿐이다** - 사람에 대한 인증은 CloudFront 뷰어 요청 함수가 이미
   끝냈고 `authorization` 헤더는 엣지에서 지워지므로, 예시의 basic auth 블록을 그대로 두면
   시연 당일 모든 모델 호출이 오리진에서 401 이 난다. **어느 쪽이든 중요한 것은 200 이
   아니라는 것이다.**
9. **오리진에 직접(비밀 헤더 없이) 치면 403 이다.**
   `curl.exe -v http://<eip>/api/chat` - `X-Demo-Origin` 이 없으므로 프록시가 거절한다.
   (`curl.exe` 다 - PowerShell 5.1 의 `curl` 별칭은 `-v` 를 모른다.)
   다만 **직접 접속에 대한 실제 통제는 보안 그룹**이다 - 80/tcp 를 CloudFront 관리 프리픽스
   목록(`com.amazonaws.global.cloudfront.origin-facing`)에서만 받는다. 이 curl 은 그 목록
   **안**에서 온 요청을 가정한 두 번째 겹을 시험하는 것이고, 목록 밖에서는 애초에 TCP 가
   붙지 않는다. `X-Demo-Origin` 은 평문 구간의 도청자에게는 비밀이 아니다.
10. **30분 뒤 인스턴스가 스스로 멈춰 있다.** `aws ec2 describe-instances` 의 상태가
    `stopped` 여야 한다. `terminated` 면 `InstanceInitiatedShutdownBehavior` 가 틀린 것이고,
    그 경우 모델 가중치가 사라진다.

설계 문서 8절의 8개 항목이 여기 1·3·4·5·7·8·9·10 으로 들어갔다. 2(`config.json`)와
6(캐시 헤더)은 배포 절차 자체에서 온 것이라 그 목록에는 없다.

---

## 8. 한계

- **서버측 상태가 없다.** 승인 기록·참모 로그·교전장 플랜은 브라우저 저장소에 남고 JSON 으로
  내보낸다. 다른 브라우저에서 열면 안 보인다. 심사위원 둘이 같은 판을 보려면 파일을
  주고받아야 한다.
- **basic auth 는 관문이지 비밀이 아니다.** 자격은 배포된 CloudFront 함수 코드에 박혀 있어서
  **계정 읽기 권한이 있는 사람은 `aws cloudfront get-function` 으로 꺼내 볼 수 있다.**
  다른 곳에서 쓰는 비밀번호를 넣지 않는다. 계정 관리가 필요한 인증은 이 사본의 범위 밖이다.
- **오리진 구간이 평문이다**(AWS-1). 도메인도 ACM 인증서도 없다. `X-Demo-Origin` 은 **두 번째
  겹**이지 평문 위의 비밀이 아니다 - 실제 통제는 보안 그룹이다. 도메인을 사는 순간 오리진을
  https 로 바꾸는 것이 이 문단을 통째로 없애는 방법이다.
- **접근 로그는 90일 뒤 사라진다.** CloudFront 표준 로그만 쌓고 유량 제한에 걸린 요청을 따로
  남기지 않는다(ADR-0029). 사후 분석에 쓸 수 있는 창이 그만큼이다.
- **지도 타일은 인터넷에 나간다.** ADR-0025 가 정한 단 하나의 CDN 예외다. 망 분리 환경에
  올릴 때는 `config.json` 의 `map` 세 URL 을 로컬 타일 서버로 바꾼다.
- **여기 올라간 숫자로 탐지 성능을 주장하지 않는다.** 시연 사본의 시나리오는 합성·저작
  데이터다(`docs/07-synthetic-data.md` 6절). 성능 지표는 실데이터에서만 낸다.
