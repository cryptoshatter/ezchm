import { basicSetup } from "codemirror";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { StreamLanguage } from "@codemirror/language";
import { MSSQL, MySQL, PLSQL, PostgreSQL, StandardSQL, sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Dialect } from "./detect";

async function langExt(lang: string, dialect: Dialect): Promise<Extension> {
  switch (lang) {
    case "sql":
      return sql({ dialect: { tsql: MSSQL, plsql: PLSQL, mysql: MySQL, postgresql: PostgreSQL, sql: StandardSQL }[dialect] });
    case "javascript":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: true });
    case "typescript":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true });
    case "python":
      return (await import("@codemirror/lang-python")).python();
    case "java":
      return (await import("@codemirror/lang-java")).java();
    case "c":
    case "cpp":
      return (await import("@codemirror/lang-cpp")).cpp();
    case "csharp": {
      const { csharp } = await import("@codemirror/legacy-modes/mode/clike");
      return StreamLanguage.define(csharp);
    }
    case "xml":
      return (await import("@codemirror/lang-xml")).xml();
    case "html":
      return (await import("@codemirror/lang-html")).html();
    case "css":
      return (await import("@codemirror/lang-css")).css();
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "rust":
      return (await import("@codemirror/lang-rust")).rust();
    case "go":
      return (await import("@codemirror/lang-go")).go();
    case "php":
      return (await import("@codemirror/lang-php")).php();
    case "shellscript": {
      const { shell } = await import("@codemirror/legacy-modes/mode/shell");
      return StreamLanguage.define(shell);
    }
    case "powershell": {
      const { powerShell } = await import("@codemirror/legacy-modes/mode/powershell");
      return StreamLanguage.define(powerShell);
    }
    case "vb": {
      const { vb } = await import("@codemirror/legacy-modes/mode/vb");
      return StreamLanguage.define(vb);
    }
    case "yaml": {
      const { yaml } = await import("@codemirror/legacy-modes/mode/yaml");
      return StreamLanguage.define(yaml);
    }
    case "ini": {
      const { properties } = await import("@codemirror/legacy-modes/mode/properties");
      return StreamLanguage.define(properties);
    }
    default:
      return [];
  }
}

const base = EditorView.theme({
  "&": { fontSize: "var(--code-size)", height: "100%", backgroundColor: "var(--bg)" },
  ".cm-scroller": { fontFamily: "var(--code-font)", lineHeight: "1.6", fontVariantLigatures: "none" },
  ".cm-content": { padding: "10px 0" },
  ".cm-gutters": { backgroundColor: "var(--bg)", border: "none", color: "var(--muted)" },
  "&.cm-focused": { outline: "none" },
});

export type Editor = {
  view: EditorView;
  text: () => string;
  setDark: (d: boolean) => void;
  setWrap: (w: boolean) => void;
  focus: () => void;
  destroy: () => void;
};

export function createEditor(
  parent: HTMLElement,
  o: { text: string; lang: string; dialect: Dialect; dark: boolean; wrap: boolean; onChange?: (dirty: boolean) => void; onSave?: () => void; onCancel?: () => void; onQuote?: () => void },
): Editor {
  const theme = new Compartment();
  const language = new Compartment();
  const wrapping = new Compartment();
  const original = o.text;
  const keys = keymap.of([
    indentWithTab,
    { key: "Mod-s", preventDefault: true, run: () => (o.onSave?.(), true) },
    { key: "Mod-l", run: () => (o.onQuote ? (o.onQuote(), true) : false) },
    { key: "Escape", run: () => (o.onCancel ? (o.onCancel(), true) : false) },
  ]);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: o.text,
      extensions: [
        keys,
        basicSetup,
        base,
        theme.of(o.dark ? oneDark : []),
        language.of([]),
        wrapping.of(o.wrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) o.onChange?.(u.state.doc.toString() !== original);
        }),
      ],
    }),
  });
  langExt(o.lang, o.dialect).then((ext) => view.dispatch({ effects: language.reconfigure(ext) }));
  return {
    view,
    text: () => view.state.doc.toString(),
    setDark: (d) => view.dispatch({ effects: theme.reconfigure(d ? oneDark : []) }),
    setWrap: (w) => view.dispatch({ effects: wrapping.reconfigure(w ? EditorView.lineWrapping : []) }),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
