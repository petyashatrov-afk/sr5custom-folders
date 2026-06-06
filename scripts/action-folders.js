/**
 * Compendium folder mirroring for ACTION sections (General / Matrix / IC).
 *
 * WHY THIS EXISTS
 * ----------------
 * Unlike spells / qualities / contacts (which are real `actor.items` embedded
 * documents), the action rows on the SR5 character/vehicle/IC/etc. sheets are
 * rendered LIVE from the system compendia via Handlebars:
 *
 *   actions.hbs  →  _prepareActions()  →  PackItemFlow.getActorSheetActions()
 *                →  PackItemFlow.getPackActions()  →  pack.getDocuments(...)
 *
 *   matrix-actions.hbs → _prepareMatrixActions() → _getMatrixPackActions()
 *
 * These are documents that belong to the COMPENDIUM, not to the actor. They are
 * never created as embedded items, so the `createItem` hook never fires for
 * them and there is no actor-owned `item.id` to attach a folder flag to.
 *
 * Therefore the only correct way to make "folders import together with the
 * objects" is to read the folder straight from the source pack
 * (`entry.folder` → `pack.folders.get(id).name`) and group the rendered rows
 * accordingly — purely a read-only mirror. No folders are ever created here;
 * the compendium is the single source of truth, so renaming/moving/deleting a
 * folder in the compendium is reflected automatically on every sheet.
 *
 * This module deliberately does NOT add a "create folder" button to action
 * sections: action folders only ever come from the compendium.
 */
import { MODULE_ID, asElement, setting, L, log } from "./utils.js";

const SYS = "shadowrun5e";

const FOLDER_WRAPPER_CLS = "sr5cf-folder";
const FOLDER_HEADER_CLS = "sr5cf-folder-header";
const FOLDER_BODY_CLS = "sr5cf-folder-body";

/* ------------------------------------------------------------------------- */
/* Pack folder cache                                                         */
/* ------------------------------------------------------------------------- */

/**
 * collection (e.g. "shadowrun5e.sr5e-general-actions") =>
 *   { folders: Map<folderId, {id,name,parent,sort,color}>,
 *     entryFolder: Map<entryId, folderId> }
 */
const actionPackCache = new Map();
let cacheBuilt = false;
let pendingBuild = null;

/**
 * Resolve the configured action pack metadata names, honouring the system's
 * own per-world overrides (Settings → Compendia) and falling back to defaults.
 */
function getActionPackNames() {
    const names = CONFIG.SR5?.packNames ?? {};
    const fromSetting = (flag) => {
        try {
            const v = game.settings.get(SYS, flag);
            return v || null;
        } catch {
            return null;
        }
    };
    return [
        fromSetting("GeneralActionsPack") ?? names.GeneralActionsPack,
        fromSetting("MatrixActionsPack") ?? names.MatrixActionsPack,
        fromSetting("ICActionsPack") ?? names.ICActionsPack,
    ].filter(Boolean);
}

function findPackByName(name) {
    return game.packs.find(
        (p) =>
            p.metadata.name === name &&
            (p.metadata.system === SYS || p.metadata.system === undefined)
    );
}

function folderParentId(folder) {
    const parent = folder.folder;
    if (!parent) return null;
    if (typeof parent === "string") return parent;
    return parent.id ?? null;
}

async function buildPackCache(pack) {
    if (!pack) return;
    try {
        // The default index already contains the `folder` field; refresh it so
        // freshly created/moved folders are reflected without a world reload.
        await pack.getIndex();
    } catch (e) {
        log("getIndex failed for", pack?.collection, e);
    }

    const folders = new Map();
    for (const f of pack.folders ?? []) {
        folders.set(f.id, {
            id: f.id,
            name: f.name,
            parent: folderParentId(f),
            sort: f.sort ?? 0,
            color: f.color ?? null,
        });
    }

    const entryFolder = new Map();
    for (const entry of pack.index ?? []) {
        const fid = typeof entry.folder === "string" ? entry.folder : entry.folder?.id ?? null;
        if (fid) entryFolder.set(entry._id, fid);
    }

    actionPackCache.set(pack.collection, { folders, entryFolder });
}

async function rebuildActionPackCache() {
    actionPackCache.clear();
    for (const name of getActionPackNames()) {
        const pack = findPackByName(name);
        if (pack) await buildPackCache(pack);
    }
    cacheBuilt = true;
}

/** Parse a compendium uuid into { collection, id } or null for non-pack uuids. */
function parsePackUuid(uuid) {
    if (!uuid || !uuid.startsWith("Compendium.")) return null;
    const parts = uuid.split(".");
    // Compendium.<scope>.<pack>.Item.<id>   (current)
    // Compendium.<scope>.<pack>.<id>        (legacy)
    if (parts.length < 4) return null;
    const id = parts[parts.length - 1];
    const collection = `${parts[1]}.${parts[2]}`;
    return { collection, id };
}

/**
 * For a given row uuid, return { collection, folderId } if it belongs to one of
 * the configured action packs. folderId may be null (root of that pack).
 * Returns null when the uuid is not from an action pack (actor-owned action, …).
 */
function lookupRowFolder(uuid) {
    const parsed = parsePackUuid(uuid);
    if (!parsed) return null;
    const cache = actionPackCache.get(parsed.collection);
    if (!cache) return null;
    return { collection: parsed.collection, folderId: cache.entryFolder.get(parsed.id) ?? null };
}

/* ------------------------------------------------------------------------- */
/* Collapse state (per user, persisted in a client setting)                   */
/* ------------------------------------------------------------------------- */

function collapseKey(actor, collection, folderId) {
    return `${actor.id}|${collection}|${folderId}`;
}

function isCollapsed(actor, collection, folderId) {
    const map = setting("actionFolderCollapse") ?? {};
    return !!map[collapseKey(actor, collection, folderId)];
}

async function setCollapsed(actor, collection, folderId, collapsed) {
    const map = foundry.utils.deepClone(setting("actionFolderCollapse") ?? {});
    const key = collapseKey(actor, collection, folderId);
    if (collapsed) map[key] = true;
    else delete map[key];
    await game.settings.set(MODULE_ID, "actionFolderCollapse", map);
}

/* ------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* ------------------------------------------------------------------------- */

export function registerActionFolders() {
    Hooks.once("ready", async () => {
        await rebuildActionPackCache();
        rerenderOpenActorSheets();
    });

    // Re-mirror when compendium folders or action documents change.
    const refresh = async (doc) => {
        const pack = doc?.pack ? game.packs.get(doc.pack) : doc?.compendium ?? null;
        const collection = pack?.collection ?? doc?.compendium?.collection;
        if (!collection || !actionPackCache.has(collection)) {
            // A folder might belong to an action pack we haven't cached yet.
            if (!collection) return;
            const known = getActionPackNames().some((n) => collection.endsWith(`.${n}`));
            if (!known) return;
        }
        const targetPack = game.packs.get(collection);
        if (targetPack) await buildPackCache(targetPack);
        rerenderOpenActorSheets();
    };

    Hooks.on("createFolder", refresh);
    Hooks.on("updateFolder", refresh);
    Hooks.on("deleteFolder", refresh);
    Hooks.on("createItem", (item) => { if (item?.pack) refresh(item); });
    Hooks.on("updateItem", (item) => { if (item?.pack) refresh(item); });
    Hooks.on("deleteItem", (item) => { if (item?.pack) refresh(item); });

    // The base hook fires for every actor sheet in the inheritance chain.
    Hooks.on("renderSR5BaseActorSheet", onRender);
}

function rerenderOpenActorSheets() {
    const apps = new Set();

    // Preferred: enumerate all live ApplicationV2 instances.
    const instances = foundry.applications?.instances;
    if (instances?.values) {
        for (const app of instances.values()) {
            if (app?.actor && app.rendered && typeof app.render === "function") apps.add(app);
        }
    }

    // Fallback: walk world actors + their token-synthetic actors.
    for (const actor of game.actors ?? []) {
        const sheet = actor.sheet;
        if (sheet?.rendered && sheet.actor) apps.add(sheet);
    }
    for (const token of game.scenes?.active?.tokens ?? []) {
        const sheet = token.actor?.sheet;
        if (sheet?.rendered && sheet.actor) apps.add(sheet);
    }

    for (const app of apps) {
        try {
            app.render({ force: false });
        } catch (e) {
            log("re-render failed", e);
        }
    }
}

function onRender(app, html) {
    if (!setting("enableFolders")) return;
    const root = asElement(html);
    if (!root || !app.actor) return;

    if (!cacheBuilt) {
        if (!pendingBuild) {
            pendingBuild = rebuildActionPackCache().then(() => {
                pendingBuild = null;
                rerenderOpenActorSheets();
            });
        }
        return;
    }
    if (actionPackCache.size === 0) return;

    // Group every distinct list container that holds action rows from our packs.
    // Skip rows that are already inside a folder we built (idempotency guard for
    // the rare case onRender runs twice against the same, un-rebuilt DOM).
    const containers = new Set();
    root.querySelectorAll(".list-item-container").forEach((rowEl) => {
        if (rowEl.closest(`.${FOLDER_BODY_CLS}`)) return;
        const li = rowEl.querySelector(".list-item") ?? rowEl;
        const uuid = li.dataset?.uuid;
        if (!uuid) return;
        if (!lookupRowFolder(uuid)) return; // not an action-pack row
        const container = rowEl.parentElement;
        if (container) containers.add(container);
    });

    for (const container of containers) {
        try {
            groupContainer(app, container);
        } catch (e) {
            log("groupContainer failed", e);
        }
    }
}

function groupContainer(app, container) {
    const actor = app.actor;
    const rows = Array.from(container.querySelectorAll(":scope > .list-item-container"));
    if (!rows.length) return;

    // Map each row to its folder (or null/root). Determine the dominant pack
    // collection for this container (actions in one section share a pack).
    const usedFolderIds = new Set();
    let collection = null;
    const rowFolder = new Map(); // rowEl -> folderId|null

    for (const rowEl of rows) {
        const li = rowEl.querySelector(".list-item") ?? rowEl;
        const info = lookupRowFolder(li.dataset?.uuid);
        if (!info) {
            rowFolder.set(rowEl, null); // actor-owned / non-pack → stays at root
            continue;
        }
        collection = collection ?? info.collection;
        // Only fold rows that belong to the same pack as the rest of the section.
        if (info.collection !== collection) {
            rowFolder.set(rowEl, null);
            continue;
        }
        rowFolder.set(rowEl, info.folderId ?? null);
        if (info.folderId) usedFolderIds.add(info.folderId);
    }

    if (!collection || usedFolderIds.size === 0) return; // nothing to fold
    const cache = actionPackCache.get(collection);
    if (!cache) return;

    // Expand used folders to include all ancestors so nesting is preserved.
    const neededFolderIds = new Set();
    for (const fid of usedFolderIds) {
        let cur = fid;
        while (cur && !neededFolderIds.has(cur)) {
            neededFolderIds.add(cur);
            cur = cache.folders.get(cur)?.parent ?? null;
        }
    }

    // Build folder nodes.
    const nodes = new Map();
    for (const fid of neededFolderIds) {
        const f = cache.folders.get(fid);
        if (!f) continue;
        nodes.set(fid, { ...f, rows: [], children: [] });
    }
    // Attach children + collect root-level folders.
    const rootFolders = [];
    for (const node of nodes.values()) {
        const parent = node.parent && nodes.has(node.parent) ? nodes.get(node.parent) : null;
        if (parent) parent.children.push(node);
        else rootFolders.push(node);
    }
    // Assign rows to their folder node.
    const rootRows = [];
    for (const rowEl of rows) {
        const fid = rowFolder.get(rowEl);
        if (fid && nodes.has(fid)) nodes.get(fid).rows.push(rowEl);
        else rootRows.push(rowEl);
    }

    // Re-layout: root rows first (original order), then folder wrappers.
    let cursor = null;
    const place = (el) => {
        if (cursor) cursor.after(el);
        else container.prepend(el);
        cursor = el;
    };
    rootRows.forEach(place);

    const sortFolders = (a, b) =>
        (a.sort - b.sort) || a.name.localeCompare(b.name, game.i18n?.lang);

    rootFolders.sort(sortFolders).forEach((node) => {
        place(buildFolderWrapper(app, actor, collection, node, sortFolders));
    });
}

function totalRowCount(node) {
    let n = node.rows.length;
    for (const c of node.children) n += totalRowCount(c);
    return n;
}

function buildFolderWrapper(app, actor, collection, node, sortFolders) {
    const wrapper = document.createElement("div");
    wrapper.classList.add(FOLDER_WRAPPER_CLS, "sr5cf-folder-compendium");
    wrapper.dataset.sr5cfCollection = collection;
    wrapper.dataset.sr5cfFolderId = node.id;

    const collapsed = isCollapsed(actor, collection, node.id);
    const toggleIcon = collapsed ? "fa-solid fa-caret-right" : "fa-solid fa-caret-down";
    const count = totalRowCount(node);

    const head = document.createElement("div");
    head.classList.add(FOLDER_HEADER_CLS);
    if (node.color) head.style.borderLeft = `3px solid ${node.color}`;
    head.innerHTML = `
        <span class="sr5cf-folder-toggle"><i class="${toggleIcon}"></i></span>
        <i class="fa-solid fa-box-archive sr5cf-folder-comp-icon" data-tooltip="${L("CompendiumFolder")}"></i>
        <span class="sr5cf-folder-name">${foundry.utils.escapeHTML(node.name)}</span>
        <span class="sr5cf-folder-count">(${count})</span>
    `;
    head.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await setCollapsed(actor, collection, node.id, !collapsed);
        app.render({ force: false });
    });

    const body = document.createElement("div");
    body.classList.add(FOLDER_BODY_CLS);
    if (collapsed) body.style.display = "none";

    // Nested folders first, then this folder's direct rows.
    node.children.sort(sortFolders).forEach((child) => {
        body.appendChild(buildFolderWrapper(app, actor, collection, child, sortFolders));
    });
    node.rows.forEach((rowEl) => body.appendChild(rowEl));

    wrapper.appendChild(head);
    wrapper.appendChild(body);
    return wrapper;
}
