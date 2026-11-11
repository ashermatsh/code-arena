// Code editor: Monaco (loaded from a CDN) with a plain <textarea> fallback
// when the CDN is unreachable, so the platform works offline too.

const MONACO_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min';
const LOAD_TIMEOUT_MS = 15_000;
const FONT = "ui-monospace, 'SF Mono', 'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, monospace";

let monacoPromise;

function loadMonaco() {
  if (!monacoPromise) {
    monacoPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Monaco load timed out')), LOAD_TIMEOUT_MS);
      const workerSrc = `self.MonacoEnvironment={baseUrl:'${MONACO_BASE}/'};importScripts('${MONACO_BASE}/vs/base/worker/workerMain.js');`;
      window.MonacoEnvironment = {
        getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(workerSrc)}`,
      };
      const script = document.createElement('script');
      script.src = `${MONACO_BASE}/vs/loader.js`;
      script.onload = () => {
        window.require.config({ paths: { vs: `${MONACO_BASE}/vs` } });
        window.require(['vs/editor/editor.main'], () => {
          clearTimeout(timer);
          defineThemes(window.monaco);
          resolve(window.monaco);
        }, (err) => {
          clearTimeout(timer);
          reject(err);
        });
      };
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Monaco failed to load'));
      };
      document.head.appendChild(script);
    }).catch((err) => {
      monacoPromise = Promise.reject(err);
      throw err;
    });
  }
  return monacoPromise;
}

function defineThemes(monaco) {
  monaco.editor.defineTheme('arena-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#151820',
      'editor.lineHighlightBackground': '#1c202a',
      'editorLineNumber.foreground': '#4a5262',
      'editorLineNumber.activeForeground': '#aab3c5',
      'editorGutter.background': '#151820',
    },
  });
  monaco.editor.defineTheme('arena-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#ffffff',
      'editor.lineHighlightBackground': '#f4f6fa',
      'editorLineNumber.foreground': '#a3abb9',
    },
  });
}

const monacoTheme = (theme) => (theme === 'light' ? 'arena-light' : 'arena-dark');

function textareaEditor(container, { value, onChange, commands }) {
  container.classList.add('editor-fallback');
  const ta = document.createElement('textarea');
  ta.spellcheck = false;
  ta.autocapitalize = 'off';
  ta.setAttribute('autocomplete', 'off');
  ta.setAttribute('aria-label', 'Code editor');
  ta.value = value;
  ta.addEventListener('input', () => onChange?.(ta.value));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: end } = ta;
      ta.setRangeText('    ', s, end, 'end');
      onChange?.(ta.value);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      commands.submit();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "'") {
      e.preventDefault();
      commands.run();
    }
  });
  container.appendChild(ta);
  return {
    kind: 'textarea',
    getValue: () => ta.value,
    setValue: (v) => {
      ta.value = v;
    },
    setLanguage: () => {},
    setTheme: () => {},
    focus: () => ta.focus(),
    dispose: () => ta.remove(),
  };
}

export async function createEditor(container, { value, language, theme, onChange, commands }) {
  let monaco;
  try {
    monaco = await loadMonaco();
  } catch {
    return textareaEditor(container, { value, onChange, commands });
  }
  if (!container.isConnected) return null;
  const editor = monaco.editor.create(container, {
    value,
    language,
    theme: monacoTheme(theme),
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 14,
    fontFamily: FONT,
    fontLigatures: false,
    tabSize: 4,
    scrollBeyondLastLine: false,
    padding: { top: 12, bottom: 12 },
    smoothScrolling: true,
    fixedOverflowWidgets: true,
    renderLineHighlight: 'all',
    bracketPairColorization: { enabled: true },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  });
  editor.onDidChangeModelContent(() => onChange?.(editor.getValue()));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Quote, commands.run);
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, commands.submit);
  return {
    kind: 'monaco',
    getValue: () => editor.getValue(),
    setValue: (v) => editor.setValue(v),
    setLanguage: (lang) => monaco.editor.setModelLanguage(editor.getModel(), lang),
    setTheme: (t) => monaco.editor.setTheme(monacoTheme(t)),
    focus: () => editor.focus(),
    dispose: () => editor.dispose(),
  };
}
