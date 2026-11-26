"use strict";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const state = {
  token: null,
  user: null,
  notes: [],
  selectedId: null,
  dirty: false,
  pendingAction: null,
  clearPhone: false,
  toastTimer: null
};

const authScreen = $("#auth-screen");
const appScreen = $("#app-screen");
const noteForm = $("#note-form");
const noteTitle = $("#note-title");
const noteContent = $("#note-content");
const profileDialog = $("#profile-dialog");
const deleteDialog = $("#delete-dialog");
const unsavedDialog = $("#unsaved-dialog");

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (state.token) headers.set("Authorization", `Bearer ${state.token}`);

  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new Error("No pudimos conectar con SecureVault. Revisa que el servidor siga abierto.");
  }

  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(result.errores)
      ? result.errores.map(item => item.msg).filter(Boolean).join(" · ")
      : result.error || result.mensaje;
    throw new Error(detail || "No se pudo completar la solicitud.");
  }
  return result;
}

function setMessage(element, message = "", isSuccess = false) {
  element.textContent = message;
  element.classList.toggle("is-success", Boolean(message && isSuccess));
}

function clearMessages() {
  $$(".form-message").forEach(message => setMessage(message));
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

const authViews = {
  login: {
    eyebrow: "QUÉ BUENO TENERTE DE VUELTA",
    title: "Entra a tu espacio.",
    subtitle: "Tus ideas te están esperando."
  },
  register: {
    eyebrow: "TU ESPACIO EMPIEZA AQUÍ",
    title: "Crea tu cuenta.",
    subtitle: "Un lugar privado para tus ideas."
  },
  recovery: {
    eyebrow: "VOLVER A ENTRAR",
    title: "Recupera el acceso.",
    subtitle: "Te ayudamos a recuperar tu cuenta."
  }
};

function showAuthView(view) {
  const details = authViews[view] || authViews.login;
  const isRecovery = view === "recovery";
  $("#auth-eyebrow").textContent = details.eyebrow;
  $("#auth-title").textContent = details.title;
  $("#auth-subtitle").textContent = details.subtitle;
  $("#auth-tabs").hidden = isRecovery;
  $("#login-panel").hidden = view !== "login";
  $("#register-panel").hidden = view !== "register";
  $("#recovery-panel").hidden = !isRecovery;
  $("#tab-login").classList.toggle("is-active", view === "login");
  $("#tab-register").classList.toggle("is-active", view === "register");
  $("#tab-login").setAttribute("aria-selected", String(view === "login"));
  $("#tab-register").setAttribute("aria-selected", String(view === "register"));
  clearMessages();
  const focusTarget = view === "register" ? "#register-name" : view === "recovery" ? "#recovery-email" : "#login-email";
  $(focusTarget).focus();
}

function showApp() {
  authScreen.hidden = true;
  appScreen.hidden = false;
  renderUser();
  return loadNotes();
}

function focusEditorOnSmallScreen() {
  if (window.matchMedia("(max-width: 780px)").matches) {
    window.requestAnimationFrame(() => $(".editor-card").scrollIntoView({ behavior: "smooth", block: "start" }));
  }
}

function renderUser() {
  if (!state.user) return;
  const firstName = state.user.nombre.trim().split(/\s+/)[0] || "Tu espacio";
  $("#sidebar-name").textContent = state.user.nombre;
  $("#sidebar-role").textContent = state.user.rol === "administrador" ? "Administración" : "Cuenta privada";
  $("#user-avatar").textContent = [...firstName][0].toLocaleUpperCase("es");
  $("#welcome-title").textContent = `Hola, ${firstName}.`;
  $("#footer-role").textContent = state.user.rol === "administrador" ? "Cuenta administradora" : "Espacio privado";
  $("#admin-nav").hidden = state.user.rol !== "administrador";
}

function formatDate(value, includeTime = false) {
  if (!value) return "Ahora mismo";
  const parsed = new Date(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) return "Ahora mismo";
  const options = includeTime
    ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", year: "numeric" };
  return new Intl.DateTimeFormat("es-CR", options).format(parsed);
}

function renderNotes() {
  const list = $("#notes-list");
  const searchValue = $("#note-search").value.trim().toLocaleLowerCase("es");
  const filtered = state.notes.filter(note =>
    `${note.titulo} ${note.contenido}`.toLocaleLowerCase("es").includes(searchValue)
  );

  list.replaceChildren();
  $("#sidebar-count").textContent = String(state.notes.length);
  $("#notes-total").textContent = `${state.notes.length} ${state.notes.length === 1 ? "nota" : "notas"}`;
  $("#empty-list").hidden = state.notes.length !== 0 || Boolean(searchValue);
  $("#no-results").hidden = state.notes.length === 0 || filtered.length !== 0;

  for (const note of filtered) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "note-item";
    button.classList.toggle("is-selected", note.id === state.selectedId);
    button.setAttribute("aria-current", note.id === state.selectedId ? "true" : "false");
    button.addEventListener("click", () => requestAction({ type: "select", id: note.id }));

    const title = document.createElement("span");
    title.className = "note-item-title";
    title.textContent = note.titulo;
    const preview = document.createElement("span");
    preview.className = "note-item-preview";
    preview.textContent = note.contenido.replace(/\s+/g, " ").trim() || "Sin contenido";
    const date = document.createElement("span");
    date.className = "note-item-date";
    date.textContent = formatDate(note.actualizado_en || note.creado_en);
    button.append(title, preview, date);
    list.append(button);
  }
}

function showNotesView() {
  $("#admin-view").hidden = true;
  $("#notes-view").hidden = false;
  $("#notes-nav").classList.add("is-current");
  $("#admin-nav").classList.remove("is-current");
}

function buildRoleControl(user) {
  const row = document.createElement("article");
  row.className = "admin-user-row";
  const identity = document.createElement("div");
  identity.className = "admin-user-identity";
  const avatar = document.createElement("span");
  avatar.className = "admin-user-avatar";
  avatar.textContent = [...user.nombre.trim()][0]?.toLocaleUpperCase("es") || "U";
  const details = document.createElement("span");
  details.className = "admin-user-details";
  const name = document.createElement("strong");
  name.textContent = user.nombre;
  const email = document.createElement("small");
  email.textContent = user.correo;
  details.append(name, email);
  identity.append(avatar, details);

  const controls = document.createElement("div");
  controls.className = "role-controls";
  const select = document.createElement("select");
  select.className = "role-select";
  select.setAttribute("aria-label", `Rol de ${user.nombre}`);
  for (const [value, label] of [["usuario", "Usuario"], ["administrador", "Administrador"]]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = user.rol;
  const save = document.createElement("button");
  save.type = "button";
  save.className = "role-save";
  save.textContent = "Guardar";
  save.disabled = true;
  select.addEventListener("change", () => { save.disabled = select.value === user.rol; });
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      await api(`/api/admin/usuarios/${user.id}/rol`, {
        method: "PATCH",
        body: JSON.stringify({ rol: select.value })
      });
      showToast("Rol actualizado.");
      await loadAdminData();
    } catch (error) {
      showToast(error.message);
      select.value = user.rol;
    } finally {
      save.disabled = select.value === user.rol;
    }
  });
  controls.append(select, save);
  row.append(identity, controls);
  return row;
}

function buildAuditEvent(event) {
  const item = document.createElement("article");
  item.className = "audit-item";
  const marker = document.createElement("span");
  marker.className = "audit-marker";
  marker.setAttribute("aria-hidden", "true");
  const content = document.createElement("div");
  content.className = "audit-content";
  const title = document.createElement("strong");
  title.textContent = event.evento.replaceAll("_", " ");
  const details = document.createElement("span");
  details.textContent = event.correo || "Sin cuenta asociada";
  const date = document.createElement("time");
  date.dateTime = new Date(`${event.creado_en.replace(" ", "T")}Z`).toISOString();
  date.textContent = formatDate(event.creado_en, true);
  content.append(title, details);
  item.append(marker, content, date);
  return item;
}

async function loadAdminData() {
  const usersContainer = $("#admin-users");
  const auditContainer = $("#admin-audit");
  usersContainer.replaceChildren();
  auditContainer.replaceChildren();
  try {
    const [usersResponse, auditResponse] = await Promise.all([
      api("/api/admin/usuarios"),
      api("/api/admin/auditoria")
    ]);
    $("#admin-user-count").textContent = String(usersResponse.usuarios.length);
    $("#admin-users-empty").hidden = usersResponse.usuarios.length > 0;
    $("#admin-audit-empty").hidden = auditResponse.eventos.length > 0;
    usersResponse.usuarios.forEach(user => usersContainer.append(buildRoleControl(user)));
    auditResponse.eventos.forEach(event => auditContainer.append(buildAuditEvent(event)));
  } catch (error) {
    $("#admin-users-empty").hidden = false;
    $("#admin-users-empty").textContent = error.message;
    $("#admin-audit-empty").hidden = true;
  }
}

async function loadNotes(selectId = state.selectedId) {
  const response = await api("/api/notas");
  state.notes = response.notas;
  renderNotes();
  if (selectId && state.notes.some(note => note.id === selectId)) {
    fillEditor(state.notes.find(note => note.id === selectId));
  } else if (state.notes.length === 0) {
    clearEditor();
  } else if (state.selectedId && !state.notes.some(note => note.id === state.selectedId)) {
    clearEditor();
  }
}

function fillEditor(note) {
  state.selectedId = note.id;
  state.dirty = false;
  $("#note-id").value = String(note.id);
  noteTitle.value = note.titulo;
  noteContent.value = note.contenido;
  $("#note-date").textContent = `Editada ${formatDate(note.actualizado_en || note.creado_en, true)}`;
  $("#character-count").textContent = `${note.contenido.length} / 5000`;
  $("#delete-note-button").hidden = false;
  $("#save-status").textContent = "Tus cambios aún no se han modificado.";
  $("#editor-heading").textContent = "Elige una nota o empieza algo nuevo.";
  $("#editor-empty").hidden = true;
  noteForm.hidden = false;
  $(".editor-card").classList.remove("is-hidden-mobile");
  renderNotes();
}

function clearEditor() {
  state.selectedId = null;
  state.dirty = false;
  noteForm.reset();
  $("#note-id").value = "";
  $("#note-date").textContent = "Nueva nota";
  $("#character-count").textContent = "0 / 5000";
  $("#delete-note-button").hidden = true;
  $("#save-status").textContent = "Solo tú puedes leer esto.";
  noteForm.hidden = true;
  $("#editor-empty").hidden = false;
  $(".editor-card").classList.remove("is-hidden-mobile");
  renderNotes();
}

function requestAction(action) {
  if (state.dirty) {
    state.pendingAction = action;
    $("#unsaved-message").textContent = "¿Quieres guardar esta nota antes de continuar?";
    unsavedDialog.showModal();
    return;
  }
  performAction(action);
}

function performAction(action) {
  if (action.type === "new") {
    clearEditor();
    noteForm.hidden = false;
    $("#editor-empty").hidden = true;
    $(".editor-card").classList.remove("is-hidden-mobile");
    noteTitle.focus();
    focusEditorOnSmallScreen();
  } else if (action.type === "select") {
    const note = state.notes.find(item => item.id === action.id);
    if (note) {
      fillEditor(note);
      focusEditorOnSmallScreen();
    }
  } else if (action.type === "logout") {
    logout();
  }
}

async function saveNote() {
  const title = noteTitle.value.trim();
  const content = noteContent.value;
  if (!title || !content.trim()) {
    $("#save-status").textContent = "Añade un título y algo de contenido para guardar.";
    return false;
  }

  const saveButton = $(".save-button");
  const originalLabel = saveButton.textContent;
  saveButton.disabled = true;
  saveButton.textContent = "Guardando…";
  try {
    let selectedId = state.selectedId;
    if (selectedId) {
      await api(`/api/notas/${selectedId}`, {
        method: "PUT",
        body: JSON.stringify({ titulo: title, contenido: content })
      });
    } else {
      const response = await api("/api/notas", {
        method: "POST",
        body: JSON.stringify({ titulo: title, contenido: content })
      });
      selectedId = response.nota.id;
    }
    state.dirty = false;
    await loadNotes(selectedId);
    $("#save-status").textContent = "Guardada y cifrada.";
    showToast("Tu nota quedó guardada.");
    const pending = state.pendingAction;
    state.pendingAction = null;
    if (pending) {
      unsavedDialog.close();
      performAction(pending);
    }
    return true;
  } catch (error) {
    $("#save-status").textContent = error.message;
    if (state.pendingAction) $("#unsaved-message").textContent = error.message;
    return false;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = originalLabel;
  }
}

async function deleteNote() {
  if (!state.selectedId) return;
  const deleteButton = $("#confirm-delete-button");
  deleteButton.disabled = true;
  try {
    await api(`/api/notas/${state.selectedId}`, { method: "DELETE" });
    deleteDialog.close();
    state.dirty = false;
    await loadNotes(null);
    clearEditor();
    showToast("La nota se eliminó.");
  } catch (error) {
    deleteDialog.close();
    showToast(error.message);
  } finally {
    deleteButton.disabled = false;
  }
}

async function openProfile() {
  try {
    const response = await api("/api/usuario/me");
    const user = response.usuario;
    $("#profile-name").value = user.nombre;
    $("#profile-email").value = user.correo;
    $("#profile-phone").value = "";
    $("#profile-phone").placeholder = user.telefono
      ? `Guardado: ${user.telefono}`
      : "Añade un teléfono si quieres";
    state.clearPhone = false;
    $("#clear-phone-button").hidden = !user.telefono;
    setMessage($("#profile-message"));
    profileDialog.showModal();
    $("#profile-name").focus();
  } catch (error) {
    showToast(error.message);
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // La sesión local se borra aunque el servidor ya haya expirado el token.
  }
  state.token = null;
  state.user = null;
  state.notes = [];
  state.selectedId = null;
  state.dirty = false;
  appScreen.hidden = true;
  authScreen.hidden = false;
  $("#login-password").value = "";
  showAuthView("login");
  setMessage($("#login-message"), "Sesión cerrada. Puedes volver cuando quieras.", true);
}

$("#tab-login").addEventListener("click", () => showAuthView("login"));
$("#tab-register").addEventListener("click", () => showAuthView("register"));
$$('[data-view="recovery"]').forEach(button => button.addEventListener("click", () => showAuthView("recovery")));
$$('[data-view="login"]').forEach(button => button.addEventListener("click", () => showAuthView("login")));

$("#login-panel").addEventListener("submit", async event => {
  event.preventDefault();
  const message = $("#login-message");
  setMessage(message);
  const submit = $('#login-panel button[type="submit"]');
  submit.disabled = true;
  try {
    const response = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        correo: $("#login-email").value.trim(),
        password: $("#login-password").value
      })
    });
    state.token = response.token;
    state.user = response.usuario;
    await showApp();
  } catch (error) {
    setMessage(message, error.message);
  } finally {
    submit.disabled = false;
  }
});

$("#register-panel").addEventListener("submit", async event => {
  event.preventDefault();
  const message = $("#register-message");
  setMessage(message);
  const submit = $('#register-panel button[type="submit"]');
  submit.disabled = true;
  try {
    const response = await api("/api/auth/registro", {
      method: "POST",
      body: JSON.stringify({
        nombre: $("#register-name").value.trim(),
        correo: $("#register-email").value.trim(),
        password: $("#register-password").value
      })
    });
    $("#login-email").value = response.usuario.correo;
    $("#login-password").value = "";
    showAuthView("login");
    setMessage($("#login-message"), "Tu cuenta está lista. Inicia sesión para continuar.", true);
  } catch (error) {
    setMessage(message, error.message);
  } finally {
    submit.disabled = false;
  }
});

$("#request-recovery-form").addEventListener("submit", async event => {
  event.preventDefault();
  const message = $("#recovery-message");
  setMessage(message);
  const submit = $('#request-recovery-form button[type="submit"]');
  submit.disabled = true;
  try {
    const response = await api("/api/auth/recuperar", {
      method: "POST",
      body: JSON.stringify({ correo: $("#recovery-email").value.trim() })
    });
    setMessage(message, response.mensaje, true);
  } catch (error) {
    setMessage(message, error.message);
  } finally {
    submit.disabled = false;
  }
});

$("#reset-password-form").addEventListener("submit", async event => {
  event.preventDefault();
  const message = $("#reset-message");
  setMessage(message);
  const submit = $('#reset-password-form button[type="submit"]');
  submit.disabled = true;
  try {
    await api("/api/auth/restablecer", {
      method: "POST",
      body: JSON.stringify({
        token: $("#reset-token").value.trim(),
        password: $("#reset-password").value
      })
    });
    $("#login-email").value = $("#recovery-email").value.trim();
    $("#login-password").value = "";
    $("#reset-password-form").reset();
    showAuthView("login");
    setMessage($("#login-message"), "Contraseña actualizada. Ya puedes iniciar sesión.", true);
  } catch (error) {
    setMessage(message, error.message);
  } finally {
    submit.disabled = false;
  }
});

$("#note-form").addEventListener("submit", event => {
  event.preventDefault();
  saveNote();
});
noteTitle.addEventListener("input", () => {
  state.dirty = true;
  $("#save-status").textContent = "Tienes cambios sin guardar.";
});
noteContent.addEventListener("input", () => {
  state.dirty = true;
  $("#character-count").textContent = `${noteContent.value.length} / 5000`;
  $("#save-status").textContent = "Tienes cambios sin guardar.";
});

$("#new-note-button").addEventListener("click", () => requestAction({ type: "new" }));
$("#first-note-button").addEventListener("click", () => requestAction({ type: "new" }));
$("#empty-new-button").addEventListener("click", () => requestAction({ type: "new" }));
$("#notes-nav").addEventListener("click", () => {
  showNotesView();
  $("#note-search").value = "";
  renderNotes();
  $("#note-search").focus();
});
$("#admin-nav").addEventListener("click", async () => {
  if (state.user?.rol !== "administrador") return;
  $("#notes-view").hidden = true;
  $("#admin-view").hidden = false;
  $("#notes-nav").classList.remove("is-current");
  $("#admin-nav").classList.add("is-current");
  await loadAdminData();
});
$("#refresh-admin-button").addEventListener("click", loadAdminData);
$("#note-search").addEventListener("input", renderNotes);
$("#delete-note-button").addEventListener("click", () => deleteDialog.showModal());
$("#cancel-delete-button").addEventListener("click", () => deleteDialog.close());
$("#confirm-delete-button").addEventListener("click", deleteNote);
$("#logout-button").addEventListener("click", () => requestAction({ type: "logout" }));
$("#profile-nav").addEventListener("click", openProfile);
$("#cancel-profile-button").addEventListener("click", () => profileDialog.close());
$("#close-editor-button").addEventListener("click", () => {
  $(".editor-card").classList.add("is-hidden-mobile");
  $(".notes-column").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("#profile-form").addEventListener("submit", async event => {
  event.preventDefault();
  const message = $("#profile-message");
  setMessage(message);
  const submit = $('#profile-form button[type="submit"]');
  submit.disabled = true;
  const body = { nombre: $("#profile-name").value.trim() };
  const phone = $("#profile-phone").value.trim();
  if (state.clearPhone) body.telefono = null;
  else if (phone) body.telefono = phone;
  try {
    await api("/api/usuario/me", { method: "PATCH", body: JSON.stringify(body) });
    state.user.nombre = body.nombre;
    renderUser();
    profileDialog.close();
    showToast("Perfil actualizado.");
  } catch (error) {
    setMessage(message, error.message);
  } finally {
    submit.disabled = false;
  }
});

$("#clear-phone-button").addEventListener("click", () => {
  state.clearPhone = true;
  $("#profile-phone").value = "";
  $("#profile-phone").placeholder = "Se eliminará el teléfono guardado";
  $("#clear-phone-button").hidden = true;
});
$("#profile-phone").addEventListener("input", () => {
  state.clearPhone = false;
});

$("#unsaved-save-button").addEventListener("click", saveNote);
$("#unsaved-discard-button").addEventListener("click", () => {
  const action = state.pendingAction;
  state.pendingAction = null;
  state.dirty = false;
  unsavedDialog.close();
  if (action) performAction(action);
});
$("#unsaved-cancel-button").addEventListener("click", () => {
  state.pendingAction = null;
  unsavedDialog.close();
});
unsavedDialog.addEventListener("close", () => { state.pendingAction = null; });

for (const dialog of [profileDialog, deleteDialog, unsavedDialog]) {
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
}

if (!("showModal" in HTMLDialogElement.prototype)) {
  $$("dialog").forEach(dialog => dialog.setAttribute("open", ""));
}
