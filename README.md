<p align="center"><img src="media/wordmark.png" alt="Ultimate Kingdom Manager" width="540"></p>

# Ultimate Kingdom Manager

Kingdom building for Pathfinder 2e Kingmaker that plays like the video game. Every player gets a desk, problems land on it with a deadline, companions take days to sort them out, and your settlements grow while the party is off adventuring.

The kingdom rules in the Kingmaker hardcover are a monthly spreadsheet with dice. You stop the adventure, everyone pulls out their kingdom skills, somebody reads the activity list aloud for the fourth time, and an hour later the realm is slightly bigger and nobody remembers why. The Pathfinder: Kingmaker video game had a better idea. The kingdom runs alongside the adventure. Problems show up on your advisors' desks, you pick who deals with them, time passes and the result comes back. This module brings that to Foundry.

Every seat on the council is a desk and every player sits at one. When something goes wrong in the realm a card lands on the right desk with a deadline. You can handle it personally, which means your character rolls with their own skills and spends their own days on it, or you can delegate it to the companion advising that seat, who rolls their own check and comes back in a few days while you get on with the dungeon. Leave a card too long and it gets worse. Nobody has to run a kingdom turn because there isn't one. The kingdom levels when the party levels, income arrives weekly, events draw themselves each month, and the GM just lets the calendar move.

Settlements grow along tracks instead of a building grid. A capital can push toward markets or temples or walls, and each stage changes what the town can do and how it looks, with a picture of the skyline that fills in as you build. Reach the top of a track and you get a pinnacle.

The adventure's own kingdom events are in here too, sorted by chapter: Grigori stirring up the capital, the trolls, the werewolf, the bloom. The GM picks the chapter and puts them on the desks when the story calls for it, and if you own the official Kingmaker module the cards link straight to the right page of the adventure.

The rest is what makes ruling feel like ruling. Companions advise the seat they're suited to and warm up or cool off depending on how you treat them. Each seat has ambitions to chase and rank-up scenes when it gets there. The council votes on proposals. The ruler can issue decrees, hold court, and in a real mess step down and hand the crown to someone else, which clears the desks at a cost. Crown services let the party spend the treasury on themselves, a teleport between settlements or a raise dead from the temple, without turning kingdom money into magic items.

It keeps the kingdom's numbers itself instead of on the PF2e kingdom sheet, and it works off the Kingmaker hex map. Balanced for parties of four to six, and tested in simulated campaigns from level 1 to 20 with average, skilled and weak parties.

## Requirements

- Foundry VTT v13 or v14
- Pathfinder Second Edition system
- Recommended: **Pathfinder: Kingmaker** (the official module) with its adventure imported, for the region map, hex data and adventure links. Without it, the desks, cards and treasury still work, but nothing on the map does.
- Recommended: **socketlib**, so players can work their desks while the GM is connected.

## Installing

In Foundry, go to **Add-on Modules → Install Module** and paste this manifest URL:

```
https://github.com/Drxogs/ultimate-kingdom-manager/releases/latest/download/module.json
```

On The Forge, stop the server before checking for updates, then restart it.

Coming from a 0.x version? 1.0 starts fresh. The first time the GM loads a world that used the old version, the old kingdom is set aside (kept on the party actor, untouched) and Setup opens.

## Quick start for GMs

1. **Enable the module.** Setup opens the first time the GM logs in.
2. **Import the story text** when asked. It copies the adventure's regions, locations, kingdom events, quests, characters and structures into GM-only journals, so cards can link to the right pages. Your own journals are never changed, and pages you edit are left alone on re-import.
3. **Run Setup:** the kingdom's name and ruler, your table's options, the capital, the founding focus (two realm stats that start at rank 1), and the six leadership seats. Each seat has a character who holds it and an advisor who works the cards you delegate. A seat with no companion gets a hired advisor until the party meets one.
4. **Point your players at the Player's Handbook** in the journal sidebar.

Time drives everything, so advance world time the way you normally do. Every week brings income, food, a little growth for every seat and a small desk matter. Every month brings the random events, an audience and a council reminder. The GM tab has the tools for everything else: editing the realm's numbers, drawing or picking events, and the adventure's story events by chapter.

The map stays yours. When a project finishes or an event changes the land, the module adds a GM task with a jump-to-hex button telling you what to mark with the Kingmaker hex tools. It never edits the map itself.

## In-game handbook

When the GM logs in, the module creates a **Kingdom Manager: Handbook** folder with a **Player's Handbook** everyone can read and a **GM's Handbook**. They're updated with the module; pages you've edited are left alone.

## Compatibility

This module replaces only the kingdom part of *PF2e – Kingdom Building, Camping & Weather*. Both can be active together for camping and weather; just don't use that module's kingdom sheet alongside this one.

## How this module was made

This module was written with **Claude**, an AI model made by Anthropic, working in Claude Code sessions. Claude wrote the code, the templates and styles, the original content (desk matters, rank-up scenes, audiences, seat ambitions, companion abilities, crown services) and the handbook text, and ran the balance simulations.

Drxogs came up with the idea of bringing the Owlcat *Pathfinder: Kingmaker* kingdom game to the tabletop adventure in Foundry, made the design and rules decisions, tests every release in Foundry, and maintains the project. Bug reports and feedback go to the [issue tracker](https://github.com/Drxogs/ultimate-kingdom-manager/issues).

Commits made before v0.15.3 don't mark Claude's part; from v0.15.3 on, commits carry a co-author line.

## Legal

Not affiliated with Paizo or Owlcat Games.

This module uses trademarks and/or copyrights owned by Paizo Inc., used under Paizo's Community Use Policy ([paizo.com/licenses/communityuse](https://paizo.com/licenses/communityuse)). We are expressly prohibited from charging you to use or access this content. This module is not published, endorsed, or specifically approved by Paizo. For more information about Paizo Inc. and Paizo products, visit [paizo.com](https://paizo.com).

No adventure text is included. The story import copies text from your own licensed copy of the adventure into your world.
