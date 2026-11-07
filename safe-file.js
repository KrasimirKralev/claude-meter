'use strict';
// Saving and loading the app's JSON files so a crash, a full disk or a damaged file can't cost the data.
// A plain write empties the file first, and a failed read used to look like "no data", which the next
// save then wrote over the top.

const fs = require('fs');

// The new content is complete on disk before it takes the old file's place.
function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp-${process.pid}`;
  try { fs.unlinkSync(temp); } catch { /* not there */ }
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
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

module.exports = { readJsonOr, writeJsonAtomic };
