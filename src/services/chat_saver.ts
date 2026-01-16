import { Notice, TFile } from "obsidian";
import ObsidianRagPlugin from "../main";
import { ChatEntry, ChatSession } from "../types";

const DEFAULT_CHAT_FOLDER = "Obsidian Agent Chats";

export class ChatSaver {
  // セッションを保存する
  async saveSession(plugin: ObsidianRagPlugin): Promise<void> {
    const chatFolder = plugin.settings.chatFolder || DEFAULT_CHAT_FOLDER;
    await this.ensureFolder(plugin, chatFolder);

    const session = this.getCurrentSession(plugin);
    if (!session) {
      return;
    }

    await this.saveToFile(plugin, session);
  }

  // 現在のセッションを取得する
  getCurrentSession(plugin: ObsidianRagPlugin): ChatSession | null {
    if (!plugin.currentSessionId) {
      return null;
    }
    return plugin.sessions[plugin.currentSessionId] || null;
  }

  // セッションをファイルに保存する
  async saveToFile(plugin: ObsidianRagPlugin, session: ChatSession): Promise<void> {
    const chatFolder = plugin.settings.chatFolder || DEFAULT_CHAT_FOLDER;
    const filePath = `${chatFolder}/${session.filename}`;
    const markdown = this.buildMarkdown(plugin.history, session.createdAt, session.updatedAt, session.id, session.title);

    try {
      const existingFile = plugin.app.vault.getAbstractFileByPath(filePath);
      if (existingFile && existingFile instanceof TFile) {
        await plugin.app.vault.modify(existingFile, markdown);
      } else {
        await plugin.app.vault.create(filePath, markdown);
      }
    } catch (error) {
      console.error("Failed to save chat session:", error);
      new Notice(`Failed to save chat: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // フォルダーを作成する
  async ensureFolder(plugin: ObsidianRagPlugin, folderPath: string): Promise<void> {
    const folder = plugin.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      await plugin.app.vault.createFolder(folderPath);
    }
  }

  // 保存されたチャットを取得する
  async getSavedChats(plugin: ObsidianRagPlugin): Promise<ChatSession[]> {
    const chatFolder = plugin.settings.chatFolder || DEFAULT_CHAT_FOLDER;
    await this.ensureFolder(plugin, chatFolder);

    const folder = plugin.app.vault.getAbstractFileByPath(chatFolder);
    if (!folder) {
      return [];
    }

    const files = plugin.app.vault.getMarkdownFiles();
    const chatFiles = files.filter((file) => file.path.startsWith(chatFolder + "/"));

    const sessions: ChatSession[] = [];
    for (const file of chatFiles) {
      const session = await this.parseChatFile(plugin, file);
      if (session) {
        sessions.push(session);
      }
    }

    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return sessions;
  }

  // チャットファイルを解析する
  async parseChatFile(plugin: ObsidianRagPlugin, file: TFile): Promise<ChatSession | null> {
    try {
      const content = await plugin.app.vault.read(file);
      const frontmatter = this.parseFrontmatter(content);
      const legacyDates = this.parseLegacyDates(content);

      const createdAt = frontmatter?.createdAt ?? legacyDates.createdAt ?? file.stat.mtime;
      const updatedAt = frontmatter?.updatedAt ?? legacyDates.updatedAt ?? file.stat.mtime;
      const sessionId = frontmatter?.id ?? file.basename;

      let title = frontmatter?.title ?? "Untitled";
      const needsFrontmatterUpdate =
        !frontmatter || !frontmatter.id || !frontmatter.createdAt || !frontmatter.updatedAt;

      if (needsFrontmatterUpdate) {
        const history = this.parseHistoryFromMarkdown(content);
        const updatedContent = this.buildMarkdown(history, createdAt, updatedAt, sessionId, title);
        await plugin.app.vault.modify(file, updatedContent);
      }

      return {
        id: sessionId,
        filename: file.name,
        createdAt,
        updatedAt,
        title,
      };
    } catch (error) {
      console.error("Failed to parse chat file:", error);
      return null;
    }
  }

  // セッションを読み込む
  async loadSession(plugin: ObsidianRagPlugin, session: ChatSession): Promise<void> {
    const chatFolder = plugin.settings.chatFolder || DEFAULT_CHAT_FOLDER;
    const filePath = `${chatFolder}/${session.filename}`;

    try {
      const file = plugin.app.vault.getAbstractFileByPath(filePath);
      if (!file) {
        new Notice(`Chat file not found: ${session.filename}`);
        return;
      }

      if (!(file instanceof TFile)) {
        new Notice(`Chat file is not a file: ${session.filename}`);
        return;
      }

      const content = await plugin.app.vault.read(file);
      const history = this.parseHistoryFromMarkdown(content);
      
      plugin.currentSessionId = session.id;
      plugin.sessions[session.id] = session;
      plugin.history = history;
      await plugin.saveSettings();
    } catch (error) {
      console.error("Failed to load chat session:", error);
      new Notice(`Failed to load chat: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Markdownから履歴を解析する
  parseHistoryFromMarkdown(content: string): ChatEntry[] {
    const history: ChatEntry[] = [];
    const cleanedContent = this.stripFrontmatter(content);
    const sections = cleanedContent.split(/^---$/gm);

    for (const section of sections) {
      const match = section.match(/^## Q(\d+):\s*(.+?)$/m);
      if (match) {
        const id = match[1];
        const question = match[2]?.trim() || "";
        
        const answerMatch = section.match(/^## Q\d+:\s*.+?\n([\s\S]+)$/m);
        const answer = answerMatch ? answerMatch[1]?.trim() || "" : "";

        history.push({
          id: `q${id}`,
          timestamp: Date.now(),
          question,
          answer,
        });
      }
    }

    return history;
  }

  // フロントマターを解析する
  parseFrontmatter(content: string): { id?: string; title?: string; createdAt?: number; updatedAt?: number } | null {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (!match) {
      return null;
    }

    const frontmatter: { id?: string; title?: string; createdAt?: number; updatedAt?: number } = {};
    const frontmatterBody = match[1] ?? "";
    const lines = frontmatterBody.split("\n");

    for (const line of lines) {
      const [rawKey, ...rawValue] = line.split(":");
      if (!rawKey || rawValue.length === 0) {
        continue;
      }
      const key = rawKey.trim();
      const value = rawValue.join(":").trim().replace(/^['"]|['"]$/g, "");
      if (!value) {
        continue;
      }

      if (key === "id") {
        frontmatter.id = value;
        continue;
      }

      if (key === "title") {
        frontmatter.title = value;
        continue;
      }

      if (key === "created" || key === "updated") {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          if (key === "created") {
            frontmatter.createdAt = date.getTime();
          } else {
            frontmatter.updatedAt = date.getTime();
          }
        }
      }
    }

    return frontmatter;
  }

  // 既存のメタ情報から日付を解析する
  parseLegacyDates(content: string): { createdAt?: number; updatedAt?: number } {
    const lines = content.split("\n");
    let createdAt: number | undefined;
    let updatedAt: number | undefined;

    for (const line of lines) {
      const createdMatch = line.match(/^\*\*Created:\*\*\s*(.+)$/);
      const updatedMatch = line.match(/^\*\*Updated:\*\*\s*(.+)$/);

      if (createdMatch && !createdAt) {
        const date = new Date(createdMatch[1] || "");
        if (!isNaN(date.getTime())) {
          createdAt = date.getTime();
        }
      }

      if (updatedMatch && !updatedAt) {
        const date = new Date(updatedMatch[1] || "");
        if (!isNaN(date.getTime())) {
          updatedAt = date.getTime();
        }
      }
    }

    return { createdAt, updatedAt };
  }

  // フロントマターを除去する
  stripFrontmatter(content: string): string {
    const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
    if (!match) {
      return content;
    }
    return content.slice(match[0].length);
  }

  // Markdownを生成する
  buildMarkdown(history: ChatEntry[], createdAt: number, updatedAt: number, sessionId: string, title?: string): string {
    const createdDate = new Date(createdAt).toISOString();
    const updatedDate = new Date(updatedAt).toISOString();

    let markdown = `---\n`;
    markdown += `id: ${sessionId}\n`;
    if (title) {
      markdown += `title: ${title}\n`;
    }
    markdown += `created: ${createdDate}\n`;
    markdown += `updated: ${updatedDate}\n`;
    markdown += `---\n\n`;

    for (let i = 0; i < history.length; i++) {
      const entry = history[i]!;
      markdown += `## Q${i + 1}: ${entry.question}\n\n`;
      markdown += `${entry.answer}\n\n`;
      markdown += `---\n\n`;
    }

    return markdown;
  }

  // ファイル名を生成する
  generateFilename(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");

    return `chat-${year}-${month}-${day}-${hours}${minutes}${seconds}.md`;
  }

  // セッションを作成する
  createSession(timestamp: number): ChatSession {
    const id = `${timestamp}-${Math.random().toString(16).slice(2)}`;
    const filename = this.generateFilename(timestamp);

    return {
      id,
      filename,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  // 相対時間をフォーマットする
  formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days >= 7) {
      const date = new Date(timestamp);
      return date.toLocaleDateString();
    } else if (days > 0) {
      return `${days}d ago`;
    } else if (hours > 0) {
      return `${hours}h ago`;
    } else if (minutes > 0) {
      return `${minutes}m ago`;
    } else {
      return "Just now";
    }
  }
}