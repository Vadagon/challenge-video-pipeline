#!/usr/bin/env node
/**
 * build.js — Injects source JS files into the n8n workflow template
 * Run: node build.js
 * Output: workflow.json (ready to import into n8n)
 */

const fs = require("fs");
const path = require("path");

const TEMPLATE = path.join(__dirname, "workflow_template.json");
const SRC_DIR = path.join(__dirname, "src");
const OUTPUT = path.join(__dirname, "workflow.json");

// Map placeholder → source file
const CODE_FILES = {
  "%%CODE_01%%": "01_session_manager.js",
  "%%CODE_02%%": "02_transcribe_audio.js",
  "%%CODE_03%%": "03_generate_aroll.js",
  "%%CODE_04%%": "04_analyze_broll.js",
  "%%CODE_05%%": "05_compose_video.js",
  "%%CODE_06%%": "06_send_result.js",
  "%%CODE_07%%": "07_error_handler.js",
};

// Read template
let template = fs.readFileSync(TEMPLATE, "utf8");

// Inject each code file
for (const [placeholder, filename] of Object.entries(CODE_FILES)) {
  const filePath = path.join(SRC_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Missing source file: ${filePath}`);
    process.exit(1);
  }
  const code = fs.readFileSync(filePath, "utf8");
  // Escape for JSON string embedding
  const escaped = code
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");

  template = template.replace(`"${placeholder}"`, `"${escaped}"`);
}

// Validate JSON
let parsed;
try {
  parsed = JSON.parse(template);
} catch (e) {
  console.error("❌ Generated JSON is invalid:", e.message);
  fs.writeFileSync(OUTPUT + ".broken", template);
  console.error("   Broken output saved to workflow.json.broken for debugging");
  process.exit(1);
}

fs.writeFileSync(OUTPUT, JSON.stringify(parsed, null, 2));
console.log(`✅ workflow.json generated successfully!`);
console.log(`\nNext steps:`);
console.log(`  1. Open your n8n instance`);
console.log(`  2. Go to Workflows → Import from File`);
console.log(`  3. Select workflow.json`);
console.log(`  4. Add a "Telegram API" credential with your bot token`);
console.log(`  5. Assign it to the "Telegram Trigger" node`);
console.log(`  6. Activate the workflow — n8n handles the webhook automatically`);
