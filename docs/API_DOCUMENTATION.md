# TaskFlow — REST API Specification

## 1. Global API Conventions

### 1.1 Base URL & Content Negotiation
- Base URL: `http://localhost:5000/api` (Production: `https://api.taskflow.io/api`)
- All requests containing a body must use `Content-Type: application/json`.
- All responses return `Content-Type: application/json`.
- Timestamps are formatted in ISO-8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`).

### 1.2 Authentication & Authorization Headers
Protected endpoints require an `Authorization` header containing a valid JSON Web Token (JWT):
```http
Authorization: Bearer <access_token>
```
Alternatively, automated agents may supply an API Key:
```http
X-API-Key: tf_live_9f83a2c0e81b...
```

### 1.3 Standard Error Format (RFC 7807 Compliant)
All error responses adhere to a uniform structure:
```json
{
  "success": false,
  "error": {
    "code": "INVALID_JOB_PAYLOAD",
    "message": "Field 'email' must be a valid email string.",
    "details": [
      {
        "field": "payload.email",
        "issue": "Must be a valid email address format"
      }
    ],
    "timestamp": "2026-11-06T20:00:00.000Z",
    "correlationId": "req-987a-bc12"
  }
}
```

---

## 2. Authentication Endpoints

### 2.1 Register New User
- **Route**: `POST /api/auth/register`
- **Auth**: Public
- **Description**: Registers a new user account with hashed credentials.
- **Request Body**:
  ```json
  {
    "username": "lead_engineer",
    "email": "engineer@taskflow.dev",
    "password": "SecurePassword123!"
  }
  ```
- **Validation**:
  - `username`: String, 3-30 characters, alphanumeric only.
  - `email`: Valid email syntax, unique in database.
  - `password`: String, min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 symbol.
- **Response `201 Created`**:
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "id": "672bd8a123f1a00192e4b101",
        "username": "lead_engineer",
        "email": "engineer@taskflow.dev",
        "role": "developer",
        "createdAt": "2026-11-06T20:00:00.000Z"
      },
      "tokens": {
        "accessToken": "eyJhbGciOiJIUzI1Ni...",
        "expiresIn": 900
      }
    }
  }
  ```
- **Error Codes**: `400 Bad Request` (validation failed), `409 Conflict` (username/email already taken).

---

### 2.2 Login User
- **Route**: `POST /api/auth/login`
- **Auth**: Public
- **Description**: Authenticates user credentials and issues an Access Token & HTTP-only Refresh Token cookie.
- **Request Body**:
  ```json
  {
    "email": "engineer@taskflow.dev",
    "password": "SecurePassword123!"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "id": "672bd8a123f1a00192e4b101",
        "username": "lead_engineer",
        "email": "engineer@taskflow.dev",
        "role": "developer"
      },
      "accessToken": "eyJhbGciOiJIUzI1Ni...",
      "expiresIn": 900
    }
  }
  ```
- **Error Codes**: `400 Bad Request` (missing fields), `401 Unauthorized` (invalid email or password).

---

### 2.3 Get Current Authenticated Profile
- **Route**: `GET /api/auth/me`
- **Auth**: Bearer Token required (`viewer`, `developer`, `admin`)
- **Description**: Returns authenticated session details and system permissions.
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "672bd8a123f1a00192e4b101",
      "name": "lead_engineer",
      "email": "engineer@taskflow.dev",
      "role": "developer",
      "isActive": true,
      "createdAt": "2026-11-06T20:00:00.000Z"
    }
  }
  ```
- **Error Codes**: `401 Unauthorized` (missing/expired token).

---

### 2.4 Rotate Refresh Token
- **Route**: `POST /api/auth/refresh`
- **Auth**: Public (requires valid HttpOnly cookie `refreshToken` or JSON body `{ "refreshToken": "<token>" }`)
- **Description**: Performs cryptographically secure refresh token rotation and breach/reuse detection. Issues a fresh Access Token (15m) and new Refresh Token (7d).
- **Request Body** (optional if HttpOnly cookie present):
  ```json
  {
    "refreshToken": "4x_9B3..."
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "id": "672bd8a123f1a00192e4b101",
        "name": "lead_engineer",
        "email": "engineer@taskflow.dev",
        "role": "developer"
      },
      "tokens": {
        "accessToken": "eyJhbGciOiJIUzI1Ni...",
        "expiresIn": 900,
        "refreshToken": "8y_1A2..."
      }
    },
    "message": "Token refreshed successfully"
  }
  ```
- **Error Codes**: `401 Unauthorized` (expired token, missing token, or token reuse detected).

---

### 2.5 Logout & Revoke Session
- **Route**: `POST /api/auth/logout`
- **Auth**: Optional Bearer Token or Refresh Token
- **Description**: Invalidates the active refresh token family and clears the `refreshToken` cookie.
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "message": "Successfully logged out and session revoked"
    }
  }
  ```

---

## 3. Job Management Endpoints

### 3.1 Submit a Job
- **Route**: `POST /api/jobs`
- **Auth**: `developer`, `admin`
- **Headers**: Optional `Idempotency-Key: <UUID>`
- **Description**: Validates payload, stores job in MongoDB, and enqueues to BullMQ Redis.
- **Request Body**:
  ```json
  {
    "queueName": "email-notifications",
    "name": "Welcome Email #1094",
    "type": "SEND_WELCOME_EMAIL",
    "payload": {
      "to": "user@example.com",
      "templateId": "tmpl_welcome_v2"
    },
    "priority": 1,
    "maxRetries": 3,
    "backoffPolicy": {
      "type": "exponential",
      "delayMs": 1000
    },
    "delayMs": 0,
    "tags": ["transactional", "onboarding"]
  }
  ```
- **Validation**:
  - `queueName`: Required, alphanumeric string matching existing queue.
  - `name`: Required string, 1-100 characters.
  - `type`: Required string.
  - `payload`: Non-empty object.
  - `priority`: Integer between 1 (highest) and 10 (lowest).
  - `maxRetries`: Integer between 0 and 10.
- **Response `201 Created`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "672bd9b231a4c90192e4b204",
      "bullJobId": "10492",
      "name": "Welcome Email #1094",
      "queueName": "email-notifications",
      "status": "QUEUED",
      "priority": 1,
      "idempotencyKey": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "createdAt": "2026-11-06T20:05:00.000Z"
    }
  }
  ```
- **Error Codes**: `400 Bad Request` (schema validation failed), `404 Not Found` (queue not found), `409 Conflict` (idempotency key conflict).

---

### 3.2 List Jobs (Filtered & Paginated)
- **Route**: `GET /api/jobs`
- **Auth**: `viewer`, `developer`, `admin`
- **Query Parameters**:
  - `queueId`: Filter by Queue ObjectId
  - `status`: Filter by enum (`QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, `RETRYING`, `DEAD_LETTER`, `CANCELLED`)
  - `search`: Case-insensitive substring match on `name` or `tags`
  - `page`: Default `1`
  - `limit`: Default `20`, Max `100`
  - `sortBy`: Default `createdAt`, Sort order: `asc` or `desc`
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "jobs": [
        {
          "id": "672bd9b231a4c90192e4b204",
          "name": "Welcome Email #1094",
          "type": "SEND_WELCOME_EMAIL",
          "status": "COMPLETED",
          "priority": 1,
          "currentRetries": 0,
          "createdAt": "2026-11-06T20:05:00.000Z",
          "updatedAt": "2026-11-06T20:05:02.120Z"
        }
      ],
      "pagination": {
        "totalItems": 1540,
        "totalPages": 77,
        "currentPage": 1,
        "limit": 20
      }
    }
  }
  ```
- **Error Codes**: `400 Bad Request` (invalid query params).

---

### 3.3 Get Job by ID
- **Route**: `GET /api/jobs/:id`
- **Auth**: `viewer`, `developer`, `admin`
- **Description**: Returns detailed job metadata, results, and full execution history log.
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "672bd9b231a4c90192e4b204",
      "name": "Welcome Email #1094",
      "type": "SEND_WELCOME_EMAIL",
      "status": "COMPLETED",
      "payload": { "to": "user@example.com" },
      "result": { "messageId": "msg_01HK98A" },
      "priority": 1,
      "maxRetries": 3,
      "currentRetries": 0,
      "executions": [
        {
          "attemptNumber": 1,
          "workerId": "worker-node-prod-01:3140",
          "status": "COMPLETED",
          "startedAt": "2026-11-06T20:05:01.000Z",
          "completedAt": "2026-11-06T20:05:02.120Z",
          "durationMs": 1120,
          "memoryUsageBytes": 84920000,
          "logs": [
            { "timestamp": "2026-11-06T20:05:01.100Z", "level": "info", "message": "Rendered email template." },
            { "timestamp": "2026-11-06T20:05:02.100Z", "level": "info", "message": "Dispatched via SMTP relay." }
          ]
        }
      ],
      "createdAt": "2026-11-06T20:05:00.000Z"
    }
  }
  ```
- **Error Codes**: `400 Bad Request` (invalid ObjectId), `404 Not Found` (job does not exist).

---

### 3.4 Cancel In-Flight / Queued Job
- **Route**: `POST /api/jobs/:id/cancel`
- **Auth**: `developer`, `admin`
- **Description**: Aborts execution if processing; removes from BullMQ Redis queue if waiting.
- **Request Body**: None (or optional `{"reason": "User requested abort"}`)
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "672bd9b231a4c90192e4b204",
      "status": "CANCELLED",
      "cancelledAt": "2026-11-06T20:06:10.000Z"
    }
  }
  ```
- **Error Codes**: `400 Bad Request` (job already completed or cancelled), `404 Not Found`.

---

### 3.5 Manual Retry Job
- **Route**: `POST /api/jobs/:id/retry`
- **Auth**: `developer`, `admin`
- **Description**: Re-enqueues a `FAILED` or `DEAD_LETTER` job with fresh retry attempts.
- **Request Body**: None
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "672bd9b231a4c90192e4b204",
      "status": "QUEUED",
      "bullJobId": "10501",
      "message": "Job successfully rescheduled for processing."
    }
  }
  ```
- **Error Codes**: `400 Bad Request` (job is not in FAILED or DEAD_LETTER state), `404 Not Found`.

---

## 4. Queue Management Endpoints

### 4.1 Create New Queue
- **Route**: `POST /api/queues`
- **Auth**: `admin`
- **Request Body**:
  ```json
  {
    "name": "video-transcoding",
    "description": "High-compute FFmpeg transcoding queue",
    "defaultPriority": 3,
    "maxConcurrency": 5,
    "rateLimit": {
      "maxJobs": 100,
      "durationMs": 60000
    }
  }
  ```
- **Validation**:
  - `name`: Alphanumeric, underscores/hyphens, unique.
  - `maxConcurrency`: Integer, 1-100.
  - `defaultPriority`: Integer, 1-10.
- **Response `201 Created`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "672bda0141f1a10192e4b301",
      "name": "video-transcoding",
      "status": "active",
      "maxConcurrency": 5,
      "createdAt": "2026-11-06T20:07:00.000Z"
    }
  }
  ```
- **Error Codes**: `400 Bad Request` (invalid data), `403 Forbidden` (non-admin), `409 Conflict` (queue already exists).

---

### 4.2 List All Queues
- **Route**: `GET /api/queues`
- **Auth**: `viewer`, `developer`, `admin`
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "672bda0141f1a10192e4b301",
        "name": "video-transcoding",
        "status": "active",
        "maxConcurrency": 5,
        "jobCounts": {
          "waiting": 12,
          "active": 4,
          "delayed": 2,
          "failed": 0,
          "completed": 1290
        }
      }
    ]
  }
  ```

---

### 4.3 Get Real-Time Queue Statistics
- **Route**: `GET /api/queues/:id/stats`
- **Auth**: `viewer`, `developer`, `admin`
- **Description**: Real-time snapshot of Redis memory, counts, and 60-second throughput.
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "queueId": "672bda0141f1a10192e4b301",
      "name": "video-transcoding",
      "isPaused": false,
      "counts": {
        "waiting": 12,
        "active": 4,
        "delayed": 2,
        "failed": 1,
        "completed": 1290
      },
      "throughput": {
        "completedLastMinute": 48,
        "failedLastMinute": 0
      },
      "estimatedWaitTimeMs": 2400
    }
  }
  ```

---

## 5. Worker Monitoring Endpoints

### 5.1 List Active Workers
- **Route**: `GET /api/workers`
- **Auth**: `viewer`, `developer`, `admin`
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": [
      {
        "workerId": "worker-prod-az1-pid-4091",
        "hostname": "ip-10-0-1-42",
        "pid": 4091,
        "queuesSubscribed": ["email-notifications", "video-transcoding"],
        "concurrency": 10,
        "activeJobCount": 6,
        "status": "healthy",
        "lastHeartbeat": "2026-11-06T20:08:45.000Z",
        "version": "1.0.0"
      }
    ]
  }
  ```

---

### 5.2 Get Worker Details
- **Route**: `GET /api/workers/:id`
- **Auth**: `viewer`, `developer`, `admin`
- **Description**: Detailed telemetry and recent job execution log for a specific worker instance.
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "workerId": "worker-prod-az1-pid-4091",
      "status": "healthy",
      "uptimeSeconds": 86400,
      "systemMetrics": {
        "rssMemoryBytes": 134217728,
        "heapUsedBytes": 78912304,
        "cpuPercent": 14.2
      },
      "currentJobs": [
        {
          "jobId": "672bd9b231a4c90192e4b204",
          "name": "Welcome Email #1094",
          "elapsedMs": 450
        }
      ]
    }
  }
  ```
- **Error Codes**: `404 Not Found`.

---

## 6. Analytics Endpoints

### 6.1 Get Platform Overview
- **Route**: `GET /api/analytics/overview`
- **Auth**: `viewer`, `developer`, `admin`
- **Query Parameters**: `timeframe` (`1h`, `24h`, `7d`, `30d`)
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "timeframe": "24h",
      "summary": {
        "totalProcessed": 48120,
        "successCount": 47690,
        "failureCount": 430,
        "successRatePct": 99.1,
        "activeWorkers": 8,
        "totalQueues": 4
      },
      "statusDistribution": {
        "COMPLETED": 47690,
        "FAILED": 210,
        "DEAD_LETTER": 220,
        "CANCELLED": 45
      }
    }
  }
  ```

---

### 6.2 Get Performance Telemetry
- **Route**: `GET /api/analytics/performance`
- **Auth**: `viewer`, `developer`, `admin`
- **Query Parameters**: `queueId` (optional), `interval` (`5m`, `1h`)
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "latency": {
        "p50DurationMs": 240,
        "p90DurationMs": 890,
        "p99DurationMs": 2840,
        "averageWaitTimeMs": 145
      },
      "timeSeries": [
        {
          "timestamp": "2026-11-06T19:00:00.000Z",
          "throughput": 1950,
          "failures": 12,
          "avgDurationMs": 310
        },
        {
          "timestamp": "2026-11-06T20:00:00.000Z",
          "throughput": 2140,
          "failures": 8,
          "avgDurationMs": 295
        }
      ]
    }
  }
  ```
