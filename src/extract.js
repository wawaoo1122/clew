// Reads a web page's main text. Runs inside a real (hidden) browser window that shares
// cookies with Clew's built-in browser, so pages you've logged into work too.
const fs = require('fs');
const path = require('path');

const READABILITY = fs.readFileSync(path.join(__dirname, 'Readability.js'), 'utf8');

const EXTRACT_BODY = String.raw`function meta(n){var el=document.querySelector('meta[property="'+n+'"],meta[name="'+n+'"],meta[itemprop="'+n+'"]');return el?el.getAttribute('content'):null;}
var pub=meta('article:published_time')||meta('og:published_time')||meta('og:article:published_time')||meta('pubdate')||meta('publishdate')||meta('publish_date')||meta('datePublished')||meta('date')||meta('dc.date');
if(!pub){try{var ss=document.querySelectorAll('script[type="application/ld+json"]');for(var i=0;i<ss.length&&!pub;i++){var j=JSON.parse(ss[i].textContent);var arr=Array.isArray(j)?j:[j];for(var k=0;k<arr.length&&!pub;k++){var o=arr[k];if(o&&o.datePublished)pub=o.datePublished;if(o&&o['@graph'])for(var g=0;g<o['@graph'].length;g++)if(o['@graph'][g].datePublished){pub=o['@graph'][g].datePublished;break;}}}}catch(e){}}
if(!pub){var pt=document.querySelector('#publish_time');if(pt&&pt.textContent.trim())pub=pt.textContent.trim();}
if(!pub){var m=document.documentElement.innerHTML.match(/var\s+ct\s*=\s*"(\d{10})"/);if(m)pub=new Date(Number(m[1])*1000).toISOString();}
if(!pub){var tm=document.querySelector('time[datetime]');if(tm)pub=tm.getAttribute('datetime');}
var title=document.title||'',text='',site=meta('og:site_name');
try{var art=new Readability(document.cloneNode(true)).parse();if(art){title=art.title||title;text=art.textContent||'';site=art.siteName||site;}}catch(e){}
if(!text||text.trim().length<200){text=(document.body&&document.body.innerText)||text;}
var wx=document.querySelector('#js_name');if(wx&&wx.textContent.trim())site=wx.textContent.trim();
var wxt=document.querySelector('#activity-name');if(wxt&&wxt.textContent.trim())title=wxt.textContent.trim();
return {url:location.href,title:String(title).trim().slice(0,300),text:String(text).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim().slice(0,20000),siteName:site?String(site).trim().slice(0,80):null,pub:pub?String(pub).slice(0,40):null};
`;

const EXTRACT_SCRIPT = '(function(){\n' + READABILITY + '\n' + EXTRACT_BODY + '\n})()';

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function extractUrl(BrowserWindow, session, url, timeoutMs = 35000) {
  const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    const load = win.loadURL(url).catch((e) => {
      // ERR_ABORTED happens on some redirects; the page often still loads.
      if (!/ERR_ABORTED/.test(String(e && e.message))) throw e;
    });
    await Promise.race([load, wait(timeoutMs).then(() => { throw new Error('The page took too long to load'); })]);
    await wait(1800); // let late scripts render the article
    const res = await win.webContents.executeJavaScript(EXTRACT_SCRIPT, true);
    if (!res || (!res.text && !res.title)) throw new Error('Could not read anything from this page');
    return res;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { extractUrl, EXTRACT_SCRIPT };
