#!/usr/bin/env node
/**
 * tests/e2e/demo.mjs  ·  LOGOS end-to-end Playwright demo runner
 * ================================================================
 *
 * Drives a live browser through the full feature set and records a single
 * continuous ~240 s WebM video in tests/e2e/output/.
 *
 * Three sessions are exercised end-to-end:
 *   Session 1 (Beginner)      — parse_greek   → ParseCard
 *   Session 2 (Intermediate)  — image upload + lookup_lexicon → LexiconCard
 *   Session 3 (Advanced)      — scan_meter    → ScansionCard
 *
 * The app must be running before you start this script.
 *
 * Usage:
 *   # from repo root
 *   npm run test:e2e
 *
 *   # or directly
 *   node tests/e2e/demo.mjs
 *
 * Env overrides:
 *   LOGOS_URL           default: http://127.0.0.1:3000
 *   LOGOS_IMAGE_PATH    default: tests/e2e/fixtures/aesop-fox-and-crow-ancient_greek-1.jpg
 *   LOGOS_HEADLESS      default: false  (set to "true" for CI)
 *   LOGOS_VIDEO_DIR     default: tests/e2e/output
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL  = process.env.LOGOS_URL      || "http://127.0.0.1:3000";
const VIDEO_DIR = path.resolve(process.env.LOGOS_VIDEO_DIR || path.join(__dirname, "output"));
const HEADLESS  = /^(1|true)$/i.test(process.env.LOGOS_HEADLESS || "false");

const IMAGE_PATH = (() => {
  if (process.env.LOGOS_IMAGE_PATH) return process.env.LOGOS_IMAGE_PATH;
  const mnt     = "/mnt/data/aesop-fox-and-crow-ancient_greek-1.jpg";
  const fixture = path.join(__dirname, "fixtures", "aesop-fox-and-crow-ancient_greek-1.jpg");
  if (fs.existsSync(mnt))     return mnt;
  if (fs.existsSync(fixture)) return fixture;
  // Legacy fallback — image.jpg beside the script
  return path.join(__dirname, "image.jpg");
})();

if (!fs.existsSync(IMAGE_PATH)) {
  console.error(`✗ Image not found: ${IMAGE_PATH}`);
  console.error("  Put the Aesop JPEG in tests/e2e/fixtures/ or set LOGOS_IMAGE_PATH.");
  process.exit(1);
}

fs.mkdirSync(VIDEO_DIR, { recursive: true });

// ── Pacing constants (ms) ─────────────────────────────────────────────────────

const PACE = {
  pageSettle:         5_000,
  welcomeDwell:      20_000,
  afterPassagePin:    5_000,
  afterLive:          5_000,
  typeBeforeSend:     2_000,
  afterParseCard:    20_000,
  afterInspector:    14_000,
  afterImageSent:     4_000,
  afterImageResponse: 6_000,
  afterLexiconCard:  18_000,
  afterScanCard:     24_000,
  resetPause:        17_000,
  finalBeat:         15_000,
};

// ── Selector banks ────────────────────────────────────────────────────────────

const SEL = {
  status: [
    (p) => p.locator("header span").filter({ hasText: /Not connected|Connecting|Live|Session ended|Error/ }).first(),
    (p) => p.locator("header").first(),
  ],
  startSession: [
    (p) => p.getByRole("button", { name: "Start session" }),
    (p) => p.locator('button:has-text("Start session")'),
  ],
  endSession: [
    (p) => p.getByRole("button", { name: "End" }),
    (p) => p.locator('button:has-text("End"):not(:has-text("session"))'),
  ],
  inspector: [
    (p) => p.locator('[aria-label="Toggle inspector"]'),
    (p) => p.getByRole("button", { name: /inspector/i }),
  ],
  transcript: [
    (p) => p.locator("main"),
    (p) => p.locator("body"),
  ],
  composer: [
    (p) => p.locator("textarea").first(),
    (p) => p.locator('[contenteditable="true"]').first(),
  ],
  send: [
    (p) => p.locator('button[title="Send"]'),
    (p) => p.getByRole("button", { name: /^send$/i }),
  ],
  fileInput: [
    (p) => p.locator('[data-testid="image-upload-input"]'),
    (p) => p.locator('input[type="file"]').first(),
  ],
  addPassage: [
    (p) => p.getByRole("button", { name: /load a passage/i }),
    (p) => p.locator('button:has-text("Load a passage")'),
  ],
  passageInput: [
    (p) => p.locator('textarea[placeholder*="Paste Greek text"]'),
    (p) => p.locator("textarea").nth(1),
  ],
  savePassage: [
    (p) => p.locator('button:has-text("Pin passage")'),
    (p) => p.getByRole("button", { name: /pin passage/i }),
  ],
  parseCard: [
    (p) => p.locator('p:has-text("Meaning:")').first(),
    (p) => p.locator('span:has-text("Meaning:")').first(),
  ],
  imageMessage: [
    (p) => p.locator('img[alt="Sent image"]').first(),
    (p) => p.locator("img").first(),
  ],
  lexiconCard: [
    (p) => p.locator("ol.list-decimal").first(),
  ],
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

async function uploadImage(page, filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  console.log(`     → upload: ${path.basename(filePath)}`);

  const imgBuf  = fs.readFileSync(filePath);
  const imgSize = imgBuf.length;
  const isJpeg  = imgBuf[0] === 0xFF && imgBuf[1] === 0xD8 && imgBuf[2] === 0xFF;
  const isPng   = imgBuf[0] === 0x89 && imgBuf[1] === 0x50;
  const firstHex = imgBuf.slice(0, 8).toString("hex").toUpperCase().replace(/../g, "$& ").trim();
  console.log(`       size:        ${imgSize} bytes`);
  console.log(`       first bytes: ${firstHex}`);
  console.log(`       format:      ${isJpeg ? "JPEG ✓" : isPng ? "PNG ✓" : "UNKNOWN"}`);

  const diagPath = path.join(VIDEO_DIR, `diag-upload-${stamp}${isJpeg ? ".jpg" : ".png"}`);
  fs.copyFileSync(filePath, diagPath);

  const beforePath = path.join(VIDEO_DIR, `diag-before-upload-${stamp}.png`);
  await page.screenshot({ path: beforePath, fullPage: false });

  const input = await firstExisting(page, SEL.fileInput, 5_000);
  await input.setInputFiles(filePath);
  console.log("       injected via data-testid=image-upload-input");

  await page.waitForTimeout(500);
  const afterPath = path.join(VIDEO_DIR, `diag-after-upload-${stamp}.png`);
  await page.screenshot({ path: afterPath, fullPage: false });

  const thumbVisible = await page.locator('img[alt="Sent image"]').first().isVisible().catch(() => false);
  console.log(`       image thumbnail: ${thumbVisible ? "✓ visible" : "✗ not visible yet"}`);
}

async function clearPassage(page) {
  try {
    await page.locator('button[title="Clear passage"]').dispatchEvent("click");
    console.log("     → passage cleared");
  } catch {}
}

async function setDifficulty(page, level) {
  await page.locator(`[data-testid="set-difficulty-${level}"]`).dispatchEvent("click");
  console.log(`     → difficulty: ${level}`);
}

async function startSession(page) {
  const btn = await firstVisible(page, SEL.startSession, 10_000);
  await btn.click();
  await textEventually(page, SEL.status, /live/i, 15_000);
  console.log("       session is live");
  await softWait(PACE.afterLive);
}

async function endSession(page) {
  try {
    await page.locator('[data-testid="end-session-btn"]').dispatchEvent("click");
  } catch {
    await maybeClick(page, SEL.endSession, 8_000);
  }
  const result = await textEventually(page, SEL.status, /session ended|not connected/i, 12_000);
  if (!result) {
    try { await page.locator('[data-testid="end-session-btn"]').dispatchEvent("click"); } catch {}
    const r2 = await textEventually(page, SEL.status, /session ended|not connected/i, 8_000);
    if (!r2) throw new Error("endSession: timed out");
  }
  console.log("       session ended");
}

async function saveDebugArtifacts(page, reason = "failure") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try { await page.screenshot({ path: path.join(VIDEO_DIR, `${reason}-${stamp}.png`), fullPage: true }); } catch {}
  try { fs.writeFileSync(path.join(VIDEO_DIR, `${reason}-${stamp}.html`), await page.content(), "utf8"); } catch {}
  console.log(`  Artifacts → ${VIDEO_DIR}`);
}

function getWebmFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".webm")).map((f) => path.join(dir, f));
  } catch { return []; }
}

async function getVideoDuration(filePath) {
  return new Promise((resolve) => {
    execFile("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", filePath],
      (err, stdout) => {
        if (err) { resolve(null); return; }
        try { resolve(parseFloat(JSON.parse(stdout).format.duration)); }
        catch { resolve(null); }
      });
  });
}

// ── Pindar passage — pinned for contextual close reading in Session 1 ─────────

const PINDAR_PASSAGE = `ἐπάμεροι· τί δέ τις; τί δ' οὔ τις; σκιᾶς ὄναρ ἄνθρωπος.
ἀλλ' ὅταν αἴγλα διόσδοτος ἔλθῃ, λαμπρὸν φέγγος ἔπεστιν ἀνδρῶν
καὶ μείλιχος αἰών.
— Pindar, Pythian 8.95–97`;

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const beforeFiles = new Set(getWebmFiles(VIDEO_DIR));

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const context = await browser.newContext({
    viewport:     { width: 1440, height: 900 },
    permissions:  ["camera", "microphone"],
    recordVideo:  { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
  });

  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("  [browser]", msg.text().slice(0, 120));
  });

  const demoStart = Date.now();

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // SEGMENT 0 · INTRO   T≈0 – T≈30 s
    // ══════════════════════════════════════════════════════════════════════════

    logStep("INTRO — welcome screen");
    await page.goto(`${BASE_URL}?demo=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await softWait(PACE.pageSettle);

    const beginnerBtn = page.getByRole("button", { name: "Beginner" });
    if (await beginnerBtn.count() > 0) {
      await beginnerBtn.click();
      console.log("     → difficulty: beginner (WelcomeView)");
    } else {
      await setDifficulty(page, "beginner");
    }

    await softWait(PACE.welcomeDwell);

    const passagePanelOpened = await maybeClick(page, SEL.addPassage, 4_000);
    if (passagePanelOpened) {
      const passageInput = await firstVisible(page, SEL.passageInput, 5_000).catch(() => null);
      if (passageInput) {
        await fillSmart(passageInput, PINDAR_PASSAGE);
        await softWait(800);
        await maybeClick(page, SEL.savePassage, 3_000);
        console.log("     → Pindar passage pinned");
      }
    }
    await softWait(PACE.afterPassagePin);

    // ══════════════════════════════════════════════════════════════════════════
    // SEGMENT 1 · parse_greek   T≈30 – T≈85 s
    // ══════════════════════════════════════════════════════════════════════════

    logStep("SESSION 1 — parse_greek  [BEGINNER]");
    await startSession(page);

    await sendPrompt(
      page,
      "Parse ἄνθρωπος for me.",
      /ἄνθρωπος|human|nominative|masculine|noun|Meaning:|parse|analysis|Logos/i,
      30_000,
    );
    const parseCard = await textEventually(page, SEL.parseCard, /Meaning:/i, 20_000);
    if (!parseCard) throw new Error("ParseCard not shown — parse_greek tool not called");
    await softWait(PACE.afterParseCard);

    logStep("  → open Inspector");
    await maybeClick(page, SEL.inspector, 5_000);
    await softWait(PACE.afterInspector);

    // ══════════════════════════════════════════════════════════════════════════
    // RESET 1   T≈85 – T≈107 s
    // ══════════════════════════════════════════════════════════════════════════

    logStep("RESET 1");
    await endSession(page);
    await clearPassage(page);
    await softWait(8_000);
    await setDifficulty(page, "intermediate");
    await softWait(PACE.resetPause - 8_000);

    // ══════════════════════════════════════════════════════════════════════════
    // SEGMENT 2 · lookup_lexicon   T≈107 – T≈163 s
    // Aesop image uploaded — Logos describes the manuscript, then lexicon lookup
    // ══════════════════════════════════════════════════════════════════════════

    logStep("SESSION 2 — lookup_lexicon  [INTERMEDIATE]");
    await startSession(page);

    await uploadImage(page, IMAGE_PATH);
    await textEventually(page, SEL.imageMessage, /./, 10_000).catch(() => {});
    await softWait(PACE.afterImageSent);

    await textEventually(page, SEL.transcript, /image|manuscript|greek|text|see/i, 18_000);
    await softWait(PACE.afterImageResponse);

    await sendPrompt(
      page,
      "Look up κόραξ in the lexicon.",
      /κόραξ|crow|lexicon|definition|raven|noun|Logos/i,
      30_000,
    );
    const lexiconCard = await textEventually(page, SEL.lexiconCard, /./, 20_000);
    if (!lexiconCard) throw new Error("LexiconCard not shown — lookup_lexicon tool not called");
    await softWait(PACE.afterLexiconCard);

    // ══════════════════════════════════════════════════════════════════════════
    // RESET 2   T≈163 – T≈185 s
    // ══════════════════════════════════════════════════════════════════════════

    logStep("RESET 2");
    await endSession(page);
    await softWait(8_000);
    await setDifficulty(page, "advanced");
    await softWait(PACE.resetPause - 8_000);

    // ══════════════════════════════════════════════════════════════════════════
    // SEGMENT 3 · scan_meter   T≈185 – T≈230 s
    // ══════════════════════════════════════════════════════════════════════════

    logStep("SESSION 3 — scan_meter  [ADVANCED]");
    await startSession(page);

    await sendPrompt(
      page,
      "Scan the meter of this Homeric hexameter: μῆνιν ἄειδε θεά Πηληϊάδεω Ἀχιλῆος",
      /Dactylic|hexameter|spondee|dactyl|meter|pattern|Logos/i,
      30_000,
    );
    const scansionCard = await textEventually(page, SEL.scansionCard, /[—∪]/, 20_000);
    if (!scansionCard) throw new Error("ScansionCard not shown — scan_meter tool not called");
    await softWait(PACE.afterScanCard);

    // ══════════════════════════════════════════════════════════════════════════
    // CLOSE   T≈230 – T≈245 s
    // ══════════════════════════════════════════════════════════════════════════

    logStep("CLOSE");
    await endSession(page);
    await softWait(PACE.finalBeat);

    const elapsed = ((Date.now() - demoStart) / 1000).toFixed(1);
    console.log(`\n✓  Demo finished  (${elapsed} s)`);

  } catch (err) {
    console.error("\n✗  Demo failed:", err);
    await saveDebugArtifacts(page, "demo-failed");
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  // ── Post-run: find the new video file ─────────────────────────────────────

  const afterFiles = getWebmFiles(VIDEO_DIR);
  const newFiles   = afterFiles.filter((f) => !beforeFiles.has(f));

  console.log("");
  if (newFiles.length === 0) {
    console.error("✗  No video produced.");
  } else {
    const videoPath = newFiles[0];
    console.log(`✓  Video: ${videoPath}`);
    const dur = await getVideoDuration(videoPath);
    if (dur !== null) console.log(`✓  Duration: ${dur.toFixed(1)} s`);

    console.log(`
── Add a voiceover (optional) ──────────────────────────────────────────────────
1. Generate voiceover.wav  (see vertex_tts_voiceover.py)
2. Mux:

   ffmpeg -i "${videoPath}" \\
          -i voiceover.wav \\
          -c:v copy -c:a aac -shortest \\
          tests/e2e/output/final-demo.mp4
────────────────────────────────────────────────────────────────────────────────`);
  }
}

run();
