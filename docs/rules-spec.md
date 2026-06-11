# Axis & Allies Classic (Second Edition, Milton Bradley 1986) — Engine Rules Specification

Sources: *Axis & Allies Game Play Manual, Second Edition Rules* (`axis-allies-rules-classic-2nd-edition.pdf`, cited below as "p. N") and the official *Axis & Allies FAQ* for the Second Edition rules (`axis-allies-rules-classic-2nd-edition-faqs.pdf`, cited as "FAQ p. N"). This document is intended to be a complete, implementation-ready spec; page citations accompany every rule.

**Ruling hierarchy.** The **2nd-edition rulebook is the core, binding description** of the game. The 2nd-edition FAQ and the 3rd-edition rules compilation (`a-amp-a-classic-3rd-edition-v3.5.pdf`, a community compilation of the 1998 PC-game / 3rd-edition rules, cited as "3e p. N") are used **only to resolve ambiguities or internal inconsistencies in the 2nd-edition text** — never to replace clear 2nd-edition rules that 3rd edition changed deliberately. Known deliberate 3e changes that are **NOT** adopted here include: AA gun cost 8 / defense 1 (3e p. 10; 2e: cost 5, no combat values), carrier cost 15 (3e p. 10; 2e: 18), bomber move 5 / Long Range Aircraft fighter 5 + bomber 7 (3e p. 10; 2e: 6 and 6/8), Heavy Bombers rolling 4 dice (3e p. 10; 2e: 3), mobile combat-firing Rockets targeting capitals (3e p. 4, 10; 2e: stationary AA gun within 3 spaces of any enemy complex), multiple AA guns per territory (3e p. 5; 2e: one), transport bridging "1 AA gun + 1 infantry" (3e p. 6; 2e capacity rules §5.1), naval placement in enemy-occupied sea zones as a core rule (3e p. 8; 2e optional, §12), map adjacency changes (Western Canada/Hudson Bay, Panama as two zones, Kwangtung; 3e p. 2–3), a reordered weapons-development table (3e p. 10), and AA overflight fire demoted to an optional rule (3e p. 5, 9; 2e p. 13 makes it core). §13 records, per ambiguity, what 3e says and the final ruling.

---

## 1. Powers, Turn Order, and the 6-Part Action Sequence

### 1.1 Powers and order of play (p. 6)

Five powers, fixed turn order. One full cycle of all five turns = one **round** (FAQ p. 1).

1. **U.S.S.R.** (Allies)
2. **Germany** (Axis)
3. **United Kingdom** (Allies)
4. **Japan** (Axis)
5. **United States** (Allies)

Starting incomes / starting IPC cash on hand (p. 7, p. 22): USSR 24, Germany 32, UK 30, Japan 25, US 36. (Starting cash handed out equals starting income, p. 7.)

### 1.2 The 6-part Action Sequence (p. 4–6)

On a power's turn, perform these phases in strict order:

1. **Develop Weapons and/or Purchase Units** (p. 4, 10–11)
2. **Combat Movement** (p. 4, 12–17)
3. **Combat** (p. 4–5, 18–20)
4. **Non-Combat Movement** (p. 5, 21)
5. **Place Newly Purchased Units** (p. 6, 21)
6. **Collect Income** (p. 6, 22)

Engine notes (p. 4):
- Every phase except Collect Income is optional ("you may decide to do only part of the sequence"). Collect Income always happens (p. 4).
- If units are purchased in Phase 1, they MUST be placed in Phase 5 (p. 4); units that cannot legally be placed are **lost** (returned to tray, IPCs not refunded) (p. 11, 21).
- If any unit moves into combat in Phase 2, that combat MUST be resolved in Phase 3 (p. 4).
- Weapons development, if attempted, must be done **before** buying units in Phase 1 (p. 10).
- Purchased units are bought in Phase 1 but held off-board until Phase 5 (p. 4).

---

## 2. The Board, Spaces, Adjacency

- The map is divided into **land territories** and **sea zones**; movement is space-to-space between adjacent spaces (spaces sharing a common border) (p. 7–8).
- The board **wraps around** horizontally (right edge adjacent to left edge: Western Canada–Eastern Europe, Western USA–Eastern USA, Mexico–Panama, etc.) but NOT vertically (top not adjacent to bottom) (p. 8).
- Most territories have an income value 1–12 IPCs; some (Gibraltar, Solomon Islands, etc.) have **no income value**. Neutral territories have no income value (p. 8).
- **Islands**: a land territory inside a sea zone. An island group is one land territory; land units on it cannot be split among islands of the group (p. 8).
- Hardcoded adjacency oddities (p. 9):
  - **Panama**: two map sections = one territory; connects two sea zones. Naval units may move/attack between those zones only if you or your allies control Panama **at the beginning of your turn**; otherwise no passage (p. 9).
  - **Suez Canal**: connects a Mediterranean sea zone to an Indian Ocean sea zone. Naval passage requires your alliance to control **both** Anglo-Egypt Sudan and Syria-Iraq. Anglo-Egypt Sudan and Syria-Iraq are land-adjacent to each other (land and air may cross the canal in one move) (p. 9).
  - **Karelia (Leningrad)** touches both the Baltic Sea zone and the sea zone north of Karelia; naval units may launch from either (p. 9).
  - **Finland-Norway is NOT land-adjacent to Eastern Europe** (ship or air required) (p. 9).
  - **No land movement** Gibraltar↔Algeria, or Eastern Europe↔Turkey (p. 9).
  - Ukraine and Caucasus are adjacent; Caucasus is NOT adjacent to Eastern Europe (p. 7).
  - The sea zone directly south of Australia is a single sea zone (p. 9).
- All naval units are always considered "at sea," never "in port," for combat purposes (p. 9).

### Space classifications used throughout (p. 12)

- **Friendly**: controlled or occupied by you or your alliance.
- **Enemy-occupied**: contains enemy units (any sea zone with enemy units; or land territories occupied by enemy forces, including enemy-occupied neutrals).
- **Enemy-controlled (unoccupied)**: no units present but owned by the enemy (control marker or enemy original color). Moving land units in captures/liberates it without battle — this is still a **COMBAT MOVE** (must occur in Phase 2), not a non-combat move (p. 12).

---

## 3. Units: Cost, Movement, Attack, Defense (Reference Chart, p. 9)

| Unit | Cost (IPC) | Move | Attack | Defense | Notes |
|---|---|---|---|---|---|
| Infantry | 3 | 1 | 1 | 2 | Land only (p. 12) |
| Armor (tank) | 5 | 2 | 3 | 2 | Land only; can blitz (p. 13) |
| Fighter | 12 | 4 | 3 | 4 | Land & sea combat (p. 14) |
| Bomber | 15 | 6 | 4 | 1 | Land & sea combat; SBR (p. 15) |
| Antiaircraft gun | 5 | 1 | — | — | Special AA fire only (p. 13) |
| Battleship | 24 | 2 | 4 | 4 | Shore bombardment (p. 15) |
| Aircraft carrier | 18 | 2 | 1 | 3 | Carries 2 fighters (p. 16) |
| Transport | 8 | 2 | — | 1 | Carries land units (p. 16) |
| Submarine | 8 | 2 | 2 | 2 | First-shot, withdraw (p. 17) |
| Industrial complex | 15 | — | — | — | Cannot move/attack/defend (p. 13) |

(AA gun cost 5 IPC per the reference chart, p. 9. The chart shows AA attack/defense as "—": AA guns never roll in normal combat; their only fire is the special anti-air roll, §6.2/§8.)

**Piece-count limit** (FAQ p. 1–2): the number of physical playing pieces is an absolute cap on units in play per power (e.g. max 2 carriers, max 3 bombers per power). Chips multiply stacks of an existing piece, but you cannot have more *stacks* than pieces; this applies all turn, including how attacking groups may split (a 6-bomber force cannot split into more than 3 groups). Recommended engine behavior: enforce per-power unit-count maxima equal to the physical set (set includes 299 units; exact per-type counts are on the trays, p. 7). If you choose not to model this, document it as a deliberate deviation.

---

## 4. Movement Rules

### 4.1 Land units

- **Infantry**: 1 territory (p. 12). **Armor**: 1 or 2 territories (p. 13). **AA gun**: 1 territory (p. 13).
- On a tank's 2-territory move, the first territory passed through must be friendly — unless **blitzing** (p. 13).
- **Blitzing** (p. 13, 27): a combat move in which a tank's first territory is *enemy-controlled but unoccupied*. The tank captures it (place control marker, adjust production chart immediately) and continues into a second territory, which may be enemy-occupied (battle), enemy-controlled, friendly, or neutral (entering neutral = violation, §10). If the first territory is enemy-**occupied** or **neutral**, the tank cannot blitz: it must stop there (and fight, if occupied); even if it wins, it may not continue that turn. A tank that moves first into a friendly territory may then move into an adjacent enemy-occupied territory as a regular (non-blitz) combat move (p. 13).
- In **non-combat movement**, land units may move only into friendly territories (occupied or unoccupied); never into enemy-occupied, enemy-controlled, or neutral territories (p. 21).
- **AA guns**: move 1 in non-combat (or to friendly territories generally); may NEVER move into an enemy-occupied territory as an attacker (p. 13, 21). Limit: **one AA gun per territory** (p. 11, 21). AA guns can be transported by sea (1 transport capacity slot, board+land is the whole move, p. 13).
- **Multinational stacking**: units of different allied powers may occupy the same territory/sea zone ("Multi-Player Force"). They may **defend together** but may **NEVER attack together** (p. 19–20; also Rules Update, p. 3). Each power attacks only on its own turn with its own units.

### 4.2 Naval units

- All ships (battleship, carrier, transport, sub) move 1 or 2 sea zones (p. 15–17, 30).
- On a 2-zone move, the **first zone entered must not be enemy-occupied**; it must be empty, yours, or your alliance's. If the first zone is enemy-occupied, the ship must stop there (and battle, if this is a combat move) (p. 15, 16, 17, 30). Engine rule: ships cannot pass through enemy-occupied sea zones.
- Naval units never enter land territories (p. 15–17).
- In non-combat movement, naval units may move into any friendly/unoccupied sea zone, never into enemy-occupied zones (p. 21).
- Sea zones placed-into or moved-into for unloading interact with Panama/Suez rules above (§2).

### 4.3 Air units

- **Fighter range 4**, **bomber range 6** spaces per turn (p. 14–15). The range is a *total turn budget*: spaces spent flying out in Combat Movement plus spaces spent flying back in Non-Combat Movement must not exceed the range (p. 14, 21).
- Count each territory/sea zone entered after takeoff as 1 space. Island/sea-zone counting rules (p. 14):
  - Flying to an island: the surrounding sea zone and the island count 1 each (2 total).
  - Taking off from a coastal territory or island over water: the first sea zone entered counts 1.
  - Taking off from a carrier: the carrier's own sea zone is "free" (the fighter is considered already in it).
- Air units may overfly enemy and neutral territories en route during the **combat** movement phase (subject to AA fire over AA-equipped territories, §4.4, and neutral-violation penalty for the first violator, §10), but may NOT fly over neutral territories during **non-combat** movement (p. 14, 17, 21).
- **No kamikazes**: an air unit may not fly out to attack unless a legal friendly landing space exists within its remaining range at the time it attacks (p. 14, 28).
- **Landing (non-combat phase)** (p. 14, 21; FAQ p. 1):
  - Air units that attacked and survived MUST move out of the embattled space and land in Non-Combat Movement (must-move exception, p. 21).
  - May land in any territory that was friendly (yours or an ally's) **at the start of your turn**. May NOT land in territories captured this turn — by anyone, whether or not the plane fought there (p. 14, 15, 21).
  - Fighters (only) may land on a carrier owned by you **or any ally**, max 2 fighters per carrier, provided the carrier is reachable within remaining range (p. 14, 21; FAQ p. 1). Bombers can never land on carriers (p. 15).
  - The FAQ confirms: landing spot legality is "controlled by you or an ally at the start of your turn" and within remaining movement (FAQ p. 1). Carriers may move (non-combat) before fighters land on them; engine should resolve carrier non-combat moves before fighter landings (FAQ p. 1, "move carriers before landing fighters").
  - A fighter that cannot reach any legal landing space after battle is **lost** (p. 15: carrier-based fighter case; general principle p. 14).
- **Fighters launching from a carrier to attack** must take off from the zone where the carrier started the turn; you may not move the carrier first and then launch (p. 14).
- **Fighters on an ally's carrier** (FAQ p. 1): they move with the carrier; they cannot fly out to attack on the ally's turn; if the carrier's zone is attacked they defend normally; if the *ally* moves the carrier into combat, those fighters cannot attack but may (with the owner's consent) be taken as casualties.
- **Carrier hit while fighters aboard** (p. 15, 16): fighters based on an attacked carrier are considered defending in the air (defense 4) and are not destroyed with the carrier; after battle each must land in the **same sea zone** — an island there or another carrier with room — else it is lost. Exception: in a **submarine** attack, if the carrier is hit it is lost and the fighters must fight on alone (subs can't hit planes; planes left with no carrier and no landing spot are lost) (p. 16, 17).
- Fighters on an island cannot defend the surrounding sea zone (p. 14). Fighters defend in a sea zone only when on a carrier there (p. 14).

### 4.4 AA guns firing during combat movement (overflight) (p. 13)

During the **enemy's combat movement phase**, whenever enemy planes fly **over** (enter, including merely passing through) a territory containing your AA gun, roll 1 die per plane in the raid; each "1" shoots down one plane (attacker chooses which planes die in multi-plane raids? — the rule says "one plane is shot down and eliminated from play"; the parallel combat-phase rule p. 18 says "the attacker immediately removes the plane of his or her choice", use attacker-chooses). No counterattack. **Once an AA gun has fired it is no longer involved in the land combat** that turn (p. 13, 18). AA guns fire only during enemy combat movement / the AA step of combat — never during the defender's own combat (FAQ p. 1: "AA guns fire only during enemy combat movement"). Engine model: each AA gun fires at most once per enemy turn, at the first batch of planes overflying or attacking its territory; see §6.2 for the in-battle AA step.

---

## 5. Transports and Amphibious Assaults

### 5.1 Capacity (p. 16)

One transport carries exactly **one** of:
- 1 or 2 infantry, **or**
- 1 armor (tank), **or**
- 1 AA gun.

No mixing (a tank + infantry is illegal). Carriers never transport land units (p. 16); battleships never transport anything (p. 15).

### 5.2 Loading/offloading (p. 12–13, 16)

- Loading, moving (0–2 zones), and unloading may all occur **within one move, in one phase**. Cargo can be picked up before, during, or after the transport moves; **once a transport unloads, its move is over** (p. 16).
- **Bridging**: a transport may load and unload without moving sea zones at all (p. 16).
- A land unit's boarding and landing is its **entire move** for the turn: it is illegal for a land unit to move a territory before boarding or after landing (p. 12 infantry, 13 tanks and AA guns). Land units board from a coastal territory adjacent to the transport's zone and unload to a coastal territory/island adjacent to the transport's zone.
- A single transport may unload its 2 infantry into **two different territories** only in **non-combat** movement, both adjacent to the transport's sea zone (FAQ p. 2). In combat (amphibious assault), all assaulting cargo of one transport unloads into the one target territory (p. 12, 18–19).
- Transports may carry land units **of an ally**: the units board on the ally's (owner's) turn, the transport moves on your turn, and the units unload on the ally's next turn. Each power moves only its own pieces in its own phases (p. 16).
- Cargo aboard a transport cannot fire (attack or defend); if the transport is hit, all cargo is lost with it (p. 13, 16).
- In non-combat movement, transports (empty or loaded) may move to friendly coastal zones to load/unload; cargo may stay at sea across turns and land later (p. 12, 13, 21).

### 5.3 Transports in combat (p. 16, 19)

- Transports have **no attack factor**; they defend at 1 (p. 9, 16).
- They still participate in naval battles as targets/"cannon fodder": the **owner chooses casualties**, so a transport may be deliberately chosen as a loss even though it can't shoot (p. 16, 19). On the battle board, attacker transports sit in a special "transports here" position and roll nothing (p. 19).
- A transport that moves **alone** into an enemy-occupied zone as a combat move cannot attack; it must endure one round of defender fire before it may retreat (p. 16–17).

### 5.4 Amphibious assault (p. 12, 15–16, 18–19, 30)

An amphibious assault = attack on an enemy coastal territory or island by land units delivered by transports this turn (p. 15). Full procedure:

1. **Combat movement**: transports (laden), plus any escorting warships/battleships, move to the sea zone adjacent to the target. Other attackers (land units from adjacent territories, planes) may join the same land battle (p. 12).
2. **If enemy naval units occupy that sea zone**: ALL of your attacking naval units in the zone — including the cargo-laden transports — must first fight a **naval battle** and defeat/clear all enemy naval units before any unloading (p. 15). Loaded or unloaded transports can be hit (cargo lost with them) (p. 15, 16).
   - If the zone is cleared and transports survive → unload and fight the land battle. The transports are not part of the land battle and cannot be fired at by the land defender (p. 16).
   - If the zone is NOT cleared → the assault cannot continue; surviving transports must retreat with the other attackers (p. 16).
   - If a naval battle was fought first, battleships **lose** their shore-support shot, and any fighters that fought in the naval battle **cannot** also attack in the land battle that turn (p. 15; FAQ p. 1 — battleships cannot be held out of the naval battle to save the support shot; fighters and bombers may choose which battle to join, battleships may not).
3. **Shore bombardment (one-shot support attack)** — only when there was **no preceding naval battle** (p. 15, 18, 30): each attacking battleship accompanying the assault fires once at the start of the land battle, hitting on 4 or less. Defender chooses casualties; **those casualties still get to counterattack** when the defender fires (p. 15, 18). After firing, battleships are removed from the battle board back to the sea zone; they are immune to the land battle and to defender fire (p. 15, 18–19). Battleships are optional in assaults (p. 15, 30).
4. **Land battle** proceeds as normal land combat (§6.2) with one critical exception: **amphibious land units can NEVER retreat** (p. 15, 16, 18). FAQ p. 1: an amphibious assault is "a fight to the death for every unit involved, both attacking and defending" — no attacker in the land battle retreats (engine rule: if any attacking land unit arrived by transport, the retreat option is disabled for the whole land battle; non-amphibious co-attackers cannot withdraw separately because all attackers must retreat together, p. 18). Attackers CAN retreat from the *naval* battle preceding an assault (FAQ p. 1).
5. Both a naval battle and a land battle can occur in the same territory/zone pair on the same turn (p. 16).

---

## 6. Combat (Phase 3)

General (p. 18): all combat movement finishes before any combat; no reinforcements once combat begins (p. 12, 18); each contested territory/sea zone is a separate battle resolved fully (attacker chooses resolution order; rules don't constrain order — engine may let attacker pick; resolve sea-zone battles gating an amphibious assault before its land battle, p. 15).

Hits: a unit scores a hit if its die roll is **≤** its attack/defense value (p. 4–5, 18). Combat is **simultaneous**: defender's casualties fire back in the same round before removal (p. 5, 18). Attacker's units hit during the counterattack are removed immediately (they already fired) (p. 18). The **owning player always chooses own casualties** (p. 5, 18, 19).

### 6.1 Battle rounds — who picks casualties for multi-power defense (p. 19–20)

When a defended space holds units of two allied powers (Multi-Player Force): they defend together; on each attacker hit the defenders mutually agree which unit dies (if they can't agree, the **attacker** chooses); when counterattacking, each defending power rolls separately for its own units (including casualties) (p. 19–20). Allied units never attack together (p. 19).

### 6.2 Land combat sequence (p. 18)

1. **Put all units on the battle board** (column = the unit's to-hit number).
2. **AA gun fires** (defender, if AA present and attacker has planes): 1 die per attacking plane; each "1" downs a plane (attacker chooses which); no counterattack; AA gun then takes no further part in the battle (p. 18). (If the AA gun already fired at these planes during combat movement overflight it has fired its once; see §4.4.)
3. **Attacker fires**: 1 die per attacking unit (resolve column 1, then 2, 3, 4). Each hit: defender moves a chosen unit behind the casualty line (still fires back this round).
4. **Defender fires**: 1 die per defending unit **including casualties**. Attacker's hit units are removed immediately.
5. **Remove all casualties**: defender's behind-the-line units are removed.
6. **Repeat 3–5** until one of:
   - **A. Attacker withdraws** (retreat option, §6.4) — defender holds.
   - **B. Attacker destroyed** — defender holds.
   - **C. Defender destroyed** — attacker captures (if eligible, §6.6).
   - **D. Both destroyed** — defender holds (p. 5, 18, 20).

### 6.3 Naval combat sequence (p. 19)

1. **Units to the battle board** (attacker's transports in the no-attack slot).
2. **Attacking submarines fire first** (first-shot/sneak attack): 1 die per attacking sub, hit on ≤2 (3 with Super Subs). Planes can never be chosen as sub casualties (p. 17, 19).
3. **Submarine casualties are removed immediately** — sneak-attack victims do NOT counterattack (p. 17, 19).
4. **Attacker fires all other units** (columns in order; hits go behind the casualty line, will fire back).
5. **Defender fires remaining units** (casualties included); attacker's hits removed immediately.
6. **Remove all defender casualties.**
7. **Submarines may withdraw** (special capability, §6.5).
8. **Repeat 2–7** until A/B/C/D as in land combat. (In repeats, attacking subs again fire as first-shot each round — "they must fire first before any other units," p. 19; their victims each round are removed without counterattack, p. 19 step 3.)

No territory changes hands from naval combat — fleets are only diminished (p. 20).

**Submarine specifics** (p. 16–17):
- Subs attack/defend at 2; **attacking** subs get the deadly first-shot each round (p. 17, 19). (Defending subs have no first shot — they fire with the normal defender step.)
- Subs **cannot fire at planes** (p. 17, 19); planes can never be taken as casualties of sub hits (p. 19).
- **If the attacking force is aircraft only, a defending submarine cannot counterattack** (cannot hit planes); after the air attack, surviving defending subs can withdraw (p. 17). (Standard interpretation: air-only attackers can hit subs; subs simply can't shoot back. The rulebook supports this — "Subs can be involved in combat with enemy subs, battleships, carriers and transports but never with fighter planes or bombers" is in tension with the very next sentence allowing aircraft-only attacks on subs; treat "never with planes" as "subs never *fire at* planes." This is the standard ruling. **3e confirms** (3e p. 5): air units can attack a sub; "the sub cannot fire back ... it can never counter attack the air unit's attacks"; a surviving defending sub should withdraw or it will eventually be destroyed. Also 3e p. 6: when a sub attacks a carrier with a fighter aboard, sub hits must be taken by the carrier; the fighter does counterattack.)
- If a carrier is sunk by a sub, its fighters are not protected by the carrier-choice rule; the carrier is lost and the fighters fight on / must land or die (p. 16, 17).

### 6.4 Attacker retreat ("Attack Withdraws — Special Privilege of Attacker") (p. 18–19)

- Retreating is the **attacker's privilege only**; defenders (except subs) never retreat (p. 18; Rules Update p. 3).
- May be exercised after any complete round of firing: attacker stops combat and moves **ALL** surviving attacking units in that battle **together back to ONE single adjacent space from which any of the attacking units came** (land battle → one adjacent territory used as a launch space, p. 18; naval battle → one adjacent friendly-or-unoccupied sea zone from which any attacker came, unless an attacker originated in the embattled zone itself, p. 19).
- Cannot retreat to a space no attacker came from (p. 18).
- Amphibious-assault land units never retreat (§5.4); a lone transport in battle must endure one round of fire before retreating (p. 16–17).
- Planes that "retreat" simply end the battle and land in non-combat movement as usual (engine: retreating air units are not bound to the single retreat territory; they land per §4.3 — the retreat-to-one-space rule governs land/naval pieces; the must-land rules p. 21 govern aircraft).

### 6.5 Submarine withdrawal (p. 17, 19; FAQ p. 2)

Distinct from attacker retreat:
- **When**: at the end of any round, after the defender counterattacks and casualties are removed (p. 17).
- **Who**: available to **both** sides' subs; attacking subs withdraw first, then defending subs (p. 17, 19). Each sub withdraws individually (subs "do NOT have to retreat to the same ONE space that all retreating units must withdraw to," p. 17).
- **Where**: attacking subs → back to ONE adjacent sea zone from which they or any accompanying attacking naval units came; defending subs → ANY one adjacent friendly or unoccupied sea zone (if none exists, they cannot withdraw) (p. 17). FAQ clarification: for defending subs, "friendly or unoccupied" means any adjacent zone with **no enemy naval vessels or aircraft at the time of withdrawal** — including zones the attacker launched from and has since vacated; units on islands in the zone don't matter (FAQ p. 2).

### 6.6 Capturing territory (p. 5, 20)

- On defender destruction in **land** combat, the attacker captures the territory: surviving attacking **land** units occupy it; place control marker; immediately adjust both players' National Production Levels by the territory's value (p. 5, 20).
- **Air units alone can never capture**: if the attacker's only survivors are planes, the planes must fly off and **the defender retains the territory** (p. 20). Engine rule: capture requires ≥1 surviving attacking land unit (infantry or armor).
- AA guns and industrial complexes in a captured territory are **captured, never destroyed** — they now belong to the capturer (p. 13 "AA guns are never destroyed!", p. 20). A captured industrial complex cannot be used by its new owner until the **next turn** ("on the turn after it is captured," p. 14, 20).
- **Liberation** (p. 20): if the captured territory was originally owned by one of your allies (original color / original owner), you are the *liberator*, not the conqueror: the original ally immediately resumes ownership and collects its income. You cannot use an ally's complex even in a territory you liberated — **EXCEPTION**: if that ally's **capital is in enemy hands** at the time of liberation, the liberator takes the territory's income and may use the industrial complex there until the ally's capital is liberated (then ownership/production readjusts) (p. 14, 20, 21).

### 6.7 Capturing a capital (p. 20)

Capitals: Eastern United States, Russia, United Kingdom, Germany, Japan (p. 20).
- **Capturer**: captures the territory normally **plus** takes ALL IPCs in the former owner's hand, plus the income value of the capital and any other territories captured (no income from the victim's uncaptured territories) (p. 20).
- **Former owner**: stays in the game; their units remain and fight; but they **cannot collect income** from any territory and **cannot buy** anything (all IPCs were surrendered) until their capital is liberated (p. 20, 22).
- On liberation of a capital, production-use of that power's complexes reverts and the power resumes collecting/spending (p. 20).

---

## 7. Strategic Bombing Raids (p. 15, 20, 29)

A special attack only **bombers** can make, against an industrial complex in an enemy-occupied territory. A given bomber either makes an SBR or fights in regular combat — not both (p. 15).

Procedure (p. 15, 20):
1. Combat-move 1+ bombers into the enemy territory containing the complex; announce SBR; **no battle board** (p. 20).
2. **Defender's AA fires** (if an AA gun is present): 1 die per bomber; each "1" downs a bomber, no counterattack (p. 15, 20).
3. **Surviving bombers roll 1 die each** (3 dice each with Heavy Bombers, p. 10); sum the dice.
4. **Defender surrenders that many IPCs to the bank.** If the defender lacks enough IPCs, they pay all they have (p. 15, 20).
- Industrial complexes are **never destroyed or removed** by SBR (p. 15, 20).
- Bombers fly home and land in non-combat movement per normal air rules (p. 29). Other defending units in the territory do not fire at SBR bombers (no battle occurs).

---

## 8. Weapons Development (Phase 1, before purchasing) (p. 10)

- Pay **5 IPCs per die**, any number of dice (p. 10).
- Roll the bought dice: each "6" = one breakthrough (p. 10).
- For each breakthrough, roll one more die; the result selects the technology (p. 10). If you roll a technology you already own, **roll again** for a new one (p. 11). Duplicate technologies across powers are fine (p. 11).
- **Effective immediately** — usable this same turn and for the rest of the game (p. 11).
- Technologies are **never shared** with allies (p. 10).

| Roll | Technology | Effect (p. 10) |
|---|---|---|
| 1 | **Jet Power** | Your fighters defend at 5 (instead of 4). |
| 2 | **Rockets** | One free rocket attack per turn: choose one of your AA guns within **3 spaces** of an enemy industrial complex; roll 1 die; the complex's owner pays that many IPCs to the bank. |
| 3 | **Super Submarines** | Your subs attack at 3 (instead of 2). (Defense unchanged.) |
| 4 | **Long Range Aircraft** | Your fighters move 6 (instead of 4); your bombers move 8 (instead of 6). |
| 5 | **Industrial Technology** | All your unit purchase costs reduced by 1 IPC each. |
| 6 | **Heavy Bombers** | Each of your bombers rolls **3 dice instead of 1** — in regular combat (up to 3 hits per bomber) AND in SBRs (each surviving bomber adds 3 dice to the IPC damage). |

---

## 9. Purchasing & Placement (Phases 1 and 5)

### 9.1 Purchasing (p. 11)

- Any units on the reference chart may be bought at listed cost (§3 table). Pay the bank; units wait on your reference chart until Phase 5 (p. 4, 11).
- Weapons development, if any, comes first (p. 10).

### 9.2 Placement (Phase 5) (p. 6, 21)

- **Land and air units**: place in territories where you have owned an industrial complex **since the beginning of your turn** — never at just-captured complexes, never at allies' complexes (p. 6, 21). Exception: you may place at a complex in an ally's territory that **you liberated while that ally's capital is in enemy hands** (p. 21).
- **Naval units**: place in a sea zone **adjacent to** a territory where you've owned a complex since the beginning of your turn; the sea zone must be **friendly (not enemy-occupied)** (p. 6, 21). (Optional rule allows placing into enemy-occupied zones — §12.)
- **New industrial complexes**: place in any territory you have **owned since the beginning of your turn** (not just-captured) (p. 6, 21). Max **one complex per territory** (p. 14, 21). Complexes cannot be moved or destroyed (p. 14).
- Constraints at placement: max one AA gun per territory; fighters cannot be placed directly onto carriers; infantry cannot be placed onto transports (p. 21).
- **Can't place → unit is lost** (no refund) (p. 11, 21).

### 9.3 Production capacity (p. 11, 13–14, 21)

- **Original complexes** (the 8 on the board at setup: per setup these are in Russia, Karelia for USSR; Germany and Southern Europe; United Kingdom and India for UK*; Japan; Eastern & Western USA — *use your setup data; the rule text doesn't list them, p. 6, 11): **unlimited** production — any number of new units per turn (p. 11, 13, 21).
- **New complexes** (purchased, placed, **or captured** during the game): **limited** production — units placed there per turn ≤ the **income value of the territory** (p. 11, 13–14, 21). A new complex on a 0-value territory (Gibraltar, Solomons, neutrals-turned-captured) allows **1 unit per turn** (p. 14).
- Engine note: a *captured* original complex counts as a "new complex" for its captor ("ones that you purchased and placed **or captured** during the game," p. 11; p. 14 "and placed or captured during the game) have limited production"). So Germany capturing the Russia complex may build there only up to Russia's income value (8), not unlimited. Also recall the one-turn delay before a captured complex can be used (p. 14, 20).
- Total new complexes are capped by piece count: only **4** additional complex pieces exist beyond the 8 set up; once 4 new complexes are in play, no more can be built (FAQ p. 1).

---

## 10. Neutral Territories — Violating Neutrality (p. 8, 17)

- Neutrals (Turkey, Mongolia, Spain, etc.) are unowned, have no income value (p. 8).
- Air units may not overfly neutrals in non-combat movement (p. 21); tanks may not blitz through neutrals (p. 13, 17).
- **First violation** (p. 17): the FIRST player to move land units into, or fly air units over, a neutral territory captures it automatically without battle (a COMBAT MOVE) and pays a **3 IPC penalty** to the bank, placing a control marker. Land units entering must stop and end their move there. Air units overflying don't stop, but it still counts as the violation. The penalty is paid once, only by the violator. Captured ex-neutrals still produce 0 income (no income value, p. 8), but a new complex placed there allows 1 unit/turn (p. 14).
- After violation, the territory is no longer neutral — all players treat it as a regular captured territory (p. 17). If an enemy occupies a (violated) neutral, moving in is a regular combat (p. 17).
- If a player flies over a neutral after it is already violated: regular move, no fee (p. 17).
- Ambiguity: the rules don't state who "controls" a neutral merely overflown (air doesn't stop there). Standard interpretation: overflight still triggers the 3-IPC fee and the territory ceases to be neutral, and the violator places a control marker per p. 17(B) ("place one of your control markers on the violated territory"). Implement exactly that: overflight ⇒ fee + control marker, income value remains 0. **3e: silent** — the 3e text never addresses neutral violation or overflight (it only implies neutrals are capturable, 3e p. 8: "You cannot capture a neutral territory ... that is controlled by an ally", and that a complex placed in an ex-neutral produces 1 unit, 3e p. 8). FAQ/standard interpretation stands.

---

## 11. Income & Victory (Phase 6) (p. 22)

### 11.1 Collect income

- At end of turn, collect IPCs equal to your **National Production Level** (sum of income values of territories you control) (p. 6, 22). NPL is adjusted live as territories change hands (p. 5, 20).
- You **cannot** collect any income if your capital is enemy-held (p. 20, 22).
- You can **never loan or give IPCs** to allies (p. 22).

### 11.2 Victory conditions (p. 2, 22) — DEFAULT

- **Allies win**: capture **both** Axis capitals (Germany and Japan). Game ends at the end of the player turn in which the second Axis capital is captured (p. 22).
- **Axis wins** by either (p. 2, 22):
  - **Military victory**: Axis controls **two of the three** Allied capitals (Eastern USA, United Kingdom, Russia). Game ends at end of the turn in which the second Allied capital falls (p. 22).
  - **Economic victory**: Germany + Japan combined National Production Level ≥ **84**, evaluated at the end of a complete round (after all 5 powers have had a turn) (p. 2, 22).
- These asymmetric conditions are the **default/standard game** (p. 22).
- **Individual winner** (optional flavor): within the winning team, the player with the largest %-increase of NPL over starting income, per the percentage tables on p. 22.

### 11.3 China / Allied cooperation

Classic has **no special China rules**: China is simply a US-controlled territory with US pieces (setup, p. 23 map shows US control markers in China/Sinkiang). Allies share territories defensively (Multi-Player Force, §4.1/§6.1), can transport each other's land units (§5.2) and host each other's fighters on carriers (§4.3), but never attack together, never share IPCs (p. 22), never share technologies (p. 10), and never use each other's industrial complexes except the capital-captured liberation exception (p. 14, 21).

---

## 12. Official Optional Rules (Appendix IV, p. 31; FAQ p. 2) — NOT default

- **Total Victory**: two-enemy-capital win additionally requires that none of your own alliance's capitals be enemy-held (p. 31).
- **Placing naval units in enemy-occupied sea zones** adjacent to your complexes (p. 31).
- Axis-balance options (use at most one, FAQ p. 2): Germany starts with Jet Power and Japan with Super Subs (p. 31); USSR may not attack on its first turn (p. 31; FAQ p. 2 notes this is popular at tournaments); No new industrial complexes at all (p. 31; FAQ p. 2).

---

## 12.5 Engine deviations (deliberate, v1)

Documented divergences between `src/engine/` and this spec, chosen for digital
playability or v1 scope. Revisit before calling the rules implementation done.

1. **No physical piece-count caps** (§3): unit counts are unlimited (standard
   for digital ports; TripleA does the same).
2. **Ships may reposition during combat movement** even when not attacking
   (the engine validates movement legality but does not force ship combat
   moves to end in battle). Land and air combat moves ARE restricted to
   hostile destinations. Player-favoring simplification.
3. **Multi-power defender casualty choice** (§6.1): instead of "mutually
   agree, else attacker chooses", the defending power with the most units in
   the battle chooses (tie → turn order).
4. **AA / mixed-plane casualty choice** (§13.11): when AA hits must be
   allocated, the engine auto-kills cheapest planes first instead of asking.
5. **Battleship shore support is automatic**: every eligible attacking
   battleship adjacent to the assault that fought no naval battle this turn
   fires its support shot (attacker cannot decline; declining is never
   beneficial... except edge cases with multiple assaults sharing a zone).
6. **Allied cargo/carrier cooperation** (§5.2, §4.3): v1 transports load only
   the owner's units; allied fighters may share sea zones/carriers for
   capacity purposes but cross-power carry orchestration is not modeled.
7. **Liberation production exception** (§9.2 exception): the liberator-may-use
   -ally's-complex-while-capital-held rule is not implemented; liberated
   territory simply reverts to its original owner when their capital is free.
8. **No-kamikaze landing check** (§4.3): approximated — a fighter may count a
   reachable friendly carrier's potential movement toward a landing spot
   without verifying future capacity contention.
9. **Military victory is checked immediately** on capital capture rather than
   at the end of the player turn (§11.2).
10. **Split unloading** (§13.8): a transport always unloads all cargo to one
   territory; the two-territory noncombat split is not offered.
11. **Strict neutrals**: land units entering a neutral capture it and stop
   (per spec §10); the engine also allows this via amphibious offload.

## 13. Ambiguities and FAQ Rulings Affecting Engine Behavior

1. **AA timing** (FAQ p. 1): AA guns fire **only during enemy combat movement** (overflight) and the AA step of battle/SBR; never on the defender's own turn, never as a normal combat unit. One shot per gun per enemy turn (§4.4). *3e*: confirms the timing window — "Your AA gun fires only during an enemy's combat movement phase," never during enemy non-combat movement (planes flying home are safe) (3e p. 5). Note: 3e demotes fire at merely-overflying planes to the "Always Active AA Guns" optional rule (3e p. 5, 9) — a deliberate 3e change; the 2e core rule (p. 13: overflight in combat movement triggers AA) remains binding. **Final ruling: as stated (2e/FAQ).**
2. **Battleship support vs naval battle** (FAQ p. 1): a battleship in the assault sea zone **must** fight any naval battle there and thereby forfeits its support shot; it cannot be held back. Fighters/bombers may choose which battle (naval or land) to join; battleships may not. *3e*: confirms in full — one shot only (not per defender, not per round), no counterattack against the battleship, support shot forfeited if any sea battle occurs first, and "You cannot willingly keep a battleship out of the sea battle so it can take part in the amphibious assault" (3e p. 6–7). **Final ruling: as stated.**
3. **Amphibious assault retreat** (FAQ p. 1): NOTHING retreats from the amphibious land battle — neither side, no unit type. Attackers may retreat only from the preceding naval battle. *3e*: agrees that the **land units** fight to the death ("no retreating for the land units in the amphibious assault force ... an exception to the normal retreating rules"), but **differs** in allowing "Any Attacking Air Units" to retreat from an amphibious invasion (3e p. 7). The 2e FAQ ruling is explicit ("a fight to the death for every unit involved, both attacking and defending", FAQ p. 1) and is the official 2e clarification, so it stands: **Final ruling: no attacking unit, including aircraft, withdraws from the amphibious land battle** (the 3e air-retreat allowance is treated as a 3e change, not an ambiguity resolution). Flagged: groups that house-rule this often use the 3e reading.
4. **Aircraft landing legality** (FAQ p. 1): landing spot = any territory controlled by you or an ally **at the start of your turn**, or an own/allied carrier with <2 fighters, within remaining movement. Resolve carrier moves before fighter landings; fighters don't move again after landing. *3e*: confirms — retreating/returning air units land during non-combat within remaining range and "can NEVER land in a territory that has just been captured. This includes 'blitzed' territories" (3e p. 6); a carrier cannot move after a plane has landed on it (so carrier non-combat moves resolve first), and fighters must launch before their carrier moves (3e p. 7). **Final ruling: as stated.**
5. **Allied fighters on your carrier** (FAQ p. 1): move with the carrier; can't attack on your turn; defend normally; if you carry them into an attack they don't fire but may be sacrificed as casualties with the owner's consent. *3e*: confirms — if an ally's carrier is attacked with your fighter aboard, you defend with your own plane and each player rolls for their own units; landing on an ally's carrier and being moved by the ally on their turn does not illegally extend the plane's range (3e p. 7). **Final ruling: as stated.**
6. **Stack/piece limits** (FAQ p. 1–2): physical piece counts cap concurrent forces per power (e.g. ≤3 bomber stacks, ≤2 carriers); applies to splitting groups in combat movement too. Chips only scale stack height. *3e*: confirms — "groups are limited to the box number of figures, for example you can only have three groups of Bombers, six of submarines"; max 15 infantry groups per country (3e p. 8). (Engine still deliberately deviates, §12.5 #1.) **Final ruling: as stated.**
7. **Sub withdrawal destinations** (FAQ p. 2): defending subs may withdraw to ANY adjacent zone free of enemy naval vessels/aircraft *at withdrawal time* — including the attacker's now-empty launch zone; island garrisons don't block it. *3e*: confirms that both attacking and defending subs may withdraw after any round and that attacking subs withdraw individually ("partial retreats are allowed for attacking subs"), to one adjacent sea zone any attacking naval unit came from; subs withdrawing on the same round must all go to the same zone (3e p. 4–5). 3e adds restrictions not in 2e: a sub that destroys all defenders is stuck in the zone, and "Subs cannot retreat or withdraw to a sea zone that is or was a battle site on the same turn" (3e p. 4–5) — and offers defending-sub *diving/submerging* (3e p. 5, also listed as an optional rule, 3e p. 9). These are 3e changes; the explicit 2e/FAQ rule (any adjacent zone free of enemy naval units/aircraft at withdrawal time) stands. **Final ruling: as stated (2e/FAQ); no diving, no battle-site restriction.**
8. **Split unloading** (FAQ p. 2): one transport may unload its two infantry to two different adjacent territories in **non-combat** only. *3e*: confirms verbatim — "A transport can unload two infantry into two different territories only during noncombat movement. Both territories need to be adjacent to the same sea zone" (3e p. 6). (3e's expanded bridging capacity of 1 AA gun + 1 infantry, 3e p. 6, is a 3e change — not adopted.) **Final ruling: as stated.**
9. **Complex cap** (FAQ p. 1): max 4 new complexes ever built (piece limit). *3e*: silent on a specific complex cap (only the general box-figure group limit, 3e p. 8) — FAQ/standard interpretation stands.
10. **Subs vs planes** (rulebook tension, p. 17): "subs never in combat with planes" vs the explicit aircraft-only-attack-on-sub rule. Resolution (standard, and supported by p. 17's own example and the air-only clause): planes **can** attack and hit subs; subs can **never** fire at or hit planes; an air-only attack draws no counterattack from defending subs. *3e*: explicitly confirms the resolution — "if an air unit attacks a sub, the sub cannot fire back ... it will eventually be destroyed because it can never counter attack the air unit's attacks" (3e p. 5); sub hits against a carrier+fighter must be taken by the carrier, never the plane (3e p. 6). **Final ruling: as stated — ambiguity resolved, standard interpretation confirmed.**
11. **Who chooses AA casualties**: p. 13 ("one plane is shot down") vs p. 18 ("attacker removes the plane of his choice"). Implement: **attacker chooses** which plane dies per AA hit. *3e*: silent — it only restates "one dice for each attacking air unit" (3e p. 10) with no casualty-choice rule. FAQ/standard interpretation (attacker chooses, per 2e p. 18) stands.
12. **Captured original complexes**: rulebook defines "new complexes" as those "purchased and placed **or captured** during the game" (p. 11, 13–14), so captured complexes — even originally-unlimited ones — produce at the territory's income value for their captor, after the one-turn delay (p. 14, 20). This is the 2nd-edition rule (the Rules Update, p. 3, calls out "newly built **and captured** industrial complexes ... now have limited production"). *3e*: explicitly confirms — a captured complex "will give you limited unit placement capacity on your next turn ... equal to the territory's IPC value. This rule applies even if the complex was an original one" (3e p. 8). **Final ruling: as stated.**
13. **Retreat destination**: 2nd edition requires retreat of ALL attackers to **one** adjacent space any attacker came from (Rules Update p. 3; p. 18–19). Air units exempt — they land via normal non-combat rules (p. 21). *3e*: confirms both halves — "All attacking units must retreat together BACK to one adjacent friendly territory from which any one of the attacking units came" (3e p. 4), and retreating air units "do not ... have to retreat BACK to one adjacent friendly territory" — their retreat is their landing, done in non-combat within remaining range, never into a just-captured (incl. blitzed) territory (3e p. 5–6). Air units must still leave the battle when the rest of the force retreats (no partial retreats, 3e p. 5). **Final ruling: as stated; ambiguity about air-unit retreat destinations resolved in favor of the spec's interpretation.**
14. **Multiple combats per turn**: unlimited; each unit may join only one battle per turn (p. 12). *3e*: consistent — the same territory may even suffer an SBR and a regular attack on the same turn, but never with the same bombers (3e p. 8). **Final ruling: as stated.**
15. **Enemy-controlled unoccupied territory capture is a combat move** (p. 12) — it must happen in Phase 2, can chain with blitzing, and is unavailable in Phase 4. *3e*: silent on the phase question — FAQ/standard interpretation stands. (3e does clarify what "unoccupied" means for blitzing — see §13.20.)
16. **Order of battle resolution**: attacker's choice, except a naval battle gating an amphibious assault resolves before its land battle (p. 15, 18). *3e*: consistent; adds that when the same territory gets both an SBR and a regular attack, the SBR resolves first (3e p. 8) — adopted, see §13.21. **Final ruling: as stated.**
17. **No income for incomeless captures**: Gibraltar, Solomon Islands, ex-neutrals, etc. are worth 0 IPC; capture adjusts NPL by 0 (p. 8). *3e*: consistent — a complex placed in a (captured) neutral territory "can produce 1 unit on the following turn" (3e p. 8), matching 2e p. 14. **Final ruling: as stated.**
18. **Turn vs round** (FAQ p. 1): "round" for the 84-IPC economic-victory check = full USSR→US cycle, checked at the end of the round (p. 2, 22). *3e*: confirms the definition — "A round is made up of five turns, one per world super power," in the order USSR, Germany, UK, Japan, USA (3e p. 11). (3e's 110-IPC *Allied* economic victory, 3e p. 10, is an optional 3e rule — not adopted.) **Final ruling: as stated.**

### §13.19+ — additional clarifications from 3rd edition

These resolve genuine 2nd-edition vagueness (they are clarifications consistent with the 2e text, not 3e-only rule changes). Each is adopted as the spec ruling.

19. **No retreat from nothing** (3e p. 4): "An attacker cannot retreat from NOTHING ... if all the defending units are destroyed in the embattled territory or sea zone, then the attacking forces are stuck there." The 2e retreat rule (p. 18–19) never says when retreat ceases to be available; ruling: once the defender is wiped out, the battle is over (outcome C, §6.2) and no retreat/withdrawal is possible — this applies to attacking subs too (3e p. 4, item C: a sub that destroys the enemy "is stuck in that zone").
20. **Blitzing through AA guns / industrial complexes** (3e p. 8): "A tank can blitz through a territory with an enemy AA gun and/or industrial complex on it. Such a territory is not considered enemy occupied." Resolves the 2e vagueness about whether non-combat units "occupy" a territory for blitz purposes (2e p. 13 says the first territory must be unoccupied; AA guns/complexes can't fight and are captured, never destroyed, p. 13, 20). Ruling: a lone AA gun and/or complex does not block a blitz; the blitzing tank captures the territory (and the AA gun/complex) in passing.
21. **SBR plus regular attack on the same territory** (3e p. 8): allowed on the same turn with *different* bombers; the SBR resolves first. Resolves 2e silence on combining the two attack types (2e p. 15 only says one bomber can't do both).
22. **Assault cannot be aborted after a missed bombardment** (3e p. 7): "If your battleship fires and misses in a one shot support, you cannot abort your assault because your land units are already considered 'landed' before your battleship fires." Resolves 2e sequencing vagueness (p. 15, 18): unloading is committed before the support shot; the land battle must then be fought (consistent with §13.3 no-retreat).
23. **Income timing after capital liberation** (3e p. 7–8): surrendered IPCs are never returned; on the post-liberation turn the power normally has 0 IPCs and so cannot purchase, but **does collect income at the end of that turn** and may purchase the following turn. (Exception: IPCs looted from an enemy capital captured while your own was enemy-held may be spent immediately.) Resolves 2e p. 20's vague "resumes collecting/spending": collection resumes with the power's own Phase 6 after liberation, not retroactively.
24. **Captured AA guns can't move the turn they're captured** (3e p. 5): an AA gun captured during combat movement may not move in the same turn's non-combat phase. Resolves 2e silence (p. 13, 20 say guns are captured, not when they become mobile); consistent with the captured-complex one-turn delay (p. 14, 20).
25. **Suez/canal control applies only to sea units** (3e p. 6): air units fly over/through the canal freely regardless of who controls it. Consistent with 2e p. 9 ("land and air may cross in one move") — adopted as explicit: canal control checks gate naval movement only.
