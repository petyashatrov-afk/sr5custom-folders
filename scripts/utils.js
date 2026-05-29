/**
 * Shared helpers for SR5 Custom Folders.
 */
export const MODULE_ID = "sr5-custom-folders";

export const FLAGS = {
  TabFolders: "tabFolders",
  InventorySectionFolders: "inventorySectionFolders",
  ItemFolderAssignment: "folderId",
};

export function L(key, data) {
  const txt = game.i18n.localize(`SR5CF.${key}`);
  return data ? game.i18n.format(`SR5CF.${key}`, data) : txt;
}

export function uid() {
  return foundry.utils.randomID(16);
}

export async function promptForName({title, label, initial = ""} = {}) {
  title = title ?? L("AddFolder");
  label = label ?? L("FolderNamePrompt");

  const content = `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <label>${label}</label>
      <input type="text" name="folderName" value="${initial}" autofocus />
    </div>`;

  return await new Promise((resolve) => {
    const dlg = new foundry.applications.api.DialogV2({
      window: {title},
      content,
      buttons: [
        {
          action: "ok",
          label: L("CreateFolder"),
          default: true,
          callback: (event, button) => {
            const input = button.form.elements.folderName;
            const val = (input?.value ?? "").trim();
            resolve(val.length ? val : null);
          }
        },
        {
          action: "cancel",
          label: game.i18n.localize("Cancel"),
          callback: () => resolve(null)
        }
      ],
      rejectClose: false,
      close: () => resolve(null)
    });
    dlg.render({force: true});
  });
}

export async function confirm({title, content}) {
  return await foundry.applications.api.DialogV2.confirm({
    window: {title},
    content: `<p>${content}</p>`,
    rejectClose: false,
    modal: true
  });
}

export function getTabFolders(actor, tabId) {
  const all = actor.getFlag(MODULE_ID, FLAGS.TabFolders) ?? {};
  return foundry.utils.deepClone(all[tabId] ?? {});
}

/* ------------------------------------------------------------------------ */
/* Folder name resolution (sync) — used during render loop                */
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

export function resolveFolderName(folder) {
  if (!folder) return null;

  // Compendium pack folder
  if (folder.compFolderId && folder.compPack) {
    const pack = game.packs.get(folder.compPack);
    if (pack) {
      if (pack.folders?.size) {
        const f = pack.folders.get(folder.compFolderId);
        if (f?.name) return f.name;
      }
      if (pack.tree?.folders) {
        const node = findInTree(pack.tree.folders, folder.compFolderId);
        if (node?.name) return node.name;
        if (node?.document?.name) return node.document.name;
      }
    }
    return folder.name ?? null;
  }

  // World folder
  if (folder.compFolderId && !folder.compPack) {
    const wf = game.folders?.get(folder.compFolderId);
    if (wf) return wf.name;
    return folder.name ?? null;
  }

  return folder.name ?? null;
}

export function isFolderDeleted(folder) {
  if (!folder?.compFolderId) return false;
  const pack = folder.compPack ? game.packs.get(folder.compPack) : null;
  if (!pack && folder.compPack) return true;
  if (folder.compPack && pack) {
    if (pack.folders?.size && pack.folders.get(folder.compFolderId)) return false;
    if (pack.tree?.folders && findInTree(pack.tree.folders, folder.compFolderId)) return false;
    return true;
  }
  if (!folder.compPack && !game.folders?.get(folder.compFolderId)) return true;
  return false;
}

/**
 * Get an item's assigned folder id.
 * Accepts either an Item document or a raw item id string.
 */
export function getItemFolderId(itemOrId, scope, actor) {
  const id = (typeof itemOrId === "string") ? itemOrId : itemOrId?.id;
  if (actor && id) {
    const actorMap = actor.getFlag(MODULE_ID, "folderAssignments") ?? {};
    if (actorMap[scope]?.[id] !== undefined) {
      return actorMap[scope][id] ?? null;
    }
  }
  if (typeof itemOrId !== "string" && itemOrId?.getFlag) {
    const map = itemOrId.getFlag(MODULE_ID, FLAGS.ItemFolderAssignment) ?? {};
    return map[scope] ?? null;
  }
  return null;
}

export async function setItemFolderId(item, scope, folderId, actor) {
  if (actor && item?.id) {
    if (folderId === null || folderId === undefined) {
      return actor.update({ [`flags.${MODULE_ID}.folderAssignments.${scope}.-=${item.id}`]: null });
    }
    return actor.update({ [`flags.${MODULE_ID}.folderAssignments.${scope}.${item.id}`]: folderId });
  }
  const map = foundry.utils.deepClone(item.getFlag?.(MODULE_ID, FLAGS.ItemFolderAssignment) ?? {});
  if (folderId === null || folderId === undefined) delete map[scope];
  else map[scope] = folderId;
  return item.setFlag?.(MODULE_ID, FLAGS.ItemFolderAssignment, map);
}

export function asElement(el) {
  if (!el) return null;
  if (el instanceof HTMLElement) return el;
  if (el.jquery) return el[0];
  return el;
}

export function setting(key) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return undefined;
  }
}

export function log(...args) {
  console.log("SR5-CF |", ...args);
}

/* --------------------- Item-sheet modification folders --------------------- */

export function getModFolders(item) {
  return foundry.utils.deepClone(item.getFlag(MODULE_ID, "modFolders") ?? {});
}

export async function setModFolders(item, folders) {
  return item.setFlag(MODULE_ID, "modFolders", folders);
}

export function getModItemFolder(item, itemId) {
  return (item.getFlag(MODULE_ID, "modItemFolders") ?? {})[itemId] ?? null;
}

export async function setModItemFolder(item, itemId, folderId) {
  if (folderId === null || folderId === undefined) {
    return item.update({ [`flags.${MODULE_ID}.modItemFolders.-=${itemId}`]: null });
  }
  return item.update({ [`flags.${MODULE_ID}.modItemFolders.${itemId}`]: folderId });
}

export async function removeModFolder(item, folderId) {
  const update = { [`flags.${MODULE_ID}.modFolders.-=${folderId}`]: null };
  const assignments = item.getFlag(MODULE_ID, "modItemFolders") ?? {};
  for (const [id, fid] of Object.entries(assignments)) {
    if (fid === folderId) {
      update[`flags.${MODULE_ID}.modItemFolders.-=${id}`] = null;
    }
  }
  return item.update(update);
}
