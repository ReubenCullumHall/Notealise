/* Folder-tree helpers for nested folders.
   Folders form a tree via `parentId` (null = root). Depth is 0-indexed, so
   MAX_FOLDER_DEPTH = 4 allows 5 layers of folders. Notes live in any folder
   (or at root) and never count toward folder depth. */

export const MAX_FOLDER_DEPTH = 4; // 0..4 => 5 layers

export function makeTree(folders) {
  const byId = new Map(folders.map((f) => [f.id, f]));

  const children = new Map(); // parentId (null for root) -> [folder]
  folders.forEach((f) => {
    const p = f.parentId ?? null;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(f);
  });

  const depth = new Map();
  const depthOf = (id) => {
    if (id == null) return -1; // so a root folder's own depth resolves to 0
    if (depth.has(id)) return depth.get(id);
    const f = byId.get(id);
    const d = f ? depthOf(f.parentId ?? null) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  folders.forEach((f) => depthOf(f.id));

  const descCache = new Map();
  const descendants = (id) => {
    if (descCache.has(id)) return descCache.get(id);
    const out = new Set();
    const walk = (pid) => (children.get(pid) || []).forEach((c) => { out.add(c.id); walk(c.id); });
    walk(id);
    descCache.set(id, out);
    return out;
  };

  // how many layers the subtree rooted at `id` extends below itself (0 = no subfolders)
  const height = (id) => {
    const base = depth.get(id) ?? 0;
    let max = base;
    descendants(id).forEach((d) => { const dd = depth.get(d) ?? 0; if (dd > max) max = dd; });
    return max - base;
  };

  // can the subtree rooted at dragId legally become a child of newParentId?
  const canNest = (dragId, newParentId) => {
    const np = newParentId ?? null;
    if (np === dragId) return false;                       // into itself
    if (np != null && descendants(dragId).has(np)) return false; // into own descendant (cycle)
    const newDepth = np == null ? 0 : (depth.get(np) ?? 0) + 1;
    return newDepth + height(dragId) <= MAX_FOLDER_DEPTH;   // stays within 5 layers
  };

  const hasAncestorIn = (id, set) => {
    let p = byId.get(id)?.parentId ?? null;
    while (p != null) {
      if (set.has(p)) return true;
      p = byId.get(p)?.parentId ?? null;
    }
    return false;
  };

  return { byId, children, depth, descendants, height, canNest, hasAncestorIn };
}
