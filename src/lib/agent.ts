import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type AgentRef = { id: number; text: string; lang: string; source: string; lines?: string };
export type AgentMsg = { role: "user" | "assistant"; text: string; refs?: AgentRef[]; error?: string; tool?: string; done?: boolean };
export type AgentEvent = { id: number; kind: "delta" | "final" | "session" | "tool" | "error" | "done"; text: string };
export type AgentInfo = { path: string | null; version: string | null };

export const agentApi = {
  info: (path: string) => invoke<AgentInfo>("agent_info", { path }),
  run: (id: number, prompt: string, path: string, model: string, session: string | null) => invoke<void>("agent_run", { id, prompt, path, model, session }),
  stop: (id: number) => invoke<void>("agent_stop", { id }),
};

type Handler = (e: AgentEvent) => void;
const handlers = new Map<number, Handler>();
let listening: Promise<unknown> | null = null;

export function onAgent(id: number, h: Handler) {
  handlers.set(id, h);
  if (!listening) {
    listening = listen<AgentEvent>("ezchm-agent", (e) => handlers.get(e.payload.id)?.(e.payload));
  }
  return () => handlers.delete(id);
}

let seq = Date.now() % 1_000_000;
export const nextRunId = () => ++seq;

export const MAX_REF = 60000;

export type Action = { id: string; label: string; prompt: string };

export const ACTIONS: Action[] = [
  { id: "explain", label: "解释", prompt: "解释这段代码的作用、主要步骤和关键逻辑。" },
  { id: "comment", label: "逐行注释", prompt: "给这段代码加上中文注释，不改动原有代码，只增加注释，输出完整代码。" },
  { id: "review", label: "找问题", prompt: "检查这段代码可能的 bug、边界情况、事务与并发问题、性能风险，按严重程度列出，并给出修改建议。" },
  { id: "optimize", label: "优化改写", prompt: "在保持结果不变的前提下优化改写这段代码，输出改写后的完整代码，并说明改了什么、为什么。" },
  { id: "objects", label: "涉及对象", prompt: "列出这段代码读写的表、视图、调用的过程和函数、参数与变量，用表格展示，并标明读还是写。" },
  { id: "flow", label: "流程梳理", prompt: "把这段代码的执行流程梳理成有层次的步骤列表，标出分支、循环、异常处理和事务边界。" },
  { id: "testdata", label: "测试数据", prompt: "根据这段代码涉及的表和字段，生成可用于测试的建表语句和测试数据，并给出调用示例。" },
];

export const CONVERT_TARGETS = ["SQL Server", "Oracle", "MySQL", "PostgreSQL"];
export const convertPrompt = (t: string) => `把这段 SQL 转换为 ${t} 语法，输出完整代码，并指出无法直接对应、需要人工确认的地方。`;

const PREAMBLE = "你是 Ezchm 阅读器里的代码阅读助手，帮助阅读 SQL 存储过程和代码文档。始终用中文回答；输出代码时用 Markdown 代码块并标注语言；只根据提供的内容回答，不要读写文件，不要执行命令。";

function fence(text: string) {
  let f = "```";
  while (text.includes(f)) f += "`";
  return f;
}

export function refBlock(r: AgentRef, i: number) {
  const t = r.text.length > MAX_REF ? r.text.slice(0, MAX_REF) + "\n…（已截断）" : r.text;
  const f = fence(t);
  const where = [r.source, r.lines].filter(Boolean).join(" · ");
  return `引用 ${i + 1}${where ? `（${where}）` : ""}：\n${f}${r.lang === "text" ? "" : r.lang}\n${t}\n${f}`;
}

export function buildPrompt(text: string, refs: AgentRef[], first: boolean, context: string) {
  const parts: string[] = [];
  if (first) parts.push(PREAMBLE);
  if (context) parts.push(`当前文档：${context}`);
  refs.forEach((r, i) => parts.push(refBlock(r, i)));
  parts.push(text);
  return parts.join("\n\n");
}
