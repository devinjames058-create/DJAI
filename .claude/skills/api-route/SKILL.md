---
name: api-route
description: Build or modify Next.js API routes for AI, market data, and filings
---

## Rules
1. route handlers live in `app/api/`
2. validate all inputs with zod
3. use shared rate limiting, timeout, retry, and request-id utilities
4. return typed JSON contracts
5. normalize provider data before returning it
6. never leak secrets
7. document retryable vs non-retryable errors
8. cache aggressively but honestly
