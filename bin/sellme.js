#!/usr/bin/env node
import { main } from "../lib/cli.js";

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (err) => {
    console.error(err.userFacing ? `✗ ${err.message}` : err.stack);
    process.exitCode = 1;
  },
);
