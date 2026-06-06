/**
 * Universal modifications.
 *
 * 1. Patches SR5Item.createNestedItem so any item can host nested items.
 * 2. Injects a "Modifications" tab into the V2 ItemSheet with folders,
 *    item creation, equip-toggle, delete, and drop support.
 */
import {L, setting, asElement, log, uid, promptForName, confirm,
  getModFolders, setModFolders, getModItemFolder, setModItemFolder, removeModFolder} from "./utils.js";

const TAB_ID = "sr5cfMods";
const SECTION_CLS = "sr5cf-mods-section";
const NAV_LINK_CLS = "sr5cf-mods-nav";
const FOLDER_WRAPPER_CLS = "sr5cf-folder";
const FOLDER_HEADER_CLS = "sr5cf-folder-header";
const FOLDER_BODY_CLS = "sr5cf-folder-body";

export function registerItemMods() {
  Hooks.once("ready", patchCreateNestedItem);
  Hooks.on("renderSR5ItemSheet", onRenderItemSheet);
}

/* ------------------------------------------------------------------------ */
/* 1. createNestedItem patch                                                */
/* ------------------------------------------------------------------------ */

function patchCreateNestedItem() {
  if (!setting("enableUniversalMods")) return;

  const ItemCls = CONFIG?.Item?.documentClass;
  if (!ItemCls?.prototype?.createNestedItem) {
    log("createNestedItem not found on Item document class — skipping patch.");
    return;
  }
  if (ItemCls.prototype.__sr5cfPatched) return;
  ItemCls.prototype.__sr5cfPatched = true;

  const original = ItemCls.prototype.createNestedItem;
  ItemCls.prototype.createNestedItem = async function patched(itemData) {
    try {
      if (!Array.isArray(itemData)) itemData = [itemData];

      const allowRecursive = setting("allowRecursiveMods");
      if (!allowRecursive && this._isNestedItem) {
        ui.notifications?.warn("Nested modifications are not allowed (recursion disabled).");
        return false;
      }

      const isWeapon = this.type === "weapon";
      const allWeaponAccepted = itemData.every(
        (d) => d?.type === "ammo" || d?.type === "modification"
      );
      if (isWeapon && allWeaponAccepted) {
        return await original.call(this, itemData);
      }

      const current = foundry.utils.deepClone(this.getNestedItems());
      for (const og of itemData) {
        const dup = foundry.utils.deepClone(og);
        dup._id = foundry.utils.randomID();
        current.push(dup);
      }
      await this.setNestedItems(current);

      this.prepareNestedItems?.();
      this.prepareData?.();
      this.render?.(false);
      return true;
    } catch (e) {
      console.error("SR5-CF | patched createNestedItem failed", e);
      return false;
    }
  };

  log("createNestedItem patched: any item can now host any nested item as a modification.");
}

/* ------------------------------------------------------------------------ */
/* 2. ItemSheet UI                                                            */
/* ------------------------------------------------------------------------ */

function onRenderItemSheet(app, html) {
  if (!setting("enableUniversalMods")) return;
  const root = asElement(html);
  if (!root) return;
  const item = app.item;
  if (!item) return;
  // Skip items that already have native modification tabs (weapon, armor)
  if (item.type === "weapon" || item.type === "armor") return;
  if (item.limited && !game.user?.isGM) return;

  addModsNavLink(app, root, item);
  addModsSection(app, root, item);
}

function addModsNavLink(app, root, item) {
  const nav = root.querySelector('nav.sheet-tabs.tabs');
  if (!nav) return;
  if (nav.querySelector(`.${NAV_LINK_CLS}`)) return;

  const link = document.createElement("a");
  link.classList.add(NAV_LINK_CLS);
  link.dataset.action = "tab";
  link.dataset.group = "primary";
  link.dataset.tab = TAB_ID;
  link.dataset.tooltip = L("Modifications");
  link.innerHTML = `<i class="fa-solid fa-puzzle-piece"></i> ${L("ModsTabLabel")}`;

  link.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    activateOurTab(root);
  });
  nav.appendChild(link);

  // Intercept clicks on OTHER tabs so our custom section is hidden reliably.
  nav.addEventListener("click", (ev) => {
    const other = ev.target.closest('a[data-action="tab"]');
    if (!other || other.classList.contains(NAV_LINK_CLS)) return;
    const sect = root.querySelector(`section.tab[data-tab="${TAB_ID}"]`);
    if (sect) {
      sect.classList.remove("active");
      sect.style.display = "none";
    }
  });
}

function activateOurTab(root) {
  root.querySelectorAll('nav.sheet-tabs.tabs a[data-group="primary"]').forEach(a => a.classList.remove("active"));
  root.querySelectorAll('section.tab[data-group="primary"]').forEach(s => s.classList.remove("active"));

  const link = root.querySelector(`nav.sheet-tabs.tabs a.${NAV_LINK_CLS}`);
  const sect = root.querySelector(`section.tab[data-tab="${TAB_ID}"]`);
  link?.classList.add("active");
  if (sect) {
    sect.classList.add("active");
    sect.style.display = "";
  }
}

function addModsSection(app, root, item) {
  const form = root.querySelector("form") ?? root;
  const footer = form.querySelector("footer.sheet-footer");
  const lastTab = Array.from(form.querySelectorAll('section.tab[data-group="primary"]')).pop();

  form.querySelectorAll(`section.tab.${SECTION_CLS}`).forEach((s) => s.remove());

  const section = document.createElement("section");
  section.classList.add("tab", "hide-overflow", SECTION_CLS);
  section.dataset.group = "primary";
  section.dataset.tab = TAB_ID;

  const fill = document.createElement("div");
  fill.classList.add("fill-container");

  // Header bar with folder + add-item buttons
  const header = document.createElement("div");
  header.classList.add("list-item", "list-item-header", "header-for-scrollable");
  header.innerHTML = `
    <div class="list-item-content">
      <div class="list-item-name">${L("Modifications")}</div>
      <div class="list-item-icons">
        <a class="sr5cf-mod-add-folder" data-tooltip="${L("AddFolder")}"><i class="fa-solid fa-folder-plus"></i></a>
        <a class="sr5cf-mod-add-item" data-tooltip="${L("AddItem")}"><i class="fa-solid fa-plus"></i></a>
      </div>
    </div>
  `;
  fill.appendChild(header);

  header.querySelector(".sr5cf-mod-add-folder").addEventListener("click", (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    onCreateModFolder(app, item);
  });
  header.querySelector(".sr5cf-mod-add-item").addEventListener("click", (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    onCreateModItem(app, item);
  });

  // Scrollable item list
  const scroll = document.createElement("div");
  scroll.classList.add("scrollable", "sr5cf-mods-droptarget");
  scroll.dataset.sr5cfModsDrop = "1";

  const mods = item.items ?? [];
  const folders = getModFolders(item);
  const folderList = Object.values(folders);
  const buckets = new Map();
  folderList.forEach(f => buckets.set(f.id, []));
  const rootItems = [];

  mods.forEach(m => {
    const fid = getModItemFolder(item, m.id);
    if (fid && buckets.has(fid)) buckets.get(fid).push(m);
    else rootItems.push(m);
  });

  if (!mods.length) {
    const empty = document.createElement("div");
    empty.classList.add("sr5cf-mods-empty");
    empty.style.padding = "1em";
    empty.style.textAlign = "center";
    empty.style.opacity = "0.7";
    empty.textContent = L("DropAnyItemHere");
    scroll.appendChild(empty);
  } else {
    rootItems.forEach(m => scroll.appendChild(buildModRow(app, item, m)));
    folderList.forEach(f => {
      const wrapper = buildModFolder(app, item, f, buckets.get(f.id) ?? []);
      scroll.appendChild(wrapper);
    });
  }

  fill.appendChild(scroll);
  section.appendChild(fill);

  if (footer) footer.before(section);
  else if (lastTab) lastTab.after(section);
  else form.appendChild(section);

  const isActive = root.querySelector(`nav.sheet-tabs.tabs a[data-tab="${TAB_ID}"].active`);
  if (!isActive) {
    section.style.display = "none";
  } else {
    section.classList.add("active");
  }

  attachModDropHandlers(app, item, scroll, null);
}

/* ------------------------------------------------------------------------ */
/* Folder builders for ItemSheet Modifications tab                          */
/* ------------------------------------------------------------------------ */

function buildModFolder(app, item, folder, items) {
  const w = document.createElement("div");
  w.classList.add(FOLDER_WRAPPER_CLS);
  w.dataset.sr5cfFolderId = folder.id;

  const toggleIcon = folder.collapsed ? "fa-solid fa-caret-right" : "fa-solid fa-caret-down";

  const head = document.createElement("div");
  head.classList.add(FOLDER_HEADER_CLS);
  head.innerHTML = `
    <span class="sr5cf-folder-toggle"><i class="${toggleIcon}"></i></span>
    <span class="sr5cf-folder-name">${foundry.utils.escapeHTML(folder.name)}</span>
    <span class="sr5cf-folder-count">(${items.length})</span>
    <span class="sr5cf-folder-actions">
      <a data-action="sr5cf-rename" data-tooltip="${L("RenameFolder")}"><i class="fa-solid fa-pen-to-square"></i></a>
      <a data-action="sr5cf-delete" data-tooltip="${L("DeleteFolder")}"><i class="fa-solid fa-trash"></i></a>
    </span>
  `;

  head.addEventListener("click", (ev) => {
    if (ev.target.closest('[data-action="sr5cf-rename"]')) {
      ev.preventDefault(); ev.stopPropagation();
      return onRenameModFolder(app, item, folder);
    }
    if (ev.target.closest('[data-action="sr5cf-delete"]')) {
      ev.preventDefault(); ev.stopPropagation();
      return onDeleteModFolder(app, item, folder);
    }
    toggleModCollapse(app, item, folder);
  });

  const body = document.createElement("div");
  body.classList.add(FOLDER_BODY_CLS);
  if (folder.collapsed) body.style.display = "none";

  items.forEach(m => {
    const row = buildModRow(app, item, m);
    body.appendChild(row);
    addUnassignButton(row, item, m.id, app);
  });

  w.appendChild(head);
  w.appendChild(body);

  attachModDropHandlers(app, item, head, folder.id);
  attachModDropHandlers(app, item, body, folder.id);

  return w;
}

async function onCreateModFolder(app, item) {
  const name = await promptForName({title: L("AddFolder"), label: L("FolderName")});
  if (!name) return;
  const folders = getModFolders(item);
  if (Object.values(folders).some(f => f.name === name)) {
    ui.notifications?.warn(L("Errors.FolderExists"));
    return;
  }
  const id = uid();
  folders[id] = {id, name, collapsed: false};
  await setModFolders(item, folders);
  app.render({force: false});
}

async function onRenameModFolder(app, item, folder) {
  const name = await promptForName({title: L("RenameFolder"), label: L("FolderName"), initial: folder.name});
  if (!name) return;
  const folders = getModFolders(item);
  if (folders[folder.id]) {
    folders[folder.id].name = name;
    await setModFolders(item, folders);
    app.render({force: false});
  }
}

async function onDeleteModFolder(app, item, folder) {
  const ok = await confirm({title: L("DeleteFolder"), content: L("DeleteFolderConfirm")});
  if (!ok) return;
  await removeModFolder(item, folder.id);
  app.render({force: false});
}

async function toggleModCollapse(app, item, folder) {
  const folders = getModFolders(item);
  if (!folders[folder.id]) return;
  folders[folder.id].collapsed = !folders[folder.id].collapsed;
  await setModFolders(item, folders);
  app.render({force: false});
}

/* ------------------------------------------------------------------------ */
/* Mod row builder                                                            */
/* ------------------------------------------------------------------------ */

function addUnassignButton(el, item, itemId, app) {
  const icons = el.querySelector(".list-item-icons");
  if (!icons) return;
  if (icons.querySelector(".sr5cf-unassign")) return;
  const btn = document.createElement("a");
  btn.classList.add("sr5cf-unassign");
  btn.dataset.tooltip = L("RemoveFromFolder") || "Remove from folder";
  btn.innerHTML = `<i class="fa-solid fa-arrow-up-from-bracket"></i>`;
  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    await setModItemFolder(item, itemId, null);
    app.render({force: false});
  });
  icons.prepend(btn);
}

function buildModRow(app, parentItem, mod) {
  const row = document.createElement("div");
  row.classList.add("list-item-container");
  row.dataset.itemId = mod.id;
  row.dataset.uuid = mod.uuid;

  const equipped = mod.system?.technology?.equipped ?? false;
  const eqIcon = equipped ? "fa-solid fa-circle-check" : "fa-regular fa-circle";
  const eqTooltip = equipped ? L("Unequip") : L("Equip");
  const img = mod.img ?? "icons/svg/item-bag.svg";

  row.innerHTML = `
    <div class="list-item" draggable="true">
      <img src="${img}" style="width:24px;height:24px;margin-right:6px;" />
      ${foundry.utils.escapeHTML(mod.name)} [${mod.type}]
      <div class="list-item-icons">
        <a class="sr5cf-mod-toggle-equip" data-tooltip="${eqTooltip}"><i class="${eqIcon}"></i></a>
        <a class="sr5cf-mod-edit" data-tooltip="Edit"><i class="fa-solid fa-pen-to-square"></i></a>
        <a class="sr5cf-mod-delete" data-tooltip="Delete"><i class="fa-solid fa-trash"></i></a>
      </div>
    </div>
  `;

  const dragHandle = row.querySelector(".list-item");
  dragHandle.addEventListener("dragstart", (ev) => {
    try {
      ev.dataTransfer?.setData("application/x-sr5cf-mod", JSON.stringify({itemId: mod.id, uuid: mod.uuid}));
      ev.dataTransfer?.setData("text/plain", JSON.stringify({type: "Item", uuid: mod.uuid, id: mod.id}));
    } catch {}
  });

  row.querySelector(".sr5cf-mod-toggle-equip").addEventListener("click", async (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    await toggleModEquip(parentItem, mod);
    app.render({force: false});
  });
  row.querySelector(".sr5cf-mod-edit").addEventListener("click", (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    mod.sheet?.render({force: true});
  });
  row.querySelector(".sr5cf-mod-delete").addEventListener("click", async (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    await deleteNestedMod(parentItem, mod);
    app.render({force: false});
  });

  return row;
}

async function toggleModEquip(parentItem, mod) {
  const current = foundry.utils.deepClone(parentItem.getNestedItems());
  const target = current.find(m => m._id === mod.id);
  if (!target) return;
  const tech = foundry.utils.getProperty(target, "system.technology") ?? {};
  tech.equipped = !tech.equipped;
  foundry.utils.setProperty(target, "system.technology", tech);
  await parentItem.setNestedItems(current);
  parentItem.prepareNestedItems?.();
  parentItem.prepareData?.();
}

async function deleteNestedMod(parentItem, mod) {
  const current = foundry.utils.deepClone(parentItem.getNestedItems());
  const filtered = current.filter(m => m._id !== mod.id);
  await parentItem.setNestedItems(filtered);
  parentItem.prepareNestedItems?.();
  parentItem.prepareData?.();
}

/* ------------------------------------------------------------------------ */
/* Create nested item inline                                                  */
/* ------------------------------------------------------------------------ */

async function onCreateModItem(app, parentItem) {
  const types = Object.keys(CONFIG.Item.typeLabels ?? {});
  if (!types.length) {
    ui.notifications?.warn("No item types available.");
    return;
  }

  const type = await new Promise((resolve) => {
    const dlg = new foundry.applications.api.DialogV2({
      window: { title: L("CreateItem") },
      content: `
        <div style="display:flex;flex-direction:column;gap:8px;">
          <label>${game.i18n.localize("Type")}</label>
          <select name="itemType">
            ${types.map(t => `<option value="${t}">${game.i18n.localize(CONFIG.Item.typeLabels[t] ?? t)}</option>`).join("")}
          </select>
        </div>`,
      buttons: [
        {
          action: "ok",
          label: game.i18n.localize("Create"),
          default: true,
          callback: (event, button) => resolve(button.form.elements.itemType.value)
        },
        {
          action: "cancel",
          label: game.i18n.localize("Cancel"),
          callback: () => resolve(null)
        }
      ],
      close: () => resolve(null)
    });
    dlg.render({force: true});
  });

  if (!type) return;
  const itemData = {
    name: `${game.i18n.localize("SR5.New")} ${game.i18n.localize(CONFIG.Item.typeLabels[type] ?? type)}`,
    type
  };
  await parentItem.createNestedItem(itemData);
  app.render({force: false});
}

/* ------------------------------------------------------------------------ */
/* Drop handlers                                                              */
/* ------------------------------------------------------------------------ */

function attachModDropHandlers(app, parentItem, el, folderId) {
  el.addEventListener("dragenter", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    el.classList.add("sr5cf-drop-hover");
  });
  el.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.dataTransfer.dropEffect = "move";
  });
  el.addEventListener("dragleave", () => el.classList.remove("sr5cf-drop-hover"));
  el.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    el.classList.remove("sr5cf-drop-hover");

    let internal = null;
    try {
      const raw = ev.dataTransfer?.getData("application/x-sr5cf-mod");
      if (raw) internal = JSON.parse(raw);
    } catch {}
    if (!internal) {
      try {
        const raw = ev.dataTransfer?.getData("text/plain");
        if (raw) {
          const data = JSON.parse(raw);
          if (data?.type === "Item" && data.id) internal = {itemId: data.id, uuid: data.uuid};
        }
      } catch {}
    }

    if (internal?.itemId) {
      const current = getModItemFolder(parentItem, internal.itemId);
      if (current === folderId) return;
      await setModItemFolder(parentItem, internal.itemId, folderId);
      app.render({force: false});
      return;
    }

    // External drop — only on root scroll area
    if (folderId !== null) return;

    let raw;
    try { raw = ev.dataTransfer.getData("text/plain"); } catch { return; }
    if (!raw) return;
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    if (data?.type !== "Item") return;

    const droppedItem = await fromUuid(data.uuid);
    if (!droppedItem) return;
    if (droppedItem.id === parentItem.id) {
      ui.notifications?.warn("Cannot attach an item to itself.");
      return;
    }
    if (!setting("allowRecursiveMods") && parentItem._isNestedItem) {
      ui.notifications?.warn("Recursive modifications are disabled.");
      return;
    }

    const src = droppedItem.toObject();
    await parentItem.createNestedItem(src);
    app.render({force: false});
  });
}
