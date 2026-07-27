# joesiheon496.github.io

논문·프로그램 정리 블로그. Hugo (extended) + PaperMod 테마(Hugo Modules), GitHub Actions 배포.

## 글 작성 (page bundle)

```
content/posts/<slug>/
├── index.md      # 글 본문
└── *.png|jpg     # 같은 폴더의 이미지 (상대경로로 참조)
```

- 마크다운 상대경로: `![설명](이미지.png)`
- 리사이즈(max-width 1200) + WebP: `{{< img src="이미지.png" alt="설명" caption="캡션" >}}`

## 로컬 실행

```bash
hugo server -D      # 초안(draft) 포함, http://localhost:1313
```

## 배포

`main` 브랜치에 push 하면 GitHub Actions가 빌드해 Pages에 배포합니다.
(`.github/workflows/hugo.yml`, gh-pages 브랜치 미사용)

## giscus 댓글

`hugo.toml` 의 `[params.giscus]` 에서 `repoId` / `categoryId` 를
[giscus.app](https://giscus.app) 에서 발급받아 채우면 활성화됩니다.
저장소 Discussions 활성화 + giscus 앱 설치 필요.
