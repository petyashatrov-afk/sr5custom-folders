/**
 * SR5 Custom Folders & Universal Mods — entry point.
 */
import {MODULE_ID, log} from "./utils.js";
import {registerTabFolders} from "./tab-folders.js";
import {registerItemMods} from "./item-mods.js";

Hooks.once("init", () => {
    log("Initialising...");

    game.settings.register(MODULE_ID, "enableFolders", {
        name: "SR5CF.Settings.EnableFolders",
        hint: "SR5CF.Settings.EnableFoldersHint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
    });

    game.settings.register(MODULE_ID, "enableUniversalMods", {
        name: "SR5CF.Settings.EnableUniversalMods",
        hint: "SR5CF.Settings.EnableUniversalModsHint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
    });

    game.settings.register(MODULE_ID, "allowRecursiveMods", {
        name: "SR5CF.Settings.AllowRecursiveMods",
        hint: "SR5CF.Settings.AllowRecursiveModsHint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
    });

    registerTabFolders();
    registerItemMods();
});

Hooks.once("ready", () => {
    if (game.system?.id !== "shadowrun5e") {
        ui.notifications?.warn(
            `[${MODULE_ID}] active game system is "${game.system?.id}". This module is for "shadowrun5e".`
        );
    }
    log("Ready.");
});
