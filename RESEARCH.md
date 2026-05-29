# Исследование SR5-FoundryVTT (v0.33.1 под Foundry v13)

## 1. Встроенные «папки» в инвентаре

Система уже имеет понятие **inventory** — это и есть пользовательские папки для предметов
(оружие/аугментации/снаряжение/etc).

- Данные: `actor.system.inventories: { [name]: { name, label, itemIds: string[] } }`.
- Логика: `src/module/actor/flows/InventoryFlow.ts` (`create`, `remove`, `rename`,
  `addItem`, `removeItem`, `disallowRemove`/`disallowRename`).
- Доступ из шита: `this.actor.inventory` (см. `SR5Actor.ts:96`).
- UI: `src/templates/v2/actor/tabs/inventory.hbs` — `<select>` для переключения
  активного «инвентаря» + кнопки `data-action="createInventory|renameInventory|removeInventory"`.
- Actions подключаются в `SR5BaseActorSheet.ts` (ApplicationV2).
- Виртуальные inventories: `defaultInventory` (без имени, для предметов не привязанных
  ни к одной папке) и `allInventories` (`showAll: true`) — показывает всё.

> Итог: для **инвентаря** ничего изобретать не надо. Но в UI «+» рисуется только
> вверху таба — а пользователю хочется кнопку рядом с заголовком **каждой секции типа**
> (`weapon`, `armor`, `cyberware`, …) внутри инвентаря, чтобы быстро создать папку.

## 2. Папок для «Действий» и других плоских списков в системе НЕТ

Таб actions (`templates/v2/actor/tabs/actions.hbs`) рендерит плоский список:
```hbs
{{#each actions}}
    {{> 'list-items/action/item.hbs' item=this.action name=this.name }}
{{/each}}
```
Источник `actions` — производное от `actor.items` фильтром `type==='action'` без
группировки. Аналогично для spells, qualities, adept_powers, etc.

> Для этих списков потребуется собственный механизм папок (флаги модуля + клиентский
> рендер группировки).

## 3. Кнопка «+» в заголовках уже есть

`src/templates/v2/list-items/header-add-icon.hbs`:
```hbs
{{> "list-items/add-icon.hbs" action="addItem" tooltip=... type=type data=data }}
```
→ action `addItem` в шитe создаёт новый предмет данного типа.
Можно по соседству добавить нашу кнопку `action="createFolder"`.

## 4. Вложенные предметы (модификации) у оружия

Уже работают через флаги:
- `SR5Item.getNestedItems()` → `getFlag(SYSTEM_NAME, FLAGS.EmbeddedItems) ?? []`
- `SR5Item.setNestedItems(items)` — пишет массив `Item.Source[]` во флаг.
- `SR5Item.prepareNestedItems()` — материализует их в `this.items` (массив SR5Item
  с `parent = this`).
- `SR5Item.createNestedItem(itemData)` — **захардкожено**:
  ```ts
  if (this.type === 'weapon') {
      ...
      if (item.type === 'ammo' || item.type === 'modification')
          currentItems.push(item);
  }
  ```
  То есть «mods» принимает только weapon, и только типы ammo/modification.

UI: `templates/v2/list-items/weapon-modification/{header,item}.hbs` — таб
«Modifications» в листе оружия.

> Чтобы любой предмет принимал любые предметы как mods, проще всего
> **monkey-patch** `createNestedItem` (и переиспользовать всё остальное)
> + инжектировать аналогичный таб «Modifications» в ItemSheet для не-weapon типов.

## 5. Прочее
- ApplicationV2 — это значит хуки `renderSR5BaseActorSheet`/`renderSR5ItemSheet`
  работают как `renderApplicationV2`. Можно делать post-render DOM-патчи.
- В шаблонах системы используется `Handlebars`, регистрируются хелперы в
  `src/module/handlebars/*`.
- Drag&drop на лист — внутри `SR5BaseActorSheet._onDrop*` (стандартная схема V2).
