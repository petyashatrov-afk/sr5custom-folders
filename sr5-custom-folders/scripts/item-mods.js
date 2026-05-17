/**
 * Universal modifications.
 *
 * 1. Patches SR5Item.createNestedItem so it no longer restricts the parent
 *    type or the child type. Any item can carry any other item as a nested
 *    "modification".  Original weapon-specific behaviour is preserved (ammo
 *    and weapon-mods on weapons still flow through unchanged).
 *
 * 2. Injects a "Modifications" tab into the V2 ItemSheet for items that don't
 *    already display nested children (so we don't double-up with the existing
 *    weapon Mods/Ammo tabs).  The tab shows current nested items, supports
 *    equip-toggle and delete, and accepts drops of any Item.
 */
import {L, setting, asElement, log} from "./utils.js";

const TAB_ID = "sr5cfMods";
const SECTION_CLS = "sr5cf-mods-section";
const NAV_LINK_CLS = "sr5cf-mods-nav";

export function registerItemMods() {
    Hooks.once("ready", patchCreateNestedItem);

    Hooks.on("renderSR5ItemSheet", onRenderItemSheet);
}

/* --------------------------------------------------------------------- */
/* 1. createNestedItem patch                                              */
/* --------------------------------------------------------------------- */

function patchCreateNestedItem() {
    if (!setting("enableUniversalMods")) return;

    // Try several names the system may have exported under.
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

            // Recursion check.
            const allowRecursive = setting("allowRecursiveMods");
            if (!allowRecursive && this._isNestedItem) {
                ui.notifications?.warn("Nested modifications are not allowed (recursion disabled).");
                return false;
            }

            // For weapons, defer to the original method to preserve all the
            // weapon-specific bookkeeping (ammo handling etc.).  But if it's a
            // weapon and a non-(ammo|modification) child, fall through to the
            // generic path.
            const isWeapon = this.type === "weapon";
            const allWeaponAccepted = itemData.every(
                (d) => d?.type === "ammo" || d?.type === "modification"
            );
            if (isWeapon && allWeaponAccepted) {
                return await original.call(this, itemData);
            }

            // Generic path: replicate the system's flow but without type gates.
            const current = foundry.utils.duplicate(this.getNestedItems());
            for (const og of itemData) {
                const dup = foundry.utils.duplicate(og);
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

/* --------------------------------------------------------------------- */
/* 2. ItemSheet UI                                                        */
/* --------------------------------------------------------------------- */

function onRenderItemSheet(app, html) {
    if (!setting("enableUniversalMods")) return;
    const root = asElement(html);
    if (!root) return;
    const item = app.item;
    if (!item) return;

    // Skip for items that already manage modifications themselves (weapon).
    if (item.type === "weapon") return;

    // Don't render this tab in limited / no-permission view.
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
    link.innerHTML = `<i class="fas fa-screwdriver-wrench"></i> <span>${L("ModsTabLabel")}</span>`;

    // Custom click handler — system's native action handler also runs on
    // data-action="tab"; we intercept so both nav-state AND visibility flip
    // even though our <section> wasn't part of the PARTS spec.
    link.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        activateOurTab(root);
    });
    nav.appendChild(link);
}

function activateOurTab(root) {
    // Deactivate everyone in primary group
    root.querySelectorAll('nav.sheet-tabs.tabs a[data-group="primary"]').forEach(a => a.classList.remove("active"));
    root.querySelectorAll('section.tab[data-group="primary"]').forEach(s => s.classList.remove("active"));
    // Activate ours
    const link = root.querySelector(`nav.sheet-tabs.tabs a.${NAV_LINK_CLS}`);
    const sect = root.querySelector(`section.tab[data-tab="${TAB_ID}"]`);
    link?.classList.add("active");
    sect?.classList.add("active");
}

function addModsSection(app, root, item) {
    // Find the form / main content container in the V2 sheet — sections live
    // alongside their nav inside `.window-content` / form.
    // We append next to existing sections so the active-class toggling works.
    let host = root.querySelector("form") ?? root;

    // Remove a previous version if present (so we re-render content fresh).
    host.querySelectorAll(`section.tab.${SECTION_CLS}`).forEach((s) => s.remove());

    const section = document.createElement("section");
    section.classList.add("tab", "hide-overflow", SECTION_CLS);
    section.dataset.group = "primary";
    section.dataset.tab = TAB_ID;

    const fill = document.createElement("div");
    fill.classList.add("fill-container");

    // Header bar
    const header = document.createElement("div");
    header.classList.add("list-item", "list-item-header", "header-for-scrollable");
    header.innerHTML = `
        <div class="list-item-start">
            <label>${L("Modifications")}</label>
        </div>
        <div class="list-item-icons">
            <span class="sr5cf-mods-droptarget-hint" style="font-size: 0.8em; opacity: 0.7;">
                ${L("DropAnyItemHere")}
            </span>
        </div>`;
    fill.appendChild(header);

    // Scrollable item list
    const scroll = document.createElement("div");
    scroll.classList.add("scrollable", "sr5cf-mods-droptarget");
    scroll.dataset.sr5cfModsDrop = "1";

    const mods = item.items ?? [];
    if (!mods.length) {
        const empty = document.createElement("div");
        empty.classList.add("sr5cf-mods-empty");
        empty.style.padding = "1em";
        empty.style.textAlign = "center";
        empty.style.opacity = "0.7";
        empty.textContent = L("DropAnyItemHere");
        scroll.appendChild(empty);
    } else {
        for (const m of mods) scroll.appendChild(buildModRow(app, item, m));
    }
    fill.appendChild(scroll);

    section.appendChild(fill);
    host.appendChild(section);

    // Wire drops on the scroll area
    attachModDropHandlers(app, item, scroll);
}

function buildModRow(app, parentItem, mod) {
    const row = document.createElement("div");
    row.classList.add("list-item-container");
    row.dataset.itemId = mod.id;
    row.dataset.uuid = mod.uuid;

    const equipped = mod.system?.technology?.equipped ?? false;
    const eqIcon = equipped ? "fa-circle-check" : "fa-circle";
    const eqTooltip = equipped ? L("Unequip") : L("Equip");

    const img = mod.img ?? "icons/svg/item-bag.svg";

    row.innerHTML = `
        <div class="list-item">
            <div class="list-item-start">
                <img class="item-img" src="${img}" alt="" style="width:24px;height:24px;border:none;margin-right:6px;" />
                <span class="item-name" style="font-weight:bold;">${foundry.utils.escapeHTML(mod.name)}</span>
                <span class="item-type" style="margin-left:6px;opacity:0.7;font-size:0.85em;">[${mod.type}]</span>
            </div>
            <div class="list-item-icons">
                <a class="sr5cf-mod-toggle-equip" data-tooltip="${eqTooltip}">
                    <i class="fas ${eqIcon}"></i>
                </a>
                <a class="sr5cf-mod-edit" data-tooltip="${game.i18n.localize("SR5.Edit") || "Edit"}">
                    <i class="fas fa-edit"></i>
                </a>
                <a class="sr5cf-mod-delete" data-tooltip="${game.i18n.localize("SR5.Delete") || "Delete"}">
                    <i class="fas fa-trash"></i>
                </a>
            </div>
        </div>`;

    row.querySelector(".sr5cf-mod-toggle-equip").addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await toggleModEquip(parentItem, mod);
        app.render({force: false});
    });
    row.querySelector(".sr5cf-mod-edit").addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        mod.sheet?.render({force: true});
    });
    row.querySelector(".sr5cf-mod-delete").addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await deleteNestedMod(parentItem, mod);
        app.render({force: false});
    });

    return row;
}

async function toggleModEquip(parentItem, mod) {
    const current = foundry.utils.duplicate(parentItem.getNestedItems());
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
    const current = foundry.utils.duplicate(parentItem.getNestedItems());
    const filtered = current.filter(m => m._id !== mod.id);
    await parentItem.setNestedItems(filtered);
    parentItem.prepareNestedItems?.();
    parentItem.prepareData?.();
}

function attachModDropHandlers(app, parentItem, el) {
    el.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
        el.classList.add("sr5cf-drop-hover");
    });
    el.addEventListener("dragleave", () => el.classList.remove("sr5cf-drop-hover"));
    el.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        el.classList.remove("sr5cf-drop-hover");

        let raw;
        try { raw = ev.dataTransfer.getData("text/plain"); } catch { return; }
        if (!raw) return;
        let data;
        try { data = JSON.parse(raw); } catch { return; }
        if (data?.type !== "Item") return;

        const droppedItem = await fromUuid(data.uuid);
        if (!droppedItem) return;

        // Prevent dropping the item onto itself
        if (droppedItem.id === parentItem.id) {
            ui.notifications?.warn("Cannot attach an item to itself.");
            return;
        }
        // Disallow nesting unless setting permits
        if (!setting("allowRecursiveMods") && parentItem._isNestedItem) {
            ui.notifications?.warn("Recursive modifications are disabled.");
            return;
        }

        const src = droppedItem.toObject();
        await parentItem.createNestedItem(src);
        app.render({force: false});
    });
}
