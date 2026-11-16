'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {readBatch,compact}=require('./flow-records.cjs');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),script=/<script>([\s\S]*?)<\/script>/.exec(html)[1];
new vm.Script(script);
// Contratos da leitura incremental: UTF8, ultima linha parcial, append e limite de previa.
const fixture=path.join(__dirname,'.reader-test.jsonl');
try {
 fs.writeFileSync(fixture,JSON.stringify({text:'ação 🧠'})+'\n'+JSON.stringify({text:'segunda'}));
 const state={offset:0,pending:Buffer.alloc(0)},rows=[];while(state.offset<fs.statSync(fixture).size)rows.push(...readBatch(fixture,state,7));
 assert.equal(rows.length,1);assert.equal(rows[0].text,'ação 🧠');fs.appendFileSync(fixture,'\n');rows.push(...readBatch(fixture,state,7));assert.equal(rows[1].text,'segunda');
 assert(compact('x'.repeat(1000000)).length<33000);assert.equal(compact('data:image/png;base64,AAAA'),'');
} finally {fs.unlinkSync(fixture)}
// DOM minimo para testar ciclo real render/pan/fold sem depender do navegador instalado.
const elements=new Map();
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.style={setProperty(k,v){this[k]=v}};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x)};this.value='';this.clientWidth=1200;this.clientHeight=800;this.attrs={};this.listeners={};}
 set textContent(v){this.text=String(v);this.children.forEach(e=>e.parent=null);this.children=[]}get textContent(){return this.text||''}
 set innerHTML(v){this.textContent=v}get innerHTML(){return this.textContent}
 set id(v){this._id=v;elements.set(v,this)}get id(){return this._id}
 appendChild(e){if(e.parent)e.remove();this.children.push(e);e.parent=e.parentNode=this;return e}prepend(e){this.children.unshift(e);e.parent=e.parentNode=this}
 remove(){if(this.parent){const i=this.parent.children.indexOf(this);if(i>=0)this.parent.children.splice(i,1)}this.parent=null;this.parentNode=null}
 get isConnected(){return !!this.parent}get firstChild(){return this.children[0]}get lastChild(){return this.children[this.children.length-1]}
 setAttribute(k,v){this.attrs[k]=String(v)}addEventListener(name,fn){this.listeners[name]=fn}removeEventListener(name){delete this.listeners[name]}focus(){this.focused=true;document.activeElement=this}
 insertBefore(e,before){if(e.parent)e.remove();const i=this.children.indexOf(before);if(i<0)return this.appendChild(e);this.children.splice(i,0,e);e.parent=e.parentNode=this;return e}
 querySelector(q){if(q==='defs')return defs;if(q==='.lb b')return this.children.find(e=>e.className==='lb').children[0];return null}
 getBoundingClientRect(){return {left:0,top:0,right:1200,bottom:800}}
}
const defs=new Element('defs'),svg=new Element('svg');svg.appendChild(defs);
for(const id of html.matchAll(/id="([^"]+)"/g)){let e=new Element('div');e.id=id[1];}
['gridBase','gridHover','cursorOrbit','forceField','wg','edgeGlyphs'].forEach(id=>svg.appendChild(elements.get(id)));elements.get('wg').ownerSVGElement=svg;elements.get('follow').checked=false;
const document={hidden:false,activeElement:null,getElementById:id=>elements.get(id)||null,createElement:t=>new Element(t),createElementNS:(_,t)=>new Element(t)};
const context={document,console,performance,Map,Set,Math,Date,Number,JSON,encodeURIComponent,getComputedStyle:e=>({opacity:e.style.opacity||'.16'}),setInterval(){},requestAnimationFrame(){},addEventListener(){},removeEventListener(){},fetch:async()=>({ok:true,json:async()=>[]}),EventSource:class {addEventListener(){}close(){}}};
vm.createContext(context);vm.runInContext(script,context);
for(let i=0;i<120;i++){const root=context.add('user','Pedido '+i,'',new Date().toISOString());root.turnComplete=true;for(let j=0;j<22;j++)context.add(j%3?'tool':'think','Teste','',new Date().toISOString(),{sat:'ok'});}
const renderAt=performance.now();context.render();const renderMs=performance.now()-renderAt;
assert(context.steps.length===2760);assert(context.steps.filter(s=>s.el).length<100,'Historico oculto nao deve criar DOM');
context.historyView.folded=false;context.sc=1;context.tx=0;context.ty=0;context.drawGraph();const mounted=context.steps.filter(s=>s.el).length;
assert(mounted<300,'Viewport deve limitar DOM');
const oldPath=elements.get('wg').firstChild;context.drawGraph();assert.equal(elements.get('wg').firstChild,oldPath,'SVG deve reutilizar paths');
context.physics.heat=0;context.sc=2;context.updateZoomLabels();context.drawGraph();assert.equal(context.physics.heat,0,'Zoom e foco nao devem reiniciar fisica');
const beforeNav=context.steps.map(s=>[s.cx,s.cy]);context.physics.navigationUntil=2000;context.physics.heat=1;context.dirty=false;context.animateGraph(1000);assert(context.steps.some((s,i)=>s.cx!==beforeNav[i][0]||s.cy!==beforeNav[i][1]),'Movimento organico deve continuar durante navegacao');context.physics.navigationUntil=0;context.sc=1;
const minor=context.steps.find(s=>s.kind==='tool'&&s.parent&&s.parent.kind==='tool');context.sc=2;assert.equal(context.nodeSize(minor),28,'Tamanho do zoom deve existir no modelo');context.sc=1;assert.equal(context.nodeSize(minor),12);
const orbitRoot={kind:'user',areaRadius:300,turn:4},orbitNode={kind:'web',size:32,treeRoot:orbitRoot};context.physics.degree=new Map();context.physics.edges=[];
const orbitBase=context.orbitOutset(orbitNode);context.physics.degree.set(orbitNode,9);const orbitConnected=context.orbitOutset(orbitNode);orbitRoot.areaRadius=1000;const orbitLargeProject=context.orbitOutset(orbitNode);
assert(orbitConnected>orbitBase,'Orbita deve crescer com mais conexoes');assert(orbitLargeProject>orbitConnected,'Orbita deve crescer com o tamanho do projeto');assert(context.orbitOutset({kind:'user',size:84,areaRadius:300})>orbitBase,'Pedido mais importante deve ter orbita mais ampla');
const forceRoot={kind:'user',turn:888,areaRadius:300},forceAnchor={kind:'think',treeRoot:forceRoot,cx:0,cy:0,id:1},forceNode={kind:'tool',treeRoot:forceRoot,cx:20,cy:0,id:2};
context.physics.center=35;context.physics.degree=new Map([[forceAnchor,0],[forceNode,0]]);
const forceProfiles=[1,2,3].map(level=>context.attractionProfile(forceAnchor,forceNode,level));
assert.deepEqual(forceProfiles.map(p=>p.level),[1,2,3],'Deve haver tres niveis de atracao');
assert(forceProfiles[0].radius<forceProfiles[1].radius&&forceProfiles[1].radius<forceProfiles[2].radius,'Importancia deve ocupar aneis mais externos');
assert(forceProfiles[0].strength<forceProfiles[1].strength&&forceProfiles[1].strength<forceProfiles[2].strength,'Cada nivel deve ter forca crescente');
const baseProfile=forceProfiles[0];forceRoot.areaRadius=900;
assert(context.attractionProfile(forceAnchor,forceNode,1).radius>baseProfile.radius,'Projeto maior deve aumentar o raio de equilibrio');
forceRoot.areaRadius=300;context.physics.degree.set(forceAnchor,9);
assert(context.attractionProfile(forceAnchor,forceNode,1).radius>baseProfile.radius,'Mais conexoes devem aumentar o raio do campo');
assert.equal(context.attractionProfile(forceAnchor,forceAnchor,1),null,'No ancora nao deve atrair a si mesmo');
assert.equal(context.attractionProfile(forceAnchor,{treeRoot:{kind:'user',turn:889}},1),null,'Pedidos diferentes nao devem compartilhar o campo');
const insideForce=context.attractionVector(forceAnchor,{cx:baseProfile.radius/2,cy:0},baseProfile);
const outsideForce=context.attractionVector(forceAnchor,{cx:baseProfile.radius*1.5,cy:0},baseProfile);
assert(insideForce.x>0&&outsideForce.x<0,'Forca deve conduzir ao raio de equilibrio sem colapsar no centro');
const physical=environment(script),physicalRoot={kind:'user',turn:889,cx:-900,cy:0,size:84,areaRadius:300},physicalAnchor={kind:'think',treeRoot:physicalRoot,cx:0,cy:0,id:11,size:32},physicalNode={kind:'tool',treeRoot:physicalRoot,cx:350,cy:0,id:12,size:32};
physical.nodeLevel=()=>1;physical.steps=[physicalRoot,physicalAnchor,physicalNode];physical.selected=physicalAnchor;physical.physics.heat=1;physical.physics.overview=false;physical.physics.areaRoots=[];physical.physics.degree=new Map([[physicalAnchor,0],[physicalNode,0]]);
physical.physicsStep();assert(physicalNode.cx<350,'physicsStep deve aplicar o campo radial aos nos do pedido selecionado');
context.sc=.3;context.physics.spacing=.8;const forceAtZoomOut=context.attractionVector(forceAnchor,{cx:baseProfile.radius*1.5,cy:0},baseProfile);
context.sc=2.2;context.physics.spacing=1.4;const forceAtZoomIn=context.attractionVector(forceAnchor,{cx:baseProfile.radius*1.5,cy:0},baseProfile);
assert.deepEqual(forceAtZoomIn,forceAtZoomOut,'Zoom e espacamento visual nao devem alterar a nova forca');
const secondAnchor={kind:'think',treeRoot:forceRoot,cx:70,cy:40,id:3},secondProfile=context.attractionProfile(secondAnchor,forceNode,1);
assert.notDeepEqual(context.attractionVector(secondAnchor,forceNode,secondProfile),context.attractionVector(forceAnchor,forceNode,baseProfile),'Trocar a ancora deve recalcular a direcao da forca');
context.sc=1;context.physics.spacing=1;
const tones=[0,1,2,3].map(context.importanceTone),grayLevels=tones.map(t=>parseInt(t.slice(1,3),16));
assert(tones.every(t=>/^#[0-9a-f]{6}$/i.test(t)&&t.slice(1,3)===t.slice(3,5)&&t.slice(3,5)===t.slice(5,7)),'Paleta de importancia deve permanecer em tons de cinza');
assert(grayLevels.every((v,i)=>i===0||v>grayLevels[i-1]),'Importancia maior deve ter tom progressivamente mais claro');
const cvGridRules=html.match(/#cv\{[^}]*\}/g)||[],dotPattern=/<pattern\b[^>]*id="dotGlyphPattern"[\s\S]*?<text\b[^>]*>\.<\/text>[\s\S]*?<\/pattern>/.exec(html);
assert(dotPattern,'Fundo deve ser formado pelo caractere ponto literal, nao por pontos circulares CSS');
assert(html.includes('id="gridBase"')&&html.includes('id="gridHover"')&&html.includes('id="gridHoverMask"'),'Grade tipografica deve estar no SVG do mundo com camada de hover');
assert(html.includes('id="gridHoverShape"')&&!html.includes('id="gridHoverSpot"'),'Regiao que revela os pontos nao deve ser um circulo exato');
assert(/<filter id="gridHoverSoftEdge"[\s\S]*?<feGaussianBlur id="gridHoverBlur"/.test(html)&&/<path id="gridHoverShape"[^>]*filter="url\(#gridHoverSoftEdge\)"/.test(html),'Contorno geoide deve ter uma transicao ampla e suavizada');
assert(typeof context.geoidePoint==='function'&&typeof context.geoidePath==='function','Mascara do cursor deve usar um contorno geoide calculado');
const geoideCenter={x:0,y:0},geoideCircle=context.geoidePoint(0,0,145,0,0,0),geoideSlow=context.geoidePoint(0,0,145,0,120,0),geoideFast=context.geoidePoint(0,0,145,0,900,0),slowGeoideMotion=context.geoideMotion(120),fastGeoideMotion=context.geoideMotion(900);
assert(Math.abs(Math.hypot(geoideCircle.x,geoideCircle.y)-145)>1,'Mascara em repouso deve ter irregularidade organica, nao raio constante');
assert(Math.abs(geoideFast.x-geoideCenter.x)>Math.abs(geoideSlow.x-geoideCenter.x),'Mover mais rapido deve aumentar a variacao horizontal');
assert(fastGeoideMotion.horizontal>slowGeoideMotion.horizontal&&fastGeoideMotion.lobes>slowGeoideMotion.lobes,'Velocidade deve aumentar amplitude horizontal e frequencia da irregularidade');
const geoideArt=context.geoidePath(40,60,145,900,1.4);
assert(geoideArt.startsWith('M')&&geoideArt.endsWith('Z')&&(geoideArt.match(/Q/g)||[]).length>=32,'Contorno do geoide deve ser fechado e suavizado');
assert(!cvGridRules.some(rule=>rule.includes('radial-gradient'))&&!/#world::before\{[^}]*radial-gradient/.test(html),'Fundo nao deve ser simulado por gradiente de bolinhas');
assert(html.includes('grid-coarse')&&html.includes('grid-medium')&&html.includes('grid-fine'),'Grade deve preservar tres densidades por zoom');
assert(/#world \.n\{[^}]*border-radius:50%[^}]*clip-path:none/i.test(html),'Nos devem manter contorno circular sem clipagem poligonal');
assert(!/clip-path:\s*polygon/i.test(html),'A arte nao deve transformar os contornos circulares em poligonos');
assert(/#world \.n\.sel::before\{[^}]*border-radius:50%[^}]*animation:orbit-spin 14s steps\(48,end\) infinite/i.test(html),'No selecionado deve recuperar a orbita circular pontilhada girando em passos');
assert(/prefers-reduced-motion:reduce\)\{[^}]*#world \.n\.sel::before/.test(html),'Orbita selecionada deve parar quando o usuario reduz movimento');
assert(!html.includes('shape-rendering:crispEdges'),'Glifos e linhas nao devem forcar bordas serrilhadas');
assert(/#world \.grid-glyph\{[^}]*shape-rendering:geometricPrecision/.test(html)&&/#world \.w\{[^}]*shape-rendering:geometricPrecision/.test(html),'Grade e conexoes devem pedir rasterizacao suavizada');
assert(/#world \.force-ring\{[^}]*stroke-dasharray:[^;]+;[^}]*animation:force-orbit-flow/.test(html),'Todos os aneis de forca devem ter movimento de traco');
assert(/@keyframes force-orbit-flow\{[^}]*stroke-dashoffset/.test(html),'Traco orbital deve percorrer os aneis');
const levelOpacities=[1,2,3].map(level=>{const rule=new RegExp('#world \\.force-level-'+level+'\\{opacity:([0-9.]+)').exec(html);return rule?Number(rule[1]):NaN});
assert(levelOpacities.every(Number.isFinite)&&levelOpacities[0]>levelOpacities[1]&&levelOpacities[1]>levelOpacities[2],'Aneis devem escurecer progressivamente com a distancia ao centro');
assert(/prefers-reduced-motion:reduce\)\{[^}]*\.force-ring/.test(html),'Animacao de todos os aneis deve respeitar prefers-reduced-motion');
assert(html.includes('function ensureActivityOrbit('),'Acao ativa deve criar o indicador de pontos fixos');
assert(/#world \.activity-orbit-point\{[^}]*width:clamp\(2px,calc\(var\(--size,48px\)\*\.045\),4\.5px\)[^}]*animation:activity-point-blink/.test(html),'Pontos orbitais devem ficar maiores e acompanhar o tamanho do no');
assert(!html.includes('class="legend"'),'Legenda deve ficar removida da interface monocromatica');
assert(html.includes('@keyframes activity-point-blink{0%,100%{opacity:.16}34%{opacity:1}66%{opacity:.16}}'),'Pontos estacionarios devem acender e apagar para sugerir movimento');
assert(/#world \.n\.processing::after\{[^}]*display:none!important;content:none!important/.test(html),'Acao ativa nao deve manter o anel giratorio antigo');
assert(typeof context.orbitPath==='function','Orbitas devem poder manter o circulo com pequena deformacao local');
const circleBase=context.orbitPoint(0,0,40,0,null,null,0),circleWarp=context.orbitPoint(0,0,40,0,40,0,4),circleFar=context.orbitPoint(0,0,40,0,400,0,4);
assert(Math.abs(Math.hypot(circleBase.x,circleBase.y)-40)<.01,'Orbita sem movimento deve continuar circular');
assert(Math.hypot(circleWarp.x-circleBase.x,circleWarp.y-circleBase.y)>0&&Math.hypot(circleWarp.x-circleBase.x,circleWarp.y-circleBase.y)<=4,'Deformacao perto do cursor deve ser sutil e limitada');
assert.deepEqual(circleFar,circleBase,'Deformacao nao deve alterar trechos longe do cursor');
assert(typeof context.edgeGlyphRun==='function'&&/^[- ]+$/.test(context.edgeGlyphRun(90))&&context.edgeGlyphRun(90).includes('-'),'Rastros devem ser texto formado por hifens, nao stroke tracejado');
assert(/#world \.w\{[^}]*stroke:var\(--link-color/i.test(html),'Conexoes sem selecao devem ter linha solida visivel');
assert(/#world \.w\.edge-selected\{[^}]*stroke:transparent/i.test(html),'Apenas a conexao selecionada deve esconder o traco solido');
assert(/#world \.w\.highlight\{[^}]*stroke-dasharray:none;animation:none/.test(html),'Hover de nos nao deve transformar linhas em tracejadas');
assert(/#wg \.w\{[^}]*pointer-events:stroke/.test(html),'Linhas devem aceitar clique sem bloquear pan no fundo');
assert(html.includes('id="edgeGlyphs"')&&html.includes('textPath')&&html.includes('function advanceSelectedEdge('),'Hifens animados devem acompanhar o caminho apenas na selecao');
assert(/prefers-reduced-motion/.test(html)&&/matchMedia\(['"]\(prefers-reduced-motion: reduce\)['"]\)/.test(html),'Animacoes decorativas devem respeitar prefers-reduced-motion');
const priorAnchor=context.selected;context.selected=forceAnchor;context.updateAttractionField();const orbitElements=elements.get('forceField').children;
assert.equal(orbitElements.length,3,'Tres niveis devem permanecer como tres orbitas, sem criar um segundo renderer');
assert(orbitElements.every(e=>e.tag==='path'&&e.attrs.d&&e.attrs.d.endsWith('Z')),'Orbitas devem ter contorno fechado deformavel');
const activityNode={el:new Element('div'),size:84,activityOrbit:null},activityOrbit=context.ensureActivityOrbit(activityNode);
assert.equal(activityOrbit.children.length,8,'Acao ativa deve mostrar oito pontos fixos ao redor do no');
assert(activityOrbit.children.every((point,i)=>point.style['--orbit-angle']===(i*45)+'deg'&&point.style['--orbit-delay']===(-i*.15)+'s'),'Pontos devem ficar em posicoes fixas e pulsar em sequencia');
context.selected=priorAnchor;context.updateAttractionField();
const cursorCanvas=elements.get('cv'),cursorWorld=elements.get('world');cursorCanvas.listeners.pointermove({clientX:context.tx+123*context.sc,clientY:context.ty+78*context.sc});
const hoverSpot=elements.get('gridHoverSpot'),hoverLayer=elements.get('gridHover');
assert.equal(context.pointerMotion.targetX,123,'Cursor deve calcular a posicao alvo nas coordenadas do mundo');
assert.notEqual(context.pointerMotion.x,123,'Ponto de resposta nao deve saltar diretamente para o cursor');
context.stepPointerMotion(16);assert(context.pointerMotion.x>0&&context.pointerMotion.x<123,'Campo deve seguir o cursor com atraso amortecido');
assert(elements.get('gridHoverShape').attrs.d.startsWith('M')&&elements.get('gridHoverShape').attrs.d.endsWith('Z'),'Mascara orgânica deve acompanhar o cursor suavizado em coordenadas do mundo');
assert.equal(elements.get('brightGlyphPattern').attrs.patternTransform!==undefined,false,'Pontos tipograficos do fundo devem permanecer estaticos');
assert(cursorWorld.classes.has('cursor-active'),'Mover o cursor sobre a grade deve ativar a resposta local');cursorCanvas.listeners.pointerleave();assert.equal(context.pointerMotion.targetOpacity,0,'Sair da tela deve iniciar o recolhimento gradual do realce');
assert(elements.get('meshVerticalLines')&&elements.get('meshHorizontalLines')&&elements.get('meshIntersections'),'Malha ortogonal deve ter linhas visiveis e pontos nas intersecoes');
assert(typeof context.drawBackgroundMesh==='function'&&typeof context.meshPoint==='function','Malha deve ser desenhada por geometria SVG limitada ao viewport e deformacao local');
const meshVertical=elements.get('meshVerticalLines'),meshHorizontal=elements.get('meshHorizontalLines'),meshIntersections=elements.get('meshIntersections');
context.pointerMotion.x=100;context.pointerMotion.y=100;context.pointerMotion.radius=145;context.pointerMotion.phase=.4;context.pointerMotion.opacity=0;context.pointerMotion.vx=.6;context.pointerMotion.vy=.1;
const meshRest=context.meshPoint(150,100);context.pointerMotion.opacity=1;
const meshNear=context.meshPoint(150,100),meshFar=context.meshPoint(400,100);
assert(Math.hypot(meshNear.x-meshRest.x,meshNear.y-meshRest.y)>1,'Malha deve se deformar perto do ponteiro suavizado');
assert.equal(meshFar.x,400,'Malha deve permanecer intacta fora do raio local');assert.equal(meshFar.y,100,'Malha deve permanecer intacta fora do raio local');
const activityNodeForMesh={el:new Element('div'),cx:200,cy:300,size:100,activityOrbit:null},activityOrbitForMesh=context.ensureActivityOrbit(activityNodeForMesh);activityOrbitForMesh.style.display='block';
activityOrbitForMesh.children.forEach((point,i)=>point.style.opacity=i===2||i===3?'1':'.16');
const spinnerSources=context.activitySpinnerSources(activityNodeForMesh);
assert.equal(spinnerSources.length,2,'Todos os pontos atualmente acesos do spinner devem ser fontes');
assert.equal(spinnerSources[0].index,2,'A fonte deve conservar o indice do ponto pulsante');
assert(Math.abs(spinnerSources[0].x-285)<.01&&Math.abs(spinnerSources[0].y-300)<.01,'A posicao da fonte deve seguir o angulo e o raio world-space do spinner');
context.meshActivityNode=activityNodeForMesh;context.pointerMotion.opacity=0;context.meshForceSources=[];context.stepActivityMeshSources(50);
assert(context.activityMeshSources.length===2,'Os pontos acesos devem virar fontes suavizadas mesmo sem mouse');
const activityMeshPoint=context.meshPoint(320,300),activitySources=context.activityMeshSources;context.activityMeshSources=[];
const activityRestPoint=context.meshPoint(320,300);context.activityMeshSources=activitySources;
assert(Math.hypot(activityMeshPoint.x-activityRestPoint.x,activityMeshPoint.y-activityRestPoint.y)>.1,'O spinner deve deformar a malha sem movimento do mouse');
context.reducedMotion=true;assert.equal(context.activitySpinnerSources(activityNodeForMesh).length,0,'Movimento reduzido deve desativar fontes animadas do spinner');context.reducedMotion=false;
context.meshActivityNode=null;for(let i=0;i<40;i++)context.stepActivityMeshSources(50);
assert.equal(context.activityMeshSources.length,0,'Fontes do spinner devem desaparecer quando a atividade termina');
context.reducedMotion=true;const meshReduced=context.meshPoint(150,100);assert.equal(meshReduced.x,meshRest.x,'Movimento reduzido nao deve deformar a coordenada X');assert.equal(meshReduced.y,meshRest.y,'Movimento reduzido nao deve deformar a coordenada Y');context.reducedMotion=false;context.pointerMotion.opacity=0;
assert.equal(hoverLayer.attrs.opacity,'0.000','Movimento do mouse nao deve acender os pontos tipograficos do fundo');
const meshLit=elements.get('meshLitIntersections');assert(meshLit&&meshLit.attrs.mask==='url(#gridHoverMask)','Intersecoes da malha devem receber o realce geoide no lugar do fundo');
assert.equal(elements.get('cursorOrbit').parent,null,'Indicador circular ao redor do cursor deve ser removido');
context.sc=1;context.tx=0;context.ty=0;context.pointerMotion.x=100;context.pointerMotion.y=100;context.pointerMotion.radius=145;context.pointerMotion.phase=.4;context.pointerMotion.vx=.6;context.pointerMotion.vy=.1;context.pointerMotion.opacity=1;context.applyT(false);
assert(context.meshLightStrength(100,100)>.9&&context.meshLightStrength(500,100)===0,'Somente intersecoes dentro da mascara do cursor devem acender');
context.drawBackgroundMesh();assert(context.meshForceSources.length>0&&meshLit.attrs.d.length>0,'Pontos acesos devem virar fontes secundarias da deformacao');
const secondaryBase={x:130,y:100},primaryPoint=context.pointerMeshPoint(secondaryBase.x,secondaryBase.y);context.meshForceSources=Array.from({length:40},()=>({x:150,y:100,strength:1}));context.activityMeshSources=Array.from({length:8},()=>({x:150,y:100,opacity:1,vx:0,vy:0,phase:0}));
const combinedPoint=context.meshPoint(secondaryBase.x,secondaryBase.y),primaryDistance=Math.hypot(primaryPoint.x-secondaryBase.x,primaryPoint.y-secondaryBase.y),secondaryDistance=Math.hypot(combinedPoint.x-primaryPoint.x,combinedPoint.y-primaryPoint.y);
assert(secondaryDistance>0&&secondaryDistance<=primaryDistance*.3+.001,'A deformacao agregada dos pontos acesos deve ficar limitada a 30% do campo principal');
context.meshForceSources=[];context.activityMeshSources=[];context.meshActivityNode=null;context.pointerMotion.opacity=0;context.sc=1;
const graphGeometryBefore=context.steps.map(s=>[s.cx,s.cy]),graphLinksBefore=elements.get('wg').innerHTML;
function meshStarts(path){return Array.from(path.matchAll(/M(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g),m=>[Number(m[1]),Number(m[2])])}
function meshAligned(path,axis,step){const starts=meshStarts(path);return starts.length>0&&starts.every(point=>Math.abs(point[axis]/step-Math.round(point[axis]/step))<.001)}
context.sc=1;context.tx=-250;context.ty=90;context.applyT(false);const meshStep=context.backgroundGridSpacing();
assert.equal(meshStep,96,'Malha deve usar passo medio em escala normal');
assert(meshAligned(meshVertical.attrs.d,0,meshStep)&&meshAligned(meshHorizontal.attrs.d,1,meshStep),'Malha deve permanecer alinhada ao sistema de coordenadas do mundo durante pan');
assert(meshStarts(meshVertical.attrs.d).length+meshStarts(meshHorizontal.attrs.d).length<80,'Malha deve criar somente linhas proximas ao viewport');
assert(meshIntersections.attrs.d.includes('a'),'Intersecoes devem ser pontos SVG, nao elementos do historico');
const staticMeshPath=meshVertical.attrs.d;context.pointerMotion.x=600;context.pointerMotion.y=400;context.pointerMotion.phase=.7;context.pointerMotion.vx=.6;context.pointerMotion.vy=.1;context.pointerMotion.opacity=1;context.drawBackgroundMesh();
assert.notEqual(meshVertical.attrs.d,staticMeshPath,'Linhas SVG devem curvar quando o ponteiro entra no campo local');context.pointerMotion.opacity=0;context.drawBackgroundMesh();
context.sc=1.5;context.applyT(false);assert.equal(context.backgroundGridSpacing(),48,'Zoom aproximado deve adensar a malha');assert(meshAligned(meshVertical.attrs.d,0,48)&&meshAligned(meshHorizontal.attrs.d,1,48),'Malha deve manter o alinhamento de mundo ao aproximar');
assert.deepEqual(context.steps.map(s=>[s.cx,s.cy]),graphGeometryBefore,'Distorcao da malha nao deve mover nos do historico');assert.equal(elements.get('wg').innerHTML,graphLinksBefore,'Distorcao da malha nao deve modificar os links do historico');
context.sc=.3;context.updateZoomLabels();assert(context.physics.overview&&cursorWorld.classes.has('grid-coarse')&&elements.get('dotGlyphPattern').attrs.width==='48','Zoom afastado deve usar grade espaçada e mostrar somente pedidos');
assert(Math.abs(Number(elements.get('gridHoverBlur').attrs.stdDeviation)*context.sc-16)<.02,'Borda suave deve manter 16 px de desfoque visual no zoom afastado');
context.sc=.7;context.updateZoomLabels();assert(!context.physics.overview&&cursorWorld.classes.has('grid-medium')&&elements.get('dotGlyphPattern').attrs.width==='24','Primeiro nivel de zoom deve mostrar todos os nos e grade intermediaria');
assert(Math.abs(Number(elements.get('gridHoverBlur').attrs.stdDeviation)*context.sc-16)<.02,'Borda suave deve manter 16 px de desfoque visual no zoom medio');
context.sc=1.5;context.updateZoomLabels();assert(cursorWorld.classes.has('grid-fine')&&elements.get('dotGlyphPattern').attrs.width==='18','Zoom aproximado deve usar grade fina');
assert(Math.abs(Number(elements.get('gridHoverBlur').attrs.stdDeviation)*context.sc-16)<.02,'Borda suave deve manter 16 px de desfoque visual no zoom aproximado');context.sc=1;context.updateZoomLabels();
assert(html.includes("'Departure Mono'")&&dotPattern,'Tema deve usar Departure Mono e arte de pontos');
const thought=context.steps.find(s=>s.kind==='think');assert(!/[{};]|exec_command/.test(context.activitySummary(thought)),'Resumo de atividade nao deve exibir codigo');
context.tx=-10000;context.applyT(false);assert(context.steps.filter(s=>s.el).length<mounted,'Pan deve liberar DOM fora da tela');
context.working=true;context.steps[0].sat='pending';const last=context.steps.at(-1);assert.equal(context.processingNode(new Set([last])),last,'Spinner nao pode ficar no comando de um pedido antigo');
context.steps.push({turn:2,sat:'pending',kind:'tool'});assert.equal(context.processingNode(new Set([last,context.steps.at(-1)])),last,'Log tardio do subagente nao pode roubar spinner');context.steps.pop();
assert.equal(context.agentAssignment({agentPath:'/root/agente_otimizacao'}),'Agente otimizacao');
assert.equal(context.actionSummary({kind:'tool',cmd:'Get-Content arquivo.txt'}),'Leu arquivos para consultar informações.');assert.match(context.resultSummary({kind:'tool',sat:'err',out:'EACCES permission denied'}),/acesso ou permissão/);assert.match(context.resultSummary({kind:'tool',sat:'pending'}),/andamento/);
const human=context.steps.find(s=>s.kind==='tool');human.cmd='console.log(SECRET_CODE)';human.out='SECRET_OUTPUT';human.sat='ok';context.panel(human);assert(!elements.get('pc').children.some(e=>/SECRET_CODE|SECRET_OUTPUT/.test(e.textContent)),'Flutuante deve mostrar resumo sem codigo ou saida bruta');
const a={cx:0,cy:0,size:84,kind:'user'},b={cx:100,cy:100,size:32};assert.match(context.routedLink({a,b}),/ L/);assert(!/[QC]/.test(context.routedLink({a,b})));
context.resetAll();context.add('user','Recursos','',new Date().toISOString());const patch='*** Begin Patch\n*** Update File: exemplo.js\n@@\n-antigo\n+novo\n*** End Patch';context.call({name:'apply_patch',input:patch,call_id:'patch-test'},new Date().toISOString());const file=context.steps.find(s=>s.kind==='file');assert.equal(file.resourcePath,'exemplo.js');assert.match(file.resourceDiff,/-antigo\n\+novo/);const resourceEdge=context.graphEdges().find(e=>e.resource);assert.equal(resourceEdge.a,file);assert.equal(resourceEdge.b,context.calls['patch-test'],'Seta deve ir do arquivo ao comando');
context.call({name:'exec',arguments:JSON.stringify({code:'await tools.apply_patch('+JSON.stringify(patch)+'); await tools.apply_patch('+JSON.stringify(patch.replace('exemplo.js','outro.js'))+')'}),call_id:'nested-test'},new Date().toISOString());assert.equal(context.calls['nested-test'].resources.length,2,'Deve detectar patches dentro de chamadas compostas');
const owner=context.calls['patch-test'];owner.cx=100;owner.cy=0;owner.size=56;owner.parent={cx:0,cy:0};file.size=32;const outward=context.resourceTarget(file);assert(outward.x>owner.cx);assert(Math.abs(outward.y)<.001,'Recurso unico deve ficar oposto a entrada do comando');
const uncImage="\\\\server\\share\\pasta d'arte\\foto.png";assert.equal(context.viewedImagePath('tools.view_image({path:'+JSON.stringify(uncImage)+'})'),uncImage,'Caminho de imagem deve preservar UNC e apostrofo');
assert(outward.x-owner.cx<140,'Arquivo deve ficar perto do comando');const requestA={kind:'user',size:84,areaRadius:300},requestB={kind:'user',size:84,areaRadius:500},hub={kind:'tool',size:56},leaf={kind:'tool',size:12};context.physics.spacing=1;assert.equal(context.edgeLength({a:requestA,b:requestB,root:true}),960,'Tronco deve preservar a regra anterior');assert(context.edgeLength({a:requestA,b:hub})>215,'Primeiro nivel deve aumentar um pouco');assert(context.edgeLength({a:hub,b:leaf})<120,'Segundo nivel deve encurtar');
context.call({name:'view_image',arguments:JSON.stringify({path:'C:/teste/imagem.png'}),call_id:'image-test'},new Date().toISOString());assert(context.calls['image-test'].resources[0].resourceImage);context.call({name:'exec_command',arguments:JSON.stringify({cmd:"Get-Content -LiteralPath 'pasta/arquivo.txt'"}),call_id:'read-test'},new Date().toISOString());assert.equal(context.calls['read-test'].resources[0].resourcePath,'pasta/arquivo.txt');
context.call({name:'functions.exec',type:'custom_tool_call',input:'const r = await tools.view_image({path:"C:/teste/imagem.png"}); image(r.image_url);',call_id:'raw-image'},new Date().toISOString());assert.equal(context.calls['raw-image'].kind,'img','Imagem em chamada freeform deve ser reconhecida');assert(context.calls['raw-image'].resources[0].resourceImage);context.graphEdges();context.requestAreas();assert(context.physics.areaRoots[0].areaRadius>=500,'Area deve reservar espaco para arquivos externos');assert(html.includes("url('/assets/setas.svg')"));assert(fs.readFileSync(path.join(__dirname,'assets/setas.svg'),'utf8').includes('<svg'));
const big=context.linkMarker({a},'#448aff'),small=context.linkMarker({a:{size:12}},'#448aff');assert.notEqual(big,small);
context.render();const picture=context.calls['raw-image'].resources[0];context.focus(picture);context.drawGraph();const edgeArt=elements.get('edgeGlyphs'),edgePaths=elements.get('wg').children;assert(edgePaths.length>1,'Grafo deve manter os links');assert(edgePaths.every(e=>e.style.stroke!=='transparent'),'Links nao selecionados devem ficar solidos');assert(edgeArt.children.every(e=>e.style.display==='none'),'Nenhum hifen deve aparecer antes de clicar numa linha');
const firstEdge=edgePaths[0],secondEdge=edgePaths[1];assert.equal(typeof firstEdge.onclick,'function','Link deve aceitar clique');assert.equal(firstEdge.attrs.tabindex,'0','Link deve poder receber foco por teclado');firstEdge.onclick({stopPropagation(){}});assert(context.selectedEdge&&firstEdge.attrs.class.includes('edge-selected'),'Clique deve selecionar uma linha');assert.equal(firstEdge.style.stroke,'transparent','A linha selecionada deve ceder lugar ao rastro de hifens');assert(edgeArt.children.some(e=>e.style.display!=='none'&&e.children[0].textContent.includes('-')),'So a linha selecionada recebe hifens animados');var activeOffset=Number(edgeArt.children[0].firstChild.attrs.startOffset);context.advanceSelectedEdge(1000);context.advanceSelectedEdge(1100);assert.notEqual(Number(edgeArt.children[0].firstChild.attrs.startOffset),activeOffset,'Tracejado selecionado deve animar ao longo do caminho');secondEdge.onclick({stopPropagation(){}});assert(secondEdge.attrs.class.includes('edge-selected')&&!firstEdge.attrs.class.includes('edge-selected'),'Selecionar outra linha deve transferir a animacao');secondEdge.onclick({stopPropagation(){}});assert.equal(context.selectedEdge,null,'Clicar novamente deve limpar a selecao');assert(edgePaths.every(e=>e.style.stroke!=='transparent'),'Depois de limpar, as linhas voltam a solidas');
assert(picture.el);assert.equal(picture.el.style.backgroundImage,'','Imagem no grafo nao deve carregar miniatura');assert.equal(picture.el.firstChild.style.display,'','Icone deve permanecer visivel');
// Mesmo conjunto sintetico nas duas versoes: cronometra calculo, nao FPS/RAM do VS Code.
const backup=path.resolve(__dirname,'../../.backups/codex-flow-performance-2026-10-28/index.html');
function environment(source){const c={steps:[],selected:null,isFolded:()=>false,Math,Number,Map,Set,performance,sc:1,physics:{heat:.1,spacing:1,repel:45,edges:[],center:35,link:55,distance:90,settlePass:0},historyView:{focusRoot:null}};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('var routedSegments='),source.indexOf('function drawGraph(){')),c);vm.runInContext(source.slice(source.indexOf('function attractionRadius('),source.indexOf('var historyView=')),c);vm.runInContext(source.slice(source.indexOf('function physicsStep()'),source.indexOf('var oldPaintSel=')),c);return c;}
function bench(source){const c=environment(source);for(let i=0;i<100;i++)c.steps.push({cx:(i%10)*170,cy:Math.floor(i/10)*170,size:32,kind:'tool'});const edges=c.steps.slice(1).map((b,i)=>({a:c.steps[i],b}));let t=performance.now();edges.forEach(e=>c.routedLink(e));const linksMs=performance.now()-t;c.steps=[];for(let i=0;i<1500;i++)c.steps.push({cx:(i%50)*180,cy:Math.floor(i/50)*180,size:32,kind:'tool'});t=performance.now();c.physicsStep();return {linksMs:+linksMs.toFixed(2),physicsMs:+(performance.now()-t).toFixed(2)};}
const result={nodes:2760,mounted,renderMs:+renderMs.toFixed(2),before:bench(fs.readFileSync(backup,'utf8')),after:bench(html)};
const settling=environment(html);settling.physics.heat=1;settling.steps=[{cx:0,cy:0,size:56,kind:'tool'},{cx:20,cy:20,size:32,kind:'tool'}];let ticks=0;while(settling.physics.heat>.008&&ticks<400){settling.physicsStep();ticks++}assert.equal(settling.physics.heat,0,'Movimento deve descansar quando acomodar');assert(ticks>45,'Nao deve cortar o movimento aos45 passos');assert(Math.hypot(settling.steps[1].cx-settling.steps[0].cx,settling.steps[1].cy-settling.steps[0].cy)>60,'Colisao deve separar os nos suavemente');
assert(result.after.linksMs<result.before.linksMs);
assert(html.includes('role="dialog" aria-modal="true"')&&html.includes('id="agentHud" hidden'),'HUD radial deve ser um dialogo modal acessivel');
assert(html.includes('id="headerMenu"')&&html.includes('id="agentsToggle"'),'Barra superior deve agrupar opcoes e expor a entrada do HUD');
assert(html.includes('@media(prefers-reduced-motion:reduce){.agent-node[data-state="running"] .agent-node-icon::after{animation:none;opacity:.45}}'),'Animacao de atividade do HUD deve respeitar movimento reduzido');
const agentNow=Date.now();
context.sessionCatalog=[{f:'session-1',m:agentNow,cwd:'C:\\Repos\\flow'}];context.displayedSessionFile='session-1';context.steps=[{kind:'tool'}];context.working=true;
context.hookAgentStatuses=[{id:'antigravity',name:'Antigravity',surface:'App · CLI · IDE',status:'running',activeCount:1,sessions:[{workspaceName:'Projeto A',agentType:'',status:'running',event:'PreInvocation',updatedAt:agentNow}]},{id:'copilot',name:'Copilot CLI',surface:'CLI',status:'idle',activeCount:0,sessions:[{workspaceName:'Projeto B',agentType:'',status:'idle',event:'agentStop',updatedAt:agentNow}]}];
context.agentStatusErrorText='';context.renderAgentHud();
assert.equal(elements.get('agentStatusCodex').textContent,'Ativo','Codex deve refletir somente a sessao exibida em atividade recente');
assert.equal(elements.get('agentStatusAntigravity').textContent,'Ativo');assert.equal(elements.get('agentStatusCopilot').textContent,'Ocioso');
assert.equal(elements.get('agentActiveCount').textContent,'2','Contador deve incluir somente sessoes com sinal ativo');
elements.get('agentAntigravity').onclick();
assert.equal(context.selectedAgentProvider,'antigravity');assert.equal(elements.get('agentDetailTitle').textContent,'Antigravity');
assert.equal(elements.get('agentDetailSessions').children.length,1);assert.equal(elements.get('agentDetailSessions').children[0].children[0].textContent,'Projeto A');
elements.get('agentsToggle').onclick();assert.equal(elements.get('agentHud').hidden,false);assert.equal(elements.get('agentsToggle').attrs['aria-expanded'],'true');assert.equal(elements.get('agentAntigravity').focused,true);
context.handleAgentHudKeydown({key:'ArrowRight',target:elements.get('agentAntigravity'),preventDefault(){}});
assert.equal(context.selectedAgentProvider,'copilot');assert.equal(elements.get('agentCopilot').focused,true,'Setas devem mover a selecao radial');
context.handleAgentHudKeydown({key:'Tab',shiftKey:false,target:elements.get('agentClaude'),preventDefault(){}});
assert.equal(elements.get('agentHudClose').focused,true,'Tab deve permanecer dentro do dialogo');
context.handleAgentHudKeydown({key:'Escape',target:elements.get('agentCopilot'),preventDefault(){}});
assert.equal(elements.get('agentHud').hidden,true);assert.equal(elements.get('agentsToggle').focused,true,'Fechar deve devolver o foco ao acionador');
elements.get('headerMenuToggle').onclick();assert.equal(elements.get('headerMenu').hidden,false);assert.equal(elements.get('headerMenuToggle').attrs['aria-expanded'],'true');
elements.get('headerMenuToggle').onclick();assert.equal(elements.get('headerMenu').hidden,true);
context.sessionCatalog=[];context.displayedSessionFile='';context.steps=[];context.working=false;context.hookAgentStatuses=[];context.agentStatusErrorText='';context.renderAgentHud();
assert.equal(elements.get('agentStatusClaude').textContent,'Sem sinal','Provedor sem eventos nao pode parecer ocioso ou ativo');
context.selectedAgentProvider='copilot';context.renderAgentHud();
assert.match(elements.get('agentDetailDescription').textContent,/Copilot CLI via hook/);
assert.match(elements.get('agentDetailDescription').textContent,/Copilot Chat\/Fusion no VS Code não é monitorado/);
assert.match(elements.get('agentDetailEmpty').textContent,/Copilot Chat\/Fusion no VS Code não é monitorado/);
context.agentStatusErrorText='Falha local';context.renderAgentHud();assert.equal(elements.get('agentStatusError').hidden,false);assert.equal(elements.get('agentStatusError').textContent,'Falha local');
// Novos contratos: deformacao simultanea multi-no, tracos circulares sem caixa quadrada, 8 icones/cores de subagentes, comandos ativos por pedido e dock superior direito.
const multiNodeA={id:901,el:new Element('div'),cx:200,cy:300,size:84,kind:'agent',activityOrbit:null},multiNodeB={id:902,el:new Element('div'),cx:700,cy:300,size:56,kind:'tool',activityOrbit:null};
const orbitA=context.ensureActivityOrbit(multiNodeA),orbitB=context.ensureActivityOrbit(multiNodeB);orbitA.style.display='block';orbitB.style.display='block';
orbitA.children.forEach((p,i)=>p.style.opacity=i===2?'1':'.16');orbitB.children.forEach((p,i)=>p.style.opacity=i===6?'1':'.16');
context.pointerMotion.opacity=0;context.meshForceSources=[];context.meshActivityNode=null;context.meshActivityNodes=[multiNodeA,multiNodeB];context.stepActivityMeshSources(50);
assert.equal(context.activityMeshSources.length,2,'Todos os nos em atuacao simultanea devem gerar fontes na malha');
const warpAtA=context.meshPoint(310,300),warpAtB=context.meshPoint(610,300);context.activityMeshSources=[];
const restAtA=context.meshPoint(310,300),restAtB=context.meshPoint(610,300);
assert(Math.hypot(warpAtA.x-restAtA.x,warpAtA.y-restAtA.y)>.05&&Math.hypot(warpAtB.x-restAtB.x,warpAtB.y-restAtB.y)>.05,'Subagente e comando simultaneos devem deformar a malha em ambos os locais');
context.meshActivityNodes=[];
const diagAgent={cx:0,cy:0,size:84,kind:'agent'},diagTool={cx:100,cy:100,size:32,kind:'tool'},diagLink=context.routedLink({a:diagAgent,b:diagTool}),diagStart=/^M(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(diagLink);
assert(diagStart&&Math.abs(Math.hypot(Number(diagStart[1]),Number(diagStart[2]))-42)<1.5,'Traco saindo de subagente circular nao deve ser cortado por caixa quadrada');
assert(Array.isArray(context.SUBAGENT_VARIANTS)&&context.SUBAGENT_VARIANTS.length===8,'Devem existir 8 variantes de subagentes com os icones de Subagentes_32x32_brancos');
context.resetAll();context.add('user','Pedido com subagentes','',new Date().toISOString());
const spawnedAgents=[];for(let i=0;i<9;i++){context.handle({type:'event_msg',timestamp:new Date().toISOString(),payload:{item:{type:'SubAgentActivity',kind:'started',agent_path:'/root/sub_'+i,task_name:'Subagente '+i}}});spawnedAgents.push(context.steps.filter(s=>s.kind==='agent').at(-1));}
const firstEightVariants=new Set(spawnedAgents.slice(0,8).map(a=>a.agentVariant));
assert.equal(firstEightVariants.size,8,'Os primeiros 8 subagentes devem usar todos os 8 icones antes de repetir');
assert.notEqual(spawnedAgents[8].agentVariant,spawnedAgents[7].agentVariant,'Nao deve repetir o mesmo icone duas vezes seguidas no mesmo pedido');
assert.equal(context.agentColor(spawnedAgents[0]),context.agentColor(spawnedAgents[1]),'Subagentes devem manter cor uniforme sem variacao de cores');
assert(!/#world \.node-icon\{filter:grayscale\(1\)\}/.test(html)||/#world \.n\.agent \.node-icon\{[^}]*filter:none/.test(html),'Icones de subagentes devem preservar a cor sem grayscale');
const activeSub=spawnedAgents[0];context.activeSessionId='sess-sub';
context.ingestSubagentRecords(activeSub,[
 {timestamp:new Date().toISOString(),payload:{type:'function_call',name:'exec_command',arguments:JSON.stringify({cmd:'Get-Content a.txt'}),call_id:'sub-c1'}},
 {timestamp:new Date().toISOString(),payload:{type:'function_call_output',call_id:'sub-c1',output:'ok'}},
 {timestamp:new Date().toISOString(),payload:{type:'function_call',name:'exec_command',arguments:JSON.stringify({cmd:'pytest'}),call_id:'sub-c2'}}
]);
const subChildrenDuring=context.steps.filter(s=>s.agentOwner===activeSub);
assert.equal(subChildrenDuring.length,1,'Subagente deve exibir no grafo apenas o comando em execucao no momento');
assert.equal(subChildrenDuring[0].callKey,'sub-c2','O comando ativo do subagente deve permanecer visivel');
context.ingestSubagentRecords(activeSub,[{timestamp:new Date().toISOString(),payload:{type:'function_call_output',call_id:'sub-c2',output:'PASS'}}]);
assert.equal(context.steps.filter(s=>s.agentOwner===activeSub&&s.kind!=='ans').length,0,'Comandos finalizados do subagente nao devem acumular baloes no grafo');
assert(activeSub.commandsHistory&&activeSub.commandsHistory.length===2,'Subagente deve preservar resumo dos comandos executados para controle');
const subDock=elements.get('subagentsDock');
assert(subDock,'Deve existir o dock de subagentes no canto superior direito');
spawnedAgents.slice(1).forEach(a=>{a.sat='ok'});
activeSub.detail='Resumo final enviado ao agente principal.';
context.panel(activeSub);
assert(elements.get('pc').children.some(e=>e.textContent.includes('Resumo final enviado ao agente principal.')),'Balao do subagente deve registrar o texto enviado ao agente principal');
context.renderSubagentsDock();
assert.equal(subDock.children.length,2,'Dock deve mostrar o botao ☰ mais o grupo de subagentes ativos');
assert.equal(subDock.children[1].children[0].children.length,1,'Grupo ativo deve ter 1 coluna com apenas o subagente trabalhando');
assert(subDock.children[1].children[0].children[0].attrs['aria-label'].includes('Subagente 0')&&context.subagentBriefSummary(activeSub).length>5,'Botao do subagente no topo direito deve incluir resumo breve do que faz');
subDock.children[0].onclick({stopPropagation(){}});
assert.equal(subDock.children[1].children.length,2,'Ao clicar no botao ☰, dock deve exibir grupo ativo e grupo ocioso separados');
assert.equal(subDock.children[1].children[1].children.length,8,'Grupo ocioso deve conter os 8 subagentes inativos da conversa');
console.log('PASS: leitura, virtualizacao, pan, SVG reutilizado, spinner, atracao em niveis, malha deformavel, formas circulares, deformacao com atraso, links e HUD radial acessivel.');
console.log(JSON.stringify(result,null,2));
