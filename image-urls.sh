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

commit=$(git rev-parse HEAD 2>/dev/null || true)
if [ -z "$commit" ]; then
  echo "Error: create a commit before generating public URLs." >&2
  exit 1
fi

image_list=$(mktemp "${TMPDIR:-/tmp}/image-urls.XXXXXX")
trap 'rm -f "$image_list"' EXIT HUP INT TERM

find images -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.gif' -o -iname '*.webp' \) -print | LC_ALL=C sort > "$image_list"

if [ ! -s "$image_list" ]; then
  echo "No images found in images/."
  exit 0
fi

status=0
while IFS= read -r file; do
  case "$file" in
    *[!A-Za-z0-9_./-]*)
      echo "Error: rename to remove spaces or special characters: $file" >&2
      status=1
      continue
      ;;
  esac

  if ! git cat-file -e "$commit:$file" 2>/dev/null; then
    echo "Error: not committed yet: $file" >&2
    status=1
    continue
  fi

  printf 'https://raw.githubusercontent.com/%s/%s/%s\n' "$repository" "$commit" "$file"
done < "$image_list"

exit "$status"
