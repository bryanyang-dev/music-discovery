import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function fixture(context, failure = "") {
  const root = mkdtempSync(join(tmpdir(), "upload-all-lambdas-test-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  const script = join(root, "scripts/upload-all-lambdas.sh");
  copyFileSync(new URL("../upload-all-lambdas.sh", import.meta.url), script);
  copyFileSync(
    new URL("../lambda-targets.sh", import.meta.url),
    join(root, "scripts/lambda-targets.sh"),
  );
  const trace = join(root, "trace.txt");
  writeFileSync(
    join(root, "scripts/upload-lambda.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$UPLOAD_ALL_TEST_TRACE"
if [[ "$2" == "$UPLOAD_ALL_TEST_FAILURE" ]]; then exit 9; fi
`,
  );
  return {
    run(args) {
      return spawnSync("bash", [script, ...args], {
        cwd: tmpdir(),
        encoding: "utf8",
        env: {
          ...process.env,
          UPLOAD_ALL_TEST_TRACE: trace,
          UPLOAD_ALL_TEST_FAILURE: failure,
        },
      });
    },
    calls() {
      return existsSync(trace)
        ? readFileSync(trace, "utf8").trim().split("\n")
        : [];
    },
  };
}

test("combined upload selects each app and forwards explicit targets, region and optional profile", (context) => {
  for (const profile of [[], ["development"]]) {
    const state = fixture(context);
    const result = state.run([
      "rss-test",
      "matcher-test",
      "us-east-2",
      ...profile,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const suffix = ["us-east-2", ...profile].join(" ");
    assert.deepEqual(state.calls(), [
      `--app ingestion rss-test ${suffix}`,
      `--app track-matcher matcher-test ${suffix}`,
    ]);
  }
});

test("combined upload uses the shared defaults when arguments are omitted", (context) => {
  const state = fixture(context);
  const result = state.run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(state.calls(), [
    "--app ingestion arn:aws:lambda:us-east-2:783161622181:function:musicRssFetcher us-east-2 music-discovery",
    "--app track-matcher arn:aws:lambda:us-east-2:783161622181:function:trackMatcher us-east-2 music-discovery",
  ]);
});

test("combined upload rejects incomplete, empty and identical targets before uploads", (context) => {
  for (const args of [
    ["rss-test"],
    ["rss-test", "matcher-test"],
    ["rss-test", "rss-test", "us-east-2"],
    ["", "matcher-test", "us-east-2"],
    ["rss-test", "", "us-east-2"],
    ["rss-test", "matcher-test", ""],
    ["rss-test", "matcher-test", "us-east-2", "profile", "extra"],
  ]) {
    const state = fixture(context);
    assert.equal(state.run(args).status, 1);
    assert.deepEqual(state.calls(), []);
  }
});

test("ingestion failure stops before matcher; matcher failure also propagates", (context) => {
  for (const failure of ["ingestion", "track-matcher"]) {
    const state = fixture(context, failure);
    assert.equal(
      state.run(["rss-test", "matcher-test", "us-east-2"]).status,
      9,
    );
    assert.equal(state.calls().length, failure === "ingestion" ? 1 : 2);
  }
});
