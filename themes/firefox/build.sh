#!/usr/bin/env sh
# Package the Park Ranger Dark theme as an installable .xpi.
#
# Release Firefox only installs SIGNED add-ons, so a permanent install needs
# an AMO signature (unlisted channel -- no public listing, just a signed file):
#   1. API credentials: https://addons.mozilla.org/developers/addon/api/key/
#   2. Put them in WEB_EXT_API_KEY / WEB_EXT_API_SECRET (exported, or in the
#      dotfiles-repo .env next to the other machine secrets).
#   3. ./build.sh  -> signed .xpi lands in web-ext-artifacts/
#      Install via about:addons -> gear menu -> Install Add-on From File.
# AMO refuses to re-sign an already-signed version: bump "version" in
# manifest.json before re-signing.
#
# Without credentials this still emits an unsigned .xpi -- installable only on
# ESR/Dev/Nightly with xpinstall.signatures.required=false, or loadable as a
# temporary add-on via about:debugging.
set -eu
cd "$(dirname "$0")"

# Optional: pick up AMO credentials from the dotfiles .env when this copy
# lives at themes/firefox/ inside the dotfiles repo.
if [ -f ../../.env ]; then
  # shellcheck source=/dev/null
  . ../../.env
fi

npx --yes web-ext build --overwrite-dest --ignore-files build.sh --filename park-ranger-dark.xpi

if [ -n "${WEB_EXT_API_KEY:-}" ] && [ -n "${WEB_EXT_API_SECRET:-}" ]; then
  npx --yes web-ext sign --channel unlisted --ignore-files build.sh \
    --api-key "$WEB_EXT_API_KEY" --api-secret "$WEB_EXT_API_SECRET"
  echo "Signed .xpi in web-ext-artifacts/ -- about:addons -> gear -> Install Add-on From File"
else
  echo "No WEB_EXT_API_KEY/WEB_EXT_API_SECRET set: built unsigned web-ext-artifacts/park-ranger-dark.xpi only."
  echo "Release Firefox will refuse it -- see the header comment for signing."
fi
