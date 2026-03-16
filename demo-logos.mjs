#!/usr/bin/env node
/**
 * demo-logos.mjs  ·  LOGOS single-file Playwright demo runner
 * ============================================================
 *
 * Produces ONE continuous ~240 s silent WebM recording in ./demo-output/
 * that can be muxed later with a TTS voiceover via ffmpeg.
 *
 * Recording contract:
 *   • ONE browser context  → ONE video file (Playwright records per-page)
 *   • ONE page for the full run — never closed or replaced mid-demo
 *   • Sessions are reset INSIDE the app (End → Start) not via browser reload
 *   • context.close() is called exactly once at the very end
 *
 * Segment map (approximate wall-clock timestamps):
 *   T=  0 –  30  Intro      : welcome screen, feature cards, load Aesop passage
 *                              difficulty set to BEGINNER
 *   T= 30 –  85  Session 1  : parse_greek   — "Parse ἀλώπηξ for me."
 *                              open Inspector to show tool call events
 *   T= 85 – 107  Reset 1    : End session, badge transitions to INTERMEDIATE
 *   T=107 – 163  Session 2  : lookup_lexicon — upload image, "Look up κόραξ"
 *                              Inspector stays open
 *   T=163 – 185  Reset 2    : End session, badge transitions to ADVANCED
 *   T=185 – 230  Session 3  : scan_meter    — Iliad hexameter
 *                              ScansionCard visible in transcript
 *   T=230 – 245  Close      : End session, final disconnected beat
 *
 * Run:
 *   node demo-logos.mjs
 *
 * Env overrides:
 *   LOGOS_URL           default: http://127.0.0.1:3000
 *   LOGOS_IMAGE_PATH    default: ./image.jpg (fallback when Aesop JPEG missing)
 *   LOGOS_HEADLESS      default: false
 *   LOGOS_VIDEO_DIR     default: ./demo-output
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL   = process.env.LOGOS_URL       || "http://127.0.0.1:3000";
const VIDEO_DIR  = path.resolve(process.env.LOGOS_VIDEO_DIR  || "./demo-output");
const HEADLESS   = /^(1|true)$/i.test(process.env.LOGOS_HEADLESS || "false");

const IMAGE_PATH = (() => {
  const explicit = process.env.LOGOS_IMAGE_PATH;
  if (explicit) return explicit;
  const mnt = "/mnt/data/aesop-fox-and-crow-ancient_greek-1.jpg";
  return fs.existsSync(mnt) ? mnt : path.resolve(__dirname, "image.jpg");
})();

if (!fs.existsSync(IMAGE_PATH)) {
  console.error(`✗ Image not found: ${IMAGE_PATH}`);
  console.error("  Set LOGOS_IMAGE_PATH=/path/to/image.jpg and retry.");
  process.exit(1);
}

fs.mkdirSync(VIDEO_DIR, { recursive: true });

// ── Pacing constants (ms) — tune here if runtime drifts ──────────────────────
//
// Estimated total ≈ 238 s  (target: 230–250 s)
//   Explicit softWait budget  : ~207 s
//   textEventually polls      : ~22 s  (3 prompts × ~7 s each)
//   Clicks / fills / page load: ~9 s
//                               ─────
//                               ~238 s

const PACE = {
  pageSettle:        5_000,  //  5 s — after goto + networkidle
  welcomeDwell:      20_000, // 20 s — read welcome screen / feature cards
  afterPassagePin:   5_000,  //  5 s — after passage is pinned
  afterLive:         5_000,  //  5 s — after "Live" status appears  (× 3 = 15 s)
  typeBeforeSend:    2_000,  //  2 s — pause after typing, before send  (× 3 = 6 s)
  afterParseCard:    20_000, // 20 s — read ParseCard
  afterInspector:    14_000, // 14 s — read Inspector tool events
  afterImageSent:    4_000,  //  4 s — image thumbnail appears in transcript
  afterImageResponse:6_000,  //  6 s — read Logos' image description
  afterLexiconCard:  18_000, // 18 s — read LexiconCard
  afterScanCard:     24_000, // 24 s — read ScansionCard (more content)
  resetPause:        17_000, // 17 s — disconnected state between sessions (× 3 = 51 s)
  finalBeat:         15_000, // 15 s — closing disconnected screen
};

// ── Selector banks (first visible / existing match wins) ──────────────────────

const SEL = {
  // TopBar center span: "Not connected" | "Connecting…" | "Live" | "Session ended" | "Error"
  status: [
    (p) => p.locator("header span").filter({ hasText: /Not connected|Connecting|Live|Session ended|Error/ }).first(),
    (p) => p.locator("header").first(),
  ],

  // "Start session" — ComposerBar when connectionState is idle / ended / error
  startSession: [
    (p) => p.getByRole("button", { name: "Start session" }),
    (p) => p.locator('button:has-text("Start session")'),
  ],

  // "End" — ComposerBar when connectionState is live
  endSession: [
    (p) => p.getByRole("button", { name: "End" }),
    (p) => p.locator('button:has-text("End"):not(:has-text("session"))'),
  ],

  // Inspector toggle — aria-label="Toggle inspector" in TopBar
  inspector: [
    (p) => p.locator('[aria-label="Toggle inspector"]'),
    (p) => p.getByRole("button", { name: /inspector/i }),
  ],

  // Scrollable transcript container
  transcript: [
    (p) => p.locator("main"),
    (p) => p.locator("body"),
  ],

  // Composer textarea
  composer: [
    (p) => p.locator("textarea").first(),
    (p) => p.locator('[contenteditable="true"]').first(),
  ],

  // Send button (title="Send", visible when live + text non-empty)
  send: [
    (p) => p.locator('button[title="Send"]'),
    (p) => p.getByRole("button", { name: /^send$/i }),
  ],

  // Hidden image file input added to page.tsx
  fileInput: [
    (p) => p.locator('[data-testid="image-upload-input"]'),
    (p) => p.locator('input[type="file"]').first(),
  ],

  // WelcomeView: "Load a passage for close reading (optional)"
  addPassage: [
    (p) => p.getByRole("button", { name: /load a passage/i }),
    (p) => p.locator('button:has-text("Load a passage")'),
  ],

  // WelcomeView: passage textarea
  passageInput: [
    (p) => p.locator('textarea[placeholder*="Paste Greek text"]'),
    (p) => p.locator("textarea").nth(1),
  ],

  // WelcomeView: "Pin passage"
  savePassage: [
    (p) => p.locator('button:has-text("Pin passage")'),
    (p) => p.getByRole("button", { name: /pin passage/i }),
  ],

  // ParseCard: identified by its "Meaning:" label
  parseCard: [
    (p) => p.locator('p:has-text("Meaning:")').first(),
    (p) => p.locator('span:has-text("Meaning:")').first(),
  ],

  // Image thumbnail after sendImage
  imageMessage: [
    (p) => p.locator('img[alt="Sent image"]').first(),
    (p) => p.locator("img").first(),
  ],

  // LexiconCard: identified by its ordered definitions list
  lexiconCard: [
    (p) => p.locator("ol.list-decimal").first(),
  ],

  // ScansionCard: identified by the pattern line rendered with inspector-mono class
  scansionCard: [
    (p) => p.locator(".inspector-mono").filter({ hasText: /[—∪]/ }).first(),
  ],
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function logStep(label) {
  console.log(`\n▶  ${label}`);
}

async function softWait(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function firstVisible(page, candidates, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const make of candidates) {
      try {
        const loc = make(page).first();
        if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) return loc;
      } catch {}
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`firstVisible: no match after ${timeout} ms`);
}

async function firstExisting(page, candidates, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const make of candidates) {
      try {
        const loc = make(page).first();
        if ((await loc.count()) > 0) return loc;
      } catch {}
    }
    await page.waitForTimeout(150);
  }
  throw new Error("firstExisting: no match");
}

async function maybeClick(page, candidates, timeout = 3_000) {
  try {
    const loc = await firstVisible(page, candidates, timeout);
    await loc.click();
    return true;
  } catch {
    return false;
  }
}

async function fillSmart(locator, value) {
  const tag = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
  if (tag === "textarea" || tag === "input") {
    await locator.fill(value);
  } else if (await locator.evaluate((el) => el.isContentEditable).catch(() => false)) {
    await locator.click();
    await locator.evaluate((el) => { el.textContent = ""; });
    await locator.type(value);
  } else {
    await locator.fill(value);
  }
}

/**
 * Poll until the innerText of a matching locator satisfies regex.
 * Returns the match object or null on timeout (never throws).
 */
async function textEventually(page, candidates, regex, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const make of candidates) {
      try {
        const loc = make(page).first();
        if ((await loc.count()) > 0) {
          const text = await loc.innerText().catch(() => "");
          if (regex.test(text)) return { locator: loc, text };
        }
      } catch {}
    }
    await page.waitForTimeout(250);
  }
  console.warn(`  [warn] textEventually timed out: ${regex}`);
  return null;
}

/**
 * Type a prompt into the composer and send it.
 * Waits for expectedRegex to appear anywhere in the main transcript area.
 */
async function sendPrompt(page, prompt, expectedRegex = null, timeout = 28_000) {
  console.log(`     → "${prompt.slice(0, 72)}"`);
  const composer = await firstVisible(page, SEL.composer);
  await fillSmart(composer, prompt);
  await softWait(PACE.typeBeforeSend);

  const sent = await maybeClick(page, SEL.send, 2_000);
  if (!sent) await composer.press("Enter");

  if (expectedRegex) {
    await textEventually(page, SEL.transcript, expectedRegex, timeout);
  }
}

/**
 * Inject an image via the hidden <input type="file"> in page.tsx.
 */
async function uploadImage(page, filePath) {
  console.log(`     → upload: ${path.basename(filePath)}`);
  const input = await firstExisting(page, SEL.fileInput, 5_000);
  await input.setInputFiles(filePath);
  console.log("       injected via data-testid=image-upload-input");
}

/**
 * Clear the pinned passage (X button in PinnedPassageCard).
 * No-op if the card is not present.
 */
async function clearPassage(page) {
  try {
    await page.locator('button[title="Clear passage"]').dispatchEvent("click");
    console.log("     → passage cleared");
  } catch {
    // passage not pinned — fine
  }
}

/**
 * Set difficulty level by dispatching a click event on the hidden button.
 * dispatchEvent bypasses Playwright's viewport/scroll checks that fail for
 * elements positioned at left:-9999px.
 */
async function setDifficulty(page, level) {
  await page.locator(`[data-testid="set-difficulty-${level}"]`).dispatchEvent("click");
  console.log(`     → difficulty set to ${level}`);
}

/**
 * Start a session and wait until status shows "Live".
 */
async function startSession(page) {
  const btn = await firstVisible(page, SEL.startSession, 10_000);
  await btn.click();
  await textEventually(page, SEL.status, /live/i, 15_000);
  console.log("       session is live");
  await softWait(PACE.afterLive);
}

/**
 * End the current session and wait for "Session ended" status.
 * Uses dispatchEvent to bypass viewport/overlay checks (same as setDifficulty).
 */
async function endSession(page) {
  // Primary: dispatchEvent on the testid button (bypasses Inspector overlay)
  try {
    await page.locator('[data-testid="end-session-btn"]').dispatchEvent("click");
  } catch {
    // Fallback: normal click on any "End" button
    await maybeClick(page, SEL.endSession, 8_000);
  }
  const result = await textEventually(page, SEL.status, /session ended|not connected/i, 12_000);
  if (!result) {
    // One retry — in case the first dispatchEvent landed while Gemini was streaming
    try { await page.locator('[data-testid="end-session-btn"]').dispatchEvent("click"); } catch {}
    const r2 = await textEventually(page, SEL.status, /session ended|not connected/i, 8_000);
    if (!r2) throw new Error("endSession: session did not end within timeout");
  }
  console.log("       session ended");
}

/** Save debug screenshot + HTML on failure. */
async function saveDebugArtifacts(page, reason = "failure") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try { await page.screenshot({ path: path.join(VIDEO_DIR, `${reason}-${stamp}.png`), fullPage: true }); } catch {}
  try { fs.writeFileSync(path.join(VIDEO_DIR, `${reason}-${stamp}.html`), await page.content(), "utf8"); } catch {}
  console.log(`  Artifacts → ${VIDEO_DIR}`);
}

/** Find all .webm files in a directory. */
function getWebmFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith(".webm"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** Ask ffprobe for the duration of a video file. Returns seconds or null. */
async function getVideoDuration(filePath) {
  return new Promise((resolve) => {
    execFile("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      filePath,
    ], (err, stdout) => {
      if (err) { resolve(null); return; }
      try { resolve(parseFloat(JSON.parse(stdout).format.duration)); }
      catch { resolve(null); }
    });
  });
}

// ── Session 1 passage — Pindar Pythian 8.95–96 ───────────────────────────────
// Pinned for close reading; ἄνθρωπος appears in the text, linking to the parse.

const PINDAR_PASSAGE = `ἐπάμεροι· τί δέ τις; τί δ' οὔ τις; σκιᾶς ὄναρ ἄνθρωπος.
ἀλλ' ὅταν αἴγλα διόσδοτος ἔλθῃ, λαμπρὸν φέγγος ἔπεστιν ἀνδρῶν
καὶ μείλιχος αἰών.
— Pindar, Pythian 8.95–97`;

// ── Main demo ─────────────────────────────────────────────────────────────────

async function run() {
  // Snapshot pre-existing video files so we can identify the new one later
  const beforeFiles = new Set(getWebmFiles(VIDEO_DIR));

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  // ONE context  →  ONE video file
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ["camera", "microphone"],
    recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
  });

  // ONE page  →  used for the entire 240 s run
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("  [browser]", msg.text().slice(0, 120));
  });

  const demoStart = Date.now();

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // SEGMENT 0 · INTRO   T≈0 – T≈30 s
    // Welcome screen, feature cards, passage pre-load, difficulty → BEGINNER
    // ══════════════════════════════════════════════════════════════════════════

    logStep("INTRO — welcome screen");
    await page.goto(`${BASE_URL}?demo=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await softWait(PACE.pageSettle);

    // Set difficulty to BEGINNER for Session 1 (WelcomeView visible here)
    // The welcome view has explicit Beginner / Intermediate / Advanced buttons
    const beginnerBtn = page.getByRole("button", { name: "Beginner" });
    if (await beginnerBtn.count() > 0) {
      await beginnerBtn.click();
      console.log("     → difficulty set to beginner (WelcomeView)");
    } else {
      await setDifficulty(page, "beginner");
    }

    // Dwell on welcome screen — voiceover: "This is Logos…"
    await softWait(PACE.welcomeDwell);

    // Pre-load the Aesop passage for contextual close reading
    const passagePanelOpened = await maybeClick(page, SEL.addPassage, 4_000);
    if (passagePanelOpened) {
      const passageInput = await firstVisible(page, SEL.passageInput, 5_000).catch(() => null);
      if (passageInput) {
        await fillSmart(passageInput, PINDAR_PASSAGE);
        await softWait(800);
        await maybeClick(page, SEL.savePassage, 3_000);
        console.log("     → Aesop passage pinned");
      }
    }
    await softWait(PACE.afterPassagePin);

    // ══════════════════════════════════════════════════════════════════════════
    // SEGMENT 1 · parse_greek   T≈30 – T≈85 s
    // Beginner difficulty — "Parse ἀλώπηξ for me."
    // ══════════════════════════════════════════════════════════════════════════

    logStep("SESSION 1 — parse_greek  [BEGINNER]");
    await startSession(page);

    await sendPrompt(
      page,
      "Parse ἄνθρωπος for me.",
      /ἄνθρωπος|human|nominative|masculine|noun|Meaning:|parse|analysis|Logos/i,
      30_000,
    );
    // ParseCard renders "Meaning:" — hard assert: tool must have been called
    const parseCard = await textEventually(page, SEL.parseCard, /Meaning:/i, 20_000);
    if (!parseCard) throw new Error("ParseCard did not appear — parse_greek tool not called");
    await softWait(PACE.afterParseCard);

    // Open Inspector — shows parse_greek tool.call + tool.result events
    logStep("  → open Inspector");
    await maybeClick(page, SEL.inspector, 5_000);
    await softWait(PACE.afterInspector);

    // ══════════════════════════════════════════════════════════════════════════
    // RESET 1   T≈85 – T≈107 s
    // End session · difficulty badge transitions BEGINNER → INTERMEDIATE
    // ══════════════════════════════════════════════════════════════════════════

    logStep("RESET 1 — ending session");
    await endSession(page);
    await clearPassage(page);

    // Show disconnected state for a few seconds, then change the difficulty
    await softWait(8_000);
    await setDifficulty(page, "intermediate");
    // Remaining reset pause (badge visible at Intermediate)
    await softWait(PACE.resetPause - 8_000);

    // ══════════════════════════════════════════════════════════════════════════
    // SEGMENT 2 · lookup_lexicon   T≈107 – T≈163 s
    // Intermediate difficulty — upload image, then "Look up κόραξ"
    // ══════════════════════════════════════════════════════════════════════════

    logStep("SESSION 2 — lookup_lexicon  [INTERMEDIATE]");
    await startSession(page);

    // Upload the Aesop image — Logos will describe what it sees
    await uploadImage(page, IMAGE_PATH);
    await textEventually(page, SEL.imageMessage, /./, 10_000).catch(() => {});
    await softWait(PACE.afterImageSent);

    // Wait for Logos' image description, then ask for lexicon lookup
    await textEventually(page, SEL.transcript, /image|manuscript|greek|text|see/i, 18_000);
    await softWait(PACE.afterImageResponse);

    await sendPrompt(
      page,
      "Look up κόραξ in the lexicon.",
      /κόραξ|crow|lexicon|definition|raven|noun|Logos/i,
      30_000,
    );
    // LexiconCard renders ol.list-decimal — hard assert: lookup_lexicon must fire
    const lexiconCard = await textEventually(page, SEL.lexiconCard, /./, 20_000);
    if (!lexiconCard) throw new Error("LexiconCard did not appear — lookup_lexicon tool not called");
    await softWait(PACE.afterLexiconCard);

    // ══════════════════════════════════════════════════════════════════════════
    // RESET 2   T≈163 – T≈185 s
    // End session · difficulty badge transitions INTERMEDIATE → ADVANCED
    // ══════════════════════════════════════════════════════════════════════════

    logStep("RESET 2 — ending session");
    await endSession(page);

    await softWait(8_000);
    await setDifficulty(page, "advanced");
    await softWait(PACE.resetPause - 8_000);

    // ══════════════════════════════════════════════════════════════════════════
    // SEGMENT 3 · scan_meter   T≈185 – T≈230 s
    // Advanced difficulty — scan the Iliad opening hexameter
    // ══════════════════════════════════════════════════════════════════════════

    logStep("SESSION 3 — scan_meter  [ADVANCED]");
    await startSession(page);

    await sendPrompt(
      page,
      "Scan the meter of this Homeric hexameter: μῆνιν ἄειδε θεά Πηληϊάδεω Ἀχιλῆος",
      /Dactylic|hexameter|spondee|dactyl|meter|pattern|Logos/i,
      30_000,
    );
    // ScansionCard renders — ∪ pattern — hard assert: scan_meter must have been called
    const scansionCard = await textEventually(page, SEL.scansionCard, /[—∪]/, 20_000);
    if (!scansionCard) throw new Error("ScansionCard did not appear — scan_meter tool not called");
    await softWait(PACE.afterScanCard);

    // ══════════════════════════════════════════════════════════════════════════
    // RESET 3 + CLOSING   T≈230 – T≈245 s
    // End final session · hold on disconnected screen
    // ══════════════════════════════════════════════════════════════════════════

    logStep("CLOSE — final beat");
    await endSession(page);
    await softWait(PACE.finalBeat);

    const elapsed = ((Date.now() - demoStart) / 1000).toFixed(1);
    console.log(`\n✓  Demo sequence finished  (wall time: ${elapsed} s)`);

  } catch (err) {
    console.error("\n✗  Demo failed:");
    console.error(err);
    await saveDebugArtifacts(page, "demo-failed");
    process.exitCode = 1;
  } finally {
    // Close context ONCE → Playwright finalises the video file
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  // ── Post-run: locate the new video file ───────────────────────────────────

  const afterFiles = getWebmFiles(VIDEO_DIR);
  const newFiles   = afterFiles.filter((f) => !beforeFiles.has(f));

  console.log("");
  if (newFiles.length === 0) {
    console.error("✗  No video file was produced — check Playwright recordVideo config.");
  } else if (newFiles.length > 1) {
    console.error(`✗  ${newFiles.length} video files were produced (expected exactly 1):`);
    newFiles.forEach((f) => console.error(`   ${f}`));
    console.error("   Only one page should exist per run — check the recording lifecycle.");
  } else {
    const videoPath = newFiles[0];
    console.log(`✓  Video:    ${videoPath}`);

    // Print duration if ffprobe is available
    const dur = await getVideoDuration(videoPath);
    if (dur !== null) {
      console.log(`✓  Duration: ${dur.toFixed(1)} s`);
    } else {
      console.log("   (install ffprobe to print duration)");
    }

    // ── ffmpeg mux hint ───────────────────────────────────────────────────────
    console.log(`
── How to add a voiceover ──────────────────────────────────────────────────────
1.  Generate voiceover.wav  (see vertex_tts_voiceover.py)
2.  Convert + mux:

    ffmpeg -i "${videoPath}" \\
           -i voiceover.wav \\
           -c:v copy -c:a aac -shortest \\
           demo-output/final-demo-with-voiceover.mp4

────────────────────────────────────────────────────────────────────────────────`);
  }
}

run();
