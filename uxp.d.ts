/**
 * HALO68 项目的 UXP 模块类型声明（本地精简版）
 *
 * 为什么需要这个文件：
 * - Adobe 官方 UXP 类型包 @adobe/cc-ext-uxp-types 与 VSCode 的 Web DOM 类型冲突，
 *   且其 7.3.1 版本缺少 entrypoints 的声明；
 * - 这里提供本项目实际用到的最小可用声明，保证 require("uxp") 不报错且有补全。
 *
 * 只声明了本项目用到的 API，后续用到更多 UXP API 时再按需补充。
 */

declare module "uxp" {
  // ============ entrypoints ============
  export interface PanelHandler {
    show?(): void;
    hide?(): void;
  }

  export interface SetupConfig {
    panels?: Record<string, PanelHandler>;
    commands?: Record<string, () => void>;
  }

  export const entrypoints: {
    setup(config: SetupConfig): void;
  };

  // ============ storage ============
  /** 文件系统条目的基类（文件或文件夹） */
  export class Entry {
    readonly isFile: boolean;
    readonly isFolder: boolean;
    readonly name: string;
    readonly nativePath: string;
    readonly url: string;
    getMetadata(): Promise<unknown>;
    delete(): Promise<number>;
    toString(): string;
  }

  /** 文件 */
  export class File extends Entry {
    read(options?: { format?: symbol }): Promise<string | ArrayBuffer>;
    write(
      data: string | ArrayBuffer,
      options?: { format?: symbol; append?: boolean }
    ): Promise<number>;
  }

  /** 文件夹 */
  export class Folder extends Entry {
    getEntry(name: string): Promise<Entry>;
    getEntries(): Promise<Entry[]>;
    createEntry(
      name: string,
      options?: { type?: symbol; overwrite?: boolean }
    ): Promise<Entry>;
  }

  /** 本地文件系统提供者 */
  export class FileSystemProvider {
    getPluginFolder(): Promise<Folder>;
    getDataFolder(): Promise<Folder>;
    getTemporaryFolder(): Promise<Folder>;
    getFileForOpening(options?: unknown): Promise<File | null>;
    getFileForSaving(suggestedName?: string, options?: unknown): Promise<File | null>;
    getFolder(options?: unknown): Promise<Folder | null>;
    getEntryWithUrl(url: string): Promise<Entry>;
    createEntryWithUrl(url: string, options?: unknown): Promise<Entry>;
    createSessionToken(entry: Entry): string;
  }

  export namespace storage {
    const localFileSystem: FileSystemProvider;
  }
}
