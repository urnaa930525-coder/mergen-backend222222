# Mergen.ai backend

Олон хэлтэй AI харилцагчийн үйлчилгээний SaaS платформ. Бизнесүүд бүртгүүлж, өөрийн мэдлэгийн санг оруулаад, вэбсайт дээрээ chat widget суулгана.

## Байгуулалт

Бүх файл нэг л түвшинд, дэд хавтасгүй (GitHub-ийн "Add file > Upload files"-аар upload хийхэд folder бүтэц алдагдахаас сэргийлж ингэж зохион байгуулав).

**Сервер (Node.js / Express):**
- `server.js` — үндсэн сервер, route холболт, статик хуудсууд
- `db.js` — Postgres схем (`initDb`), багцын тодорхойлолт (`PLANS`)
- `auth.js`, `authMiddleware.js`, `team.js` — бүртгэл/нэвтрэх, эзэмшигч/ажилтны эрх
- `agent.js`, `chat.js`, `claude.js` — AI agent, chat widget-ийн хариулт, Claude API + token тооцоо
- `social.js`, `oauth.js` — Facebook/Instagram коммент webhook, TrollGuard, нэг товчит Facebook холболт
- `marketing.js`, `sms.js` — пост товлолт, Ads boost, SMS
- `customers.js`, `orders.js`, `analytics.js` — CRM, бүтээгдэхүүн/захиалга, тайлан
- `site.js` — вэбсайт угсрагчийн API + нийтлэгдсэн сайтын render
- `billing.js`, `qpay.js`, `planMiddleware.js` — QPay төлбөр, referral, багцын хязгаарлалт
- `templates.js`, `namegen.js`, `contentgen.js`, `palette.js`, `media.js` — бизнесийн загвар, нэр/лого болон пост зураг үүсгэгч, зураг хадгалалт

**Frontend (статик):**
- `index.html` — нүүр хуудас (цайвар цэнхэр загвар), `hero-woman.jpg` — hero зураг
- `dashboard.html`, `builder.html`, `namegen.html`, `contentgen.html`
- `widget.js` — бизнесийн сайтад буулгах chat/дэлгүүр widget

**Анхаар:** GitHub дээр upload хийхдээ энэ хавтасан дахь БҮХ файлыг (dot файл `.env.example`, `.gitignore`, мөн `hero-woman.jpg` зургийг оролцуулаад) нэг дор сонгож чирж upload хийнэ үү.

## Deploy хийх алхмууд (Render + GitHub)

1. Энэ хавтасыг GitHub дээр шинэ repo болгон push хийнэ (жишээ нь `mergen-ai-backend`).
2. Render.com дээр **New > Web Service** үүсгэж, дээрх GitHub repo-той холбоно.
   - Build command: `npm install`
   - Start command: `npm start`
3. Render дээр **New > PostgreSQL** үүсгэж, түүний Internal Database URL-г хуулна.
4. Web Service-ийн Environment tab дээр дараах env variable-үүдийг нэмнэ (жишээг `.env.example`-с харна уу):
   - **Заавал:** `DATABASE_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `APP_BASE_URL` (өөрийн Render URL)
   - **Facebook/Instagram холболт:** `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `META_VERIFY_TOKEN`
   - **QPay төлбөр:** `QPAY_CLIENT_ID`, `QPAY_CLIENT_SECRET`, `QPAY_INVOICE_CODE`, `QPAY_BASE_URL` (production: `https://merchant.qpay.mn`)
   - **Пост товлолтын cron:** `CRON_SECRET` (cron-job.org-оос `/api/marketing/cron/publish-due?secret=<CRON_SECRET>` хаягийг 5 минут тутам дуудуулна)
   - **SMS (сонголт):** `SMS_API_KEY`, `SMS_API_URL`, `SMS_SENDER_ID`
5. Deploy хийсний дараа `https://<таны-service>.onrender.com` хаягаар dashboard нээгдэнэ.

## Ашиглах дараалал

1. Dashboard дээр бизнесийн бүртгэл үүсгэнэ.
2. "Мэдлэгийн сан" хэсэгт бизнесийн тухай мэдээлэл (FAQ, цагийн хуваарь, үнэ гэх мэт) бичиж хадгална.
3. Гарч ирэх `<script>` кодыг харилцагчийн вэбсайт дээр буулгана — chat bubble автоматаар гарч ирнэ.

## Багц/Үнийн бүтэц (agent тоо + сарын token хязгаар)

Багц бүр **agent-ийн тоо**гоор болон **сарын AI token хэрэглээ**гээр ялгагдана (`db.js`-ийн `PLANS` объектод тохируулна). "Token" гэдэг нь Claude API-д бодитоор зарцуулагдсан input+output token — chat, коммент ангилалт, автомат хариулт бүрийн зардлыг шууд хэмждэг.

| Багц | Agent-ийн тоо | Сарын token хязгаар | Үнэ |
|---|---|---|---|
| Start | 1 | 300,000 | 49,900₮/сар |
| Business | 3 | 1,200,000 | 129,900₮/сар |
| Enterprise | 10 | 5,000,000 | 349,900₮/сар |

- `GET /api/agent/plan` — одоогийн багц, ашигласан/боломжтой agent тоо, **энэ сарын token хэрэглээ**
- `POST /api/agent` — шинэ agent үүсгэх (багцын хязгаараас давбал алдаа буцаана)
- `GET /api/agent`, `PUT /api/agent/:id`, `DELETE /api/agent/:id` — agent-уудыг удирдах
- Anket бүр өөрийн `widget_key`-тэй тул нэг бизнес олон вэбсайт/хуудсанд өөр өөр agent суулгаж болно
- `claude.js`-ийн `recordTokenUsage()` нь `token_usage` хүснэгтэд сар бүрээр хуримтлуулж бичдэг; `isOverTokenLimit()` нь chat (`chat.js`) болон коммент автоматжуулалт (`social.js`) дуудагдах бүрд шалгаж, хязгаар дүүрсэн бол AI дуудахгүйгээр эелдэг мессеж буцаана (chat) эсвэл юу ч хийхгүй өнгөрнө (коммент)
- Dashboard дээр progress bar-аар харагдаж, 90%-иас дээш дүүрвэл анхааруулга гарна
- Сар бүр `year_month` (`2026-09` гэх мэт) шинээр эхэлдэг тул тоолуур автоматаар шинэчлэгдэнэ

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
- `GET /api/orders/public/:widgetKey/products`, `POST /api/orders/public/:widgetKey/orders` — chat widget-ийн 🛍️ Дэлгүүр таб-аас шууд ашигладаг public endpoint
- `GET /api/site/public/:slug/products`, `POST /api/site/public/:slug/orders` — site builder-ийн "Дэлгүүр" блокоос ашигладаг, slug-аар key хийсэн public endpoint

### Widget/сайт дээрх checkout урсгал

- **Chat widget** (`widget.js`) — header дээрх 💬/🛍️ таб-аар chat болон дэлгүүрийн хооронд шилжинэ. Дэлгүүр таб бүтээгдэхүүн жагсаалт харуулж, сагслаад "Захиалах" дарахад нэр/утас бөглөх маягт гарч, захиалга шууд `orders`/`order_items`-д бичигдэнэ.
- **Site builder** (`builder.html`) — палитр дээр "🛍 Дэлгүүр" блок нэмэгдсэн. Уг блокийг canvas дээр чирж оруулахад тохиргоо шаардахгүй; нийтлэгдсэн сайт дээр тухайн бизнесийн бүх нөөцтэй бүтээгдэхүүн автоматаар харагдаж, дараа нь захиалгын модал гарна.
- Хоёулаа `products`/`orders`/`order_items` хүснэгтийг шууд ашигладаг тул Dashboard-ийн "Захиалгууд" хэсэгт нэг дороос харагдана.

Dashboard дээр бүтээгдэхүүн нэмэх, захиалгын жагсаалт харах, төлөв солих боломжтой.

## Багийн гишүүд (team.js)

Нэг бизнес дор олон хэрэглэгч нэвтэрч ажиллаж болно:
- **Owner** (`businesses` хүснэгтэд бүртгэлтэй) — бүх зүйлд хандах эрхтэй, `team_members` нэмэх/хасах, багц шинэчлэх (QPay), Facebook/Instagram холбох эрхтэй ганц хүн
- **Staff** (`team_members` хүснэгтэд бүртгэлтэй, owner-оор үүсгэгддэг) — chat/CRM/захиалга/маркетинг/тайлангийн хэсгүүдийг owner-той ижил ашиглана, гэхдээ багц/төлбөр, гишүүд, social холболтыг өөрчлөх эрхгүй

JWT дотор `role: 'owner' | 'staff'` хадгалагдаж, `authMiddleware.js`-ийн `requireOwner` middleware нь эзэмшигчийн эрх шаардсан route-уудыг (billing, social connect, team удирдлага) хамгаална. Login endpoint (`/api/auth/login`) эхлээд `businesses`, олдохгүй бол `team_members` хүснэгтээс шалгадаг тул нэвтрэх маягт ижил хэвээр байна — зөвхөн email/нууц үгээрээ ялгарна.

## Нүүр хуудасны загвар (index.html)

Цайвар цэнхэр, дулаан өнгөний загвар (цагаан дэвсгэр, цэнхэр товч, улбар шар accent). Hero хэсгийн зураг `hero-woman.jpg` нь `server.js`-ийн `/hero-woman.jpg` route-оор serve хийгддэг. Зургийг солихыг хүсвэл ижил нэртэй файлыг (3:4 харьцаатай, ~900px өргөн, <150KB) overwrite хийхэд хангалттай. Зураг нь AI-аар үүсгэсэн жишээ дүрслэл гэж тооцсон тул жинхэнэ хэрэглэгчийн сэтгэгдэл мэтээр харагдуулаагүй — хэрэв жинхэнэ хүний зураг болох нь тогтоогдвол тухайн хүний зөвшөөрөл шаардлагатай.

## Нэр + Лого санал болгогч (namegen.js, Namelix-загвар)

`/namegen.html` — public хуудас (нэвтрэлт шаардахгүй, лавлагаа/lead-gen хэрэгсэл): хэрэглэгч бизнесийнхээ санааг бичихэд, AI (Claude) 8 нэр + товч тодорхойлолт санал болгож, тус бүрт нь энгийн геометр лого (өнгө, дүрс, эхний үсэг) программаар үүсгэнэ (зураг үүсгэдэг AI ашигладаггүй, зөвхөн CSS/SVG). "Энэ нэрээр эхлэх" дарахад `/dashboard.html?bizname=<нэр>`-рүү шилжиж, бүртгэлийн маягтад нэрийг автоматаар бөглөнө.

- `POST /api/namegen/generate` — public endpoint, IP тутамд цагт 15 хүсэлтээр хязгаарласан (`namegen.js`-ийн `RATE_LIMIT`), учир нь энэ нь ямар ч businessId-д холбогдоогүй тул Mergen-ийн өөрийн Anthropic API төсвөөс шууд зарцуулагддаг — token хэрэглээний хязгаарт (`isOverTokenLimit`) хамаарахгүй тул хэрэглээгээ анхаарч ажиглах хэрэгтэй
- Лого нь зөвхөн урьдчилан тодорхойлсон 8 өнгөний хослол, 3 дүрс (дугуй/дугуйруулсан дөрвөлжин/зургаан өнцөгт) хооронд эргэлддэг — жинхэнэ зураг үүсгэдэггүй
- Өнгөний жагсаалт `palette.js`-д гаргасан бөгөөд `contentgen.js`-тэй хуваалцдаг

## Пост зураг үүсгэгч (contentgen.js)

`/contentgen.html` — public хуудас: хэрэглэгч постын санаагаа бичихэд, AI товч **headline** (гарчиг) болон **subtext** (тодруулга) зохиож, browser талд `<canvas>` ашиглан 1080×1080 градиент постер зурж, **PNG татаж авах** боломж олгоно. Зураг үүсгэдэг AI ашигладаггүй — зөвхөн текст зохиолт AI-гаар, зураглалыг канвасаар хийдэг.

- `POST /api/contentgen/generate` — public endpoint, мөн IP тутамд цагт 15 хүсэлтээр хязгаарласан
- **"📅 Шууд пост болгож товлох"** товч дарвал зургийг `media.js`-ээр дамжуулан Postgres-д (`generated_media` хүснэгт, `BYTEA`) хадгалж, бодит URL (`/api/media/:id.png`) үүсгэнэ, дараа нь `/dashboard.html?media=<url>&caption=<текст>` руу шилжиж, Пост товлолтын маягтад зураг+гарчгийг автоматаар бөглөнө. Тэндээс огноо/цаг сонгоод "Товлох" дарахад л хангалттай.
- "PNG татах" товч хуучин шигээ локал татаж авах боломжийг мөн үлдээсэн (гараар өөр газар байршуулах хүсвэл)

## Бизнесийн төрлөөр бэлэн загвар (templates.js)

Бүртгүүлэх маягт дээр "Бизнесийн төрөл" сонгож болно: Ресторан/Кафе, Гоо сайхан/Салон, Дэлгүүр/Худалдаа, Эмнэлэг/Клиник, Бусад үйлчилгээ. Сонгосон төрлөөр анхны agent-ийн `agent_name`, `welcome_message`, `knowledge_base` автоматаар бэлдэгдэж (бизнесийн нэрийг оруулан), owner-ийг хоосон талбараас эхлэхгүйгээр шууд засварлаж эхлэх боломж олгоно. `GET /api/templates` нь жагсаалтыг буцаадаг public endpoint; шинэ төрөл нэмэхийг хүсвэл `templates.js`-ийн `TEMPLATES` объектод шинэ key нэмнэ.

## Referral (зөвлөсний) систем

Бизнес бүр өөрийн `referral_code`-той (бүртгүүлэх/нэвтрэх үед автоматаар үүсдэг). Dashboard дээр өөрийн зөвлөх линкээ (`/dashboard.html?ref=<код>`) хуулж, найздаа явуулна.

- Шинэ бизнес тэр линкээр бүртгүүлбэл, `businesses.referred_by`-д зөвлөсөн хүний ID хадгалагдана
- Тухайн шинэ бизнесийн **эхний амжилттай QPay төлбөр** орохоор (`billing.js`-ийн `markInvoicePaid`), зөвлөсөн хүнд төлбөрийн дүнгийн **20%**-ийг `credit_balance`-д нэмнэ
- Дараагийн удаа тухайн (зөвлөсөн) бизнес багц шинэчлэхэд, credit_balance байгаа хэмжээгээр QPay invoice-ийн дүн **автоматаар хасагдана** (`create-invoice`); credit нь үнийг бүтнээр нь хучвал QPay-гүйгээр шууд upgrade хийгдэнэ. Credit нь invoice **үүсгэх үед нөөцлөгддөг** (нэг credit хоёр invoice-д хэрэглэгдэхгүй); шинэ invoice үүсгэхэд өмнөх pending invoice цуцлагдаж, түүний credit буцаж нэмэгдэнэ. Төлбөрийг dashboard-ийн poll болон QPay-ийн webhook хоёр зэрэг баталгаажуулсан ч шагнал/upgrade зөвхөн нэг удаа (атомар) хийгдэнэ
- Дараах давталтыг сэргийлэхийн тулд шагнал зөвхөн **анхны төлбөр**-т л олгогдоно (сар бүрийн шинэчлэлт дээр биш)
- Шагналаа хоёр янзаар ашиглаж болно:
  1. **Мөнгөн хэлбэрээр** үлдээх — дараагийн багц шинэчлэлт дээр автоматаар хасагдана (дээрх дараалал)
  2. **Token болгож хөрвүүлэх** — `POST /api/billing/convert-credit` (`1₮ = 20 token` тогтмол ханшаар) — `businesses.bonus_tokens`-д нэмэгдэнэ. Bonus token нь сарын хязгаараас **гадна**, эхэлж зарцуулагддаг тусдаа сан (`claude.js`-ийн `recordTokenUsage`/`isOverTokenLimit` эхлээд bonus_tokens-ээс хасаж, дуусмагц л сарын хязгаарт хамаарна)
- Owner дашбоард дээрээ хэдийг нь хэрхэн ашиглахаа өөрөө сонгоно — заавал бүгдийг нэг зэрэг хөрвүүлэх шаардлагагүй, дур зоргоороо хэсэгчлэн хийж болно

## Дараагийн шатанд нэмж болох зүйлс

- QPay Quick (vendor/marketplace) эрх авбал, харилцагчдын өөрийн QPay акаунт үүсгэх боломж
- Файл (PDF/DOCX) оруулаад мэдлэгийн сан болгож хувиргах
- Тусгай домэйн холбох (жишээ нь mergen.ai)
- И-мэйл мэдэгдэл (шинэ захиалга/lead ирэхэд)
