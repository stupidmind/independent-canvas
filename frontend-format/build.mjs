import {build} from 'esbuild';import {fileURLToPath} from 'node:url';
await build({entryPoints:[fileURLToPath(new URL('./entry.js',import.meta.url))],outfile:fileURLToPath(new URL('../public/rich-format.js',import.meta.url)),bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true,legalComments:'linked',loader:{'.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl'}});
