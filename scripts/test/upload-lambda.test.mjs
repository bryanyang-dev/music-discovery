import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function fixture(context, failure = "") {
  const root = mkdtempSync(join(tmpdir(), "lambda-upload-test-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ["scripts", "bin", "dist/ingestion"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  const script = join(root, "scripts/upload-lambda.sh");
  copyFileSync(new URL("../upload-lambda.sh", import.meta.url), script);
  writeFileSync(join(root, "dist/ingestion/index.cjs"), "exports.handler = async () => ({});\n");
  const trace = join(root, "trace.jsonl");
  for (const command of ["aws", "pnpm"]) {
    const path = join(root, "bin", command);
    writeFileSync(path, `#!${process.execPath}
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.UPLOAD_TEST_TRACE, JSON.stringify({ command: '${command}', args }) + '\\n');
if (process.env.UPLOAD_TEST_FAILURE === args[0] || process.env.UPLOAD_TEST_FAILURE === args[1] || process.env.UPLOAD_TEST_FAILURE === args[2]) process.exit(9);
if ('${command}' === 'aws' && args[1] === 'get-function-configuration') {
  console.log(process.env.UPLOAD_TEST_CONFIGURATION || 'nodejs24.x\\tindex.handler\\tZip\\trevision-123');
}
if ('${command}' === 'aws' && args[1] === 'update-function-code') {
  const archive = args[args.indexOf('--zip-file') + 1].slice('fileb://'.length);
  fs.appendFileSync(process.env.UPLOAD_TEST_TRACE, JSON.stringify({ archiveEntries: execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim() }) + '\\n');
}
`);
    chmodSync(path, 0o755);
  }
  return {
    run(args = ["rss-test", "us-east-2", "development"], configuration) {
      return spawnSync("bash", [script, ...args], {
        cwd: tmpdir(), encoding: "utf8",
        env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`,
          UPLOAD_TEST_TRACE: trace, UPLOAD_TEST_FAILURE: failure,
          UPLOAD_TEST_CONFIGURATION: configuration ?? "" },
      });
    },
    calls() {
      return readFileSync(trace, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    },
  };
}

test("upload checks, builds, packages only the handler, updates with revision protection, then waits", (context) => {
  const state = fixture(context);
  const result = state.run();
  assert.equal(result.status, 0, result.stderr);
  const calls = state.calls();
  assert.deepEqual(calls.filter((call) => call.command === "pnpm").map((call) => call.args), [
    ["typecheck"], ["test"], ["test:bundle"],
  ]);
  assert.equal(calls.find((call) => call.archiveEntries)?.archiveEntries, "index.cjs");
  const awsCalls = calls.filter((call) => call.command === "aws");
  assert.deepEqual(awsCalls.map((call) => call.args.slice(0, 2)), [
    ["lambda", "get-function-configuration"], ["lambda", "update-function-code"], ["lambda", "wait"],
  ]);
  for (const { args } of awsCalls) {
    assert.equal(args[args.indexOf("--function-name") + 1], "rss-test");
    assert.equal(args[args.indexOf("--region") + 1], "us-east-2");
    assert.equal(args[args.indexOf("--profile") + 1], "development");
  }
  const update = awsCalls[1].args;
  assert.equal(update[update.indexOf("--revision-id") + 1], "revision-123");
  assert.equal(awsCalls[2].args[2], "function-updated-v2");
});

for (const failure of ["get-function-configuration", "typecheck", "test", "test:bundle", "update-function-code", "function-updated-v2"]) {
  test(`failure in ${failure} stops deployment and reports failure`, (context) => {
    const state = fixture(context, failure);
    const result = state.run();
    assert.equal(result.status, 9);
    assert.ok(!result.stdout.includes("Upload completed"));
    if (!["update-function-code", "function-updated-v2"].includes(failure)) {
      assert.ok(!state.calls().some((call) => call.args?.includes("update-function-code")));
    }
  });
}

test("incomplete arguments and an incompatible function fail before uploading", (context) => {
  const state = fixture(context);
  assert.equal(state.run(["rss-test"]).status, 1);
  const result = state.run(undefined, "nodejs22.x\tindex.handler\tZip\trevision-123");
  assert.equal(result.status, 1);
  assert.equal(state.calls().length, 1);
});

test("no arguments selects musicRssFetcher in the verified account and region", (context) => {
  const state = fixture(context);
  const result = state.run([]);
  assert.equal(result.status, 0, result.stderr);
  for (const { args } of state.calls().filter((call) => call.command === "aws")) {
    assert.equal(args[args.indexOf("--function-name") + 1], "arn:aws:lambda:us-east-2:783161622181:function:musicRssFetcher");
    assert.equal(args[args.indexOf("--region") + 1], "us-east-2");
    assert.equal(args[args.indexOf("--profile") + 1], "music-discovery");
  }
});

test("profile can be omitted to use the normal AWS credential selection", (context) => {
  const state = fixture(context);
  const result = state.run(["rss-test", "us-east-2"]);
  assert.equal(result.status, 0, result.stderr);
  for (const call of state.calls().filter((call) => call.command === "aws")) {
    assert.ok(!call.args.includes("--profile"));
  }
});
