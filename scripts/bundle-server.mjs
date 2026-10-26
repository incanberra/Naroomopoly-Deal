import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
await build({
  entryPoints: ['supabase/functions/deal/index.ts'],
  outfile: 'supabase/deploy/deal.ts',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  minify: true,
  external: ['npm:*'],
});
await copyFile('supabase/deploy/deal.ts', 'supabase/deploy/deal.txt');
console.log('Generated the dashboard server bundle from the shared engine.');
