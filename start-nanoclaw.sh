#!/bin/bash
cd /Users/xiangdong.zhang/Documents/git/NanoClaw
export PATH="/usr/local/bin:/usr/bin:/bin:/Users/xiangdong.zhang/.local/bin:/Users/xiangdong.zhang/.rd/bin"
export HOME="/Users/xiangdong.zhang"
exec /opt/homebrew/opt/node@22/bin/node dist/index.js 2>&1
