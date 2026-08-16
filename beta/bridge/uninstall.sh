#!/usr/bin/env bash
# Remove the quicktext_bridge_host native messaging host registered by install.sh.

set -euo pipefail

if [[ "$OSTYPE" == darwin* ]]; then
  HOSTS_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
else
  HOSTS_DIR="$HOME/.mozilla/native-messaging-hosts"
fi

INSTALL_DIR="$HOSTS_DIR/quicktext_bridge_host_helper"
MANIFEST_DEST="$HOSTS_DIR/quicktext_bridge_host.json"

rm -f "$MANIFEST_DEST"
rm -rf "$INSTALL_DIR"

echo "Removed:"
echo "  $MANIFEST_DEST"
echo "  $INSTALL_DIR"
echo
echo "The bridge is now unregistered. Disable it in Quicktext's options too, if"
echo "you had it on."
