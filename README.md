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

| Багц | Agent-ийн тоо | Санал үнэ |
|---|---|---|
| Start | 1 | 49,000₮/сар |
| Business | 3 | 129,000₮/сар |
| Enterprise | 10 | 349,000₮/сар |

- `GET /api/agent/plan` — одоогийн багц, ашигласан/боломжтой agent тоо
- `POST /api/agent` — шинэ agent үүсгэх (багцын хязгаараас давбал алдаа буцаана)
- `GET /api/agent`, `PUT /api/agent/:id`, `DELETE /api/agent/:id` — agent-уудыг удирдах
- Anket бүр өөрийн `widget_key`-тэй тул нэг бизнес олон вэбсайт/хуудсанд өөр өөр agent суулгаж болно

Багц шинэчлэх (upgrade) UI одоогоор дутуу — `businesses.plan`-г гараар (эсвэл дараа нэмэх QPay төлбөрийн after-hook-оор) шинэчилнэ.

## Коммент автоматжуулалт + TrollGuard (Instagram/Facebook)

`routes/social.js` нь Instagram/Facebook коммент-ийг автоматаар боловсруулна:
- Троль/спам коммент илрэвэл автоматаар **нуух** (`hide=true`)
- Жинхэнэ асуулт бол мэдлэгийн санд тулгуурлан **автомат хариулах**
- Бүх шийдвэрийг `comment_logs` хүснэгтэд хадгална

### Meta талд хийх бэлтгэл (заавал шаардлагатай)

1. [developers.facebook.com](https://developers.facebook.com) дээр App үүсгэнэ (Business type).
2. Instagram Professional акаунтаа Facebook Page-тэйгээ холбоно.
3. App-даа **Webhooks** нэмж, Instagram/Page объект дээр `comments` field-г subscribe хийнэ:
   - Callback URL: `https://<таны-render-url>/api/social/webhook/meta`
   - Verify token: `.env` дэх `META_VERIFY_TOKEN`-той адил байх ёстой
4. Long-lived Page Access Token авна (`pages_manage_engagement`, `pages_read_engagement`, `instagram_manage_comments` эрхтэй).
5. Dashboard-аас (эсвэл шууд `POST /api/social/connect`) `page_id`, `ig_business_id`, `access_token`-оо бүртгүүлнэ.

**Анхаар:** зөвхөн өөрийн/тестийн акаунт дээр App Review-гүйгээр ажиллуулж болно. Бусад бизнест SaaS байдлаар зарахын тулд Meta-гийн App Review-г давж, `instagram_manage_comments` зэрэг эрхийг production горимд авах шаардлагатай (business verification + review хугацаа ~1-2 долоо хоног).

## Дараагийн шатанд нэмж болох зүйлс

- Дэлгүүр/QPay/Хүргэлтийн интеграци (chat-аар захиалга авах)
- Social холболтын dashboard UI (одоогоор API бэлэн, frontend хэсэг дутуу)
- Олон agent (business-д хэдэн agent) дэмжлэг
- Файл (PDF/DOCX) оруулаад мэдлэгийн сан болгож хувиргах
- Тусгай домэйн холбох (жишээ нь mergen.ai)
- Тарифын төлбөрийн систем (QPay)
