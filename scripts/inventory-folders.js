/**
 * Adds a "+ Folder" button next to the "+ Add" button on every inventory section
 * header (weapon / armor / cyberware / …) on the character sheet, using the
 * system's built-in `actor.system.inventories` mechanism (InventoryFlow).
 *
 * Behaviour:
 *   - Click "+ Folder" inside a section ⇒ prompt name ⇒ create an actor
 *     inventory whose name encodes the section type, e.g. "weapon: Holdouts".
 *   - The system already provides re-name / delete / re-assign / drag-drop
 *     through the existing inventory <select>, so all we add is the shortcut.
 *
 * NB: SR5 stores inventories as an object keyed by name. The "type prefix"
 *     convention is purely cosmetic: we only use it as a default label and to
 *     pre-select the new inventory after creation.
 */
import {L, promptForName, asElement, setting, log} from "./utils.js";

const SECTION_BUTTON_CLS = "sr5cf-add-folder";

/**
 * Build the prefix used when naming a new inventory created from a section.
 */
function defaultFolderLabel(type, name) {
  const typeLabel = game.i18n.localize(CONFIG.SR5?.itemTypes?.[type] ?? `TYPES.Item.${type}`);
  return `${typeLabel}: ${name}`;
}

/**
 * Inject buttons into rendered character/actor sheets.
 * Hook fires for the inventory PART of the V2 sheet, but easiest is to listen
 * to the overall `renderSR5BaseActorSheet` hook (also fires for inheritors).
 */
export function registerInventoryFolders() {
  Hooks.on("renderSR5BaseActorSheet", onRenderActorSheet);
  // Some shipped subclasses may not propagate the base hook reliably; cover them.
  Hooks.on("renderSR5CharacterSheet", onRenderActorSheet);
  Hooks.on("renderSR5VehicleSheet", onRenderActorSheet);
  Hooks.on("renderSR5SpiritSheet", onRenderActorSheet);
  Hooks.on("renderSR5SpriteSheet", onRenderActorSheet);
  Hooks.on("renderSR5ICSheet", onRenderActorSheet);
}

function onRenderActorSheet(app, html /*, data*/) {
  if (!setting("enableFolders")) return;
  const root = asElement(html);
  if (!root) return;

  const actor = app.actor;
  if (!actor) return;

  // Only meaningful in edit mode (where the system itself draws "+ Add" buttons).
  const sectionHeaders = root.querySelectorAll(
    '.tab[data-tab="inventory"] .list-item.list-item-header'
  );

  sectionHeaders.forEach((header) => {
    const addBtn = header.querySelector('a[data-action="addItem"][data-item-type]');
    if (!addBtn) return; // not a section header (probably the inventory selector row)
    if (header.querySelector(`.${SECTION_BUTTON_CLS}`)) return; // already injected

    const type = addBtn.dataset.itemType;
    if (!type) return;

    const folderBtn = document.createElement("a");
    folderBtn.classList.add(SECTION_BUTTON_CLS);
    folderBtn.dataset.tooltip = L("AddFolderHere");
    folderBtn.dataset.sr5cfType = type;
    folderBtn.innerHTML = `<i class="fa-solid fa-folder-plus"></i>`;
    folderBtn.style.marginLeft = "4px";
    folderBtn.addEventListener("click", (ev) => onCreateInventoryForType(ev, app, type));

    // Insert just before the system "+ Add" button.
    addBtn.parentElement?.insertBefore(folderBtn, addBtn);
  });
}

async function onCreateInventoryForType(ev, app, type) {
  ev.preventDefault();
  ev.stopPropagation();

  const actor = app.actor;
  if (!actor) {
    ui.notifications?.warn(L("Errors.NoActor"));
    return;
  }

  const name = await promptForName({
    title: L("AddFolder"),
    label: L("FolderName"),
  });
  if (!name) return;

  // Build a user-friendly default label.
  const label = defaultFolderLabel(type, name);

  // The InventoryFlow uses `name` as both the unique key and the displayed
  // label. We want a unique key but a nicer label, so update both.
  try {
    await actor.inventory.create(label);
  } catch (e) {
    console.error("SR5-CF | createInventory failed", e);
  }

  // Switch active inventory selection on the sheet so the user immediately
  // sees an empty section to drop items into.
  if ("selectedInventory" in app) {
    app.selectedInventory = label;
  }
  app.render({force: true});
  log(`Created inventory "${label}" for type "${type}" on actor ${actor.name}`);
}
