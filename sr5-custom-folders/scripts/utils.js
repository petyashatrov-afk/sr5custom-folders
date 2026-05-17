/**
 * Shared helpers for SR5 Custom Folders.
 */
export const MODULE_ID = "sr5-custom-folders";

export const FLAGS = {
    // actor-level: { [tabId]: { [folderId]: { id, name, itemIds: [], collapsed: bool } } }
    TabFolders: "tabFolders",
    // actor-level item assignment for inventory section folders:
    // { [inventoryName]: { [type]: { folderId } } } — meta for folders themselves
    InventorySectionFolders: "inventorySectionFolders",
    // item-level assignment for inventory items:
    // value: folderId (string) | null
    ItemFolderAssignment: "folderId",
};

export function L(key, data) {
    const txt = game.i18n.localize(`SR5CF.${key}`);
    return data ? game.i18n.format(`SR5CF.${key}`, data) : txt;
}

export function uid() {
    // Foundry exposes randomID
    return foundry.utils.randomID(16);
}

/**
 * Prompt the user for a name string.
 * Returns the trimmed string or null if cancelled / empty.
 */
export async function promptForName({title, label, initial = ""} = {}) {
    title = title ?? L("AddFolder");
    label = label ?? L("FolderNamePrompt");

    const content = `
        <form>
            <div class="form-group">
                <label>${label}</label>
                <input type="text" name="folderName" value="${foundry.utils.escapeHTML(initial)}" autofocus />
            </div>
        </form>`;

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

/**
 * Confirm dialog wrapper (DialogV2).
 */
export async function confirm({title, content}) {
    return await foundry.applications.api.DialogV2.confirm({
        window: {title},
        content: `<p>${content}</p>`,
        rejectClose: false,
        modal: true
    });
}

/**
 * Read tab-folder structure for a given actor and tab id.
 */
export function getTabFolders(actor, tabId) {
    const all = actor.getFlag(MODULE_ID, FLAGS.TabFolders) ?? {};
    return foundry.utils.deepClone(all[tabId] ?? {});
}

/**
 * Write tab-folder structure.
 */
export async function setTabFolders(actor, tabId, folders) {
    const all = foundry.utils.deepClone(actor.getFlag(MODULE_ID, FLAGS.TabFolders) ?? {});
    all[tabId] = folders;
    return actor.setFlag(MODULE_ID, FLAGS.TabFolders, all);
}

/**
 * Get an item's assigned folder id (string) for a given namespace ("inv:<inventory>:<type>"
 * or "tab:<tabId>"). We store one key per scope on the item flags to keep things isolated.
 */
export function getItemFolderId(item, scope) {
    const map = item.getFlag(MODULE_ID, FLAGS.ItemFolderAssignment) ?? {};
    return map[scope] ?? null;
}

export async function setItemFolderId(item, scope, folderId) {
    const map = foundry.utils.deepClone(item.getFlag(MODULE_ID, FLAGS.ItemFolderAssignment) ?? {});
    if (folderId === null || folderId === undefined) delete map[scope];
    else map[scope] = folderId;
    return item.setFlag(MODULE_ID, FLAGS.ItemFolderAssignment, map);
}

/**
 * Safe HTML element-by-id from a Foundry render hook `element` (which can be a Node).
 */
export function asElement(el) {
    if (!el) return null;
    if (el instanceof HTMLElement) return el;
    if (el.jquery) return el[0];
    return el;
}

/**
 * Module setting accessor.
 */
export function setting(key) {
    try {
        return game.settings.get(MODULE_ID, key);
    } catch {
        return undefined;
    }
}

/**
 * Foundry log helper.
 */
export function log(...args) {
    console.log("SR5-CF |", ...args);
}
