// Handhelds MustardOS supports (the device list on mustardos.org), with what the app needs to know about each one.
// Shared by the browser and the server (src/device/model.ts), so it is plain JavaScript without imports.
// The ids are MustardOS's own board names, as in /opt/muos/device/config/board/name and the website's device files.

const H700 = {
  maker: "Anbernic", chip: "Allwinner H700, quad-core Cortex-A53 at 1.5 GHz", gpu: "Mali-G31 MP2",
  ram: 1024, slots: 2, hdmi: true, arch: ["aarch64", "armhf"],
};
const A133 = {
  maker: "TrimUI", chip: "Allwinner A133 Plus, quad-core Cortex-A53 at 1.8 GHz", gpu: "PowerVR GE8300",
  ram: 1024, slots: 1, hdmi: false, arch: ["aarch64"],
};

/**
 * form is horizontal, vertical or clamshell; sticks the number of analog sticks; lid a lid sensor.
 * pm overrides what PortMaster reports when it differs from the hardware (its own device database).
 */
export const DEVICES = [
  { ...H700, id: "rg28xx-h", name: "RG28XX H", alias: ["rg28xx"], inches: 2.83, screen: [640, 480], wifi: false, sticks: 0, form: "horizontal", pm: { board: "rg28xx" } },
  { ...H700, id: "rg34xx-h", name: "RG34XX H", inches: 3.4, screen: [720, 480], wifi: true, sticks: 0, form: "horizontal" },
  { ...H700, id: "rg34xx-sp", name: "RG34XX SP", inches: 3.4, screen: [720, 480], wifi: true, sticks: 2, form: "clamshell", lid: true, ram: 2048 },
  { ...H700, id: "rg35xx-2024", name: "RG35XX 2024", alias: ["rg35xx"], inches: 3.5, screen: [640, 480], wifi: false, sticks: 0, form: "vertical" },
  { ...H700, id: "rg35xx-h", name: "RG35XX H", inches: 3.5, screen: [640, 480], wifi: true, sticks: 2, form: "horizontal" },
  { ...H700, id: "rg35xx-plus", name: "RG35XX Plus", inches: 3.5, screen: [640, 480], wifi: true, sticks: 0, form: "vertical" },
  { ...H700, id: "rg35xx-pro", name: "RG35XX Pro", inches: 3.5, screen: [640, 480], wifi: true, sticks: 2, form: "vertical" },
  { ...H700, id: "rg35xx-sp", name: "RG35XX SP", inches: 3.5, screen: [640, 480], wifi: true, sticks: 0, form: "clamshell", lid: true },
  { ...H700, id: "rg40xx-h", name: "RG40XX H", alias: ["rg40xxh"], inches: 4.0, screen: [640, 480], wifi: true, sticks: 2, form: "horizontal" },
  { ...H700, id: "rg40xx-v", name: "RG40XX V", inches: 4.0, screen: [640, 480], wifi: true, sticks: 1, form: "vertical" },
  { ...H700, id: "rgcubexx-h", name: "RG CubeXX", alias: ["rgcubexx", "rg-cubexx"], inches: 3.95, screen: [720, 720], wifi: true, sticks: 2, form: "horizontal",
    pm: { board: "rgcubexx", screen: [640, 480], extra: ["opengl"] } },
  { ...A133, id: "tui-brick", name: "TrimUI Brick", alias: ["trimui-brick", "brick"], inches: 3.2, screen: [1024, 768], wifi: true, sticks: 0, form: "vertical" },
  { ...A133, id: "tui-spoon", name: "TrimUI Smart Pro", alias: ["trimui-smart-pro", "tui-smart-pro", "smart-pro"], inches: 4.96, screen: [1280, 720], wifi: true, sticks: 2, form: "horizontal" },
];

export const DEFAULT_DEVICE = "rg40xx-h";
export const byId = (id) => DEVICES.find((d) => d.id === id) || null;

/** The device for a board name in any spelling: "rg40xx-h", "RG40XX-H" (the USB name), "RG40XX H", "rg28xx". null if unknown. */
export function deviceFor(board) {
  const key = String(board || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!key) return null;
  return DEVICES.find((d) => d.id === key || (d.alias || []).includes(key) || d.name.toLowerCase().replace(/\s+/g, "-") === key) || null;
}

/** "640 x 480" with a proper times sign. */
export const screenText = (d) => `${d.screen[0]} \u00d7 ${d.screen[1]}`;

const FORMS = { horizontal: "Horizontal", vertical: "Vertical", clamshell: "Clamshell" };
const STICKS = ["D-pad, no analog sticks", "D-pad and one analog stick", "D-pad and two analog sticks"];

/** The hardware table on the Overview. */
export function specs(d) {
  return [
    ["Chip", d.chip],
    ["Graphics", d.gpu],
    ["Memory", `${d.ram / 1024} GB`],
    ["Screen", `${d.inches % 1 ? d.inches : d.inches.toFixed(1)}\u2033, ${screenText(d)}`],
    ["Body", `${FORMS[d.form] || d.form}${d.lid ? " with a lid sensor" : ""}`],
    ["Controls", STICKS[d.sticks] || STICKS[0]],
    ["Cards", d.slots === 2 ? "SD1 for MustardOS, SD2 (TF2) for games" : "One microSD card for MustardOS and games"],
    ["Wireless", d.wifi ? "Wi-Fi" : "None, so no Wi-Fi or SSH connection"],
    ["Ports", `USB-C (charging, MTP)${d.hdmi ? ", mini HDMI" : ""}, 3.5 mm audio`],
  ];
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** What PortMaster's device_info reports on this handheld under MustardOS, for its port requirements. */
export function portCaps(d) {
  const [w, h] = d.pm?.screen || d.screen, g = gcd(w, h);
  const caps = [...d.arch, "power", "restore", `${w / g}:${h / g}`, `${w}x${h}`, "muos", d.pm?.board || d.id];
  for (let i = 0; i <= d.sticks; i++) caps.push(`analog_${i}`);
  if (w * h > 640 * 480) caps.push("hires");
  if (w > 640) caps.push("wide");
  if (d.ram >= 2048) caps.push("2gb");
  caps.push("1gb", ...(d.pm?.extra || []));
  return caps;
}

/** The MustardOS image for a board ("MustardOS_RG40XX-H_2601.1_..."), or null when the name has none. */
export function imageDevice(file) {
  const m = /^MustardOS_([A-Za-z0-9-]+?)_\d/i.exec(String(file || "").split(/[\\/]/).pop());
  return m ? deviceFor(m[1]) : null;
}
