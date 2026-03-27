---
name: deploy-check
description: Full pre-deployment verification
---
Run:
1. `npx tsc --noEmit`
2. `npm run lint`
3. `npm test`
4. `npm run build`
5. secret scan
6. console log scan
7. environment variable documentation check
8. summarize as DEPLOY READY or BLOCKED
