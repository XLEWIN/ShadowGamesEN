"""Word database operations — seeding, random selection, per-game tracking."""

import logging
from datetime import datetime, timezone
from typing import List, Optional

import aiosqlite

from shadow_game_bot.core.normalization import normalize_word

logger = logging.getLogger(__name__)

# ══════════════════════════════════════════════
#  NORMAL words — real-world objects, food, animals, etc.
# ══════════════════════════════════════════════

DEFAULT_WORDS_NORMAL = [
    # ── Easy (existing) ──
    "apple", "banana", "orange", "mango", "grape", "watermelon", "pineapple",
    "strawberry", "peach", "cherry", "elephant", "tiger", "lion", "giraffe",
    "zebra", "panda", "dolphin", "penguin", "kangaroo", "rabbit",
    "castle", "palace", "school", "hospital", "library",
    "museum", "airport", "station", "restaurant", "stadium", "mountain", "volcano",
    "desert", "ocean", "island", "river", "waterfall", "forest", "cave", "beach",
    "sun", "moon", "star", "rainbow", "cloud", "thunder", "lightning", "snow",
    "wind", "rain", "computer", "keyboard", "mouse", "monitor", "camera", "phone",
    "tablet", "printer", "speaker", "headphones", "bicycle", "motorcycle", "airplane",
    "helicopter", "submarine", "rocket", "train", "bus", "boat", "tractor", "doctor",
    "teacher", "farmer", "pilot", "chef", "artist", "singer", "actor", "detective",
    "firefighter", "book", "pencil", "eraser", "notebook", "backpack", "clock",
    "umbrella", "mirror", "candle", "lantern", "pizza", "burger", "sandwich",
    "popcorn", "chocolate", "icecream", "pancake", "noodles", "cookie", "cake",
    "football", "cricket", "basketball", "tennis", "hockey", "boxing", "swimming",
    "running", "cycling", "wrestling", "queen", "knight", "captain",
    "soldier", "president", "judge", "leader", "merchant", "treasure", "map", "key",
    "diamond", "crown", "sword", "shield", "arrow", "hammer", "ring", "garden",
    "farm", "bottle", "glass", "plate", "spoon", "fork", "knife", "chair", "table",
    "window", "door", "smile", "laugh", "cry", "dance", "sleep", "dream", "jump",
    "climb", "whisper", "shout", "angry", "brave", "clever", "lazy",
    "strong", "weak", "fast", "slow", "silent", "magic", "mystery", "adventure",
    "battle", "victory", "secret", "shadow", "legend", "fortune", "trophy",
    "festival", "holiday", "guitar", "piano", "drum", "violin", "microphone",
    "television", "radio", "newspaper", "magazine",
    # ── Harder (existing) ──
    "avalanche", "compass", "telescope", "hourglass", "labyrinth", "eclipse",
    "quicksand", "hurricane", "tsunami", "mirage", "oasis", "geyser", "glacier",
    "meteorite", "constellation", "nebula", "orbit", "gravity", "parachute",
    "subway", "escalator", "elevator", "typewriter", "microscope", "stethoscope",
    "thermometer", "calculator", "antenna", "satellite", "caterpillar", "chameleon",
    "scorpion", "octopus", "jellyfish", "porcupine", "rhinoceros", "hippopotamus",
    "crocodile", "flamingo", "woodpecker", "peacock", "falcon", "owl", "walrus",
    "platypus", "mongoose", "armadillo", "hedgehog", "carousel", "trampoline",
    "marionette", "puppet", "jigsaw", "chessboard", "dominoes", "yo-yo",
    "boomerang", "accordion", "saxophone", "trumpet", "xylophone", "tambourine",
    "harmonica", "metronome", "headset", "projector", "joystick", "blueprint",
    "dictionary", "encyclopedia", "manuscript", "sculpture", "portrait",
    "masterpiece", "photograph", "headline", "astronaut", "archaeologist",
    "architect", "engineer", "journalist", "magician", "astronomer", "geologist",
    "surgeon", "blacksmith", "carpenter", "tailor", "librarian", "photographer",
    "lighthouse", "skyscraper", "observatory", "greenhouse", "watermill",
    "windmill", "drawbridge", "tunnel", "fortress", "cathedral", "monument",
    "amphitheater", "fountain", "harbor", "mapmaker", "riddle", "enigma", "puzzle",
    "clue", "evidence", "cipher", "password", "disguise", "costume", "masquerade",
    "illusion", "miracle", "mythology", "prophecy", "spellbook", "artifact",
    "invention", "experiment", "laboratory", "reactor", "magnet", "battery",
    "circuit", "algorithm", "software", "database", "firewall", "browser",
    "website", "microchip", "drone", "robotics", "hologram", "virtual",
    "simulation", "avocado", "pomegranate", "blueberry", "raspberry", "coconut",
    "broccoli", "asparagus", "cauliflower", "pumpkin", "artichoke", "cinnamon",
    "vanilla", "pepper", "mustard", "vinegar", "honeycomb", "waffle", "croissant",
    "pretzel", "tornado", "blizzard", "drought", "monsoon", "rainfall",
    "snowflake", "rainforest", "earthquake", "patience", "curiosity", "jealousy",
    "wisdom", "ambition", "freedom", "justice", "loyalty", "kindness",
    "strategy", "defeat", "journey", "discovery", "survival", "challenge",
    "conspiracy", "medal", "passport",
    # ── User's 500 nonfiction words (part 1) ──
    "acorn", "adapter", "adhesive", "aircraft", "airflow", "alarm", "algebra",
    "almond", "anchor", "anvil", "apartment", "apricot", "aquarium", "archive",
    "armchair", "asphalt", "avocado", "awning", "backpack", "badminton", "bakery",
    "balcony", "balloon", "barcode", "barley", "basement", "battery", "beacon",
    "beehive", "bell", "bicycle", "binoculars", "blanket", "blender", "blueberry",
    "bookcase", "bottle", "bouquet", "bracelet", "bread", "broccoli", "browser",
    "bucket", "button", "cabbage", "cabinet", "calculator", "calendar", "camera",
    "campfire", "candle", "canoe", "canvas", "caravan", "carpet", "carrot", "cashew",
    "ceiling", "cellar", "cement", "cereal", "charger", "cheese", "cherry",
    "chimney", "circuit", "clipboard", "clothing", "clover", "coastline", "coconut",
    "coffee", "collar", "concrete", "cookie", "copper", "coral", "corn", "cottage",
    "couch", "courtyard", "crayon", "cricket", "crystal", "cupboard", "curtain",
    "cushion", "dashboard", "daylight", "deodorant", "desk", "diamond", "dictionary",
    "dishwasher", "document", "doorknob", "drawer", "drill", "drum", "earphone",
    "eclipse", "eggplant", "elastic", "envelope", "eraser", "escalator", "ethernet",
    "fabric", "falcon", "faucet", "feather", "fence", "ferry", "fireplace",
    "flashlight", "flask", "flooring", "flowerpot", "footprint", "fork", "fountain",
    "freezer", "fridge", "funnel", "garlic", "garden", "garment", "gasoline", "gears",
    "generator", "ginger", "glacier", "globe", "gloves", "grape", "grapefruit",
    "grasshopper", "gravel", "greenhouse", "guitar", "hammer", "hamper", "headphones",
    "helmet", "honey", "honeycomb", "horizon", "hose", "hospital", "iceberg",
    "icecream", "ink", "insect", "internet", "iron", "island", "jacket", "jar",
    "jelly", "journal", "keyboard", "kettle", "keychain", "kitchen", "kiwi", "ladder",
    "lantern", "laptop", "laundry", "leather", "lemon", "lemonade", "lettuce",
    "lifeboat", "lighthouse", "luggage", "magazine", "magnet", "mailbox", "map",
    "marble", "marker", "market", "mask", "mattress", "measuringtape", "medal",
    "megaphone", "melon", "microscope", "microwave", "milk", "mirror", "mobile",
    "monument", "motorcycle", "mug", "mushroom", "napkin", "necklace", "notebook",
    "nutmeg", "oatmeal", "ocean", "onion", "orange", "oven", "oyster", "package",
    "paintbrush", "pancake", "paperclip", "parachute", "passport", "peach", "peanut",
    "pear", "pepper", "perfume", "piano", "pickle", "pillow", "pineapple", "pingpong",
    "piston", "pizza", "planet", "plate", "plumber", "pocket", "podcast", "porch",
    "potato", "printer", "projector", "pumpkin", "puzzle", "quartz", "radar", "radio",
    "raincoat", "raisin", "rake", "raspberry", "refrigerator", "remote", "restaurant",
    "ribbon", "rice", "roaster", "rocket", "rope", "sandal", "sandwich", "saucepan",
    "scarf", "school", "scissors", "screwdriver", "seashell", "seatbelt", "shampoo",
    "shelf", "ship", "shoelace", "shovel", "shower", "sidewalk", "siren", "skateboard",
    "skillet", "sleepingbag", "slipper", "smartphone", "soap", "socket", "socks",
    "spatula", "sponge", "squirrel", "stapler", "statue", "stepladder", "strawberry",
    "suitcase", "sunglasses", "sunflower", "sunscreen", "sweater", "swimmingpool",
    "tablecloth", "tablet", "teapot", "thermometer", "thimble", "thread", "ticket",
    "toaster", "towel", "tractor", "trafficlight", "train", "trashcan", "tripod",
    "trophy", "tunnel", "umbrella", "vacuum", "valley", "wallet", "wardrobe", "watch",
    "waterfall", "watermelon", "wheelbarrow", "window", "windshield", "windmill",
    "wrench", "yacht", "yogurt", "zebra",
    # ── User's 500 nonfiction words (part 2) ──
    "acoustic", "airport", "alphabet", "ambulance", "antique", "apron", "architecture",
    "athlete", "attic", "auditorium", "autumn", "aviation", "balance", "bandage",
    "barometer", "beverage", "blueprint", "boiler", "border", "bowl",
    "bridge", "brochure", "campus", "canal", "carousel", "cashier", "cathedral",
    "cello", "ceramic", "cliff", "coaster", "conference", "container", "corridor",
    "costume", "cream", "currency", "customs", "dentist", "department", "desert",
    "diagram", "dinner", "director", "drain", "drought", "economy", "electricity",
    "elevator", "embassy", "engine", "entrance", "equipment", "exercise", "factory",
    "festival", "filter", "firefighter", "furniture", "garage", "geography", "grinder",
    "grocery", "harbor", "harvest", "highway", "holiday", "humidity", "industry",
    "instrument", "insurance", "journalism", "landscape", "library", "machinery",
    "manager", "marathon", "medicine", "mercury", "museum", "navigation", "newspaper",
    "noodles", "nutrition", "office", "operator", "orchard", "paint", "parade",
    "parking", "photograph", "pharmacy", "platform", "plaza", "police", "postcard",
    "prescription", "produce", "railway", "reception", "recycling", "research",
    "reservation", "roadway", "safety", "salad", "schedule", "seaport", "security",
    "shipment", "shopping", "signal", "software", "stadium", "station", "statistics",
    "storage", "subway", "sunrise", "sunset", "supermarket", "surgery", "technology",
    "telephone", "theater", "thermostat", "tourism", "traffic", "transport",
    "university", "warehouse", "weather", "website", "workshop",
    # ── User's 500 nonfiction words (part 3) ──
    "acornstone", "aftershave", "airbag", "airconditioner", "appliance", "apronclip",
    "backrest", "barometercase", "bathrobe", "bedframe", "bookshelf", "breadboard",
    "briefcase", "brochurestand", "cable", "campsite", "carriage", "cashbox",
    "ceilingfan", "cellphone", "chalkboard", "checkout", "clocktower", "coat",
    "coffeegrinder", "compasscase", "countertop", "cradle", "cupcake", "curb",
    "doorbell", "doorway", "drainpipe", "drillbit", "dustpan", "earring",
    "electrician", "extension", "fan", "firewood", "flagpole", "floorlamp",
]


# ══════════════════════════════════════════════
#  FICTION words — anime, movies, series, characters
# ══════════════════════════════════════════════

DEFAULT_WORDS_FICTION = [
    # ── Naruto ──
    "Naruto", "Sasuke", "Sakura", "Kakashi", "Itachi", "Madara", "Obito", "Hinata",
    "Neji", "Gaara", "Jiraiya", "Tsunade", "Orochimaru", "Minato", "Nagato", "Konan",
    "Deidara", "Sasori", "Shikamaru",
    # ── Bleach ──
    "Ichigo", "Rukia", "Renji", "Byakuya", "Toshiro", "Kenpachi", "Aizen",
    "Ulquiorra", "Grimmjow", "Yhwach",
    # ── Dragon Ball ──
    "Goku", "Vegeta", "Gohan", "Piccolo", "Trunks", "Frieza", "Cell", "Broly",
    "Buu", "Beerus",
    # ── One Piece ──
    "Luffy", "Zoro", "Nami", "Usopp", "Sanji", "Robin", "Franky", "Brook",
    "Chopper", "Ace", "Shanks", "Mihawk", "Law", "Doflamingo", "Kaido", "BigMom",
    "Katakuri",     "Sabo", "Smoker",
    # ── Attack on Titan ──
    "Eren", "Mikasa", "Armin", "Levi", "Erwin", "Reiner", "Annie", "Zeke", "Historia",
    # ── Demon Slayer ──
    "Tanjiro", "Nezuko", "Zenitsu", "Inosuke", "Giyu", "Shinobu", "Rengoku",
    "Tengen", "Muzan", "Akaza",
    # ── My Hero Academia ──
    "Deku", "Bakugo", "Todoroki", "AllMight", "Uraraka", "Aizawa", "Shigaraki",
    "Dabi", "Toga",
    # ── Hunter x Hunter ──
    "Gon", "Killua", "Kurapika", "Leorio", "Hisoka", "Chrollo", "Meruem",
    "Netero", "Illumi", "Biscuit",
    # ── Fullmetal Alchemist ──
    "EdwardElric", "AlphonseElric", "Winry", "RoyMustang", "RizaHawkeye", "Scar",
    "Envy", "Greed", "Wrath", "Father",
    # ── Death Note ──
    "Light", "L", "Ryuk", "Misa", "Near", "Mello", "Rem", "Mikami",
    # ── Cowboy Bebop ──
    "Spike", "Faye", "Jet", "Vicious",
    # ── Evangelion ──
    "Shinji", "Asuka", "Rei", "Misato", "Kaworu", "Gendo",
    # ── One Punch Man ──
    "Saitama", "Genos", "Tatsumaki", "Garou", "Boros",
    # ── Mob Psycho 100 ──
    "Mob", "Reigen", "Dimple",
    # ── Jujutsu Kaisen ──
    "Sukuna", "Gojo", "Yuji", "Megumi", "Nobara", "Maki", "Toji", "Geto",
    "Nanami", "Mahito",
    # ── Chainsaw Man ──
    "Denji", "Power", "Aki", "Makima", "Kobeni", "Himeno", "Kishibe", "Quanxi",
    "Reze", "Pochita",
    # ── Black Clover ──
    "Asta", "Yuno", "Noelle", "Yami", "Luck", "Magna", "Vanessa", "Finral", "Julius",
    # ── Seven Deadly Sins ──
    "Meliodas", "Elizabeth", "Ban", "King", "Diane", "Gowther", "Escanor",
    "Merlin", "Zeldris",
    # ── Sword Art Online ──
    "Kirito", "Asuna", "Sinon", "Leafa", "Eugeo", "Alice", "Kayaba", "Klein",
    # ── Fairy Tail ──
    "Natsu", "Lucy", "Gray", "Erza", "Wendy", "Happy", "Gajeel", "Jellal",
    "Zeref", "Acnologia",
    # ── Inuyasha ──
    "Inuyasha", "Kagome", "Sesshomaru", "Miroku", "Sango", "Naraku", "Shippo",
    "Kikyo", "Koga", "Kirara",
    # ── Sailor Moon ──
    "SailorMoon", "SailorMars", "SailorMercury", "SailorJupiter", "SailorVenus",
    "TuxedoMask", "Chibiusa",
    # ── Anime titles ──
    "Dandadan", "Haikyuu", "BlueLock", "SoloLeveling", "VinlandSaga", "SpyxFamily",
    "DrStone", "FireForce", "CodeGeass", "OnePiece", "NarutoShippuden", "Bleach",
    "DragonBallZ", "DemonSlayer", "JujutsuKaisen", "AttackOnTitan",
    "MyHeroAcademia", "HunterxHunter", "DeathNote", "FullmetalAlchemist",
    "OnePunchMan", "MobPsycho100", "ChainsawMan", "BlackClover", "FairyTail",
    "SwordArtOnline", "TokyoGhoul",
    # ── Cartoons ──
    "SpongeBob", "PatrickStar", "Squidward", "MrKrabs", "SandyCheeks", "Plankton",
    "Tom", "Jerry", "BugsBunny", "DaffyDuck", "Tweety", "Sylvester", "RoadRunner",
    "WileECoyote", "ScoobyDoo", "Shaggy", "Velma", "Daphne", "FredJones",
    "Garfield", "Popeye", "Dexter", "JohnnyBravo", "Courage", "BenTennyson",
    "Gumball", "Darwin", "Finn", "Jake", "Marceline", "Mordecai", "Rigby",
    "StevenUniverse", "KimPossible", "DannyPhantom", "JimmyNeutron", "SamuraiJack",
    # ── Harry Potter ──
    "HarryPotter", "HermioneGranger", "RonWeasley", "Dumbledore", "Snape",
    "Voldemort", "DracoMalfoy", "Hagrid", "SiriusBlack", "BellatrixLestrange",
    # ── Star Wars ──
    "LukeSkywalker", "DarthVader", "LeiaOrgana", "HanSolo", "Yoda",
    "ObiWanKenobi", "Chewbacca", "Palpatine",
    # ── Marvel / DC ──
    "IronMan", "CaptainAmerica", "Thor", "Hulk", "BlackWidow", "Hawkeye",
    "Thanos", "Loki", "Wanda", "DoctorStrange", "SpiderMan", "Venom",
]


class WordsCollection:
    def __init__(self, db: aiosqlite.Connection):
        self.db = db

    async def seed_default_words(self) -> int:
        """Insert any missing default words. Returns count added."""
        now = datetime.now(timezone.utc).isoformat()
        cursor = await self.db.execute("SELECT normalized FROM words")
        seen = {row["normalized"] for row in await cursor.fetchall()}

        count = 0
        for w in DEFAULT_WORDS_NORMAL:
            norm = normalize_word(w)
            if norm in seen:
                continue
            seen.add(norm)
            try:
                await self.db.execute(
                    "INSERT INTO words (word, normalized, category, active, language, created_at) VALUES (?, ?, 'normal', 1, 'en', ?)",
                    (w, norm, now),
                )
                count += 1
            except Exception:
                pass
        for w in DEFAULT_WORDS_FICTION:
            norm = normalize_word(w)
            if norm in seen:
                continue
            seen.add(norm)
            try:
                await self.db.execute(
                    "INSERT INTO words (word, normalized, category, active, language, created_at) VALUES (?, ?, 'fiction', 1, 'en', ?)",
                    (w, norm, now),
                )
                count += 1
            except Exception:
                pass
        await self.db.commit()
        if count > 0:
            logger.info("Seeded %d new words.", count)
        return count

    async def categorize_existing_words(self) -> None:
        """Set category for any existing words that have NULL category."""
        fiction_norms = {normalize_word(w) for w in DEFAULT_WORDS_FICTION}
        # Set all NULL-category words to 'normal' by default
        await self.db.execute(
            "UPDATE words SET category = 'normal' WHERE category IS NULL"
        )
        # Set fiction words
        if fiction_norms:
            placeholders = ",".join("?" for _ in fiction_norms)
            await self.db.execute(
                f"UPDATE words SET category = 'fiction' WHERE normalized IN ({placeholders})",
                list(fiction_norms),
            )
        await self.db.commit()

    async def get_random_word(self, category: str = None, exclude_normalized: str = None) -> Optional[str]:
        """Get a random active word, optionally filtered by category."""
        conditions = ["active = 1"]
        params = []
        if category:
            conditions.append("category = ?")
            params.append(category)
        if exclude_normalized:
            conditions.append("normalized != ?")
            params.append(exclude_normalized)

        where = " AND ".join(conditions)
        cursor = await self.db.execute(
            f"SELECT word FROM words WHERE {where} ORDER BY RANDOM() LIMIT 1",
            params,
        )
        row = await cursor.fetchone()
        if row:
            return row["word"]
        # Fallback: seed and retry
        await self.seed_default_words()
        cursor = await self.db.execute(
            f"SELECT word FROM words WHERE {where} ORDER BY RANDOM() LIMIT 1",
            params,
        )
        row = await cursor.fetchone()
        return row["word"] if row else None

    async def get_random_word_for_game(self, game_id: int, category: str = None, exclude_normalized: str = None) -> Optional[str]:
        """Get a random word NOT yet used in this game session, filtered by category."""
        cursor = await self.db.execute("SELECT word_normalized FROM used_words WHERE game_id = ?", (game_id,))
        used_norms = [r["word_normalized"] for r in await cursor.fetchall()]

        exclude_list = list(used_norms)
        if exclude_normalized and exclude_normalized not in exclude_list:
            exclude_list.append(exclude_normalized)

        conditions = ["active = 1"]
        params = []
        if category:
            conditions.append("category = ?")
            params.append(category)
        if exclude_list:
            placeholders = ",".join("?" for _ in exclude_list)
            conditions.append(f"normalized NOT IN ({placeholders})")
            params.extend(exclude_list)

        where = " AND ".join(conditions)
        cursor = await self.db.execute(
            f"SELECT word FROM words WHERE {where} ORDER BY RANDOM() LIMIT 1",
            params,
        )
        row = await cursor.fetchone()
        if row:
            return row["word"]
        # All words used — allow repeats
        return await self.get_random_word(category=category, exclude_normalized=exclude_normalized)

    async def mark_word_used(self, game_id: int, word: str) -> None:
        """Record that a word was used in a game."""
        try:
            await self.db.execute(
                "INSERT OR IGNORE INTO used_words (game_id, word_normalized) VALUES (?, ?)",
                (game_id, normalize_word(word)),
            )
            await self.db.commit()
        except Exception:
            pass

    async def word_count(self, category: str = None) -> int:
        if category:
            cursor = await self.db.execute(
                "SELECT COUNT(*) as cnt FROM words WHERE active = 1 AND category = ?", (category,)
            )
        else:
            cursor = await self.db.execute("SELECT COUNT(*) as cnt FROM words WHERE active = 1")
        row = await cursor.fetchone()
        return row["cnt"] if row else 0
