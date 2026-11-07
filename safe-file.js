'use strict';
// Saving and loading the app's JSON files so a crash, a full disk or a damaged file can't cost the data.
// A plain write empties the file first, and a failed read used to look like "no data", which the next
// save then wrote over the top.

const fs = require('fs');

// The new content is complete on disk before it takes the old file's place.
function writeTextAtomic(file, text) {
  const temp = `${file}.tmp`;
  try {
    fs.writeFileSync(temp, text, { mode: 0o600 });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* it never got that far */ }
    throw error;
  }
}

function writeJsonAtomic(file, value) {
  writeTextAtomic(file, JSON.stringify(value, null, 2));
}

// The value in the file, or the fallback when there isn't one. A damaged file is moved aside, not lost:
// the next save would otherwise overwrite whatever could still be rescued from it.
function readJsonOr(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`[files] could not read ${file}: ${error.message}`);
    return fallback;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const aside = `${file}.bad-${Date.now()}`;
    console.error(`[files] ${file} is damaged (${error.message}), keeping it as ${aside}`);
    try { fs.renameSync(file, aside); } catch (moveError) {
      console.error(`[files] could not move it aside: ${moveError.message}`);
    }
    return fallback;
  }
}

module.exports = { readJsonOr, writeJsonAtomic, writeTextAtomic };
