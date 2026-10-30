#!/usr/bin/env node

// The build copies native addons into dist. Writing over an addon a running server has loaded crashes that server
// (SIGBUS on Linux), so move each one aside first: the server keeps using the old file and the build writes a new one.
const { readdirSync, renameSync, rmSync } = require('fs')
const { join } = require('path')

let files = []
try {
  files = readdirSync('dist')
} catch {}
for (let file of files) {
  if (file.endsWith('.node.old')) rmSync(join('dist', file), { force: true })
}
for (let file of files) {
  if (!file.endsWith('.node')) continue
  try {
    renameSync(join('dist', file), join('dist', `${file}.old`))
  } catch (e) {
    console.warn('Unable to move aside', file, String(e))
  }
}
