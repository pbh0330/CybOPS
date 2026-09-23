# AWS 시연 사본 - 정적 번들 + 시연 시간에만 모델 (설계)

작성 2026-09-23. 승인됨(대화). 구현 계획은 별도 문서.

## 0. 결정과 그 근거

| 질문 | 결정 |
|---|---|
| 용도 | **심사·시연용 공개 사본**. 상시 운영이 아니다(ADR-0014 데모 1순위) |
| 엔진 | **브라우저에 둔다.** 옮기지 않는다 |
| 모델 | **시연 때만 켜는 GPU 인스턴스**. 평소엔 꺼져 있다 |
| 서버 상태 | **없다.** 승인 기록·참모 로그는 브라우저 저장소 + JSON 내보내기 |

### 엔진을 옮기지 않는 이유 (측정값)

tacnet-01(자산 13, 링크 12, 서비스 5, 작업 8, 임무 2)에서 `runChain` 1회 **0.07 ms**
(Node 24, 1000회 평균). 서울 리전 왕복은 10~50 ms 다. 옮기면 계산이 100~700배 느려지고,
UI 는 마커를 끌 때마다·슬라이더를 움직일 때마다 재계산하므로 드래그 한 번이 네트워크 요청
수십 개가 된다.

그리고 구현이 셋이 된다 - PowerShell 참조, 브라우저 JS, 서버. 지금 `ui/tools/parity.mjs`
게이트가 지키는 것은 **둘** 사이의 일치(1622 값)다. 셋이 되면 그 비용이 그대로 늘어난다.

무거운 배치(autoplay 스윕, 참모 골든셋 평가)가 필요하면 **같은 `engine.js` 를 Node 에서**
돌린다. 구현은 둘 그대로다.

## 1. 자세

`docs/21-deployment.md` 의 세 자세 중 **정적 + `proxied`(시연 시간에만)** 를 쓴다.
평소에는 `off` 와 구분이 없다 - 인스턴스가 꺼져 있으면 `/api/llm` 이 실패하고
`probeLlm()` 이 `ok:false` 를 돌려주며, 참모는 설계대로 사실 목록으로 떨어진다
(`docs/superpowers/specs/2026-09-23-staff-officer-design.md` 7절).

**꺼진 상태는 고장이 아니라 정상 동작이다.** 안내 문구가 그렇게 읽혀야 한다.

## 2. 구성

```
브라우저
  |  https (CloudFront)
  v
CloudFront distribution
  |-- 기본 오리진: S3 버킷(비공개, OAC)      -> 정적 번들
  |-- /api/llm/*  오리진: GPU EC2 (http)     -> Ollama, 캐시 없음
  |   (CloudFront 가 비밀 헤더 X-Demo-Origin 을 붙인다)
  |-- 뷰어 요청 함수: basic auth 검사
```

- **S3**: 퍼블릭 액세스 전면 차단. CloudFront OAC 로만 읽는다.
- **인증은 CloudFront 에서** 한다. 뷰어 요청 함수가 `Authorization` 헤더를 상수와 비교하고
  없으면 401 + `WWW-Authenticate`. 도메인이 없어도 되고, 비밀번호는 CloudFront 까지
  TLS 안에서만 흐른다.
- **CloudFront -> GPU 오리진은 http** 다. ACM 인증서를 받으려면 도메인이 필요한데 시연
  사본에는 없다. 대신 오리진은 **비밀 헤더가 있는 요청만** 받는다(직접 접속 차단).
  도메인을 사는 순간 오리진을 https 로 바꾸는 것이 낫다 - 그때 한 줄 바뀐다.
- **`/api/llm/*` 는 캐시 없음**(`CachingDisabled`), POST 허용, 오리진 응답 시간 60초.

## 3. 캐시 정책

| 경로 | Cache-Control | 이유 |
|---|---|---|
| `assets/*` | `max-age=31536000, immutable` | 파일명에 해시가 있다 |
| `index.html` | `no-cache` | 번들 교체가 즉시 보여야 한다 |
| `config.json` | `no-store` | 자세를 바꾸려고 고치는 파일이다(`docs/21` 3.3절) |
| `data/*.json` | `no-cache` | 해시가 없고 재배포마다 바뀐다 |

배포 스크립트가 `aws s3 sync` 를 **두 번** 돌린다(긴 캐시 대상과 짧은 캐시 대상).
마지막에 `/*` 무효화 1회.

## 4. 비용

| 항목 | 상태 | 비용 |
|---|---|---|
| S3 + CloudFront | 상시 | 월 $1 미만(시연 규모) |
| GPU 인스턴스 g4dn.xlarge | 켤 때만 | 시간당 약 $0.6, 시연 2시간 약 $1.2 |
| EBS 30 GB gp3 | **꺼져 있어도 나간다** | 월 약 $2.4 |
| Elastic IP | **켜져 있든 꺼져 있든 나간다**(2024-02 이후 모든 공인 IPv4 과금) | 월 약 $3.6 |

EIP 를 쓰는 이유: 인스턴스를 켤 때마다 공개 DNS 가 바뀌면 CloudFront 오리진을 고쳐야
하고, 배포 전파에 몇 분이 걸린다. 시연 직전에 할 일이 아니다. 월 $4 로 주소를 고정한다.

**스팟은 쓰지 않는다.** 심사 도중 회수되면 그걸로 끝이다.

**방어 두 겹**
1. 유휴 자동 정지: 접근 로그의 마지막 요청이 30분 이상 오래되면 `shutdown -h`.
   인스턴스의 `InstanceInitiatedShutdownBehavior=stop`.
2. AWS Budgets 월 $20 알림(이메일). 넘기면 사람이 본다.

## 5. 보안

- **Ollama API 는 추론 API 이자 모델 관리 API 다**(`docs/21` 3.1절). 프록시에서
  `/api/chat`, `/api/tags` 만 통과시키고 `/api/pull`, `/api/delete`, `/api/create`,
  `/api/push` 는 404 로 막는다. 안 막으면 접근한 사람이 그 GPU 에 임의의 모델을 올린다.
- 보안 그룹은 80/tcp 만, 소스는 CloudFront 관리 프리픽스 목록
  (`com.amazonaws.global.cloudfront.origin-facing`). 22 는 열지 않는다 - 관리는 SSM 으로 한다.
- 유량 제한은 사람 속도에 맞춘다(`docs/21` 3.2절): IP 당 분당 20건.
- 올리는 데이터는 **합성·저작 시나리오뿐**이다. OpTC 파생물, `data/`, `eval/results/` 는
  올리지 않는다(라이선스·크기, ADR-0010).
- 워터마크 "가상 훈련 시나리오 · 실제 부대 배치 아님" 은 끌 수 없다(ADR-0025). 공개 사본에도
  따라간다.
- 접근 로그: CloudFront 표준 로그를 켜되 **90일 수명주기로 삭제**한다. 유량 제한에 걸린
  요청을 따로 남기지 않는다(`docs/21` 6절의 미결 항목을 여기서 닫는다).

## 6. 파일

**신규**
- `infra/demo-static.yaml` - CloudFormation: S3 + OAC + CloudFront + 뷰어 함수 + 로그 버킷
- `infra/demo-llm.yaml` - CloudFormation: GPU EC2 + SG + EIP + IAM(SSM) + user-data
- `infra/user-data.sh` - Ollama 설치, 모델 pull, Caddy(경로 허용목록 + 비밀 헤더 검사 +
  유량 제한), 유휴 정지 타이머
- `scripts/Deploy-Aws.ps1` - build -> gates -> config 교체 -> s3 sync 2회 -> 무효화.
  **ASCII 만** 쓴다(CLAUDE.md 인코딩 규칙 1).
- `ui/public/config.aws.example.json` - `endpoint: /api/llm`, 시연 시간 안내 문구
- `docs/24-aws-demo.md` - 절차, 켜고 끄는 법, 확인 목록, 비용표
- `docs/adr/0029-aws-demo-posture.md`

**수정**: `docs/21-deployment.md`(6절 미결 항목 갱신), `STATE.md`, `docs/design/decisions.md`

## 7. 절차 (요약, 상세는 `docs/24-aws-demo.md`)

```
# 최초 1회
aws cloudformation deploy --template-file infra/demo-static.yaml --stack-name mc-cycop-demo ...
aws cloudformation deploy --template-file infra/demo-llm.yaml    --stack-name mc-cycop-llm  ...

# 배포할 때마다
.\scripts\Deploy-Aws.ps1 -Bucket <b> -Distribution <id> -Posture proxied

# 시연 직전 / 직후
aws ec2 start-instances --instance-ids <id>
aws ec2 stop-instances  --instance-ids <id>
```

**AWS 리소스 생성은 사람이 실행한다.** 자격증명이 필요하고 돈이 나가는 바깥 작업이다.
저장소는 템플릿·스크립트·문서까지만 만든다.

## 8. 확인 목록 (올린 뒤)

1. CloudFront 주소가 401 을 주고, 비밀번호를 넣으면 열린다
2. 상황도가 뜨고 시간 슬라이더가 돈다(엔진이 브라우저에서 돈다는 증거)
3. 교전장에서 자산을 놓고 연결하면 준비도가 찬다
4. **인스턴스가 꺼진 상태에서** 참모 드로어가 질의 버튼 + 사실 목록으로 동작한다
5. 인스턴스를 켜면 질의창이 활성화되고 문장에 `[F#]` 이 붙는다
6. `/api/llm/api/pull` 이 404 다
7. `curl` 로 오리진에 직접(비밀 헤더 없이) 치면 403 이다
8. 30분 뒤 인스턴스가 스스로 멈춰 있다

## 9. 하지 않는 것

서버측 엔진, 서버측 상태(DB), 스팟 인스턴스, GPU 상시 가동, AWS 전용 API 를 코드에
직접 부르는 것(ADR-0007 - Bedrock 을 쓰게 되면 모델 어댑터 뒤에 두고 Ollama 경로를
함께 유지한다), 계정 관리가 필요한 인증(basic auth 로 충분하다, `docs/21` 6절).
