/**
 * Custom folders for non-inventory sections on the character sheet.
 */
import {
  L, asElement, uid, setting, log, MODULE_ID, FLAGS,
  getTabFolders, getItemFolderId, setItemFolderId,
  resolveFolderName, isFolderDeleted,
  promptForName, confirm
} from "./utils.js";

const ADD_FOLDER_CLS = "sr5cf-add-folder-section";
const FOLDER_WRAPPER_CLS = "sr5cf-folder";
const FOLDER_HEADER_CLS = "sr5cf-folder-header";
const FOLDER_BODY_CLS = "sr5cf-folder-body";

const PSEUDO_TYPE_MAP = {
  matrix_action: "action",
  combatspells: "spell",
  detectionspells: "spell",
  healthspells: "spell",
  illusionspells: "spell",
  manipulationspells: "spell",
  ritualspells: "spell",
  summonings: "call_in_action",
  compilations: "call_in_action",
};

function realType(pseudo) {
  return PSEUDO_TYPE_MAP[pseudo] ?? pseudo;
}

export function registerTabFolders() {
  Hooks.on("renderSR5BaseActorSheet", onRender);
  Hooks.on("renderSR5CharacterSheet", onRender);
  Hooks.on("renderSR5VehicleSheet", onRender);
  Hooks.on("renderSR5SpiritSheet", onRender);
  Hooks.on("renderSR5SpriteSheet", onRender);
  Hooks.on("renderSR5ICSheet", onRender);
}

function getSectionScope(app, header, type) {
  const inInventoryTab = !!header.closest('.tab[data-tab="inventory"]');
  if (inInventoryTab) {
    const inv = app.selectedInventory ?? app.actor?.defaultInventory?.name ?? "default";
    return `inv:${inv}:${type}`;
  }
  return `type:${type}`;
}

function getHeaderType(header, app) {
  if (header.dataset?.itemType) return header.dataset.itemType;
  const add = header.querySelector('a[data-action="addItem"][data-item-type]');
  if (add?.dataset?.itemType) return add.dataset.itemType;

  const container = getItemsContainer(header);
  if (container && app?.actor) {
    const first = container.querySelector('.list-item[data-item-id], .list-item[data-uuid]');
    if (first) {
      const id = first.dataset.itemId;
      if (id) {
        const item = app.actor.items.get(id);
        if (item) return item.type;
      }
      const uuid = first.dataset.uuid;
      if (uuid && typeof fromUuidSync === "function") {
        try {
          const doc = fromUuidSync(uuid);
          if (doc) return doc.type;
        } catch {}
      }
    }
  }
  return null;
}

async function onRender(app, html) {
  if (!setting("enableFolders")) return;
  const root = asElement(html);
  if (!root || !app.actor) return;

  const headers = root.querySelectorAll(".list-item.list-item-header");
  for (const header of headers) {
    if (!header.closest("section.tab")) continue;
    if (header.closest('.tab[data-tab="inventory"]')) continue;

    let type = getHeaderType(header, app);
    if (!type) continue;

    const container = getItemsContainer(header);
    if (type === "action" && container?.id === "matrix-actions-scroll") type = "matrix_action";

    // Action sections (General / Matrix / IC) are rendered live from the
    // system compendia, not as actor-owned items. Their folders are mirrored
    // read-only from the compendium by action-folders.js, so skip them here to
    // avoid the (non-functional) flag-based folder UI on these sections.
    if (type === "action" || type === "matrix_action") continue;

    if (header.dataset.sr5cfDone === "1") continue;
    header.dataset.sr5cfDone = "1";

    const scope = getSectionScope(app, header, type);
    injectFolderButton(app, header, type, scope);
    const itemEls = collectSectionItems(header);
    await renderFoldersForSection(app, header, type, scope, itemEls);
  }
}

/* ------------------------------------------------------------------------ */

function injectFolderButton(app, header, type, scope) {
  const iconsContainer = header.querySelector(".list-item-icons") ?? header;
  const btn = document.createElement("a");
  btn.classList.add(ADD_FOLDER_CLS);
  btn.dataset.tooltip = L("AddFolderHere");
  btn.innerHTML = `<i class="fa-solid fa-folder-plus"></i>`;
  btn.style.marginRight = "4px";
  btn.addEventListener("click", (ev) => onCreateFolder(ev, app, type, scope));
  iconsContainer.prepend(btn);

  header.dataset.sr5cfDropScope = scope;
  attachDropHandlers(app, header, scope, null);
}

async function onCreateFolder(ev, app, type, scope) {
  ev.preventDefault();
  ev.stopPropagation();
  const name = await promptForName({title: L("AddFolder"), label: L("FolderName")});
  if (!name) return;

  const folders = getTabFolders(app.actor, scope);
  if (Object.values(folders).some((f) => f.name === name)) {
    ui.notifications?.warn(L("Errors.FolderExists"));
    return;
  }
  const id = uid();
  await app.actor.update({
    [`flags.${MODULE_ID}.${FLAGS.TabFolders}.${scope}.${id}`]: {id, name, collapsed: false}
  });
  app.render({force: true});
}

/* ------------------------------------------------------------------------ */

function getItemsContainer(header) {
  const next = header.nextElementSibling;
  if (next && next.classList?.contains("scrollable")) return next;
  const parent = header.parentElement;
  if (parent && parent.classList?.contains("scrollable")) return parent;
  return parent;
}

function collectSectionItems(header) {
  const container = getItemsContainer(header);
  const out = [];
  if (!container) return out;

  if (container === header.parentElement && !container.classList?.contains("scrollable")) {
    let n = header.nextElementSibling;
    while (n) {
      if (n.classList?.contains("list-item-header")) break;
      if (n.matches?.(".list-item.list-item-header")) break;
      if (n.classList?.contains("list-item-container")) out.push(n);
      n = n.nextElementSibling;
    }
    return out;
  }

  const children = Array.from(container.children);
  const idx = children.indexOf(header);

  if (idx === -1) {
    return Array.from(container.querySelectorAll(":scope > .list-item-container"));
  }

  for (let i = idx + 1; i < children.length; i++) {
    const child = children[i];
    if (child.classList?.contains("list-item-header") || child.matches?.(".list-item.list-item-header")) break;
    if (child.classList?.contains("list-item-container")) out.push(child);
  }
  return out;
}

async function cleanupDeletedFolders(actor, scope) {
  const folders = getTabFolders(actor, scope);
  const deletedIds = [];
  for (const [fid, folder] of Object.entries(folders)) {
    if (folder.compFolderId && isFolderDeleted(folder)) {
      deletedIds.push(fid);
    }
  }
  if (!deletedIds.length) return;

  const update = {};
  for (const fid of deletedIds) {
    update[`flags.${MODULE_ID}.${FLAGS.TabFolders}.${scope}.-=${fid}`] = null;
    const assignments = (actor.getFlag(MODULE_ID, "folderAssignments") ?? {})[scope] ?? {};
    for (const [itemId, itemFid] of Object.entries(assignments)) {
      if (itemFid === fid) {
        update[`flags.${MODULE_ID}.folderAssignments.${scope}.-=${itemId}`] = null;
      }
    }
  }
  await actor.update(update);
}

async function renderFoldersForSection(app, header, type, scope, itemEls) {
  const actor = app.actor;
  await cleanupDeletedFolders(actor, scope);

  const folders = getTabFolders(actor, scope);
  const folderList = Object.values(folders);

  itemEls.forEach((el) => {
    const dragHandle = el.querySelector(".list-item") ?? el;
    if (dragHandle.dataset.sr5cfDragged !== "1") {
      dragHandle.dataset.sr5cfDragged = "1";
      dragHandle.setAttribute("draggable", "true");
      dragHandle.addEventListener("dragstart", onItemDragStart);
    }
  });

  const buckets = new Map();
  folderList.forEach((f) => buckets.set(f.id, []));
  const rootBucket = [];
  itemEls.forEach((el) => {
    const dragHandle = el.querySelector(".list-item") ?? el;
    const itemId = dragHandle.dataset.itemId ?? el.dataset.itemId;
    const fid = getItemFolderId(itemId, scope, actor);
    if (fid && buckets.has(fid)) buckets.get(fid).push(el);
    else rootBucket.push(el);
  });

  const container = getItemsContainer(header);
  if (!container) return;

  container.querySelectorAll(`:scope > .${FOLDER_WRAPPER_CLS}`).forEach((el) => {
    if (el.dataset.sr5cfScope === scope) el.remove();
  });

  if (!container.contains(header)) {
    let n = header.nextSibling;
    while (n) {
      const next = n.nextSibling;
      if (n.nodeType === 1 && n.classList?.contains(FOLDER_WRAPPER_CLS) && n.dataset.sr5cfScope === scope) {
        n.remove();
      } else if (n.nodeType === 1 && (n.classList?.contains("list-item-header") || n.matches?.(".list-item.list-item-header"))) {
        break;
      }
      n = next;
    }
  }

  if (container.contains(header)) {
    let cursor = header;
    rootBucket.forEach((el) => {
      cursor.after(el);
      cursor = el;
    });
    folderList.forEach((f) => {
      const wrapper = buildFolderWrapper(app, type, scope, f, buckets.get(f.id) ?? []);
      cursor.after(wrapper);
      cursor = wrapper;
    });
  } else {
    for (let i = rootBucket.length - 1; i >= 0; i--) {
      container.prepend(rootBucket[i]);
    }
    folderList.forEach((f) => {
      const wrapper = buildFolderWrapper(app, type, scope, f, buckets.get(f.id) ?? []);
      container.appendChild(wrapper);
    });
  }

  // Entire container acts as a root drop target (unassigns items)
  attachDropHandlers(app, container, scope, null);
}

function buildFolderWrapper(app, type, scope, folder, items) {
  const w = document.createElement("div");
  w.classList.add(FOLDER_WRAPPER_CLS);
  w.dataset.sr5cfScope = scope;
  w.dataset.sr5cfFolderId = folder.id;

  const liveName = resolveFolderName(folder);
  const displayName = liveName ?? folder.name;

  const toggleIcon = folder.collapsed ? "fa-solid fa-caret-right" : "fa-solid fa-caret-down";

  const head = document.createElement("div");
  head.classList.add(FOLDER_HEADER_CLS);
  head.innerHTML = `
    <span class="sr5cf-folder-toggle"><i class="${toggleIcon}"></i></span>
    <span class="sr5cf-folder-name">${foundry.utils.escapeHTML(displayName)}</span>
    <span class="sr5cf-folder-count">(${items.length})</span>
    <span class="sr5cf-folder-actions">
      <a data-action="sr5cf-rename" data-tooltip="${L("RenameFolder")}"><i class="fa-solid fa-pen-to-square"></i></a>
      <a data-action="sr5cf-delete" data-tooltip="${L("DeleteFolder")}"><i class="fa-solid fa-trash"></i></a>
    </span>
  `;

  head.addEventListener("click", (ev) => {
    if (ev.target.closest('[data-action="sr5cf-rename"]')) {
      ev.preventDefault(); ev.stopPropagation();
      return onRenameFolder(app, scope, folder);
    }
    if (ev.target.closest('[data-action="sr5cf-delete"]')) {
      ev.preventDefault(); ev.stopPropagation();
      return onDeleteFolder(app, scope, folder);
    }
    toggleCollapse(app, scope, folder);
  });

  const body = document.createElement("div");
  body.classList.add(FOLDER_BODY_CLS);
  if (folder.collapsed) body.style.display = "none";
  items.forEach((el) => body.appendChild(el));

  w.appendChild(head);
  w.appendChild(body);

  attachDropHandlers(app, head, scope, folder.id);
  attachDropHandlers(app, body, scope, folder.id);

  return w;
}

async function toggleCollapse(app, scope, folder) {
  const collapsed = !(folder.collapsed ?? false);
  await app.actor.update({
    [`flags.${MODULE_ID}.${FLAGS.TabFolders}.${scope}.${folder.id}.collapsed`]: collapsed
  });
  app.render({force: true});
}

async function onRenameFolder(app, scope, folder) {
  const name = await promptForName({
    title: L("RenameFolder"),
    label: L("FolderName"),
    initial: folder.name
  });
  if (!name) return;
  const update = {
    [`flags.${MODULE_ID}.${FLAGS.TabFolders}.${scope}.${folder.id}.name`]: name
  };
  // Unlink from compendium/world source so the new name sticks
  if (folder.compFolderId) {
    update[`flags.${MODULE_ID}.${FLAGS.TabFolders}.${scope}.${folder.id}.compFolderId`] = null;
    update[`flags.${MODULE_ID}.${FLAGS.TabFolders}.${scope}.${folder.id}.compPack`] = null;
  }
  await app.actor.update(update);
  app.render({force: true});
}

async function onDeleteFolder(app, scope, folder) {
  try {
    const ok = await confirm({title: L("DeleteFolder"), content: L("DeleteFolderConfirm")});
    if (!ok) return;

    const update = {
      [`flags.${MODULE_ID}.${FLAGS.TabFolders}.${scope}.-=${folder.id}`]: null
    };

    const assignments = (app.actor.getFlag(MODULE_ID, "folderAssignments") ?? {})[scope] ?? {};
    for (const [itemId, fid] of Object.entries(assignments)) {
      if (fid === folder.id) {
        update[`flags.${MODULE_ID}.folderAssignments.${scope}.-=${itemId}`] = null;
      }
    }

    await app.actor.update(update);

    const legacyUpdates = [];
    for (const item of app.actor.items) {
      const map = item.getFlag(MODULE_ID, FLAGS.ItemFolderAssignment) ?? {};
      if (map[scope] === folder.id) {
        const cleaned = foundry.utils.deepClone(map);
        delete cleaned[scope];
        legacyUpdates.push({
          _id: item.id,
          [`flags.${MODULE_ID}.${FLAGS.ItemFolderAssignment}`]: cleaned,
        });
      }
    }
    if (legacyUpdates.length) {
      await app.actor.updateEmbeddedDocuments("Item", legacyUpdates);
    }

    app.render({force: true});
  } catch (err) {
    console.error("SR5-CF | onDeleteFolder failed:", err);
    ui.notifications?.error("SR5-CF | Failed to delete folder. See console.");
  }
}

/* -------------------------------- drag & drop -------------------------------- */

function onItemDragStart(ev) {
  const handle = ev.currentTarget;
  const itemId = handle?.dataset?.itemId;
  const uuid = handle?.dataset?.uuid;
  if (!itemId) return;
  try {
    ev.dataTransfer?.setData(
      "application/x-sr5cf-item",
      JSON.stringify({itemId, uuid})
    );
    ev.dataTransfer?.setData(
      "text/plain",
      JSON.stringify({type: "Item", uuid, id: itemId})
    );
  } catch {
    /* ignore */
  }
}

function attachDropHandlers(app, el, scope, folderId) {
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
    el.classList.remove("sr5cf-drop-hover");

    let payload = null;
    try {
      const raw = ev.dataTransfer?.getData("application/x-sr5cf-item");
      if (raw) payload = JSON.parse(raw);
    } catch {}

    if (!payload) {
      try {
        const raw = ev.dataTransfer?.getData("text/plain");
        if (raw) {
          const data = JSON.parse(raw);
          if (data?.type === "Item" && (data.id || data.uuid)) {
            payload = {itemId: data.id || data.uuid, uuid: data.uuid};
          }
        }
      } catch {}
    }

    if (!payload?.itemId) return;

    // Foreign drop (other sheet / compendium / sidebar): let Foundry create it first
    const existingItem = app.actor.items.get(payload.itemId);
    if (!existingItem) return;

    ev.preventDefault();
    ev.stopPropagation();

    const expectedType = realType(scope.split(":").pop());

    let item = app.actor.items.get(payload.itemId);
    if (!item && payload.uuid) {
      try { item = await fromUuid(payload.uuid); } catch {}
    }
    if (item && item.type !== expectedType) {
      ui.notifications?.info(
        `Item of type "${item.type}" cannot go into a "${expectedType}" folder.`
      );
      return;
    }

    const currentFid = getItemFolderId(payload.itemId, scope, app.actor);
    if (currentFid === folderId) return;

    await setItemFolderId({id: payload.itemId}, scope, folderId, app.actor);
    app.render({force: true});
  });
}

/* ------------------------------------------------------------------------ */
/* Compendium / world folder import                                         */
/* ------------------------------------------------------------------------ */

function findInTree(nodes, folderId) {
  if (!nodes) return null;
  for (const n of nodes) {
    if (n.id === folderId || n._id === folderId) return n;
    if (n.children) {
      const found = findInTree(n.children, folderId);
      if (found) return found;
    }
    if (n.document?.id === folderId) return n.document;
  }
  return null;
}

function extractFolderInfo(doc) {
  if (!doc?.folder) return null;

  if (typeof doc.folder === "object") {
    return {
      name: doc.folder.name,
      compFolderId: doc.folder.id,
      compPack: doc.folder.pack || doc.pack || null
    };
  }

  const folderId = doc.folder;
  const docPack = doc.pack || null;

  if (docPack) {
    const pack = game.packs.get(docPack);
    if (pack) {
      if (pack.folders?.size) {
        const f = pack.folders.get(folderId);
        if (f?.name) return { name: f.name, compFolderId: folderId, compPack: docPack };
      }
      if (pack.tree?.folders) {
        const node = findInTree(pack.tree.folders, folderId);
        if (node?.name) return { name: node.name, compFolderId: folderId, compPack: docPack };
        if (node?.document?.name) return { name: node.document.name, compFolderId: folderId, compPack: docPack };
      }
    }
  }

  const wf = game.folders?.get(folderId);
  if (wf) return { name: wf.name, compFolderId: folderId, compPack: null };

  return null;
}

async function ensureFolderAndAssign(item, actor, folderInfo, skipIfAssigned = false) {
  const scope = `type:${item.type}`;

  if (skipIfAssigned) {
    const current = getItemFolderId(item.id, scope, actor);
    if (current !== null) return;
  }

  const folders = getTabFolders(actor, scope);
  let fid = Object.values(folders).find(f => f.name === folderInfo.name)?.id;

  if (!fid) {
    fid = uid();
    await actor.update({
      [`flags.${MODULE_ID}.${FLAGS.TabFolders}.${scope}.${fid}`]: {
        id: fid,
        name: folderInfo.name,
        collapsed: false,
        compFolderId: folderInfo.compFolderId || null,
        compPack: folderInfo.compPack || null
      }
    });
  }

  await setItemFolderId(item, scope, fid, actor);
}

export function registerCompendiumFolderImport() {
  Hooks.once("ready", () => {
    if (!setting("enableFolders")) return;

    // 1. Primary path: createItem hook catches ALL items created on an actor,
    //    including drag-and-drop, import, and programmatic creation.
    Hooks.on("createItem", async (item, options, userId) => {
      const actor = item.parent;
      if (!actor || !(actor instanceof Actor)) return;
      if (item.pack) return; // ignore compendium-internal items

      const sourceUuid = item._stats?.compendiumSource;
      if (!sourceUuid) return;

      try {
        const sourceDoc = await fromUuid(sourceUuid);
        if (!sourceDoc || !(sourceDoc instanceof Item)) return;

        const folderInfo = extractFolderInfo(sourceDoc);
        if (!folderInfo?.name) return;

        await ensureFolderAndAssign(item, actor, folderInfo);
      } catch (e) {
        console.error("SR5-CF | createItem folder import failed:", e);
      }
    });

    // 2. Fallback: _onDropItem for world→actor drops where compendiumSource
    //    may be absent but the resolved item carries a folder directly.
    const ActorSheetV2 = foundry.applications.sheets.ActorSheetV2;
    if (ActorSheetV2?.prototype?._onDropItem) {
      const _orig = ActorSheetV2.prototype._onDropItem;
      ActorSheetV2.prototype._onDropItem = async function(event, item) {
        const result = await _orig.call(this, event, item);
        if (!result || !this.actor || !item?.folder) return result;

        const created = Array.isArray(result) ? result : [result];
        const folderInfo = extractFolderInfo(item);
        if (!folderInfo?.name) return result;

        for (const doc of created) {
          if (!(doc instanceof Item)) continue;
          await ensureFolderAndAssign(doc, this.actor, folderInfo, true);
        }
        this.render({force: true});
        return result;
      };
    }

    log("Compendium/world folder import hooks registered.");
  });
}
