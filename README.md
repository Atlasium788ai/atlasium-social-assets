# Atlasium social assets

A minimal, GitHub-backed library for public social-media images. There is no website, app, build step, or deployment.

## One-time setup

1. Install Apple's Command Line Tools if Git is not already working:

   ```sh
   xcode-select --install
   ```

2. Create a **public** empty repository on GitHub (do not add a README or `.gitignore`).
3. In this folder, connect and publish it:

   ```sh
   git init
   git branch -M main
   git add .
   git commit -m "Set up social asset library"
   git remote add origin https://github.com/OWNER/REPOSITORY.git
   git push -u origin main
   ```

Replace `OWNER/REPOSITORY` with the public GitHub repository's actual path.

## Add images

Copy images into [`images/`](images), then run:

```sh
git add images
git commit -m "Add social assets"
git push
./image-urls.sh
```

The script prints a direct public URL for every committed image. Give those URLs to Claude/Buffer only **after the push has finished**. Each URL is pinned to the publishing commit, so its contents cannot change later.

Example:

```text
https://raw.githubusercontent.com/OWNER/REPOSITORY/COMMIT/images/product-launch.png
```

## Rules that keep URLs reliable

- Use lowercase descriptive filenames with letters, numbers, hyphens, or underscores, such as `launch-square-2026-08.png`.
- Supported files: `.png`, `.jpg`, `.jpeg`, `.gif`, and `.webp`.
- Published URLs are pinned to a Git commit and remain immutable even if a file is later changed on `main`.
- Prefer versioned replacement filenames, such as `launch-square-v2.png`, so the library remains easy to understand.
- Keep the repository public. A private repository's raw URLs are not publicly accessible.
- These URLs are stable path-based URLs, not an archival guarantee. Deleting the repository or changing its owner/name breaks them.
