/**
 * Night City Map -> Night City Investments bridge.
 *
 * Watches Night City Map's gigs. When one goes from open (hidden, offer or active) to done or failed,
 * the outcome is reported to Night City Investments, which finds the client's company and moves its
 * share price after a short delay. Night City Map has no hooks of its own, but every change to a gig
 * goes through its `save()`, which writes the map's `state` world setting, so the setting changing
 * is the signal to look.
 *
 * Only the active GM reports. Night City Investments ignores an outcome it has already seen, so a
 * repeat is harmless.
 */

const MODULE_ID = 'night-city-map-night-city-investments-bridge';
const MAP_ID = 'night-city-map';
const INVEST_ID = 'night-city-investments';
const MAX_ATTEMPTS = 20;
const CLOSED = new Set(['done', 'failed']);

const text = (value) => (value == null ? '' : String(value).trim());

/**
 * Compare the map's gigs with what we saw last time.
 * The first look (`known` is null) only records statuses, so gigs that were already finished
 * before the bridge started are never reported. A gig that is already done or failed and changes
 * to the other one is not reported either: it was counted when it first closed.
 *
 * @param {Map<string, string>|null} known - gig id to status from the last look
 * @param {object[]} gigs - the map's `quests`
 * @returns {{next: Map<string, string>, transitions: {gig: object, outcome: 'done'|'failed', from: string}[]}}
 */
export function diffGigs(known, gigs) {
  const next = new Map();
  const transitions = [];
  for (const gig of gigs ?? []) {
    if (!gig?.id) continue;
    next.set(gig.id, gig.status);
    const before = known?.get(gig.id);
    if (before !== undefined && before !== gig.status && CLOSED.has(gig.status) && !CLOSED.has(before)) {
      transitions.push({ gig, outcome: gig.status, from: before });
    }
  }
  return { next, transitions };
}

/**
 * What Night City Investments needs to know about a finished gig.
 * @param {string[]} [runners] - ids of the characters who ran it; Night City Investments counts their
 *        trades in the client's shares as better informed than anyone's
 */
export function buildReport(gig, outcome, runners = []) {
  return {
    gigId: gig.id,
    sourceKey: `gig:${gig.id}:${outcome}`,
    outcome,
    client: text(gig.client),
    reward: text(gig.reward),
    title: text(gig.title),
    desc: text(gig.desc),
    notes: text(gig.notes),
    takenBy: text(gig.takenBy),
    runners,
  };
}

/**
 * The character who took a gig. The map records the taker's character name, or their user name if
 * they have no character, so look for a character of that name first, then a user's character.
 * @param {string} takenBy
 * @param {{actors: object[], users: object[]}} world
 * @returns {string[]} the character's id, or nothing
 */
export function findRunners(takenBy, { actors, users }) {
  const name = text(takenBy);
  if (!name) return [];
  const actor = actors.find((a) => a.type === 'character' && a.name === name) ?? users.find((u) => u.name === name)?.character;
  return actor?.id ? [actor.id] : [];
}

/**
 * The watcher, with everything it touches passed in so it can be tested without Foundry.
 * @param {object} o
 * @param {() => object[]} o.getGigs
 * @param {() => object|undefined} o.getApi - the Night City Investments API
 * @param {() => boolean} o.isActiveGM
 * @param {() => boolean} [o.enabled]
 * @param {(key: string) => void} [o.warn] - called once for each kind of problem
 * @param {(gig: object) => string[]} [o.runnersOf] - ids of the characters who ran a gig
 */
export function createBridge({ getGigs, getApi, isActiveGM, enabled = () => true, warn = () => {}, runnersOf = () => [], logger = console }) {
  let known = null;
  let chain = Promise.resolve();
  const outbox = new Map();
  const warned = new Set();

  const warnOnce = (key) => {
    if (warned.has(key)) return;
    warned.add(key);
    warn(key);
  };

  async function deliver() {
    if (!outbox.size || !isActiveGM()) return;
    const events = getApi?.()?.events;
    if (typeof events?.reportImpact !== 'function') {
      warnOnce(getApi?.() ? 'OldInvestments' : 'NoInvestments');
      return;
    }
    for (const [key, entry] of [...outbox]) {
      try {
        const result = await events.reportImpact(entry.payload);
        // "invalid" can never succeed, so it is dropped rather than retried.
        if (result?.ok || result?.status === 'invalid') {
          outbox.delete(key);
          logger.info?.(`${MODULE_ID} | ${key}: ${result?.status ?? 'sent'}`);
          continue;
        }
        entry.attempts += 1;
      } catch (error) {
        entry.attempts += 1;
        logger.error?.(`${MODULE_ID} | Reporting ${key} failed`, error);
      }
      if (entry.attempts >= MAX_ATTEMPTS) {
        outbox.delete(key);
        logger.error?.(`${MODULE_ID} | Gave up reporting ${key}`);
      }
    }
  }

  /** Send whatever is waiting. Runs one delivery at a time. */
  function flush() {
    chain = chain.then(deliver).catch((error) => logger.error?.(`${MODULE_ID} | Delivery failed`, error));
    return chain;
  }

  /** Look at the gigs, queue any new outcomes, and send them. */
  function scan() {
    const { next, transitions } = diffGigs(known, getGigs());
    known = next;
    if (isActiveGM() && enabled()) {
      for (const { gig, outcome } of transitions) {
        const payload = buildReport(gig, outcome, runnersOf(gig));
        if (!outbox.has(payload.sourceKey)) outbox.set(payload.sourceKey, { payload, attempts: 0 });
      }
    }
    return flush();
  }

  return { scan, flush, outbox, seen: () => known };
}

// ── Foundry wiring ───────────────────────────────────────────────────────────

if (typeof Hooks !== 'undefined') {
  const mapGigs = () => game.settings.get(MAP_ID, 'state')?.quests ?? [];
  const activeGM = () => !!game.user?.isGM && game.user.id === game.users.activeGM?.id;

  Hooks.once('init', () => {
    game.settings.register(MODULE_ID, 'enabled', {
      name: 'NCIB.Settings.Enabled.Name',
      hint: 'NCIB.Settings.Enabled.Hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });
  });

  Hooks.once('ready', () => {
    if (!game.user?.isGM) return;
    if (!game.modules?.get?.(MAP_ID)?.active) {
      ui.notifications.warn(game.i18n.localize('NCIB.Warn.NoMap'));
      return;
    }

    const bridge = createBridge({
      getGigs: mapGigs,
      getApi: () => game.modules?.get?.(INVEST_ID)?.api,
      isActiveGM: activeGM,
      enabled: () => game.settings.get(MODULE_ID, 'enabled') !== false,
      warn: (key) => ui.notifications.warn(game.i18n.localize(`NCIB.Warn.${key}`)),
      runnersOf: (gig) => findRunners(gig.takenBy, { actors: game.actors.contents, users: game.users.contents }),
    });
    bridge.scan();

    // Every gig change is saved to the map's world setting, and this fires on every client as soon as
    // it is. The very first save in a world creates the setting instead of updating it.
    const onSetting = (setting) => {
      if (setting?.key === `${MAP_ID}.state`) bridge.scan();
    };
    Hooks.on('updateSetting', onSetting);
    Hooks.on('createSetting', onSetting);

    console.info(`${MODULE_ID} | Watching Night City Map gigs.`);
  });
}
