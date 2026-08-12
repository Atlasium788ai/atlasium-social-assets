#!/bin/sh

set -eu

remote_url=$(git remote get-url origin 2>/dev/null || true)

case "$remote_url" in
  git@github.com:*) repository=${remote_url#git@github.com:} ;;
  https://github.com/*) repository=${remote_url#https://github.com/} ;;
  http://github.com/*) repository=${remote_url#http://github.com/} ;;
  *)
    echo "Error: origin must be a GitHub repository URL." >&2
    echo "Example: git remote add origin https://github.com/OWNER/REPOSITORY.git" >&2
    exit 1
    ;;
esac

repository=${repository%.git}
repository=${repository%/}

if [ ! -d images ]; then
  echo "Error: images/ directory not found." >&2
  exit 1
fi

find images -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.gif' -o -iname '*.webp' \) -print | LC_ALL=C sort | while IFS= read -r file; do
  case "$file" in
    *[!A-Za-z0-9_./-]*)
      echo "SKIPPED (rename to remove spaces/special characters): $file" >&2
      continue
      ;;
  esac
  printf 'https://raw.githubusercontent.com/%s/main/%s\n' "$repository" "$file"
done
