(() => {
  "use strict";

  const CITY = {
    lon: { name: "ロンドン", color: "var(--lon)", light: 1 },
    par: { name: "パリ", color: "var(--par)", light: 1 },
    rom: { name: "ローマ", color: "var(--rom)", light: 0 },
    move: { name: "移動", color: "var(--move)", light: 1 },
  };
  const CAT = { sight: "観光", food: "食事", move: "移動", shop: "買い物", rest: "休憩", other: "その他" };
  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  const CACHE_KEY = "honeymoon-cache-v1";
  const PASS_KEY = "honeymoon-pass";
  const DAY_KEY = "honeymoon-day";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
  const store = {
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch (_) {
        return null;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch (_) {}
    },
    del: (k) => {
      try {
        localStorage.removeItem(k);
      } catch (_) {}
    },
  };

  const state = { trip: {}, days: [], items: [], syncedAt: null, online: navigator.onLine, canEdit: false, day: null, tab: "plan" };
  let sb = null;
  let pass = null;
  let editing = null;
  let channel = null;

  // ---------- local cache (offline viewing) ----------
  function loadCache() {
    try {
      const c = JSON.parse(store.get(CACHE_KEY) || "null");
      if (!c) return false;
      state.trip = c.trip || {};
      state.days = c.days || [];
      state.items = c.items || [];
      state.syncedAt = c.syncedAt || null;
      return state.days.length > 0;
    } catch (_) {
      return false;
    }
  }
  function saveCache() {
    store.set(CACHE_KEY, JSON.stringify({ trip: state.trip, days: state.days, items: state.items, syncedAt: state.syncedAt }));
  }

  // ---------- helpers ----------
  function dateFor(n) {
    const s = state.trip.start_date;
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d + (n - 1));
  }
  const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
  const dayList = () => [...state.days].sort((a, b) => a.n - b.n);
  const fmtTime = (iso) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const todayStart = () => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  };
  function todayDayN() {
    const d0 = dateFor(1);
    if (!d0) return null;
    const n = Math.round((todayStart() - d0) / 86400000) + 1;
    return state.days.some((d) => d.n === n) ? n : null;
  }
  function editable() {
    return state.online && state.canEdit && !!sb && !!pass;
  }

  function pickInitialDay() {
    const days = dayList();
    if (!days.length) return;
    if (state.day && days.some((d) => d.n === state.day)) return;
    const t = todayDayN();
    const saved = Number(store.get(DAY_KEY));
    state.day = t || (days.some((d) => d.n === saved) ? saved : days[0].n);
  }

  // ---------- render ----------
  function renderHeader() {
    if (document.activeElement !== $("startDate")) $("startDate").value = state.trip.start_date || "";
    const cd = $("countdown");
    const d0 = dateFor(1);
    if (d0) {
      const diff = Math.round((d0 - todayStart()) / 86400000);
      const last = dateFor(dayList().length || 9);
      cd.textContent = diff > 0 ? `出発まで ${diff}日` : todayStart() <= last ? "旅行中" : "おかえりなさい";
      cd.hidden = false;
    } else cd.hidden = true;
    $("syncInfo").textContent = state.syncedAt ? `最終同期 ${fmtTime(state.syncedAt)}` : "まだ同期していません";
  }

  function renderStatus(extra) {
    const s = $("status");
    let msg = "";
    if (!state.online) {
      msg = `オフラインで表示しています${state.syncedAt ? `（最終同期 ${fmtTime(state.syncedAt)}）` : ""}。編集は電波があるときにできます`;
    } else if (extra) {
      msg = extra.msg;
    }
    s.textContent = msg;
    s.hidden = !msg;
  }

  function renderStrip() {
    const t = todayDayN();
    $("daystrip").innerHTML = dayList()
      .map((d) => {
        const c = CITY[d.city] || CITY.move;
        const dt = dateFor(d.n);
        const cur = d.n === state.day;
        return `<button class="dchip" style="--city:${c.color}" data-light="${c.light}" data-day="${d.n}" aria-current="${cur}" aria-label="${d.n}日目 ${esc(d.route || "")}">
          <span class="dn">DAY ${d.n}</span>
          <span class="dd">${dt ? `${dt.getMonth() + 1}/${dt.getDate()}` : d.n}</span>
          <span class="dw">${dt ? WD[dt.getDay()] : esc(c.name)}</span>
          ${t === d.n ? '<span class="today">今日</span>' : ""}
        </button>`;
      })
      .join("");
  }

  function scrollStripToCurrent(smooth) {
    const el = $("daystrip").querySelector('[aria-current="true"]');
    if (!el) return;
    const strip = $("daystrip");
    const left = el.offsetLeft - strip.clientWidth / 2 + el.clientWidth / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: smooth ? "smooth" : "auto" });
  }

  function itemHtml(it) {
    const url = safeUrl(it.url);
    const cat = CAT[it.cat] ? it.cat : "other";
    const links = [];
    if (it.place)
      links.push(
        `<a class="pill" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(it.place)}" target="_blank" rel="noopener">📍<span>${esc(it.place)}</span></a>`
      );
    if (url) links.push(`<a class="pill" href="${esc(url)}" target="_blank" rel="noopener">🔗<span>リンク</span></a>`);
    const time = it.time ? `<span class="it-time">${esc(it.time)}${it.end_time ? `<span class="end"> – ${esc(it.end_time)}</span>` : ""}</span>` : "";
    return `<li class="it c-${cat}">
      <div class="it-card" data-item="${esc(it.id)}" role="button" tabindex="0">
        <div class="it-top">${time}<span class="badge cat">${CAT[cat]}</span>${it.tour ? '<span class="badge tour">ツアー</span>' : ""}</div>
        <div class="it-title">${esc(it.title)}</div>
        ${it.note ? `<div class="it-note">${esc(it.note)}</div>` : ""}
        ${links.length ? `<div class="it-links">${links.join("")}</div>` : ""}
      </div></li>`;
  }

  function renderPlan() {
    const days = dayList();
    if (!days.length) {
      $("plan").innerHTML = `<div class="empty">日程データがまだありません。</div>`;
      return;
    }
    pickInitialDay();
    const d = days.find((x) => x.n === state.day) || days[0];
    const idx = days.indexOf(d);
    const c = CITY[d.city] || CITY.move;
    const dt = dateFor(d.n);
    const its = state.items
      .filter((i) => i.day === d.n)
      .sort(
        (a, b) =>
          (a.time ? 0 : 1) - (b.time ? 0 : 1) ||
          String(a.time || "").localeCompare(String(b.time || "")) ||
          (a.sort_order || 0) - (b.sort_order || 0) ||
          String(a.id).localeCompare(String(b.id))
      );
    const timed = its.filter((i) => i.time);
    const untimed = its.filter((i) => !i.time);
    const m = d.meals || {};
    const meal = (k, l) => `<span class="meal ${m[k] ? "on" : ""}">${l}${m[k] && m[k] !== "付" ? "：" + esc(m[k]) : m[k] ? " ✓" : ""}</span>`;
    const noStay = !d.stay || d.stay === "機中泊" || d.stay === "—";
    const stayText = noStay
      ? `<small>宿泊</small>${esc(d.stay === "—" ? "なし" : d.stay || "なし")}`
      : `<small>${esc(d.stay)}の宿泊</small>${d.hotel ? esc(d.hotel) : '<span class="ph">ホテル名を入力</span>'}`;
    const prev = days[idx - 1];
    const next = days[idx + 1];
    const navBtn = (x, cls, label) => {
      if (!x) return "";
      const xd = dateFor(x.n);
      return `<button class="${cls}" data-goto="${x.n}"><small>${label}</small>${cls === "prev" ? "‹ " : ""}DAY ${x.n}${xd ? " " + fmt(xd) : ""}${cls === "next" ? " ›" : ""}</button>`;
    };

    $("plan").innerHTML = `
      <section class="dayhero" style="--city:${c.color}" data-light="${c.light}">
        <div class="kick"><span>DAY ${d.n}</span>${dt ? `<span>${fmt(dt)}</span>` : ""}</div>
        <h2>${esc(d.route || c.name)}</h2>
        <div class="meals">${meal("b", "朝食")}${meal("l", "昼食")}${meal("d", "夕食")}</div>
        <button class="stay" data-dayedit="${d.n}">
          <span class="ico">🛏</span><span class="txt">${stayText}</span>
          <svg class="chev" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        ${d.note ? `<div class="daynote">${esc(d.note)}</div>` : ""}
      </section>
      ${
        its.length
          ? `${timed.length ? `<div class="sec">スケジュール</div><ol class="tl">${timed.map(itemHtml).join("")}</ol>` : ""}
             ${untimed.length ? `<div class="sec">時間未定</div><ol class="tl">${untimed.map(itemHtml).join("")}</ol>` : ""}`
          : `<div class="sec">スケジュール</div><div class="empty">まだ予定がありません<br><button class="btn ghost" data-add="${d.n}">＋ 予定を追加</button></div>`
      }
      <div class="daynav">${navBtn(prev, "prev", "前の日")}${navBtn(next, "next", "次の日")}</div>`;
  }

  function renderAll() {
    document.body.classList.toggle("readonly", !editable());
    pickInitialDay();
    renderHeader();
    renderStrip();
    renderPlan();
    renderStatus();
    $("fab").hidden = state.tab !== "plan";
  }

  function showScreen(name) {
    $("login").hidden = name !== "login";
    $("main").hidden = name !== "main";
  }

  // ---------- navigation ----------
  function showTab(t) {
    state.tab = t;
    ["plan", "info", "settings"].forEach((v) => ($(v).hidden = v !== t));
    $("daystrip").hidden = t !== "plan";
    $("fab").hidden = t !== "plan";
    document.querySelectorAll(".tabbar button").forEach((b) => (b.dataset.tab === t ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    window.scrollTo(0, 0);
    if (t === "plan") scrollStripToCurrent(false);
  }
  document.querySelectorAll(".tabbar button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

  function goDay(n) {
    if (!state.days.some((d) => d.n === n) || n === state.day) return;
    state.day = n;
    store.set(DAY_KEY, String(n));
    renderStrip();
    renderPlan();
    window.scrollTo(0, 0);
    scrollStripToCurrent(true);
  }
  $("daystrip").addEventListener("click", (e) => {
    const b = e.target.closest("[data-day]");
    if (b) goDay(Number(b.dataset.day));
  });

  // 左右スワイプで日を切り替える
  let touch = null;
  $("plan").addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return (touch = null);
      touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    },
    { passive: true }
  );
  $("plan").addEventListener(
    "touchend",
    (e) => {
      if (!touch) return;
      const dx = e.changedTouches[0].clientX - touch.x;
      const dy = e.changedTouches[0].clientY - touch.y;
      const quick = Date.now() - touch.t < 600;
      touch = null;
      if (!quick || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
      const days = dayList();
      const i = days.findIndex((d) => d.n === state.day);
      const target = days[i + (dx < 0 ? 1 : -1)];
      if (target) goDay(target.n);
    },
    { passive: true }
  );

  // ---------- editing ----------
  const daySel = $("fDay");
  function fillDaySel() {
    daySel.innerHTML = dayList()
      .map((d) => {
        const dt = dateFor(d.n);
        return `<option value="${d.n}">DAY ${d.n}${dt ? " " + fmt(dt) : ""}　${esc(d.route || "")}</option>`;
      })
      .join("");
  }
  function setCat(cat) {
    const v = CAT[cat] ? cat : "sight";
    $("fCat").value = v;
    $("fCatPick")
      .querySelectorAll("button")
      .forEach((b) => b.setAttribute("aria-checked", String(b.dataset.cat === v)));
  }
  $("fCatPick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (b) setCat(b.dataset.cat);
  });

  function lockScroll(on) {
    document.documentElement.style.overflow = on ? "hidden" : "";
  }

  function openSheet(mode, obj) {
    if (!editable()) return;
    editing = { mode, obj };
    $("confirmBox").classList.remove("show");
    const isDay = mode === "day";
    $("itemFields").hidden = isDay;
    $("dayFields").hidden = !isDay;
    $("fTitle").required = !isDay;
    $("delRow").hidden = mode !== "edit";
    if (isDay) {
      $("sheetTitle").textContent = `DAY ${obj.n} の宿泊・メモ`;
      $("fHotel").value = obj.hotel || "";
      $("fDayNote").value = obj.note || "";
    } else {
      fillDaySel();
      $("sheetTitle").textContent = mode === "new" ? "予定を追加" : "予定を編集";
      $("fTitle").value = obj.title || "";
      daySel.value = obj.day;
      setCat(obj.cat);
      $("fTime").value = obj.time || "";
      $("fEnd").value = obj.end_time || "";
      $("fPlace").value = obj.place || "";
      $("fUrl").value = obj.url || "";
      $("fNote").value = obj.note || "";
    }
    $("sheet").querySelector(".sheet-body").scrollTop = 0;
    $("sheetBg").classList.add("open");
    lockScroll(true);
  }
  function closeSheet() {
    $("sheetBg").classList.remove("open");
    editing = null;
    if (!$("pwBg").classList.contains("open")) lockScroll(false);
  }
  $("cancelBtn").onclick = closeSheet;
  $("sheetBg").addEventListener("click", (e) => {
    if (e.target === $("sheetBg")) closeSheet();
  });

  $("fab").onclick = () => openSheet("new", { day: state.day, cat: "sight" });

  $("plan").addEventListener("click", (e) => {
    const go = e.target.closest("[data-goto]");
    if (go) return goDay(Number(go.dataset.goto));
    const add = e.target.closest("[data-add]");
    if (add) return openSheet("new", { day: Number(add.dataset.add), cat: "sight" });
    const de = e.target.closest("[data-dayedit]");
    if (de) {
      const d = state.days.find((x) => x.n === Number(de.dataset.dayedit));
      if (d) openSheet("day", d);
      return;
    }
    if (e.target.closest("a")) return;
    const it = e.target.closest("[data-item]");
    if (it) {
      const obj = state.items.find((i) => i.id === it.dataset.item);
      if (obj) openSheet("edit", obj);
    }
  });
  $("plan").addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-item]")) {
      e.preventDefault();
      e.target.click();
    }
  });

  // ---------- data access (all through passphrase-checked RPCs) ----------
  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, { p: pass, ...args });
    if (error) throw error;
    if (data && data.error) {
      const e = new Error(data.error);
      e.code = data.error;
      throw e;
    }
    return data;
  }

  function handleAuthError(err) {
    if (err && (err.code === "invalid" || err.code === "not_set")) {
      forgetPass();
      showScreen("login");
      const msg = $("loginMsg");
      msg.textContent = err.code === "not_set" ? "合言葉がまだ設定されていません" : "合言葉が変わりました。新しい合言葉を入れてください";
      msg.classList.add("warn");
      return true;
    }
    if (err && err.code === "locked") {
      renderStatus({ msg: "間違いが続いたため、10分ほど操作できません" });
      return true;
    }
    return false;
  }

  function notifyOthers() {
    try {
      channel?.send({ type: "broadcast", event: "changed", payload: {} });
    } catch (_) {}
  }

  async function guarded(fn) {
    $("saveBtn").disabled = true;
    try {
      await fn();
      closeSheet();
      notifyOthers();
      await refresh();
    } catch (err) {
      console.error(err);
      closeSheet();
      if (!handleAuthError(err)) renderStatus({ msg: "保存できませんでした。通信状況を確認してもう一度お試しください" });
    } finally {
      $("saveBtn").disabled = false;
    }
  }

  $("sheet").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!editing || !editable()) return;
    const { mode, obj } = editing;
    if (mode === "day") {
      const hotel = $("fHotel").value.trim();
      const note = $("fDayNote").value.trim();
      if (hotel === (obj.hotel || "") && note === (obj.note || "")) return closeSheet();
      guarded(() => rpc("update_day", { day_n: obj.n, new_hotel: hotel, new_note: note }));
      return;
    }
    const item = {
      id: mode === "edit" ? obj.id : "",
      title: $("fTitle").value.trim(),
      day: Number(daySel.value),
      cat: $("fCat").value,
      time: $("fTime").value,
      end_time: $("fEnd").value,
      place: $("fPlace").value.trim(),
      url: safeUrl($("fUrl").value.trim()),
      note: $("fNote").value.trim(),
      sort_order: mode === "edit" ? obj.sort_order || 0 : Date.now(),
    };
    if (!item.title) return $("fTitle").focus();
    guarded(() => rpc("save_item", { item }));
  });

  $("delBtn").onclick = () => $("confirmBox").classList.add("show");
  $("noDel").onclick = () => $("confirmBox").classList.remove("show");
  $("yesDel").onclick = () => {
    if (editing?.mode === "edit") guarded(() => rpc("delete_item", { item_id: editing.obj.id }));
  };

  let dateTimer = null;
  $("startDate").addEventListener("change", (e) => {
    const v = e.target.value || null;
    if (!editable()) return;
    clearTimeout(dateTimer);
    dateTimer = setTimeout(async () => {
      if (v === (state.trip.start_date || null)) return;
      try {
        await rpc("set_start_date", { d: v });
        notifyOthers();
        refresh();
      } catch (err) {
        if (!handleAuthError(err)) renderStatus({ msg: "出発日を保存できませんでした" });
      }
    }, 400);
  });

  $("copyBackup").onclick = async () => {
    const text = JSON.stringify({ trip: state.trip, days: dayList(), items: state.items, syncedAt: state.syncedAt }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      $("copyMsg").textContent = "コピーしました";
    } catch (_) {
      $("copyMsg").textContent = "コピーできませんでした";
    }
  };

  let refreshing = null;
  async function refresh() {
    if (!sb || !pass || !navigator.onLine) return;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const data = await rpc("get_plan", {});
        state.trip = data.trip || {};
        state.days = data.days || [];
        state.items = data.items || [];
        state.syncedAt = new Date().toISOString();
        state.canEdit = true;
        saveCache();
        renderAll();
      } catch (err) {
        console.error(err);
        if (!handleAuthError(err)) renderStatus({ msg: "最新の日程を取得できませんでした。保存済みの内容を表示しています" });
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  let refreshTimer = null;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 300);
  }

  function subscribe() {
    if (channel || !sb) return;
    // 相手が保存したら「変わったよ」の合図だけを受け取り、最新を取り直す（データ自体は流さない）
    channel = sb.channel("honeymoon-sync").on("broadcast", { event: "changed" }, scheduleRefresh).subscribe();
    // 合図を取りこぼしても追いつけるよう、画面を開いている間は1分ごとにも確認する
    setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60000);
  }

  async function enterApp() {
    showScreen("main");
    renderAll();
    scrollStripToCurrent(false);
    if (!navigator.onLine) return;
    await refresh();
    scrollStripToCurrent(false);
    if (pass) subscribe();
  }

  // ---------- passphrase login ----------
  function rememberPass(p) {
    pass = p;
    store.set(PASS_KEY, p);
  }
  function forgetPass() {
    pass = null;
    state.canEdit = false;
    store.del(PASS_KEY);
  }

  $("lShow").onchange = (e) => ($("lPass").type = e.target.checked ? "text" : "password");

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("loginMsg");
    msg.classList.remove("warn");
    msg.textContent = "";
    if (!navigator.onLine) {
      msg.textContent = "オフラインのため確認できません";
      msg.classList.add("warn");
      return;
    }
    const p = $("lPass").value;
    $("loginBtn").disabled = true;
    try {
      const { data, error } = await sb.rpc("get_plan", { p });
      if (error) throw error;
      if (data && data.error) {
        msg.textContent =
          data.error === "locked" ? "間違いが続いたため、10分ほど待ってからお試しください" : data.error === "not_set" ? "合言葉がまだ設定されていません" : "合言葉が違います";
        msg.classList.add("warn");
        return;
      }
      rememberPass(p);
      $("lPass").value = "";
      $("lPass").blur();
      await enterApp();
    } catch (err) {
      msg.textContent = "接続できませんでした：" + (err.message || "");
      msg.classList.add("warn");
    } finally {
      $("loginBtn").disabled = false;
    }
  });

  $("logoutBtn").onclick = () => {
    forgetPass();
    store.del(CACHE_KEY);
    location.reload();
  };

  // ---------- change passphrase ----------
  $("pwShow").onchange = (e) => {
    ["pwCur", "pwNew", "pwNew2"].forEach((id) => ($(id).type = e.target.checked ? "text" : "password"));
  };
  function openPw() {
    if (!editable()) return;
    $("pwForm").reset();
    ["pwCur", "pwNew", "pwNew2"].forEach((id) => ($(id).type = "password"));
    $("pwMsg").textContent = "";
    $("pwMsg").classList.remove("warn");
    $("pwBg").classList.add("open");
    lockScroll(true);
  }
  function closePw() {
    $("pwBg").classList.remove("open");
    if (!$("sheetBg").classList.contains("open")) lockScroll(false);
  }
  $("pwBtn").onclick = openPw;
  $("pwCancel").onclick = closePw;
  $("pwBg").addEventListener("click", (e) => {
    if (e.target === $("pwBg")) closePw();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSheet();
      closePw();
    }
  });
  $("pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("pwMsg");
    const warn = (t) => {
      msg.textContent = t;
      msg.classList.add("warn");
    };
    msg.classList.remove("warn");
    msg.textContent = "";
    const cur = $("pwCur").value;
    const next = $("pwNew").value;
    if (next.length < 6) return warn("新しい合言葉は6文字以上にしてください");
    if (next !== $("pwNew2").value) return warn("確認用の合言葉が一致しません");
    if (next === cur) return warn("いまと同じ合言葉です");
    if (!navigator.onLine) return warn("オフラインのため変更できません");
    $("pwSave").disabled = true;
    try {
      const { data, error } = await sb.rpc("change_passphrase", { p: cur, new_p: next });
      if (error) throw error;
      if (data && data.error) {
        return warn(data.error === "invalid" ? "いまの合言葉が違います" : data.error === "locked" ? "間違いが続いたため、10分ほど待ってください" : "変更できませんでした");
      }
      rememberPass(next);
      msg.textContent = "合言葉を変更しました。相手にも新しい合言葉を伝えてください";
      setTimeout(closePw, 1800);
    } catch (err) {
      warn("変更できませんでした：" + (err.message || ""));
    } finally {
      $("pwSave").disabled = false;
    }
  });

  // ---------- online / offline ----------
  window.addEventListener("online", () => {
    state.online = true;
    renderAll();
    if (pass) enterApp();
  });
  window.addEventListener("offline", () => {
    state.online = false;
    closeSheet();
    closePw();
    renderAll();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });

  // ---------- boot ----------
  function boot() {
    const hasCache = loadCache();
    const cfg = window.APP_CONFIG || {};
    if (window.supabase && cfg.supabaseUrl) {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    }
    pass = store.get(PASS_KEY);
    if (pass) return enterApp();
    if (hasCache && !navigator.onLine) {
      // 圏外でも保存済みの日程は見られるようにする
      showScreen("main");
      renderAll();
      return;
    }
    showScreen("login");
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
  boot();
})();
