---
name: OpenAPI/Zod compatibility
description: Generated validators in this workspace use Zod 3, which does not expose the zod.int helper emitted for OpenAPI integer schemas.
---

Use numeric OpenAPI schemas for IDs when generating clients in this workspace, then enforce integer semantics at REST and WebSocket boundaries with Number.isInteger.

**Why:** Code generation succeeds but the chained library typecheck fails when an OpenAPI integer becomes zod.int() against the installed Zod 3 runtime.

**How to apply:** When adding ID/path schemas, prefer type number in the OpenAPI source and keep strict positive-integer checks in server handlers.