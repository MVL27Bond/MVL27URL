import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await copyFile('worker.js', 'dist/_worker.js');
console.log('Cloudflare Pages bundle written to dist/_worker.js');
