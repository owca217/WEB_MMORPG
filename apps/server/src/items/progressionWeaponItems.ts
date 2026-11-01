import type { ItemQuality, ItemRarity } from "@web-mmorpg/shared";
import type { StarterItemSeed } from "./seedStarterItems";

const LEVELS = [1, 5, 10, 15, 20, 30] as const;
const QUALITIES: readonly ItemQuality[] = ["BASIC", "NORMAL", "GOOD", "EXCELLENT", "PERFECT", "MASTERWORK"];
const RARITIES: readonly ItemRarity[] = ["COMMON", "COMMON", "UNCOMMON", "UNCOMMON", "RARE", "RARE"];

type WeaponCategory = "sword" | "axe" | "hammer" | "dagger" | "spear" | "bow" | "crossbow" | "staff" | "wand" | "offensive-shield" | "two-handed";
type TierValues = readonly [number, number, number, number, number, number];
type AuthoredTiers = readonly [readonly [string, string], readonly [string, string], readonly [string, string], readonly [string, string], readonly [string, string], readonly [string, string]];

function uuid(domain: number, identity: number): string {
  return `${domain}000000-0000-4000-8000-${String(identity).padStart(12, "0")}`;
}

function category(
  identity: number, subcategoryId: WeaponCategory, weight: number,
  profiles: Readonly<Record<string, TierValues>>, authored: AuthoredTiers
): StarterItemSeed[] {
  return LEVELS.map((level, tier) => {
    // Category identity and level are permanent; neither depends on array ordering.
    const seedIdentity = identity * 100 + level;
    const itemId = `progression-${subcategoryId}-${level}`;
    return {
      itemUuid: uuid(30, seedIdentity), versionUuid: uuid(31, seedIdentity), itemId,
      categoryId: "weapon", subcategoryId, name: authored[tier]![0], description: authored[tier]![1],
      stackable: false, maxStack: 1, weight, minimumLevel: level, itemLevel: level,
      quality: QUALITIES[tier]!, rarity: RARITIES[tier]!, sellValue: 5 + 2 * level,
      tags: ["progression", "weapon"],
      icon: { key: `db-icons-${uuid(32, seedIdentity)}.png`, assetUrl: new URL(`../../assets/items/${itemId}.png`, import.meta.url) },
      specialData: {
        ...(subcategoryId === "offensive-shield" ? {} : { weaponFamily: subcategoryId === "two-handed" ? "sword" : subcategoryId }),
        durability: 40, maxDurability: 40, socketCount: 0
      },
      stats: Object.entries(profiles).map(([statCode, values], index) => ({
        id: uuid(33, seedIdentity * 10 + index), statCode, modifierType: "flat", value: values[tier]!
      }))
    };
  });
}

// Stable category numbers occupy a separate UUID namespace from all older seeds.
// The six authored entries always correspond to levels 1, 5, 10, 15, 20, 30.
export const PROGRESSION_WEAPON_ITEMS: readonly StarterItemSeed[] = [
  ...category(1, "sword", 1.8, { PHYSICAL_DAMAGE: [12,17,23,29,35,47], ARMOR: [2,3,4,5,6,8] }, [
    ["Miecz brodowego strażnika", "Krótki żelazny miecz z płytkim zbroczem. Jasny sznur oplata rękojeść zakończoną tarczową głowicą."],
    ["Miecz leszczynowego szlaku", "Stalowa klinga z prostym jelcem i ciemną skórzaną rękojeścią. Graniasta głowica równoważy ostrze."],
    ["Miecz szarej baszty", "Szeroka liściasta klinga z brązowym zakrzywionym jelcem. Rękojeść oplata ciemnoczerwona skóra."],
    ["Miecz błękitnej straży", "Polerowane ostrze ze zbroczem i wygiętym żelaznym jelcem. Błękitny oplot osłania długi uchwyt."],
    ["Miecz srebrnego przesmyku", "Długa klinga z jasnej stali, oprawiona w skórę i srebrzone okucia z motywem górskiej przełęczy."],
    ["Miecz koronnego kowala", "Mistrzowsko szlifowane ostrze z zamkniętą gardą. Na głowicy wybito niewielką koronę kuźniczą."]
  ]),
  ...category(2, "axe", 2.4, { PHYSICAL_DAMAGE: [13,19,25,32,39,52] }, [
    ["Topór olchowej przystani", "Szerokie żelazne ostrze na krótkim olchowym stylisku, zabezpieczonym skórzanym wiązaniem."],
    ["Topór kamiennego traktu", "Stalowy topór z klinowatym ostrzem i ciemnym dębowym trzonkiem, okutym przy nasadzie."],
    ["Topór rudego jaru", "Wyraźnie wyciągnięty dolny narożnik ostrza nadaje temu toporowi kształt brody. Stylisko oplata ruda skóra."],
    ["Topór żelaznej bramy", "Ciężkie ostrze z grubym obuchem osadzono na nitowanym stylisku z jesionu."],
    ["Topór czarnego granitu", "Ciemna stal i kamienna głowica styliska tworzą surową broń wykonaną w górskiej kuźni."],
    ["Topór mistrza z Karwenu", "Szeroka krawędź tnąca jest równo zahartowana. Miedziane linie na policzkach ostrza układają się w znak kuźni Karwenu."]
  ]),
  ...category(3, "hammer", 3, { PHYSICAL_DAMAGE: [11,15,21,26,31,42], ARMOR: [4,6,8,10,12,16] }, [
    ["Młot ceglanej warty", "Żelazny młot bojowy z kwadratowym obuchem i niewielką stalową osłoną dłoni."],
    ["Młot miedzianych nitów", "Stalowa głowica spoczywa na grubym trzonku. Miedziane nity spinają szeroką osłonę uchwytu."],
    ["Młot wieżowego zbrojnego", "Krępy młot z żeberkowanym obuchem i rozbudowanym jelcem z kutego żelaza."],
    ["Młot bastionu Wrzos", "Ośmioboczna głowica nosi znak wrzosowej gałązki. Płytki wokół rękojeści osłaniają nadgarstek."],
    ["Młot obsydianowej strażnicy", "Ciemna stalowa głowica z polerowanymi krawędziami i szerokim kabłąkiem zdobionym obsydianem."],
    ["Młot mistrza murów", "Masywny obuch wykuto z jednego kawałka stali. Profilowana osłona uchwytu ma kształt blankowanego muru."]
  ]),
  ...category(4, "dagger", 0.6, { PHYSICAL_DAMAGE: [11,15,21,26,31,42], INITIATIVE: [2,2,3,3,4,4] }, [
    ["Sztylet wierzbowego brodu", "Wąskie żelazne ostrze z krótkim jelcem i jasnym uchwytem z wierzby."],
    ["Sztylet skórzanego węzła", "Lekki sztylet z ciemnej stali. Pewny uchwyt tworzy ciasny splot skórzanych pasków."],
    ["Sztylet lisiej ścieżki", "Smukła klinga i mała głowica ułatwiają poręczny chwyt. Na jelcu wyryto trop lisa."],
    ["Sztylet szafirowego kuriera", "Krótkie ostrze o trójkątnym przekroju, z drobnym szafirem osadzonym w lekkiej głowicy."],
    ["Sztylet nocnego patrolu", "Matowa klinga z oszczędnym jelcem i fakturowaną rękojeścią z czarnego drewna."],
    ["Sztylet mistrza cienkiej stali", "Precyzyjnie szlifowany sztylet z ażurowym jelcem. Delikatny srebrny drut wzmacnia hebanowy uchwyt."]
  ]),
  ...category(5, "spear", 2.2, { PHYSICAL_DAMAGE: [12,17,23,29,35,47], INITIATIVE: [1,1,1,2,2,2] }, [
    ["Włócznia trzcinowej grobli", "Liściasty żelazny grot zamocowano na prostym drzewcu ze skórzanym oplotem pośrodku."],
    ["Włócznia jesionowego kręgu", "Wysmukły stalowy grot i jesionowy drzewiec połączono tuleją z dwoma miedzianymi pierścieniami."],
    ["Włócznia sokolej warty", "Lekka włócznia z wąskim grotem i piórem sokoła przywiązanym poniżej stalowej tulei."],
    ["Włócznia chorągwi z Dolin", "Długi grot o ostrym grzbiecie wieńczy ciemne drzewce, ozdobione skrawkiem zielonej chorągwi."],
    ["Włócznia stalowego pióra", "Smukły grot z jasnej stali ma zarys pióra. Okręcona drutem przeciwwaga równoważy drzewce."],
    ["Włócznia mistrza przedniej straży", "Dokładnie wyważona włócznia z żebrowanym grotem i srebrzonymi obejmami na jesionowym drzewcu."]
  ]),
  ...category(6, "bow", 1, { PHYSICAL_DAMAGE: [23,35,49,63,78,106] }, [
    ["Łuk leszczynowego zagajnika", "Niewielki łuk z jasnej leszczyny z lnianą cięciwą i prostym skórzanym uchwytem."],
    ["Łuk cisowego pagórka", "Cisowe ramiona pokryto cienką warstwą oleju. Uchwyt oplata brązowy rzemień."],
    ["Łuk rogowego grzbietu", "Warstwy drewna i rogu tworzą wygięte ramiona tego łuku. Końce osłaniają jasne nakładki."],
    ["Łuk zielonej chorągwi", "Smukły łuk klejony z ciemnego drewna, ze wzorem zielonych rombów przy uchwycie."],
    ["Łuk srebrnej doliny", "Starannie profilowane ramiona o srebrzonych zakończeniach łączy ciemna, mocno skręcona cięciwa."],
    ["Łuk mistrza dalekich wzgórz", "Misterny łuk warstwowy z hebanowym uchwytem. Jasne pasma rogu podkreślają równy łuk ramion."]
  ]),
  ...category(7, "crossbow", 2.8, { PHYSICAL_DAMAGE: [23,35,49,63,78,106] }, [
    ["Kusza dębowej furty", "Dębowe łoże, żelazne łuczysko i prosty spust tworzą solidną kuszę wartowniczą."],
    ["Kusza mosiężnej zapadki", "Krótkie stalowe łuczysko osadzono w ciemnym łożu z odsłoniętą mosiężną zapadką."],
    ["Kusza cechu strzelców", "Kusza o orzechowym łożu i wzmocnionym kabłąku. Na boku wybito znak cechu strzelców."],
    ["Kusza szarego bastionu", "Ciężkie łuczysko przytrzymują stalowe obejmy. Grzbiet łoża wyłożono szarą skórą."],
    ["Kusza rubinowego ryngrafu", "Polerowana stal opiera się na ciemnym drewnie. Płytkę nad spustem zdobi niewielki czerwony kamień."],
    ["Kusza mistrza siedmiu nitów", "Precyzyjnie spasowana kusza z czarnym łożem i siedmioma srebrnymi nitami wokół mechanizmu spustowego."]
  ]),
  ...category(8, "staff", 1.6, { PHYSICAL_DAMAGE: [6,9,12,15,18,24], SPELL_POWER: [12,17,23,29,35,47] }, [
    ["Kostur brzozowego kręgu", "Prosty brzozowy kostur ze stalową stopką i mlecznym kryształem ujętym w drewniane rozwidlenie."],
    ["Kostur ametystowej gałęzi", "Skręcona gałąź podtrzymuje mały ametyst. Dolny koniec chroni nitowana żelazna tuleja."],
    ["Kostur miedzianych obręczy", "Ciemny kostur z trzema miedzianymi obejmami i przejrzystym kryształem w otwartej oprawie."],
    ["Kostur błękitnej komnaty", "Głowicę jesionowego kostura wieńczy błękitny kamień osłonięty czterema stalowymi ramionami."],
    ["Kostur srebrnego splotu", "Srebrny drut oplata hebanowy trzon i przechodzi w koszyk podtrzymujący duży fioletowy kryształ."],
    ["Kostur mistrza kryształowych wież", "Starannie obrobiony kostur z graniastym kryształem w wysokiej oprawie. Stalowa stopka równoważy rozbudowaną głowicę."]
  ]),
  ...category(9, "wand", 0.2, { MAGIC_DAMAGE: [12,19,27,35,44,61] }, [
    ["Różdżka lipowego sęka", "Krótka lipowa różdżka z niewielkim kwarcem osadzonym w naturalnym zagłębieniu drewna."],
    ["Różdżka miedzianej spirali", "Polerowany drewniany trzon oplata miedziana spirala kończąca się pod bursztynowym kryształem."],
    ["Różdżka fiołkowego szkła", "Smukła różdżka z ciemnego drewna i fiołkowym kryształem o starannie oszlifowanych ściankach."],
    ["Różdżka srebrnej łuski", "Srebrne płytki układają się wokół uchwytu w drobne łuski. Koniec wieńczy niebieski kamień."],
    ["Różdżka gwiezdnego kwarcu", "Hebanowy trzon podtrzymuje przejrzysty kwarc z jasnymi wtrąceniami przypominającymi gwiazdy."],
    ["Różdżka mistrza opraw", "Sześć cienkich złoconych ramion obejmuje duży kryształ. Rękojeść wykonano z gładkiego czarnego drewna."]
  ]),
  ...category(10, "offensive-shield", 2.5, { PHYSICAL_DAMAGE: [4,6,9,11,13,18], MAGIC_DAMAGE: [4,5,7,9,11,15], BLOCK_POWER: [0,0,0,0,0,0] }, [
    ["Puklerz kwarcowego guza", "Mały puklerz z cienkiego drewna i wydatnym żelaznym guzem. U jego podstawy tkwi drobny kwarc."],
    ["Puklerz miedzianego dzioba", "Wąska tarcza z wystającym stalowym dziobem i miedzianą oprawą zielonego kamienia."],
    ["Puklerz rozszczepionej skały", "Otwarta stalowa obręcz otacza kanciasty guz z osadzonym kryształem. Uchwyt osłania tylko niewielka płyta."],
    ["Puklerz bursztynowego kolca", "Mała tarcza z szerokim kolcem ponad bursztynową oprawą. Cienki korpus pozostawia dużo miejsca na ruch ręki."],
    ["Puklerz szafirowego grotu", "Stalowe żebra zbiegają się w wysunięty grot. Pomiędzy nimi osadzono ciemnoniebieski kryształ."],
    ["Puklerz mistrza dwóch opraw", "Ażurowy puklerz z kutym ostrzem na krawędzi i dwoma kryształami przy centralnym guzie."]
  ]),
  ...category(11, "two-handed", 3.5, { PHYSICAL_DAMAGE: [25,35,47,60,72,97] }, [
    ["Miecz dwuręczny dębowej palisady", "Długie żelazne ostrze z prostym jelcem i obszernym uchwytem z dębowych okładzin."],
    ["Miecz dwuręczny przełęczy Wilczej", "Szeroka stalowa klinga nad długą skórzaną rękojeścią. Na ciężkiej głowicy wyryto wilczy trop."],
    ["Miecz dwuręczny kamiennej chorągwi", "Pogrubiona nasada ostrza i masywny jelec nadają tej broni surowy wygląd oręża z górskiej strażnicy."],
    ["Miecz dwuręczny czerwonej baszty", "Długa klinga z dwoma zbroczami i uchwytem oplecionym czerwonym rzemieniem pod stalową głowicą."],
    ["Miecz dwuręczny srebrnego sztandaru", "Jasna stalowa klinga wznosi się nad srebrzonym jelcem. Ciemną rękojeść spinają pierścienie z motywem sztandaru."],
    ["Miecz dwuręczny mistrza wielkiej kuźni", "Okazała klinga z równym szlifem i rozbudowanym jelcem. Złocone nity zdobią długi uchwyt przeznaczony dla obu dłoni."]
  ])
];
