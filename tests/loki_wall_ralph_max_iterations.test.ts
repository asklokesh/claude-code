import { test, expect } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";

// This test lives at the repository root, so the repository root is import.meta.dir.
// The ralph-loop plugin is located by searching the repository for its setup script
// rather than by assuming a fixed path; the hook is resolved relative to that plugin.
const REPO_ROOT = import.meta.dir;
const SKIP_DIRS = new Set([".git", ".loki", "node_modules"]);

function findFile(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(p, name);
      if (hit) return hit;
    } else if (entry.name === name) {
      return p;
    }
  }
  return null;
}

const SETUP = findFile(REPO_ROOT, "setup-ralph-loop.sh");
if (SETUP === null) {
  throw new Error(`ralph-loop setup script not found in repository at ${REPO_ROOT}`);
}
const PLUGIN = dirname(dirname(SETUP)); // <plugin>/scripts/setup-ralph-loop.sh
const HOOK = join(PLUGIN, "hooks", "stop-hook.sh");
const STATE = ".claude/ralph-loop.local.md";

function childEnv(): Record<string, string> {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v;
  delete e.CLAUDE_CODE_SESSION_ID;
  return e;
}

function setup(maxArg: string) {
  const cwd = mkdtempSync(join(tmpdir(), "ralph-wall-"));
  const r = Bun.spawnSync(["bash", SETUP, "do", "the", "task", "--max-iterations", maxArg], {
    cwd,
    env: childEnv(),
  });
  return { cwd, code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

function hookRound(cwd: string) {
  const transcript = join(cwd, "t.jsonl");
  writeFileSync(
    transcript,
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"still working"}]}}\n',
  );
  const input = JSON.stringify({ session_id: "s1", transcript_path: transcript });
  Bun.spawnSync(["bash", HOOK], {
    cwd,
    env: childEnv(),
    stdin: new TextEncoder().encode(input),
  });
}

// Returns the round on which the state file was removed, or null if still present after maxRounds.
function roundLoopStops(cwd: string, maxRounds: number): number | null {
  for (let round = 1; round <= maxRounds; round++) {
    hookRound(cwd);
    if (!existsSync(join(cwd, STATE))) return round;
  }
  return null;
}

test("--max-iterations 08 stops the loop at round 8", () => {
  const { cwd, code } = setup("08");
  expect(code).toBe(0);
  expect(roundLoopStops(cwd, 12)).toBe(8);
});

test("--max-iterations 09 stops the loop at round 9", () => {
  const { cwd, code } = setup("09");
  expect(code).toBe(0);
  expect(roundLoopStops(cwd, 12)).toBe(9);
});

test("--max-iterations 010 stops the loop at round 10 (not 8)", () => {
  const { cwd, code } = setup("010");
  expect(code).toBe(0);
  expect(roundLoopStops(cwd, 12)).toBe(10);
});

test("--max-iterations 8 control still stops the loop at round 8", () => {
  const { cwd, code } = setup("8");
  expect(code).toBe(0);
  expect(roundLoopStops(cwd, 12)).toBe(8);
});

test("--max-iterations 08 is stored as the decimal cap 8, not unlimited", () => {
  const { cwd, code, out } = setup("08");
  expect(code).toBe(0);
  expect(out).not.toContain("unlimited");
  const state = readFileSync(join(cwd, STATE), "utf8");
  expect(state).toMatch(/^max_iterations:\s*"?0*8"?\s*$/m);
});

test("overflowing --max-iterations 9223372036854775808 is rejected with exit 1 and no state file", () => {
  const { cwd, code } = setup("9223372036854775808");
  expect(code).toBe(1);
  expect(existsSync(join(cwd, STATE))).toBe(false);
});

test("non-numeric --max-iterations is still rejected with exit 1 and no state file", () => {
  const { cwd, code } = setup("abc");
  expect(code).toBe(1);
  expect(existsSync(join(cwd, STATE))).toBe(false);
});
