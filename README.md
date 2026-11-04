# Night City Map - Night City Investments Bridge

A Foundry VTT bridge module that lets Night City Map gigs move the share price of the client's company in Night City Investments.

## Requirements

- Foundry VTT v12
- Cyberpunk RED Core
- [Night City Map](https://github.com/samroaleksej-bit/night-city-map) (checked against v0.27.1)
- [Night City Investments](https://github.com/Shepskii/night-city-investments)

## Installation

Unzip the release folder to `Data/modules/night-city-map-night-city-investments-bridge`, or install through Foundry with the manifest: https://github.com/Shepskii/night-city-map-night-city-investments-bridge/releases/latest/download/module.json

Enable it in the Module Management of your world, together with Night City Map and Night City Investments.

## How it works

When you mark a gig **Completed** or **Failed** on the map, the bridge reports it to Night City Investments. That module does the rest:

1. It finds the client's company. It tries your saved mappings, then the company name, ticker and aliases (set in the Company Editor), then a name found inside the client text, and last a near-miss spelling.
2. It works out the reaction. A failure hurts more than a success helps, a bigger reward moves the price further, and a company that has had several gig results lately reacts less.
3. The effect shows after one to three days, and a generic headline is published when it does. The headline never says what the gig was.

If a player took the gig from the map or the Agent phone, the bridge also reports their character as the gig's **runner**. With insider-trading heat on in Night City Investments, a runner who trades the client's shares before the news shows draws the most heat.

By default the GM approves each impact first, in the **Gigs** tab of the Market GM Console, where the size, delay and headline can be changed. A client that cannot be matched waits in a "Needs a company" list until you pick one. Your choice is remembered for later gigs from that client.

Night City Map's own gigs have a **client** field only when they were generated. For a gig you wrote yourself, either name the company in the gig's text, or put a tag in the GM notes:

- `[NCI: ARA]` uses that company (a ticker or company id).
- `[NCI: ignore]` leaves the market alone.

## Player businesses on the map

With Night City Investments 0.20.0 or later, each open player business gets a pin on the map, in its district, showing its name, kind, stage and location. Nothing behind the front ever reaches the map: no money, no staff, no back room.

They are ordinary custom pins, so you can move one in the map's Arrange mode, edit it, hide it from players or delete it, and your changes stay. A deleted pin does not come back. A pin's text changes only when the business's own does, and it goes when the business closes. On a custom map, whose districts have other ids, pins start at the map's centre for you to move. The **Show player businesses on the map** setting turns this off.

## What counts as an outcome

- A gig that goes from hidden, offered or active to Completed or Failed is reported once.
- Gigs that were already finished when the module loaded are not reported. Use "Report an outcome by hand" in the Gigs tab for those.
- Changing a finished gig from Completed to Failed (or back) is not reported again. The first result stands.
- The bridge looks whenever the map saves its gigs, so it needs no polling and does not touch the map's own code.
- Only the active GM's client reports. Night City Investments ignores an outcome it has already seen, so nothing is ever applied twice.

## Settings

- **Report gig outcomes to Night City Investments** turns reporting on or off without disabling the module. Gigs closed while it is off are not reported later.

Everything else (approval, strength, rumour mails) is set in Night City Investments.

## Unofficial Content

Night City Map - Night City Investments Bridge is unofficial content provided under the Homebrew Content Policy of R. Talsorian Games and is not approved or endorsed by RTG. This content references materials that are the property of R. Talsorian Games and its licensees.

## License

Copyright (c) 2026 Shepskii. Licensed under the [Mozilla Public License 2.0](LICENSE). Versions up to and including 0.3.0 were released under the MIT License and stay available under it.

This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
