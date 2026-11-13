// Secure, same-origin proxy for the Adin API. The API key never reaches the browser.
const API_URL = Netlify.env.get("ADIN_API_URL") || "https://adinapp.ir/api/api.php";
const ALLOWED = new Set(["ping", "spec", "get_products", "get_product", "get_skus", "check_stock"]);
const json = (data, status=200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
export default async (request) => {
  if (request.method !== "POST") return json({result:"error", message:"Method not allowed"},405);
  const key = Netlify.env.get("ADIN_API_KEY");
  if (!key) return json({result:"error", message:"ADIN_API_KEY در تنظیمات Netlify تعریف نشده است."},503);
  let input;
  try { input = await request.json(); } catch { return json({result:"error",message:"بدنه درخواست JSON معتبر نیست."},400); }
  const action = String(input?.action || "");
  if (!ALLOWED.has(action)) return json({result:"error",message:"این عملیات از مسیر فروشگاه مجاز نیست."},400);
  const params = input?.params && typeof input.params === "object" ? input.params : {};
  const payload = {...params, action};
  if (action === "get_products" || action === "get_skus") {
    payload.limit = Math.min(Math.max(Number(payload.limit)||500,1),500);
    payload.page = Math.max(Number(payload.page)||1,1);
    if (action === "get_products" || action === "get_skus") payload.with_inventory = 1;
    if (action === "get_products") payload.with_skus = 1;
  }
  try {
    let target = API_URL, method = "POST", body = JSON.stringify(payload);
    // Adin documents get_products/get_product/get_skus as GET endpoints.
    if (["get_products", "get_product", "get_skus", "ping", "spec"].includes(action)) {
      const u = new URL(API_URL);
      Object.entries(payload).forEach(([k,v]) => u.searchParams.set(k, typeof v === "string" ? v : String(v)));
      target = u.toString(); method = "GET"; body = undefined;
    }
    const upstream = await fetch(target, {
      method,
      headers: {"Authorization": `Bearer ${key}`, "Accept":"application/json", ...(body ? {"Content-Type":"application/json"} : {})},
      ...(body ? {body} : {}), signal: AbortSignal.timeout(25000)
    });
    const raw = await upstream.text();
    let data; try { data=JSON.parse(raw); } catch { return json({result:"error",message:"پاسخ آدین JSON معتبر نیست."},502); }
    return json(data, upstream.ok ? 200 : upstream.status);
  } catch (e) {
    return json({result:"error",message:"ارتباط سرور با آدین ناموفق بود.",detail:e?.name==="TimeoutError"?"timeout":"upstream_error"},502);
  }
};
