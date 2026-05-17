/**
 * Custom folders for ANY section on the character sheet (inventory & non-inventory).
 *
 * Storage:
 *   actor.flags["sr5-custom-folders"].tabFolders[scope] = {
 *     [folderId]: { id, name, collapsed: bool }
 *   }
 *   item.flags["sr5-custom-folders"].folderId[scope] = folderId
 *
 * Scope keys:
 *   - inventory sections: `inv::`
 *   - non-inventory sections: `type:`
 *
 * Why scoped? An item's "folder" depends on context. An item in inventory A
 * vs inventory B should be classified independently. Action-type sections
 * (actions, spells, etc.) have only one global list per type, so we just use
 * the type.
 *
 * Implementation:
 *   - Hook into renderSR5BaseActorSheet and its subclasses.
 *   - For each `.list-item.list-item-header` whose section type we can
 *     determine, inject a "+ Folder" button.
 *   - Collect the `.list-item-container` siblings that belong to the section
 *     and group them by their assigned folder, building collapsible wrappers.
 *   - Drag-and-drop: read the dragged item id off the inner `.list-item` (the
 *     element FoundryV2 marks as draggable). Drop on a folder header/body
 *     assigns the item to that folder; drop on the section header clears the
 *     assignment.
 */
import {
  L, asElement, uid, setting, log,
  getTabFolders, setTabFolders, getItemFolderId, setItemFolderId,
  promptForName, confirm
} from "./utils.js";

const ADD_FOLDER_CLS = "sr5cf-add-folder-section";
const FOLDER_WRAPPER_CLS = "sr5cf-folder";
const FOLDER_HEADER_CLS = "sr5cf-folder-header";
const FOLDER_BODY_CLS = "sr5cf-folder-body";

export function registerTabFolders() {
  Hooks.on("renderSR5BaseActorSheet", onRender);
  Hooks.on("renderSR5CharacterSheet", onRender);
  Hooks.on("renderSR5VehicleSheet", onRender);
  Hooks.on("renderSR5SpiritSheet", onRender);
  Hooks.on("renderSR5SpriteSheet", onRender);
  Hooks.on("renderSR5ICSheet", onRender);
}

/**
 * Build the scope key used to store folders + item-assignments for a given
 * section element on the sheet.
 *
 * For inventory sections we additionally key by the currently displayed
 * inventory name, because the same item type can appear in multiple
 * inventories (e.g. "weapon" appears in default inventory AND a custom one).
 */
function getSectionScope(app, header, type) {
  const inInventoryTab = !!header.closest('.tab[data-tab="inventory"]');
  if (inInventoryTab) {
    const inv = app.selectedInventory ?? app.actor?.defaultInventory?.name ?? "default";
    return `inv:${inv}:${type}`;
  }
  return `type:${type}`;
}

/**
 * Extract the item type associated with a section header. Works in both
 * play-mode (header carries data-item-type) and edit-mode (the Add button
 * inside it does).
 * Also checks data-sr5cf-type as a fallback for sections where the system
 * header doesn't carry the type explicitly (e.g. matrix programs).
 */
function getHeaderType(header) {
  if (header.dataset?.itemType) return header.dataset.itemType;
  const add = header.querySelector('a[data-action="addItem"][data-item-type]');
  if (add?.dataset?.itemType) return add.dataset.itemType;
  // Fallback: check if we set it ourselves earlier
  return header.dataset?.sr5cfType ?? null;
}

function onRender(app, html /*, data*/) {
  if (!setting("enableFolders")) return;
  const root = asElement(html);
  if (!root || !app.actor) return;

  const headers = root.querySelectorAll(".list-item.list-item-header");
  headers.forEach((header) => {
    const type = getHeaderType(header);
    if (!type) return; // not a typed-section header (e.g. inventory selector row)
    if (header.dataset.sr5cfDone === "1") return;
    header.dataset.sr5cfDone = "1";

    const scope = getSectionScope(app, header, type);
    injectFolderButton(app, header, type, scope);
    const itemEls = collectSectionItems(header);
    renderFoldersForSection(app, header, type, scope, itemEls);
  });
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

  // Also turn the header into a drop target — dropping here clears the
  // item's assignment for this scope (move-to-root).
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
  folders[id] = {id, name, collapsed: false};
  await setTabFolders(app.actor, scope, folders);
  app.render({force: true});
}

/* ------------------------------------------------------------------------ */

/**
 * Walk siblings after `header` and collect `.list-item-container` nodes that
 * belong to this section. Stop at the next list-item-header.
 */
function collectSectionItems(header) {
  const out = [];
  let n = header.nextElementSibling;
  while (n) {
    if (n.classList?.contains("list-item-header")) break;
    if (n.matches?.(".list-item.list-item-header")) break;
    if (n.classList?.contains("list-item-container")) out.push(n);
    n = n.nextElementSibling;
  }
  return out;
}

function renderFoldersForSection(app, header, type, scope, itemEls) {
  const actor = app.actor;
  const folders = getTabFolders(actor, scope);
  const folderList = Object.values(folders);

  // Make every item draggable wrt our system.
  // KEY FIX: use `.list-item` (not `.list-item.draggable`) and explicitly set
  // draggable="true" so that items without the `draggable` class (e.g. actions,
  // matrix programs) can still be dragged into folders.
  itemEls.forEach((el) => {
    const dragHandle = el.querySelector(".list-item") ?? el;
    if (dragHandle.dataset.sr5cfDragged !== "1") {
      dragHandle.dataset.sr5cfDragged = "1";
      // Ensure the element is actually draggable
      dragHandle.setAttribute("draggable", "true");
      dragHandle.addEventListener("dragstart", onItemDragStart);
    }
  });

  // Bucketize.
  const buckets = new Map();
  folderList.forEach((f) => buckets.set(f.id, []));
  const rootBucket = [];
  itemEls.forEach((el) => {
    const dragHandle = el.querySelector(".list-item") ?? el;
    const itemId = dragHandle.dataset.itemId ?? el.dataset.itemId;
    const item = actor.items.get(itemId);
    const fid = item ? getItemFolderId(item, scope) : null;
    if (fid && buckets.has(fid)) buckets.get(fid).push(el);
    else rootBucket.push(el);
  });

  // Drop any prior folder wrappers we left behind for this scope.
  const parent = header.parentElement;
  if (!parent) return;
  let n = header.nextSibling;
  while (n) {
    const next = n.nextSibling;
    if (n.nodeType === 1
      && n.classList?.contains(FOLDER_WRAPPER_CLS)
      && n.dataset.sr5cfScope === scope) {
      n.remove();
    } else if (n.nodeType === 1 && n.classList?.contains("list-item-header")) {
      break;
    }
    n = next;
  }

  // Re-insert: root items right after header (preserving order), then folders.
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
}

function buildFolderWrapper(app, type, scope, folder, items) {
  const w = document.createElement("div");
  w.classList.add(FOLDER_WRAPPER_CLS);
  w.dataset.sr5cfScope = scope;
  w.dataset.sr5cfFolderId = folder.id;

  // FIX: Use fa-solid prefix (FA6) instead of "fas fa-solid" which is invalid
  const toggleIcon = folder.collapsed ? "fa-solid fa-caret-right" : "fa-solid fa-caret-down";

  const head = document.createElement("div");
  head.classList.add(FOLDER_HEADER_CLS);
  head.innerHTML = `
    <span class="sr5cf-folder-toggle"><i class="${toggleIcon}"></i></span>
    <span class="sr5cf-folder-name">FOLDER_NAME</span>
    <span class="sr5cf-folder-count">(${items.length})</span>
    <span class="sr5cf-folder-actions">
      <a data-action="sr5cf-rename" data-tooltip="${L("RenameFolder")}"><i class="fa-solid fa-pen-to-square"></i></a>
      <a data-action="sr5cf-delete" data-tooltip="${L("DeleteFolder")}"><i class="fa-solid fa-trash"></i></a>
    </span>
  `;
  head.querySelector(".sr5cf-folder-name").textContent = folder.name;

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
  const folders = getTabFolders(app.actor, scope);
  if (!folders[folder.id]) return;
  folders[folder.id].collapsed = !folders[folder.id].collapsed;
  await setTabFolders(app.actor, scope, folders);
  app.render({force: false});
}

async function onRenameFolder(app, scope, folder) {
  const name = await promptForName({
    title: L("RenameFolder"),
    label: L("FolderName"),
    initial: folder.name
  });
  if (!name) return;
  const folders = getTabFolders(app.actor, scope);
  if (folders[folder.id]) {
    folders[folder.id].name = name;
    await setTabFolders(app.actor, scope, folders);
    app.render({force: false});
  }
}

async function onDeleteFolder(app, scope, folder) {
  const ok = await confirm({title: L("DeleteFolder"), content: L("DeleteFolderConfirm")});
  if (!ok) return;
  const folders = getTabFolders(app.actor, scope);
  delete folders[folder.id];
  await setTabFolders(app.actor, scope, folders);

  // Clear assignment from any items pointing here.
  const itemUpdates = [];
  for (const it of app.actor.items) {
    const fid = getItemFolderId(it, scope);
    if (fid === folder.id) {
      const map = foundry.utils.deepClone(it.getFlag("sr5-custom-folders", "folderId") ?? {});
      delete map[scope];
      itemUpdates.push({_id: it.id, [`flags.sr5-custom-folders.folderId`]: map});
    }
  }
  if (itemUpdates.length) {
    await app.actor.updateEmbeddedDocuments("Item", itemUpdates);
  }
  app.render({force: false});
}

/* -------------------------------- drag & drop -------------------------------- */

/**
 * On dragstart for any sheet item row, stash our own JSON payload AND keep the
 * core payload intact. The element bound here is the inner `.list-item`.
 */
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
  } catch {
    /* ignore — some browsers restrict custom mime types in some contexts */
  }
}

function attachDropHandlers(app, el, scope, folderId /* string|null */) {
  el.addEventListener("dragenter", (ev) => {
    ev.preventDefault();
    el.classList.add("sr5cf-drop-hover");
  });
  el.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
  });
  el.addEventListener("dragleave", () => el.classList.remove("sr5cf-drop-hover"));
  el.addEventListener("drop", async (ev) => {
    el.classList.remove("sr5cf-drop-hover");

    // Resolve which actor-owned item is being dropped.
    // Priority 1: our custom mime (set in dragstart above).
    let ourItemId = null;
    try {
      const raw = ev.dataTransfer?.getData("application/x-sr5cf-item");
      if (raw) {
        const parsed = JSON.parse(raw);
        ourItemId = parsed?.itemId ?? null;
      }
    } catch {}

    // Priority 2: core text/plain payload (sidebar / compendium / cross-sheet).
    if (!ourItemId) {
      try {
        const txt = ev.dataTransfer?.getData("text/plain");
        if (txt) {
          const data = JSON.parse(txt);
          if (data?.type === "Item" && data.uuid) {
            const dropped = await fromUuid(data.uuid);
            if (dropped?.parent?.id === app.actor.id) {
              ourItemId = dropped.id;
            }
            // If dropped from outside this actor, let core
            // handle the actual item creation; we'll just bail.
          }
        }
      } catch {}
    }

    if (!ourItemId) return; // let core handle foreign drops

    ev.preventDefault();
    ev.stopPropagation();

    const item = app.actor.items.get(ourItemId);
    if (!item) return;

    // Scope encodes the section type — only accept items of that type.
    const expectedType = scope.split(":").pop();
    if (item.type !== expectedType) {
      ui.notifications?.info(
        `Item of type "${item.type}" cannot go into a "${expectedType}" folder.`
      );
      return;
    }

    const currentFid = getItemFolderId(item, scope);
    if (currentFid === folderId) return;
    await setItemFolderId(item, scope, folderId);
    app.render({force: false});
  });
}
