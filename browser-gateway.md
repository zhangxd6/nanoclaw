# Browser Gateway

The Browser Gateway allows browsers to chat with NanoClaw from anywhere, keeping sessions in sync with other channels like WhatsApp and Telegram.

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────────┐
│   Browser   │◄────────────────►│  Browser Gateway │
└─────────────┘  Real-time msg    └──────────────────┘
                                       │    ▲
                            HTTP API   │    │ WebSocket
                                │      ▼    │ Streaming
                                ▼          │
                         ┌────────────┐    │
                         │   SQLite   │◄───┘
                         │  Database  │
                         └────────────┘
                                    ▲
                                    │
                         ┌────────────────┐
                         │ Container Run  │
                         │  (Agent SDK)   │
                         └────────────────┘
```

## Features

- **WebSocket Connection**: Real-time bidirectional messaging
- **HTTP API**: REST endpoints for programmatic access
- **Session Sync**: Sessions are kept in sync with WhatsApp/Telegram
- **Multiple Group Support**: Browsers can link to any registered group

## API Endpoints

### Health Check
```
GET /health
Response: { status: 'ok', service: 'browser-gateway', timestamp: string }
```

### List Groups
```
GET /groups
Response: { groups: [{ jid, name, folder, ... }], timestamp }
```

### Send Message (HTTP)
```
POST /api/message
Body: { groupFolder: string, message: string }
Response: { success: boolean, result?: string, sessionId?: string }
```

### Link Session
```
POST /api/session/link
Body: { groupFolder: string }
Response: { success: boolean, groupFolder, sessionId }
```

### Get Session Info
```
GET /api/session/:groupFolder
Response: { success: boolean, groupFolder, sessionId }
```

### Get All Sessions
```
GET /api/sessions
Response: { success: boolean, sessions: { [groupFolder]: sessionId } }
```

## WebSocket Protocol

### Client -> Server Messages

```json
{
  "type": "welcome",
  "browserId": "br_1234567890_abcdef",
  "version": "1.0.0"
}
```

After connection, the browser receives a `welcome` message with its unique `browserId`.

#### Link to Group
```json
{
  "type": "link",
  "groupFolder": "main",
  "channelJid": "120363...@g.us"
}
```

Links the browser session to a specific group.

#### Send Message
```json
{
  "type": "message",
  "groupFolder": "main",
  "content": "Hello NanoClaw!"
}
```

Sends a message to the specified group.

#### List Groups
```json
{
  "type": "list_groups"
}
```

Requests available groups.

#### Get Session Info
```json
{
  "type": "get_session",
  "groupFolder": "main"
}
```

Requests current session ID for a group.

### Server -> Client Messages

```json
{
  "type": "linked",
  "groupFolder": "main",
  "channelJid": "120363...@g.us"
}
```

Response to link message.

```json
{
  "type": "agent_message",
  "content": "Hello!",
  "timestamp": "2024-03-03T12:00:00.000Z"
}
```

Agent response message.

```json
{
  "type": "session_update",
  "sessionId": "sess_abc123...",
  "groupFolder": "main"
}
```

Session updated (new conversation context).

```json
{
  "type": "agent_error",
  "error": "Error message"
}
```

Agent error response.

## Usage

### Start the Browser Gateway

The gateway starts automatically when NanoClaw starts:

```bash
npm run dev
```

### Access the HTML Frontend

1. Open `browser-frontend.html` in your browser
2. Or serve it with a static file server:
   ```bash
   npx serve browser-frontend.html -p 3002
   ```

### Using the HTML UI

1. Connect to WebSocket (automatic on page load)
2. Select a group from the list
3. Type and send messages

### Programmatic Access (HTTP API)

```bash
# Send a message
curl -X POST http://localhost:3001/api/message \
  -H "Content-Type: application/json" \
  -d '{"groupFolder": "main", "message": "Hello!"}'

# Get all groups
curl http://localhost:3001/groups

# Link to session
curl -X POST http://localhost:3001/api/session/link \
  -H "Content-Type: application/json" \
  -d '{"groupFolder": "main"}'
```

### Programmatic Access (WebSocket)

```javascript
const ws = new WebSocket('ws://localhost:3001/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'message', groupFolder: 'main', content: 'Hello!' }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'agent_message') {
    console.log('Agent response:', msg.content);
  }
};
```

## Session Management

Sessions are persisted in SQLite and shared across all channels:

1. **Database Storage**: Sessions stored in `sessions` table
2. **Cross-Channel Sync**: WhatsApp, Telegram, and browser share same session for a group
3. **Auto-Update**: Container agent updates session ID on new conversation turn

## Configuration

The gateway runs on port 3001 by default. To change:

```bash
# In your .env file
PORT=8080
```

Note: Port configuration may need to be updated in `src/browser-gateway.ts`.
