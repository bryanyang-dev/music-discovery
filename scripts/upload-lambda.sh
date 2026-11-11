#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  set -- "arn:aws:lambda:us-east-2:783161622181:function:musicRssFetcher" "us-east-2" "music-discovery"
elif [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: pnpm upload:lambda [<function-name> <region> [aws-profile]]" >&2
  exit 1
fi

functionName="$1"
region="$2"
awsOptions=(--region "$region" --no-cli-pager)
if [[ $# -eq 3 ]]; then
  awsOptions+=(--profile "$3")
fi

for requiredCommand in aws pnpm zip; do
  if ! command -v "$requiredCommand" >/dev/null 2>&1; then
    echo "Missing required command: $requiredCommand. Nothing will be installed automatically." >&2
    exit 1
  fi
done

repositoryRoot="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repositoryRoot"

# Select only deployment fields; never print the function's environment variables.
configuration="$(aws lambda get-function-configuration \
  --function-name "$functionName" "${awsOptions[@]}" \
  --query '[Runtime,Handler,PackageType,RevisionId]' --output text)"
IFS=$'\t' read -r runtime handler packageType revisionId <<< "$configuration"
if [[ "$runtime" != "nodejs24.x" || "$handler" != "index.handler" || "$packageType" != "Zip" || -z "$revisionId" ]]; then
  echo "The existing function must use Node.js 24, handler index.handler, and ZIP packaging." >&2
  exit 1
fi

pnpm typecheck
pnpm test
pnpm test:bundle

# A fresh archive prevents stale files from previous builds being uploaded.
packageDirectory="$(mktemp -d "$repositoryRoot/dist/ingestion/upload.XXXXXX")"
archivePath="$packageDirectory/handler.zip"
cleanup() {
  local primaryExitCode=$?
  local cleanupExitCode=0
  rm -f "$archivePath" || cleanupExitCode=$?
  rmdir "$packageDirectory" || cleanupExitCode=$?
  if [[ $primaryExitCode -ne 0 ]]; then
    return "$primaryExitCode"
  fi
  return "$cleanupExitCode"
}
trap cleanup EXIT
zip -j "$archivePath" dist/ingestion/index.cjs

echo "Uploading handler to $functionName in $region..."
# Reject the update if another deployment changed the function during our build.
aws lambda update-function-code \
  --function-name "$functionName" "${awsOptions[@]}" \
  --zip-file "fileb://$archivePath" --revision-id "$revisionId" \
  --query '{FunctionName:FunctionName,CodeSha256:CodeSha256,LastUpdateStatus:LastUpdateStatus}' \
  --output json

aws lambda wait function-updated-v2 \
  --function-name "$functionName" "${awsOptions[@]}"
echo "Upload completed. Test the function in the Lambda console with an empty JSON event: {}"
