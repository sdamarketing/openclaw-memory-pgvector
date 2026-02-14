#!/bin/bash
#
# Proxy Setup Script for OpenClaw Memory Plugin
# Run with: source setup-proxy.sh
#

# Set proxy for external requests
export HTTP_PROXY="${HTTP_PROXY:-http://127.0.0.1:10809}"
export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:10809}"
export ALL_PROXY="${ALL_PROXY:-socks5://127.0.0.1:10808}"

# IMPORTANT: Exclude localhost from proxy
export NO_PROXY="localhost,127.0.0.1,0.0.0.0"

echo "✓ Proxy configured:"
echo "  HTTP_PROXY=$HTTP_PROXY"
echo "  HTTPS_PROXY=$HTTPS_PROXY"
echo "  NO_PROXY=$NO_PROXY"
