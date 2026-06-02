# API Versioning Strategy

## Overview

BACKit uses **URI-based versioning** (`/api/v1/...`) via NestJS `VersioningModule`.

## Current Versions

| Version | Status | Base Path |
|---------|--------|-----------|
| v1 | Active | `/api/v1/` |

## Rules

- All new endpoints **must** be placed under `/api/v1/`.
- Breaking changes require a new version prefix (`/api/v2/`).
- Deprecated endpoints return `Deprecation: true` and `Sunset: <date>` response headers.
- After the sunset date the `VersionGuard` returns **410 Gone**.

## Deprecating an Endpoint

```ts
import { Deprecated } from '../common/guards/version.guard';

@Get('old-endpoint')
@Deprecated('2025-12-31')
oldEndpoint() { ... }
```

## Health Endpoint Version

`GET /health` always returns the current API version:

```json
{ "status": "ok", "version": "1.0.0", "timestamp": "..." }
```
