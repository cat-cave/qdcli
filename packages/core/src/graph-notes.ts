import { randomUUID } from "node:crypto";
import { all, openDatabase, run } from "./db.js";
import { assertNodeExists } from "./graph-internal.js";
import { getNode } from "./graph-nodes.js";
import type { NodeNote, NoteKind } from "./types.js";

export async function addNodeNote(
  root: string,
  nodeId: string,
  text: string,
  input: { kind?: NoteKind; evidence?: string | null } = {},
): Promise<NodeNote> {
  const db = await openDatabase(root);
  await assertNodeExists(db, nodeId);
  const note: NodeNote = {
    id: randomUUID(),
    node_id: nodeId,
    kind: input.kind ?? "note",
    text,
    evidence: input.evidence ?? null,
    created_at: new Date().toISOString(),
  };
  await run(
    db,
    "insert into node_notes (id, node_id, kind, text, evidence, created_at) values (?, ?, ?, ?, ?, ?)",
    [note.id, note.node_id, note.kind, note.text, note.evidence, note.created_at],
  );
  const node = await getNode(root, nodeId);
  const statusReason = [node.status_reason, `[${note.created_at}] ${text}`]
    .filter(Boolean)
    .join("\n");
  await run(db, "update nodes set status_reason = ?, updated_at = ? where id = ?", [
    statusReason,
    note.created_at,
    nodeId,
  ]);
  return note;
}

export async function listNodeNotes(
  root: string,
  nodeId: string,
  input: { kinds?: NoteKind[] } = {},
): Promise<NodeNote[]> {
  const db = await openDatabase(root);
  if (input.kinds && input.kinds.length > 0) {
    return all<NodeNote>(
      db,
      `select * from node_notes where node_id = ? and kind in (${input.kinds.map(() => "?").join(", ")}) order by created_at asc`,
      [nodeId, ...input.kinds],
    );
  }
  return all<NodeNote>(db, "select * from node_notes where node_id = ? order by created_at asc", [
    nodeId,
  ]);
}
