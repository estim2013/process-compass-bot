import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, mkdir, rm, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

async function unusedPort(){
  const probe=createServer();
  await new Promise((resolve,reject)=>probe.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  const port=probe.address().port;
  await new Promise((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
  return port;
}

test('debug diagnostics require the quality admin token and omit prompt-bearing fields', {timeout:30000}, async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'process-compass-auth-'));
  const port=await unusedPort(), token=`test-${randomUUID()}`;
  const stateDir=path.join(temp,'state'), dbPath=path.join(temp,'mvp.sqlite');
  await mkdir(stateDir,{recursive:true});
  await copyFile(path.join(root,'data/mvp.sqlite'),dbPath);
  const child=spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,stdio:['ignore','ignore','pipe'],env:{...process.env,PORT:String(port),HOST:'127.0.0.1',QUALITY_ADMIN_TOKEN:token,STATE_DIR:stateDir,DB_PATH:dbPath}});
  let stderr='';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>stderr+=chunk);
  t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}await rm(temp,{recursive:true,force:true});});

  const base=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<80;i++){
    if(child.exitCode!==null)throw new Error(`server exited during startup: ${stderr}`);
    try{const response=await fetch(`${base}/api/health`,{signal:AbortSignal.timeout(500)});if(response.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(ready,true,`server did not become ready: ${stderr}`);
  const body=JSON.stringify({question:'Какая сегодня погода в Таллине?',debug:true});
  const unauth=await fetch(`${base}/api/ask`,{method:'POST',headers:{'content-type':'application/json'},body});
  const publicResult=await unauth.json();
  assert.equal(publicResult.diagnostics,undefined);

  const invalidAuth=await fetch(`${base}/api/ask`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer definitely-wrong'},body});
  const invalidResult=await invalidAuth.json();
  assert.equal(invalidResult.diagnostics,undefined);

  const auth=await fetch(`${base}/api/ask`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body});
  const adminResult=await auth.json();
  assert.equal(typeof adminResult.diagnostics?.latency?.totalMs,'number');
  assert.equal(adminResult.diagnostics.refusalReason,'OUT_OF_SCOPE');
  assert.equal('question' in adminResult.diagnostics,false);
  assert.equal('answer' in adminResult.diagnostics,false);
  assert.equal(adminResult.diagnostics.latency.modelCalls.every(call=>!('error' in call)&&!('retryReason' in call)),true);

  const privateOff=await fetch(`${base}/api/ask`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({question:'Какая сегодня погода в Таллине?',debug:false})});
  const privateOffResult=await privateOff.json();
  assert.equal(privateOffResult.diagnostics,undefined);

  const logText=await readFile(path.join(stateDir,'logs.jsonl'),'utf8');
  assert.equal(logText.includes('Какая сегодня погода в Таллине?'),false);
  const events=logText.trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(events.every(event=>Array.isArray(event.pipelineFailures)),true);
  assert.equal(events.every(event=>!('question' in event)&&!('answer' in event)),true);
});
