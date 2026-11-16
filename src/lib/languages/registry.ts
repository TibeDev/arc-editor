import { monaco, languageIdForFile } from '../editor/monaco';

export type ArcLanguageManifest = {
  schemaVersion?: number;
  id: string;
  name?: string;
  version?: string;
  engines?: { arc?: string };
  languages?: ArcLanguageContribution[];
};

export type ArcLanguageContribution = {
  id: string;
  aliases?: string[];
  extensions?: string[];
  filenames?: string[];
  configuration?: Record<string, unknown>;
  syntax?:
    | { type: 'monarch'; path?: string; language?: monaco.languages.IMonarchLanguage }
    | { type: 'builtin' | 'none' };
  snippets?: string[];
  completion?: string;
  diagnostics?: string;
  formatter?: string;
  lsp?: {
    transport: 'stdio' | 'websocket' | 'worker';
    command?: string;
    args?: string[];
    documentSelector?: string[];
    initializationOptions?: unknown;
  };
};

const languageExtensions = new Map<string, string>();

export function registerLanguageManifest(manifest: ArcLanguageManifest): () => void {
  const disposables: monaco.IDisposable[] = [];
  for (const language of manifest.languages ?? []) {
    if (language.configuration) {
      monaco.languages.setLanguageConfiguration(language.id, language.configuration as monaco.languages.LanguageConfiguration);
    }
    if (language.syntax?.type === 'monarch' && language.syntax.language) {
      disposables.push(monaco.languages.setMonarchTokensProvider(language.id, language.syntax.language));
    }
    for (const extension of language.extensions ?? []) {
      languageExtensions.set(extension.replace(/^\./, '').toLowerCase(), language.id);
    }
  }
  return () => disposables.forEach((disposable) => disposable.dispose());
}

export function languageForFileName(name: string, override?: string): string {
  if (override) return override;
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return languageExtensions.get(extension) ?? languageIdForFile(name);
}

export function registerArcMonarchLanguage(
  id: string,
  language: monaco.languages.IMonarchLanguage,
  configuration?: monaco.languages.LanguageConfiguration,
): monaco.IDisposable {
  if (configuration) monaco.languages.setLanguageConfiguration(id, configuration);
  return monaco.languages.setMonarchTokensProvider(id, language);
}
