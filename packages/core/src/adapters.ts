import type { EdgeType, NodeStatus } from "./types.js";

export type ImportAdapter = "roadmap-html" | "markdown-checklist";

export interface AdapterNode {
  id: string;
  title: string;
  status: NodeStatus;
  spec: string;
  acceptance: string;
  milestone?: string;
  group_name?: string;
  status_reason?: string;
}

export interface AdapterEdge {
  from_node: string;
  to_node: string;
  type: EdgeType;
}

export interface AdapterOutput {
  nodes: AdapterNode[];
  edges: AdapterEdge[];
}

export function adaptImportSource(adapter: ImportAdapter, content: string): AdapterOutput {
  if (adapter === "roadmap-html") return adaptRoadmapHtml(content);
  if (adapter === "markdown-checklist") return adaptMarkdownChecklist(content);
  throw new Error("Unknown import adapter");
}

export function adaptRoadmapHtml(content: string): AdapterOutput {
  const headings = [...content.matchAll(/<h3\b[^>]*>(?<title>[\s\S]*?)<\/h3>/gi)];
  const planned: Array<{ node: AdapterNode; deps: string[] }> = [];
  const seen = new Set<string>();
  const idByRef = new Map<string, string>();
  for (const [index, heading] of headings.entries()) {
    const title = textFromHtml(heading.groups?.title ?? "");
    if (!title) continue;
    const headingStart = heading.index ?? 0;
    const next = headings[index + 1]?.index ?? content.length;
    const segment = cardSegment(content, headingStart, next);
    const explicitId = firstAttribute(segment, "data-qd-id") ?? firstAttribute(segment, "id");
    const id = uniqueId(slugify(explicitId || title), seen);
    const phase = textFromHtml(firstClassText(segment, "ph") ?? "");
    const deps = dependencyRefs(segment);
    const node = {
      id,
      title,
      status: statusFromHtmlSegment(segment),
      spec: htmlSpec(segment, title),
      acceptance: htmlAcceptance(segment, title),
      milestone: phase || undefined,
      group_name: phase || undefined,
      status_reason: deps.length > 0 ? `Imported dependencies: ${deps.join(", ")}` : undefined,
    };
    planned.push({ node, deps });
    idByRef.set(slugify(title), id);
    idByRef.set(id, id);
    if (explicitId) idByRef.set(slugify(explicitId), id);
  }
  const nodes = planned.map((item) => item.node);
  const edges = planned.flatMap(({ node, deps }) =>
    deps.map((dep) => ({
      from_node: idByRef.get(slugify(dep)) ?? slugify(dep),
      to_node: node.id,
      type: "requires" as EdgeType,
    })),
  );
  assertEdgesReferenceKnownNodes(nodes, edges);
  return { nodes, edges };
}

export function adaptMarkdownChecklist(content: string): AdapterOutput {
  const lines = content.split(/\r?\n/);
  const nodes: AdapterNode[] = [];
  const edges: AdapterEdge[] = [];
  const seen = new Set<string>();
  let current: AdapterNode | null = null;
  for (const rawLine of lines) {
    const nodeMatch = /^\s*[-*]\s+\[(?<checked>[ xX])\]\s+(?<title>.+?)\s*$/.exec(rawLine);
    if (nodeMatch?.groups) {
      const rawTitle = nodeMatch.groups.title;
      if (!rawTitle) continue;
      const title = stripMarkdown(rawTitle);
      const id = uniqueId(slugify(title), seen);
      const checked = nodeMatch.groups.checked ?? "";
      current = {
        id,
        title,
        status: checked.trim() ? "done" : "ready",
        spec: title,
        acceptance: title,
      };
      nodes.push(current);
      continue;
    }
    if (!current) continue;
    const depMatch = /^\s+[-*]\s+depends\s+on\s*:\s*(?<deps>.+)$/i.exec(rawLine);
    if (depMatch?.groups?.deps) {
      for (const dep of splitRefs(depMatch.groups.deps)) {
        edges.push({ from_node: slugify(dep), to_node: current.id, type: "requires" });
      }
      continue;
    }
    const acceptanceMatch = /^\s+[-*]\s+(?:acceptance|done when)\s*:\s*(?<text>.+)$/i.exec(rawLine);
    if (acceptanceMatch?.groups?.text) {
      current.acceptance = stripMarkdown(acceptanceMatch.groups.text);
      continue;
    }
    const detailMatch = /^\s+[-*]\s+(?<text>.+)$/i.exec(rawLine);
    if (detailMatch?.groups?.text) {
      const detail = stripMarkdown(detailMatch.groups.text);
      current.spec = current.spec === current.title ? detail : `${current.spec}\n${detail}`;
    }
  }
  assertEdgesReferenceKnownNodes(nodes, edges);
  return { nodes, edges };
}

function htmlSpec(segment: string, title: string): string {
  const goal = textFromHtml(firstClassText(segment, "goal") ?? "");
  if (goal) return goal;
  const paragraph = textFromHtml(firstTagText(segment, "p") ?? "");
  return paragraph || title;
}

function cardSegment(content: string, headingStart: number, nextHeadingStart: number): string {
  const container = nearestOpenContainer(content, headingStart);
  if (container) {
    const closeStart = content.indexOf(`</${container.tag}>`, headingStart);
    if (closeStart >= 0 && closeStart < nextHeadingStart) {
      return content.slice(container.start, closeStart + container.tag.length + 3);
    }
  }
  const nextContainer = ["<section", "<article", "<div"]
    .map((tag) => content.indexOf(tag, headingStart + 1))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const end =
    nextContainer === undefined ? nextHeadingStart : Math.min(nextHeadingStart, nextContainer);
  return content.slice(headingStart, end);
}

function nearestOpenContainer(
  content: string,
  headingStart: number,
): { tag: string; start: number } | null {
  const starts = ["section", "article", "div"]
    .map((tag) => ({ tag, start: content.lastIndexOf(`<${tag}`, headingStart) }))
    .filter((item) => item.start >= 0)
    .sort((a, b) => b.start - a.start);
  const candidate = starts[0];
  if (!candidate) return null;
  const priorClose = content.lastIndexOf(`</${candidate.tag}>`, headingStart);
  if (priorClose > candidate.start) return null;
  const openEnd = content.indexOf(">", candidate.start);
  return openEnd >= 0 && openEnd < headingStart ? candidate : null;
}

function htmlAcceptance(segment: string, title: string): string {
  const items = [...segment.matchAll(/<li\b[^>]*>(?<text>[\s\S]*?)<\/li>/gi)]
    .map((item) => textFromHtml(item.groups?.text ?? ""))
    .filter(Boolean);
  return items.length > 0 ? items.join("\n") : htmlSpec(segment, title);
}

function statusFromHtmlSegment(segment: string): NodeStatus {
  const classText = [
    ...segment.matchAll(/class=["'](?<class>[^"']+)["']/gi),
    ...segment.matchAll(/data-status=["'](?<class>[^"']+)["']/gi),
    ...segment.matchAll(/aria-label=["'](?<class>[^"']+)["']/gi),
  ]
    .map((item) => item.groups?.class ?? "")
    .join(" ");
  const text = textFromHtml(segment);
  const combined = `${classText} ${text}`;
  if (/\b(done|complete|completed|landed|merged)\b/i.test(combined)) return "done";
  if (/\b(active|doing|in[-_\s]?progress|working)\b/i.test(combined)) return "working";
  if (/\b(blocked|external blocker|manual blocker)\b/i.test(combined)) return "blocked";
  if (/\b(cancelled|canceled|not planned)\b/i.test(combined)) return "cancelled";
  return "ready";
}

function dependencyRefs(segment: string): string[] {
  const classRefs = classTexts(segment, "dep").flatMap((text) => splitRefs(textFromHtml(text)));
  const dataRefs = [
    ...segment.matchAll(/data-(?:depends-on|deps)=["'](?<deps>[^"']+)["']/gi),
  ].flatMap((match) => splitRefs(match.groups?.deps ?? ""));
  const textRefs = [...textFromHtml(segment).matchAll(/depends?\s+on\s*:\s*([^.;]+)/gi)].flatMap(
    (match) => splitRefs(match[1] ?? ""),
  );
  return uniqueRefs([...classRefs, ...dataRefs, ...textRefs]);
}

function firstClassText(segment: string, className: string): string | undefined {
  return classTexts(segment, className)[0];
}

function classTexts(segment: string, className: string): string[] {
  return [
    ...segment.matchAll(
      /<[^>]*class=["'](?<className>[^"']+)["'][^>]*>(?<text>[\s\S]*?)<\/[^>]+>/gi,
    ),
  ]
    .filter((match) => (match.groups?.className ?? "").split(/\s+/).includes(className))
    .map((match) => match.groups?.text ?? "");
}

function firstTagText(segment: string, tag: string): string | undefined {
  return new RegExp(`<${tag}\\b[^>]*>(?<text>[\\s\\S]*?)<\\/${tag}>`, "i").exec(segment)?.groups
    ?.text;
}

function firstAttribute(segment: string, name: string): string | undefined {
  return new RegExp(`\\b${name}=["'](?<value>[^"']+)["']`, "i").exec(segment)?.groups?.value;
}

function assertEdgesReferenceKnownNodes(nodes: AdapterNode[], edges: AdapterEdge[]): void {
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.from_node)) {
      throw new Error(`adapter dependency references unknown node: ${edge.from_node}`);
    }
    if (!nodeIds.has(edge.to_node)) {
      throw new Error(`adapter dependency references unknown node: ${edge.to_node}`);
    }
  }
}

function splitRefs(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueRefs(refs: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const ref of refs) {
    const key = slugify(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
}

function textFromHtml(value: string): string {
  return decodeEntities(
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function stripMarkdown(value: string): string {
  return value.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "node"
  );
}

function uniqueId(base: string, seen: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (seen.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  seen.add(candidate);
  return candidate;
}
