# Mergen.ai backend

Олон хэлтэй AI харилцагчийн үйлчилгээний SaaS платформ. Бизнесүүд бүртгүүлж, өөрийн мэдлэгийн санг оруулаад, вэбсайт дээрээ chat widget суулгана.

## Байгуулалт

Бүх файл нэг л түвшинд, дэд хавтасгүй (GitHub-ийн "Add file > Upload files" функцээр shalgaж дарж upload хийхэд folder бүтэц алдагдахаас сэргийлж ингэж зохион байгуулав):

- `server.js` — Express сервер
- `db.js` — Postgres схем
- `auth.js` — бүртгэл/нэвтрэх route
- `agent.js` — agent тохиргоо, харилцан ярианы түүх, багц (plan) route
- `chat.js` — widget-ээс ирэх chat хүсэлт, Claude API дуудна
- `social.js` — Instagram/Facebook коммент webhook, TrollGuard
- `authMiddleware.js` — JWT баталгаажуулалт
- `claude.js` — Claude API дуудах туслах функц
- `index.html` — landing page
- `dashboard.html` — dashboard (signup/login, agent тохиргоо)
- `widget.js` — бизнесүүдийн сайтад буулгах embed script

**Анхаар:** GitHub дээр upload хийхдээ энэ хавтасан дахь БҮХ файлыг (dot файл `.env.example`, `.gitignore` оролцуулаад) нэг дор сонгож чирж upload хийнэ үү — тусад нь дараалан биш.

## Deploy хийх алхмууд (Render + GitHub)

1. Энэ хавтасыг GitHub дээр шинэ repo болгон push хийнэ (жишээ нь `mergen-ai-backend`).
2. Render.com дээр **New > Web Service** үүсгэж, дээрх GitHub repo-той холбоно.
   - Build command: `npm install`
   - Start command: `npm start`
3. Render дээр **New > PostgreSQL** үүсгэж, түүний Internal Database URL-г хуулна.
4. Web Service-ийн Environment tab дээр дараах env variable-үүдийг нэмнэ:
   - `DATABASE_URL` — Postgres-ийн холболтын URL
   - `JWT_SECRET` — санамсаргүй урт тэмдэгт мөр
   - `ANTHROPIC_API_KEY` — Anthropic Console-оос авсан API key
5. Deploy хийсний дараа `https://<таны-service>.onrender.com` хаягаар dashboard нээгдэнэ.

## Ашиглах дараалал

1. Dashboard дээр бизнесийн бүртгэл үүсгэнэ.
2. "Мэдлэгийн сан" хэсэгт бизнесийн тухай мэдээлэл (FAQ, цагийн хуваарь, үнэ гэх мэт) бичиж хадгална.
3. Гарч ирэх `<script>` кодыг харилцагчийн вэбсайт дээр буулгана — chat bubble автоматаар гарч ирнэ.

## Багц/Үнийн бүтэц (agent тоогоор)

Хэрэглээ хязгааргүй — зөвхөн зэрэг ажиллуулах **agent-ийн тоо**гоор ялгагдана (`db.js`-ийн `PLANS` объектод тохируулна):

| Багц | Agent-ийн тоо | Үнэ |
|---|---|---|
| Start | 1 | 49,900₮/сар |
| Business | 3 | 129,900₮/сар |
| Enterprise | 10 | 349,900₮/сар |

- `GET /api/agent/plan` — одоогийн багц, ашигласан/боломжтой agent тоо
- `POST /api/agent` — шинэ agent үүсгэх (багцын хязгаараас давбал алдаа буцаана)
- `GET /api/agent`, `PUT /api/agent/:id`, `DELETE /api/agent/:id` — agent-уудыг удирдах
- Anket бүр өөрийн `widget_key`-тэй тул нэг бизнес олон вэбсайт/хуудсанд өөр өөр agent суулгаж болно

### Багц шинэчлэх — QPay төлбөр (`billing.js`)

Dashboard дээрх "Багц шинэчлэх" товч дарахад QPay invoice үүсэж, QR код гарч ирнэ. Төлбөр орсныг 4 секунд тутам автоматаар шалгаж (`GET /api/billing/check/:id`), мөн QPay callback ирэхэд шууд (`POST /api/billing/webhook`) `businesses.plan`-г автоматаар шинэчилнэ.

**Бэлтгэл (QPay Merchant эрх):**
1. info@qpay.mn хаягаар холбогдож, OAuth 2.0 `client_id`/`client_secret` болон `invoice_code`-оо авна (энгийн merchant эрх — зөвхөн Mergen-ийн өөрийн төлбөрт зориулагдсан).
2. Render дээр Environment tab-д нэмнэ: `QPAY_CLIENT_ID`, `QPAY_CLIENT_SECRET`, `QPAY_INVOICE_CODE`.
3. Эхлээд sandbox орчинд (`QPAY_BASE_URL=https://merchant-sandbox.qpay.mn`, өгөгдмөл утга) туршиж, бэлэн болмогц production URL руу сольж болно.

Ирээдүйд "QPay Quick" (vendor/marketplace API) эрх авбал, харилцагч бизнесүүд Mergen дотроосоо шууд өөрсдийн QPay акаунтаа үүсгэх боломж нэмж болно.

## Коммент автоматжуулалт + TrollGuard (Instagram/Facebook)

`routes/social.js` нь Instagram/Facebook коммент-ийг автоматаар боловсруулна:
- Троль/спам коммент илрэвэл автоматаар **нуух** (`hide=true`)
- Жинхэнэ асуулт бол мэдлэгийн санд тулгуурлан **автомат хариулах**
- Бүх шийдвэрийг `comment_logs` хүснэгтэд хадгална

### Meta талд хийх бэлтгэл (заавал шаардлагатай)

**Нэг товчит холболт (санал болгож буй арга):**
1. [developers.facebook.com](https://developers.facebook.com) дээр App үүсгэнэ (Business type).
2. App-даа **Facebook Login** product-г нэмнэ.
3. Settings → Valid OAuth Redirect URIs хэсэгт нэмнэ: `https://<таны-render-url>/oauth/facebook/callback`
4. App Dashboard → Settings → Basic хэсгээс **App ID** болон **App Secret**-ээ авна.
5. Render дээрх Environment tab-д нэмнэ: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `APP_BASE_URL` (жишээ нь `https://mergen-backend2.onrender.com`).
6. Webhooks product нэмж, Instagram/Page объект дээр `comments` field-г subscribe хийнэ (Callback URL: `https://<таны-render-url>/api/social/webhook/meta`, Verify token: `.env` дэх `META_VERIFY_TOKEN`).
7. Dashboard дээрх "📘 Facebook-аар холбох" товчийг дарахад хэрэглэгч Facebook руу очиж зөвшөөрөл өгөөд буцаж ирнэ, Page ID/Access Token/Instagram Business ID автоматаар татагдана.

**Анхаар:** зөвхөн өөрийн/тестийн акаунт дээр App Review-гүйгээр ажиллуулж болно (App-аа "Development" горимд байгаа Facebook хэрэглэгчид). Бусад бизнест SaaS байдлаар зарахын тулд Meta-гийн App Review-г давж, `pages_manage_engagement`, `instagram_manage_comments` зэрэг эрхийг production горимд авах шаардлагатай (business verification + review хугацаа ~1-2 долоо хоног).

**Гараар холбох (дэвшилтэт, туршилтад):** dashboard дээрх "Дэвшилтэт: гараар холбох" хэсгээр Page ID/Access Token-оо шууд оруулж болно — Graph API Explorer-ээс гараар авсан token ашиглахад хэрэг болно.

## Захиалгын систем (Products + Orders)

`orders.js`-д бүтээгдэхүүн болон захиалгын удирдлага:
- `GET/POST/PUT/DELETE /api/orders/products` — бизнесийн бүтээгдэхүүн (нэр, үнэ, зураг, нөөцтэй эсэх)
- `GET/POST /api/orders`, `PUT /api/orders/:id/status` — захиалга үүсгэх, төлөв солих (шинэ → баталгаажсан → бэлтгэж буй → дууссан/цуцалсан)
- `GET /api/orders/public/:widgetKey/products`, `POST /api/orders/public/:widgetKey/orders` — нэвтрэлтгүй, chat widget эсвэл site builder-с шууд захиалга үүсгэхэд зориулсан public endpoint (ирээдүйд widget/site checkout урсгал холбоход бэлэн)

Dashboard дээр бүтээгдэхүүн нэмэх, захиалгын жагсаалт харах, төлөв солих боломжтой.

## Дараагийн шатанд нэмж болох зүйлс

- Widget/site builder-с шууд захиалга өгөх checkout урсгал (backend API бэлэн, frontend холболт дутуу)
- QPay Quick (vendor/marketplace) эрх авбал, харилцагчдын өөрийн QPay акаунт үүсгэх боломж
- Файл (PDF/DOCX) оруулаад мэдлэгийн сан болгож хувиргах
- Тусгай домэйн холбох (жишээ нь mergen.ai)
