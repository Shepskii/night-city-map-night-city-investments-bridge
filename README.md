# Night City Map - Night City Investments Bridge

A standalone Foundry VTT module that lets Night City Map gigs move the share price of the client's company in Night City Investments.

## Requirements

- Foundry VTT v12
- Cyberpunk RED Core
- [Night City Map](https://github.com/samroaleksej-bit/night-city-map)
- [Night City Investments](https://github.com/Shepskii/night-city-investments) - In Development

## Installation

Unzip the release folder to `Data/modules/night-city-map-night-city-investments-bridge`, or install through Foundry with the manifest: https://github.com/Shepskii/night-city-map-night-city-investments-bridge/releases/latest/download/module.json

Enable it in the Module Management of your world, together with Night City Map and Night City Investments.

## How it works

When you mark a gig **Completed** or **Failed** on the map, the bridge reports it to Night City Investments. That module does the rest:

1. It finds the client's company. It tries your saved mappings, then the company name, ticker and aliases (set in the Company Editor), then a name found inside the client text, and last a near-miss spelling.
2. It works out the reaction. A failure hurts more than a success helps, a bigger reward moves the price further, and a company that has had several gig results lately reacts less.
3. The effect shows after one to three days, and a generic headline is published when it does. The headline never says what the gig was.

By default the GM approves each impact first, in the **Gigs** tab of the Market GM Console, where the size, delay and headline can be changed. A client that cannot be matched waits in a "Needs a company" list until you pick one. Your choice is remembered for later gigs from that client.

Night City Map's own gigs have a **client** field only when they were generated. For a gig you wrote yourself, either name the company in the gig's text, or put a tag in the GM notes:

- `[NCI: ARA]` uses that company (a ticker or company id).
- `[NCI: ignore]` leaves the market alone.

## What counts as an outcome

- A gig that goes from hidden, offered or active to Completed or Failed is reported once.
- Gigs that were already finished when the module loaded are not reported. Use "Report an outcome by hand" in the Gigs tab for those.
- Changing a finished gig from Completed to Failed (or back) is not reported again. The first result stands.
- Only the active GM's client reports. Night City Investments ignores an outcome it has already seen, so nothing is ever applied twice.

## Settings

- **Report gig outcomes to Night City Investments** turns reporting on or off without disabling the module. Gigs closed while it is off are not reported later.

Everything else (approval, strength, rumour mails) is set in Night City Investments.

## Unofficial Content

Night City Map - Night City Investments Bridge is unofficial content provided under the Homebrew Content Policy of R. Talsorian Games and is not approved or endorsed by RTG. This content references materials that are the property of R. Talsorian Games and its licensees.
