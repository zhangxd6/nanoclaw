# NanoClaw Container

This directory contains the container build configuration forNanoClaw agent.

## Available Dockerfiles

| Dockerfile | Description |
|------------|-------------|
| `Dockerfile` | Default Node.js agent with browser automation |
| `Dockerfile.dotnet` | .NET SDK agent with browser automation |

## Building Containers

### Build Default Node.js Agent
```bash
./build.sh
# or explicitly:
./build.sh latest
```

### Build .NET Agent
```bash
./build.sh latest dotnet
# or:
./build.sh mytag --runner=dotnet
```

## Using Different Runners

Each group can be configured to use a different container runner:

### Via Setup Command
```bash
# Register with default Node.js runner (default)
node dist/register.js --jid <jid> --name <name> --trigger @Andy --folder mygroup

# Register with .NET runner
node dist/register.js --jid <jid> --name <name> --trigger @Andy --folder mygroup --runner dotnet
```

### Via Container Config
Groups store their container configuration in SQLite. You can manually update:

```sql
UPDATE registered_groups
SET container_config = '{"runner": "dotnet"}'
WHERE folder = 'mygroup';
```

### Available Runner Types

| Runner | Container Image | Use Case |
|--------|-----------------|----------|
| `default` | `nanoclaw-agent:latest` | Standard Node.js operations |
| `dotnet` | `nanoclaw-agent-dotnet:latest` | .NET application development |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CONTAINER_RUNTIME` | Container runtime (docker, podman) |
| `DOCKERFILE` | Explicit Dockerfile path |
| `CONTAINER_IMAGE` | Override default image name |

## Example: Building and Using .NET Agent

```bash
# 1. Build the .NET container
./build.sh latest dotnet

# 2. Register a group with .NET runner
node dist/register.js \
  --jid <group-jid> \
  --name "My Group" \
  --trigger @Andy \
  --folder dotnet-group \
  --runner dotnet

# 3. Start NanoClaw
npm run dev
```

The agent will now use the .NET SDK container for this group, allowing you to:
- Create and run .NET applications
- Build CLI tools in C#
- Integrate with .NET libraries
