---
name: agent-runner
description: Guide users through adding different container runners for specific requirements (Node.js, .NET, Python, custom images)
allowed-tools: Bash
---

# Agent Runner Configuration

This skill helps you add different container runners to meet specific agent requirements.

## Overview

NanoClaw supports multiple runner types, each with different capabilities:

| Runner | Container Image | Best For |
|--------|-----------------|----------|
| `default` | `nanoclaw-agent:latest` | Standard Node.js operations |
| `dotnet` | `nanoclaw-agent-dotnet:latest` | .NET application development |
| `python` | `nanoclaw-agent-python:latest` (default) | Python scripts and ML workloads |
| `custom` | Your image | Specialized requirements |

## Which Runner Do You Need?

Let me help you choose the right runner based on your use case:

### Question: What kind of applications or tasks do you want the agent to run?

1. **Web scraping, browser automation, general Node.js tasks**
   - Use: `default` (Node.js)
   - Already available, no setup needed

2. **Build and run .NET applications (C#, F#, VB.NET)**
   - Use: `dotnet`
   - Has .NET SDK 8.0 installed

3. **Run Python scripts, machine learning, data processing**
   - Use: `python`
   - Need to create a custom container with Python

4. **Specific tools or environments not in default runners**
   - Use: `custom`
   - Can use any Docker image

## Common Scenarios

### Scenario 1: Add .NET Support

If you want the agent to build and run .NET applications:

```bash
# 1. Build the .NET container
./container/build.sh latest dotnet

# 2. Register a new group with .NET runner
node dist/register.js \
  --jid <group-jid> \
  --name "My .NET Group" \
  --trigger @Andy \
  --folder dotnet-group \
  --runner dotnet
```

### Scenario 2: Add Python Support

If you want to run Python scripts:

```bash
# 1. Create a Python container (using python:3.11-slim as base)
# 2. Build with your custom Dockerfile
docker build -f container/Dockerfile.python -t nanoclaw-agent-python:latest .

# 3. Register with python runner
node dist/register.js \
  --jid <group-jid> \
  --name "My Python Group" \
  --trigger @Andy \
  --folder python-group \
  --runner python
```

Or use a pre-built Python image:
```bash
node dist/register.js \
  --jid <group-jid> \
  --name "My Python Group" \
  --trigger @Andy \
  --folder python-group \
  --container-image python:3.11-slim
```

### Scenario 3: Use Custom Docker Image

If you have a specific image with required tools:

```bash
# Option 1: Register and specify custom image later via SQLite
node dist/register.js \
  --jid <group-jid> \
  --name "Custom Tools Group" \
  --trigger @Andy \
  --folder custom-group

# Option 2: Register with container image argument
node dist/register.js \
  --jid <group-jid> \
  --name "Custom Tools Group" \
  --trigger @Andy \
  --folder custom-group \
  --container-image my-custom-image:tag

# Option 3: Register as custom runner
node dist/register.js \
  --jid <group-jid> \
  --name "Custom Tools Group" \
  --trigger @Andy \
  --folder custom-group \
  --runner custom
```

## Quick Commands

### Build Different Runners

```bash
# Default Node.js runner
./container/build.sh latest

# .NET runner
./container/build.sh latest dotnet
```

### Register Groups with Specific Runners

```bash
# Node.js runner (default)
node dist/register.js \
  --jid <jid> --name <name> --trigger @Andy \
  --folder mynode --runner default

# .NET runner
node dist/register.js \
  --jid <jid> --name <name> --trigger @Andy \
  --folder mydotnet --runner dotnet

# Python runner
node dist/register.js \
  --jid <jid> --name <name> --trigger @Andy \
  --folder mypython --runner python

# Custom runner with specific image
node dist/register.js \
  --jid <jid> --name <name> --trigger @Andy \
  --folder mycustom --container-image myimage:tag

# Custom runner with runner type
node dist/register.js \
  --jid <jid> --name <name> --trigger @Andy \
  --folder mycustom --runner custom
```

### Switch a Group to a Different Runner

```sql
-- Update existing group to use .NET runner
UPDATE registered_groups
SET container_config = '{"runner": "dotnet"}'
WHERE folder = 'existing-group';

-- Switch to custom container image
UPDATE registered_groups
SET container_config = '{"containerImage": "my-custom-image:tag"}'
WHERE folder = 'existing-group';
```

## Verification

After setting up a new runner, verify with:

```bash
# Check service is running
launchctl list | grep nanoclaw

# Test container works
./container/build.sh latest dotnet
```

## Creating Custom Container Images

### Python Runner Dockerfile Example

Create `container/Dockerfile.python`:

```dockerfile
# NanoClaw Agent Container with Python SDK
FROM python:3.11-slim

# Install system dependencies for Chromium (browser automation)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (required for agent-browser)
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
RUN apt-get install -y nodejs

# Install agent-browser and claude-code globally
RUN npm install -g agent-browser @anthropic-ai/claude-code

# Create app directory
WORKDIR /app

# Copy and install agent-runner dependencies
COPY agent-runner/package*.json ./
RUN npm install

# Copy source code
COPY agent-runner/ ./
RUN npm run build

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Create entrypoint
RUN printf '#!/bin/bash\nset -e\ncd /app && npx tsc --outDir /tmp/dist 2>&1 >&2\nln -s /app/node_modules /tmp/dist/node_modules\nchmod -R a-w /tmp/dist\ncat > /tmp/input.json\nnode /tmp/dist/index.js < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set ownership
RUN chown -R node:node /workspace && chmod 777 /home/node
USER node
WORKDIR /workspace/group

ENTRYPOINT ["/app/entrypoint.sh"]
```

Build and use:
```bash
docker build -f container/Dockerfile.python -t nanoclaw-agent-python:latest .
node dist/register.js --jid <jid> --name "Python Group" --trigger @Andy --folder pygroup --runner python
```

## Need Help Choosing?

Tell me your specific requirements and I'll help you configure the right runner!
