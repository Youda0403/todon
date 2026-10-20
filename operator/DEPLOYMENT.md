# Cloudflare 배포 확인

운영 앱은 main 브랜치의 operator 폴더에 있습니다. 이 안내가 포함된 커밋은 운영 앱 폴더가 존재하는 배포 기준점입니다.

- 레포: Youda0403/todon
- 브랜치: main
- 루트 디렉터리: operator
- 빌드 명령: 비움
- 배포 명령: npx wrangler deploy
- Worker 이름: todon-ops

`Failed: root directory not found`는 프로그램 실행 전에 지정한 폴더를 찾지 못했다는 뜻입니다. GitHub에 operator 폴더가 있는지와 Cloudflare가 선택한 커밋을 확인하세요. 레포 연결을 폴더 추가 전에 시작했다면 이전 커밋으로 빌드했을 가능성도 있습니다. 과거 빌드 재시도 대신 배포 목록에서 이 문서가 추가된 최신 커밋의 새 빌드를 확인하세요.

최신 커밋에서도 같은 오류가 계속되면 루트 디렉터리를 /로 바꾸고 배포 명령을 `npx wrangler deploy --config operator/wrangler.jsonc`로 지정할 수 있습니다. 두 설정은 함께 바꿔야 합니다.

이번 운영 앱 추가는 기존 러너 앱의 index.html, sw.js, manifest.json 또는 기존 테스트를 수정하지 않습니다. 기존 앱은 GitHub Pages 배포이며, 이 Worker의 실패 여부와 별도로 확인할 수 있습니다.
