import assert from "node:assert/strict";
import test from "node:test";
import { jobErrorMessage } from "../lib/job-error.ts";

test("explains a missing deployment node", () => {
  assert.match(
    jobErrorMessage("comfyui /prompt 400: Node 'Prepare clip' not found. Node ID '#2'"),
    /missing.*Prepare clip.*install-nodes\.sh.*restart/i,
  );
});

test("explains that SAM found no person in the part's first frame", () => {
  assert.equal(
    jobErrorMessage({ message: "SAM found no subject. Adjust the subject text and inspect the mask preview." }),
    "No person was found in the first frame of the part. Choose a part where the person is in view from its first frame.",
  );
});

test("explains that the person left the frame, with the frames SAM lost them at", () => {
  assert.equal(
    jobErrorMessage("ValueError: SAM lost the selected person at frames [161, 162, 163]. Correct the selection or split "
      + "the source shot before generating."),
    "The person left the frame during the part (frames 161, 162, 163). Choose a part where they stay in view.",
  );
});

test("reads the message out of the error a take keeps on disk as JSON", () => {
  // The proxy's error object as lib/comfy.ts getJob stores it, from a take that stopped on SAM.
  const stored = '{"code":"node_execution_error","message":"SAM found no subject. Adjust the subject text and inspect the mask '
    + 'preview.\\n","node_id":"104a","class_type":"H3CharacterSwapSelectSubject","traceback":null}';
  assert.equal(
    jobErrorMessage(stored),
    "No person was found in the first frame of the part. Choose a part where the person is in view from its first frame.",
  );
  const oom = "Allocation on device 0 would exceed allowed memory. (out of memory)";
  assert.equal(jobErrorMessage(stored.replace(/SAM found[^\\]*/, oom)), oom, "the message, not the JSON around it");
  assert.equal(jobErrorMessage("{not json"), "{not json", "not JSON: the text as it is");
});
