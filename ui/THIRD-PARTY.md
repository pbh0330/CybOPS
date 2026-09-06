# 서드파티 자산

이 디렉터리에 포함되거나 번들에 들어가는 외부 자산의 출처와 라이선스를 적는다.
CLAUDE.md 작업 규칙: 외부 자산을 도입하면 라이선스와 재배포 가능 여부를 함께 적는다.

## Tabler Icons (장비 아이콘)

- 출처: https://tabler.io/icons , https://github.com/tabler/tabler-icons
- 라이선스: **MIT**
- 재배포: **가능.** 저작권 고지와 라이선스 문구를 포함하면 상업적 사용·수정·재배포에
  제한이 없다. 출처 표기 의무가 UI 화면에 붙지 않는다.
- 사용 형태: `ui/src/icons.js`에 필요한 14개 아이콘의 path 데이터만 인라인으로 넣었다.
  런타임에 CDN을 받지 않으므로 오프라인 번들 요구(ADR-0018)와 맞는다.
- npm 의존성(`@tabler/icons`)은 아이콘 추출에만 쓰고 번들에는 들어가지 않는다.

```
MIT License

Copyright (c) 2020-2025 Pawel Kuna

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 왜 Flaticon을 쓰지 않았나

Flaticon 무료 라이선스는 **출처 표기가 의무**이고, 다운로드에 계정 로그인이 필요하며,
아이콘 파일 자체의 재배포에 제약이 있다. 이 저장소는 공개 저장소이고 번들을 그대로
배포할 계획이므로(ADR-0018), 표기 의무와 재배포 제약이 없는 MIT 자산을 골랐다.
그림체는 같은 계열의 선 아이콘이다.

## milsymbol

- 출처: https://github.com/spatialillusions/milsymbol
- 라이선스: **MIT**
- 용도: MIL-STD-2525 심볼 렌더링(ADR-0013). npm 의존성으로 번들에 포함된다.

## Cytoscape.js / cytoscape-dagre / dagre / Vite

- Cytoscape.js: MIT
- cytoscape-dagre: MIT
- dagre: MIT
- Vite: MIT
