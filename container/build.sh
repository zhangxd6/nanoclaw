#!/bin/bash
# Build the NanoClaw agent container image
#
# Usage:
#   ./build.sh                           - Build default Node.js agent
#   ./build.sh latest dotnet             - Build .NET agent
#   ./build.sh mytag --runner=dotnet     - Build .NET agent with custom tag
#
# Environment variables:
#   CONTAINER_RUNTIME  - Container runtime (docker, podman, etc.)
#   DOCKERFILE         - Explicit Dockerfile path

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="nanoclaw-agent"
TAG="${1:-latest}"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"
DOCKERFILE="${DOCKERFILE:-Dockerfile}"
RUNNER="default"

# Parse runner argument (second positional or --runner flag)
if [[ "$2" == "dotnet" ]] || [[ "$1" == "--runner" && "$2" == "dotnet" ]]; then
  DOCKERFILE="Dockerfile.dotnet"
  IMAGE_NAME="nanoclaw-agent-dotnet"
  RUNNER="dotnet"
fi

# Handle --runner flag in any position
for arg in "$@"; do
  if [[ "$arg" == "--runner=dotnet" ]]; then
    DOCKERFILE="Dockerfile.dotnet"
    IMAGE_NAME="nanoclaw-agent-dotnet"
    RUNNER="dotnet"
  fi
done

echo "Building NanoClaw agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"
echo "Dockerfile: ${DOCKERFILE}"

${CONTAINER_RUNTIME} build -f "${DOCKERFILE}" -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Runner type: ${RUNNER}"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | ${CONTAINER_RUNTIME} run -i ${IMAGE_NAME}:${TAG}"
echo ""
echo "Available runner types:"
echo "  default  - Node.js agent (default)"
echo "  dotnet   - .NET SDK agent with browser automation"
echo ""
echo "Environment variables:"
echo "  CONTAINER_RUNTIME    - Container runtime (docker, podman)"
echo "  DOCKERFILE           - Explicit Dockerfile path"
echo ""
echo "Examples:"
echo "  ./build.sh                     # Build default Node.js agent"
echo "  ./build.sh latest dotnet       # Build .NET agent"
echo "  ./build.sh mytag --runner=dotnet  # Build .NET with custom tag"
