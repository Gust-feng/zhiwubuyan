import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Mastra } from '@mastra/core';
import { createStep, createWorkflow, createWorkflowStateReader } from '@mastra/core/workflows';
import { LibSQLStore } from '@mastra/libsql';
import { z } from 'zod';

const phase=process.argv[2];
const dataDir=path.resolve(process.argv[3] ?? 'tmp/research-plan/reproduce/中文 空格');
mkdirSync(dataDir,{recursive:true});
const recordPath=path.join(dataDir,'probe-record.json');
const eventPath=path.join(dataDir,'events.jsonl');
const emit=(event)=>appendFileSync(eventPath,JSON.stringify({phase,event,at:new Date().toISOString()})+'\n');
const payload=z.object({value:z.number()});
let longStepEntered;
const entered=new Promise(resolve=>{longStepEntered=resolve;});
const prepare=createStep({id:'prepare',inputSchema:payload,outputSchema:payload,execute:async({inputData})=>{emit('prepare');return inputData;}});
const gate=createStep({id:'gate',inputSchema:payload,outputSchema:payload,resumeSchema:z.object({approved:z.boolean()}),suspendSchema:z.object({reason:z.string()}),execute:async({inputData,resumeData,suspend})=>{emit('gate');if(!resumeData?.approved)return await suspend({reason:'PLAN_READY'});return inputData;}});
const finish=createStep({id:'finish',inputSchema:payload,outputSchema:payload,execute:async({inputData})=>{emit('finish');return {value:inputData.value+1};}});
const longStep=createStep({id:'long-step',inputSchema:payload,outputSchema:payload,execute:async({inputData,abortSignal,abort})=>{emit('long-step');longStepEntered();await new Promise(resolve=>{const timer=setTimeout(resolve,15000);abortSignal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});if(abortSignal.aborted){emit('aborted');return abort();}return inputData;}});
const failStep=createStep({id:'fail-step',inputSchema:payload,outputSchema:payload,retries:0,execute:async()=>{emit('fail-step');throw new Error('EXPECTED_PROBE_FAILURE');}});
const crashStep=createStep({id:'crash-step',inputSchema:payload,outputSchema:payload,execute:async({inputData})=>{emit('crash-step');if(phase==='crash')process.exit(73);return inputData;}});
const options={autoRestartActiveRuns:false,validateInputs:true,shouldPersistSnapshot:()=>true};
const workflow=createWorkflow({id:'framework-probe',inputSchema:payload,outputSchema:payload,retryConfig:{attempts:0,delay:0},options}).then(prepare).then(gate).then(finish).commit();
const cancellation=createWorkflow({id:'cancel-probe',inputSchema:payload,outputSchema:payload,retryConfig:{attempts:0,delay:0},options}).then(longStep).then(finish).commit();
const failure=createWorkflow({id:'failure-probe',inputSchema:payload,outputSchema:payload,retryConfig:{attempts:0,delay:0},options}).then(failStep).commit();
const recovery=createWorkflow({id:'recovery-probe',inputSchema:payload,outputSchema:payload,retryConfig:{attempts:0,delay:0},options}).then(prepare).then(crashStep).then(finish).commit();
const storage=new LibSQLStore({id:'probe-storage',url:pathToFileURL(path.join(dataDir,'runtime.sqlite')).href});
await storage.init();
const mastra=new Mastra({storage,workflows:{workflow,cancellation,failure,recovery}});
let result;
try {
 if(phase==='suspend'){
  const runId=randomUUID();
  writeFileSync(recordPath,JSON.stringify({runId}));
  const run=await mastra.getWorkflow('workflow').createRun({runId});
  const output=await run.start({inputData:{value:7}});
  assert.equal(output.status,'suspended');
  const state=await workflow.getWorkflowRunById(runId);
  assert.equal(createWorkflowStateReader(state).getStatus(),'suspended');
  result={phase,status:output.status,runId,suspendedStep:createWorkflowStateReader(state).getSuspendedStep()?.path};
 }else if(phase==='resume'){
  const {runId}=JSON.parse(readFileSync(recordPath,'utf8'));
  const state=await workflow.getWorkflowRunById(runId);
  assert.equal(state.status,'suspended');
  const run=await workflow.createRun({runId});
  const output=await run.resume({step:'gate',resumeData:{approved:true}});
  assert.equal(output.status,'success');
  assert.equal(output.result.value,8);
  result={phase,status:output.status,result:output.result};
 }else if(phase==='cancel'){
  const run=await cancellation.createRun();
  const pending=run.start({inputData:{value:2}});
  await entered;
  const returnValue=await run.cancel();
  const output=await pending;
  const state=await cancellation.getWorkflowRunById(run.runId);
  assert.equal(state.status,'canceled');
  result={phase,status:output.status,storedStatus:state.status,cancelReturned:returnValue??null};
 }else if(phase==='failure'){
  const before=readFileSync(eventPath,'utf8').split('\n').filter(x=>x.includes('fail-step')).length;
  const run=await failure.createRun();
  const output=await run.start({inputData:{value:0}});
  assert.equal(output.status,'failed');
  const after=readFileSync(eventPath,'utf8').split('\n').filter(x=>x.includes('fail-step')).length;
  assert.equal(after-before,1);
  result={phase,status:output.status,executions:after-before};
 }else if(phase==='crash'){
  const runId=randomUUID();
  writeFileSync(path.join(dataDir,'crash-record.json'),JSON.stringify({runId}));
  const run=await recovery.createRun({runId});
  await run.start({inputData:{value:10}});
  throw new Error('crash was expected');
 }else if(phase==='inspect-crash'||phase==='restart'){
  const {runId}=JSON.parse(readFileSync(path.join(dataDir,'crash-record.json'),'utf8'));
  const state=await recovery.getWorkflowRunById(runId);
  if(phase==='inspect-crash'){
   result={phase,storedStatus:state.status};
  }else{
   const run=await recovery.createRun({runId});
   const output=await run.restart();
   assert.equal(output.status,'success');
   assert.equal(output.result.value,11);
   result={phase,status:output.status,result:output.result};
  }
 }else throw new Error('unknown phase');
 console.log(JSON.stringify(result));
}finally{await storage.close();}


