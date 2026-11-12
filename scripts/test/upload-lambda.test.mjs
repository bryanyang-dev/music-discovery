import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function fixture(context, failure = "", session = "") {
  const root = mkdtempSync(join(tmpdir(), "lambda-upload-test-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ["scripts", "bin", "dist/ingestion", "dist/track-matcher", "certs"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  const script = join(root, "scripts/upload-lambda.sh");
  copyFileSync(new URL("../upload-lambda.sh", import.meta.url), script);
  copyFileSync(new URL("../lambda-targets.sh", import.meta.url), join(root, "scripts/lambda-targets.sh"));
  writeFileSync(join(root, "dist/ingestion/index.cjs"), "exports.handler = async () => ({});\n");
  writeFileSync(join(root, "dist/track-matcher/index.cjs"), "exports.handler = async () => ({ provider: 'spotify' });\n");
  const certificatePath = join(root, "certs/prod-ca-2021.crt");
  copyFileSync(new URL("../../certs/prod-ca-2021.crt", import.meta.url), certificatePath);
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
  const configurationCalls = fs.readFileSync(process.env.UPLOAD_TEST_TRACE, 'utf8').trim().split('\\n')
    .map(line => JSON.parse(line)).filter(call => call.command === 'aws' && call.args?.[1] === 'get-function-configuration').length;
  if (process.env.UPLOAD_TEST_SESSION === 'always-expired' || (process.env.UPLOAD_TEST_SESSION === 'expired' && configurationCalls === 1)) {
    console.error("aws: [ERROR]: Your session has expired. Please reauthenticate using 'aws login'.");
    process.exit(255);
  }
  console.log(process.env.UPLOAD_TEST_CONFIGURATION || 'nodejs24.x\\tindex.handler\\tZip\\trevision-123');
}
if ('${command}' === 'aws' && args[1] === 'update-function-code') {
  const archive = args[args.indexOf('--zip-file') + 1].slice('fileb://'.length);
  fs.appendFileSync(process.env.UPLOAD_TEST_TRACE, JSON.stringify({ bundle: execFileSync('unzip', ['-p', archive, 'index.cjs'], { encoding: 'utf8' }), archiveEntries: execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim(), certificate: execFileSync('unzip', ['-p', archive, 'prod-ca-2021.crt'], { encoding: 'utf8' }) }) + '\\n');
}
`);
    chmodSync(path, 0o755);
  }
  return {
    certificatePath,
    run(args = ["rss-test", "us-east-2", "development"], configuration) {
      return spawnSync("bash", [script, ...args], {
        cwd: tmpdir(), encoding: "utf8",
        env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`,
          UPLOAD_TEST_TRACE: trace, UPLOAD_TEST_FAILURE: failure,
          UPLOAD_TEST_SESSION: session,
          UPLOAD_TEST_CONFIGURATION: configuration ?? "" },
      });
    },
    calls() {
      if (!existsSync(trace)) return [];
      return readFileSync(trace, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    },
  };
}

test("upload checks, builds, packages the handler and CA certificate, updates with revision protection, then waits", (context) => {
  const state = fixture(context);
  const result = state.run();
  assert.equal(result.status, 0, result.stderr);
  const calls = state.calls();
  assert.deepEqual(calls.filter((call) => call.command === "pnpm").map((call) => call.args), [
    ["typecheck"], ["test"], ["test:bundle"],
  ]);
  const archive = calls.find((call) => call.archiveEntries);
  assert.deepEqual(archive.archiveEntries.split("\n").sort(), ["index.cjs", "prod-ca-2021.crt"]);
  assert.equal(archive.certificate, readFileSync(state.certificatePath, "utf8"));
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

test("default and explicit ingestion selectors target musicRssFetcher in the verified account and region", (context) => {
  for (const args of [[], ["--app", "ingestion"]]) {
    const state = fixture(context);
    const result = state.run(args);
    assert.equal(result.status, 0, result.stderr);
    for (const { args } of state.calls().filter((call) => call.command === "aws")) {
      assert.equal(args[args.indexOf("--function-name") + 1], "arn:aws:lambda:us-east-2:783161622181:function:musicRssFetcher");
      assert.equal(args[args.indexOf("--region") + 1], "us-east-2");
      assert.equal(args[args.indexOf("--profile") + 1], "music-discovery");
    }
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

test("expired sessions log in with the selected profile/region and retry once before building", (context) => {
  for (const args of [[], ["rss-test", "us-east-2", "development"], ["rss-test", "us-east-2"]]) {
    const state = fixture(context, "", "expired");
    const result = state.run(args);
    assert.equal(result.status, 0, result.stderr);
    const calls = state.calls();
    assert.deepEqual(calls.slice(0, 4).map(call => [call.command, ...call.args.slice(0, 2)]), [
      ["aws", "lambda", "get-function-configuration"],
      ["aws", "login", "--region"],
      ["aws", "lambda", "get-function-configuration"],
      ["pnpm", "typecheck"],
    ]);
    const login = calls[1].args;
    assert.equal(login[login.indexOf("--region") + 1], "us-east-2");
    if (args.length === 2) {
      assert.ok(!login.includes("--profile"));
    } else {
      assert.equal(login[login.indexOf("--profile") + 1], args[2] ?? "music-discovery");
    }
    assert.match(result.stdout, /Upload completed/);
  }
});

test("failed login or repeated expiry stops before building or uploading", (context) => {
  for (const [failure, session, expectedStatus] of [["login", "expired", 9], ["", "always-expired", 255]]) {
    const state = fixture(context, failure, session);
    const result = state.run();
    assert.equal(result.status, expectedStatus);
    const calls = state.calls();
    assert.equal(calls.filter(call => call.args?.[0] === "login").length, 1);
    assert.ok(!calls.some(call => call.command === "pnpm" || call.args?.includes("update-function-code")));
  }
});

test("other AWS errors do not trigger login", (context) => {
  const state = fixture(context, "get-function-configuration");
  assert.equal(state.run().status, 9);
  assert.equal(state.calls().length, 1);
});


test("a missing or empty CA certificate stops before building or contacting AWS", (context) => {
  for (const missing of [true, false]) {
    const state = fixture(context);
    if (missing) {
      rmSync(state.certificatePath);
    } else {
      writeFileSync(state.certificatePath, "");
    }
    const result = state.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing or unreadable database CA certificate/);
    assert.deepEqual(state.calls(), []);
  }
});


test("matcher upload defaults to trackMatcher in the shared account, region and profile", (context) => {
  const state = fixture(context);
  const result = state.run(["--app", "track-matcher"]);
  assert.equal(result.status, 0, result.stderr);
  for (const { args } of state.calls().filter(call => call.command === "aws")) {
    assert.equal(args[args.indexOf("--function-name") + 1], "arn:aws:lambda:us-east-2:783161622181:function:trackMatcher");
    assert.equal(args[args.indexOf("--region") + 1], "us-east-2");
    assert.equal(args[args.indexOf("--profile") + 1], "music-discovery");
  }
  assert.match(state.calls().find(call => call.archiveEntries).bundle, /spotify/);
});

test("unknown applications fail before contacting AWS", (context) => {
  const state = fixture(context);
  assert.equal(state.run(["--app", "unknown", "matcher-test", "us-east-2"]).status, 1);
  assert.deepEqual(state.calls(), []);
});

test("matcher upload packages the matcher bundle for the explicit function", (context) => {
  const state = fixture(context);
  const result = state.run(["--app", "track-matcher", "matcher-test", "us-east-2"]);
  assert.equal(result.status, 0, result.stderr);
  for (const { args } of state.calls().filter(call => call.command === "aws")) {
    assert.equal(args[args.indexOf("--function-name") + 1], "matcher-test");
  }
  assert.match(state.calls().find(call => call.archiveEntries).bundle, /spotify/);
  assert.match(result.stdout, /track-matcher function/);
});
