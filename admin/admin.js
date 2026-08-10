(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const state = { csrf: "", config: null, dirty: false };
  const errorMessages = {
    invalid_credentials: "密码不正确",
    too_many_attempts: "尝试次数过多，请十分钟后再试",
    stale_revision: "配置已在其他页面更新，请刷新后重试",
    file_too_large: "文件超过 30MB",
    invalid_image: "无法识别这张图片",
    invalid_image_dimensions: "图片至少需要 640×360，且不能超过 4000 万像素",
    invalid_audio: "无法识别这个音频文件",
    invalid_audio_duration: "音乐时长需要在 1 秒到 60 分钟之间",
    unsupported_audio_format: "仅支持 MP3、OGG、Opus 和 M4A",
    bundled_media_cannot_be_deleted: "内置资源不能删除，可以将它关闭",
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showToast(message) {
    const toast = byId("admin-toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  async function api(path, options = {}) {
    const request = { credentials: "same-origin", ...options };
    request.headers = new Headers(options.headers || {});
    request.headers.set("Accept", "application/json");
    if (state.csrf && request.method && request.method !== "GET") request.headers.set("X-CSRF-Token", state.csrf);
    if (request.body && !(request.body instanceof FormData)) request.headers.set("Content-Type", "application/json");
    const response = await fetch(path, request);
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = payload.detail || "request_failed";
      const error = new Error(errorMessages[code] || "操作失败，请稍后重试");
      error.code = code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function showLogin(message = "") {
    byId("admin-view").hidden = true;
    byId("login-view").hidden = false;
    byId("login-error").textContent = message;
    byId("password").focus();
  }

  async function showAdmin(session) {
    state.csrf = session.csrf_token;
    byId("login-view").hidden = true;
    byId("admin-view").hidden = false;
    state.config = await api("/api/admin/config");
    state.dirty = false;
    render();
  }

  function markDirty() {
    state.dirty = true;
    byId("save-settings").firstChild.textContent = "保存更改 ";
  }

  function sourceText(source) {
    return source === "bundled" ? "内置资源" : source === "upload" ? "本地上传" : "HTTPS 外链";
  }

  function moveItem(kind, index, direction) {
    const list = state.config[kind];
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    markDirty();
    renderList(kind);
  }

  async function deleteItem(item) {
    if (!confirm(`删除“${item.name}”？`)) return;
    if (!await preserveEdits()) return;
    try {
      state.config = await api(`/api/admin/media/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      state.dirty = false;
      render();
      showToast("资源已删除");
    } catch (error) {
      showToast(error.message);
    }
  }

  function createPreview(item) {
    const preview = element("div", "media-preview");
    if (item.kind === "background") {
      const image = document.createElement("img");
      image.src = item.url;
      image.alt = "";
      image.loading = "lazy";
      preview.appendChild(image);
    } else {
      const audio = document.createElement("audio");
      audio.src = item.url;
      audio.controls = true;
      audio.preload = "none";
      preview.appendChild(audio);
    }
    return preview;
  }

  function createMediaRow(item, kind, index) {
    const row = element("div", "media-row");
    row.appendChild(createPreview(item));

    const meta = element("div", "media-meta");
    const name = document.createElement("input");
    name.type = "text";
    name.value = item.name;
    name.maxLength = 120;
    name.setAttribute("aria-label", "资源名称");
    name.addEventListener("input", () => {
      item.name = name.value;
      markDirty();
    });
    const source = element("small", `source-${item.source}`, sourceText(item.source));
    meta.append(name, source);
    row.appendChild(meta);

    const switchLabel = element("label", "switch");
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = item.enabled;
    enabled.setAttribute("aria-label", `启用 ${item.name}`);
    enabled.addEventListener("change", () => {
      if (kind === "backgrounds" && !enabled.checked && state.config.backgrounds.filter((candidate) => candidate.enabled).length === 1) {
        enabled.checked = true;
        showToast("至少需要保留一张启用的背景");
        return;
      }
      item.enabled = enabled.checked;
      markDirty();
    });
    switchLabel.append(enabled, element("i"), element("span", "", "启用"));
    row.appendChild(switchLabel);

    const actions = element("div", "row-actions");
    const up = element("button", "", "↑");
    up.type = "button";
    up.title = "上移";
    up.disabled = index === 0;
    up.addEventListener("click", () => moveItem(kind, index, -1));
    const down = element("button", "", "↓");
    down.type = "button";
    down.title = "下移";
    down.disabled = index === state.config[kind].length - 1;
    down.addEventListener("click", () => moveItem(kind, index, 1));
    const remove = element("button", "delete", "×");
    remove.type = "button";
    remove.title = item.source === "bundled" ? "内置资源不能删除" : "删除";
    remove.disabled = item.source === "bundled";
    remove.addEventListener("click", () => deleteItem(item));
    actions.append(up, down, remove);
    row.appendChild(actions);
    return row;
  }

  function renderList(kind) {
    const list = state.config[kind];
    const container = byId(kind === "backgrounds" ? "background-list" : "music-list");
    container.replaceChildren();
    if (!list.length) {
      container.appendChild(element("p", "empty-state", "还没有资源"));
      return;
    }
    list.forEach((item, index) => container.appendChild(createMediaRow(item, kind, index)));
  }

  function render() {
    byId("background-mode").value = state.config.background_mode;
    byId("background-interval").value = state.config.background_interval;
    byId("music-mode").value = state.config.music_mode;
    byId("background-count").textContent = state.config.backgrounds.length;
    byId("music-count").textContent = state.config.music.length;
    byId("save-settings").firstChild.textContent = "保存设置 ";
    renderList("backgrounds");
    renderList("music");
  }

  async function saveSettings() {
    state.config.background_mode = byId("background-mode").value;
    state.config.background_interval = Number(byId("background-interval").value);
    state.config.music_mode = byId("music-mode").value;
    const button = byId("save-settings");
    button.disabled = true;
    try {
      state.config = await api("/api/admin/config", { method: "PUT", body: JSON.stringify(state.config) });
      state.dirty = false;
      render();
      showToast("设置已保存");
      return true;
    } catch (error) {
      showToast(error.message);
      return false;
    } finally {
      button.disabled = false;
    }
  }

  async function preserveEdits() {
    return !state.dirty || await saveSettings();
  }

  function bindSettingInputs() {
    ["background-mode", "background-interval", "music-mode"].forEach((id) => byId(id).addEventListener("change", markDirty));
    byId("save-settings").addEventListener("click", saveSettings);
  }

  function bindUploadForm(id, kind) {
    byId(id).addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button");
      const formData = new FormData(form);
      formData.set("kind", kind);
      if (!await preserveEdits()) return;
      button.disabled = true;
      try {
        state.config = await api("/api/admin/media/uploads", { method: "POST", body: formData });
        state.dirty = false;
        form.reset();
        render();
        showToast(kind === "background" ? "图片已上传" : "音乐已上传");
      } catch (error) {
        showToast(error.message);
      } finally {
        button.disabled = false;
      }
    });
  }

  function bindRemoteForm(id, kind) {
    byId(id).addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button");
      const data = new FormData(form);
      if (!await preserveEdits()) return;
      button.disabled = true;
      try {
        state.config = await api("/api/admin/media/remote", {
          method: "POST",
          body: JSON.stringify({ kind, name: data.get("name"), url: data.get("url") }),
        });
        state.dirty = false;
        form.reset();
        render();
        showToast("外链资源已添加");
      } catch (error) {
        showToast(error.message);
      } finally {
        button.disabled = false;
      }
    });
  }

  byId("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    byId("login-error").textContent = "";
    button.disabled = true;
    try {
      const session = await api("/api/admin/session", {
        method: "POST",
        body: JSON.stringify({ password: byId("password").value }),
      });
      byId("password").value = "";
      await showAdmin(session);
    } catch (error) {
      byId("login-error").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  byId("logout-btn").addEventListener("click", async () => {
    try { await api("/api/admin/session", { method: "DELETE" }); } catch (_) {}
    state.csrf = "";
    state.config = null;
    showLogin();
  });

  bindSettingInputs();
  bindUploadForm("background-upload-form", "background");
  bindUploadForm("music-upload-form", "music");
  bindRemoteForm("background-remote-form", "background");
  bindRemoteForm("music-remote-form", "music");

  api("/api/admin/session").then(showAdmin).catch(() => showLogin());
})();
