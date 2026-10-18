// Device Benchmark: connectivity, storage speed and a short stoppable CPU/thermal load over SSH.

import { UserError } from "../errors.ts";
import { deviceStats, runCommand, sshStatus } from "./ssh.ts";

export type BenchTest = "connect" | "storage" | "cpu";

type Sample = { at: number; cpu: number | null; mhz: number; governor: string; temp: number | null };

type ConnectResult = {
  ok: boolean;
  latencyMs: number | null;
  host: string;
  hostname: string;
  ip: string;
  uptime: number;
  load: number[];
  battery: { percent: number; status: string } | null;
  storage: { name: string; mount: string; free: number; total: number }[];
  error?: string;
};

type StorageMountResult = {
  mount: string;
  name: string;
  writeMBps: number | null;
  readMBps: number | null;
  skipped?: string;
  error?: string;
};

type CpuResult = {
  durationMs: number;
  peakCpu: number | null;
  avgCpu: number | null;
  peakTemp: number | null;
  samples: Sample[];
  stopped: boolean;
  error?: string;
};

type Phase = {
  id: BenchTest;
  state: "pending" | "running" | "done" | "error" | "skipped";
  log: string[];
  connect?: ConnectResult;
  storage?: StorageMountResult[];
  cpu?: CpuResult;
};

type Run = {
  state: "idle" | "running" | "done" | "error";
  tests: BenchTest[];
  phases: Phase[];
  current: BenchTest | null;
  log: string[];
  startedAt: number | null;
  finishedAt: number | null;
  error: string;
  stopRequested: boolean;
  stressPid: string;
};

const MOUNTS: { mount: string; name: string }[] = [
  { mount: "/mnt/mmc", name: "SD1 (system card)" },
  { mount: "/mnt/sdcard", name: "SD2 (TF2, games)" },
];
const BENCH_DIR = ".muos-bench";
const FILE_NAME = "speed.bin";
const SIZE_MB = 32;
const NEED_FREE = (SIZE_MB + 8) * 1024 * 1024;
const CPU_SECONDS = 20;

const emptyRun = (): Run => ({
  state: "idle",
  tests: [],
  phases: [],
  current: null,
  log: [],
  startedAt: null,
  finishedAt: null,
  error: "",
  stopRequested: false,
  stressPid: "",
});

let run: Run = emptyRun();
let chain: Promise<void> = Promise.resolve();

const publicRun = () => ({
  state: run.state,
  tests: run.tests,
  phases: run.phases,
  current: run.current,
  log: run.log,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  error: run.error,
});

const note = (msg: string, phase?: Phase) => {
  run.log.push(msg);
  if (phase) phase.log.push(msg);
};

const maxTemp = (temps: { c: number }[]) => {
  const vals = temps.map((t) => t.c).filter((c) => Number.isFinite(c) && c > 0);
  return vals.length ? Math.max(...vals) : null;
};

async function runConnect(phase: Phase): Promise<void> {
  phase.state = "running";
  run.current = "connect";
  note("Checking SSH and reading device status…", phase);
  const t0 = Date.now();
  try {
    const status = await sshStatus();
    if (!status.configured) throw new UserError("SSH is not set up. Turn on Secure Shell on the handheld and save the address under SSH.");
    if (!status.reachable) throw new UserError("The handheld is not reachable over SSH. Wake it and check Secure Shell is on.");
    const echo = await runCommand("echo ok", 8_000);
    const latencyMs = Date.now() - t0;
    if (!echo.out.includes("ok")) throw new UserError("The handheld answered over SSH, but a simple echo failed.");
    const stats = await deviceStats();
    phase.connect = {
      ok: true,
      latencyMs,
      host: status.host || "",
      hostname: stats.hostname || "",
      ip: stats.ip || "",
      uptime: stats.uptime || 0,
      load: stats.load || [],
      battery: stats.battery,
      storage: (stats.storage || [])
        .filter((s) => s.mount === "/mnt/mmc" || s.mount === "/mnt/sdcard")
        .map((s) => ({ name: s.name, mount: s.mount, free: s.free, total: s.total })),
    };
    note(`SSH ok in ${latencyMs} ms · ${stats.hostname || status.host}${stats.ip ? ` (${stats.ip})` : ""}`, phase);
    phase.state = "done";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    phase.connect = { ok: false, latencyMs: null, host: "", hostname: "", ip: "", uptime: 0, load: [], battery: null, storage: [], error: message };
    phase.state = "error";
    note(message, phase);
    throw error;
  }
}

async function mountedTargets(): Promise<{ mount: string; name: string; free: number }[]> {
  const stats = await deviceStats();
  const byMount = Object.fromEntries((stats.storage || []).map((s) => [s.mount, s]));
  const out: { mount: string; name: string; free: number }[] = [];
  for (const m of MOUNTS) {
    const s = byMount[m.mount];
    if (!s) continue;
    out.push({ mount: m.mount, name: m.name, free: s.free });
  }
  return out;
}

async function speedOne(mount: string, name: string, free: number, phase: Phase): Promise<StorageMountResult> {
  if (free < NEED_FREE) {
    const skipped = `Not enough free space (need about ${SIZE_MB + 8} MB).`;
    note(`${name}: ${skipped}`, phase);
    return { mount, name, writeMBps: null, readMBps: null, skipped };
  }
  const dir = `${mount}/${BENCH_DIR}`;
  const file = `${dir}/${FILE_NAME}`;
  const script = [
    `mkdir -p '${dir}'`,
    `rm -f '${file}'`,
    `START=$(date +%s%N)`,
    `dd if=/dev/zero of='${file}' bs=1M count=${SIZE_MB} conv=fsync 2>/dev/null || dd if=/dev/zero of='${file}' bs=1M count=${SIZE_MB} 2>/dev/null`,
    `sync`,
    `END=$(date +%s%N)`,
    `echo WRITE:$((END-START))`,
    `START=$(date +%s%N)`,
    `dd if='${file}' of=/dev/null bs=1M 2>/dev/null`,
    `END=$(date +%s%N)`,
    `echo READ:$((END-START))`,
    `rm -f '${file}'`,
    `rmdir '${dir}' 2>/dev/null || true`,
  ].join("; ");
  note(`${name}: writing and reading ${SIZE_MB} MB…`, phase);
  try {
    const { out, err, code } = await runCommand(`sh -c ${JSON.stringify(script)}`, 60_000);
    if (code && code !== 0) throw new UserError(err.trim() || `Storage test failed on ${name} (exit ${code}).`);
    const writeNs = Number(/WRITE:(\d+)/.exec(out)?.[1] || 0);
    const readNs = Number(/READ:(\d+)/.exec(out)?.[1] || 0);
    const mbps = (ns: number) => (ns > 0 ? Math.round((SIZE_MB / (ns / 1e9)) * 10) / 10 : null);
    const writeMBps = mbps(writeNs), readMBps = mbps(readNs);
    note(`${name}: write ${writeMBps ?? "?"} MB/s · read ${readMBps ?? "?"} MB/s`, phase);
    return { mount, name, writeMBps, readMBps };
  } catch (error) {
    await runCommand(`rm -f '${file}'; rmdir '${dir}' 2>/dev/null || true`, 8_000).catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    note(`${name}: ${message}`, phase);
    return { mount, name, writeMBps: null, readMBps: null, error: message };
  }
}

async function runStorage(phase: Phase): Promise<void> {
  phase.state = "running";
  run.current = "storage";
  note("Measuring storage write/read speed…", phase);
  const targets = await mountedTargets();
  if (!targets.length) {
    phase.storage = [];
    phase.state = "error";
    const message = "No SD1 or TF2 mount found to test.";
    note(message, phase);
    throw new UserError(message);
  }
  const results: StorageMountResult[] = [];
  for (const t of targets) {
    if (run.stopRequested) break;
    results.push(await speedOne(t.mount, t.name, t.free, phase));
  }
  phase.storage = results;
  if (run.stopRequested) {
    phase.state = "skipped";
    note("Storage test stopped.", phase);
    return;
  }
  phase.state = results.some((r) => r.error) && !results.some((r) => r.writeMBps != null) ? "error" : "done";
}

async function killStress(): Promise<void> {
  const pid = run.stressPid;
  run.stressPid = "";
  const parts = [
    "pkill -f muos-bench-cpu 2>/dev/null",
    "killall yes 2>/dev/null",
    pid ? `kill -TERM ${pid} 2>/dev/null; kill -KILL ${pid} 2>/dev/null` : "",
    "true",
  ].filter(Boolean);
  await runCommand(parts.join("; "), 8_000).catch(() => {});
}

async function runCpu(phase: Phase): Promise<void> {
  phase.state = "running";
  run.current = "cpu";
  note(`Loading CPUs for up to ${CPU_SECONDS} seconds…`, phase);
  const before = await deviceStats();
  if (before.battery && before.battery.percent > 0 && before.battery.percent < 15) {
    const message = `Battery is at ${before.battery.percent}%. Charge above 15% before a CPU test.`;
    phase.cpu = { durationMs: 0, peakCpu: null, avgCpu: null, peakTemp: null, samples: [], stopped: false, error: message };
    phase.state = "error";
    note(message, phase);
    throw new UserError(message);
  }
  // Background shell owns yes workers; marker string lets Stop pkill the group.
  const start = await runCommand(
    [
      "pkill -f muos-bench-cpu 2>/dev/null; true",
      `( sh -c 'echo muos-bench-cpu >/dev/null; n=$(nproc 2>/dev/null || echo 4); i=0; while [ "$i" -lt "$n" ]; do yes >/dev/null & i=$((i+1)); done; wait' ) >/dev/null 2>&1 & echo $!`,
    ].join("; "),
    8_000,
  );
  const pid = (start.out.trim().match(/\d+/g) || []).pop() || "";
  if (!pid) {
    const message = "Could not start the CPU load on the handheld.";
    phase.cpu = { durationMs: 0, peakCpu: null, avgCpu: null, peakTemp: null, samples: [], stopped: false, error: message };
    phase.state = "error";
    note(message, phase);
    throw new UserError(message);
  }
  run.stressPid = pid;
  const samples: Sample[] = [];
  const t0 = Date.now();
  try {
    while (!run.stopRequested && Date.now() - t0 < CPU_SECONDS * 1000) {
      await new Promise((r) => setTimeout(r, 1000));
      if (run.stopRequested) break;
      try {
        const s = await deviceStats();
        samples.push({
          at: Date.now(),
          cpu: s.cpu,
          mhz: s.mhz,
          governor: s.governor || "",
          temp: maxTemp(s.temps || []),
        });
        const last = samples[samples.length - 1];
        note(`CPU ${last.cpu ?? "?"}% · ${last.mhz || "?"} MHz · ${last.temp != null ? `${last.temp.toFixed(1)} °C` : "no temp"} · ${last.governor || "governor?"}`, phase);
      } catch (error) {
        note(error instanceof Error ? error.message : String(error), phase);
      }
    }
  } finally {
    await killStress();
  }
  const durationMs = Date.now() - t0;
  const cpus = samples.map((s) => s.cpu).filter((n): n is number => n != null);
  const temps = samples.map((s) => s.temp).filter((n): n is number => n != null);
  phase.cpu = {
    durationMs,
    peakCpu: cpus.length ? Math.max(...cpus) : null,
    avgCpu: cpus.length ? Math.round(cpus.reduce((a, b) => a + b, 0) / cpus.length) : null,
    peakTemp: temps.length ? Math.max(...temps) : null,
    samples,
    stopped: run.stopRequested,
  };
  phase.state = "done";
  note(
    run.stopRequested
      ? `CPU test stopped after ${(durationMs / 1000).toFixed(1)} s.`
      : `CPU test finished · peak ${phase.cpu.peakCpu ?? "?"}% · peak ${phase.cpu.peakTemp != null ? `${phase.cpu.peakTemp.toFixed(1)} °C` : "temp n/a"}.`,
    phase,
  );
}

async function execute(tests: BenchTest[]): Promise<void> {
  for (const id of tests) {
    if (run.stopRequested) {
      const phase = run.phases.find((p) => p.id === id);
      if (phase && phase.state === "pending") {
        phase.state = "skipped";
        note(`${id} skipped (stopped).`, phase);
      }
      continue;
    }
    const phase = run.phases.find((p) => p.id === id)!;
    try {
      if (id === "connect") await runConnect(phase);
      else if (id === "storage") await runStorage(phase);
      else if (id === "cpu") await runCpu(phase);
    } catch (error) {
      if (phase.state === "running") phase.state = "error";
      if (!phase.log.length) note(error instanceof Error ? error.message : String(error), phase);
      // Continue the suite for non-connect failures when running multiple tests.
      if (id === "connect" && tests.length > 1) {
        run.error = error instanceof Error ? error.message : String(error);
        for (const rest of tests.slice(tests.indexOf(id) + 1)) {
          const p = run.phases.find((x) => x.id === rest);
          if (p) { p.state = "skipped"; note("Skipped because SSH failed.", p); }
        }
        break;
      }
    }
  }
  run.current = null;
  run.finishedAt = Date.now();
  run.state = run.stopRequested ? "done" : run.phases.some((p) => p.state === "error") && !run.phases.some((p) => p.state === "done") ? "error" : "done";
  if (run.stopRequested) note("Benchmark stopped.");
  else note("Benchmark finished.");
  await killStress();
}

export function benchmarkStatus() {
  return publicRun();
}

export function startBenchmark(body: Record<string, unknown>) {
  if (run.state === "running") throw new UserError("A benchmark is already running. Stop it first.");
  const raw = Array.isArray(body.tests) ? body.tests.map(String) : ["connect", "storage", "cpu"];
  const allowed: BenchTest[] = ["connect", "storage", "cpu"];
  const tests = [...new Set(raw.filter((t): t is BenchTest => (allowed as string[]).includes(t)))];
  if (!tests.length) throw new UserError("Pick at least one test: connect, storage or cpu.");
  run = emptyRun();
  run.state = "running";
  run.tests = tests;
  run.phases = tests.map((id) => ({ id, state: "pending", log: [] }));
  run.startedAt = Date.now();
  run.stopRequested = false;
  note(`Starting: ${tests.join(", ")}.`);
  chain = execute(tests).catch((error) => {
    run.state = "error";
    run.error = error instanceof Error ? error.message : String(error);
    run.finishedAt = Date.now();
    run.current = null;
    note(run.error);
  });
  return publicRun();
}

export async function stopBenchmark() {
  if (run.state !== "running") return publicRun();
  run.stopRequested = true;
  note("Stop requested…");
  await killStress();
  await chain.catch(() => {});
  return publicRun();
}
