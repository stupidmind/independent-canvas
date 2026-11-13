import {test} from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import {prepareImages} from './image-inputs.mjs';
test('actual image bytes are written for CLI and removed after request',async()=>{const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7sAAAAASUVORK5CYII=','base64'),prepared=await prepareImages([{dataUrl:'data:image/png;base64,'+png.toString('base64')}]);assert.equal(prepared.paths.length,1);assert.deepEqual(await readFile(prepared.paths[0]),png);await prepared.cleanup();await assert.rejects(access(prepared.paths[0]));});
test('image inputs reject external URLs, disguised contents and excessive count',async()=>{await assert.rejects(prepareImages([{dataUrl:'https://example.com/a.png'}]));await assert.rejects(prepareImages([{dataUrl:'data:image/png;base64,YmFk'}]));await assert.rejects(prepareImages(Array(9).fill({})));});
