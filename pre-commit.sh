#!/bin/sh

# Run Biome check with auto-fix (includes formatting and safe fixes like import sorting)
echo "Running Biome check with auto-fix..."
output=$(npx biome check --write --staged 2>&1)
exit_code=$?

# Stage fixed files
git add -u

if [ $exit_code -eq 0 ]; then
  exit 0
fi

case "$output" in
  *"No files were processed"*)
    exit 0
    ;;
  *)
    echo "$output"
    exit $exit_code
    ;;
esac
