import { getUser } from "@netlify/identity";
// Dook product gallery API. Supabase secret key is used server-side only.
const SUPABASE_URL = "https://xgfavuzzhtlzfwprbvav.supabase.co";
const BUCKET = "dook-product-gallery";
const ADMIN_EMAIL = "majidboushi@gmail.com";
const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const key = () => Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
function headers(extra={}) { const k=key(); return { apikey:k, Authorization:`Bearer ${k}`, ...extra }; }
async function sb(path, options={}) {
  const r=await fetch(`${SUPABASE_URL}${path}`,{...options,headers:{...headers(options.headers||{}),...(options.headers||{})}});
  const t=await r.text(); let d=null; try{d=t?JSON.parse(t):null}catch{d=t}
  if(!r.ok) throw new Error(typeof d==='string'?d:(d?.message||d?.error||`Supabase ${r.status}`));
  return d;
}
async function isAdmin(){try{const user=await getUser();return String(user?.email||'').trim().toLowerCase()===ADMIN_EMAIL}catch{return false}}
function cleanId(v){return String(v||'').trim().slice(0,180).replace(/[^\p{L}\p{N}_.:-]/gu,'_')}
function publicUrl(path){return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`}
async function getRows(product,variant){
  const p=new URLSearchParams({select:'id,adin_product_id,adin_variant_id,storage_path,alt_text,sort_order,is_cover,created_at',adin_product_id:`eq.${product}`,order:'sort_order.asc,created_at.asc'});
  p.set('adin_variant_id',variant?`eq.${variant}`:'is.null');
  const rows=await sb(`/rest/v1/product_gallery_images?${p}`);
  return (rows||[]).map(x=>({...x,public_url:publicUrl(x.storage_path)}));
}
export default async (req)=>{
  if(!key())return json({error:'SUPABASE_SERVICE_ROLE_KEY در تنظیمات Netlify پیدا نشد.'},503);
  try{
    if(req.method==='GET'){
      const u=new URL(req.url),product=cleanId(u.searchParams.get('product_id')),variant=cleanId(u.searchParams.get('variant_id'));
      if(!product)return json({error:'شناسه کالا الزامی است.'},400);
      return json({images:await getRows(product,variant)});
    }
    if(req.method!=='POST'&&req.method!=='DELETE')return json({error:'روش درخواست مجاز نیست.'},405);
    if(!(await isAdmin()))return json({error:'دسترسی مدیریت تأیید نشد.'},401);
    if(req.method==='DELETE'){
      const body=await req.json(),id=String(body.id||'');
      const rows=await sb(`/rest/v1/product_gallery_images?id=eq.${encodeURIComponent(id)}&select=id,storage_path`);
      if(!rows?.length)return json({error:'تصویر پیدا نشد.'},404);
      await sb(`/storage/v1/object/${BUCKET}`,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({prefixes:[rows[0].storage_path]})});
      await sb(`/rest/v1/product_gallery_images?id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});
      return json({ok:true});
    }
    const ct=req.headers.get('content-type')||'';
    if(ct.includes('multipart/form-data')){
      const f=await req.formData(),product=cleanId(f.get('product_id')),variant=cleanId(f.get('variant_id'));
      const files=f.getAll('images').filter(x=>x&&typeof x.arrayBuffer==='function');
      if(!product||!files.length)return json({error:'کالا و حداقل یک تصویر انتخاب کنید.'},400);
      if(files.length>12)return json({error:'در هر بار حداکثر ۱۲ تصویر بارگذاری کنید.'},400);
      const added=[];
      for(const file of files){
        if(!file.type?.startsWith('image/'))continue;
        if(file.size>10*1024*1024)throw new Error('حجم هر تصویر باید کمتر از ۱۰ مگابایت باشد.');
        const ext=({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif' })[file.type]||'jpg';
        const path=`${product}/${variant||'parent'}/${crypto.randomUUID()}.${ext}`;
        await sb(`/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`,{method:'POST',headers:{'content-type':file.type,'x-upsert':'false'},body:await file.arrayBuffer()});
        const current=await getRows(product,variant);
        const rows=await sb('/rest/v1/product_gallery_images?select=id,storage_path,sort_order',{method:'POST',headers:{'content-type':'application/json','Prefer':'return=representation'},body:JSON.stringify({adin_product_id:product,adin_variant_id:variant||null,storage_path:path,alt_text:String(f.get('alt_text')||'').slice(0,200),sort_order:current.length,is_cover:current.length===0})});
        added.push(rows?.[0]);
      }
      return json({ok:true,added,images:await getRows(product,variant)});
    }
    const body=await req.json();
    if(body.action==='cover'){
      const id=String(body.id||''),product=cleanId(body.product_id),variant=cleanId(body.variant_id);
      await sb(`/rest/v1/product_gallery_images?adin_product_id=eq.${encodeURIComponent(product)}&adin_variant_id=${variant?`eq.${encodeURIComponent(variant)}`:'is.null'}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({is_cover:false})});
      await sb(`/rest/v1/product_gallery_images?id=eq.${encodeURIComponent(id)}&adin_product_id=eq.${encodeURIComponent(product)}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({is_cover:true})});
      return json({ok:true,images:await getRows(product,variant)});
    }
    if(body.action==='reorder'){
      const product=cleanId(body.product_id),variant=cleanId(body.variant_id),ids=Array.isArray(body.ids)?body.ids:[];
      for(let i=0;i<ids.length;i++) await sb(`/rest/v1/product_gallery_images?id=eq.${encodeURIComponent(String(ids[i]))}&adin_product_id=eq.${encodeURIComponent(product)}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({sort_order:i})});
      return json({ok:true,images:await getRows(product,variant)});
    }
    return json({error:'عملیات ناشناخته است.'},400);
  }catch(e){return json({error:e?.message||'خطای سرور در مدیریت تصاویر.'},500)}
};
