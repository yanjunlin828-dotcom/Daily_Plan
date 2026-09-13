const {app,BrowserWindow,ipcMain,screen}=require('electron');
const path=require('node:path');
const assert=require('node:assert/strict');
app.setPath('userData',path.resolve(__dirname,'../.tmp/native-smoke-profile'));
require('./main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{await wait(1200);const orb=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Daily Plan Orb');const panel=BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('随身专注'));assert.ok(orb&&panel);const send=(name,w,payload)=>ipcMain.emit(name,{sender:w.webContents},payload);
send('panel:set-pinned',panel,true);
for(let i=0;i<3;i++){send('panel:toggle',orb);await wait(100);assert.equal(panel.isVisible(),true);send('panel:toggle',orb);await wait(220);assert.equal(panel.isVisible(),false)}
send('panel:toggle',orb);send('panel:toggle',orb);send('panel:toggle',orb);await wait(250);assert.equal(panel.isVisible(),true);send('panel:close',panel);await wait(220);
const area=screen.getPrimaryDisplay().workArea;orb.setPosition(area.x+3,area.y+100);let point={x:area.x+30,y:area.y+135};const original=screen.getCursorScreenPoint;screen.getCursorScreenPoint=()=>point;send('orb:drag-start',orb);point={x:area.x+40,y:area.y+145};await wait(70);send('orb:drag-end',orb);assert.equal(orb.getBounds().x,area.x);point={x:area.x+200,y:area.y+200};await wait(1450);assert.equal(await orb.webContents.executeJavaScript('document.body.dataset.collapsed'),'true');point={x:area.x+10,y:orb.getBounds().y+36};await wait(350);assert.equal(await orb.webContents.executeJavaScript('document.body.dataset.collapsed'),'false');screen.getCursorScreenPoint=original;console.log('PASS: repeated open/close, animation reversal, native edge snap, collapse and reveal');app.quit()
}).catch(e=>{console.error(e);app.exit(1)});
