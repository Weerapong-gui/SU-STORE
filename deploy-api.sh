#!/usr/bin/env bash
# Kept for muscle memory: redeploys order-api only.
exec "$(dirname "$0")/deploy.sh" api
