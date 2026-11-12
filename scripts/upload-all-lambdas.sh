#!/usr/bin/env bash
set -euo pipefail

repositoryRoot="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repositoryRoot/scripts/lambda-targets.sh"

if [[ $# -eq 0 ]]; then
  set -- "$ingestionFunction" "$matcherFunction" "$lambdaRegion" "$lambdaProfile"
fi

if [[ $# -lt 3 || $# -gt 4 ]]; then
  echo "Usage: pnpm upload:lambda [<ingestion-function> <matcher-function> <region> [aws-profile]]" >&2
  exit 1
fi

if [[ -z "$1" || -z "$2" || -z "$3" || "$1" == "$2" ]]; then
  echo "Supply distinct ingestion and matcher functions and a nonempty region." >&2
  exit 1
fi

ingestionFunction="$1"
matcherFunction="$2"
shift 2

# Reuse each app's validation, packaging and revision-protected upload.
# Stop on failure; successful earlier uploads are not rolled back.
bash "$repositoryRoot/scripts/upload-lambda.sh" --app ingestion "$ingestionFunction" "$@"
bash "$repositoryRoot/scripts/upload-lambda.sh" --app track-matcher "$matcherFunction" "$@"
