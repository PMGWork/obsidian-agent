# Obsidian Agent

RAG over your Obsidian vault using Gemini File Search.

## Features

- Index Markdown files in your vault to a Gemini File Search store.
- Ask questions in a side panel and get cited answers.
- Click citations to jump to the source note.
- Copy assistant messages to clipboard.
- Regenerate the last response.
- Delete individual messages from chat history.
- Export chat history to a Markdown file.
- Keyboard shortcuts: Shift+Enter or Ctrl/Cmd+Enter to send messages.

## Setup

1. Build the plugin:
   ```bash
   npm install
   npm run build
   ```
2. Copy `main.js`, `manifest.json`, `styles.css` to:
   ```
   <Vault>/.obsidian/plugins/obsidian-agent/
   ```
3. Enable **Obsidian Agent** in **Settings → Community plugins**.

## Usage

- Open the panel: **Open Obsidian Agent panel**
- Create a store: **Create File Search store (Obsidian Agent)**
- Index your vault: **Index vault to File Search (Obsidian Agent)**
- Ask questions in the panel
- Export chat: **Export chat history (Obsidian Agent)**

### Chat Actions

- **Copy**: Hover over assistant messages to reveal a copy button
- **Regenerate**: Click the regenerate button on the last message to retry
- **Delete**: Click the delete button to remove a question-answer pair
- **Export**: Use the export button in the header or command palette to save chat history

## Settings

- API key (Gemini API key)
- Model (e.g. `gemini-2.5-flash`)
- File Search store name (e.g. `fileSearchStores/...`)
- Store display name
- Metadata filter (AIP-160 syntax)
- Chunking config

## Development

```bash
npm run dev
```

Reload Obsidian after changes.
