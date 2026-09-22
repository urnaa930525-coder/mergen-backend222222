(function () {
  var script = document.currentScript;
  var widgetKey = script.getAttribute('data-widget-key');
  var apiBase = script.getAttribute('data-api-base') || (script.src.split('/widget.js')[0]);
  if (!widgetKey) { console.error('Mergen widget: data-widget-key шаардлагатай'); return; }

  var sessionId = localStorage.getItem('mergen_session_' + widgetKey);
  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).slice(2) + Date.now();
    localStorage.setItem('mergen_session_' + widgetKey, sessionId);
  }

  var bubble = document.createElement('div');
  bubble.innerHTML = '💬';
  bubble.style.cssText = 'position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.25);z-index:999999;';

  var panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;bottom:88px;right:20px;width:340px;max-width:92vw;height:460px;max-height:70vh;background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.25);display:none;flex-direction:column;overflow:hidden;z-index:999999;font-family:sans-serif;';

  var header = document.createElement('div');
  header.style.cssText = 'background:#111;color:#fff;padding:14px 16px;font-weight:600;';
  header.textContent = 'Mergen AI';

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
  panel.appendChild(header);
  panel.appendChild(messagesEl);
  panel.appendChild(inputRow);
  document.body.appendChild(bubble);
  document.body.appendChild(panel);

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
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') send();
  });
})();
