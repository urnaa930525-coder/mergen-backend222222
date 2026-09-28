(function () {
  var script = document.currentScript;
  var widgetKey = script.getAttribute('data-widget-key');
  var apiBase = script.getAttribute('data-api-base') || (script.src.split('/widget.js')[0]);
  if (!widgetKey) { console.error('Mergen widget: data-widget-key шаардлагатай'); return; }

  // localStorage can throw (Safari private mode, blocked third-party storage, sandboxed iframes) —
  // never let that take the whole widget down; fall back to an in-memory session id.
  var sessionKey = 'mergen_session_' + widgetKey;
  var sessionId = null;
  try { sessionId = window.localStorage.getItem(sessionKey); } catch (e) { sessionId = null; }
  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).slice(2) + Date.now();
    try { window.localStorage.setItem(sessionKey, sessionId); } catch (e) { /* keep in memory only */ }
  }

  var cart = []; // [{ id, name, price, quantity }]
  var products = null; // lazy-loaded
  var view = 'chat'; // 'chat' | 'shop' | 'checkout'

  var bubble = document.createElement('div');
  bubble.innerHTML = '💬';
  bubble.style.cssText = 'position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.25);z-index:999999;';

  var panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;bottom:88px;right:20px;width:340px;max-width:92vw;height:480px;max-height:72vh;background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.25);display:none;flex-direction:column;overflow:hidden;z-index:999999;font-family:sans-serif;';

  var header = document.createElement('div');
  header.style.cssText = 'background:#111;color:#fff;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;';
  var headerTitle = document.createElement('div');
  headerTitle.textContent = 'Mergen AI';
  headerTitle.style.cssText = 'font-weight:600;';
  var tabRow = document.createElement('div');
  tabRow.style.cssText = 'display:flex;gap:6px;';
  var chatTabBtn = document.createElement('button');
  chatTabBtn.textContent = '💬';
  var shopTabBtn = document.createElement('button');
  shopTabBtn.textContent = '🛍️';
  [chatTabBtn, shopTabBtn].forEach(function (b) {
    b.style.cssText = 'background:transparent;border:1px solid rgba(255,255,255,0.3);color:#fff;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:13px;';
  });
  tabRow.appendChild(chatTabBtn);
  tabRow.appendChild(shopTabBtn);
  header.appendChild(headerTitle);
  header.appendChild(tabRow);

  // ---- Chat view ----
  var chatView = document.createElement('div');
  chatView.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';
  var messagesEl = document.createElement('div');
  messagesEl.style.cssText = 'flex:1;overflow-y:auto;padding:12px;font-size:14px;';
  var inputRow = document.createElement('div');
  inputRow.style.cssText = 'display:flex;border-top:1px solid #eee;';
  var input = document.createElement('input');
  input.placeholder = 'Бичих...';
  input.style.cssText = 'flex:1;border:none;padding:12px;font-size:14px;outline:none;';
  var sendBtn = document.createElement('button');
  sendBtn.textContent = 'Илгээх';
  sendBtn.style.cssText = 'border:none;background:#111;color:#fff;padding:0 16px;cursor:pointer;';
  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);
  chatView.appendChild(messagesEl);
  chatView.appendChild(inputRow);

  // ---- Shop view ----
  var shopView = document.createElement('div');
  shopView.style.cssText = 'flex:1;display:none;flex-direction:column;overflow:hidden;';
  var shopList = document.createElement('div');
  shopList.style.cssText = 'flex:1;overflow-y:auto;padding:12px;font-size:13px;';
  var cartBar = document.createElement('div');
  cartBar.style.cssText = 'border-top:1px solid #eee;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;font-size:13px;';
  var cartLabel = document.createElement('div');
  var checkoutBtn = document.createElement('button');
  checkoutBtn.textContent = 'Захиалах';
  checkoutBtn.style.cssText = 'border:none;background:#111;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;';
  cartBar.appendChild(cartLabel);
  cartBar.appendChild(checkoutBtn);
  shopView.appendChild(shopList);
  shopView.appendChild(cartBar);

  // ---- Checkout view ----
  var checkoutView = document.createElement('div');
  checkoutView.style.cssText = 'flex:1;display:none;flex-direction:column;overflow-y:auto;padding:14px;font-size:13px;gap:8px;';
  checkoutView.innerHTML =
    '<div style="font-weight:600;margin-bottom:6px;">Захиалгын мэдээлэл</div>' +
    '<div id="mergenCartSummary" style="margin-bottom:10px;color:#555;"></div>' +
    '<label style="font-size:12px;color:#777;">Нэр</label>' +
    '<input id="mergenCustName" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;margin-bottom:8px;box-sizing:border-box;" />' +
    '<label style="font-size:12px;color:#777;">Утас</label>' +
    '<input id="mergenCustPhone" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;margin-bottom:8px;box-sizing:border-box;" />' +
    '<label style="font-size:12px;color:#777;">Тэмдэглэл (сонголт)</label>' +
    '<textarea id="mergenCustNotes" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;margin-bottom:10px;box-sizing:border-box;min-height:50px;"></textarea>' +
    '<button id="mergenSubmitOrder" style="border:none;background:#111;color:#fff;padding:10px;border-radius:6px;cursor:pointer;font-weight:600;">Захиалга илгээх</button>' +
    '<div id="mergenOrderMsg" style="margin-top:8px;"></div>' +
    '<button id="mergenBackToShop" style="border:none;background:transparent;color:#777;padding:8px;cursor:pointer;text-decoration:underline;">← Буцах</button>';

  panel.appendChild(header);
  panel.appendChild(chatView);
  panel.appendChild(shopView);
  panel.appendChild(checkoutView);
  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  function setView(v) {
    view = v;
    chatView.style.display = v === 'chat' ? 'flex' : 'none';
    shopView.style.display = v === 'shop' ? 'flex' : 'none';
    checkoutView.style.display = v === 'checkout' ? 'flex' : 'none';
    if (v === 'shop' && !products) loadProducts();
  }
  chatTabBtn.addEventListener('click', function () { setView('chat'); });
  shopTabBtn.addEventListener('click', function () { setView('shop'); });

  function addMessage(role, text) {
    var row = document.createElement('div');
    row.style.cssText = 'margin-bottom:8px;display:flex;' + (role === 'user' ? 'justify-content:flex-end;' : '');
    var bubbleEl = document.createElement('div');
    bubbleEl.style.cssText = 'max-width:80%;padding:8px 12px;border-radius:12px;white-space:pre-wrap;' +
      (role === 'user' ? 'background:#111;color:#fff;' : 'background:#f1f1f1;color:#111;');
    bubbleEl.textContent = text;
    row.appendChild(bubbleEl);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  var greeted = false;
  bubble.addEventListener('click', function () {
    var opening = panel.style.display === 'none' || panel.style.display === '';
    panel.style.display = opening ? 'flex' : 'none';
    if (opening && !greeted) {
      greeted = true;
      addMessage('assistant', 'Сайн байна уу! Танд юугаар туслах вэ?');
    }
  });

  function send() {
    var text = input.value.trim();
    if (!text) return;
    addMessage('user', text);
    input.value = '';
    fetch(apiBase + '/api/chat/' + widgetKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, message: text }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        addMessage('assistant', data.reply || 'Уучлаарай, алдаа гарлаа.');
      })
      .catch(function () {
        addMessage('assistant', 'Сүлжээний алдаа гарлаа. Дахин оролдоно уу.');
      });
  }
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });

  // ---- Shop logic ----
  function loadProducts() {
    shopList.innerHTML = '<div style="color:#999;">Ачааллаж байна...</div>';
    fetch(apiBase + '/api/orders/public/' + widgetKey + '/products')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        products = data.products || [];
        renderShop();
      })
      .catch(function () {
        shopList.innerHTML = '<div style="color:#999;">Ачаалахад алдаа гарлаа.</div>';
      });
  }

  function renderShop() {
    shopList.innerHTML = '';
    if (products.length === 0) {
      shopList.innerHTML = '<div style="color:#999;">Одоогоор бүтээгдэхүүн байхгүй байна.</div>';
    }
    products.forEach(function (p) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f0f0f0;gap:8px;';
      var info = document.createElement('div');
      info.innerHTML = '<div style="font-weight:600;">' + escapeHtml(p.name) + '</div><div style="color:#777;">' + Number(p.price).toLocaleString() + '₮</div>';
      var addBtn = document.createElement('button');
      addBtn.textContent = '+ Сагс';
      addBtn.style.cssText = 'border:none;background:#111;color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12px;';
      addBtn.addEventListener('click', function () { addToCart(p); });
      row.appendChild(info);
      row.appendChild(addBtn);
      shopList.appendChild(row);
    });
    updateCartBar();
  }

  function addToCart(p) {
    var existing = cart.find(function (i) { return i.id === p.id; });
    if (existing) { existing.quantity += 1; } else { cart.push({ id: p.id, name: p.name, price: p.price, quantity: 1 }); }
    updateCartBar();
  }

  function updateCartBar() {
    var count = cart.reduce(function (s, i) { return s + i.quantity; }, 0);
    var total = cart.reduce(function (s, i) { return s + i.quantity * Number(i.price); }, 0);
    cartLabel.textContent = count > 0 ? (count + ' ширхэг — ' + total.toLocaleString() + '₮') : 'Сагс хоосон';
    checkoutBtn.disabled = count === 0;
    checkoutBtn.style.opacity = count === 0 ? '0.5' : '1';
  }

  checkoutBtn.addEventListener('click', function () {
    if (cart.length === 0) return;
    document.getElementById('mergenCartSummary').innerHTML = cart
      .map(function (i) { return i.name + ' ×' + i.quantity + ' — ' + (i.price * i.quantity).toLocaleString() + '₮'; })
      .join('<br/>');
    setView('checkout');
  });

  checkoutView.querySelector('#mergenBackToShop').addEventListener('click', function () { setView('shop'); });

  checkoutView.querySelector('#mergenSubmitOrder').addEventListener('click', function () {
    var name = document.getElementById('mergenCustName').value.trim();
    var phone = document.getElementById('mergenCustPhone').value.trim();
    var notes = document.getElementById('mergenCustNotes').value.trim();
    var msgEl = document.getElementById('mergenOrderMsg');
    if (!name || !phone) { msgEl.innerHTML = '<span style="color:#c0392b;">Нэр, утасны дугаараа бөглөнө үү.</span>'; return; }

    fetch(apiBase + '/api/orders/public/' + widgetKey + '/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: name,
        customer_phone: phone,
        notes: notes,
        items: cart.map(function (i) { return { product_name: i.name, price: i.price, quantity: i.quantity }; }),
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          msgEl.innerHTML = '<span style="color:#1a7d3c;">Захиалга амжилттай илгээгдлээ ✓</span>';
          cart = [];
          updateCartBar();
          setTimeout(function () { setView('shop'); renderShop(); }, 1500);
        } else {
          msgEl.innerHTML = '<span style="color:#c0392b;">' + (data.error || 'Алдаа гарлаа') + '</span>';
        }
      })
      .catch(function () {
        msgEl.innerHTML = '<span style="color:#c0392b;">Сүлжээний алдаа гарлаа.</span>';
      });
  });

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
})();
