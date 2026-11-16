'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {ImageStore}=require('./image-store.cjs'),{readBatch}=require('./flow-records.cjs');
const directory=path.join(__dirname,'.image-store-test');fs.mkdirSync(directory,{recursive:true});
const temporary=path.join(directory,'temporary.png'),store=new ImageStore(path.join(directory,'archive'));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
try{
 fs.writeFileSync(temporary,png);const call={type:'response_item',payload:{type:'custom_tool_call',name:'functions.exec',call_id:'one',input:'const r=await tools.view_image({path:'+JSON.stringify(temporary)+'}); image(r.image_url);'}};
 store.capture('session',call,__dirname);fs.unlinkSync(temporary);const cached=store.get('session',temporary,'one');assert(cached);assert.deepEqual(fs.readFileSync(cached.full),png,'Imagem deve sobreviver a remocao do original');
 const restarted=new ImageStore(path.join(directory,'archive'));assert(restarted.get('session',temporary,'one'),'Cache deve sobreviver ao reinicio');assert.equal(restarted.get('other-session',temporary,'one'),null);
 store.capture('session',{...call,payload:{...call.payload,call_id:'two'}},__dirname);store.capture('session',{type:'response_item',payload:{type:'custom_tool_call_output',call_id:'two',output:[{image_url:'data:image/png;base64,'+png.toString('base64')}]}},__dirname);assert(store.get('session',temporary,'two'),'Imagem embutida deve recuperar original ja removido');
 const log=path.join(directory,'fixture.jsonl');fs.writeFileSync(log,JSON.stringify({...call,payload:{...call.payload,call_id:'three'}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'custom_tool_call_output',call_id:'three',output:[{image_url:'data:image/png;base64,'+png.toString('base64')}]}})+'\n');
 const records=readBatch(log,{offset:0,pending:Buffer.alloc(0),onRecord:r=>store.capture('session',r,__dirname)});assert(store.get('session',temporary,'three'));assert.equal(records[1].payload.output[0].image_url,'','Navegador nao deve receber base64');
 assert.equal(store.save('session','invalid.png','bad',Buffer.from('not an image')),null);assert.equal(store.get('session',temporary,'missing-call'),null);
 console.log('PASS: arquivo apagado, reinicio, base64 arquivado antes da compactacao, isolamento por sessao/chamada e formato validado.');
}finally{const target=path.resolve(directory);assert.equal(target,path.resolve(__dirname,'.image-store-test'));fs.rmSync(target,{recursive:true,force:true})}
