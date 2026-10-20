#!/usr/bin/env bash
# Public-domain fixtures from Project Gutenberg (The Art of War, ebook #132).
set -euo pipefail
cd "$(dirname "$0")/../tests/fixtures/books"
curl -fsSL -o art-of-war.epub https://www.gutenberg.org/ebooks/132.epub3.images
curl -fsSL -o art-of-war.azw3 https://www.gutenberg.org/ebooks/132.kf8.images
curl -fsSL -o art-of-war.mobi https://www.gutenberg.org/ebooks/132.kindle.images
