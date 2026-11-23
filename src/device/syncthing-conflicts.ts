// Syncthing conflict copies (name.sync-conflict-DATE-TIME-ID.ext) on the handheld: find them under save/ and
// info/ (settings and config; the artwork catalogue is skipped) and resolve one at a time over SSH.

import { UserError } from "../errors.ts";
import { say } from "../log.ts";
import { STORAGE } from "../saves.ts";
import { shq } from "../util.ts";
import { runCommand, sshStatus } from "./ssh.ts";

export interface SyncConflict {
  /** Path relative to the handheld storage root, e.g. save/file/Game.sync-conflict-20260101-120000-ABC.srm. */
  path: string;
  /** The file it was a copy of. */
  original: string;
  size: number;
  mtime: number;
  originalExists: boolean;
}

export type ConflictAction = "keep-device" | "keep-conflict" | "delete-conflict";
export const CONFLICT_ACTIONS: ConflictAction[] = ["keep-device", "keep-conflict", "delete-conflict"];

const MARK = /\.sync-conflict-\d{8}-\d{6}(?:-[A-Za-z0-9]+)?/;
const ROOTS = ["save", "info"];

const FIND_SCRIPT = `
cd ${STORAGE} || exit 1
for d in ${ROOTS.join(" ")}; do
  [ -d "$d" ] || continue
  find "$d" -path info/catalogue -prune -o -type f -name '*.sync-conflict-*' -print | while IFS= read -r f; do
    o=$(printf '%s' "$f" | sed -E 's/\\.sync-conflict-[0-9]{8}-[0-9]{6}(-[A-Za-z0-9]+)?//')
    e=0; [ -f "$o" ] && e=1
    printf '=C\\t%s\\t%s\\t%s\\t%s\\n' "$f" "$(wc -c <"$f")" "$(date -r "$f" +%s)" "$e"
  done
done
echo "=E"
`;

/** Original name for a conflict path, or "" when the name is not a Syncthing conflict. */
export function originalOf(conflict: string): string {
  return MARK.test(conflict) ? conflict.replace(MARK, "") : "";
}

/** A path under save/ or info/ with no way out of them. */
function safePath(p: string): boolean {
  if (!p || p.startsWith("/") || p.includes("\0") || p.split("/").includes("..")) return false;
  return ROOTS.some((r) => p.startsWith(`${r}/`)) && !p.startsWith("info/catalogue/");
}

export async function findConflicts(): Promise<{ reachable: boolean; host: string; conflicts: SyncConflict[] }> {
  const status = await sshStatus();
  if (!status.configured || !status.reachable) return { reachable: false, host: status.host, conflicts: [] };
  const { out } = await runCommand(FIND_SCRIPT, 60_000);
  if (!out.includes("=E")) throw new UserError("The handheld did not answer completely. Try again.");
  const conflicts: SyncConflict[] = [];
  for (const line of out.split("\n")) {
    const [tag, p, size, mtime, exists] = line.split("\t");
    if (tag !== "=C" || !safePath(p)) continue;
    const original = originalOf(p);
    if (!original) continue;
    conflicts.push({ path: p, original, size: Number(size) || 0, mtime: Number(mtime) || 0, originalExists: exists === "1" });
  }
  conflicts.sort((a, b) => a.path.localeCompare(b.path));
  return { reachable: true, host: status.host, conflicts };
}

export async function conflictsJson() {
  return findConflicts();
}

/** keep-device and delete-conflict remove the conflict copy; keep-conflict replaces the original with it first. */
export async function resolveConflict(body: Record<string, unknown>) {
  const p = String(body.path ?? "");
  const action = String(body.action ?? "") as ConflictAction;
  if (!CONFLICT_ACTIONS.includes(action)) throw new UserError("Pick keep-device, keep-conflict or delete-conflict.");
  if (!safePath(p) || !originalOf(p)) throw new UserError("That is not a Syncthing conflict file.");
  const found = await findConflicts();
  if (!found.reachable) throw new UserError("Connect the handheld over Wi-Fi with SSH on.");
  const hit = found.conflicts.find((c) => c.path === p);
  if (!hit) throw new UserError("That conflict file is no longer on the handheld.");
  const command = action === "keep-conflict"
    ? `cd ${STORAGE} && mv -f -- ${shq(hit.path)} ${shq(hit.original)} && sync && echo @ok`
    : `cd ${STORAGE} && rm -f -- ${shq(hit.path)} && sync && echo @ok`;
  const { out, err } = await runCommand(command, 60_000);
  if (!out.includes("@ok")) throw new UserError(`Could not resolve the conflict on the handheld${err ? `: ${err.trim()}` : ""}.`);
  say("yellow", "SYNC", action === "keep-conflict"
    ? `Replaced ${hit.original} with its Syncthing conflict copy.`
    : `Removed Syncthing conflict copy of ${hit.original}.`);
  return { ok: true, path: hit.path, original: hit.original, action, ...(await findConflicts()) };
}
