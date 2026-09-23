# infra/ - 시연 사본 인프라 템플릿

심사·시연용 공개 사본을 올리기 위한 CloudFormation 템플릿을 둔다.
설계 논거는 `docs/superpowers/specs/2026-09-23-aws-demo-design.md` 2절(구성)과 5절(보안)에 있다.

> **리소스 생성은 사람이 한다.** 이 저장소의 어떤 스크립트도, 어떤 세션도 AWS 자원을
> 자동으로 만들지 않는다. 아래 명령은 **운영자가 직접** 실행하는 것이고, 여기 적힌 것은
> 그 절차의 기록일 뿐이다. 스택 생성·삭제는 비용과 공개 노출이 걸린 행위라서
> 사람 판단을 거친다(대응 실행에 사람 승인을 요구하는 ADR-0004 와 같은 자세다).

## 파일

| 파일 | 내용 |
|---|---|
| `demo-static.yaml` | 비공개 S3 번들 버킷 + OAC + CloudFront + 뷰어 요청 함수(basic auth) + 로그 버킷(90일 만료) |

`demo-llm.yaml`(GPU EC2)과 `user-data.sh` 는 AWS-1 의 산출물이고 아직 없다.

## `demo-static.yaml` 이 만드는 것

- **`BundleBucket`** - 정적 번들이 들어가는 S3 버킷. 퍼블릭 액세스 네 가지 전부 차단,
  소유권은 `BucketOwnerEnforced`(ACL 자체를 끈다). CloudFront 의 OAC 로만 읽힌다.
- **`LogBucket`** - `<BucketName>-logs`. CloudFront 표준 접근 로그가 `cf/` 접두사로 쌓이고
  **90일 뒤 수명주기 규칙으로 지워진다**. CloudFront 표준 로깅은 객체를 ACL 로 쓰기 때문에
  이 버킷만 `BucketOwnerPreferred` 다. 번들 버킷과 다른 값인 것은 실수가 아니다.
- **`Oac`** - Origin Access Control. `s3` / `always` / `sigv4`.
- **`AuthFunction`** - CloudFront Function(`cloudfront-js-2.0`, 뷰어 요청). `Authorization`
  헤더를 상수와 비교하고, 다르면 401 + `WWW-Authenticate: Basic realm="MC-CyCOP demo"`.
  상수는 `BasicAuthBase64` 파라미터에서 `Fn::Sub` 로 박히므로 **저장소에는 비밀이 남지 않는다.**
- **`Distribution`** - `index.html` 기본 루트, HTTP/2+3, 기본 행동은 `CachingOptimized`,
  뷰어 프로토콜 `redirect-to-https`.
- **`BucketPolicy`** - `cloudfront.amazonaws.com` 서비스 주체에게 `s3:GetObject` 만 허용하고,
  `AWS:SourceArn` 조건으로 **이 배포판에서 온 요청만** 통과시킨다.

## 파라미터

| 이름 | 기본 | 설명 |
|---|---|---|
| `BucketName` | (필수) | 전역 고유 버킷 이름. 로그 버킷은 여기에 `-logs` 가 붙으므로 56자 이하로 둔다 |
| `BasicAuthBase64` | (필수, `NoEcho`) | `user:pass` 의 base64 |
| `LlmOriginDomain` | `''` | GPU 오리진 DNS 이름. **빈 값이면 모델 경로를 아예 만들지 않는다** |
| `LlmOriginSecret` | `''` (`NoEcho`) | CloudFront 가 GPU 오리진에 붙이는 비밀 헤더 `X-Demo-Origin` 의 값 |

`BasicAuthBase64` 와 `LlmOriginSecret` 은 `NoEcho: true` 다. 콘솔·`describe-stacks` 어디에도
값이 드러나지 않는다. **어떤 실제 값도 이 저장소에 커밋하지 않는다.**

### `BasicAuthBase64` 만드는 법

PowerShell 5.1 에서:

```powershell
[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("demo:<password>"))
```

`<password>` 는 직접 정한다. 만들어진 문자열은 스택 생성 때 파라미터로 넘기고,
파일에 적어 두지 않는다. 심사위원에게는 `demo` / `<password>` 를 따로 전달한다.

## 모델 경로는 기본적으로 꺼져 있다 (AWS-1 에서 켠다)

`LlmOriginDomain` 이 빈 값이면 `HasLlm` 조건이 거짓이 되어

- 두 번째 오리진(`llm`)이 만들어지지 않고,
- `/api/llm/*` 캐시 행동도 만들어지지 않는다.

즉 **AWS-0 의 시연 사본은 브라우저 안에서만 돈다.** 결정론적 엔진은 원래 브라우저에 있고
(ADR-0003 의 산출 경로는 그대로다), LLM 참모는 "모델 없음" 상태로 표시된다.

**AWS-1 에서 `LlmOriginDomain` 과 `LlmOriginSecret` 두 파라미터를 채워 스택을 갱신하면
모델 경로가 켜진다.** 템플릿을 고칠 필요가 없다. 그때 붙는 것은

- 오리진 `llm`: `http-only` / 80포트 / 오리진 응답 대기 60초,
  요청에 `X-Demo-Origin: <LlmOriginSecret>` 헤더가 붙는다. GPU 쪽 프록시가 이 헤더를
  검사해서 CloudFront 를 거치지 않은 직접 접속을 거부한다.
- 행동 `/api/llm/*`: `https-only`, `CachingDisabled`, `AllViewer` 원본 요청 정책,
  POST/PUT/PATCH/DELETE 허용.

### AWS-1 이 실물로 확인할 것

`/api/llm/*` 행동에도 같은 뷰어 함수가 걸린다. 브라우저의 `fetch` 는 같은 오리진이면
캐시된 basic auth 자격을 자동으로 붙이지만, **사람이 아직 인증하지 않은 상태에서
`probeLlm()` 이 먼저 돌면 401 을 받고 "모델 없음" 으로 읽힌다.** 정적 페이지가 먼저 인증을
통과한 뒤에 프로브가 도는 순서라 실제로는 문제가 없어야 하지만, 확인 목록 5번이 이것을
실물로 확인한다.

## 검증

```powershell
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m pip install --quiet cfn-lint
& "$env:LOCALAPPDATA\Programs\Python\Python312\Scripts\cfn-lint.exe" infra\demo-static.yaml
```

현재 상태: **E·W 계열 지적 없음**(cfn-lint 1.57.0, exit 0).

> cfn-lint 1.x 는 `python -m cfn_lint` 로 불리지 않는다(패키지 이름이 `cfnlint` 이고
> `__main__` 이 없다). 위처럼 `Scripts\cfn-lint.exe` 를 부르거나
> `python -c "from cfnlint import runner"` 로 설치만 확인한다.

### 의도한 informational 지적 하나

`--include-checks I` 를 켜면 하나가 남는다.

```
I3042: ARN in Resource BucketPolicy contains hardcoded Partition in ARN
```

버킷 정책의 `AWS:SourceArn` 을 `arn:aws:cloudfront::${AWS::AccountId}:distribution/${Distribution}`
로 쓴 것을 가리킨다. `${AWS::Partition}` 을 쓰라는 제안인데, **이 시연 사본은 상용 파티션
(`aws`) 한 곳에만 올린다.** 중국(`aws-cn`)이나 GovCloud(`aws-us-gov`)로 옮길 계획이 없고,
CloudFront 배포 ARN 형식을 리터럴로 두는 편이 읽는 사람에게 분명하다. 기본 실행
(`--include-checks` 없이)에서는 나오지 않는 informational 등급이라 그대로 둔다.
파티션을 옮기게 되면 이 한 줄을 `${AWS::Partition}` 으로 바꾼다.

## 올리지 않는 것

합성·저작 시나리오만 올린다. OpTC 파생물, `data/`, `eval/results/` 는 올리지 않는다
(라이선스·크기, ADR-0010). 워터마크 "가상 훈련 시나리오 · 실제 부대 배치 아님" 은
공개 사본에도 따라가고 끌 수 없다(ADR-0025).
