# SR5 Custom Folders & Universal Mods

Foundry VTT module for the **Shadowrun 5e** system (`shadowrun5e`).

Adds two quality‑of‑life features to character / vehicle / spirit / sprite /
IC sheets and to item sheets:

1. **Custom folders** in every sheet section.
2. **Universal modifications** — any item may carry any other item as a nested
   "mod", exactly like weapon mods today.

Compatible with Foundry VTT **v13–v14** and Shadowrun 5e ≥ 0.33.

---

## 1 · Custom folders

### Inventory sections (weapon / armor / cyberware / …)
The system already supports user inventories (the `<select>` at the top of the
*Inventory* tab). This module simply adds a **📂 +** button next to the
existing **+ Add** button in every section header. Clicking it:

1. Prompts for a folder name.
2. Creates a new actor inventory pre-prefixed with the section's type, e.g.
   `Weapon: Holdouts`.
3. Automatically activates that inventory so the section is ready to receive
   items.

From there everything is handled by the system: rename via ✏, delete via 🗑,
drag-and-drop between inventories, etc.

### Action sections (General / Matrix / IC actions) — compendium-mirrored folders

> **New in 0.2.0.** This is different from every other folder feature below,
> because action rows are special.

Actions on the sheet (the **Actions** tab and the **Matrix Actions** list) are
**not** actor-owned items. The SR5 system renders them live from its action
compendia through Handlebars (`_prepareActions` / `_prepareMatrixActions` →
`PackItemFlow.getPackActions` → `pack.getDocuments`). There is no embedded
`actor.items` document to flag, and the `createItem` hook never fires for them.

So this module mirrors the folder structure **straight from the source pack**:

* Create / rename / move / delete folders **inside the action compendium**
  (your own pack — see note below). The character sheet reflects it
  automatically. The compendium is the single source of truth.
* Nested folders are supported and indented.
* Folders are collapsible per user (state stored client-side, keyed by
  actor + pack + folder).
* Actor-owned custom actions and any actions not in a folder stay at the
  section root.
* **No "create folder" button** is added to action sections — action folders
  only ever come from the compendium. (Folders are not created on drag-n-drop,
  exactly as required.)

The pack the module reads is whatever the system is configured to use
(*Settings → Compendia* overrides `GeneralActionsPack` / `MatrixActionsPack` /
`ICActionsPack`, falling back to the bundled `sr5e-*` packs). Because the
shipped system packs are locked, **to use your own action folders create your
own action pack and point the system's Compendia settings at it.** The module
honours those overrides via the same names the system uses.

### Other tabs (Actions, Magic, Social, Misc, Matrix, …)
For tabs whose lists are *not* inventory-backed (Actions, Spells, Rituals,
Adept Powers, Qualities, Contacts, SINs, Lifestyles, Critter / Sprite Powers,
Complex Forms, etc.) the module adds its own folder mechanism:

* **📂 + button** in every section header creates a folder (`folder name`).
* Folders are collapsible (click the header).
* Rename ✏ / delete 🗑 from the folder header.
* **Drag any item of that section into a folder** — release on the folder
  header or body. Drag onto the section's main header to move it back to the
  root.
* Folders are stored per actor in
  `actor.flags["sr5-custom-folders"].tabFolders`; items remember their folder
  in `item.flags["sr5-custom-folders"].folderId`.

> Deleting a folder leaves its items intact — they just return to the section
> root.

---

## 1.5 · Per-tab search

> **New in 0.3.0.**

Every actor-sheet tab that holds list rows gets a single search box at the top:

* **One combined search per tab.** The Inventory tab searches across *all* item
  categories at once (weapons, armor, gear, cyberware, …) — no separate box per
  type. Actions, Magic, Social, Matrix actions, Critter powers, Effects, etc.
  each get their own single box.
* Matching is case/accent-insensitive substring on the item name.
* Section headers with no remaining matches are hidden; clearing the query
  restores everything.
* Works together with the compendium-mirrored action folders: rows inside
  folders are filtered too, and a folder with no matches is hidden.
* The **Skills** tab is left untouched — it already has the system's own
  active-skill search.
* The **Matrix** tab is a container of sub-tabs (network icons, matrix actions,
  …): the search boxes appear on each sub-tab, not on the wrapper. Matrix icon
  rows (personas/devices pulled from the matrix connection — not items) are
  searchable too.

Toggle via *Settings → Enable section search*.

## 2 · Universal modifications

Vanilla SR5 only lets weapons carry nested items (Ammo + Modifications). This
module:

* **Patches `SR5Item.createNestedItem`** so any item can host any other item.
  The original weapon-specific logic is preserved untouched: weapons still
  accept ammo + mods exactly the same way.
* **Adds a "Modifications" tab to every Item sheet** (except weapons, which
  already have their own native tab). The tab:
  * Lists currently attached mods (name + type + equipped indicator).
  * Accepts drop of **any** Item document (sidebar, compendium, character
    inventory).
  * Per-row buttons: equip/unequip toggle, edit, delete.
* Optional **recursive nesting** (settings → *Allow nested mods inside mods*).
  If disabled, attaching a mod to a mod is blocked.

Storage is reused from the system itself
(`item.flags["shadowrun5e"].embeddedItems`), so the nested items show up in
all the usual places (e.g. `item.items` collection).

---

## Settings

| Setting | Default | Description |
|---|---|---|
| Enable custom folders | ✔ | Toggles the folder UI feature globally. |
| Enable universal modifications | ✔ | Toggles the universal-mods tab and the `createNestedItem` patch. |
| Allow nested mods inside mods | ✔ | Recursion guard for universal mods. |

---

## Installation (manifest URL)

While the module is not on the official package list, install via
*Add-on Modules → Install Module → Manifest URL* pointing at a hosted
`module.json`, or copy the folder to your Foundry `Data/modules/`.

```
<FoundryUserData>/Data/modules/sr5-custom-folders/
```

After install: enable in the world's module list.

---

## File layout

```
sr5-custom-folders/
├── module.json
├── README.md
├── RESEARCH.md             (notes about the SR5 source used to build this)
├── lang/
│   ├── en.json
│   └── ru.json
├── styles/
│   └── sr5-custom-folders.css
└── scripts/
    ├── main.js             (entry; registers settings + hooks)
    ├── utils.js            (shared helpers, flag accessors, prompts)
    ├── inventory-folders.js
    ├── tab-folders.js
    ├── action-folders.js    (compendium-mirrored folders for action sections)
    ├── section-search.js    (per-tab search box)
    └── item-mods.js
```

---

## Known limitations / TODO

* Folder ordering inside a section follows insertion order. A drag-to-reorder
  affordance for folders themselves is on the TODO list.
* The "Modifications" tab uses a runtime-injected `<section>` because the
  system's `ItemSheet` PARTS / TABS are declared statically. The activation
  state is therefore managed manually by the module's click handler. If you
  notice the tab not lighting up correctly after navigation, refresh the
  sheet.
* Equip toggle on universal mods only flips
  `system.technology.equipped`; bonus aggregation onto the parent is not yet
  performed. Native weapon-mod aggregation (`getEquippedMods()`) still works
  unchanged.
* No migration is performed: removing the module leaves only orphan flags
  behind, which Foundry will ignore.
