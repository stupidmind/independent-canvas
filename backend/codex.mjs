import {runCodex} from './codex-runner.mjs';
import {runCodexStream} from './codex-stream.mjs';
export async function completeCodex(input){if(process.env.CODEX_TRANSPORT==='exec')return runCodex(input);try{return await runCodexStream(input);}catch(error){if(error.fallbackAllowed&&!input.signal?.aborted){input.onEvent?.({type:'transport_fallback',reason:error.reason||'protocol-unavailable'});return runCodex(input);}throw error;}}
