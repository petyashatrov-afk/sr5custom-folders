/**
 * Per-tab search/filter for SR5 actor sheets.
 *
 * The system ships a search box only for the active-skills list. This adds an
 * equivalent quick-filter to every other sheet tab that contains list rows
 * (Actions, Inventory, Magic, Social, Matrix actions, Critter powers, Effects…).
 *
 * Design choices
 * --------------
 * - ONE search box per tab (not per section). This is what the user asked for:
 *   the Inventory tab gets a single search that filters across all item
 *   categories (weapons, armor, gear, …) instead of a separate box per type.
 * - The Skills tab is intentionally skipped — it already has the system's own
 *   search for active skills.
 * - The Matrix tab is a CONTAINER that wraps nested sub-tabs (network icons,
 *   matrix actions, …). It gets no box of its own; each nested sub-tab does.
 *   Matrix icon rows are documents pulled from the matrix connection (not items)
 *   and expose their name in a secondary <a>, which rowName() handles.
 * - Pure DOM filtering on top of whatever is currently rendered, so it also
 *   filters rows that live inside the compendium-mirrored action folders
 *   (action-folders.js). During an active query all folders are force-expanded
 *   via a scope class so matches inside collapsed folders stay visible; clearing
 *   the query restores their collapsed state automatically.
 */
import { asElement, setting, L, log } from "./utils.js";

const SEARCH_BAR_CLS = "sr5cf-search-bar";
const HIDDEN_CLS = "sr5cf-search-hidden";
const SEARCHING_CLS = "sr5cf-searching";
const SEARCH_TAB_CLS = "sr5cf-search-tab";

// Tabs we never inject into (no item lists, or already have native search).
// "skills" already has the system's own active-skill search.
// "description"/"misc" hold prose / config rows, not searchable item lists.
const SKIP_TABS = new Set(["skills", "description", "misc"]);

// Remember the query per (app, tabId) so it survives sheet re-renders.
const queryMemory = new WeakMap();

export function registerSectionSearch() {
    // Runs after action-folders' grouping (registered earlier in main.js), so
    // the folder wrappers already exist when we wire up filtering.
    Hooks.on("renderSR5BaseActorSheet", onRender);
}

function onRender(app, html) {
    if (!setting("enableSearch")) return;
    const root = asElement(html);
    if (!root || !app.actor) return;

    const tabs = root.querySelectorAll("section.tab[data-tab]");
    for (const tab of tabs) {
        const tabId = tab.dataset.tab;
        if (!tabId || SKIP_TABS.has(tabId)) continue;

        // A container tab that only wraps nested sub-tabs (the Matrix tab) must
        // not get its own box — the nested sub-tabs each get one instead.
        if (tab.querySelector("section.tab[data-tab], .tab[data-tab]")) continue;

        // Only add search where there is something to search.
        const rowCount = ownRows(tab).length;
        if (rowCount < 2) continue;

        if (tab.dataset.sr5cfSearch === "1") continue;
        tab.dataset.sr5cfSearch = "1";

        injectSearchBar(app, tab, tabId);
    }
}

function injectSearchBar(app, tab, tabId) {
    const bar = document.createElement("div");
    bar.classList.add(SEARCH_BAR_CLS, "list-item");

    const input = document.createElement("input");
    input.type = "search";
    input.classList.add("sr5cf-search-input");
    input.placeholder = `${L("SearchPlaceholder")}`;
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");

    bar.appendChild(input);

    // Lay the tab out as a column so the bar sits above the scrollable content.
    tab.classList.add(SEARCH_TAB_CLS);

    // Insert at the very top of the tab.
    tab.prepend(bar);

    // Restore a remembered query.
    const memory = queryMemory.get(app) ?? new Map();
    const remembered = memory.get(tabId) ?? "";
    if (remembered) input.value = remembered;

    const run = () => {
        const q = input.value ?? "";
        const mem = queryMemory.get(app) ?? new Map();
        mem.set(tabId, q);
        queryMemory.set(app, mem);
        applyFilter(tab, q);
    };

    input.addEventListener("input", run);
    // Prevent Enter from submitting / bubbling to the sheet.
    input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") ev.preventDefault();
        if (ev.key === "Escape") {
            input.value = "";
            run();
        }
        ev.stopPropagation();
    });

    if (remembered) applyFilter(tab, remembered);
}

/* ------------------------------------------------------------------------- */
/* Filtering                                                                  */
/* ------------------------------------------------------------------------- */

function normalize(str) {
    return String(str ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

function rowName(row) {
    const li = row.querySelector(".list-item") ?? row;

    // Most item rows expose an explicit name link.
    const nameLink = li.querySelector(".item-name-link");
    if (nameLink?.textContent?.trim()) return nameLink.textContent;

    // Skill rows carry the name as a data attribute.
    const skillName = li.getAttribute?.("data-skill-name");
    if (skillName?.trim()) return skillName;

    // Generic fallback (covers matrix icons, whose name is in a second <a>):
    // the start cell's text content. The icon/image is an <img>, so it adds no
    // text, leaving just the visible name.
    const start = li.querySelector(".list-item-start");
    if (start?.textContent?.trim()) return start.textContent;

    return li.textContent ?? "";
}

/** Rows that belong to this tab directly (not to a nested sub-tab). */
function ownRows(tab) {
    return Array.from(tab.querySelectorAll(".list-item-container")).filter(
        (row) => row.closest("section.tab[data-tab]") === tab
    );
}

function applyFilter(tab, query) {
    const q = normalize(query);
    const active = q.length > 0;

    tab.classList.toggle(SEARCHING_CLS, active);

    // 1. Rows.
    const rows = tab.querySelectorAll(".list-item-container");
    rows.forEach((row) => {
        const match = !active || normalize(rowName(row)).includes(q);
        row.classList.toggle(HIDDEN_CLS, !match);
    });

    // 2. Module folders: hide those with no visible rows while searching.
    tab.querySelectorAll(".sr5cf-folder").forEach((folder) => {
        if (!active) {
            folder.classList.remove(HIDDEN_CLS);
            return;
        }
        const hasVisible = folder.querySelector(`.list-item-container:not(.${HIDDEN_CLS})`);
        folder.classList.toggle(HIDDEN_CLS, !hasVisible);
    });

    // 3. Section headers: hide a header whose rows are all filtered out.
    tab.querySelectorAll(".list-item-header").forEach((header) => {
        let node = header.nextElementSibling;
        let hasAny = false;
        let anyVisible = false;
        while (node && !node.matches(".list-item-header")) {
            if (node.matches(".list-item-container")) {
                hasAny = true;
                if (!node.classList.contains(HIDDEN_CLS)) anyVisible = true;
            } else if (node.matches(".sr5cf-folder")) {
                hasAny = true;
                if (node.querySelector(`.list-item-container:not(.${HIDDEN_CLS})`)) anyVisible = true;
            }
            node = node.nextElementSibling;
        }
        header.classList.toggle(HIDDEN_CLS, active && hasAny && !anyVisible);
    });
}
