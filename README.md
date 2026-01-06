# Obsidian Agent

RAG over your Obsidian vault using Gemini File Search.

## Features

- Index Markdown files in your vault to a Gemini File Search store.
- Ask questions in a side panel and get cited answers.
- Click citations to jump to the source note.

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
