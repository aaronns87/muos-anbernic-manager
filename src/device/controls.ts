// Device Controls: live stick sampling, joycal calibration, and joycal.json over SSH.

import { UserError } from "../errors.ts";
import { say } from "../log.ts";
import { runCommand, sshStatus } from "./ssh.ts";
import { wifiModel } from "./model.ts";

const JOYCAL_BIN = "/opt/muos/bin/joycal";
const JOYCAL_JSON = "/opt/muos/share/conf/joycal.json";
const BOARD_STICK = "/opt/muos/device/config/board/stick";

export type InputDevice = {
  path: string;
  name: string;
  handlers: string[];
  abs: number[];
  keys: boolean;
  /** Higher = better default for live stick pads. */
  score: number;
  role: "sticks" | "buttons" | "mixed" | "other";
};

export type AxisSample = {
  code: number;
  name: string;
  value: number;
  min: number;
  max: number;
  fuzz: number;
  flat: number;
};

const ABS_NAMES: Record<number, string> = {
  0: "ABS_X", 1: "ABS_Y", 2: "ABS_Z", 3: "ABS_RX", 4: "ABS_RY", 5: "ABS_RZ",
  16: "ABS_HAT0X", 17: "ABS_HAT0Y",
};

/** Linux BTN_* / common handheld face-button codes to UI labels (Nintendo-style A/B on the right). */
const CODE_LABEL: Record<number, string> = {
  // BTN_GAMEPAD / BTN_SOUTH.. (Xbox numbering in kernel; labels match typical handheld face layout)
  304: "B", // BTN_SOUTH
  305: "A", // BTN_EAST
  306: "C",
  307: "X", // BTN_NORTH
  308: "Y", // BTN_WEST
  309: "Z",
  310: "L1", 311: "R1", 312: "L2", 313: "R2",
  314: "Select", 315: "Start", 316: "Mode",
  317: "L3", 318: "R3",
  // D-pad as buttons on some boards
  544: "Up", 545: "Down", 546: "Left", 547: "Right",
  // Keyboard-style face keys used by some muOS "Keys" nodes
  28: "A", // KEY_ENTER
  57: "B", // KEY_SPACE
  29: "X", // KEY_LEFTCTRL
  56: "Y", // KEY_LEFTALT
  1: "Select", // KEY_ESC
  14: "Start", // KEY_BACKSPACE
  103: "Up", 108: "Down", 105: "Left", 106: "Right",
};

const quote = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function scoreDevice(name: string, handlers: string[], abs: number[], hasKeys: boolean): { score: number; role: InputDevice["role"] } {
  const n = name.toLowerCase();
  const hasJs = handlers.some((h) => /^js\d+$/.test(h));
  const stickAbs = abs.filter((c) => [0, 1, 3, 4].includes(c)).length;
  const isKeys = /\bkeys?\b|keyboard|gpio|adc-keys|power/.test(n);
  const isPad = /gamepad|joystick|joypad|stick|controller|muos(?!.*key)/i.test(n) || hasJs;
  let score = 0;
  score += stickAbs * 10;
  if (hasJs) score += 25;
  if (isPad) score += 20;
  if (isKeys) score -= 40;
  if (hasKeys && stickAbs === 0) score -= 5;
  if (stickAbs >= 2 && !isKeys) score += 15;
  let role: InputDevice["role"] = "other";
  if (stickAbs >= 2 && hasKeys) role = "mixed";
  else if (stickAbs >= 2 || hasJs) role = "sticks";
  else if (hasKeys || isKeys) role = "buttons";
  return { score, role };
}

/** Parse /proc/bus/input/devices into joystick / keys event nodes. */
export function parseInputDevices(text: string): InputDevice[] {
  const blocks = text.split(/\n(?=I:)/);
  const out: InputDevice[] = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    const name = (/^N: Name="([^"]*)"/m.exec(block) || [])[1] || "Unknown";
    const handlers = (/^H: Handlers=(.+)$/m.exec(block) || [])[1]?.trim().split(/\s+/) || [];
    const event = handlers.find((h) => /^event\d+$/.test(h));
    if (!event) continue;
    const absLine = (/^B: ABS=(.+)$/m.exec(block) || [])[1]?.trim();
    const keyLine = (/^B: KEY=(.+)$/m.exec(block) || [])[1];
    const abs = absBits(absLine);
    const hasJs = handlers.some((h) => /^js\d+$/.test(h));
    const hasKeys = !!keyLine;
    const stickAbs = abs.some((c) => [0, 1, 3, 4].includes(c));
    // Keep stick devices and button-only Keys nodes (for face buttons).
    if (!stickAbs && !hasJs && !hasKeys) continue;
    if (!stickAbs && !hasJs && hasKeys && !/key|gpio|button|pad|muos/i.test(name)) continue;
    const { score, role } = scoreDevice(name, handlers, abs, hasKeys);
    out.push({
      path: `/dev/input/${event}`,
      name,
      handlers,
      abs,
      keys: hasKeys,
      score,
      role,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

export function pickStickDevice(devices: InputDevice[]): InputDevice | null {
  return devices.find((d) => d.role === "sticks" || d.role === "mixed")
    || devices.find((d) => d.abs.some((c) => [0, 1, 3, 4].includes(c)))
    || null;
}

export function pickButtonDevice(devices: InputDevice[], stick: InputDevice | null): InputDevice | null {
  if (stick?.keys) return stick;
  return devices.find((d) => d.role === "buttons" || (d.keys && d.role !== "sticks")) || stick;
}

function absBits(hex: string | undefined): number[] {
  if (!hex) return [];
  // Words are low code first (same order as /proc/bus/input/devices).
  const parts = hex.trim().split(/\s+/);
  const codes: number[] = [];
  for (let wi = 0; wi < parts.length; wi++) {
    const word = Number.parseInt(parts[wi], 16);
    if (!Number.isFinite(word)) continue;
    for (let bit = 0; bit < 32; bit++) {
      if (word & (1 << bit)) codes.push(wi * 32 + bit);
    }
  }
  return codes.sort((a, b) => a - b);
}

async function requireSsh() {
  const s = await sshStatus();
  if (!s.configured) throw new UserError("Add the handheld's Wi-Fi address under Overview first.");
  if (!s.reachable) {
    throw new UserError("Connect over Wi-Fi with Configuration > Web Services > Secure Shell on to use Controls.");
  }
  return s;
}

const SAMPLE_PY = String.raw`import fcntl,struct,sys,json
paths=[p for p in sys.argv[1].split(",") if p]
codes=[int(x) for x in sys.argv[2].split(",") if x!=""]
EVIOCGABS=lambda c:(2<<30)|(24<<16)|(ord("E")<<8)|(0x40+c)
EVIOCGKEY=(2<<30)|(0x208<<16)|(ord("E")<<8)|0x18
# Face + shoulders + d-pad + common muOS keycodes
WATCH=set([1,14,28,29,56,57,103,105,106,108]+list(range(304,319))+list(range(544,548)))
axes=[]; pressed=[]
seen=set()
for path in paths:
  try:
    f=open(path,"rb")
  except Exception as e:
    continue
  fd=f.fileno()
  if path==paths[0]:
    for c in codes:
      buf=bytearray(24)
      try:
        fcntl.ioctl(fd,EVIOCGABS(c),buf)
        v,mn,mx,fu,fl,_=struct.unpack("<6i",buf)
        axes.append({"code":c,"value":v,"min":mn,"max":mx,"fuzz":fu,"flat":fl})
      except Exception as e:
        axes.append({"code":c,"error":str(e)})
  kbuf=bytearray(512)
  try:
    fcntl.ioctl(fd,EVIOCGKEY,kbuf)
    for code in sorted(WATCH):
      if kbuf[code//8]&(1<<(code%8)) and code not in seen:
        seen.add(code)
        pressed.append(code)
  except Exception:
    pass
  f.close()
print(json.dumps({"axes":axes,"pressed":pressed}))
`;

export async function controlsSnapshot() {
  const ssh = await requireSsh();
  const script = [
    `echo "@host\t$(hostname 2>/dev/null || true)"`,
    `echo "@stick\t$(cat ${BOARD_STICK} 2>/dev/null || echo)"`,
    `if [ -x ${JOYCAL_BIN} ] || command -v joycal >/dev/null 2>&1; then echo "@joycal\tyes"; else echo "@joycal\tno"; fi`,
    `if [ -f ${JOYCAL_JSON} ]; then echo "@joyjson\tyes"; else echo "@joyjson\tno"; fi`,
    `echo "@devices_begin"; cat /proc/bus/input/devices 2>/dev/null; echo "@devices_end"`,
    `python3 -V 2>/dev/null | head -1 | sed 's/^/@py\t/' || echo "@py\t"`,
  ].join("; ");
  const { out } = await runCommand(script, 20_000);
  const stickRaw = (/^@stick\t(.*)$/m.exec(out) || [])[1]?.trim() ?? "";
  const sticks = /^\d+$/.test(stickRaw) ? Number(stickRaw) : null;
  const joycal = (/^@joycal\t(.*)$/m.exec(out) || [])[1]?.trim() === "yes";
  const hasJson = (/^@joyjson\t(.*)$/m.exec(out) || [])[1]?.trim() === "yes";
  const py = (/^@py\t(.*)$/m.exec(out) || [])[1]?.trim() || "";
  const devicesBlob = out.slice(out.indexOf("@devices_begin") + "@devices_begin".length, out.indexOf("@devices_end"));
  const devices = parseInputDevices(devicesBlob);
  const stickDev = pickStickDevice(devices);
  const buttonDev = pickButtonDevice(devices, stickDev);
  let joycalJson: unknown = null;
  if (hasJson) {
    try {
      const { out: raw } = await runCommand(`cat ${quote(JOYCAL_JSON)}`, 10_000);
      joycalJson = JSON.parse(raw);
    } catch {
      joycalJson = null;
    }
  }
  const detected = await wifiModel(true).catch(() => null);
  return {
    reachable: true,
    host: ssh.host,
    sticks,
    joycal,
    joycalBin: joycal ? JOYCAL_BIN : "",
    joycalPath: JOYCAL_JSON,
    joycalJson,
    python: !!py,
    devices,
    stickDevice: stickDev?.path || "",
    buttonDevice: buttonDev?.path || "",
    board: detected ? { id: detected.id, board: detected.board, via: detected.via } : null,
    experimental: true,
    note: "Analog calibration uses MustardOS's experimental joycal tool. Close games first so nothing else holds the sticks. Pick the Gamepad/joystick device for sticks (not muOS-Keys).",
  };
}

export async function controlsState(query: URLSearchParams) {
  await requireSsh();
  const device = String(query.get("device") || "").trim();
  const buttonsFrom = String(query.get("buttons") || "").trim();
  if (!/^\/dev\/input\/event\d+$/.test(device)) throw new UserError("Pick a valid input device.");
  const paths = [device];
  if (buttonsFrom && /^\/dev\/input\/event\d+$/.test(buttonsFrom) && buttonsFrom !== device) paths.push(buttonsFrom);
  const codes = String(query.get("axes") || "0,1,3,4")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < 64);
  const axisList = (codes.length ? codes : [0, 1, 3, 4]).join(",");
  const b64 = Buffer.from(SAMPLE_PY, "utf8").toString("base64");
  const cmd = [
    `TMP=$(mktemp)`,
    `printf '%s' ${quote(b64)} | base64 -d > "$TMP"`,
    `python3 "$TMP" ${quote(paths.join(","))} ${quote(axisList)} 2>/dev/null || echo '{"error":"sample failed"}'`,
    `rm -f "$TMP"`,
  ].join("; ");
  const { out } = await runCommand(cmd, 12_000);
  const line = out.trim().split(/\n/).filter(Boolean).at(-1) || "{}";
  let parsed: {
    axes?: { code: number; value?: number; min?: number; max?: number; fuzz?: number; flat?: number; error?: string }[];
    pressed?: number[];
    error?: string;
  };
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new UserError("Could not read stick position from the handheld. Close any game and try again.");
  }
  if (parsed.error && !parsed.axes?.length) {
    throw new UserError("Could not sample the controller. Close games on the handheld, then try again.");
  }
  const axes: AxisSample[] = (parsed.axes || [])
    .filter((a) => a.value !== undefined)
    .map((a) => ({
      code: a.code,
      name: ABS_NAMES[a.code] || `ABS_${a.code}`,
      value: a.value!,
      min: a.min ?? -32768,
      max: a.max ?? 32767,
      fuzz: a.fuzz ?? 0,
      flat: a.flat ?? 0,
    }));
  const buttons: Record<string, boolean> = {};
  for (const code of parsed.pressed || []) {
    const label = CODE_LABEL[code] || `Key${code}`;
    buttons[label] = true;
  }
  return { at: Date.now(), device, buttonsFrom: buttonsFrom || device, axes, buttons, pressed: parsed.pressed || [] };
}

export async function readJoycal() {
  await requireSsh();
  const { out, code } = await runCommand(`cat ${quote(JOYCAL_JSON)} 2>/dev/null; echo; echo @end`, 10_000);
  if (!out.includes("@end")) throw new UserError("Could not read joycal.json from the handheld.");
  const body = out.replace(/\n@end\s*$/, "").trim();
  if (!body || code) return { path: JOYCAL_JSON, json: null };
  try {
    return { path: JOYCAL_JSON, json: JSON.parse(body) };
  } catch {
    throw new UserError("joycal.json on the handheld is not valid JSON.");
  }
}

export async function saveJoycal(body: Record<string, unknown>) {
  await requireSsh();
  if (body.json === null || body.json === undefined) {
    await runCommand(`rm -f ${quote(JOYCAL_JSON)} && sync && echo @ok`, 10_000);
    say("green", "CONTROLS", "Removed joycal.json");
    return { path: JOYCAL_JSON, json: null };
  }
  let text: string;
  try {
    text = JSON.stringify(body.json, null, 2);
    JSON.parse(text);
  } catch {
    throw new UserError("Calibration data must be valid JSON.");
  }
  if (text.length > 200_000) throw new UserError("Calibration file is too large.");
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const { out } = await runCommand(
    `printf '%s' ${quote(b64)} | base64 -d > ${quote(JOYCAL_JSON + ".tmp")} && mv -f ${quote(JOYCAL_JSON + ".tmp")} ${quote(JOYCAL_JSON)} && sync && echo @ok`,
    15_000,
  );
  if (!out.includes("@ok")) throw new UserError("Could not write joycal.json on the handheld.");
  say("green", "CONTROLS", `Wrote ${JOYCAL_JSON}`);
  return { path: JOYCAL_JSON, json: body.json };
}

export async function runCalibrate(body: Record<string, unknown>) {
  await requireSsh();
  const device = String(body.device || "").trim();
  if (!/^\/dev\/input\/event\d+$/.test(device)) throw new UserError("Pick a valid input device.");
  const noise = Math.min(30, Math.max(1, Number(body.noise) || 2));
  const duration = Math.min(60, Math.max(3, Number(body.duration) || 5));
  const deadzonePad = Math.min(64, Math.max(0, Number(body.deadzonePad) || 8));
  const binCheck = await runCommand(
    `B=${JOYCAL_BIN}; command -v joycal >/dev/null && B=$(command -v joycal); [ -x "$B" ] && echo "@bin\t$B" || echo "@missing"`,
    8_000,
  );
  if (binCheck.out.includes("@missing")) {
    throw new UserError("This MustardOS build has no joycal tool. Update MustardOS, or calibrate from the handheld when the tool is available.");
  }
  const bin = (/^@bin\t(.+)$/m.exec(binCheck.out) || [])[1]?.trim() || JOYCAL_BIN;
  const tmp = "/tmp/muos-joycal.json";
  const timeout = (noise + duration + 25) * 1000;
  const cmd = [
    `${quote(bin)} ${quote(device)} --noise ${noise} --duration ${duration} --deadzone-pad ${deadzonePad} --out ${quote(tmp)}`,
    `EC=$?`,
    `if [ -f ${quote(tmp)} ]; then echo "@json_begin"; cat ${quote(tmp)}; echo; echo "@json_end"; fi`,
    `echo "@exit\t$EC"`,
  ].join("; ");
  say("yellow", "CONTROLS", `Running joycal on ${device} (noise ${noise}s, move ${duration}s)`);
  const { out, err } = await runCommand(cmd, timeout);
  const exit = Number((/^@exit\t(\d+)/m.exec(out) || [])[1] ?? 1);
  const jsonSlice = out.includes("@json_begin")
    ? out.slice(out.indexOf("@json_begin") + "@json_begin".length, out.indexOf("@json_end")).trim()
    : "";
  let json: unknown = null;
  if (jsonSlice) {
    try { json = JSON.parse(jsonSlice); } catch { json = null; }
  }
  if (!json) {
    const hint = (err || out).replace(/@\w+.*/g, "").trim().slice(0, 400);
    throw new UserError(
      hint
        ? `Calibration did not produce a file. ${hint}`
        : "Calibration failed. Close games on the handheld, keep the sticks still for the rest phase, then move them in full circles.",
    );
  }
  if (body.apply !== false) {
    await saveJoycal({ json });
    await runCommand(`rm -f ${quote(tmp)}`, 5_000).catch(() => {});
  }
  return {
    ok: exit === 0 || !!json,
    exit,
    json,
    applied: body.apply !== false,
    path: JOYCAL_JSON,
    log: [out, err].filter(Boolean).join("\n").slice(0, 2000),
    experimental: true,
  };
}

/** Setting keys shown on the Controls tab (system input / feedback). */
export const CONTROLS_SETTING_KEYS = [
  "settings/advanced/sticknav",
  "settings/advanced/dpad_swap",
  "settings/advanced/rumble",
] as const;
