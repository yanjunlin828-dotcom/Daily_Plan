const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {app,BrowserWindow}=require('electron');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'output','playwright','floating-redesign');
// Keep smoke-test caches and browser state away from the user's real profile.
app.setPath('userData',path.join(ROOT,'.tmp',`desktop-smoke-profile-${process.pid}`));
const errors=[];
const fixture=String.raw`(() => {
const key=todayKey();window.fixture={tasks:{[key]:[
{id:'a',text:'完成悬浮窗的交互设计',done:false,priority:'high',tags:['设计'],startTime:'14:00',endTime:'15:30',subtasks:[{done:true},{done:false}],createdAt:1},
{id:'b',text:'读完《设计中的设计》一章',done:false,priority:'medium',tags:['阅读'],createdAt:2},
{id:'c',text:'整理这一周的想法',done:false,priority:'low',tags:[],createdAt:3},
{id:'d',text:'出门散步，给大脑放个假',done:true,priority:'medium',tags:[],createdAt:4}]},goals:[{id:'goal',type:'goal',text:'保留长期目标'},{id:'todo',type:'todo',text:'整理书签',done:false,priority:'medium'}],sessions:{[key]:[{duration:1500},{duration:900}]},revisions:{tasks:{[key]:1},goals:1},timer:{status:'idle',elapsedSeconds:0,sessionId:null}};
window.fetch=async (url,options={})=>{await new Promise(r=>setTimeout(r,35));const route=new URL(url).pathname,body=options.body?JSON.parse(options.body):{};let result;
if(route==='/api/data')result=fixture;
else if(route.startsWith('/api/tasks/')){fixture.tasks[key]=body.items;fixture.revisions.tasks[key]++;result={items:body.items,revision:fixture.revisions.tasks[key]}}
else if(route==='/api/goals'){fixture.goals=body.items;fixture.revisions.goals++;result={items:body.items,revision:fixture.revisions.goals}}
else if(route==='/api/timer/start')result=fixture.timer={status:'running',elapsedSeconds:0,sessionId:'test-session',target:body.target};
else if(route==='/api/timer/pause')result=fixture.timer={...fixture.timer,status:'paused',elapsedSeconds:Math.floor(clock.seconds())};
else if(route==='/api/timer/resume')result=fixture.timer={...fixture.timer,status:'running'};
else if(route==='/api/timer/finish'){const session={duration:1482};fixture.sessions[key].push(session);fixture.timer={status:'idle',elapsedSeconds:0,sessionId:null};result={timer:fixture.timer,session}}
else if(route==='/api/timer/discard')result=fixture.timer={status:'idle',elapsedSeconds:0,sessionId:null};
return {ok:true,json:async()=>structuredClone(result)};};
})()`;
async function wait(w,ms=250){await w.webContents.executeJavaScript(`new Promise(r=>setTimeout(r,${ms}))`)}
async function capture(w,name){w.showInactive();await wait(w,500);await fs.writeFile(path.join(OUT,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide()}
app.whenReady().then(async()=>{
await fs.mkdir(OUT,{recursive:true});
const panel=new BrowserWindow({width:380,height:570,frame:false,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
// A smoke run must never read or checkpoint the user's live local backend.
panel.webContents.session.webRequest.onBeforeRequest(
  {urls:['http://127.0.0.1:8000/*']},
  (_details,callback)=>callback({cancel:true}),
);
panel.webContents.on('console-message',e=>{if(e.level==='error'&&!e.message.includes('ERR_CONNECTION_REFUSED')&&!e.message.includes('ERR_BLOCKED_BY_CLIENT'))errors.push(e.message)});
await panel.loadFile(path.join(ROOT,'floating/panel.html'));await wait(panel);await panel.webContents.executeJavaScript(fixture);await panel.webContents.executeJavaScript('reload()');await capture(panel,'tasks');
assert.equal(await panel.webContents.executeJavaScript(`document.querySelectorAll('.task-row').length`),3);
await panel.webContents.executeJavaScript(`document.querySelector('.task-check').click()`);await wait(panel,120);assert.equal(await panel.webContents.executeJavaScript(`fixture.tasks[todayKey()][0].done`),true);
assert.equal(await panel.webContents.executeJavaScript(`expandedDone`),true);
assert.equal(await panel.webContents.executeJavaScript(`document.querySelectorAll('.task-row').length`),4);
assert.equal(await panel.webContents.executeJavaScript(`document.querySelector('[data-row-id="a"]').classList.contains('is-done')`),true);
assert.ok(await panel.webContents.executeJavaScript(`document.querySelector('#panel-task-list').getAnimations({subtree:true}).length`));
await capture(panel,'task-completed');
await panel.webContents.executeJavaScript(`document.querySelector('[data-action-key="check-a"]').click()`);await wait(panel);
await panel.webContents.executeJavaScript(`document.querySelector('[data-action-key="edit-b"]').click();document.querySelector('.edit-input').value='编辑后的阅读任务';document.querySelector('.edit-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);await wait(panel);assert.equal(await panel.webContents.executeJavaScript(`fixture.tasks[todayKey()][1].text`),'编辑后的阅读任务');
await panel.webContents.executeJavaScript(`document.querySelector('[data-scope="todo"]').click();document.querySelector('#task-input').value='新的待办 #生活';document.querySelector('#add-form').requestSubmit()`);await wait(panel);assert.equal(await panel.webContents.executeJavaScript(`fixture.goals.find(x=>x.id==='goal').text`),'保留长期目标');assert.equal(await panel.webContents.executeJavaScript(`fixture.goals.length`),3);
await panel.webContents.executeJavaScript(`document.querySelector('[data-scope="today"]').click();document.querySelector('[data-action-key="play-a"]').click()`);await wait(panel);assert.equal(await panel.webContents.executeJavaScript(`clock.state.status`),'running');
await panel.webContents.executeJavaScript(`selectView('tasks');document.querySelector('[data-action-key="check-a"]').click()`);await wait(panel);
assert.equal(await panel.webContents.executeJavaScript(`clock.state.status`),'paused');assert.equal(await panel.webContents.executeJavaScript(`fixture.tasks[todayKey()][0].done`),true);
await panel.webContents.executeJavaScript(`document.querySelector('[data-action-key="check-a"]').click()`);await wait(panel);await panel.webContents.executeJavaScript(`selectView('focus');document.querySelector('#panel-timer-button').click()`);await wait(panel);assert.equal(await panel.webContents.executeJavaScript(`clock.state.status`),'running');
await panel.webContents.executeJavaScript(`fixture.timer.elapsedSeconds=1482;clock.accept(fixture.timer);renderTimer();document.querySelector('#toast').classList.remove('visible')`);await capture(panel,'focus-running');
await panel.webContents.executeJavaScript(`document.querySelector('#panel-timer-button').click()`);await wait(panel);assert.equal(await panel.webContents.executeJavaScript(`clock.state.status`),'paused');await capture(panel,'focus-paused');
await panel.webContents.executeJavaScript(`document.querySelector('#panel-timer-button').click()`);await wait(panel);assert.equal(await panel.webContents.executeJavaScript(`clock.state.status`),'running');
await panel.webContents.executeJavaScript(`document.querySelector('#finish-button').click()`);await wait(panel);assert.equal(await panel.webContents.executeJavaScript(`fixture.sessions[todayKey()].length`),3);assert.equal(await panel.webContents.executeJavaScript(`clock.state.status`),'idle');
await panel.webContents.executeJavaScript(`document.querySelector('#panel-timer-button').click()`);await wait(panel);await panel.webContents.executeJavaScript(`document.querySelector('#discard-button').click()`);await capture(panel,'discard-confirm');await panel.webContents.executeJavaScript(`document.querySelector('#confirm-discard').click()`);await wait(panel);assert.equal(await panel.webContents.executeJavaScript(`clock.state.status`),'idle');
// A late pre-write read must not replace an optimistic mutation.
await panel.webContents.executeJavaScript(`(async()=>{while(polling)await new Promise(r=>setTimeout(r,10));const original=window.fetch;let release;const stale=structuredClone(fixture);window.fetch=(url,o)=>!o?.method||o.method==='GET'?new Promise(r=>release=()=>r({ok:true,json:async()=>stale})):original(url,o);const oldRead=reload();const write=saveChange(arr=>arr.map(x=>x.id==='a'?{...x,text:'??????'}:x));await write;release();await oldRead;window.fetch=original})()`);
assert.equal(await panel.webContents.executeJavaScript(`snapshot.tasks[todayKey()].find(x=>x.id==='a').text`),'??????');
await panel.webContents.executeJavaScript(`(async()=>{const original=window.fetch;window.fetch=async(url,o)=>o?.method==='PUT'?{ok:false,status:409,json:async()=>({detail:{message:'conflict'}})}:original(url,o);window.restoreFetch=original;document.querySelector('[data-view="tasks"]').click();document.querySelector('#task-input').value='????????';document.querySelector('#add-form').requestSubmit()})()`);await wait(panel);
assert.equal(await panel.webContents.executeJavaScript(`document.querySelector('#task-input').value`),'????????');await panel.webContents.executeJavaScript(`window.fetch=restoreFetch;document.querySelector('[data-view="focus"]').click()`);
const layout=await panel.webContents.executeJavaScript(`({height:innerHeight,footer:document.querySelector('footer').getBoundingClientRect().bottom,discard:document.querySelector('#discard-button').getBoundingClientRect().bottom,overflow:document.documentElement.scrollHeight>innerHeight})`);assert.equal(layout.overflow,false);
const orb=new BrowserWindow({width:72,height:72,frame:false,transparent:true,show:false,webPreferences:{contextIsolation:true,backgroundThrottling:false}});await orb.loadFile(path.join(ROOT,'floating/orb.html'));await wait(orb);await orb.webContents.executeJavaScript(`done=2;total=5;failed=false;clock.accept({status:'running',elapsedSeconds:1482,sessionId:'demo'});document.querySelector('.orb__progress').style.strokeDashoffset=60;draw()`);assert.equal(await orb.webContents.executeJavaScript(`document.querySelector('#orb').hasAttribute('title')`),false);await capture(orb,'orb-running');await orb.webContents.executeJavaScript(`document.body.dataset.side='right';document.body.dataset.collapsed='true'`);await capture(orb,'orb-docked');
assert.deepEqual(errors,[]);await fs.writeFile(path.join(OUT,'report.json'),JSON.stringify({passed:true,checks:['task complete/restore','rename','Todo preserves goals','start/pause/resume','finish records session','discard confirmation','layout'],layout},null,2));console.log('PASS: floating interaction checks and screenshots',OUT);panel.destroy();orb.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
