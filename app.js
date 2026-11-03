(() => {
  "use strict";

  const CITY = {
    lon: { name: "ロンドン", color: "var(--lon)", light: 1 },
    par: { name: "パリ", color: "var(--par)", light: 1 },
    rom: { name: "ローマ", color: "var(--rom)", light: 0 },
    move: { name: "移動", color: "var(--move)", light: 1 },
  };
  const CAT = { sight: "観光", food: "食事", move: "移動", shop: "買い物", rest: "ホテル・休憩", other: "その他" };
  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  const CACHE_KEY = "honeymoon-cache-v1";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");

  const state = { trip: {}, days: [], items: [], syncedAt: null, online: navigator.onLine, canEdit: false };
  let sb = null;
  let session = null;
  let editing = null;
  let channel = null;
  // パスワード再設定メールのリンクから開いたかどうか（URL の # 部分で判定）
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  let recoveryPending = hashParams.get("type") === "recovery";
  const hashError = hashParams.get("error_description");

  // ---------- local cache (offline viewing) ----------
  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const c = JSON.parse(raw);
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
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ trip: state.trip, days: state.days, items: state.items, syncedAt: state.syncedAt }));
    } catch (_) {}
  }

  // ---------- render ----------
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

  function renderHeader() {
    if (document.activeElement !== $("startDate")) $("startDate").value = state.trip.start_date || "";
    const cd = $("countdown");
    const d0 = dateFor(1);
    if (d0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diff = Math.round((d0 - today) / 86400000);
      cd.textContent = diff > 0 ? `出発まであと ${diff} 日` : today <= dateFor(9) ? "旅行中" : "おかえりなさい";
      cd.hidden = false;
    } else cd.hidden = true;
  }

  function renderStatus(extra) {
    const s = $("status");
    let msg = "";
    let warn = false;
    if (!state.online) {
      msg = `オフライン表示中${state.syncedAt ? `（最終同期 ${fmtTime(state.syncedAt)}）` : ""}・編集はオンライン時のみ`;
      warn = true;
    } else if (extra) {
      msg = extra.msg;
      warn = !!extra.warn;
    } else if (state.syncedAt) {
      msg = `最終同期 ${fmtTime(state.syncedAt)}`;
    }
    s.textContent = msg;
    s.classList.toggle("warn", warn);
  }

  function renderChips() {
    $("chips").innerHTML = dayList()
      .map((d) => {
        const c = CITY[d.city] || CITY.move;
        const dt = dateFor(d.n);
        return `<button class="chip" data-light="${c.light}" style="background:${c.color}" data-jump="${d.n}">Day ${d.n}<small>${dt ? fmt(dt) : esc(c.name)}</small></button>`;
      })
      .join("");
  }

  function itemHtml(it) {
    const url = safeUrl(it.url);
    const links = [];
    if (it.place) links.push(`<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(it.place)}" target="_blank" rel="noopener">📍 ${esc(it.place)}</a>`);
    if (url) links.push(`<a href="${esc(url)}" target="_blank" rel="noopener">🔗 リンク</a>`);
    const cat = CAT[it.cat] ? it.cat : "other";
    return `<li class="item c-${cat}" data-item="${esc(it.id)}">
      <div class="t">${esc(it.time || "")}${it.end_time ? `<small>〜${esc(it.end_time)}</small>` : ""}</div>
      <div class="body">
        <div class="title">${esc(it.title)} ${it.tour ? '<span class="tag tour">ツアー</span>' : ""}<span class="cat">${CAT[cat]}</span></div>
        ${it.note ? `<div class="note">${esc(it.note)}</div>` : ""}
        ${links.length ? `<div class="links">${links.join("")}</div>` : ""}
      </div></li>`;
  }

  function renderPlan() {
    const days = dayList();
    if (!days.length) {
      $("plan").innerHTML = `<div class="day"><div class="empty">日程データがまだありません。</div></div>`;
      return;
    }
    $("plan").innerHTML = days
      .map((d) => {
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
        const meal = (k, l) => `<span class="${m[k] ? "on" : ""}">${l}${m[k] && m[k] !== "付" ? "：" + esc(m[k]) : ""}</span>`;
        const needsHotel = d.stay && d.stay !== "機中泊" && d.stay !== "—";
        return `<article class="day" id="day-${d.n}">
        <div class="dayhead" data-light="${c.light}" style="background:${c.color}">
          <div><div class="n">DAY ${d.n}</div><h2>${esc(d.route || c.name)}</h2></div>
          <div class="date">${dt ? fmt(dt) : ""}</div>
        </div>
        <div class="meta">
          <span class="meals">${meal("b", "朝")}${meal("l", "昼")}${meal("d", "夕")}</span>
          <button class="stay" data-dayedit="${d.n}">🛏 ${esc(d.stay || "")}${d.hotel ? `：<u>${esc(d.hotel)}</u>` : needsHotel ? "　<u>ホテル名を入力</u>" : ""}</button>
        </div>
        ${d.note ? `<div class="daynote">${esc(d.note)}</div>` : ""}
        <ol class="tl">${timed.map(itemHtml).join("")}</ol>
        ${untimed.length ? `<div class="untimed">時間未定</div><ol class="tl">${untimed.map(itemHtml).join("")}</ol>` : ""}
        ${!its.length ? `<div class="empty">まだ予定がありません</div>` : ""}
        <button class="add" data-add="${d.n}">＋ 予定を追加</button>
      </article>`;
      })
      .join("");
  }

  function renderAll() {
    document.body.classList.toggle("offline", !state.online || !state.canEdit);
    renderHeader();
    renderChips();
    renderPlan();
    renderStatus();
  }

  function showScreen(name) {
    $("login").hidden = name !== "login";
    $("main").hidden = name !== "main";
    $("topbar").hidden = name !== "main" || !session;
  }

  // ---------- tabs / nav ----------
  function showTab(t) {
    $("tabPlan").setAttribute("aria-pressed", t === "plan");
    $("tabInfo").setAttribute("aria-pressed", t === "info");
    $("plan").hidden = t !== "plan";
    $("info").hidden = t !== "info";
    $("chips").hidden = t !== "plan";
  }
  $("tabPlan").onclick = () => showTab("plan");
  $("tabInfo").onclick = () => showTab("info");
  $("chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-jump]");
    if (!b) return;
    showTab("plan");
    document.getElementById("day-" + b.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ---------- editing ----------
  const daySel = $("fDay");
  function fillDaySel() {
    daySel.innerHTML = dayList()
      .map((d) => {
        const dt = dateFor(d.n);
        return `<option value="${d.n}">Day ${d.n}${dt ? " " + fmt(dt) : ""}　${esc(d.route || "")}</option>`;
      })
      .join("");
  }

  function editable() {
    return state.online && state.canEdit && sb && session;
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
      $("sheetTitle").textContent = `Day ${obj.n} の宿泊・メモ`;
      $("fHotel").value = obj.hotel || "";
      $("fDayNote").value = obj.note || "";
    } else {
      fillDaySel();
      $("sheetTitle").textContent = mode === "new" ? "予定を追加" : "予定を編集";
      $("fTitle").value = obj.title || "";
      daySel.value = obj.day;
      $("fCat").value = CAT[obj.cat] ? obj.cat : "sight";
      $("fTime").value = obj.time || "";
      $("fEnd").value = obj.end_time || "";
      $("fPlace").value = obj.place || "";
      $("fUrl").value = obj.url || "";
      $("fNote").value = obj.note || "";
    }
    $("sheetBg").classList.add("open");
    if (mode === "new") setTimeout(() => $("fTitle").focus(), 50);
  }
  function closeSheet() {
    $("sheetBg").classList.remove("open");
    editing = null;
  }
  $("cancelBtn").onclick = closeSheet;
  $("sheetBg").addEventListener("click", (e) => {
    if (e.target === $("sheetBg")) closeSheet();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSheet();
  });

  $("plan").addEventListener("click", (e) => {
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

  async function guarded(fn) {
    $("saveBtn").disabled = true;
    try {
      const { error } = await fn();
      if (error) throw error;
      closeSheet();
      await refresh();
    } catch (err) {
      console.error(err);
      renderStatus({ msg: "保存できませんでした。通信状況を確認してもう一度お試しください", warn: true });
    } finally {
      $("saveBtn").disabled = false;
    }
  }

  $("sheet").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!editing || !editable()) return;
    const { mode, obj } = editing;
    const now = new Date().toISOString();
    if (mode === "day") {
      const hotel = $("fHotel").value.trim();
      const note = $("fDayNote").value.trim();
      if (hotel === (obj.hotel || "") && note === (obj.note || "")) return closeSheet();
      guarded(() => sb.from("days").update({ hotel, note, updated_at: now }).eq("n", obj.n));
      return;
    }
    const body = {
      title: $("fTitle").value.trim(),
      day: Number(daySel.value),
      cat: $("fCat").value,
      time: $("fTime").value,
      end_time: $("fEnd").value,
      place: $("fPlace").value.trim(),
      url: safeUrl($("fUrl").value.trim()),
      note: $("fNote").value.trim(),
      updated_at: now,
    };
    if (!body.title) return;
    if (mode === "new") guarded(() => sb.from("items").insert({ ...body, tour: false, sort_order: Date.now() }));
    else guarded(() => sb.from("items").update(body).eq("id", obj.id));
  });

  $("delBtn").onclick = () => $("confirmBox").classList.add("show");
  $("noDel").onclick = () => $("confirmBox").classList.remove("show");
  $("yesDel").onclick = () => {
    if (editing?.mode === "edit") guarded(() => sb.from("items").delete().eq("id", editing.obj.id));
  };

  let dateTimer = null;
  $("startDate").addEventListener("change", (e) => {
    const v = e.target.value || null;
    if (!editable()) return;
    clearTimeout(dateTimer);
    dateTimer = setTimeout(async () => {
      if (v === (state.trip.start_date || null)) return;
      const { error } = await sb.from("trip").update({ start_date: v, updated_at: new Date().toISOString() }).eq("id", 1);
      if (error) renderStatus({ msg: "出発日を保存できませんでした", warn: true });
      else refresh();
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

  // ---------- data ----------
  let refreshing = null;
  async function refresh() {
    if (!sb || !session || !navigator.onLine) return;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const [t, d, i] = await Promise.all([
          sb.from("trip").select("*").eq("id", 1).maybeSingle(),
          sb.from("days").select("*").order("n"),
          sb.from("items").select("*"),
        ]);
        const err = t.error || d.error || i.error;
        if (err) throw err;
        state.trip = t.data || {};
        state.days = d.data || [];
        state.items = i.data || [];
        state.syncedAt = new Date().toISOString();
        saveCache();
        renderAll();
      } catch (err) {
        console.error(err);
        renderStatus({ msg: "最新の日程を取得できませんでした。保存済みの内容を表示しています", warn: true });
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
    channel = sb
      .channel("honeymoon-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "days" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "trip" }, scheduleRefresh)
      .subscribe();
  }

  async function checkMember() {
    const email = (session?.user?.email || "").toLowerCase();
    const { data, error } = await sb.from("members").select("email").eq("email", email).maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async function enterApp() {
    $("whoami").textContent = session?.user?.email || "";
    showScreen("main");
    renderAll();
    if (recoveryPending) openPw("recovery");
    if (!navigator.onLine) return;
    try {
      const ok = await checkMember();
      state.canEdit = ok;
      if (!ok) {
        renderAll();
        renderStatus({ msg: "このアカウントはまだ許可されていません（members に登録が必要です）", warn: true });
        return;
      }
      await refresh();
      subscribe();
    } catch (err) {
      console.error(err);
      renderStatus({ msg: "接続できませんでした。保存済みの内容を表示しています", warn: true });
    }
  }

  // ---------- login ----------
  let signupMode = false;
  $("toggleSignup").onclick = () => {
    signupMode = !signupMode;
    $("loginBtn").textContent = signupMode ? "アカウントを登録" : "ログイン";
    $("toggleSignup").textContent = signupMode ? "ログインに戻る" : "はじめての方はこちら（アカウント登録）";
    $("lPass").autocomplete = signupMode ? "new-password" : "current-password";
    $("loginMsg").textContent = "";
  };
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("loginMsg");
    msg.classList.remove("warn");
    if (!navigator.onLine) {
      msg.textContent = "オフラインのためログインできません";
      msg.classList.add("warn");
      return;
    }
    const email = $("lEmail").value.trim().toLowerCase();
    const password = $("lPass").value;
    $("loginBtn").disabled = true;
    try {
      if (signupMode) {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
        if (error) throw error;
        if (!data.session) {
          msg.textContent = "確認メールを送りました。メールのリンクを開いたあと、ここからログインしてください";
          return;
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      msg.textContent = /invalid login/i.test(err.message || "") ? "メールアドレスかパスワードが違います" : "うまくいきませんでした：" + (err.message || "");
      msg.classList.add("warn");
    } finally {
      $("loginBtn").disabled = false;
    }
  });
  $("logoutBtn").onclick = async () => {
    try {
      await sb.auth.signOut();
    } catch (_) {}
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch (_) {}
    location.reload();
  };


  // ---------- password ----------
  $("lShow").onchange = (e) => ($("lPass").type = e.target.checked ? "text" : "password");
  $("pwShow").onchange = (e) => {
    ["pwCur", "pwNew", "pwNew2"].forEach((id) => ($(id).type = e.target.checked ? "text" : "password"));
  };

  $("forgotBtn").onclick = async () => {
    const msg = $("loginMsg");
    msg.classList.remove("warn");
    const email = $("lEmail").value.trim().toLowerCase();
    if (!email) {
      msg.textContent = "メールアドレスを入力してから押してください";
      msg.classList.add("warn");
      return;
    }
    if (!navigator.onLine) {
      msg.textContent = "オフラインのため送れません";
      msg.classList.add("warn");
      return;
    }
    $("forgotBtn").disabled = true;
    try {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/" });
      if (error) throw error;
      msg.textContent = "パスワード再設定のメールを送りました。メールのリンクを開くと、新しいパスワードを設定できます";
    } catch (err) {
      msg.textContent = /rate|seconds/i.test(err.message || "") ? "少し時間をおいてからもう一度お試しください" : "送れませんでした：" + (err.message || "");
      msg.classList.add("warn");
    } finally {
      $("forgotBtn").disabled = false;
    }
  };

  let pwMode = "change";
  function openPw(mode) {
    pwMode = mode;
    $("pwForm").reset();
    ["pwCur", "pwNew", "pwNew2"].forEach((id) => ($(id).type = "password"));
    $("pwUser").value = session?.user?.email || "";
    $("pwTitle").textContent = mode === "recovery" ? "新しいパスワードを設定" : "パスワード変更";
    $("pwCurWrap").hidden = mode === "recovery";
    $("pwCur").required = mode !== "recovery";
    $("pwMsg").textContent = "";
    $("pwMsg").classList.remove("warn");
    $("pwBg").classList.add("open");
    setTimeout(() => $(mode === "recovery" ? "pwNew" : "pwCur").focus(), 50);
  }
  function closePw() {
    $("pwBg").classList.remove("open");
  }
  $("pwBtn").onclick = () => openPw("change");
  $("pwCancel").onclick = closePw;
  $("pwBg").addEventListener("click", (e) => {
    if (e.target === $("pwBg")) closePw();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePw();
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
    const next = $("pwNew").value;
    if (next.length < 8) return warn("新しいパスワードは8文字以上にしてください");
    if (next !== $("pwNew2").value) return warn("確認用のパスワードが一致しません");
    if (!navigator.onLine) return warn("オフラインのため変更できません");
    $("pwSave").disabled = true;
    try {
      if (pwMode === "change") {
        // いまのパスワードが合っているか確かめてから変更する
        const { error: e1 } = await sb.auth.signInWithPassword({ email: session.user.email, password: $("pwCur").value });
        if (e1) return warn("いまのパスワードが違います");
      }
      const { error } = await sb.auth.updateUser({ password: next });
      if (error) {
        if (/different from the old/i.test(error.message || "")) return warn("いまと同じパスワードには変更できません");
        if (/weak|short/i.test(error.message || "")) return warn("もう少し複雑なパスワードにしてください");
        throw error;
      }
      recoveryPending = false;
      if (location.hash) history.replaceState(null, "", location.pathname);
      msg.textContent = "パスワードを変更しました";
      setTimeout(closePw, 1200);
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
    if (session) enterApp();
  });
  window.addEventListener("offline", () => {
    state.online = false;
    closeSheet();
    renderAll();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });

  // ---------- boot ----------
  async function boot() {
    const hasCache = loadCache();
    const cfg = window.APP_CONFIG || {};
    if (window.supabase && cfg.supabaseUrl) {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    }
    if (sb) {
      try {
        const { data } = await sb.auth.getSession();
        session = data.session;
      } catch (_) {}
      sb.auth.onAuthStateChange((event, s) => {
        const was = !!session;
        session = s;
        if (event === "PASSWORD_RECOVERY") recoveryPending = true;
        if ((event === "SIGNED_IN" || event === "PASSWORD_RECOVERY") && !was) enterApp();
        else if (event === "PASSWORD_RECOVERY") openPw("recovery");
        if (event === "SIGNED_OUT") showScreen("login");
      });
    }
    if (session) return enterApp();
    if (hasCache && !navigator.onLine) {
      // ログイン情報が切れていても、旅先の圏外では保存済みの日程を見られるようにする
      showScreen("main");
      renderAll();
      return;
    }
    showScreen("login");
    if (hashError) {
      $("loginMsg").textContent = /expired|invalid/i.test(hashError)
        ? "メールのリンクの有効期限が切れています。もう一度「パスワードを忘れた場合」から送ってください"
        : hashError;
      $("loginMsg").classList.add("warn");
      history.replaceState(null, "", location.pathname);
    }
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
  boot();
})();
