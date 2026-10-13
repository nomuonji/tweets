// Read-only production smoke test of A8 landing pages (no A8 credentials).
// Does NOT establish advertiser permission, A8 URL submission or SNS registration.
const pages=[
  'https://bloom.antonbase.com/uranai-soudan/',
  'https://bloom.antonbase.com/uranai-denwa-soudan/',
  'https://bloom.antonbase.com/uranai-chat-soudan/',
  'https://yohaku.antonbase.com/20s-self-investment/',
  'https://yohaku.antonbase.com/side-gig-coconala/',
  'https://yohaku.antonbase.com/resort-work-change/',
  'https://yohaku.antonbase.com/everyday-spending-hapitas/',
];
let failures=0;
for (const url of pages) {
  try {
    const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'follow',
      headers:{'user-agent':'AntonbaseAffiliateLPVerification/1.0'}});
    const html=await response.text();
    const contentType=response.headers.get('content-type')||'';
    const visible=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'')
      .replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
    const hasDisclosure=/(?:^|[^a-z])PR(?:[^a-z]|$)|アフィリエイト広告|広告を含|プロモーションを含/.test(visible);
    const hasAffiliateCTA=/<a\b[^>]*href\s*=\s*["']https?:\/\/px\.a8\.net\/[^"']*["'][^>]*>/i.test(html) ||
      /<a\b[^>]*href\s*=\s*["'][^"']*px\.a8\.net[^"']*["'][^>]*>/i.test(html);
    const ok=response.status===200&&contentType.toLowerCase().includes('text/html')&&
      response.url===url&&hasDisclosure&&hasAffiliateCTA;
    console.log(JSON.stringify({path:new URL(url).pathname,host:new URL(url).hostname,
      status:response.status,redirected:response.url!==url,hasDisclosure,hasAffiliateCTA,ok}));
    if(!ok) failures++;
  } catch (error) {
    console.log(JSON.stringify({path:new URL(url).pathname,host:new URL(url).hostname,
      ok:false,error:error?.name||'fetch_failed'}));
    failures++;
  }
}
console.log('LP checks:',pages.length-failures,'/',pages.length,'passed');
if(failures)process.exitCode=1;
