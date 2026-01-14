import { Notice } from "obsidian";
import ObsidianRagPlugin from "../main";

// チャット履歴をMarkdownファイルとしてエクスポートするコマンド
export async function exportChatCommand(plugin: ObsidianRagPlugin) {
  if (plugin.history.length === 0) {
    new Notice("No chat history to export");
    return;
  }

  try {
    // Generate markdown content
    let markdown = `# Chat History\n\nExported: ${new Date().toLocaleString()}\n\n---\n\n`;
    
    for (let i = 0; i < plugin.history.length; i++) {
      const entry = plugin.history[i];
      if (!entry) continue;
      
      markdown += `## Q${i + 1}: ${entry.question}\n\n`;
      markdown += `${entry.answer}\n\n`;
      markdown += `---\n\n`;
    }

    // Create filename with timestamp
    // ISO format: 2026-01-14T11:48:23.456Z -> remove milliseconds and Z
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const filename = `chat-export-${timestamp}.md`;
    
    // Save to vault root
    const file = await plugin.app.vault.create(filename, markdown);
    new Notice(`Chat exported to ${filename}`);
    
    // Open the exported file
    const leaf = plugin.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  } catch (error) {
    console.error("Failed to export chat:", error);
    new Notice("Failed to export chat. Check console for details.");
  }
}
