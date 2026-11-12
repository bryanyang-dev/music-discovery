import assert from "node:assert/strict";
import { test } from "node:test";
import { IngestionError } from "@music-discovery/shared";
import { createDatabaseCallLogger } from "../src/database-logging.ts";
import { DATABASE_RESPONSE_LOG_LIMITS } from "../src/database-response-sanitization.ts";
import { boundDatabaseOperation } from "../src/deadline.ts";

function fixture() {
  const records: Record<string, unknown>[] = [];
  const logger = {
    log: (message: string) => {
      records.push(JSON.parse(message));
    },
    error: (message: string) => {
      records.push(JSON.parse(message));
    },
  };
  return {
    records,
    logCall: createDatabaseCallLogger({
      logger,
      requestId: "request-1",
      sourceKey: "registered_feed",
    }),
  };
}

test("each query logs correlated response rows with sensitive values redacted", async () => {
  const { records, logCall } = fixture();
  const rows = Object.assign(
    [
      {
        id: "row-1",
        key: "registered_feed",
        password: "private-row-value",
        feedUrl: "https://example.org/?token=secret",
      },
    ],
    { count: 3 },
  );
  const result = await logCall(
    {
      scope: "query",
      operation: "select_source",
      parentCallId: "transaction-1",
    },
    async () => {
      assert.equal(records.length, 1);
      assert.equal(records[0]?.event, "database_request");
      return rows;
    },
  );
  assert.equal(result, rows);
  assert.equal(records.length, 2);
  const [request, response] = records;
  assert.equal(response?.event, "database_response");
  assert.equal(request?.callId, response?.callId);
  assert.equal(response?.parentCallId, "transaction-1");
  assert.equal(response?.operation, "select_source");
  assert.equal(response?.status, "succeeded");
  assert.equal(response?.rowCount, 1);
  assert.equal(response?.affectedRowCount, 3);
  assert.ok(
    typeof response?.durationMs === "number" && response.durationMs >= 0,
  );
  assert.ok(
    records.every(
      (record) =>
        record.requestId === "request-1" &&
        record.sourceKey === "registered_feed",
    ),
  );
  assert.deepEqual(response?.response, [
    { id: "row-1", key: "registered_feed", feedUrl: "https://example.org/" },
  ]);
  assert.equal(response?.responseTruncated, false);
  assert.doesNotMatch(
    JSON.stringify(records),
    /private-row-value|token=secret|password/,
  );
  assert.equal(rows[0]?.feedUrl, "https://example.org/?token=secret");
});

test("query failures log classified codes and rethrow the original failure without SQL or parameters", async () => {
  const { records, logCall } = fixture();
  const failure = new Error("insert secret SQL", {
    cause: { code: "42501", password: "private" },
  });
  await assert.rejects(
    logCall({ scope: "query", operation: "insert_source" }, async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(records.length, 2);
  assert.equal(records[1]?.callId, records[0]?.callId);
  assert.equal(records[1]?.status, "failed");
  assert.equal(records[1]?.level, "ERROR");
  assert.equal(records[1]?.code, "DATABASE_PERMISSION_ERROR");
  assert.doesNotMatch(
    JSON.stringify(records),
    /secret|private|password|insert secret SQL/,
  );
});

test("empty results, void responses and upsert outcomes have safe summaries", async () => {
  for (const result of [
    [],
    undefined,
    null,
    "inserted",
    "updated",
    "unchanged",
  ] as const) {
    const { records, logCall } = fixture();
    assert.equal(
      await logCall(
        { scope: "transaction", operation: "upsertTrack" },
        async () => result,
      ),
      result,
    );
    assert.equal(records[1]?.status, "succeeded");
    if (typeof result === "string") {
      assert.equal(records[1]?.outcome, result);
    } else if (Array.isArray(result)) {
      assert.equal(records[1]?.rowCount, 0);
    } else {
      assert.equal(records[1]?.hasResult, false);
    }
  }
});

test("logging failures cannot change database results, errors or shutdown", async () => {
  const logCall = createDatabaseCallLogger({
    logger: {
      log() {
        throw new Error("broken logger");
      },
      error() {
        throw new Error("broken logger");
      },
    },
  });
  assert.equal(
    await logCall(
      { scope: "query", operation: "select_source" },
      async () => 42,
    ),
    42,
  );
  const failure = new IngestionError("DATABASE_TIMEOUT");
  await assert.rejects(
    logCall({ scope: "query", operation: "select_source" }, async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  let closed = false;
  await logCall({ scope: "connection", operation: "close" }, async () => {
    closed = true;
  });
  assert.equal(closed, true);
});

test("timeouts log a failed transaction and ignore late success", async () => {
  const { records, logCall } = fixture();
  let finish: ((value: string) => void) | undefined;
  const operation = logCall(
    { scope: "transaction", operation: "getSource" },
    () =>
      boundDatabaseOperation(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
        async () => {},
        { timeoutMs: 5 },
      ),
  );
  await assert.rejects(operation, /DATABASE_TIMEOUT/);
  finish?.("late");
  await Promise.resolve();
  assert.equal(records.length, 2);
  assert.equal(records[1]?.status, "failed");
  assert.equal(records[1]?.code, "DATABASE_TIMEOUT");
});

test("concurrent operations retain distinct call IDs", async () => {
  const { records, logCall } = fixture();
  await Promise.all(
    [1, 2].map((value) =>
      logCall(
        { scope: "query", operation: "select_source" },
        async () => value,
      ),
    ),
  );
  const requests = records.filter(
    (record) => record.event === "database_request",
  );
  assert.equal(new Set(requests.map((record) => record.callId)).size, 2);
  for (const request of requests) {
    assert.equal(
      records.filter((record) => record.callId === request.callId).length,
      2,
    );
  }
});

test("source responses include configuration while validators, GUIDs and unknown fields are redacted", async () => {
  const { records, logCall } = fixture();
  const source = {
    id: "source-1",
    key: "registered_feed",
    name: "pitchfork",
    category: "best_new_track",
    enabled: true,
    feedUrl: "https://pitchfork.com/feed/custom?token=private#fragment",
    etag: '"private-validator"',
    lastModified: "private-validator",
    sourceGuid: "https://example.org/?token=private",
    connectionString: "postgres://user:private@host/db",
    createdAt: new Date("2026-11-11T00:00:00Z"),
  };
  assert.equal(
    await logCall(
      { scope: "transaction", operation: "getSource" },
      async () => source,
    ),
    source,
  );
  assert.deepEqual(records[1]?.response, {
    id: "source-1",
    key: "registered_feed",
    name: "pitchfork",
    category: "best_new_track",
    enabled: true,
    feedUrl: "https://pitchfork.com/feed/custom",
    etag: "[redacted]",
    lastModified: "[redacted]",
    sourceGuid: "[redacted]",
    createdAt: "2026-11-11T00:00:00.000Z",
  });
  assert.doesNotMatch(
    JSON.stringify(records),
    /private|fragment|postgres:\/\//,
  );
});

test("response logging bounds rows, text and arrays without mutating the returned result", async () => {
  const { records, logCall } = fixture();
  const longTitle = "x".repeat(
    DATABASE_RESPONSE_LOG_LIMITS.maxStringCharacters + 1,
  );
  const rows = Array.from(
    { length: DATABASE_RESPONSE_LOG_LIMITS.maxRows + 1 },
    () => ({
      trackTitle: longTitle,
      artists: Array.from(
        { length: DATABASE_RESPONSE_LOG_LIMITS.maxArrayItems + 1 },
        () => "Artist",
      ),
    }),
  );
  assert.equal(
    await logCall(
      { scope: "query", operation: "select_existing_track" },
      async () => rows,
    ),
    rows,
  );
  const response = records[1]?.response as {
    trackTitle: string;
    artists: string[];
  }[];
  assert.equal(response.length, DATABASE_RESPONSE_LOG_LIMITS.maxRows);
  assert.equal(
    response[0]?.trackTitle.length,
    DATABASE_RESPONSE_LOG_LIMITS.maxStringCharacters,
  );
  assert.equal(
    response[0]?.artists.length,
    DATABASE_RESPONSE_LOG_LIMITS.maxArrayItems,
  );
  assert.equal(records[1]?.responseTruncated, true);
  assert.equal(rows[0]?.trackTitle, longTitle);
  assert.equal(rows.length, DATABASE_RESPONSE_LOG_LIMITS.maxRows + 1);
});

test("oversized multibyte responses use a bounded placeholder", async () => {
  const { records, logCall } = fixture();
  const rows = [
    {
      artists: Array.from(
        { length: DATABASE_RESPONSE_LOG_LIMITS.maxArrayItems },
        () => "界".repeat(DATABASE_RESPONSE_LOG_LIMITS.maxStringCharacters),
      ),
      labels: Array.from(
        { length: DATABASE_RESPONSE_LOG_LIMITS.maxArrayItems },
        () => "界".repeat(DATABASE_RESPONSE_LOG_LIMITS.maxStringCharacters),
      ),
    },
  ];
  await logCall(
    { scope: "query", operation: "select_existing_track" },
    async () => rows,
  );
  assert.equal(records[1]?.responseTruncated, true);
  assert.equal(
    records[1]?.response,
    "[response omitted: exceeds log size limit]",
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(records[1]?.response)) <
      DATABASE_RESPONSE_LOG_LIMITS.maxResponseBytes,
  );
});

test("unexpected response accessors cannot turn successful database work into a failure", async () => {
  const { records, logCall } = fixture();
  const result = {
    get id() {
      throw new Error("private getter details");
    },
  };
  assert.equal(
    await logCall(
      { scope: "transaction", operation: "getSource" },
      async () => result,
    ),
    result,
  );
  assert.equal(records[1]?.status, "succeeded");
  assert.equal(records[1]?.response, "[response unavailable]");
  assert.doesNotMatch(JSON.stringify(records), /private getter details/);
});

test("Spotify result logs allow public recording fields while preserving redaction", async () => {
  const { records, logCall } = fixture();
  await logCall(
    { scope: "query", operation: "select_existing_spotify_match" },
    async () => [
      {
        matchStatus: "matched",
        providerTrackId: "1234567890123456789012",
        providerTitle: "Song",
        providerArtists: ["Artist"],
        providerUrl:
          "https://open.spotify.com/track/1234567890123456789012?token=synthetic-secret-marker",
        lastErrorCode: "synthetic-secret-marker",
        access_token: "synthetic-secret-marker",
        clientSecret: "synthetic-secret-marker",
      },
    ],
  );
  const response = records[1]?.response as Record<string, unknown>[];
  assert.equal(response[0]?.matchStatus, "matched");
  assert.deepEqual(response[0]?.providerArtists, ["Artist"]);
  assert.equal(
    response[0]?.providerUrl,
    "https://open.spotify.com/track/1234567890123456789012",
  );
  assert.equal(response[0]?.lastErrorCode, "[redacted]");
  assert.ok(!JSON.stringify(records).includes("synthetic-secret-marker"));
});
