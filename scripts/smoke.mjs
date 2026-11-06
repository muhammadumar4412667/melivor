// Read-only tests against an already running Melivor server; no records are created.
const BASE=process.env.BASE_URL||'http://127.0.0.1:3000';
async function get(path){const r=await fetch(BASE+path);if(!r.ok)throw Error(`${path} returned ${r.status}`);return r.json()}
const health=await get('/api/health');
if(!health.ok)throw Error('Health check failed');
const store=await get('/api/store');
if(!store.settings?.store_name||store.featured.length<4)throw Error('Storefront configuration or sample catalog missing');
const products=await get('/api/products');
if(!products.products.length||!products.products[0].variants.length)throw Error('Product catalog/variant query failed');
const p=products.products[0],variant=p.variants.find(v=>v.stock>0);
if(!variant)throw Error('No in-stock sample product');
const r=await fetch(BASE+'/api/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{variantId:variant.id,quantity:1}]})});
const quote=await r.json();
if(!r.ok||quote.quote.total_cents<0)throw Error('Cart quote failed: '+JSON.stringify(quote));
const page=await fetch(BASE+'/');if(!page.ok||!(await page.text()).includes('Melivor'))throw Error('Home document missing');
const admin=await fetch(BASE+'/admin');if(!admin.ok||!(await admin.text()).includes('Merchant Dashboard'))throw Error('Admin document missing');
const denied=await fetch(BASE+'/api/admin/orders');if(denied.status!==403)throw Error('Unauthenticated admin access not blocked');
console.log('PASS: health, storefront, catalog, variants, quote, homepage, admin login document, admin protection.');
