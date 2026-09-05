# data/

이 디렉터리의 내용물은 `.gitignore`로 제외된다. 이 README만 커밋된다.

```
data/
├── raw/          # 원본. 임시 자원. 읽기 전용으로 취급. VERIFY 후 삭제 대상.
│   └── <ds>/MANIFEST.json   ← 원본을 지워도 저장소에 별도 보관됨
├── interim/      # 중간 산출물. 재생성 가능. 자유롭게 삭제 가능.
├── processed/    # 파생물. 영구 자산. 백업 대상. 절대 자동 삭제 금지.
└── PURGE_LOG.md  # 삭제 이력
```

수명주기 정책 전문: `../docs/05-data-lifecycle.md` (ADR-0010)

## 요약 규칙

- `raw/`는 수정하지 않는다.
- `processed/`, `models/`, `eval/results/`는 어떤 정리 스크립트도 건드리지 않는다.
- 삭제는 VERIFY 게이트 통과 후 사람이 확인해 실행한다.
- 취득 즉시 `MANIFEST.json`을 쓴다. 이것이 재취득 지시서다.
