import { norm } from "./systems.ts";
import type { Game } from "./library.ts";

/** Whether a library title matches Game Tuning preset hints for its system. */
export function tuningHintKey(code: string, g: Pick<Game, "f" | "t" | "k">): boolean {
  const title = norm(g.t);
  if (!title) return false;
  if (code === "PSP") return /god of war|grand theft auto|monster hunter|tekken|gran turismo|final fantasy|kingdom hearts|persona/i.test(title);
  if (code === "N64") return /perfect dark|goldeneye|banjo|conker|major|donkey kong 64/i.test(title);
  if (code === "PS" || code === "SATURN" || code === "DREAMCAST") return true;
  return false;
}