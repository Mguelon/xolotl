import assert from "node:assert/strict";
import test from "node:test";
import { stageFromLog, type LogEntry } from "../lib/stage.ts";
import { FINISH, remainingSeconds, TIMING } from "../lib/estimates.ts";

const log = (...lines: string[]): LogEntry[] => lines.map((m, i) => ({ t: `2026-11-02T04:${String(i).padStart(2, "0")}:00`, m }));
const previous = ["\r 4/4 [03:09<00:00, 47.70s/it]", "\u001b[32m[INFO]\u001b[0m Prompt executed in 307.67 seconds\n"];

test("reads the running take's stage, step and window from ComfyUI's log", () => {
  const start = [...previous, "H3 video prepared width=512 height=928 frames=120 window=124", "\r100%|██████████| 124/124 [00:22<00:00,  5.61it/s]"];
  assert.deepEqual(stageFromLog(log(...start), 20, 1, 40), {
    name: "prepare", step: null, steps: 20, window: 1, windows: 1, secondsPerStep: null, windowLeft: null,
  }, "the tracking bar counts frames per second: not the sampler");
  const encoding = [...start, "\u001b[32m[INFO]\u001b[0m H3_STAGE_HANDOFF Start reference VAE encoding; release prior-job models",
    "\r  0%|          | 0/20 [00:00<?, ?it/s,   Model Initializing ...  ]"];
  assert.equal(stageFromLog(log(...encoding), 20, 1, 90).name, "encode");
  const sampling = stageFromLog(log(...encoding, "\r 45%|████▌     | 9/20 [06:18<07:41, 41.99s/it]"), 20, 1, 500);
  assert.deepEqual(sampling, { name: "sample", step: 9, steps: 20, window: 1, windows: 1, secondsPerStep: 41.99, windowLeft: 461 });
  assert.equal(stageFromLog(log(...encoding, "\r 20/20 [14:00<00:00, 42.00s/it]"), 20, 1, 900).name, "finish");
  assert.equal(stageFromLog(log(...encoding, "\r 9/20 [1:02:03<0:10:00, 41.99s/it]"), 20, 1, 900).windowLeft, 600, "hours in the clock");
});

test("follows the windows, and tells a take just started from one just finished", () => {
  const handoff = "H3_STAGE_HANDOFF Start reference VAE encoding";
  const two = [...previous, handoff, "\r 4/4 [02:40<00:00, 40.0s/it]", "\r 4/4 [02:40<00:00, 40.1s/it]"];
  assert.deepEqual([stageFromLog(log(...two), 4, 2, 400).name, stageFromLog(log(...two), 4, 2, 400).window], ["encode", 1], "between windows");
  const second = stageFromLog(log(...two, handoff, "\r 2/4 [01:30<01:30, 45.0s/it]"), 4, 2, 600);
  assert.deepEqual([second.name, second.step, second.window, second.windows], ["sample", 2, 2, 2]);
  assert.equal(stageFromLog(log(...previous), 4, 1, 5).name, "prepare", "nothing logged yet: it has only just started");
  assert.equal(stageFromLog(log(...previous), 4, 1, 300).name, "finish", "its own Prompt executed is the last line");
  assert.equal(stageFromLog([], 4, 1, 5).name, "prepare");
});

test("counts the seconds left from ComfyUI's step time and the measured timings", () => {
  const stage = { name: "sample" as const, step: 9, steps: 20, window: 1, windows: 1, secondsPerStep: 41.99, windowLeft: 461 };
  assert.equal(remainingSeconds("480p", 5, stage, 500), 461 + FINISH["480p"]);
  const t = TIMING["480p"]!;
  const first = { ...stage, steps: 4, step: 2, windows: 2, secondsPerStep: 40, windowLeft: 80 };
  assert.equal(remainingSeconds("480p", 10, first, 300), 80 + t.laterFixed! + 4 * 40 * t.history + FINISH["480p"], "a later window ahead");
  const between = { ...first, name: "encode" as const, step: 4, windowLeft: 0 };
  assert.equal(remainingSeconds("480p", 10, between, 400), t.laterFixed! + 4 * 40 * t.history + FINISH["480p"]);
  const before = { name: "prepare" as const, step: null, steps: 4, window: 1, windows: 1, secondsPerStep: null, windowLeft: null };
  const perStep = (t.perStep[0] + t.perStep[1]) / 2;
  assert.equal(remainingSeconds("480p", 5, before, 0), t.trackingPerSecond * 5 + t.firstFixed + 4 * perStep, "the measured total");
  assert.equal(remainingSeconds("480p", 5, before, 10_000), 4 * perStep + FINISH["480p"], "late: never less than the sampling ahead");
  assert.equal(remainingSeconds("480p", 5, { ...before, name: "finish" }, 900), null, "the finish: no count");
  const tall = { ...first, windows: 2 };
  const t768 = TIMING["768p"]!;
  assert.equal(remainingSeconds("768p", 10, tall, 300), 80 + t768.firstFixed + 4 * 40 * t768.history + FINISH["768p"], "768p windows: the first window's fixed part stands in");
});
