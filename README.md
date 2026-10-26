# Ultimate Kingdom Manager

Kingdom management for the **Kingmaker** Adventure Path in Pathfinder Second Edition, played the way a strategy game plays it: events and projects arrive on the calendar, every leader runs their own desk, advisors are busy for days at a time, and the kingdom always stays at the party's level.

## Requirements

- Foundry VTT v13 or v14
- Pathfinder Second Edition system
- Recommended: **Pathfinder: Kingmaker** (official module), with its adventure imported, for the region map, hex data and adventure text. Without it, desks, cards and the treasury still work, but nothing on the map does.

## Installing

In Foundry, go to **Add-on Modules → Install Module** and paste this manifest URL:

```
https://github.com/Drxogs/ultimate-kingdom-manager/releases/latest/download/module.json
```

On The Forge, stop the server before checking for updates, then restart it.

## Quick start for GMs

1. **Build the kingdom first.** Finish the kingdom builder on the party sheet's Kingdom tab: charter, heartland, government, trained skills and ability boosts. Advisors roll the kingdom's skills, so if this is skipped everything rolls at an untrained +0.
2. **Enable the module.** The setup window opens the first time the GM logs in.
3. **Import the story text** when asked. It copies the adventure's regions, locations, kingdom events, quests, characters and structures into GM-only journals. Your original journals are never changed, and pages you edit are left alone on re-import.
4. **Run Setup:** table options, the founding focus (two realm stats that start at rank 1), and the eight leadership seats. Seats held by companion advisors get a player supervisor, so every desk has someone at the table looking after it.
5. **Point your players at the Player's Handbook** in the journal sidebar.

Time drives everything, so advance world time the way you normally do. Every week brings income, food upkeep, a little growth for every filled seat and one small desk matter. Every month brings major events from the adventure, an audience and a council reminder.

The map stays yours. When a project finishes or an event changes the land, the module adds a GM task with a jump-to-hex button telling you what to mark with the Kingmaker hex tools. It never edits the map itself.

## For players

Open the Kingdom Manager from the rook button in the token controls or on the party sheet.

- **Your desk** holds your seat's cards. **Delegate** to your advisor, **Handle personally** with your own character's skill, take some problems **to the party** as an adventure, or **Hear** a petitioner and choose your answer. Every card shows its odds and its possible outcomes before you commit.
- Checks roll when the work is done. The result waits on the card so you can **reroll** from the chat card with a hero point, or **Accept** it.
- **Realm stats** fill as you succeed. When one is full, begin a **rank-up** and choose its reward.
- **Start project** to claim hexes, build roads, farms, work sites and buildings, or use your companion advisor's ability. Pay now or **propose it to the council** for a vote.
- Kingdom money never becomes your gold, except through the Treasurer's **Tap the treasury**, which leaves the realm in debt.

## In-game handbook

When the GM logs in, the module creates two journals in a **Kingdom Manager: Handbook** folder: a **Player's Handbook** everyone can read (how desks, rolls, ranks, projects, the council, audiences and money work, plus a glossary and reference tables for rank-up choices, projects, companion abilities and seat ambitions) and a **GM's Handbook** (setup, the calendar, map tasks, GM controls, settings, the numbers behind costs and income, and troubleshooting). The **Handbook** button on the Realm tab opens it. They're updated with the module; pages you've edited are left alone.

## Settings

- Desks open between sessions, and whether the GM reviews requests first
- Tap the Treasury: allowed, allowed with GM approval, or disabled
- Weekly desk matters, monthly audiences, and the council, each on or off
- Advisor warnings about dangerous regions
- What happens to map pins once an event is resolved

## Compatibility

This module does not replace the camping and weather rules of *PF2e – Kingdom Building, Camping & Weather*. Both can be active together; just don't use that module's kingdom sheet alongside this one.

## How this module was made

This module was written with **Claude**, an AI model made by Anthropic, working in Claude Code sessions. Claude wrote the code, the templates and styles, the original content (desk matters, rank-up scenes, audiences, seat ambitions, companion abilities) and the handbook text.

Drxogs came up with the idea of bringing the Owlcat *Pathfinder: Kingmaker* kingdom game to the tabletop adventure in Foundry, set the direction and rules decisions, tests it in his own campaign, and maintains the project. Bug reports and feedback go to the [issue tracker](https://github.com/Drxogs/ultimate-kingdom-manager/issues).

Commits made before v0.15.3 don't mark Claude's part; from v0.15.3 on, commits carry a co-author line.

## Legal

This module uses trademarks and/or copyrights owned by Paizo Inc., used under Paizo's Community Use Policy ([paizo.com/licenses/communityuse](https://paizo.com/licenses/communityuse)). We are expressly prohibited from charging you to use or access this content. This module is not published, endorsed, or specifically approved by Paizo. For more information about Paizo Inc. and Paizo products, visit [paizo.com](https://paizo.com).

No adventure text is included. The story import copies text from your own licensed copy of the adventure into your world.
