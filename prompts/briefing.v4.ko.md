<!-- prompt_version: briefing.ko v4 -->
<!-- 이 파일은 자리표시자다. v4 는 2026-09-08 에 기본으로 승격됐다. -->

# briefing.v4.ko.md 는 prompts/briefing.ko.md 로 옮겨졌다

같은 내용을 두 파일에 두면 한쪽만 고쳐지는 날이 온다. v4 본문은
`prompts/briefing.ko.md` 에 있고, 승격 근거도 거기 있다.

이 파일을 지우지 않는 이유는 `eval/results/` 의 보고서들이 `prompt_file` 로 이
경로를 적어뒀기 때문이다. 경로가 사라지면 그 결과가 무엇으로 만들어졌는지 추적할
수 없게 된다.

재실행은 `-Prompt` 없이 기본값으로 한다.

    .\scripts\Invoke-AbstentionProbe.ps1 -Tag v4
