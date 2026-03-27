---
name: reliability
description: Improve resilience, fallbacks, retries, and observability for critical paths
---

## Workflow
1. identify the failure path
2. classify retryable vs terminal errors
3. add timeout and backoff where appropriate
4. preserve last-known-good data if safe
5. instrument metrics and logs
6. add regression tests for the failure mode
