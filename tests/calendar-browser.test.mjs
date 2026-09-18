import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../site/',import.meta.url).pathname;
let server, browser, origin;
before(async()=>{
  server=createServer(async(req,res)=>{
    try {
      const path=new URL(req.url,'http://localhost').pathname;
      const file=path==='/'?'index.html':path.slice(1);
      if(!/^[a-zA-Z0-9.-]+$/.test(file)) throw new Error('bad path');
      const contents=await readFile(join(root,file));
      res.setHeader('Content-Type',file.endsWith('.css')?'text/css':/\.m?js$/.test(file)?'text/javascript':'text/html');res.end(contents);
    }catch{res.statusCode=404;res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,...(process.env.CHROME_CHANNEL?{channel:process.env.CHROME_CHANNEL}:{})});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});
const person={id:'22222222-2222-4222-8222-222222222222',slug:'test-person',name:'Test Person',initials:'TP',color:'#123d2c',raised:0,goal:465};
const session={user:{id:'11111111-1111-4111-8111-111111111111'},access_token:'test-token',refresh_token:'test-refresh',expires_at:9999999999};
async function fixture({account=false,admin=false,people=[person],delay=0}={}){
  const context=await browser.newContext();const page=await context.newPage();const errors=[];const writes=[];let days=[];
  page.on('pageerror',e=>errors.push(e.message));
  if(account) await page.addInitScript(session=>localStorage.setItem('crhs-fundraiser-session',JSON.stringify(session)),session);
  await context.route('https://crhstheatre.ludus.com/**',r=>r.fulfill({status:200,body:'Payment test destination'}));
  await context.route('https://onejynhbuesebccwssuz.supabase.co/**',async r=>{
    const req=r.request();const path=new URL(req.url()).pathname;
    if(delay) await new Promise(resolve=>setTimeout(resolve,delay));
    if(req.method()==='POST' && path.endsWith('/sponsored_days')){
      const day=req.postDataJSON();writes.push(day);days.push({...day,id:days.length+1});
      return r.fulfill({status:201,body:''});
    }
    if(path.endsWith('/signup')){writes.push('signup');return r.fulfill({json:session});}
    if(path.includes('/token'))return r.fulfill({json:session});
    if(path.endsWith('/calendar_admins')) return r.fulfill({json:admin?[{user_id:session.user.id}]:[]});
    if(path.endsWith('/participants'))return r.fulfill({json:people});
    if(path.endsWith('/sponsored_days'))return r.fulfill({json:days});
    return r.fulfill({json:[]});
  });
  return {context,page,errors,writes};
}
test('public reservation updates immediately, keeps calendar open, opens Ludus separately',async()=>{
  const f=await fixture();try {
    await f.page.goto(`${origin}/#/calendar/test-person`);
    const popup=f.page.waitForEvent('popup');
    await f.page.getByRole('button',{name:'April 5, $5 donation',exact:true}).click();
    const payment=await popup;await payment.waitForURL('https://crhstheatre.ludus.com/');
    await f.page.getByRole('button',{name:'April 5, reserved',exact:true}).waitFor();
    assert.equal(await f.page.getByRole('button',{name:'April 5, reserved',exact:true}).isDisabled(),true);
    assert.equal(f.writes.length,1);assert.match(f.page.url(),/#\/calendar\/test-person/);
    assert.match(await f.page.locator('.total').innerText(),/\$5 reserved of \$465/);
    assert.deepEqual(f.errors,[]);
  } finally{await f.context.close();}
});
test('stored markup cannot run in public or admin names',async()=>{
  const injected={...person,name:'<img src=x onerror="window.pwned=1">',initials:'<svg/onload=alert(1)>',color:'red; background:url(https://example.com)'};
  const f=await fixture({account:true,admin:true,people:[injected]});try {
    await f.page.goto(origin);await f.page.locator('.person').waitFor();
    assert.equal(await f.page.locator('#app img,#app svg').count(),0);
    await f.page.goto(`${origin}/#/admin`);await f.page.locator('.admin-person').waitFor();
    assert.equal(await f.page.locator('#app img').count(),0);
    assert.equal(await f.page.evaluate(()=>window.pwned),undefined);
    assert.deepEqual(f.errors,[]);
  } finally {await f.context.close();}
});
test('normal dashboard has no payment-edit controls; admin route denies normal account',async()=>{
  const f=await fixture({account:true});try {
    await f.page.goto(`${origin}/#/dashboard`);await f.page.locator('#share-calendar').waitFor();
    assert.equal(await f.page.locator('.days button:not(:disabled)').count(),0);
    assert.equal(await f.page.getByRole('link',{name:'Admin controls'}).count(),0);
    await f.page.goto(`${origin}/#/admin`);
    await f.page.getByText('This account does not have administrator access.').waitFor();
    assert.equal(await f.page.locator('.delete-calendar').count(),0);
    assert.deepEqual(f.errors,[]);
  }finally{await f.context.close();}
});
test('slow page loads cannot overwrite a newer route',async()=>{
  const f=await fixture({delay:180});try {
    await f.page.goto(origin);await f.page.getByRole('link',{name:'Create calendar',exact:true}).click();
    await f.page.locator('#auth-form').waitFor();await new Promise(r=>setTimeout(r,600));
    assert.equal(await f.page.locator('#auth-form').count(),1);assert.deepEqual(f.errors,[]);
  }finally{await f.context.close();}
});
test('mobile layout fits and honors reduced motion',async()=>{
  const f=await fixture();try {
    await f.page.setViewportSize({width:375,height:812});await f.page.emulateMedia({reducedMotion:'reduce'});
    await f.page.goto(`${origin}/#/calendar/test-person`);await f.page.locator('.calendar').waitFor();
    assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
    assert.equal(await f.page.locator('.days button').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
    if(process.env.SCREENSHOT_PATH) await f.page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
    assert.deepEqual(f.errors,[]);
  }finally{await f.context.close();}
});
